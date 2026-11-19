import type { Client } from '@notionhq/client';
import type { ContentRead, MutationOp, MutationResult } from '../../../../packages/contracts/src/content.js';
import { createHash } from 'node:crypto';
import { DomainError } from './adapter.js';

export interface ContentAdapter {
  resource(kind:'page'|'block'|'database'|'data_source'|'view'|'upload',id:string):Promise<any>;
  children(id:string,cursor?:string):Promise<any>;
  comments?(id:string,cursor?:string):Promise<any>;
  property?(pageId:string,propertyId:string,cursor?:string):Promise<any>;
  read(input:ContentRead):Promise<unknown>;
  apply(op:MutationOp,known:(result:MutationResult)=>void,resource?:any):Promise<MutationResult>;
  verify(op:MutationOp,result:MutationResult):Promise<MutationResult>;
}
export const richText=(text:string)=>{
  const parts:{type:'text';text:{content:string}}[]=[];
  for(let start=0;start<text.length;){let end=Math.min(start+2000,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;parts.push({type:'text',text:{content:text.slice(start,end)}});start=end;}
  return parts;
};
const paragraphs=(text:string)=>text?text.split('\n').map(line=>({object:'block' as const,type:'paragraph' as const,paragraph:{rich_text:richText(line)}})):[];
function writableBlock(block:any):any{
  const body={...block[block.type]};
  // Current read responses include paragraph.icon=null; the create API expects omission for no icon.
  if(block.type==='paragraph'&&body.icon===null)delete body.icon;
  if(block.type==='numbered_list_item'&&body.list_format==='numbers')delete body.list_format;
  if(Array.isArray(body.children))body.children=body.children.map(writableBlock);
  return{...block,[block.type]:body};
}
function readableBlock(block:any):any{
  return block?.type==='numbered_list_item'&&block.numbered_list_item&&!('list_format'in block.numbered_list_item)?{...block,numbered_list_item:{...block.numbered_list_item,list_format:'numbers'}}:block;
}
const textOf=(parts:any[])=>parts.map(part=>part.plain_text??part.text?.content??'').join('');
const comparableDate=(value:unknown)=>typeof value==='string'&&/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():value;
function comparableRichText(parts:any[]){
  const result:any[]=[];
  for(const part of parts??[]){
    const annotations={bold:false,italic:false,strikethrough:false,underline:false,code:false,color:'default',...part.annotations};
    let item:any;const type=part.type??(part.mention?'mention':part.equation?'equation':'text');
    if(type==='text')item={type,text:part.text?.content??part.plain_text??'',link:part.text?.link?.url??null,annotations};
    else if(type==='mention'){
      const mention=part.mention??{},kind=mention.type??['page','database','user','date','custom_emoji','template_mention'].find(k=>k in mention),value=mention[kind];
      item={type,mention:kind==='date'?{type:kind,start:comparableDate(value?.start),end:comparableDate(value?.end??null),time_zone:value?.time_zone??null}:['page','database','user','custom_emoji'].includes(kind)?{type:kind,id:value?.id}:{type:kind,value},annotations};
    }else item={type,equation:part.equation?.expression??null,annotations};
    const prior=result.at(-1);
    if(type==='text'&&prior?.type==='text'&&prior.link===item.link&&JSON.stringify(prior.annotations)===JSON.stringify(item.annotations))prior.text+=item.text;
    else result.push(item);
  }return result;
}
function comparable(value:any):unknown {
  if(!value||typeof value!=='object')return value;
  const kind=value.type??['title','rich_text','relation','files','people','select','multi_select','status','number','checkbox','date','url','email','phone_number'].find(key=>key in value);
  const data=value[kind];
  if(['title','rich_text'].includes(kind))return comparableRichText(data??[]);
  if(['relation','people'].includes(kind))return [...new Set((data??[]).map((item:any)=>item.id))].sort();
  if(kind==='files')return (data??[]).map((item:any)=>item.name??'').sort();
  if(kind==='multi_select')return (data??[]).map((item:any)=>item.name??item.id).sort();
  if(['select','status'].includes(kind))return data?.name??data?.id??null;
  if(kind==='date')return data?{start:comparableDate(data.start),end:comparableDate(data.end??null),time_zone:data.time_zone??null}:null;
  return data;
}
function propertiesMatch(actual:any,expected:Record<string,unknown>){
  return Object.entries(expected).every(([key,value])=>{
    const found=actual?.[key]??Object.values(actual??{}).find((p:any)=>p.id===key);
    return found!==undefined&&JSON.stringify(comparable(found))===JSON.stringify(comparable(value));
  });
}
export class OfficialContentAdapter implements ContentAdapter {
  constructor(private client:Client){}
  async resource(kind:'page'|'block'|'database'|'data_source'|'view'|'upload',id:string):Promise<any>{
    let value:any;
    switch(kind){
      case'page':value=await this.client.pages.retrieve({page_id:id});break;
      case'block':value=await this.client.blocks.retrieve({block_id:id});break;
      case'database':value=await this.client.databases.retrieve({database_id:id});break;
      case'data_source':value=await this.client.dataSources.retrieve({data_source_id:id});break;
      case'view':value=await this.client.views.retrieve({view_id:id});break;
      case'upload':value=await this.client.fileUploads.retrieve({file_upload_id:id});break;
    }
    if(value?.id?.toLowerCase()!==id.toLowerCase())throw new DomainError('INVALID_RESPONSE','Notion returned a different resource ID.');return kind==='block'?readableBlock(value):value;
  }
  async children(id:string,cursor?:string){const batch=await this.client.blocks.children.list({block_id:id,page_size:100,start_cursor:cursor});return{...batch,results:batch.results.map(readableBlock)};}
  comments(id:string,cursor?:string){return this.client.comments.list({block_id:id,page_size:100,start_cursor:cursor});}
  property(pageId:string,propertyId:string,cursor?:string){return this.client.pages.properties.retrieve({page_id:pageId,property_id:propertyId,page_size:100,start_cursor:cursor});}
  async read(input:ContentRead){
    const id=input.resource_id;
    if(input.kind==='databases')return this.client.search({page_size:50,start_cursor:input.start_cursor,filter:{property:'object',value:'data_source'}});
    if(!id)throw new DomainError('INVALID_INPUT','Select an exact resource.');
    if(input.kind==='database'){const database=await this.resource('database',id),data_sources=[];for(const source of database.data_sources??[])data_sources.push(await this.resource('data_source',source.id));return{database,data_sources,views:await this.client.views.list({database_id:id,page_size:50})};}
    if(input.kind==='data_source')return this.resource('data_source',id);
    if(input.kind==='query')return this.client.dataSources.query({data_source_id:id,page_size:50,start_cursor:input.start_cursor,...(input.filter?{filter:input.filter as any}:{})});
    if(input.kind==='markdown')return this.client.pages.retrieveMarkdown({page_id:id});
    if(input.kind==='views')return this.client.views.list({data_source_id:id,page_size:50,start_cursor:input.start_cursor});
    if(input.kind==='block_children')return this.children(id,input.start_cursor);
    let count=0;const warnings:string[]=[];
    const walk=async(blockId:string,depth:number,cursor?:string):Promise<any>=>{
      const batch=await this.children(blockId,cursor);const results=[];
      for(const candidate of batch.results){
        const block:any=candidate;
        if(++count>300){warnings.push('Tree limit reached; continue through bounded child batches.');break;}
        const item:any={...block};
        if(block.has_children&&depth<input.max_depth)item.children=await walk(block.id,depth+1);
        else if(block.has_children)warnings.push('Some child blocks remain below the selected depth.');
        if(!block.type||block.type==='unsupported')warnings.push('Unsupported or partial block returned by Notion.');
        results.push(item);
      }
      return{results,has_more:batch.has_more,next_cursor:batch.next_cursor,truncated:count>300};
    };
    const page=await this.resource('page',id);
    return{page,blocks:page.in_trash?{results:[],has_more:false,next_cursor:null}:await walk(id,0,input.start_cursor),warnings:page.in_trash?['This page is in trash; restore it to edit.']:warnings};
  }
  private result(op:MutationOp,raw:any,details:Record<string,unknown>={}):MutationResult{
    return{id:raw.id,url:raw.url??null,last_edited_time:raw.last_edited_time??null,kind:op.kind,readback_verified:false,details};
  }
  async apply(op:MutationOp,known:(result:MutationResult)=>void,resource?:any):Promise<MutationResult>{
    let raw:any;let details:Record<string,unknown>={};
    switch(op.kind){
      case'create_page':raw=await this.client.pages.create({parent:{page_id:op.parent_page_id},properties:{title:{title:richText(op.title)}},children:paragraphs(op.text),...(op.icon?{icon:op.icon as any}:{})});break;
      case'update_page':{
        const current=resource??await this.resource('page',op.page_id);
        const titleKey=Object.entries(current.properties??{}).find(([,p]:any)=>p.type==='title')?.[0]??'title';
        raw=await this.client.pages.update({page_id:op.page_id,properties:{...op.properties,...(op.title?{[titleKey]:{title:richText(op.title)}}:{})} as any});break;
      }
      case'create_record':raw=await this.client.pages.create({parent:{type:'data_source_id',data_source_id:op.data_source_id},properties:op.properties as any,children:paragraphs(op.text),...(op.icon?{icon:op.icon as any}:{})});break;
      case'update_record':raw=await this.client.pages.update({page_id:op.page_id,properties:op.properties as any});break;
      case'append_blocks':{
        const appended=await this.client.blocks.children.append({block_id:op.page_id,children:op.blocks.map(writableBlock) as any});
        raw={id:op.page_id};details={block_ids:appended.results.map(b=>b.id)};break;
      }
      case'update_block':raw=await this.client.blocks.update({...op.body,block_id:op.block_id} as any);break;
      case'delete_block':raw=await this.client.blocks.delete({block_id:op.block_id});break;
      case'trash_page':case'restore_page':raw=await this.client.pages.update({page_id:op.page_id,in_trash:op.kind==='trash_page'});break;
      case'create_database':raw=await this.client.databases.create({parent:{type:'page_id',page_id:op.parent_page_id},title:richText(op.title),initial_data_source:{properties:op.properties as any}});details={data_source_ids:raw.data_sources?.map((d:any)=>d.id)??[]};break;
      case'create_data_source':raw=await this.client.dataSources.create({parent:{type:'database_id',database_id:op.database_id},title:richText(op.title),properties:op.properties as any});break;
      case'update_data_source':raw=await this.client.dataSources.update({data_source_id:op.data_source_id,properties:op.properties as any,...(op.title?{title:richText(op.title)}:{})});break;
      case'create_view':{
        const source=resource??await this.resource('data_source',op.data_source_id);
        raw=await this.client.views.create({database_id:source.parent.database_id,data_source_id:op.data_source_id,name:op.name,type:op.view_type,...(op.filter?{filter:op.filter as any}:{})});break;
      }
      case'upload_file':{
        const bytes=Buffer.from(op.base64,'base64');
        const upload=await this.client.fileUploads.create({mode:'single_part',filename:op.filename,content_type:op.content_type});
        details={file_upload_id:upload.id,filename:op.filename,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),stage:'upload_created'};
        known(this.result(op,upload,details));
        await this.client.fileUploads.send({file_upload_id:upload.id,file:{data:new Blob([bytes],{type:op.content_type}),filename:op.filename}});
        details={...details,stage:'uploaded'};known(this.result(op,upload,details));
        const attached=await this.client.blocks.children.append({block_id:op.page_id,children:[{object:'block',type:'file',file:{type:'file_upload',file_upload:{id:upload.id},name:op.filename}}]});
        raw=attached.results[0];details={...details,block_id:raw.id,stage:'attached'};break;
      }
    }
    const result=this.result(op,raw,details);known(result);
    return this.verify(op,result);
  }
  async verify(op:MutationOp,result:MutationResult):Promise<MutationResult>{
    let raw:any,okay=false;
    if(op.kind==='append_blocks'){
      const ids=result.details.block_ids as string[];okay=ids?.length===op.blocks.length;
      if(okay)for(let i=0;i<ids.length;i++){const block=await this.resource('block',ids[i]);const expected=op.blocks[i] as any;if(block.in_trash||block.type!==expected.type||('rich_text'in(expected[expected.type]??{})&&JSON.stringify(comparableRichText(block[block.type]?.rich_text??[]))!==JSON.stringify(comparableRichText(expected[expected.type].rich_text))))okay=false;}
      raw=await this.resource('page',result.id);
    }else if(op.kind==='upload_file'){
      const upload=await this.resource('upload',String(result.details.file_upload_id));
      if(result.details.block_id){raw=await this.resource('block',String(result.details.block_id));okay=upload.status==='uploaded'&&raw.type==='file'&&!raw.in_trash&&raw.file?.name===op.filename;}
    }else{
      const kind=op.kind.includes('data_source')?'data_source':op.kind==='create_database'?'database':op.kind==='create_view'?'view':op.kind==='update_block'||op.kind==='delete_block'?'block':'page';
      raw=await this.resource(kind,result.id);
      if(op.kind==='trash_page'||op.kind==='delete_block')okay=raw.in_trash===true;
      else if(op.kind==='restore_page')okay=raw.in_trash===false;
      else if(op.kind==='create_page'||op.kind==='update_page')okay=!raw.in_trash&&(!op.title||propertiesMatch(raw.properties,{title:{title:richText(op.title)}}))&&(!('properties'in op)||!op.properties||propertiesMatch(raw.properties,op.properties));
      else if(op.kind==='create_record'||op.kind==='update_record')okay=!raw.in_trash&&propertiesMatch(raw.properties,op.properties);
      else if(op.kind==='create_database')okay=!raw.in_trash&&textOf(raw.title??[])===op.title&&(raw.data_sources?.length??0)>0;
      else if(op.kind==='create_data_source'||op.kind==='update_data_source')okay=!raw.in_trash&&(!op.title||textOf(raw.title??[])===op.title)&&Object.entries(op.properties).every(([key,value]:any)=>value===null?!raw.properties?.[key]:Boolean(raw.properties?.[value?.name??key]));
      else if(op.kind==='create_view')okay=raw.name===op.name&&raw.type===op.view_type;
      else if(op.kind==='update_block'){const type=raw.type;okay=!raw.in_trash&&Boolean(op.body[type])&&(!('rich_text'in(op.body[type] as any))||JSON.stringify(comparableRichText(raw[type]?.rich_text??[]))===JSON.stringify(comparableRichText((op.body[type] as any).rich_text)));}
      if(okay&&(op.kind==='create_page'||op.kind==='create_record')&&op.text){
        const batch=await this.children(raw.id);okay=batch.results.filter((b:any)=>b.type==='paragraph').map((b:any)=>textOf(b.paragraph?.rich_text??[])).join('\n')===op.text;
      }
      if(okay&&(op.kind==='create_page'||op.kind==='create_record')&&op.icon)okay=raw.icon?.type==='emoji'&&raw.icon.emoji===op.icon.emoji;
    }
    if(!okay)throw new DomainError('READBACK_FAILED','Notion accepted the request but read-back did not confirm the change. Retry verification with the same key; do not repeat the write.');
    return{...result,url:raw?.url??result.url,last_edited_time:raw?.last_edited_time??result.last_edited_time,readback_verified:true};
  }
}
