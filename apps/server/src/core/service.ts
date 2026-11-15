import { APP_ID, APP_VERSION, NOTION_VERSION, result, type Result, type Snapshot } from '../../../../packages/contracts/src/index.js';
import { DomainError, OfficialNotionAdapter, safeError, type NotionAdapter } from '../notion/adapter.js';
import { Store } from '../infra/store.js';
import type { Vault } from '../infra/vault.js';

export class Service {
  readonly started = new Date().toISOString();
  private vaultReady = false;
  constructor(readonly store: Store, private vault: Vault,
    private makeAdapter: (token: string) => NotionAdapter = token => new OfficialNotionAdapter(token)) {}
  async initialize() {
    this.vaultReady = await this.vault.probe();
    this.store.log({ level: 'info', action: 'Backend started', workspace_id: null, code: 'OK' });
  }
  async verifiedAdapter(id: string): Promise<NotionAdapter> {
    const config = this.store.list().find(w => w.id === id);
    if (!config) throw new DomainError('UNKNOWN_WORKSPACE', 'Select a registered test workspace.');
    if (config.environment !== 'test' || ['vibecode','honour'].includes(config.label.toLowerCase()))
      throw new DomainError('TEST_WORKSPACE_ONLY', 'Production workspaces are blocked during Milestone 0.');
    const token = await this.vault.read(id);
    if (!token) throw new DomainError('AUTH_REQUIRED', 'No token is stored for this workspace in Windows Credential Manager.');
    const adapter = this.makeAdapter(token);
    const identity = await adapter.identity();
    if (identity.workspace_id !== id.toLowerCase())
      throw new DomainError('WORKSPACE_MISMATCH', 'The token belongs to a different workspace. No content request was sent.');
    if (['vibecode','honour'].includes(identity.workspace_name.trim().toLowerCase()))
      throw new DomainError('TEST_WORKSPACE_ONLY', 'Production workspace identity detected. Content access is blocked.');
    this.store.verification(id, { status: 'Connected', verified_name: identity.workspace_name,
      bot_id: identity.bot_id, checked_at: new Date().toISOString(), code: 'OK', message: null });
    return adapter;
  }
  private async read<T>(id: string, action: string, callback: (adapter: NotionAdapter) => Promise<T>): Promise<Result<T>> {
    try {
      const data = await callback(await this.verifiedAdapter(id));
      this.store.log({ level: 'info', action, workspace_id: id, code: 'OK' });
      return result(data, id);
    } catch (error) {
      const failure = safeError(error);
      this.store.verification(id, { status: failure.code === 'AUTH_REQUIRED' ? 'Auth required' : 'Degraded',
        checked_at: new Date().toISOString(), code: failure.code, message: failure.message });
      this.store.log({ level: 'error', action, workspace_id: id, code: failure.code });
      return result<T>(null, id, failure.code, [failure.message]);
    }
  }
  verify(id: string) { return this.read(id, 'Workspace verified', async () => this.store.list().find(w => w.id === id)!); }
  search(id: string, query: string, cursor?: string) { return this.read(id, 'Workspace search', a => a.search(query, cursor)); }
  page(id: string, pageId: string) { return this.read(id, 'Page read', a => a.page(pageId)); }
  snapshot(): Snapshot {
    const workspaces = this.store.list();
    return {
      app_version: APP_VERSION, app_id: APP_ID, captured_at: new Date().toISOString(),
      backend: { status: 'Running', pid: process.pid, node: process.version, executable: process.execPath,
        transport: 'Private stdio', started_at: this.started },
      diagnostics: [
        { key: 'runtime', label: 'Node runtime', status: 'pass', detail: `${process.version} · ${process.arch}` },
        { key: 'vault', label: 'Credential vault', status: this.vaultReady ? 'pass' : 'error', detail: this.vaultReady ? 'Windows Credential Manager available' : 'Windows Credential Manager unavailable' },
        { key: 'notion', label: 'Notion connections', status: workspaces.length >= 2 && workspaces.every(w => w.status === 'Connected') ? 'pass' : 'pending',
          detail: `${workspaces.filter(w => w.status === 'Connected').length} verified / ${workspaces.length} configured · two test workspaces required` },
        { key: 'transport', label: 'Management transport', status: 'pass', detail: 'Private process pipes · no listening port' },
      ],
      workspaces, activity: this.store.activity(), projects: [],
      clients: ['Claude Code', 'Codex'].map(name => ({ name, status: 'Not tested', detail: 'Client configuration and live handshake arrive in Milestone 1.' })),
      jobs: [], settings: { read_only: true, remote_enabled: false, autostart: false, api_version: NOTION_VERSION,
        data_dir: this.store.directory, updater_configured: false },
      capabilities: { connect_in_gui: false, routing: false, client_config: false, migration: false, content_write: false },
    };
  }
}
