import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MutationRequest,ExecuteMutationInput,ContentReadInput,type Mutation,type MutationOp,type MutationPlan,type MutationResult,type ContentCaller } from '../../../../packages/contracts/src/content.js';
import { result,type Result } from '../../../../packages/contracts/src/index.js';
import { DomainError,safeError,type NotionAdapter } from '../notion/adapter.js';
import type { ContentAdapter } from '../notion/content-adapter.js';
import type { Store } from '../infra/store.js';
import { projectNameLookup } from '../infra/store.js';
import { withinNotionBudget,checkNotionBudget } from '../notion/request-budget.js';

const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(canonical(value))).digest('hex');
const owner:ContentCaller={actor:'human',write_workspace_ids:'owner'};
type Target={workspaceId:string;projectKey:string|null;routeRevision:number|null;rootId:string|null};
type Prepared={target:Target;adapter:ContentAdapter;resource:any;plan:MutationPlan};
export class ContentService {
  constructor(private store:Store,private access:(id:string)=>Promise<{adapter:NotionAdapter}>){
    store.db.exec(`CREATE TABLE IF NOT EXISTS workspace_write_policy(workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),enabled INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS content_plans(id TEXT PRIMARY KEY,hash TEXT NOT NULL,actor TEXT NOT NULL,workspace_id TEXT NOT NULL,plan TEXT NOT NULL,approval_hash TEXT,approval_expires INTEGER,consumed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS content_operations(actor TEXT NOT NULL,retry_key TEXT NOT NULL,hash TEXT NOT NULL,workspace_id TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,result TEXT,error_code TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(actor,retry_key));
      CREATE TABLE IF NOT EXISTS content_rejection_reviews(seq INTEGER PRIMARY KEY,actor TEXT NOT NULL,retry_key TEXT NOT NULL,prior TEXT NOT NULL,proof TEXT NOT NULL,reviewed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS content_write_locks(workspace_id TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS content_uploads(upload_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,filename TEXT NOT NULL);`);
  }
  enabled(id:string){return this.store.db.prepare('SELECT enabled FROM workspace_write_policy WHERE workspace_id=?').get(id)?.enabled===1;}
  private fail<T>(error:unknown,id:string|null=null):Result<T>{const safe=safeError(error);return result<T>(null,id,safe.code,[safe.message]);}
  async setEnabled(input:unknown){
    const parsed=z.object({workspace_id:z.uuid(),enabled:z.boolean(),confirm_workspace_id:z.uuid().optional()}).strict().safeParse(input);
    if(!parsed.success)return this.fail(new DomainError('INVALID_INPUT','Select an exact Workspace.'));
    const {workspace_id:id,enabled}=parsed.data;
    try{const workspace=this.store.list().find(w=>w.id===id);if(!workspace)throw new DomainError('UNKNOWN_WORKSPACE','Select a registered Workspace.');
      if(enabled){if(workspace.access_role==='source')throw new DomainError('WRITE_ACCESS_DENIED','Source connections cannot enable writes.');if(workspace.environment==='production'&&parsed.data.confirm_workspace_id!==id)throw new DomainError('APPROVAL_REQUIRED','Confirm this exact production Workspace ID before enabling content writes.');await this.access(id);}
      this.store.db.prepare('INSERT INTO workspace_write_policy(workspace_id,enabled) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET enabled=excluded.enabled').run(id,Number(enabled));
      this.store.log({level:'info',action:enabled?`${workspace.environment==='production'?'Production':'Test'} Workspace writes enabled`:'Workspace writes disabled',workspace_id:id,code:'OK'});return result({enabled},id);
    }catch(error){return this.fail(error,id);}
  }
  private target(input:Mutation['target']):Target {
    if(input.workspace_id)return{workspaceId:input.workspace_id,projectKey:null,routeRevision:null,rootId:null};
    const matches=this.store.projects().filter(route=>input.project_key?route.project_key===input.project_key:projectNameLookup(route.name)===projectNameLookup(input.project_name!));
    if(matches.length!==1)throw new DomainError(matches.length?'AMBIGUOUS_TARGET':'UNKNOWN_PROJECT','Choose one exact project key; no Workspace was guessed.');
    const route=matches[0];if(route.revision!==input.route_revision)throw new DomainError('ROUTE_CONFLICT','The project route changed. Resolve it again before writing.');
    return{workspaceId:route.workspace_id,projectKey:route.project_key,routeRevision:route.revision,rootId:route.root_page.id};
  }
  private permission(target:Target,caller:ContentCaller,operation:MutationOp){
    if(this.store.updateBlocked())throw new DomainError('MUTATION_BUSY','An application update is in progress. Retry after LV999 restarts.');
    if(this.store.list().find(w=>w.id===target.workspaceId)?.access_role==='source')throw new DomainError('WRITE_ACCESS_DENIED','Source connections are strictly read-only.');
    if(caller.project_keys&&(!target.projectKey||!caller.project_keys.includes(target.projectKey)))throw new DomainError('WRITE_ACCESS_DENIED','This session can write only through its bound project route.');
    if(caller.write_workspace_ids!=='owner'&&!caller.write_workspace_ids.includes(target.workspaceId))throw new DomainError('WRITE_ACCESS_DENIED','This client was not granted write access to that Workspace. Regenerate its scoped configuration.');
    if(caller.limited_board){
      caller.limited_board.validate();
      const limited=operation.kind==='append_blocks'&&operation.page_id===caller.limited_board.append_page_id||operation.kind==='create_page'&&operation.parent_page_id===caller.limited_board.create_parent_id;
      if(!limited)throw new DomainError('WRITE_ACCESS_DENIED','This capability permits only the exact message board operation.');
    }else if(!this.enabled(target.workspaceId))throw new DomainError('WRITE_DISABLED','Enable writes for this exact Workspace in LV999 first. Production targets require explicit confirmation.');
  }
  private routeCurrent(target:Target){if(target.projectKey&&this.store.projects().find(p=>p.project_key===target.projectKey)?.revision!==target.routeRevision)throw new DomainError('ROUTE_CONFLICT','The project route changed during validation; nothing was written.');}
  private async pageScope(adapter:ContentAdapter,page:any,root:string|null){
    if(!root)return;
    const seen=new Set<string>();
    for(let depth=0;depth<32;depth++){
      if(page.id===root)return;
      if(seen.has(page.id))break;seen.add(page.id);
      const parent=page.parent;
      if(parent?.type==='page_id')page=await adapter.resource('page',parent.page_id);
      else if(parent?.type==='data_source_id'){
        const ds=await adapter.resource('data_source',parent.data_source_id),db=await adapter.resource('database',ds.parent.database_id);
        if(db.parent?.type!=='page_id')break;page=await adapter.resource('page',db.parent.page_id);
      }else break;
    }
    throw new DomainError('WRITE_ACCESS_DENIED','This resource is outside the selected project root.');
  }
  private async resourceFor(op:MutationOp,adapter:ContentAdapter,target:Target,boardAppend=false){
    let resource:any;
    if('data_source_id'in op){
      resource=await adapter.resource('data_source',op.data_source_id);
      const db=await adapter.resource('database',resource.parent.database_id);
      if(target.rootId){if(db.parent?.type!=='page_id')throw new DomainError('WRITE_ACCESS_DENIED','The database is outside the project root.');await this.pageScope(adapter,await adapter.resource('page',db.parent.page_id),target.rootId);}
    }else if('database_id'in op){
      resource=await adapter.resource('database',op.database_id);
      if(target.rootId){if(resource.parent?.type!=='page_id')throw new DomainError('WRITE_ACCESS_DENIED','The database is outside the project root.');await this.pageScope(adapter,await adapter.resource('page',resource.parent.page_id),target.rootId);}
    }else{
      const pageId='parent_page_id'in op?op.parent_page_id:op.page_id;
      const page=await adapter.resource('page',pageId);await this.pageScope(adapter,page,target.rootId);resource=page;
      if('block_id'in op){
        resource=await adapter.resource('block',op.block_id);let block=resource,matched=false;const seen=new Set<string>();
        for(let depth=0;depth<32;depth++){
          if(block.parent?.type==='page_id'){matched=block.parent.page_id===pageId;break;}
          if(block.parent?.type!=='block_id'||seen.has(block.id))break;seen.add(block.id);block=await adapter.resource('block',block.parent.block_id);
        }
        if(!matched)throw new DomainError('WRITE_ACCESS_DENIED','The block does not belong to the specified page.');
      }
    }
    if(resource.in_trash&&op.kind!=='restore_page')throw new DomainError('CONTENT_CONFLICT','The target is in trash. Restore it explicitly before editing.');
    // A registered board can only append new blocks; concurrent edits cannot be overwritten by this operation.
    if(!boardAppend&&'expected_last_edited_time'in op&&resource.last_edited_time!==op.expected_last_edited_time)throw new DomainError('CONTENT_CONFLICT','The resource changed since it was loaded. Reload and review your edit.');
    return resource;
  }
  private async references(value:any,adapter:ContentAdapter,workspaceId:string,depth=0):Promise<void>{
    if(depth>20)throw new DomainError('INVALID_INPUT','Content nesting is too deep.');
    if(!value||typeof value!=='object')return;
    if(typeof value.file?.url==='string'||typeof value.external?.url==='string'||value.type==='external')throw new DomainError('UNSUPPORTED','Use LV999 upload_file and its owned file_upload ID for attachments; remote file URLs are not accepted.');
    if(value.file_upload?.id){const upload=this.store.db.prepare('SELECT workspace_id FROM content_uploads WHERE upload_id=?').get(value.file_upload.id);if(upload?.workspace_id!==workspaceId)throw new DomainError('WRITE_ACCESS_DENIED','This upload was not created by LV999 in the selected Workspace.');}
    if(Array.isArray(value.relation)){if(value.relation.length>100)throw new DomainError('INVALID_INPUT','Limit each relation to 100 pages.');for(const related of value.relation){if(!z.uuid().safeParse(related.id).success)throw new DomainError('INVALID_INPUT','A relation requires page IDs.');await adapter.resource('page',related.id);}}
    else if(value.relation?.data_source_id)await adapter.resource('data_source',value.relation.data_source_id);
    if(value.mention?.page?.id)await adapter.resource('page',value.mention.page.id);
    for(const [key,item]of Object.entries(value))if(key!=='relation'&&key!=='mention')await this.references(item,adapter,workspaceId,depth+1);
  }
  private validate(op:MutationOp){
    if(op.kind==='upload_file'){
      const bytes=Buffer.from(op.base64,'base64');if(bytes.length>2*1024*1024||bytes.toString('base64')!==op.base64)throw new DomainError('INVALID_INPUT','Choose a valid file of at most 2 MiB.');
    }
    if(op.kind==='update_page'&&!op.title&&!Object.keys(op.properties??{}).length)throw new DomainError('INVALID_INPUT','Provide a title or properties to update.');
    if(op.kind==='update_block'&&Object.keys(op.body).some(key=>['id','block_id','parent','in_trash','archived','type'].includes(key)))throw new DomainError('INVALID_INPUT','Block edits must contain only the existing block type payload.');
    if(op.kind==='append_blocks'){
      for(const block of op.blocks)if(typeof block.type!=='string'||!block[block.type]||Object.keys(block).some(key=>!['object','type',String(block.type)].includes(key)))throw new DomainError('INVALID_INPUT','Append only new typed block objects without existing IDs or parent overrides.');
    }
  }
  prepare(input:unknown,caller:ContentCaller=owner){return withinNotionBudget(()=>this.prepareInternal(input,caller));}
  private async prepareInternal(input:unknown,caller:ContentCaller):Promise<Result<MutationPlan>>{
    try{const request=MutationRequest.parse(input);const prepared=await this.preflight(request,caller);this.store.db.prepare('INSERT INTO content_plans(id,hash,actor,workspace_id,plan) VALUES(?,?,?,?,?)').run(prepared.plan.id,prepared.plan.hash,caller.actor,prepared.target.workspaceId,JSON.stringify(prepared.plan));return result(prepared.plan,prepared.target.workspaceId);}
    catch(error){return this.fail(error instanceof z.ZodError?new DomainError('INVALID_INPUT','Invalid content mutation.'):error);}
  }
  private async preflight(request:Mutation,caller:ContentCaller):Promise<Prepared>{
    const target=this.target(request.target);this.permission(target,caller,request.operation);this.validate(request.operation);
    const {adapter:base}=await this.access(target.workspaceId),adapter=base.content;
    if(!adapter)throw new DomainError('UNSUPPORTED','This adapter does not support content operations.');
    const resource=await this.resourceFor(request.operation,adapter,target,request.operation.kind==='append_blocks'&&caller.limited_board?.append_page_id===request.operation.page_id);
    await this.references('properties'in request.operation?request.operation.properties:'blocks'in request.operation?request.operation.blocks:'body'in request.operation?request.operation.body:null,adapter,target.workspaceId);
    if(request.operation.kind==='update_block'&&!request.operation.body[resource.type])throw new DomainError('INVALID_INPUT','A block edit cannot change its type.');
    this.routeCurrent(target);
    const destructive=['trash_page','restore_page','delete_block','update_data_source'].includes(request.operation.kind);
    const plan:MutationPlan={id:randomUUID(),hash:hash({request,actor:caller.actor,target}),workspace_id:target.workspaceId,project_key:target.projectKey,operation:request.operation.kind,resource_id:resource.id,
      title:typeof resource.title==='string'?resource.title:resource.properties?Object.values(resource.properties).filter((p:any)=>p.type==='title').flatMap((p:any)=>p.title??[]).map((p:any)=>p.plain_text??p.text?.content??'').join('').slice(0,200):request.operation.kind,
      version:resource.last_edited_time??null,destructive,expires_at:new Date(Date.now()+300000).toISOString(),summary:`${request.operation.kind} · ${request.operation.kind==='update_data_source'?'schema fields: '+Object.keys(request.operation.properties).join(', '):destructive?'entire target and its child content':'exact Workspace'} · ${destructive?'one-use approval required':'write'}`};
    return{target,adapter,resource,plan};
  }
  approve(input:unknown){
    try{const value=z.object({plan_id:z.uuid(),plan_hash:z.string(),confirm:z.literal(true)}).strict().parse(input);
      const row=this.store.db.prepare('SELECT * FROM content_plans WHERE id=?').get(value.plan_id);
      if(!row||row.hash!==value.plan_hash||row.consumed)throw new DomainError('APPROVAL_INVALID','The plan changed or was already used. Prepare it again.');
      const plan=JSON.parse(String(row.plan)) as MutationPlan;if(Date.parse(plan.expires_at)<Date.now())throw new DomainError('APPROVAL_INVALID','The preview expired. Prepare it again.');
      this.store.db.prepare('UPDATE content_plans SET approval_hash=?,approval_expires=? WHERE id=?').run(plan.hash,Date.now()+120000,value.plan_id);
      return result({plan_id:value.plan_id,plan_hash:value.plan_hash},plan.workspace_id);
    }catch(error){return this.fail(error);}
  }
  async reconcileRejectedAppend(input:unknown,caller:ContentCaller=owner){
    try{
      if(caller.actor!=='human'||caller.write_workspace_ids!=='owner'||caller.limited_board)throw new DomainError('WRITE_ACCESS_DENIED','Only the local Owner may inspect a rejected append for retry.');
      const value=z.object({request:MutationRequest,before_child_ids:z.array(z.uuid()).max(1000),confirm:z.literal(true)}).strict().parse(input),request=value.request;
      if(request.operation.kind!=='append_blocks')throw new DomainError('INVALID_INPUT','Only a rejected append can use this inspection.');
      const eligible=(row:any)=>row?.state==='FAILED'&&row.kind==='append_blocks'&&row.error_code==='INVALID_INPUT'&&!row.result&&row.hash===hash({request,actor:caller.actor});
      const previous=this.store.db.prepare('SELECT * FROM content_operations WHERE actor=? AND retry_key=?').get(caller.actor,request.idempotency_key);
      if(!eligible(previous))throw new DomainError('MUTATION_OUTCOME_UNKNOWN','Only a known validation rejection without an accepted result may be reconciled.');
      const prepared=await this.preflight(request,caller),ids:string[]=[],seen=new Set<string>();let cursor:string|undefined;
      do{const batch=await prepared.adapter.children(request.operation.page_id,cursor);if(!Array.isArray(batch.results)||typeof batch.has_more!=='boolean')throw new DomainError('INVALID_RESPONSE','Invalid child batch.');ids.push(...batch.results.map((b:any)=>b.id));if(ids.length>1000)throw new DomainError('INVALID_INPUT','Inspect this large target manually.');cursor=batch.has_more?batch.next_cursor:undefined;if(batch.has_more&&(!cursor||seen.has(cursor)))throw new DomainError('INVALID_RESPONSE','Target pagination did not advance.');if(cursor)seen.add(cursor);}while(cursor);
      if(new Set(value.before_child_ids).size!==value.before_child_ids.length||JSON.stringify([...ids].sort())!==JSON.stringify([...value.before_child_ids].sort()))throw new DomainError('CONTENT_CONFLICT','The target children differ from the recorded pre-write state.');
      this.routeCurrent(prepared.target);const db=this.store.db;db.exec('BEGIN IMMEDIATE');
      try{const current=db.prepare('SELECT * FROM content_operations WHERE actor=? AND retry_key=?').get(caller.actor,request.idempotency_key);if(!eligible(current))throw new DomainError('CONTENT_CONFLICT','The operation changed during inspection.');
        db.prepare('INSERT INTO content_rejection_reviews(actor,retry_key,prior,proof,reviewed_at) VALUES(?,?,?,?,?)').run(caller.actor,request.idempotency_key,JSON.stringify(current),JSON.stringify({child_ids:ids,version:prepared.resource.last_edited_time}),new Date().toISOString());
        db.prepare("UPDATE content_operations SET state='FAILED_REVIEWED',updated_at=? WHERE actor=? AND retry_key=?").run(new Date().toISOString(),caller.actor,request.idempotency_key);db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      return result({retry_ready:true,idempotency_key:request.idempotency_key},prepared.target.workspaceId);
    }catch(error){return this.fail(error instanceof z.ZodError?new DomainError('INVALID_INPUT','Use the exact rejected request and its recorded target children.'):error);}
  }
  private claim(request:Mutation,prepared:Prepared,caller:ContentCaller,approval?:z.infer<typeof ExecuteMutationInput>['approval']){
    const db=this.store.db,key=request.idempotency_key,ownerId=randomUUID();db.exec('BEGIN IMMEDIATE');
    try{
      if(this.store.updateBlocked())throw new DomainError('MUTATION_BUSY','An application update is in progress.');
      const existing=db.prepare('SELECT * FROM content_operations WHERE actor=? AND retry_key=?').get(caller.actor,key);
      if(existing){if(existing.hash!==hash({request,actor:caller.actor}))throw new DomainError('IDEMPOTENCY_CONFLICT','This retry key was used for different content.');if(!(existing.state==='FAILED_REVIEWED'&&existing.kind==='append_blocks'&&existing.error_code==='INVALID_INPUT'&&!existing.result&&caller.actor==='human'&&caller.write_workspace_ids==='owner')){db.exec('ROLLBACK');return{existing,ownerId:null};}}
      const pending=db.prepare("SELECT state FROM content_operations WHERE workspace_id=? AND state IN ('DISPATCHING','UNKNOWN')").get(prepared.target.workspaceId);
      if(pending){const live=db.prepare('SELECT expires FROM content_write_locks WHERE workspace_id=?').get(prepared.target.workspaceId);throw new DomainError(pending.state==='DISPATCHING'&&Number(live?.expires??0)>Date.now()?'MUTATION_BUSY':'MUTATION_OUTCOME_UNKNOWN','Another write is active or has an unknown outcome. Inspect its status before submitting another.');}
      const locked=db.prepare(`INSERT INTO content_write_locks(workspace_id,owner,expires) VALUES(?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE content_write_locks.expires<?`).run(prepared.target.workspaceId,ownerId,Date.now()+30000,Date.now()).changes;
      if(!locked)throw new DomainError('MUTATION_BUSY','Another writer is using this Workspace. Wait and retry.');
      if(prepared.plan.destructive){
        const row=approval?db.prepare('SELECT * FROM content_plans WHERE id=?').get(approval.plan_id):null;
        if(!row||row.actor!==caller.actor||row.hash!==prepared.plan.hash||row.hash!==approval?.plan_hash||row.consumed||Number(row.approval_expires)<Date.now()||row.approval_hash!==row.hash)throw new DomainError('APPROVAL_REQUIRED','Review this exact destructive plan in LV999 and approve it once.');
        const stored=JSON.parse(String(row.plan));if(stored.version!==prepared.plan.version||Date.parse(stored.expires_at)<Date.now())throw new DomainError('CONTENT_CONFLICT','The target changed after its preview. Review a new plan.');
        db.prepare('UPDATE content_plans SET consumed=1 WHERE id=?').run(approval!.plan_id);
      }
      if(existing)db.prepare("UPDATE content_operations SET state='DISPATCHING',error_code=NULL,updated_at=? WHERE actor=? AND retry_key=?").run(new Date().toISOString(),caller.actor,key);
      else db.prepare('INSERT INTO content_operations(actor,retry_key,hash,workspace_id,kind,state,updated_at) VALUES(?,?,?,?,?,?,?)').run(caller.actor,key,hash({request,actor:caller.actor}),prepared.target.workspaceId,request.operation.kind,'DISPATCHING',new Date().toISOString());
      db.exec('COMMIT');return{existing:null,ownerId};
    }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  }
  private finish(request:Mutation,caller:ContentCaller,workspace:string,value:MutationResult){
    const db=this.store.db;db.exec('BEGIN IMMEDIATE');try{
      const prior=db.prepare('SELECT state,result FROM content_operations WHERE actor=? AND retry_key=?').get(caller.actor,request.idempotency_key);
      if(prior?.state==='APPLIED'){db.exec('ROLLBACK');return result<MutationResult>(JSON.parse(String(prior.result)),workspace);}
      db.prepare("UPDATE content_operations SET state='APPLIED',result=?,error_code=NULL,updated_at=? WHERE actor=? AND retry_key=?").run(JSON.stringify(value),new Date().toISOString(),caller.actor,request.idempotency_key);
      this.store.log({level:'info',action:`Content ${request.operation.kind} verified (${caller.actor})`,workspace_id:workspace,code:'OK'});db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    const reply=result(value,workspace);reply.changed_objects=1;return reply;
  }
  execute(input:unknown,caller:ContentCaller=owner){return withinNotionBudget(()=>this.executeInternal(input,caller));}
  private async executeInternal(input:unknown,caller:ContentCaller):Promise<Result<MutationResult>>{
    let request:Mutation|undefined,prepared:Prepared|undefined,ownerId:string|null=null,heartbeat:ReturnType<typeof setInterval>|undefined,known:MutationResult|null=null;
    try{
      const parsed=ExecuteMutationInput.parse(input);const {approval,...requestData}=parsed;request=MutationRequest.parse(requestData);
      const previous=this.store.db.prepare('SELECT * FROM content_operations WHERE actor=? AND retry_key=?').get(caller.actor,request.idempotency_key);
      if(previous){
        if(previous.hash!==hash({request,actor:caller.actor}))throw new DomainError('IDEMPOTENCY_CONFLICT','This retry key was used for different content.');
        if(caller.write_workspace_ids!=='owner'&&!caller.write_workspace_ids.includes(String(previous.workspace_id)))throw new DomainError('WRITE_ACCESS_DENIED','This client cannot inspect that operation.');
        if(previous.state==='APPLIED')return result(JSON.parse(String(previous.result)),String(previous.workspace_id));
        if(previous.state==='UNVERIFIED'&&previous.result){
          const {adapter}=await this.access(String(previous.workspace_id));if(!adapter.content)throw new DomainError('UNSUPPORTED','Content verification is unavailable.');
          const checked=await adapter.content.verify(request.operation,JSON.parse(String(previous.result)));return this.finish(request,caller,String(previous.workspace_id),checked);
        }
        if(!(previous.state==='FAILED_REVIEWED'&&caller.actor==='human'&&caller.write_workspace_ids==='owner'))throw new DomainError(previous.state==='FAILED'?'CONTENT_CONFLICT':'MUTATION_OUTCOME_UNKNOWN','The prior attempt cannot be safely repeated. Inspect its recorded status.');
      }
      prepared=await this.preflight(request,caller);checkNotionBudget();
      const claim=this.claim(request,prepared,caller,parsed.approval);ownerId=claim.ownerId;
      if(claim.existing){
        const row=claim.existing;if(row.state==='APPLIED')return result(JSON.parse(String(row.result)),prepared.target.workspaceId);
        if(row.state==='UNVERIFIED'&&row.result){known=JSON.parse(String(row.result));const checked=await prepared.adapter.verify(request.operation,known!);return this.finish(request,caller,prepared.target.workspaceId,checked);}
        throw new DomainError(row.state==='FAILED'?'CONTENT_CONFLICT':'MUTATION_OUTCOME_UNKNOWN','The previous attempt was not verified. Inspect its status; no second write was sent.');
      }
      const target=prepared.target;
      heartbeat=setInterval(()=>{try{this.store.db.prepare('UPDATE content_write_locks SET expires=? WHERE workspace_id=? AND owner=?').run(Date.now()+30000,target.workspaceId,ownerId);}catch{}},5000);heartbeat.unref();
      this.permission(target,caller,request.operation);this.routeCurrent(target);
      const current=await this.resourceFor(request.operation,prepared.adapter,target,request.operation.kind==='append_blocks'&&caller.limited_board?.append_page_id===request.operation.page_id);checkNotionBudget();
      const value=await prepared.adapter.apply(request.operation,value=>{
        known=value;this.store.db.prepare("UPDATE content_operations SET state='UNVERIFIED',result=?,updated_at=? WHERE actor=? AND retry_key=?").run(JSON.stringify(value),new Date().toISOString(),caller.actor,request!.idempotency_key);
        if(value.details.file_upload_id)this.store.db.prepare('INSERT OR IGNORE INTO content_uploads(upload_id,workspace_id,filename) VALUES(?,?,?)').run(String(value.details.file_upload_id),target.workspaceId,String(value.details.filename));
      },current);
      return this.finish(request,caller,target.workspaceId,value);
    }catch(error){
      const failure=error instanceof z.ZodError?new DomainError('INVALID_INPUT','Invalid content mutation.'):safeError(error);
      if(request&&prepared&&ownerId){
        const rejected=['INVALID_INPUT','FORBIDDEN','AUTH_REQUIRED','NOT_FOUND_OR_NOT_SHARED','RATE_LIMITED','CONTENT_CONFLICT'].includes(failure.code);
        const state=known?'UNVERIFIED':rejected?'FAILED':'UNKNOWN';
        try{this.store.db.prepare('UPDATE content_operations SET state=?,error_code=?,updated_at=? WHERE actor=? AND retry_key=?').run(state,failure.code,new Date().toISOString(),caller.actor,request.idempotency_key);}catch{}
        if(known)return result(known,prepared.target.workspaceId,'READBACK_FAILED',['The request reached Notion, but verification is incomplete. Use the same key to verify again; do not repeat the write.']);
        if(!rejected)return this.fail(new DomainError('MUTATION_OUTCOME_UNKNOWN','The write outcome is unknown. It will not be automatically resubmitted; reconcile it before writing again.'),prepared.target.workspaceId);
      }
      return this.fail(failure,prepared?.target.workspaceId??null);
    }finally{if(heartbeat)clearInterval(heartbeat);if(ownerId&&prepared)try{this.store.db.prepare('DELETE FROM content_write_locks WHERE workspace_id=? AND owner=?').run(prepared.target.workspaceId,ownerId);}catch{}}
  }
  status(key:string,caller:ContentCaller=owner){
    const row=this.store.db.prepare('SELECT workspace_id,kind,state,result,error_code,updated_at FROM content_operations WHERE actor=? AND retry_key=?').get(caller.actor,key);
    if(!row)return result(null,null,'NOT_FOUND_OR_NOT_SHARED',['No matching operation exists for this caller.']);
    if(caller.write_workspace_ids!=='owner'&&!caller.write_workspace_ids.includes(String(row.workspace_id)))return this.fail(new DomainError('WRITE_ACCESS_DENIED','This client cannot inspect that operation.'));
    return result({...row,result:row.result?JSON.parse(String(row.result)):null},String(row.workspace_id));
  }
  pending(){
    const plans=this.store.db.prepare('SELECT plan,actor,approval_expires FROM content_plans WHERE consumed=0 ORDER BY rowid DESC LIMIT 50').all()
      .map(row=>({...JSON.parse(String(row.plan)),actor:row.actor,approved_until:row.approval_expires??null})).filter(plan=>Date.parse(plan.expires_at)>Date.now());
    const operations=this.store.db.prepare('SELECT actor,retry_key,workspace_id,kind,state,error_code,updated_at FROM content_operations ORDER BY updated_at DESC LIMIT 50').all();
    return result({plans,operations});
  }
  read(input:unknown){return withinNotionBudget(()=>this.readInternal(input));}
  private async readInternal(input:unknown){
    try{const parsed=ContentReadInput.parse(input);const {adapter}=await this.access(parsed.workspace_id);if(!adapter.content)throw new DomainError('UNSUPPORTED','Content reads are unavailable.');return result(await adapter.content.read(parsed),parsed.workspace_id);}
    catch(error){return this.fail(error instanceof z.ZodError?new DomainError('INVALID_INPUT','Select a valid content resource.'):error);}
  }
}
