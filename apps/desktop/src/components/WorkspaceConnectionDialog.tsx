import { useEffect, useRef,useState, type FormEvent, type KeyboardEvent } from 'react';
import type { WorkspaceView,WorkspaceEnvironmentId } from '../../../../packages/contracts/src/index.js';

type Props = {
  workspace?: WorkspaceView;
  busy: boolean;
  failure: string | null;
  onClose: () => void;
  onSubmit: (label: string, token: string,environment:WorkspaceEnvironmentId,expectedName?:string,role?:'source'|'target') => Promise<void>;
};

export function WorkspaceConnectionDialog({ workspace, busy, failure, onClose, onSubmit }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [environment,setEnvironment]=useState<WorkspaceEnvironmentId>(workspace?.environment??'production');
  const [accessRole,setAccessRole]=useState<'source'|'target'>(workspace?.access_role??'target');
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const tokenInput = form.elements.namedItem('connection_token') as HTMLInputElement;
    const labelInput = form.elements.namedItem('display_name') as HTMLInputElement | null;
    const token = tokenInput.value;
    // Uncontrolled password field: never place a token in React state, storage or feedback.
    tokenInput.value = '';
    const expected=(form.elements.namedItem('expected_workspace_name') as HTMLInputElement|null)?.value.trim();
    void onSubmit(labelInput?.value ?? '', token,environment,expected||undefined,accessRole);
  }

  function keepFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not([disabled]),select:not([disabled]), button:not([disabled])')];
    if (!controls.length) { event.preventDefault(); return; }
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  return <dialog ref={dialog} className="connection-dialog" aria-labelledby="connection-title" onKeyDown={keepFocus}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={submit} autoComplete="off">
      <h2 id="connection-title">{workspace ? 'Reauthorize workspace' : 'Connect workspace'}</h2>
      {workspace?<p>The replacement must belong to this exact Workspace.</p>:null}
      <label className="form-field">Connection<select aria-label="Connection role" value={accessRole} disabled={busy||Boolean(workspace)} onChange={e=>{setAccessRole(e.target.value as 'source'|'target');if(e.target.value==='source')setEnvironment('production');}}><option value="target">Target Workspace</option><option value="source">Vibecode · read-only source</option></select></label>
      <label className="form-field">Environment<select aria-label="Connection environment" value={environment} disabled={busy||Boolean(workspace)||accessRole==='source'} onChange={e=>setEnvironment(e.target.value as WorkspaceEnvironmentId)}><option value="production">Production</option><option value="test">Test</option></select></label>
      {environment==='production'?<label className="form-field">Expected Notion Workspace name<input name="expected_workspace_name" required maxLength={200} defaultValue={workspace?.verified_name??''} disabled={busy}/></label>:null}
      {workspace ? <div className="connection-target"><strong>{workspace.label}</strong><span className="mono">{workspace.id}</span></div>
        : <label className="form-field">Display name <span className="field-hint">Optional · defaults to the Notion workspace name</span>
          <input name="display_name" type="text" maxLength={80} disabled={busy} autoFocus /></label>}
      <label className="form-field">Internal Connection token
        <input name="connection_token" type="password" required maxLength={2048} autoComplete="off"
          spellCheck={false} autoCapitalize="none" data-lpignore="true" data-1p-ignore="true" disabled={busy} autoFocus={Boolean(workspace)} />
      </label>
      <p className="field-hint">Saved only in Windows Credential Manager after verification. Do not paste tokens into a chat.</p>
      <label className="test-confirm"><input name="test_confirm" type="checkbox" required disabled={busy} />
        <span>{accessRole==='source'?'Authorize Vibecode as a read-only migration source.':environment==='test'?'This is a test workspace. It is not Vibecode or Honour.':'Authorize this production target. General writes start disabled.'}</span></label>
      {failure ? <div role="alert" className="form-error">{failure}</div> : null}
      {busy ? <p role="status">Checking workspace identity and read access, then saving securely…</p> : null}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Checking…' : workspace ? 'Verify & replace token' : 'Verify & connect'}</button></div>
    </form>
  </dialog>;
}
