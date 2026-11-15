import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AccessiblePage, ProjectRoute, SaveProjectRequest, WorkspaceView } from '../../../../packages/contracts/src/index.js';
import { PageBrowser } from './PageBrowser.js';

export function ProjectRouteDialog({ workspaces, routes, route, busy, failure, onClose, onSave, refresh }: {
  workspaces: WorkspaceView[]; routes: ProjectRoute[]; route?: ProjectRoute; busy: boolean; failure: string | null;
  onClose: () => void; onSave: (input: SaveProjectRequest) => Promise<void>; refresh: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [key, setKey] = useState(route?.project_key ?? '');
  const [name, setName] = useState(route?.name ?? '');
  const [workspace, setWorkspace] = useState(route?.workspace_id ?? workspaces[0]?.id ?? '');
  const [root, setRoot] = useState<AccessiblePage | null>(route?.root_page ?? null);
  const sameName = routes.filter(existing => existing.project_key !== route?.project_key &&
    existing.name.normalize('NFKC').trim().toLowerCase() === name.normalize('NFKC').trim().toLowerCase());
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  function keepFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not([disabled]), select:not([disabled]), button:not([disabled])')];
    if (!controls.length) { event.preventDefault(); return; }
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !root || root.workspace_id !== workspace) return;
    void onSave({ project_key: key, name, workspace_id: workspace, root_page_id: root.id, expected_revision: route?.revision ?? 0 });
  }
  return <dialog ref={dialog} className="connection-dialog routing-dialog" aria-labelledby="route-title" onKeyDown={keepFocus}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={submit}>
      <h2 id="route-title">{route ? 'Edit project mapping' : 'Add project mapping'}</h2>
      <p>Choose an exact workspace and an ordinary page as this project's root. Saving changes local routing only and rechecks the page before committing.</p>
      <fieldset disabled={busy} className="route-fields"><label className="form-field">Project key<input aria-label="Project key" value={key} required maxLength={32}
        pattern={'[A-Za-z][A-Za-z0-9_\\-]{0,31}'} readOnly={Boolean(route)} autoFocus onChange={event => setKey(event.target.value)} /></label>
        <label className="form-field">Project name<input aria-label="Project name" value={name} required maxLength={80} onChange={event => setName(event.target.value)} /></label>
        <label className="form-field route-workspace">Target workspace<select aria-label="Target workspace" value={workspace} required onChange={event => { setWorkspace(event.target.value); setRoot(null); }}>
          {workspaces.map(item => <option key={item.id} value={item.id}>{item.label} · {item.id.slice(0, 8)}</option>)}
        </select></label>
      </fieldset>
      {sameName.length ? <p role="note" className="notice">This name is also used by {sameName.map(item => item.project_key).join(', ')}. Name-based resolution will be ambiguous; use the exact project key.</p> : null}
      <fieldset disabled={busy} className="browser-fields">{workspace ? <PageBrowser key={workspace} workspaceId={workspace} onStateChange={refresh} onSelect={page => {
        if (page.workspace_id === workspace) setRoot(page);
      }} /> : <p>Connect a test workspace first.</p>}</fieldset>
      <section className="route-target" aria-label="Selected route target"><h3>Selected route target</h3>{root && root.workspace_id === workspace ? <>
        <strong>{key.trim().toUpperCase() || 'Project key'} → {workspaces.find(item => item.id === workspace)?.label} → {root.title}</strong>
        <p className="mono">Workspace: {workspace}<br />Page: {root.id}</p><p className="field-hint">The page will be checked again when you save.</p>
      </> : <p>Inspect a page above, then choose Use as project root.</p>}</section>
      {failure ? <p role="alert" className="form-error">{failure}</p> : null}
      {busy ? <p role="status">Validating the exact workspace and root page, then saving the local mapping…</p> : null}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={busy || !root || root.workspace_id !== workspace}>Save mapping</button></div>
    </form>
  </dialog>;
}
