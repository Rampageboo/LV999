import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '@modelcontextprotocol/client';
import {InMemoryTransport} from '@modelcontextprotocol/server';
import {Store} from '../apps/server/src/infra/store.js';
import {Service} from '../apps/server/src/core/service.js';
import {createMcpServer} from '../apps/server/src/mcp/server.js';
const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const done of cleanup.splice(0).reverse())await done();});
async function fixture(reads?:'production'|'none'){
 const directory=mkdtempSync(join(tmpdir(),'lv999-read-scope-')),store=new Store(directory),test=randomUUID(),production=randomUUID();
 store.add({id:test,label:'Test',environment:'test'});store.add({id:production,label:'Production target',environment:'production'});
 const vault={read:vi.fn(async(id:string)=>id),write:vi.fn(),remove:vi.fn(),probe:async()=>true};
 const service=new Service(store,vault,token=>({identity:async()=>({workspace_id:token,workspace_name:token===test?'Test':'Production target',bot_id:randomUUID()}),search:async()=>({results:[],has_more:false,next_cursor:null}),page:async id=>({object:'page',id})}));
 const server=createMcpServer(service,undefined,[production],undefined,reads==='production'?[production]:reads==='none'?[]:undefined),client=new Client({name:'scope-unit',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
 await server.connect(b);await client.connect(a);cleanup.push(async()=>{await client.close();await server.close();store.close();rmSync(directory,{recursive:true,force:true});});
 const call=async(name:string,args:Record<string,unknown>={})=>{const response=await client.callTool({name,arguments:args});return JSON.parse((response.content as {text:string}[])[0].text);};
 return{store,service,vault,test,production,call};
}
it('legacy unscoped MCP profiles cannot discover/read/write newly registered production targets',async()=>{
 const f=await fixture();expect((await f.call('list_workspaces')).data.map((w:any)=>w.id)).toEqual([f.test]);f.vault.read.mockClear();
 expect((await f.call('get_page',{workspace_id:f.production,page_id:randomUUID()})).code).toBe('CONTENT_ACCESS_DENIED');
 expect((await f.call('get_page_tree',{workspace_id:f.production,resource_id:randomUUID()})).code).toBe('CONTENT_ACCESS_DENIED');
 expect((await f.call('create_page',{target:{workspace_id:f.production},parent_page_id:randomUUID(),title:'Denied',text:'',idempotency_key:randomUUID()})).code).toBe('WRITE_ACCESS_DENIED');expect(f.vault.read).not.toHaveBeenCalled();
});
it('an explicit production read scope exposes only that target and does not enable its writes',async()=>{
 const f=await fixture('production');expect((await f.call('list_workspaces')).data.map((w:any)=>w.id)).toEqual([f.production]);
 expect((await f.call('search_workspace',{workspace_id:f.production,query:''})).ok).toBe(true);expect((await f.call('get_page',{workspace_id:f.test,page_id:randomUUID()})).code).toBe('CONTENT_ACCESS_DENIED');
 expect((await f.call('create_page',{target:{workspace_id:f.production},parent_page_id:randomUUID(),title:'Denied',text:'',idempotency_key:randomUUID()})).code).toBe('WRITE_DISABLED');
});
it('an explicitly empty read scope denies content access to every environment',async()=>{
 const f=await fixture('none');expect((await f.call('list_workspaces')).data).toEqual([]);expect((await f.call('search_all',{query:''})).data).toEqual([]);expect(f.vault.read).not.toHaveBeenCalled();
});
