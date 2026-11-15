import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AccessiblePage } from '../../../../packages/contracts/src/index.js';
import { browsePages, inspectPage } from '../ipc/backend.js';

export function PageBrowser({ workspaceId, onSelect, onStateChange }: {
  workspaceId: string; onSelect?: (page: AccessiblePage) => void; onStateChange?: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [reference, setReference] = useState('');
  const [pages, setPages] = useState<AccessiblePage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string[]>([]);
  const [inspected, setInspected] = useState<AccessiblePage | null>(null);
  const requestId = useRef(0);
  const seenCursors = useRef(new Set<string>());

  async function load(reset: boolean) {
    const request = ++requestId.current;
    const nextQuery = reset ? query : appliedQuery;
    const nextCursor = reset ? undefined : cursor ?? undefined;
    setBusy(true); setFailure(null); setInspected(null);
    if (reset) { setPages([]); setCursor(null); setNotice([]); setAppliedQuery(nextQuery); seenCursors.current.clear(); }
    try {
      const response = await browsePages({ workspace_id: workspaceId, query: nextQuery, start_cursor: nextCursor });
      if (request !== requestId.current) return;
      if (!response.ok) { setFailure(`${response.code}: ${response.errors.join(' ')}`); setCursor(null); return; }
      const batch = response.data!;
      if (batch.next_cursor && seenCursors.current.has(batch.next_cursor)) {
        setFailure('Pagination repeated a cursor. Refresh the search before continuing.'); setCursor(null); return;
      }
      if (batch.next_cursor) seenCursors.current.add(batch.next_cursor);
      setPages(previous => [...new Map([...(reset ? [] : previous), ...batch.pages].map(page => [page.id, page])).values()]);
      setCursor(batch.next_cursor); setNotice(response.warnings);
    } catch { if (request === requestId.current) { setFailure('Backend unavailable. Refresh after reconnecting.'); setCursor(null); } }
    finally { if (request === requestId.current) { setBusy(false); void onStateChange?.(); } }
  }
  useEffect(() => { void load(true); return () => { requestId.current++; }; }, [workspaceId]);

  async function inspect(reference: string) {
    const request = ++requestId.current;
    setBusy(true); setFailure(null); setInspected(null);
    try {
      const response = await inspectPage(workspaceId, reference);
      if (request !== requestId.current) return;
      if (response.ok) setInspected(response.data!);
      else setFailure(`${response.code}: ${response.errors.join(' ')}`);
    } catch { if (request === requestId.current) setFailure('Backend unavailable. Page access could not be checked.'); }
    finally { if (request === requestId.current) { setBusy(false); void onStateChange?.(); } }
  }
  function search(event: FormEvent) { event.preventDefault(); void load(true); }

  return <section className="page-browser" aria-label="Accessible pages">
    <h3>Accessible pages</h3>
    <p className="hint">Search matches shared page titles. It is not a full inventory and newly shared pages may take time to appear. Inspect an exact link/ID if needed.</p>
    <div className="page-search" role="search">
      <label>Page title<input aria-label="Page title" value={query} maxLength={500} disabled={busy} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') search(event); }} /></label>
      <button type="button" disabled={busy} onClick={() => void load(true)}>Search pages</button>
      <button type="button" disabled={busy} onClick={() => void load(true)}>Refresh pages</button>
    </div>
    <div className="page-search"><label>Page link or ID<input aria-label="Page link or ID" value={reference} maxLength={2048} disabled={busy} onChange={event => setReference(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void inspect(reference); } }} /></label>
      <button type="button" disabled={busy || !reference.trim()} onClick={() => void inspect(reference)}>Inspect exact page</button></div>
    {busy ? <p role="status">Checking page access…</p> : null}
    {failure ? <p role="alert" className="form-error">{failure}</p> : null}
    {notice.map(message => <p key={message} className="field-hint">{message}</p>)}
    <p className="field-hint">{pages.length} pages loaded{appliedQuery ? ` for “${appliedQuery}”` : ''}.</p>
    {!busy && pages.length === 0 && !failure ? <p>No matching pages found. Try refreshing, check page sharing, or inspect an exact page link/ID.</p> : null}
    <ul className="page-results">{pages.map(page => <li key={page.id}>
      <div><strong>{page.title}</strong><span className="mono">{page.id}</span><small>{page.parent_kind}{!page.root_eligible ? ` · ${page.root_reason}` : ''}</small></div>
      <button type="button" disabled={busy} onClick={() => void inspect(page.id)}>Inspect page</button>
    </li>)}</ul>
    {cursor ? <button type="button" disabled={busy} onClick={() => void load(false)}>Load more pages</button> : null}
    {inspected ? <div className="page-inspection" role="region" aria-label="Inspected page">
      <h3>{inspected.title}</h3><dl><dt>Workspace ID</dt><dd className="mono">{inspected.workspace_id}</dd><dt>Page ID</dt><dd className="mono">{inspected.id}</dd>
        <dt>Notion URL</dt><dd className="mono">{inspected.url}</dd><dt>Parent type</dt><dd>{inspected.parent_kind}</dd><dt>Last edited</dt><dd>{inspected.last_edited_time ? new Date(inspected.last_edited_time).toLocaleString() : 'Not provided'}</dd></dl>
      {!inspected.root_eligible ? <p className="notice">{inspected.root_reason}</p> : null}
      {onSelect ? <button type="button" className="primary" disabled={!inspected.root_eligible || busy} onClick={() => onSelect(inspected)}>Use as project root</button> : null}
    </div> : null}
  </section>;
}
