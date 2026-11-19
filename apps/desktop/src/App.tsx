import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../../packages/contracts/src/index.js';
import { getSnapshot } from './ipc/backend.js';
import { Dashboard } from './screens/Dashboard.js';
import { Workspaces } from './screens/Workspaces.js';
import { MigrationManager, ActivityLogs, Settings } from './screens/OtherScreens.js';
import { AIClients } from './screens/AIClients.js';
import { Chats, type ChatSelection } from './screens/Chats.js';
import { ProjectRouting } from './screens/ProjectRouting.js';
import { NavIcon } from './components/NavIcon.js';
import { Content } from './screens/Content.js';

const pages = [
  ['Dashboard', '⌂', 'Your Notion connections, in one place.'],
  ['Workspaces', '▱', 'Separate connections. Verified identities.'],
  ['Routing', '⑂', 'One clear destination for every project.'],
  ['Content', '▤', 'Create and edit content in an explicit Workspace.'],
  ['Clients', '♧', 'Connect your AI tools to the same backend.'],
  ['Chats', '◇', 'Workspace groups and project conversations, together.'],
  ['Migration', '⇄', 'Move forward without losing the source.'],
  ['Logs', '▤', 'See what happened and what needs attention.'],
  ['Settings', '⚙', 'Your local service and security settings.'],
];
export function App() {
  const [page, setPage] = useState('Dashboard');
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [chatSelection, setChatSelection] = useState<ChatSelection>(null);
  const openChat = (selection: ChatSelection) => { setChatSelection(selection); setPage('Chats'); };
  const inFlight = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    setLoading(true);
    const request = getSnapshot().then(snapshot => { setData(snapshot); setError(null); })
      .catch(error => { setError(error instanceof Error ? error.message : String(error)); setData(null); })
      .finally(() => { setLoading(false); inFlight.current = null; });
    inFlight.current = request;
    return request;
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  let content;
  if (data) {
    switch (page) {
      case 'Dashboard': content = <Dashboard data={data} navigate={setPage} />; break;
      case 'Workspaces': content = <Workspaces data={data} refresh={refresh} openChat={openChat} />; break;
      case 'Routing': content = <ProjectRouting data={data} refresh={refresh} openChat={openChat} />; break;
      case 'Content': content = <Content data={data} refresh={refresh} />; break;
      case 'Clients': content = <AIClients data={data} />; break;
      case 'Chats': content = <Chats data={data} selection={chatSelection} onSelect={setChatSelection} />; break;
      case 'Migration': content = <MigrationManager data={data} />; break;
      case 'Logs': content = <ActivityLogs data={data} />; break;
      case 'Settings': content = <Settings data={data} />; break;
    }
  }
  return <div className="app-shell"><aside><div className="brand">LV999</div><nav aria-label="Main navigation">{pages.map(([name]) => <button key={name} aria-current={page === name ? 'page' : undefined} className={page === name ? 'selected' : ''} onClick={() => setPage(name)}><NavIcon name={name} />{name}</button>)}</nav><div className="sidebar-footer">Local workspace console</div></aside><main id="main-content" className={page === 'Chats' ? 'chat-main' : undefined}><header><div><h1>{page}</h1><p>{pages.find(([name]) => name === page)?.[2]}</p></div><button className="primary" disabled={loading} onClick={() => void refresh()}><span aria-hidden="true">↻</span> {loading ? 'Checking…' : 'Refresh status'}</button></header>{error ? <div role="alert" className="backend-error"><h2>Backend unavailable</h2><p>{error}</p><p>Connection status is unknown. Refresh after restoring the desktop backend.</p></div> : null}{!data && !error ? <p role="status">Checking the local backend…</p> : content}{data ? <div className="snapshot-time">Last refreshed {new Date(data.captured_at).toLocaleTimeString()}</div> : null}</main></div>;
}
