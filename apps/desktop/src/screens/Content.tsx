import { useEffect,useRef,useState } from 'react';
import type { Snapshot,AccessiblePage } from '../../../../packages/contracts/src/index.js';
import { ContentOperation,type Mutation,type MutationOp,type MutationPlan,type MutationResult } from '../../../../packages/contracts/src/content.js';
import { browsePages,readContent,setWorkspaceWrites,prepareMutation,approveMutation,executeMutation,pendingMutations } from '../ipc/backend.js';

const text=(parts:any[])=>parts.map(part=>part.plain_text??part.text?.content??'').join('');
const rich=(value:string)=>Array.from({length:Math.ceil(value.length/2000)},(_,i)=>({type:'text',text:{content:value.slice(i*2000,(i+1)*2000)}}));
const blocks=(value:string)=>value.split('\n').map(line=>({object:'block',type:'paragraph',paragraph:{rich_text:rich(line)}}));
function editable(properties:any){return Object.fromEntries(Object.entries(properties??{}).flatMap(([key,p]:any)=>{
  const kind=p.type;if(!['title','rich_text','number','checkbox','url','email','phone_number','date','select','multi_select','status','relation','people'].includes(kind))return[];
  let value=p[kind];if(['title','rich_text'].includes(kind))value=rich(text(value??[]));
  if(['select','status'].includes(kind))value=value?{name:value.name}:null;
  if(kind==='multi_select')value=(value??[]).map((item:any)=>({name:item.name}));
  if(['relation','people'].includes(kind))value=(value??[]).map((item:any)=>({id:item.id}));
  return[[key,{[kind]:value}]];
}));}
export function Content({data,refresh}:{data:Snapshot;refresh:()=>Promise<void>}){
  const [workspace,setWorkspace]=useState(data.workspaces[0]?.id??''),[project,setProject]=useState('');
  const [pages,setPages]=useState<AccessiblePage[]>([]),[sources,setSources]=useState<any[]>([]),[pageId,setPageId]=useState(''),[sourceId,setSourceId]=useState('');
  const [query,setQuery]=useState(''),[pageCursor,setPageCursor]=useState<string|null>(null),[sourceCursor,setSourceCursor]=useState<string|null>(null),[listing,setListing]=useState(false);
  const [document,setDocument]=useState<any>(null),[catalog,setCatalog]=useState<any>(null),[title,setTitle]=useState(''),[newTitle,setNewTitle]=useState(''),[body,setBody]=useState('');
  const [properties,setProperties]=useState('{}'),[schema,setSchema]=useState('{\n  "Name": {"title": {}},\n  "Notes": {"rich_text": {}}\n}'),[databaseTitle,setDatabaseTitle]=useState('');
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null),[result,setResult]=useState<MutationResult|null>(null);
  const [pending,setPending]=useState<Mutation|null>(null),[review,setReview]=useState<{plan:MutationPlan;request?:Mutation}|null>(null),[token,setToken]=useState<string|null>(null);
  const [plans,setPlans]=useState<(MutationPlan&{actor:string})[]>([]),[operations,setOperations]=useState<any[]>([]),[advanced,setAdvanced]=useState(JSON.stringify({kind:'create_view',data_source_id:'',name:'Table',view_type:'table'},null,2));
  const epoch=useRef(0),pageEpoch=useRef(0),dialog=useRef<HTMLDialogElement>(null);
  const current=data.workspaces.find(w=>w.id===workspace),route=data.projects.find(p=>p.project_key===project);
  const target:Mutation['target']=project?{project_key:project,route_revision:route?.revision}:{workspace_id:workspace};
  const version=document?.page?.id===pageId?document?.page?.last_edited_time:undefined;
  async function loadCatalog(more=false){
    const generation=++epoch.current;setFailure(null);setListing(true);
    try{const [pageReply,sourceReply]=await Promise.all([more&&!pageCursor?Promise.resolve(null):browsePages({workspace_id:workspace,query,...(more&&pageCursor?{start_cursor:pageCursor}:{})}),more&&!sourceCursor?Promise.resolve(null):readContent({workspace_id:workspace,kind:'databases',max_depth:0,...(more&&sourceCursor?{start_cursor:sourceCursor}:{})})]);
      if(generation!==epoch.current)return;
      if(pageReply?.ok){setPages(old=>[...new Map([...(more?old:[]),...pageReply.data!.pages].map(p=>[p.id,p])).values()]);setPageCursor(pageReply.data!.next_cursor);}else if(pageReply)setFailure(pageReply.errors.join(' '));
      if(sourceReply?.ok){setSources(old=>[...new Map([...(more?old:[]),...(sourceReply.data.results??[])].map(p=>[p.id,p])).values()]);setSourceCursor(sourceReply.data.next_cursor??null);}else if(sourceReply)setFailure(sourceReply.errors.join(' '));
    }catch{if(generation===epoch.current)setFailure('Backend unavailable. Refresh before retrying.');}finally{if(generation===epoch.current)setListing(false);}
  }
  useEffect(()=>{setPageId('');setSourceId('');setDocument(null);setCatalog(null);setPending(null);setResult(null);setReview(null);setToken(null);if(workspace)void loadCatalog();return()=>{epoch.current++;};},[workspace]);
  useEffect(()=>{if(review)dialog.current?.showModal();else dialog.current?.close();},[review]);
  async function loadPage(id:string){
    const generation=epoch.current,request=++pageEpoch.current;setBusy(true);setFailure(null);
    try{const reply=await readContent({workspace_id:workspace,kind:'page_tree',resource_id:id,max_depth:1});if(generation!==epoch.current||request!==pageEpoch.current)return;
      if(reply.ok){setDocument(reply.data);const loadedTitle=text(Object.values(reply.data.page.properties??{}).filter((p:any)=>p.type==='title').flatMap((p:any)=>p.title??[]));setTitle(loadedTitle);setPages(old=>old.map(p=>p.id===id?{...p,title:loadedTitle}:p));setProperties(JSON.stringify(editable(reply.data.page.properties),null,2));}
      else setFailure(`${reply.code}: ${reply.errors.join(' ')}`);
    }catch{if(generation===epoch.current&&request===pageEpoch.current)setFailure('The read result was not received. Refresh before editing.');}finally{if(request===pageEpoch.current)setBusy(false);}
  }
  async function loadSource(id:string,kind:'data_source'|'query'='data_source'){
    setBusy(true);setFailure(null);try{const reply=await readContent({workspace_id:workspace,kind,resource_id:id,max_depth:0});if(reply.ok)setCatalog(reply.data);else setFailure(`${reply.code}: ${reply.errors.join(' ')}`);}catch{setFailure('The data-source response was not received.');}finally{setBusy(false);}
  }
  async function complete(request:Mutation,approval?:{plan_id:string;plan_hash:string}){
    setBusy(true);setFailure(null);
    try{const reply=await executeMutation({...request,...(approval?{approval}:{})});
      if(reply.data)setResult(reply.data);
      if(reply.ok){setPending(null);setReview(null);setNotice('Change saved and read back from Notion.');
        const op=request.operation;
        if((op.kind==='create_page'||op.kind==='create_record')&&reply.data){const id=reply.data.id;setPageId(id);setPages(old=>[{id,title:op.kind==='create_page'?op.title:'Created record',workspace_id:workspace,url:reply.data!.url??'',parent_kind:op.kind==='create_record'?'data_source_id':'page_id',last_edited_time:reply.data!.last_edited_time,root_eligible:op.kind==='create_page',root_reason:null},...old.filter(p=>p.id!==id)]);await loadPage(id);setNewTitle('');}
        else if('page_id'in op&&op.kind!=='trash_page')await loadPage(op.page_id);
        else if(op.kind==='trash_page')setDocument((old:any)=>old?{...old,page:{...old.page,in_trash:true,last_edited_time:reply.data?.last_edited_time},blocks:{results:[]},warnings:['This page is in trash. Restore it to edit.']}:old);
        await refresh();
      }else{setFailure(`${reply.code}: ${reply.errors.join(' ')}`);if(!['MUTATION_OUTCOME_UNKNOWN','READBACK_FAILED'].includes(reply.code))setPending(null);}
    }catch{setFailure('Write result unknown. Keep this retry key and use Retry same request; do not create a fresh request.');}
    finally{setBusy(false);}
  }
  async function run(operation:MutationOp){
    const request:Mutation={target,operation,idempotency_key:crypto.randomUUID()};setPending(request);setBusy(true);setFailure(null);setNotice(null);setToken(null);
    try{const reply=await prepareMutation(request);if(!reply.ok){setFailure(`${reply.code}: ${reply.errors.join(' ')}`);setPending(null);return;}
      if(reply.data!.destructive)setReview({plan:reply.data!,request});else await complete(request);
    }catch{setFailure('Preview result unknown. Reload before submitting.');setPending(null);}finally{setBusy(false);}
  }
  async function confirm(){
    if(!review)return;setBusy(true);setFailure(null);
    try{const approved=await approveMutation(review.plan);if(!approved.ok){setFailure(approved.errors.join(' '));return;}
      if(review.request)await complete(review.request,approved.data!);
      else setToken(JSON.stringify(approved.data));
    }catch{setFailure('Approval response unknown. Prepare a new plan before retrying.');}finally{setBusy(false);}
  }
  async function showRequests(){const reply=await pendingMutations();if(reply.ok){setPlans(reply.data!.plans);setOperations(reply.data!.operations);}else setFailure(reply.errors.join(' '));}
  async function upload(file:File){
    if(file.size>2*1024*1024){setFailure('Choose a file of at most 2 MiB.');return;}
    const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    await run({kind:'upload_file',page_id:pageId,expected_last_edited_time:version,filename:file.name,content_type:(['text/plain','image/png','image/jpeg','application/pdf'].includes(file.type)?file.type:'application/octet-stream') as any,base64:btoa(binary)});
  }
  function parse(value:string){try{return JSON.parse(value);}catch{throw new Error('Enter valid JSON.');}}
  function advancedRun(){try{const operation=ContentOperation.parse(parse(advanced));void run(operation);}catch{setFailure('Enter a supported operation with valid fields. The schema examples use current Notion API field names.');}}
  const disabled=busy||!current?.write_enabled||Boolean(pending);
  return <>
    <div className="content-target"><label className="form-field">Workspace<select aria-label="Content Workspace" value={workspace} disabled={busy||Boolean(pending)} onChange={e=>{setProject('');setWorkspace(e.target.value);}}>{data.workspaces.map(w=><option value={w.id} key={w.id}>{w.label}</option>)}</select></label>
      <label className="form-field">Project route<select aria-label="Content project route" value={project} disabled={busy||Boolean(pending)} onChange={e=>{setProject(e.target.value);const next=data.projects.find(p=>p.project_key===e.target.value);if(next)setWorkspace(next.workspace_id);}}><option value="">Workspace directly</option>{data.projects.map(p=><option key={p.project_key} value={p.project_key}>{p.project_key} · {p.name}</option>)}</select></label></div>
    <p><strong>Target: {current?.label??'Select a test Workspace'}{project?` · ${project}`:''}</strong> · {current?.write_enabled?'Writes enabled':'Read-only'}</p>
    <label className="test-confirm"><input type="checkbox" checked={Boolean(current?.write_enabled)} disabled={busy||!workspace||Boolean(pending)} onChange={async e=>{setBusy(true);try{const reply=await setWorkspaceWrites(workspace,e.target.checked);if(!reply.ok)setFailure(reply.errors.join(' '));await refresh();}finally{setBusy(false);}}}/>Enable content writes in this test Workspace</label>
    {failure?<p role="alert" className="form-error">{failure}</p>:null}{notice?<p role="status" className="notice">{notice}</p>:null}{busy?<p role="status">Validating target and waiting for Notion…</p>:null}
    {pending&&!review?<div className="notice"><p>Retry key: <span className="mono">{pending.idempotency_key}</span></p><button disabled={busy} onClick={()=>void complete(pending)}>Retry same request / verify again</button></div>:null}
    <section className="content-section"><div className="section-toolbar"><h2>Pages and records</h2><button disabled={busy||listing} onClick={()=>void loadCatalog()}>Refresh available content</button></div>
      <label className="form-field">Find pages by title<input aria-label="Content page search" value={query} disabled={busy||listing} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void loadCatalog();}}/></label>
      {listing?<p role="status">Loading authorized content…</p>:null}{pageCursor||sourceCursor?<button disabled={busy||listing} onClick={()=>void loadCatalog(true)}>Load more available content</button>:null}
      <label className="form-field">Authorized page<select aria-label="Authorized page" value={pageId} disabled={busy||Boolean(pending)} onChange={e=>{setPageId(e.target.value);if(e.target.value)void loadPage(e.target.value);}}><option value="">Select a page or record</option>{pages.map(p=><option key={p.id} value={p.id}>{p.title} · {p.parent_kind==='data_source_id'?'record':'page'}</option>)}</select></label>
      <p className="field-hint">The list is a search index. A newly created object can be edited immediately from its returned result.</p>
      <div className="content-columns"><div><h3>Create a child page</h3><label className="form-field">New page title<input aria-label="New page title" value={newTitle} maxLength={1000} disabled={disabled} onChange={e=>setNewTitle(e.target.value)}/></label>
        <label className="form-field">Text<textarea aria-label="Page text" value={body} maxLength={16000} disabled={disabled} onChange={e=>setBody(e.target.value)}/></label>
        <button disabled={disabled||!pageId||!newTitle.trim()} onClick={()=>void run({kind:'create_page',parent_page_id:pageId,title:newTitle,text:body})}>Create page under selected page</button>
        <button disabled={disabled||!pageId||!version||!body.trim()||document?.page?.in_trash} onClick={()=>void run({kind:'append_blocks',page_id:pageId,expected_last_edited_time:version,blocks:blocks(body)})}>Append text</button></div>
        <div><h3>Edit selected page</h3><label className="form-field">Page title<input aria-label="Edit page title" value={title} disabled={disabled||!document} onChange={e=>setTitle(e.target.value)}/></label>
        <button disabled={disabled||!version||!title.trim()||document?.page?.in_trash} onClick={()=>void run({kind:'update_page',page_id:pageId,expected_last_edited_time:version,title})}>Save title</button>
        <label className="form-field">Writable properties (JSON)<textarea aria-label="Page properties JSON" value={properties} disabled={disabled||!document} onChange={e=>setProperties(e.target.value)}/></label>
        <button disabled={disabled||!version||document?.page?.in_trash} onClick={()=>{try{void run({kind:document.page.parent?.type==='data_source_id'?'update_record':'update_page',page_id:pageId,expected_last_edited_time:version,properties:parse(properties)} as MutationOp);}catch{setFailure('Enter valid properties JSON.');}}}>Save properties</button>
        <button disabled={disabled||!version||document?.page?.in_trash} onClick={()=>void run({kind:'trash_page',page_id:pageId,expected_last_edited_time:version})}>Move page to trash</button>
        <button disabled={disabled||!version||!document?.page?.in_trash} onClick={()=>void run({kind:'restore_page',page_id:pageId,expected_last_edited_time:version})}>Restore page</button></div></div>
      {document?.warnings?.map((warning:string)=><p className="notice" key={warning}>{warning}</p>)}
      {document?.blocks?.results?.map((block:any)=><TextBlock key={block.id} block={block} disabled={disabled||document.page.in_trash} save={value=>void run({kind:'update_block',page_id:pageId,block_id:block.id,expected_last_edited_time:block.last_edited_time,body:{[block.type]:{...block[block.type],rich_text:rich(value)}}})} remove={()=>void run({kind:'delete_block',page_id:pageId,block_id:block.id,expected_last_edited_time:block.last_edited_time})}/>)}
      <label className="form-field">Attach a local file (up to 2 MiB)<input aria-label="Attachment file" type="file" disabled={disabled||!version||document?.page?.in_trash} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(file);}}/></label>
    </section>
    <section className="content-section"><h2>Databases, records and relations</h2><label className="form-field">Data source<select aria-label="Data source" value={sourceId} disabled={busy} onChange={e=>{setSourceId(e.target.value);if(e.target.value)void loadSource(e.target.value);}}><option value="">Select a shared data source</option>{sources.map(source=><option key={source.id} value={source.id}>{text(source.title??[])||source.id}</option>)}</select></label>
      <div className="workspace-actions"><button disabled={busy||!sourceId} onClick={()=>void loadSource(sourceId)}>Read schema</button><button disabled={busy||!sourceId} onClick={()=>void loadSource(sourceId,'query')}>Query records</button>
        <button disabled={disabled||!sourceId} onClick={()=>{try{void run({kind:'create_record',data_source_id:sourceId,properties:parse(properties),text:body});}catch{setFailure('Enter valid record properties JSON.');}}}>Create record using properties above</button></div>
      <label className="form-field">Database title<input aria-label="New database title" value={databaseTitle} disabled={disabled} onChange={e=>setDatabaseTitle(e.target.value)}/></label>
      <label className="form-field">Initial schema (JSON)<textarea aria-label="Database schema JSON" value={schema} disabled={disabled} onChange={e=>setSchema(e.target.value)}/></label>
      <button disabled={disabled||!pageId||!databaseTitle.trim()} onClick={()=>{try{void run({kind:'create_database',parent_page_id:pageId,title:databaseTitle,properties:parse(schema)});}catch{setFailure('Enter a valid database schema.');}}}>Create database under selected page</button>
      {catalog?<pre className="content-json">{JSON.stringify(catalog,null,2)}</pre>:null}
      <details><summary>Advanced data-source, relation and view operations</summary><p className="field-hint">Use IDs returned by the schema/query result. Relation targets and uploaded files are checked in the selected Workspace.</p><textarea className="content-operation" aria-label="Advanced content operation JSON" value={advanced} disabled={disabled} onChange={e=>setAdvanced(e.target.value)}/><button disabled={disabled} onClick={advancedRun}>Preview advanced operation</button></details>
    </section>
    <section className="content-section"><div className="section-toolbar"><h2>Approvals and write outcomes</h2><button disabled={busy} onClick={()=>void showRequests().catch(()=>setFailure('Could not load write outcomes.'))}>Refresh requests</button></div>
      {plans.map(plan=><div className="mutation-row" key={plan.id}><span>{data.workspaces.find(w=>w.id===plan.workspace_id)?.label} · {plan.operation} · {plan.actor}</span><button onClick={()=>{setReview({plan});setToken(null);}}>Review exact plan</button></div>)}
      {operations.map(op=><p className="field-hint" key={`${op.actor}/${op.retry_key}`}>{op.kind} · {op.state} · {op.error_code??'OK'} · {op.retry_key}</p>)}
      <p className="field-hint">Unknown outcomes are blocked instead of automatically retried. A retry of an accepted request only checks its recorded result.</p>
    </section>
    {result?<section className="content-section"><h2>Last verified result</h2><pre className="content-json">{JSON.stringify(result,null,2)}</pre></section>:null}
    <dialog ref={dialog} className="connection-dialog" aria-labelledby="mutation-review-title" onCancel={e=>{e.preventDefault();if(!busy){setReview(null);setPending(null);setToken(null);}}}>
      {review?<><h2 id="mutation-review-title">Review exact destructive change</h2><p><strong>{data.workspaces.find(w=>w.id===review.plan.workspace_id)?.label}</strong> · {review.plan.title}</p><p>{review.plan.summary}</p><dl><dt>Target ID</dt><dd className="mono">{review.plan.resource_id}</dd><dt>Version</dt><dd>{review.plan.version??'No version returned'}</dd></dl>
        <p>Trash is recoverable in Notion. This approval expires and can be used only once for this unchanged request.</p>
        {token?<label className="form-field">Approved plan reference for the requesting client (contains no credential)<textarea readOnly aria-label="Approved plan reference" value={token}/></label>:null}
        <div className="dialog-actions"><button disabled={busy} onClick={()=>{setReview(null);setPending(null);setToken(null);}}>Cancel</button><button className="primary" disabled={busy||Boolean(token)} onClick={()=>void confirm()}>Approve exact change</button></div></>:null}
    </dialog>
  </>;
}
function TextBlock({block,disabled,save,remove}:{block:any;disabled:boolean;save:(value:string)=>void;remove:()=>void}){
  const editable=Array.isArray(block[block.type]?.rich_text),[value,setValue]=useState(text(block[block.type]?.rich_text??[]));
  useEffect(()=>setValue(text(block[block.type]?.rich_text??[])),[block.id,block.last_edited_time]);
  return <div className="content-block"><strong>{block.type??'Unsupported/partial block'}</strong>{editable?<><textarea aria-label={`Edit ${block.type} block`} value={value} disabled={disabled} onChange={e=>setValue(e.target.value)}/><small>Plain-text edits replace rich-text formatting in this block.</small><button disabled={disabled} onClick={()=>save(value)}>Save block text</button></>:<p>{block.file?.name??'Use the advanced block API for this block type.'}</p>}<button disabled={disabled} onClick={remove}>Move block to trash</button></div>;
}
