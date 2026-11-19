import type { Snapshot } from '../../../../packages/contracts/src/index.js';
import { EmptyState, Status } from '../components/Primitives.js';
export function Dashboard({ data, navigate }: { data: Snapshot; navigate: (page: string) => void }) {
  return <>
    <div className="service-strip"><Status value={data.backend.status} /><span>{data.backend.transport}</span><span>{data.settings.read_only?'Read-only':'Scoped test-Workspace writes'}</span></div>
    {!data.workspaces.length||data.workspaces.some(w=>w.status!=='Connected')?<section className="setup-banner"><div><h2>Connect your Workspaces</h2><p>Authorize each target separately. Production targets start read-only.</p></div><button className="primary" onClick={() => navigate('Workspaces')}>Set up connections</button></section>:null}
    <section><h2>First-run checks</h2><div className="checks">{data.diagnostics.map(check => <div className="check" key={check.key}><strong>{check.label}</strong><span className={`check-symbol ${check.status}`} aria-label={check.status}>{check.status === 'pass' ? '✓' : check.status === 'error' ? '!' : '—'}</span><span>{check.detail}</span></div>)}</div></section>
    <div className="two-column"><section><h2>Workspaces</h2>{data.workspaces.length ? data.workspaces.map(w => <div className="list-row" key={w.id}><span>{w.verified_name ?? w.label}</span><Status value={w.status} /></div>) : <EmptyState title="No test workspaces connected" />}</section><section><h2>Recent activity</h2><div className="activity">{data.activity.slice(0, 4).map((event, i) => <div key={`${event.time}-${i}`}><span className={`activity-dot ${event.level}`} /><div>{event.action}<small>{new Date(event.time).toLocaleTimeString()} · {event.code}</small></div></div>)}</div></section></div>
    <footer>Content writes require explicit Workspace permission. Production targets start read-only. Migration remains a later milestone.</footer>
  </>;
}
