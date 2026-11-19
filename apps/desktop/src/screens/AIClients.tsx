import { useEffect, useState } from 'react';
import type { ClientKind, ClientView, GeneratedConfig, Snapshot } from '../../../../packages/contracts/src/index.js';
import { detectClients, generateClientConfig, testClient,previewClientConfig,applyClientConfig,type ClientConfigPreview } from '../ipc/backend.js';

export function AIClients({ data }: { data: Snapshot }) {
  const [clients, setClients] = useState<ClientView[]>(data.clients);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [config, setConfig] = useState<GeneratedConfig | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const [access, setAccess] = useState<Record<ClientKind, string[]>>({ claude: [], codex: [] });
  const [writes,setWrites]=useState<Record<ClientKind,string[]>>({claude:[],codex:[]});
  const [reads,setReads]=useState<Record<ClientKind,string[]>>({claude:data.workspaces.filter(w=>w.environment==='test').map(w=>w.id),codex:data.workspaces.filter(w=>w.environment==='test').map(w=>w.id)});
  const [preview,setPreview]=useState<ClientConfigPreview|null>(null);
  async function detect() {
    setBusy('detect'); setFailure(null);
    try { const response = await detectClients(); if (response.ok) setClients(response.data!); else setFailure(response.errors.join(' ')); }
    catch { setFailure('Backend unavailable. Client configuration could not be detected.'); } finally { setBusy(null); }
  }
  useEffect(() => { void detect(); }, []);
  async function generate(client: ClientKind) {
    setBusy(client); setFailure(null); setCopyMessage('');setPreview(null);
    try { const response = await generateClientConfig(client, access[client],writes[client],reads[client]); if (response.ok) setConfig(response.data!); else setFailure(response.errors.join(' ')); }
    catch { setFailure('Configuration generation failed. No client file was changed.'); } finally { setBusy(null); }
  }
  async function test(client: ClientKind, kind: 'native' | 'sdk') {
    setBusy(client); setFailure(null);
    try {
      const response = await testClient(client, kind, access[client],writes[client],reads[client]);
      if (response.data) setClients(previous => previous.map(item => item.id === client ? response.data! : item));
      if (!response.ok) setFailure(response.errors.join(' '));
    } catch { setFailure('Handshake response unavailable. No connection success is assumed.'); } finally { setBusy(null); }
  }
  return <>
    <div className="section-toolbar"><p>Installation, saved configuration and handshake evidence are separate. Tests use an isolated client profile and never start a model turn.</p>
      <button disabled={busy !== null} onClick={() => void detect()}>Detect clients</button></div>
    {failure ? <p role="alert" className="form-error">{failure}</p> : null}
    {busy ? <p role="status">Checking local client integration…</p> : null}
    {clients.map(client => <section className="client-config" key={client.id} aria-label={`${client.name} integration`}>
      <div className="list-row"><h2>{client.name}</h2><strong>{client.status}</strong></div>
      <dl><dt>Installed version</dt><dd>{client.version ?? 'Not detected'}</dd><dt>CLI path</dt><dd className="mono">{client.executable ?? 'Not found on PATH'}</dd>
        <dt>User configuration</dt><dd className="mono">{client.config_path}</dd><dt>LV999 entry</dt><dd>{client.config_state}</dd></dl>
      <p>{client.detail}</p>
      <fieldset className="chat-permissions" disabled={busy !== null}><legend>Chat access in the generated configuration (opt-in)</legend>
        {data.workspaces.length ? data.workspaces.map(workspace => <label className="test-confirm" key={workspace.id}><input type="checkbox" checked={access[client.id].includes(workspace.id)}
          onChange={event => { setAccess(previous => ({ ...previous, [client.id]: event.target.checked ? [...previous[client.id], workspace.id] : previous[client.id].filter(id => id !== workspace.id) })); setConfig(null); }} />{workspace.label}</label>)
          : <p className="field-hint">No Workspace is configured. New configurations grant no chat access until selected here.</p>}
      </fieldset>
      <fieldset className="chat-permissions" disabled={busy!==null}><legend>Notion read access in the generated configuration</legend>
        {data.workspaces.map(workspace=><label className="test-confirm" key={workspace.id}><input type="checkbox" checked={reads[client.id].includes(workspace.id)} onChange={event=>{setReads(previous=>({...previous,[client.id]:event.target.checked?[...previous[client.id],workspace.id]:previous[client.id].filter(id=>id!==workspace.id)}));if(!event.target.checked)setWrites(previous=>({...previous,[client.id]:previous[client.id].filter(id=>id!==workspace.id)}));setConfig(null);}}/>{workspace.label} · {workspace.environment==='production'?'Production target':'Test'}</label>)}
        <p className="field-hint">Production access is always opt-in. Selecting no Workspaces generates a profile with no content read access. Legacy unscoped profiles can read only test connections.</p>
      </fieldset>
      <fieldset className="chat-permissions" disabled={busy!==null}><legend>Notion write access in the generated configuration (opt-in)</legend>
        {data.workspaces.map(workspace=><label className="test-confirm" key={workspace.id}><input type="checkbox" disabled={!workspace.write_enabled||!reads[client.id].includes(workspace.id)} checked={writes[client.id].includes(workspace.id)} onChange={event=>{setWrites(previous=>({...previous,[client.id]:event.target.checked?[...previous[client.id],workspace.id]:previous[client.id].filter(id=>id!==workspace.id)}));setConfig(null);}}/>{workspace.label}{!workspace.write_enabled?' · enable Workspace writes on Content first':!reads[client.id].includes(workspace.id)?' · select read access first':''}</label>)}
      </fieldset>
      <p className="field-hint">Selections affect the generated snippet and isolated tests only. They do not change an existing client's permissions.</p>
      <div className="workspace-actions"><button disabled={busy !== null} onClick={() => void generate(client.id)}>Generate configuration</button>
        <button disabled={busy !== null} onClick={() => void test(client.id, 'sdk')}>Test LV999 transport</button>
        <button disabled={busy !== null || !client.executable} onClick={() => void test(client.id, 'native')}>Test native client</button></div>
      {client.handshake ? <div className="notice" role="status"><strong>{client.handshake.ok ? 'Handshake passed' : 'Handshake not confirmed'} · {client.handshake.kind === 'native' ? 'Installed client / isolated profile' : 'LV999 SDK transport'}</strong>
        <p>{client.handshake.detail}</p><small>{new Date(client.handshake.checked_at).toLocaleString()} · {client.handshake.tool_count} tools discovered. Saved user configuration is unchanged.</small></div> : null}
    </section>)}
    {config ? <section className="generated-config" aria-label="Generated client configuration"><h2>{config.client === 'claude' ? 'Claude Code' : 'Codex'} configuration · {config.format}</h2>
      <p>Apply only the LV999 entry to <span className="mono">{config.config_path}</span>, or copy it for a manual merge. Close the native client before applying; restart/reload it afterwards. Existing files are backed up and unrelated settings are preserved.</p>
      <textarea aria-label="Generated configuration" readOnly value={config.text} spellCheck={false} rows={10} />
      <button onClick={() => {
        if (!navigator.clipboard) { setCopyMessage('Copy unavailable. Select the text above.'); return; }
        void navigator.clipboard.writeText(config.text).then(() => setCopyMessage('Configuration copied.'), () => setCopyMessage('Copy unavailable. Select the text above.'));
      }}>Copy configuration</button>
      <button disabled={busy!==null} onClick={async()=>{setBusy(config.client);setFailure(null);try{const response=await previewClientConfig(config);if(response.ok)setPreview(response.data!);else setFailure(response.errors.join(' '));}catch{setFailure('Configuration preview unavailable. No file was changed.');}finally{setBusy(null);}}}>Preview application</button>
      {preview?<div className="notice"><p>{preview.replaces_existing_entry?'Replace the existing LV999 entry':'Add the LV999 entry'} · {preview.config_path}. {preview.backup_required?'A backup will be created.':'No existing file.'}</p><button disabled={busy!==null} onClick={async()=>{setBusy(config.client);setFailure(null);try{const response=await applyClientConfig(preview.plan_id);if(response.ok){setCopyMessage(`Configuration applied. Reload the native client.${response.data!.backup_path?' Backup: '+response.data!.backup_path:''}`);setPreview(null);await detect();}else setFailure(response.errors.join(' '));}catch{setFailure('Application result unknown. Detect configuration before retrying.');}finally{setBusy(null);}}}>Apply reviewed LV999 entry</button></div>:null}
      {copyMessage ? <p role="status">{copyMessage}</p> : null}
    </section> : null}
  </>;
}
