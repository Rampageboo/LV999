import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '@modelcontextprotocol/client';
import {InMemoryTransport} from '@modelcontextprotocol/server';
import {Store} from '../apps/server/src/infra/store.js';
import {Service} from '../apps/server/src/core/service.js';
import {DomainError} from '../apps/server/src/notion/adapter.js';
import {createMcpServer} from '../apps/server/src/mcp/server.js';
import type {MutationOp,MutationResult} from '../packages/contracts/src/content.js';
const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const done of cleanup.splice(0).reverse())await done();});
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'lv999-board-')),store=new Store(dir),workspace=randomUUID(),root=randomUUID(),pages=new Map<string,any>(),blocks=new Map<string,any[]>();let tick=0,unknown=false,hold:Promise<void>|null=null;
 const version=()=>new Date(Date.now()+ ++tick*1000).toISOString();
 store.add({id:workspace,label:'Production project',environment:'production'});pages.set(root,{object:'page',id:root,parent:{type:'workspace'},in_trash:false,last_edited_time:version(),properties:{title:{type:'title',title:[{plain_text:'Project root'}]}}});blocks.set(root,[]);
 store.saveProject({project_key:'P',name:'Project',workspace_id:workspace,root_page_id:root,expected_revision:0},{id:root,workspace_id:workspace,title:'Project root',url:'https://app.notion.com/',parent_kind:'workspace',root_eligible:true,root_reason:null,last_edited_time:null});
 const resource=async(_kind:string,id:string)=>{if(!pages.has(id))throw new DomainError('NOT_FOUND_OR_NOT_SHARED','Not shared');return structuredClone(pages.get(id));};
 const apply=vi.fn(async(op:MutationOp,known:(r:MutationResult)=>void)=>{
  if(hold)await hold;if(unknown)throw new Error('Unknown transport outcome');let id:string;
  if(op.kind==='create_page'){id=randomUUID();pages.set(id,{object:'page',id,parent:{type:'page_id',page_id:op.parent_page_id},in_trash:false,last_edited_time:version(),properties:{title:{type:'title',title:[{plain_text:op.title}]}}});blocks.set(id,[{id:randomUUID(),type:'paragraph',paragraph:{rich_text:[{text:{content:op.text}}]}}]);}
  else if(op.kind==='append_blocks'){id=op.page_id;blocks.get(id)!.push(...op.blocks.map(b=>({...b,id:randomUUID()})));pages.get(id).last_edited_time=version();}
  else throw new Error('Unexpected operation');
  const result:MutationResult={id,url:`https://app.notion.com/p/${id.replaceAll('-','')}`,kind:op.kind,last_edited_time:pages.get(id).last_edited_time,readback_verified:false,details:{}};known(result);return{...result,readback_verified:true};
 });
 const content={resource,children:async(id:string)=>({results:blocks.get(id),has_more:false,next_cursor:null}),read:async(input:any)=>({page:await resource('page',input.resource_id),blocks:{results:structuredClone(blocks.get(input.resource_id)??[]),has_more:false,next_cursor:null},warnings:[]}),apply,verify:async(_op:any,r:any)=>({...r,readback_verified:true})};
 const vault={read:vi.fn(async()=>workspace),write:vi.fn(),remove:vi.fn(),probe:async()=>true},bridge={run:vi.fn()},service=new Service(store,vault,()=>({identity:async()=>({workspace_id:workspace,workspace_name:'Production project',bot_id:randomUUID()}),search:async()=>({results:[],has_more:false,next_cursor:null}),page:id=>resource('page',id),content}),{bridge});
 cleanup.push(async()=>{service.wake.shutdown();store.close();rmSync(dir,{recursive:true,force:true});});
 const setup=()=>service.boards.setup({project_key:'P',route_revision:1});
 const post=(actor:'claude'|'codex'='claude',extra:object={})=>service.boards.post({project_key:'P',text:'A message',idempotency_key:randomUUID(),...extra},actor,['P']);
 return{store,service,workspace,root,pages,blocks,apply,vault,bridge,setup,post,setUnknown:()=>{unknown=true;},hold:(p:Promise<void>|null)=>{hold=p;}};
}
it('creates one ordinary board under the exact root without enabling global production writes',async()=>{
 const f=fixture(),a=await f.setup(),b=await f.setup();expect(a.ok).toBe(true);expect(b.data!.page_id).toBe(a.data!.page_id);expect(f.apply).toHaveBeenCalledTimes(1);expect(f.service.content.enabled(f.workspace)).toBe(false);expect(f.pages.get(a.data!.page_id).parent.page_id).toBe(f.root);expect(f.service.snapshot().workspaces[0].board_append_projects).toEqual(['P']);expect(f.service.snapshot().settings.read_only).toBe(false);
});
it('allows only plain-text board append and deduplicates identical retry keys',async()=>{
 const f=fixture(),board=(await f.setup()).data!,key=randomUUID();
 const a=await f.post('claude',{text:'@Codex is plain board text',idempotency_key:key}),b=await f.post('claude',{text:'@Codex is plain board text',idempotency_key:key});expect(a.ok).toBe(true);expect(b.data?.id).toBe(a.data?.id);expect(f.apply).toHaveBeenCalledTimes(2);
 expect((await f.post('claude',{text:'Changed',idempotency_key:key})).code).toBe('IDEMPOTENCY_CONFLICT');
 expect(f.blocks.get(board.page_id)![1].heading_3.rich_text[0].text.content).toContain('Claude');
 expect(f.store.db.prepare('SELECT count(*) AS n FROM wake_requests').get()!.n).toBe(0);f.service.wake.tick();expect(f.bridge.run).not.toHaveBeenCalled();
 expect((await f.service.content.execute({target:{workspace_id:f.workspace},operation:{kind:'create_page',parent_page_id:f.root,title:'Not permitted',text:''},idempotency_key:randomUUID()},{actor:'claude',write_workspace_ids:[f.workspace]})).code).toBe('WRITE_DISABLED');
});
it('denies ungranted projects, paused posting, moved boards and changed routes',async()=>{
 const f=fixture(),board=(await f.setup()).data!;f.vault.read.mockClear();
 expect((await f.service.boards.read({project_key:'P'},[])).code).toBe('CONTENT_ACCESS_DENIED');expect(f.vault.read).not.toHaveBeenCalled();
 f.service.boards.setPosting({project_key:'P',enabled:false});expect((await f.post()).code).toBe('WRITE_DISABLED');expect((await f.service.boards.read({project_key:'P'},['P'])).ok).toBe(true);
 f.service.boards.setPosting({project_key:'P',enabled:true});f.pages.get(board.page_id).parent.page_id=randomUUID();expect((await f.post()).code).toBe('CONTENT_CONFLICT');f.pages.get(board.page_id).parent.page_id=f.root;
 f.store.saveProject({project_key:'P',name:'Changed',workspace_id:f.workspace,root_page_id:f.root,expected_revision:1},{id:f.root,workspace_id:f.workspace,title:'Root',url:'https://app.notion.com/',parent_kind:'workspace',root_eligible:true,root_reason:null,last_edited_time:null});expect((await f.post()).code).toBe('ROUTE_CONFLICT');
 expect(f.apply).toHaveBeenCalledTimes(1);
});
it('keeps both writers messages when busy appends are retried with the same key',async()=>{
 const f=fixture(),board=(await f.setup()).data!;let release!:()=>void;f.hold(new Promise<void>(r=>{release=r;}));const first=f.post('claude',{text:'First'});await vi.waitFor(()=>expect(f.apply).toHaveBeenCalledTimes(2));
 const key=randomUUID();expect((await f.post('codex',{text:'Second',idempotency_key:key})).code).toBe('MUTATION_BUSY');release();expect((await first).ok).toBe(true);f.hold(null);
 expect((await f.post('codex',{text:'Second',idempotency_key:key})).ok).toBe(true);const content=JSON.stringify(f.blocks.get(board.page_id));expect(content).toContain('First');expect(content).toContain('Second');expect(f.apply).toHaveBeenCalledTimes(3);
});
it('does not repeat unknown posts or save message bodies in its retry metadata',async()=>{
 const f=fixture();await f.setup();f.setUnknown();const key=randomUUID(),text='Private message body';expect((await f.post('claude',{text,idempotency_key:key})).code).toBe('MUTATION_OUTCOME_UNKNOWN');expect((await f.post('claude',{text,idempotency_key:key})).code).toBe('MUTATION_OUTCOME_UNKNOWN');expect(f.apply).toHaveBeenCalledTimes(2);expect(JSON.stringify(f.store.db.prepare('SELECT * FROM board_posts').all())).not.toContain(text);
});
it('board-only MCP exposes exactly three tools, excludes wake/general writes and enforces its role/scope',async()=>{
 const f=fixture();await f.setup();const server=createMcpServer(f.service,{actor:'claude',workspace_ids:[]},[],undefined,[],false,['P'],true),client=new Client({name:'board-unit',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);cleanup.push(async()=>{await client.close();await server.close();});
 expect((await client.listTools()).tools.map(t=>t.name).sort()).toEqual(['list_message_boards','post_message_board','read_message_board']);
 const call=async(name:string,args:Record<string,unknown>)=>JSON.parse(((await client.callTool({name,arguments:args})).content as {text:string}[])[0].text);
 expect((await call('post_message_board',{project_key:'P',text:'MCP append',idempotency_key:randomUUID()})).ok).toBe(true);expect((await call('read_message_board',{project_key:'OTHER'})).code).toBe('CONTENT_ACCESS_DENIED');
 const escaped=await client.callTool({name:'post_message_board',arguments:{project_key:'P',text:'Cannot choose a foreign page',idempotency_key:randomUUID(),page_id:randomUUID()}});expect(escaped.isError).toBe(true);
});
