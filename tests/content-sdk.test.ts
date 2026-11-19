import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {OfficialNotionAdapter} from '../apps/server/src/notion/adapter.js';
import {richText} from '../apps/server/src/notion/content-adapter.js';
it('verifies mention identity instead of its server-resolved display text',async()=>{
 const page=randomUUID(),block=randomUUID(),mentioned=randomUUID();let wrong=false;
 const adapter=new OfficialNotionAdapter(randomUUID(),async(input,init)=>{const request=new Request(input,init);if(request.method==='PATCH')return Response.json({results:[{id:block}]});return Response.json(request.url.endsWith(block)?{id:block,type:'paragraph',in_trash:false,paragraph:{rich_text:[{type:'mention',mention:{type:'page',page:{id:wrong?randomUUID():mentioned}},plain_text:'Resolved title'}]}}:{id:page});});
 const op={kind:'append_blocks' as const,page_id:page,expected_last_edited_time:'before',blocks:[{object:'block',type:'paragraph',paragraph:{rich_text:[{type:'mention',mention:{type:'page',page:{id:mentioned}}}]}}]};
 expect((await adapter.content.apply(op,()=>{})).readback_verified).toBe(true);wrong=true;await expect(adapter.content.apply(op,()=>{})).rejects.toMatchObject({code:'READBACK_FAILED'});
});
it('accepts equivalent rich-text chunking but rejects a changed link or formatting',async()=>{
 const page=randomUUID(),block=randomUUID();let wrongLink=false,wrongStyle=false;
 const adapter=new OfficialNotionAdapter(randomUUID(),async(input,init)=>{const request=new Request(input,init);if(request.method==='PATCH')return Response.json({results:[{id:block}]});return Response.json(request.url.endsWith(block)?{id:block,type:'paragraph',in_trash:false,paragraph:{rich_text:[{type:'text',text:{content:'same text',link:{url:wrongLink?'https://wrong.example':'https://example.com'}},annotations:{bold:wrongStyle}}]}}:{id:page});});
 const op={kind:'append_blocks' as const,page_id:page,expected_last_edited_time:'before',blocks:[{object:'block',type:'paragraph',paragraph:{rich_text:['same ','text'].map(content=>({type:'text',text:{content,link:{url:'https://example.com'}}}))}}]};
 expect((await adapter.content.apply(op,()=>{})).readback_verified).toBe(true);wrongLink=true;await expect(adapter.content.apply(op,()=>{})).rejects.toMatchObject({code:'READBACK_FAILED'});wrongLink=false;wrongStyle=true;await expect(adapter.content.apply(op,()=>{})).rejects.toMatchObject({code:'READBACK_FAILED'});
});
it('omits null response-only paragraph icons without changing the journaled block request',async()=>{
 const page=randomUUID(),block=randomUUID();let body:any;
 const source:any={object:'block',type:'paragraph',paragraph:{rich_text:richText('Outer'),icon:null,children:[{object:'block',type:'paragraph',paragraph:{rich_text:richText('Child'),icon:null}},{object:'block',type:'paragraph',paragraph:{rich_text:richText('Icon'),icon:{type:'emoji',emoji:'🌀'}}}]}};
 const adapter=new OfficialNotionAdapter(randomUUID(),async(input,init)=>{const request=new Request(input,init);if(request.method==='PATCH'){body=await request.json();return Response.json({results:[{id:block}]});}return Response.json(request.url.endsWith(block)?{id:block,type:'paragraph',paragraph:{rich_text:richText('Outer')},in_trash:false}:{id:page,object:'page'});});
 expect((await adapter.content.apply({kind:'append_blocks',page_id:page,expected_last_edited_time:'before',blocks:[source]},()=>{})).readback_verified).toBe(true);
 expect(body.children[0].paragraph).not.toHaveProperty('icon');expect(body.children[0].paragraph.children[0].paragraph).not.toHaveProperty('icon');expect(body.children[0].paragraph.children[1].paragraph.icon).toEqual({type:'emoji',emoji:'🌀'});expect(source.paragraph.icon).toBeNull();
});
it('accepts equivalent explicit datetime offsets while rejecting a different instant',async()=>{
 const page=randomUUID();let shifted=false;
 const expected={Name:{title:richText('Example')},When:{date:{start:'2030-01-01T10:00:00.000Z',end:'2030-01-01T12:00:00.000Z'}}};
 const adapter=new OfficialNotionAdapter(randomUUID(),async()=>Response.json({object:'page',id:page,in_trash:false,properties:{Name:{type:'title',title:richText('Example')},When:{type:'date',date:{start:shifted?'2030-01-01T10:00:01.000+00:00':'2030-01-01T10:00:00.000+00:00',end:'2030-01-01T14:00:00.000+02:00',time_zone:null}}}}));
 const op={kind:'create_record' as const,data_source_id:randomUUID(),properties:expected,text:''};
 expect((await adapter.content.apply(op,()=>{})).readback_verified).toBe(true);shifted=true;await expect(adapter.content.apply(op,()=>{})).rejects.toMatchObject({code:'READBACK_FAILED'});
});
it('keeps calendar dates distinct from midnight timestamps during readback',async()=>{
 const page=randomUUID(),adapter=new OfficialNotionAdapter(randomUUID(),async()=>Response.json({object:'page',id:page,in_trash:false,properties:{When:{type:'date',date:{start:'2030-01-01T00:00:00.000Z',end:null,time_zone:null}}}}));
 await expect(adapter.content.apply({kind:'create_record',data_source_id:randomUUID(),properties:{When:{date:{start:'2030-01-01'}}},text:''},()=>{})).rejects.toMatchObject({code:'READBACK_FAILED'});
});
it('preserves a copied emoji icon and refuses an unverified icon',async()=>{
 const page=randomUUID();let body:any,wrong=false;
 const adapter=new OfficialNotionAdapter(randomUUID(),async(input,init)=>{const request=new Request(input,init);if(request.method==='POST')body=await request.json();return Response.json({object:'page',id:page,in_trash:false,properties:{title:{type:'title',title:richText('Project')}},icon:{type:'emoji',emoji:wrong?'❓':'🌀'}});});
 const operation={kind:'create_page' as const,parent_page_id:randomUUID(),title:'Project',text:'',icon:{type:'emoji' as const,emoji:'🌀'}};
 expect((await adapter.content.apply(operation,()=>{})).readback_verified).toBe(true);expect(body.icon).toEqual(operation.icon);wrong=true;await expect(adapter.content.apply(operation,()=>{})).rejects.toMatchObject({code:'READBACK_FAILED'});
});
it('keeps Unicode characters intact at rich-text chunk boundaries',()=>{const text='x'.repeat(1999)+'😀'+'尾'.repeat(2100),parts=richText(text);expect(parts.map(p=>p.text.content).join('')).toBe(text);expect(parts.every(p=>p.text.content.length<=2000&&!/[\uD800-\uDBFF]$/.test(p.text.content)&&! /^[\uDC00-\uDFFF]/.test(p.text.content))).toBe(true);});

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
