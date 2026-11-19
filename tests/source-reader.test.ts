import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {captureSource} from '../apps/server/src/core/source-reader.js';
it('captures all child batches and nested pages without following unrelated databases or mentions',async()=>{
 const root=randomUUID(),child=randomUUID(),database=randomUUID();
 const resource=vi.fn(async(kind:string,id:string)=>({id,last_edited_time:'version',properties:{}}));
 const children=vi.fn(async(id:string,cursor?:string)=>id===root&&!cursor?{results:[{id:child,type:'child_page',has_children:true}],has_more:true,next_cursor:'next'}:id===root?{results:[{id:database,type:'child_database',has_children:true}],has_more:false,next_cursor:null}:{results:[],has_more:false,next_cursor:null});
 const read=vi.fn();const capture=await captureSource({resource,children,read},{page_ids:[root],data_sources:[]});
 expect(Object.keys(capture.pages).sort()).toEqual([root,child].sort());expect(capture.children[root]).toHaveLength(2);expect(children).not.toHaveBeenCalledWith(database,expect.anything());expect(read).not.toHaveBeenCalled();expect(capture.warnings.some(w=>w.includes(database))).toBe(true);
});
it('rejects changed source pages and repeated pagination cursors',async()=>{
 const id=randomUUID();let version=0;const resource=vi.fn(async()=>({id,last_edited_time:String(version++),properties:{}}));
 const children=vi.fn(async()=>({results:[],has_more:false,next_cursor:null}));
 await expect(captureSource({resource,children,read:vi.fn()},{page_ids:[id],data_sources:[]})).rejects.toThrow('changed during capture');
 await expect(captureSource({resource,children:vi.fn(async()=>({results:[],has_more:true,next_cursor:'same'})),read:vi.fn()},{page_ids:[id],data_sources:[]})).rejects.toThrow('pagination did not advance');
});
it('rejects a new row appearing during a filtered data-source capture',async()=>{
 const ds=randomUUID(),row=randomUUID();let queries=0;
 const resource=vi.fn(async(_kind:string,id:string)=>({id,last_edited_time:'same',properties:{}}));
 const read=vi.fn(async()=>({results:++queries===1?[]:[{id:row,last_edited_time:'same'}],has_more:false,next_cursor:null}));
 await expect(captureSource({resource,children:vi.fn(),read},{page_ids:[],data_sources:[{id:ds,filter:{property:'Project',relation:{contains:randomUUID()}}}]})).rejects.toThrow('record membership changed');
});
it('reuses the explicit project filter for databases embedded in the selected tree',async()=>{
 const root=randomUUID(),database=randomUUID(),ds=randomUUID(),project=randomUUID();
 const filter={property:'Project',relation:{contains:project}};
 const resource=vi.fn(async(kind:string,id:string)=>kind==='database'?{id,parent:{type:'page_id',page_id:root},data_sources:[{id:ds}]}:{id,last_edited_time:'same',properties:{Project:{type:'relation'}}});
 const children=vi.fn(async(id:string)=>({results:id===root?[{id:database,type:'child_database'}]:[],has_more:false,next_cursor:null}));
 const read=vi.fn(async()=>({results:[],has_more:false,next_cursor:null}));
 const captured=await captureSource({resource,children,read},{page_ids:[root],data_sources:[{id:ds,filter}],include_child_databases:true,project_record_id:project});
 expect(captured.databases?.[database]).toBeDefined();expect(Object.keys(captured.data_sources)).toEqual([ds]);expect(read).toHaveBeenCalledTimes(2);expect(read.mock.calls.every(([input]:any)=>JSON.stringify(input.filter)===JSON.stringify(filter))).toBe(true);
});
it('does not query a project-related embedded database without its project identity',async()=>{
 const root=randomUUID(),database=randomUUID(),ds=randomUUID();
 const resource=vi.fn(async(kind:string,id:string)=>kind==='database'?{id,parent:{type:'page_id',page_id:root},data_sources:[{id:ds}]}:{id,last_edited_time:'same',properties:{Project:{type:'relation'}}});
 const children=vi.fn(async(id:string)=>({results:id===root?[{id:database,type:'child_database'}]:[],has_more:false,next_cursor:null})),read=vi.fn();
 const captured=await captureSource({resource,children,read},{page_ids:[root],data_sources:[],include_child_databases:true});
 expect(read).not.toHaveBeenCalled();expect(captured.warnings.some(w=>w.includes('explicit project record'))).toBe(true);
});
