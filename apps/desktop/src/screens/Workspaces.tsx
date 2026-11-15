import { useState } from 'react';
import type { Snapshot, WorkspaceView } from '../../../../packages/contracts/src/index.js';
import { connectWorkspace, reauthorizeWorkspace, verifyWorkspace } from '../ipc/backend.js';
import { EmptyState, Status } from '../components/Primitives.js';
import { WorkspaceConnectionDialog } from '../components/WorkspaceConnectionDialog.js';
import { PageBrowser } from '../components/PageBrowser.js';
export function Workspaces({ data, refresh }: { data: Snapshot; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dialog, setDialog] = useState<{ workspace?: WorkspaceView } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState<string | null>(null);
  async function verify(id: string) {
    setBusy(id); setMessage(null); setWarnings([]);
    try { const response = await verifyWorkspace(id); setMessage(response.ok ? 'Workspace identity and read access verified.' : `${response.code}: ${response.errors.join(' ')}`); setWarnings(response.warnings); await refresh(); }
    catch { setMessage('Backend unavailable. Restart LV999 to retry.'); } finally { setBusy(null); }
  }
  function openConnection(workspace?: WorkspaceView) { setFailure(null); setDialog({ workspace }); }
  async function submit(label: string, token: string) {
    setBusy(dialog?.workspace?.id ?? 'connect'); setFailure(null); setMessage(null); setWarnings([]);
    try {
      const response = dialog?.workspace
        ? await reauthorizeWorkspace({ workspace_id: dialog.workspace.id, token, environment: 'test' })
        : await connectWorkspace({ label, token, environment: 'test' });
      if (response.ok) {
        setDialog(null);
        setMessage(dialog?.workspace ? 'Workspace reauthorized. Identity and read access verified.' : 'Workspace connected. Identity and read access verified.');
        setWarnings(response.warnings);
        await refresh();
      } else {
        setFailure(`${response.code}: ${response.errors.join(' ')}`);
        if (response.code === 'CREDENTIAL_STATE_UNCERTAIN') await refresh();
      }
    } catch { setFailure('The backend response was not received. Restart LV999 and refresh before retrying; the save result is unknown.'); }
    finally { setBusy(null); }
  }
  return <><div className="section-toolbar"><p>Connections are verified before saving. Tokens stay in Windows Credential Manager.</p>
    <button className="primary" disabled={busy !== null || !data.capabilities.connect_in_gui} onClick={() => openConnection()}>Connect workspace</button></div>
    {message ? <p role="status" className="notice">{message}</p> : null}
    {warnings.map(warning => <p className="notice" key={warning}>{warning}</p>)}
    {data.workspaces.length ? <div className="workspace-list">{data.workspaces.map(w => <section key={w.id} className="workspace">
      <div className="list-row"><h2>{w.label}</h2><Status value={w.status} /></div>
      <dl><dt>Notion workspace</dt><dd>{w.verified_name ?? 'Not verified'}</dd><dt>Workspace ID</dt><dd className="mono">{w.id}</dd>
        <dt>Environment</dt><dd>Test · read-only</dd><dt>Last verification</dt><dd>{w.checked_at ? new Date(w.checked_at).toLocaleString() : 'Never'}</dd>
        <dt>Read-access check</dt><dd>{w.read_access ? `${w.read_access.sampled_objects} shared objects in the first search batch${w.read_access.has_more ? ' · more available' : ''}. Checked ${new Date(w.read_access.checked_at).toLocaleString()}.` : 'Not verified. Use Verify connection to check identity and read access.'}</dd></dl>
      {w.read_access?.sampled_objects === 0 ? <p className="hint">No shared objects were found at the last connection check. Share a test root page with this connection; search indexing may take time. This is not a full workspace inventory.</p> : null}
      {w.message ? <p className="notice">{w.code}: {w.message}</p> : null}
      <div className="workspace-actions"><button onClick={() => void verify(w.id)} disabled={busy !== null}>{busy === w.id ? 'Checking…' : 'Verify connection'}</button>
        <button onClick={() => openConnection(w)} disabled={busy !== null}>Reauthorize</button>
        <button disabled={busy !== null || !data.capabilities.browse_pages} onClick={() => setBrowsing(browsing === w.id ? null : w.id)}>{browsing === w.id ? 'Hide pages' : 'Browse pages'}</button></div>
      {browsing === w.id ? <PageBrowser key={w.id} workspaceId={w.id} onStateChange={refresh} /> : null}
    </section>)}</div> : <EmptyState title="No test workspaces configured">Create a test workspace and its Internal Connection in Notion, then select Connect workspace. You do not need to enter a Workspace ID. Vibecode and Honour remain blocked.</EmptyState>}
    {dialog ? <WorkspaceConnectionDialog workspace={dialog.workspace} busy={busy !== null} failure={failure} onClose={() => setDialog(null)} onSubmit={submit} /> : null}
  </>;
}
