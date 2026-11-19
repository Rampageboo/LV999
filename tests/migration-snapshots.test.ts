import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../apps/server/src/infra/store.js';
import {MigrationSnapshots} from '../apps/server/src/core/migration-snapshots.js';
import {pageMetadata} from '../apps/server/src/notion/page-metadata.js';

it('registers only authenticated matching source evidence and derives counts without accepting claimed success',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lv999-migration-preview-')),store=new Store(directory),source=randomUUID(),target=randomUUID(),root=randomUUID(),page=randomUUID(),block=randomUUID(),secrets=new Map<string,string>();
 const vault={read:async(id:string)=>secrets.get(id)??null,write:async(id:string,secret:string)=>{secrets.set(id,secret);},remove:async()=>{},probe:async()=>true};
 try{
  store.add({id:source,label:'Vibecode',environment:'production',access_role:'source'});store.add({id:target,label:'Target',environment:'test'});
  const rootPage=pageMetadata({id:root,object:'page',properties:{title:{type:'title',title:[{plain_text:'Project'}]}},parent:{type:'workspace'},in_trash:false,last_edited_time:new Date().toISOString()},target)!;
  store.saveProject({project_key:'QA',name:'Project',workspace_id:target,root_page_id:root,expected_revision:0},rootPage);
  const previews=new MigrationSnapshots(store,vault),payload={kind:'project-source-capture',project_key:'QA',source_workspace_id:source,target_workspace_id:target,claimed_success:true,claimed_copied_objects:9000,capture:{retrieved_at:new Date().toISOString(),pages:{[page]:{id:page}},children:{[page]:[{id:block,type:'paragraph'}]},data_sources:{},databases:{},warnings:[]}};
  const receipt=await previews.backups.save(payload),registered=await previews.register(receipt);
  expect(registered.ok).toBe(true);expect(registered.data).toMatchObject({can_execute:false,status:'Needs review',backup_verified:true,counts:{pages:1,blocks:1,records:0}});expect(registered.data!.warnings).toContain('COMMENTS_UNAVAILABLE');expect(JSON.stringify(registered.data)).not.toContain('9000');
  const mismatch=await previews.backups.save({...payload,target_workspace_id:randomUUID()});expect((await previews.register(mismatch)).code).toBe('WORKSPACE_MISMATCH');expect(previews.list()).toHaveLength(1);
  expect((await previews.register({...receipt,sha256:'0'.repeat(64)})).ok).toBe(false);
  store.saveProject({project_key:'QA',name:'Project',workspace_id:target,root_page_id:root,expected_revision:1},rootPage);expect(previews.list()[0]).toMatchObject({status:'Route changed',route_current:false,can_execute:false});
 }finally{store.close();await rm(directory,{recursive:true,force:true});}
});
