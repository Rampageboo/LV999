import { useState } from 'react';
import type { ProjectRoute, SaveProjectRequest, Snapshot } from '../../../../packages/contracts/src/index.js';
import { EmptyState } from '../components/Primitives.js';
import { ProjectRouteDialog } from '../components/ProjectRouteDialog.js';
import { resolveProject, saveProject } from '../ipc/backend.js';

export function ProjectRouting({ data, refresh }: { data: Snapshot; refresh: () => Promise<void> }) {
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState<{ route?: ProjectRoute } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resolveName, setResolveName] = useState('');
  const [resolved, setResolved] = useState<ProjectRoute | null>(null);
  const visible = data.projects.filter(route => [route.project_key, route.name, route.root_page.title,
    data.workspaces.find(w => w.id === route.workspace_id)?.label ?? ''].join(' ').toLowerCase().includes(filter.trim().toLowerCase()));
  function open(route?: ProjectRoute) { setFailure(null); setDialog({ route }); }
  async function save(input: SaveProjectRequest) {
    setBusy(true); setFailure(null); setNotice(null); setResolved(null);
    try {
      const response = await saveProject(input);
      if (response.ok) { setDialog(null); setNotice(`Mapping ${response.data!.project_key} saved. No Notion content was changed.`); await refresh(); }
      else setFailure(`${response.code}: ${response.errors.join(' ')}`);
    } catch { setFailure('Backend response unavailable. Restart and refresh before retrying; the save result is unknown.'); }
    finally { setBusy(false); }
  }
  async function resolve(projectKey?: string) {
    setBusy(true); setNotice(null); setResolved(null);
    try {
      const response = await resolveProject(projectKey ? { project_key: projectKey } : { name: resolveName });
      if (response.ok) { setResolved(response.data!); setNotice('The exact workspace identity and root page are accessible. This does not grant content-write permission.'); }
      else setNotice(`${response.code}: ${response.errors.join(' ')}`);
      await refresh();
    } catch { setNotice('Backend unavailable. Route access could not be checked.'); }
    finally { setBusy(false); }
  }
  return <>
    <div className="section-toolbar"><p>Each key selects one workspace and one root page. Stored mappings are configuration; use Check route for a fresh access check.</p>
      <button className="primary" disabled={busy || !data.capabilities.routing || !data.workspaces.length} onClick={() => open()}>Add mapping</button></div>
    {!data.workspaces.length ? <p className="hint">Connect a test workspace before adding a mapping.</p> : null}
    {notice ? <p role="status" className="notice">{notice}</p> : null}
    {resolved ? <section className="route-target" aria-label="Resolved route"><h3>{resolved.project_key} → {resolved.root_page.title}</h3>
      <p>{data.workspaces.find(w => w.id === resolved.workspace_id)?.label} · {resolved.name}</p><p className="mono">Workspace: {resolved.workspace_id}<br />Page: {resolved.root_page.id}</p>
      <p className="hint">Checked {new Date(resolved.validated_at).toLocaleString()}. Revision {resolved.revision}.</p></section> : null}
    <label className="form-field route-filter">Filter mappings<input aria-label="Filter mappings" value={filter} onChange={event => setFilter(event.target.value)} /></label>
    {visible.length ? <div className="project-list">{visible.map(route => {
      const sameName = data.projects.filter(other => other.project_key !== route.project_key && other.name.normalize('NFKC').trim().toLowerCase() === route.name.normalize('NFKC').trim().toLowerCase());
      return <section className="project-route" key={route.project_key} aria-label={`Mapping ${route.project_key}`}><div className="list-row"><h2>{route.project_key} · {route.name}</h2><span className="field-hint">Revision {route.revision}</span></div>
        <dl><dt>Workspace</dt><dd>{data.workspaces.find(w => w.id === route.workspace_id)?.label ?? 'Unavailable workspace'}<small className="mono">{route.workspace_id}</small></dd>
          <dt>Root page</dt><dd>{route.root_page.title}<small className="mono">{route.root_page.id}</small></dd>
          <dt>Saved validation</dt><dd>{new Date(route.validated_at).toLocaleString()}</dd></dl>
        {sameName.length ? <p className="notice">Name also used by {sameName.map(other => other.project_key).join(', ')}. Name-based resolution is ambiguous; use a key.</p> : null}
        <div className="workspace-actions"><button disabled={busy} onClick={() => open(route)}>Edit mapping</button><button disabled={busy} onClick={() => void resolve(route.project_key)}>Check route</button></div>
      </section>;
    })}</div> : <EmptyState title={data.projects.length ? 'No matching mappings' : 'No project routes configured'}>Add an exact project key, workspace and inspected root page.</EmptyState>}
    <section className="name-resolution"><h2>Resolve a project name</h2><p>Names must match exactly and be unique. Duplicate names are rejected before reading any workspace.</p>
      <div className="page-search"><label>Exact project name<input aria-label="Exact project name" maxLength={80} value={resolveName} onChange={event => setResolveName(event.target.value)} /></label>
        <button disabled={busy || !resolveName.trim()} onClick={() => void resolve()}>Resolve name</button></div></section>
    {dialog ? <ProjectRouteDialog workspaces={data.workspaces} routes={data.projects} route={dialog.route} busy={busy} failure={failure} onClose={() => setDialog(null)} onSave={save} refresh={refresh} /> : null}
  </>;
}
