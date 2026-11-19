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
