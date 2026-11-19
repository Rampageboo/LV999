import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { OAuthStatus, WorkspaceView,WorkspaceEnvironmentId } from '../../../../packages/contracts/src/index.js';
import { oauthStatus, configureOAuth, startOAuth, cancelOAuth, openNotionAuthorization } from '../ipc/backend.js';

export function NotionOAuthDialog({ workspace, onClose, onConnected }: { workspace?: WorkspaceView; onClose: () => void; onConnected: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<OAuthStatus | null>(null);
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null), [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const notified = useRef(false);
  const [environment,setEnvironment]=useState<WorkspaceEnvironmentId>(workspace?.environment??'production');
  const [accessRole,setAccessRole]=useState<'target'|'source'>(workspace?.access_role??'target');
  const active = status?.phase === 'awaiting' || status?.phase === 'exchanging';
  useEffect(() => {
    dialog.current?.showModal(); let alive = true;
    async function update() {
      try { const reply = await oauthStatus(); if (!alive) return;
        if (!reply.ok) { setFailure(reply.errors.join(' ')); return; }
        setStatus(reply.data);
        if (reply.data?.phase === 'complete' && !notified.current) { notified.current = true; await onConnected(); }
      } catch { if (alive) setFailure('Backend unavailable. Restart LV999 and refresh before retrying.'); }
    }
    void update(); const timer = setInterval(() => void update(), 1500);
    return () => { alive = false; clearInterval(timer); dialog.current?.close(); };
  }, [onConnected]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget;
    const clientId = (form.elements.namedItem('oauth_client_id') as HTMLInputElement).value.trim();
    const field = form.elements.namedItem('oauth_client_secret') as HTMLInputElement;
    const secret = field.value; field.value = ''; setBusy(true); setFailure(null);
    try { const reply = await configureOAuth({ client_id: clientId, ...(secret.trim() ? { client_secret: secret } : {}) });
      if (reply.ok) { setStatus(reply.data); setEditing(false); } else setFailure(`${reply.code}: ${reply.errors.join(' ')}`);
    } catch { setFailure('OAuth settings result is unknown. Restart LV999 and check the settings before retrying.'); }
    finally { setBusy(false); }
  }
  async function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; setBusy(true); setFailure(null); notified.current = false;
    try {
      const reply = await startOAuth({ label: (form.elements.namedItem('oauth_label') as HTMLInputElement | null)?.value ?? '',
        environment,access_role:accessRole, ...(environment==='production'?{expected_workspace_name:(form.elements.namedItem('expected_workspace_name') as HTMLInputElement).value.trim()}:{}), ...(workspace ? { workspace_id: workspace.id } : {}) });
      if (!reply.ok) { setFailure(`${reply.code}: ${reply.errors.join(' ')}`); return; }
      const url = reply.data!.authorization_url; setAuthorizationUrl(url); setStatus((await oauthStatus()).data);
      await openNotionAuthorization(url);
    } catch { setFailure('The browser could not be opened or the response was lost. Check authorization status, then use Open Notion again.'); }
    finally { setBusy(false); }
  }
  async function close() {
    if (busy || status?.phase === 'exchanging') return;
    if (active) { setBusy(true); try { const reply = await cancelOAuth(); if (!reply.ok) { setFailure(reply.errors.join(' ')); return; } }
      catch { setFailure('Could not confirm cancellation. Keep LV999 open and retry.'); return; } finally { setBusy(false); } }
    onClose();
  }
  return <dialog ref={dialog} className="connection-dialog" aria-labelledby="oauth-title" onCancel={event => { event.preventDefault(); void close(); }}>
    <h2 id="oauth-title">{workspace ? `Reauthorize ${workspace.label} with Notion` : 'Connect with Notion'}</h2>
    {!status ? <p role="status">Loading OAuth settings…</p> : <>
      <p className="field-hint">In the Notion Developer portal, use this exact redirect URI:</p><p className="mono oauth-callback">{status.redirect_uri}</p>
      {!status.configured || editing ? <form onSubmit={save} autoComplete="off" className="oauth-settings">
        <label className="form-field">OAuth client ID<input name="oauth_client_id" required defaultValue={status.client_id ?? ''} disabled={busy || active} autoFocus /></label>
        <label className="form-field">OAuth client secret<input name="oauth_client_secret" type="password" required={!status.configured} maxLength={500}
          autoComplete="off" spellCheck={false} data-lpignore="true" data-1p-ignore="true" disabled={busy || active} /></label>
        <p className="field-hint">Saved only in Windows Credential Manager. Leave blank to keep the saved secret for this client ID. Do not send it in chat.</p>
        <button type="submit" disabled={busy || active}>Save OAuth settings</button>
      </form> : <p className="field-hint">OAuth app configured. <button className="text-button" disabled={busy || active} onClick={() => setEditing(true)}>Edit OAuth app</button></p>}
      {status.configured ? <form onSubmit={authorize} autoComplete="off">
        <label className="form-field">Connection<select aria-label="Connection role" value={accessRole} disabled={busy||active||Boolean(workspace)} onChange={e=>{setAccessRole(e.target.value as 'source'|'target');if(e.target.value==='source')setEnvironment('production');}}><option value="target">Target Workspace</option><option value="source">Vibecode · read-only source</option></select></label>
        {accessRole==='source'?<p className="notice">Source content cannot be edited or deleted through LV999. The Notion OAuth app itself may still request broader capabilities.</p>:null}
        <label className="form-field">Environment<select aria-label="OAuth environment" value={environment} disabled={busy||active||Boolean(workspace)||accessRole==='source'} onChange={e=>setEnvironment(e.target.value as WorkspaceEnvironmentId)}><option value="production">Production</option><option value="test">Test</option></select></label>
        {environment==='production'?<label className="form-field">Expected Notion Workspace name<input name="expected_workspace_name" required maxLength={200} defaultValue={workspace?.verified_name??''} disabled={busy||active}/></label>:null}
        {workspace ? <p>Choose this exact Workspace in Notion. A different Workspace will be rejected.</p> : <label className="form-field">Display name <span className="field-hint">Optional · defaults to the Notion workspace name</span><input name="oauth_label" maxLength={80} disabled={busy || active} /></label>}
        <label className="test-confirm"><input name="oauth_test_confirm" type="checkbox" required disabled={busy || active} /><span>{accessRole==='source'?'Authorize Vibecode as a read-only migration source.':environment==='test'?'This is a test Workspace. It is not Vibecode or Honour.':'Authorize this production target. General writes start disabled.'}</span></label>
        <button className="primary" type="submit" disabled={busy || active || editing}>{active ? 'Authorization in progress…' : 'Authorize workspace in Notion'}</button>
      </form> : null}
      {status.phase === 'awaiting' ? <p role="status">Choose a Workspace and pages in your browser, then allow access. This request expires in 10 minutes.</p> : null}
      {status.phase === 'exchanging' ? <p role="status">Verifying Workspace identity and read access, then saving credentials…</p> : null}
      {status.phase === 'complete' ? <p role="status" className="notice">{status.outcome?.data?.label} connected. Workspace identity and read access verified.</p> : null}
      {status.outcome?.warnings.map(w => <p className="notice" key={w}>{w}</p>)}
      {status.phase === 'failed' ? <p role="alert" className="form-error">{status.outcome?.errors.join(' ') || 'Authorization could not complete. Start again from LV999.'}</p> : null}
      {status.phase === 'expired' || status.phase === 'cancelled' ? <p role="status">Authorization {status.phase}. You can start a new request.</p> : null}
    </>}
    {failure ? <p role="alert" className="form-error">{failure}</p> : null}
    <div className="dialog-actions">{authorizationUrl && status?.phase === 'awaiting' ? <button disabled={busy} onClick={() => void openNotionAuthorization(authorizationUrl).catch(() => setFailure('The browser could not be opened.'))}>Open Notion again</button> : null}
      <button disabled={busy || status?.phase === 'exchanging'} onClick={() => void close()}>{active ? 'Cancel authorization' : 'Close'}</button></div>
  </dialog>;
}
