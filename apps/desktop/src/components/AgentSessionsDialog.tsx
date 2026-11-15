import { useEffect,useRef,useState } from 'react';
import type { AgentBinding } from '../../../../packages/contracts/src/index.js';
import { configureAgent,resumeAgent,stopAgent } from '../ipc/backend.js';
export function AgentSessionsDialog({workspaceId,projectKey,bindings,onClose,refresh}:{workspaceId:string;projectKey?:string;bindings:AgentBinding[];onClose:()=>void;refresh:()=>Promise<void>}){
  const dialog=useRef<HTMLDialogElement>(null);
  const specific=(actor:'claude'|'codex')=>bindings.find(row=>row.workspace_id===workspaceId&&row.project_key===(projectKey??null)&&row.actor===actor);
  const [models,setModels]=useState({claude:specific('claude')?.model??'sonnet',codex:specific('codex')?.model??'gpt-5.6-sol'});
  const [efforts,setEfforts]=useState<Record<'claude'|'codex','low'|'medium'|'high'>>({claude:specific('claude')?.effort??'low',codex:specific('codex')?.effort??'low'});
  const [enabled,setEnabled]=useState({claude:Boolean(specific('claude')?.enabled&&!specific('claude')?.paused),codex:Boolean(specific('codex')?.enabled&&!specific('codex')?.paused)});
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState<string|null>(null);
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  async function action(actor:'claude'|'codex',kind:'save'|'stop'|'resume'){
    setBusy(true);setFailure(null);const row=specific(actor);
    try{
      const response=kind==='stop'&&row?await stopAgent(row.id):kind==='resume'&&row?await resumeAgent(row.id,row.revision):
        await configureAgent({workspace_id:workspaceId,...(projectKey?{project_key:projectKey}:{}),actor,model:models[actor],effort:efforts[actor],enabled:enabled[actor],expected_revision:row?.revision??0});
      if(!response.ok)setFailure(`${response.code}: ${response.errors.join(' ')}`);
      if(response.data){const value=response.data as AgentBinding;setEnabled(old=>({...old,[actor]:value.enabled&&!value.paused}));}
      await refresh();
    }catch{setFailure('Binding result unknown. Refresh before retrying.');}finally{setBusy(false);}
  }
  return <dialog ref={dialog} className="connection-dialog agent-sessions-dialog" aria-labelledby="agent-sessions-title" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}
    onKeyDown={event=>{if(event.key!=='Tab')return;const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('input:not([disabled]),select:not([disabled]),button:not([disabled])')];
      if(!controls.length){event.preventDefault();return;}if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1)!.focus();}else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0].focus();}}}>
    <h2 id="agent-sessions-title">Agent sessions</h2>
    <p>{projectKey?`Bindings for project ${projectKey}. Workspace defaults are used if no project binding exists.`:'Workspace defaults apply to all group topics without their own binding.'}</p>
    <p className="field-hint">LV999 creates a private, message-only native session automatically on the first selected @ mention. These agents cannot run project commands or tools. Automatic turns use your native account quota.</p>
    {(['claude','codex'] as const).map(actor=>{const row=specific(actor);return <section key={actor} className="agent-session-card" aria-label={`${actor} session binding`}>
      <div className="list-row"><h3>{actor==='claude'?'Claude':'Codex'}</h3><strong>{row?.stopping?'Stopping…':row?.status??'Not bound'}</strong></div>
      <div className="agent-binding-inputs"><label className="form-field">{actor==='claude'?'Claude':'Codex'} model<input aria-label={`${actor} model`} value={models[actor]} disabled={busy||row?.status==='Busy'||row?.stopping} maxLength={100} onChange={event=>setModels(old=>({...old,[actor]:event.target.value}))}/></label>
        <label className="form-field">Effort<select aria-label={`${actor} effort`} value={efforts[actor]} disabled={busy} onChange={event=>setEfforts(old=>({...old,[actor]:event.target.value as 'low'|'medium'|'high'}))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label></div>
      <label className="test-confirm"><input type="checkbox" checked={enabled[actor]} disabled={busy} onChange={event=>setEnabled(old=>({...old,[actor]:event.target.checked}))}/>Enable @{actor==='claude'?'Claude':'Codex'} automatic turns</label>
      <p className="field-hint">{row?.native_session_id?`Managed native session: ${row.native_session_id}`:'A new owned session will be created when this agent is first woken.'}</p>
      {row?.last_code?<p className="notice">{row.last_code}{row.last_code==='AUTH_REQUIRED'?` — sign in locally with ${actor==='claude'?'claude auth login':'codex login'}, then Resume and explicitly Retry the message.`:''}</p>:null}
      <div className="workspace-actions"><button disabled={busy||row?.status==='Busy'||row?.stopping} onClick={()=>void action(actor,'save')}>Save {actor} binding</button>
        {row?<><button disabled={busy} onClick={()=>void action(actor,'stop')}>Stop {actor}</button><button disabled={busy||row.stopping||row.status==='Busy'||!row.paused} onClick={()=>void action(actor,'resume')}>Resume {actor}</button></>:null}</div>
    </section>;})}
    {failure?<p role="alert" className="form-error">{failure}</p>:null}
    <p className="field-hint">Stop persists across restarts and never auto-resumes. Resume allows future mentions; old cancelled/blocked messages require their own Retry.</p>
    <div className="dialog-actions"><button disabled={busy} onClick={onClose}>Close agent settings</button></div>
  </dialog>;
}
