import { useState } from 'react';
import type { Snapshot } from '../../../../packages/contracts/src/index.js';
import { verifyWorkspace } from '../ipc/backend.js';
import { DisabledAction, EmptyState, Status } from '../components/Primitives.js';
export function Workspaces({ data, refresh }: { data: Snapshot; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function verify(id: string) {
    setBusy(id); setMessage(null);
    try { const response = await verifyWorkspace(id); setMessage(response.ok ? 'Workspace identity verified.' : `${response.code}: ${response.errors.join(' ')}`); await refresh(); }
    catch { setMessage('Backend unavailable. Restart LV999 to retry.'); } finally { setBusy(null); }
  }
  return <><div className="section-toolbar"><p>Configured is distinct from verified. Tokens stay in Windows Credential Manager.</p><DisabledAction reason="GUI connection setup arrives in Milestone 1.">Connect workspace</DisabledAction></div>
    {message ? <p role="status" className="notice">{message}</p> : null}
    {data.workspaces.length ? <div className="workspace-list">{data.workspaces.map(w => <section key={w.id} className="workspace"><div className="list-row"><h2>{w.verified_name ?? w.label}</h2><Status value={w.status} /></div><dl><dt>Workspace ID</dt><dd className="mono">{w.id}</dd><dt>Environment</dt><dd>Test · read-only</dd><dt>Last identity check</dt><dd>{w.checked_at ? new Date(w.checked_at).toLocaleString() : 'Never'}</dd></dl>{w.message ? <p className="notice">{w.code}: {w.message}</p> : null}<button onClick={() => void verify(w.id)} disabled={busy !== null}>{busy === w.id ? 'Verifying…' : 'Verify connection'}</button></section>)}</div> : <EmptyState title="No test workspaces configured">Create two test workspaces in Notion, then follow docs/setup-windows.md for secure local enrollment. Vibecode and Honour remain blocked.</EmptyState>}
  </>;
}
