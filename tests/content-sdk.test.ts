import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {OfficialNotionAdapter} from '../apps/server/src/notion/adapter.js';

it('sends recoverable deletion through the pinned SDK and checks the returned target',async()=>{
  const page=randomUUID(),calls:Request[]=[];
  const adapter=new OfficialNotionAdapter(randomUUID(),async(input,init)=>{const request=new Request(input,init);calls.push(request);return Response.json({object:'page',id:page,in_trash:true,last_edited_time:'now'});});
  const result=await adapter.content.apply({kind:'trash_page',page_id:page,expected_last_edited_time:'before'},()=>{});
  expect(result.readback_verified).toBe(true);expect(calls.map(r=>r.method)).toEqual(['PATCH','GET']);
  expect(calls[0].url).toBe(`https://api.notion.com/v1/pages/${page}`);expect(await calls[0].json()).toEqual({in_trash:true});
});
it('includes the owning database when creating a filtered view',async()=>{
  const source=randomUUID(),database=randomUUID(),view=randomUUID();let body:any;
  const adapter=new OfficialNotionAdapter(randomUUID(),async(input,init)=>{const request=new Request(input,init);if(request.method==='POST')body=await request.json();return Response.json({object:'view',id:view,name:'Open',type:'table'});});
  const filter={property:'State',select:{equals:'Open'}};
  expect((await adapter.content.apply({kind:'create_view',data_source_id:source,name:'Open',view_type:'table',filter},()=>{},{parent:{database_id:database}})).readback_verified).toBe(true);
  expect(body).toMatchObject({database_id:database,data_source_id:source,name:'Open',type:'table',filter});
});
it('keeps an accepted ID before readback fails and never claims a different resource was verified',async()=>{
  const page=randomUUID(),other=randomUUID();let known:any;
  const adapter=new OfficialNotionAdapter(randomUUID(),async(input,init)=>Response.json(new Request(input,init).method==='POST'?{object:'page',id:page}:{object:'page',id:other,in_trash:false}));
  await expect(adapter.content.apply({kind:'create_page',parent_page_id:randomUUID(),title:'New',text:''},value=>{known=value;})).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  expect(known).toMatchObject({id:page,readback_verified:false});
});
it('reports nested children and pagination as incomplete instead of claiming a full tree',async()=>{
  const page=randomUUID(),block=randomUUID();
  const adapter=new OfficialNotionAdapter(randomUUID(),async(input,init)=>{const request=new Request(input,init);return Response.json(request.url.includes('/children')?{results:[{id:block,type:'paragraph',has_children:true}],has_more:true,next_cursor:'remaining'}:{object:'page',id:page,in_trash:false});});
  const read:any=await adapter.content.read({workspace_id:randomUUID(),kind:'page_tree',resource_id:page,max_depth:0});
  expect(read.blocks.has_more).toBe(true);expect(read.blocks.next_cursor).toBe('remaining');expect(read.warnings.length).toBeGreaterThan(0);
});
