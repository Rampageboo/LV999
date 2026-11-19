import type {ContentAdapter} from '../notion/content-adapter.js';
import {DomainError} from '../notion/adapter.js';

export type SourceReadAccess=Pick<ContentAdapter,'resource'|'children'|'read'|'comments'|'property'>;
export type SourceSelection={page_ids:string[];data_sources:{id:string;filter?:Record<string,any>}[];include_child_databases?:boolean;project_record_id?:string};
export type SourceCapture={retrieved_at:string;pages:Record<string,any>;children:Record<string,any[]>;data_sources:Record<string,any>;databases?:Record<string,any>;warnings:string[]};
// This collector accepts no write adapter. It follows child pages, never links/mentions or unselected databases.
export async function captureSource(reader:SourceReadAccess,selection:SourceSelection):Promise<SourceCapture>{
 const result:SourceCapture={retrieved_at:new Date().toISOString(),pages:{},children:{},data_sources:{},warnings:['Comments, original authors/history and attachment bytes are not included in this capture.']};
 let blocks=0;
 const explicit=new Map(selection.data_sources.map(s=>[s.id,s.filter]));
 async function query(id:string,filter?:Record<string,any>){
  const rows:any[]=[];let cursor:string|undefined;const seen=new Set<string>();
  do{
   const batch:any=await reader.read({workspace_id:'',kind:'query',resource_id:id,max_depth:0,...(filter?{filter}:{}),...(cursor?{start_cursor:cursor}:{})});
   if(!Array.isArray(batch.results)||typeof batch.has_more!=='boolean')throw new DomainError('INVALID_RESPONSE','Invalid source record batch.');
   rows.push(...batch.results);if(rows.length>500)throw new DomainError('INVALID_INPUT','Source capture exceeds 500 records; split the selection.');
   cursor=batch.has_more?batch.next_cursor:undefined;
   if(batch.has_more&&(!cursor||seen.has(cursor)))throw new DomainError('INVALID_RESPONSE','Source record pagination did not advance.');
   if(cursor)seen.add(cursor);
  }while(cursor);return rows;
 }
 async function pagesOf(id:string){
  if(result.pages[id])return;if(Object.keys(result.pages).length>=500)throw new DomainError('INVALID_INPUT','Source capture exceeds 500 pages; split the selection.');
  const page=await reader.resource('page',id);if(page.in_trash||page.archived)throw new DomainError('CONTENT_CONFLICT','A selected source page is in trash.');
  result.pages[id]=page;
  if(Object.values(page.properties??{}).some((value:any)=>value?.has_more))result.warnings.push(`Paginated property requires separate capture: ${id}`);
  await walk(id);
 }
 async function dataSource(id:string,filter?:Record<string,any>){
  if(result.data_sources[id])return;
  const schema=await reader.resource('data_source',id),records=await query(id,filter);
  result.data_sources[id]={schema,records,filter:filter??null};
  for(const page of records)await pagesOf(page.id);
 }
 async function database(id:string){
  result.databases??={};if(result.databases[id])return;
  const database=await reader.resource('database',id);result.databases[id]=database;
  for(const ds of database.data_sources??[]){
   if(explicit.has(ds.id)){await dataSource(ds.id,explicit.get(ds.id));continue;}
   const schema=await reader.resource('data_source',ds.id);
   if(schema.properties?.Project?.type==='relation'){
    if(!selection.project_record_id){result.warnings.push(`Project-filtered database requires an explicit project record: ${id}`);continue;}
    await dataSource(ds.id,{property:'Project',relation:{contains:selection.project_record_id}});
   }else if(database.parent?.type==='page_id'&&result.pages[database.parent.page_id])await dataSource(ds.id);
   else result.warnings.push(`Database outside the selected page tree requires an explicit selection: ${id}`);
  }
 }
 async function walk(id:string){
  if(result.children[id])return;const all:any[]=[];result.children[id]=all;let cursor:string|undefined;const seen=new Set<string>();
  do{
   const batch=await reader.children(id,cursor);
   if(!Array.isArray(batch.results)||typeof batch.has_more!=='boolean')throw new DomainError('INVALID_RESPONSE','Invalid source block batch.');
   for(const block of batch.results){
    if(++blocks>50000)throw new DomainError('INVALID_INPUT','Source capture exceeds 50000 blocks; split the selection.');
    all.push(block);
    if(block.type==='child_page')await pagesOf(block.id);
    else if(block.type==='child_database'){if(selection.include_child_databases)await database(block.id);else result.warnings.push(`Database rows require an explicit filtered selection: ${block.id}`);}
    else if(block.has_children)await walk(block.id);
    if(block.type==='unsupported')result.warnings.push(`Unsupported source block: ${block.id}`);
   }
   cursor=batch.has_more?batch.next_cursor:undefined;
   if(batch.has_more&&(!cursor||seen.has(cursor)))throw new DomainError('INVALID_RESPONSE','Source pagination did not advance.');
   if(cursor)seen.add(cursor);
  }while(cursor);
 }
 for(const id of selection.page_ids)await pagesOf(id);
 for(const selected of selection.data_sources)await dataSource(selected.id,selected.filter);
 const signature=(records:any[])=>JSON.stringify(records.map(p=>[p.id,p.last_edited_time]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
 for(const [id,saved] of Object.entries(result.data_sources)){
  if(saved.schema.last_edited_time!==(await reader.resource('data_source',id)).last_edited_time)throw new DomainError('CONTENT_CONFLICT','Source schema changed during capture; no usable snapshot was produced.');
  if(signature(saved.records)!==signature(await query(id,saved.filter??undefined)))throw new DomainError('CONTENT_CONFLICT','Source record membership changed during capture; no usable snapshot was produced.');
 }
 for(const [id,page] of Object.entries(result.pages)){
  const after=await reader.resource('page',id);
  if(page.last_edited_time!==after.last_edited_time)throw new DomainError('CONTENT_CONFLICT','Source page changed during capture; no usable snapshot was produced.');
 }
 result.warnings=[...new Set(result.warnings)];return result;
}
