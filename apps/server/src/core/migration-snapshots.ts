import {join} from 'node:path';
import {z} from 'zod';
import {result,type MigrationSnapshotView,type Result} from '../../../../packages/contracts/src/index.js';
import {PrivateSnapshots,type SnapshotReceipt} from '../infra/private-snapshot.js';
import type {Vault} from '../infra/vault.js';
import type {Store} from '../infra/store.js';

// Registration reads authenticated encrypted evidence; callers cannot submit display counts or success flags.
export class MigrationSnapshots{
 readonly backups:PrivateSnapshots;
 constructor(private store:Store,vault:Vault){
  this.backups=new PrivateSnapshots(join(store.directory,'snapshots'),vault);
  store.db.exec('CREATE TABLE IF NOT EXISTS source_capture_previews(id TEXT PRIMARY KEY,project_key TEXT NOT NULL,created_at TEXT NOT NULL,report TEXT NOT NULL)');
 }
 async register(receipt:SnapshotReceipt):Promise<Result<MigrationSnapshotView>>{
  try{
   const payload=z.object({kind:z.literal('project-source-capture'),project_key:z.string(),source_workspace_id:z.uuid(),target_workspace_id:z.uuid(),capture:z.object({retrieved_at:z.string(),pages:z.record(z.string(),z.any()),children:z.record(z.string(),z.array(z.any())),data_sources:z.record(z.string(),z.any()),databases:z.record(z.string(),z.any()).optional(),warnings:z.array(z.string())}),extras:z.any().optional()}).parse(await this.backups.read(receipt));
   const source=this.store.list().find(w=>w.id===payload.source_workspace_id),route=this.store.projects().find(p=>p.project_key===payload.project_key);
   if(source?.access_role!=='source'||!route||route.workspace_id!==payload.target_workspace_id||route.workspace_id===source.id||this.store.list().find(w=>w.id===route.workspace_id)?.access_role==='source')return result<MigrationSnapshotView>(null,null,'WORKSPACE_MISMATCH',['The snapshot does not match a registered source and current project destination.']);
   const capture=payload.capture,blocks=Object.values(capture.children).flat(),records=Object.values(capture.data_sources).flatMap(ds=>ds.records??[]),warnings=new Set<string>();
   if(!payload.extras?.comment_scan?.all_unresolved_accessible)warnings.add('COMMENTS_UNAVAILABLE');
   warnings.add('HISTORY_RETAINED_AT_SOURCE');
   if(blocks.some(b=>b.type==='unsupported'))warnings.add('UNSUPPORTED_BLOCK');
   if(capture.warnings.some(w=>/requires|require|Unsupported/.test(w)))warnings.add('SOURCE_ITEMS_NEED_REVIEW');
   if(payload.extras?.warnings?.some((w:any)=>w.kind==='VIEWS_UNAVAILABLE'))warnings.add('VIEWS_UNAVAILABLE');
   const files=new Set<string>();const scan=(value:any):void=>{if(!value||typeof value!=='object')return;if(value.type==='file'&&value.file?.url){const url=new URL(value.file.url);files.add(url.origin+url.pathname);}for(const child of Object.values(value))if(child&&typeof child==='object'){if(Array.isArray(child))child.forEach(scan);else scan(child);}};scan(capture);if(files.size)warnings.add('FILE_BYTES_REQUIRE_BACKUP');
   const titles=(ds:any)=>(ds.schema?.title??[]).map((t:any)=>t.plain_text??t.text?.content??'').join('');
   const count=(name:string)=>Object.values(capture.data_sources).filter(ds=>titles(ds)===name).reduce((n,ds)=>n+(ds.records?.length??0),0);
   const report:MigrationSnapshotView={id:receipt.id,project_key:route.project_key,source_workspace_id:source.id,target_workspace_id:route.workspace_id,route_revision:route.revision,root_page_id:route.root_page.id,captured_at:capture.retrieved_at,snapshot_sha256:receipt.sha256,backup_verified:true,status:'Needs review',route_current:true,can_execute:false,
    counts:{pages:Object.keys(capture.pages).length,blocks:blocks.length,databases:Object.keys(capture.databases??{}).length,data_sources:Object.keys(capture.data_sources).length,records:records.length,issues:count('Issues'),releases:count('Releases'),files:files.size,views:Object.values(payload.extras?.views??{}).reduce((n:number,items:any)=>n+(Array.isArray(items)?items.length:0),0)},warnings:[...warnings]};
   this.store.db.prepare('INSERT OR IGNORE INTO source_capture_previews(id,project_key,created_at,report) VALUES(?,?,?,?)').run(report.id,report.project_key,receipt.created_at,JSON.stringify(report));return result(report,source.id);
  }catch(error){return result<MigrationSnapshotView>(null,null,error instanceof z.ZodError?'INVALID_INPUT':'LOCAL_SAVE_FAILED',['The encrypted source evidence could not be verified. No preview was registered.']);}
 }
 list():MigrationSnapshotView[]{
  const latest=new Map<string,MigrationSnapshotView>();
  for(const row of this.store.db.prepare('SELECT report FROM source_capture_previews ORDER BY created_at DESC,rowid DESC').all()){
   const report=JSON.parse(String(row.report)) as MigrationSnapshotView;if(latest.has(report.project_key))continue;
   const route=this.store.projects().find(p=>p.project_key===report.project_key),current=Boolean(route&&route.revision===report.route_revision&&route.workspace_id===report.target_workspace_id&&route.root_page.id===report.root_page_id);
   latest.set(report.project_key,{...report,route_current:current,status:current?'Needs review':'Route changed'});
  }return[...latest.values()].sort((a,b)=>a.project_key.localeCompare(b.project_key));
 }
}
