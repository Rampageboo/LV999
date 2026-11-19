import { afterEach,expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../apps/server/src/infra/store.js';
import { ContentService } from '../apps/server/src/core/content-service.js';
import { DomainError } from '../apps/server/src/notion/adapter.js';
import type { MutationOp,MutationResult,Mutation } from '../packages/contracts/src/content.js';
const cleanup:(()=>void)[]=[];afterEach(()=>cleanup.splice(0).reverse().forEach(fn=>fn()));
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'lv999-content-')),store=new Store(dir),a=randomUUID(),b=randomUUID(),rootA=randomUUID(),rootB=randomUUID();
  cleanup.push(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  store.add({id:a,label:'Test A',environment:'test'});store.add({id:b,label:'Test B',environment:'test'});
  const pages=new Map<string,any>(),spaces=new Map<string,string>();
  let tick=0;const version=()=>new Date(Date.now()+(++tick)*1000).toISOString();
  for(const [id,workspace]of[[rootA,a],[rootB,b]]){pages.set(id,{object:'page',id,parent:{type:'workspace'},in_trash:false,last_edited_time:version(),properties:{title:{type:'title',title:[{plain_text:'Root'}]}}});spaces.set(id,workspace);}
  let failReadback=false,unknown=false;let hold:Promise<void>|null=null;
  const apply=vi.fn(async(op:MutationOp,known:(r:MutationResult)=>void)=>{
    if(hold)await hold;if(unknown)throw new Error('Opaque network timeout');
    let id='page_id'in op?op.page_id:randomUUID();
    if(op.kind==='create_page'){pages.set(id,{id,parent:{type:'page_id',page_id:op.parent_page_id},in_trash:false,last_edited_time:version(),properties:{title:{type:'title',title:[{plain_text:op.title}]}}});spaces.set(id,spaces.get(op.parent_page_id)!);}
    else{const page=pages.get(id);page.last_edited_time=version();if(op.kind==='trash_page')page.in_trash=true;if(op.kind==='restore_page')page.in_trash=false;}
    const result:MutationResult={id,url:null,last_edited_time:pages.get(id).last_edited_time,kind:op.kind,readback_verified:false,details:{}};
    known(result);if(failReadback)throw new DomainError('READBACK_FAILED','Readback failed');return{...result,readback_verified:true};
  });
  const verify=vi.fn(async(_op:MutationOp,result:MutationResult)=>({...result,readback_verified:true}));
  const access=vi.fn(async(workspace:string)=>{
    if(!new Set<string>([a,b]).has(workspace))throw new DomainError('UNKNOWN_WORKSPACE','Unknown');
    return{adapter:{identity:async()=>({workspace_id:workspace,workspace_name:'Test',bot_id:randomUUID()}),search:async()=>({}),page:async()=>({}),content:{
      resource:async(_kind:string,id:string)=>{if(spaces.get(id)!==workspace)throw new DomainError('NOT_FOUND_OR_NOT_SHARED','Not shared');return structuredClone(pages.get(id));},
      children:async()=>({results:[],has_more:false,next_cursor:null}),read:async()=>({}),apply,verify}}};
  });
  const content=new ContentService(store,access);
  const create=(extra:Partial<Mutation>={}):Mutation=>({target:{workspace_id:a},operation:{kind:'create_page',parent_page_id:rootA,title:'New page',text:'Hello'},idempotency_key:randomUUID(),...extra});
  const enable=async()=>{expect((await content.setEnabled({workspace_id:a,enabled:true})).ok).toBe(true);expect((await content.setEnabled({workspace_id:b,enabled:true})).ok).toBe(true);};
  return{store,content,a,b,rootA,rootB,pages,spaces,access,apply,verify,create,enable,setUnknown:()=>{unknown=true;},setReadbackFailure:()=>{failReadback=true;},hold:(promise:Promise<void>)=>{hold=promise;}};
}
it('keeps writes disabled by default and enforces startup client scopes before resource access',async()=>{
  const f=fixture();expect((await f.content.execute(f.create())).code).toBe('WRITE_DISABLED');await f.enable();f.access.mockClear();
  expect((await f.content.execute(f.create(),{actor:'claude',write_workspace_ids:[]})).code).toBe('WRITE_ACCESS_DENIED');expect(f.access).not.toHaveBeenCalled();expect(f.apply).not.toHaveBeenCalled();
});
it('production targets remain read-only until the exact ID is confirmed and can be disabled offline',async()=>{
  const f=fixture();f.store.add({id:f.a,label:'Production target',environment:'production'});
  expect((await f.content.execute(f.create())).code).toBe('WRITE_DISABLED');f.access.mockClear();
  expect((await f.content.setEnabled({workspace_id:f.a,enabled:true})).code).toBe('APPROVAL_REQUIRED');
  expect((await f.content.setEnabled({workspace_id:f.a,enabled:true,confirm_workspace_id:f.b})).code).toBe('APPROVAL_REQUIRED');expect(f.access).not.toHaveBeenCalled();
  expect((await f.content.setEnabled({workspace_id:f.a,enabled:true,confirm_workspace_id:f.a})).ok).toBe(true);
  expect((await f.content.execute(f.create(),{actor:'claude',write_workspace_ids:[]})).code).toBe('WRITE_ACCESS_DENIED');
  f.access.mockRejectedValue(new Error('Offline'));expect((await f.content.setEnabled({workspace_id:f.a,enabled:false})).ok).toBe(true);expect(f.content.enabled(f.a)).toBe(false);
});
it('returns a verified prior result for the same retry key without sending a second creation',async()=>{
  const f=fixture();await f.enable();const request=f.create(),first=await f.content.execute(request),second=await f.content.execute(request);
  expect(first.ok).toBe(true);expect(second.data?.id).toBe(first.data?.id);expect(f.apply).toHaveBeenCalledTimes(1);
  expect((await f.content.execute({...request,operation:{...request.operation,title:'Changed'} as any})).code).toBe('IDEMPOTENCY_CONFLICT');
});
it('rejects stale edits and wrong-Workspace parents before mutation',async()=>{
  const f=fixture();await f.enable();
  expect((await f.content.execute(f.create({operation:{kind:'update_page',page_id:f.rootA,title:'Edit',expected_last_edited_time:'old'}}))).code).toBe('CONTENT_CONFLICT');
  expect((await f.content.execute(f.create({operation:{kind:'create_page',parent_page_id:f.rootB,title:'Wrong',text:''}}))).code).toBe('NOT_FOUND_OR_NOT_SHARED');expect(f.apply).not.toHaveBeenCalled();
});
it('requires exact one-use destructive approval and caches a completed deletion',async()=>{
  const f=fixture();await f.enable();const request=f.create({operation:{kind:'trash_page',page_id:f.rootA,expected_last_edited_time:f.pages.get(f.rootA).last_edited_time}});
  expect((await f.content.execute(request)).code).toBe('APPROVAL_REQUIRED');
  const plan=(await f.content.prepare(request)).data!,approval=f.content.approve({plan_id:plan.id,plan_hash:plan.hash,confirm:true}).data!;
  const deleted=await f.content.execute({...request,approval});expect(deleted.ok).toBe(true);expect(f.pages.get(f.rootA).in_trash).toBe(true);
  expect((await f.content.execute({...request,approval})).data?.id).toBe(f.rootA);expect(f.apply).toHaveBeenCalledTimes(1);
});
it('invalidates a prepared delete when the resource changes before execution',async()=>{
  const f=fixture();await f.enable();const request=f.create({operation:{kind:'trash_page',page_id:f.rootA,expected_last_edited_time:f.pages.get(f.rootA).last_edited_time}});
  const plan=(await f.content.prepare(request)).data!,approval=f.content.approve({plan_id:plan.id,plan_hash:plan.hash,confirm:true}).data!;f.pages.get(f.rootA).last_edited_time='different';
  expect((await f.content.execute({...request,approval})).code).toBe('CONTENT_CONFLICT');expect(f.apply).not.toHaveBeenCalled();
});
it('retries only readback after a known result and never repeats the mutation',async()=>{
  const f=fixture();await f.enable();f.setReadbackFailure();const request=f.create();expect((await f.content.execute(request)).code).toBe('READBACK_FAILED');
  expect((await f.content.execute(request)).ok).toBe(true);expect(f.apply).toHaveBeenCalledTimes(1);expect(f.verify).toHaveBeenCalledTimes(1);
});
it('blocks resubmission and other writes when a network outcome is unknown',async()=>{
  const f=fixture();await f.enable();f.setUnknown();const request=f.create();expect((await f.content.execute(request)).code).toBe('MUTATION_OUTCOME_UNKNOWN');
  expect((await f.content.execute(request)).code).toBe('MUTATION_OUTCOME_UNKNOWN');expect((await f.content.execute(f.create())).code).toBe('MUTATION_OUTCOME_UNKNOWN');expect(f.apply).toHaveBeenCalledTimes(1);
});
it('refuses ambiguous project names before credentials and protects the exact route/root',async()=>{
  const f=fixture();await f.enable();const root=(id:string,workspace:string)=>({id,workspace_id:workspace,title:'Root',url:'https://www.notion.so/',parent_kind:'workspace',last_edited_time:null,root_eligible:true,root_reason:null});
  f.store.saveProject({project_key:'A',name:'Duplicate',workspace_id:f.a,root_page_id:f.rootA,expected_revision:0},root(f.rootA,f.a));
  f.store.saveProject({project_key:'B',name:'Duplicate',workspace_id:f.b,root_page_id:f.rootB,expected_revision:0},root(f.rootB,f.b));f.access.mockClear();
  expect((await f.content.execute(f.create({target:{project_name:'Duplicate',route_revision:1}}))).code).toBe('AMBIGUOUS_TARGET');expect(f.access).not.toHaveBeenCalled();
  expect((await f.content.execute(f.create({target:{project_key:'A',route_revision:2}}))).code).toBe('ROUTE_CONFLICT');
  expect((await f.content.execute(f.create({target:{workspace_id:f.a}}),{actor:'claude',write_workspace_ids:[f.a],project_keys:['A']})).code).toBe('WRITE_ACCESS_DENIED');expect(f.apply).not.toHaveBeenCalled();
});
it('checks relation references in the selected Workspace before writing',async()=>{
  const f=fixture();await f.enable();const request=f.create({operation:{kind:'update_record',page_id:f.rootA,expected_last_edited_time:f.pages.get(f.rootA).last_edited_time,properties:{Related:{relation:[{id:f.rootB}]}}}});
  expect((await f.content.execute(request)).code).toBe('NOT_FOUND_OR_NOT_SHARED');expect(f.apply).not.toHaveBeenCalled();
});
it('serializes concurrent writers per Workspace and accepts one retry key only once',async()=>{
  const f=fixture();await f.enable();let release!:()=>void;f.hold(new Promise<void>(resolve=>{release=resolve;}));
  const first=f.content.execute(f.create());await vi.waitFor(()=>expect(f.apply).toHaveBeenCalledTimes(1));
  expect((await f.content.execute(f.create())).code).toBe('MUTATION_BUSY');release();expect((await first).ok).toBe(true);expect(f.apply).toHaveBeenCalledTimes(1);
});
it('rejects external attachment URLs and oversized uploads before sending a write',async()=>{
  const f=fixture();await f.enable();
  expect((await f.content.execute(f.create({operation:{kind:'update_record',page_id:f.rootA,expected_last_edited_time:f.pages.get(f.rootA).last_edited_time,properties:{Files:{files:[{type:'external',external:{url:'https://example.com/private'}}]}}}}))).code).toBe('UNSUPPORTED');
  expect((await f.content.execute(f.create({operation:{kind:'upload_file',page_id:f.rootA,expected_last_edited_time:f.pages.get(f.rootA).last_edited_time,filename:'large.bin',content_type:'application/octet-stream',base64:Buffer.alloc(2*1024*1024+1).toString('base64')}}))).code).toBe('INVALID_INPUT');expect(f.apply).not.toHaveBeenCalled();
});
