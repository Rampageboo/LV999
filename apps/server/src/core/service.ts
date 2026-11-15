import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { APP_ID, APP_VERSION, NOTION_VERSION, ConnectWorkspaceInput, ReauthorizeWorkspaceInput, WorkspaceInput,
  result, type Result, type Snapshot, type WorkspaceConfig, type WorkspaceView } from '../../../../packages/contracts/src/index.js';
import { DomainError, OfficialNotionAdapter, safeError, type NotionAdapter, type Identity } from '../notion/adapter.js';
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
  private assertTestName(name: string) {
    if (['vibecode', 'honour'].includes(name.trim().toLowerCase()))
      throw new DomainError('TEST_WORKSPACE_ONLY', 'Only test workspaces may be connected. Vibecode and Honour remain blocked.');
  }
  private async identity(adapter: NotionAdapter, expectedId?: string) {
    const parsed = z.object({ workspace_id: z.uuid(), workspace_name: z.string().trim().min(1).max(200), bot_id: z.uuid() })
      .safeParse(await adapter.identity());
    if (!parsed.success) throw new DomainError('IDENTITY_UNAVAILABLE', 'Notion did not return a complete workspace identity.');
    const identity = { ...parsed.data, workspace_id: parsed.data.workspace_id.toLowerCase() };
    if (expectedId && identity.workspace_id !== expectedId.toLowerCase())
      throw new DomainError('WORKSPACE_MISMATCH', 'The token belongs to a different workspace. No content request was sent; the previous credential was kept.');
    this.assertTestName(identity.workspace_name);
    return identity;
  }
  private async readAccess(adapter: NotionAdapter): Promise<NonNullable<WorkspaceView['read_access']>> {
    const response = z.object({ results: z.array(z.unknown()).max(50), has_more: z.boolean() }).safeParse(await adapter.search(''));
    if (!response.success) throw new DomainError('IDENTITY_UNAVAILABLE', 'Notion returned an invalid read-access response. The connection was not saved.');
    return { checked_at: new Date().toISOString(), sampled_objects: response.data.results.length, has_more: response.data.has_more };
  }
  private proof(identity: Identity, access: WorkspaceView['read_access']): Partial<WorkspaceView> {
    return { status: 'Connected', verified_name: identity.workspace_name, bot_id: identity.bot_id,
      checked_at: new Date().toISOString(), code: 'OK', message: null, read_access: access };
  }
  private async verifiedAdapter(id: string) {
    const config = this.store.list().find(w => w.id === id);
    if (!config) throw new DomainError('UNKNOWN_WORKSPACE', 'Select a registered test workspace.');
    if (config.environment !== 'test' || ['vibecode','honour'].includes(config.label.toLowerCase()))
      throw new DomainError('TEST_WORKSPACE_ONLY', 'Only test workspaces are allowed during development.');
    const token = await this.vault.read(id);
    if (!token) throw new DomainError('AUTH_REQUIRED', 'No token is stored for this workspace in Windows Credential Manager.');
    const adapter = this.makeAdapter(token);
    return { adapter, identity: await this.identity(adapter, id) };
  }
  private failed<T>(id: string | null, action: string, error: unknown, updateStatus = true): Result<T> {
    const failure = safeError(error);
    if (id && updateStatus) this.store.verification(id, { status: failure.code === 'AUTH_REQUIRED' ? 'Auth required' : 'Degraded',
      checked_at: new Date().toISOString(), code: failure.code, message: failure.message, read_access: null });
    this.store.log({ level: 'error', action, workspace_id: id, code: failure.code });
    return result<T>(null, id, failure.code, [failure.message]);
  }
  private connectionReply(id: string) {
    const view = this.store.list().find(w => w.id === id)!;
    const reply = result(view, id);
    if (view.read_access?.sampled_objects === 0)
      reply.warnings.push('Identity and search access verified, but no shared objects were returned. Share a test root page with this connection; indexing may take time.');
    return reply;
  }
  // The vault and SQLite cannot share a transaction. Compensate local failures before returning success.
  private async saveCredential(config: WorkspaceConfig, token: string, proof: Partial<WorkspaceView>, replace: boolean) {
    const owner = randomUUID();
    if (!this.store.acquireConnection(config.id, owner))
      throw new DomainError('CONNECTION_BUSY', 'Another LV999 instance is saving this connection. Wait and refresh before retrying.');
    try {
      if (!replace && this.store.list().some(w => w.id === config.id))
        throw new DomainError('WORKSPACE_EXISTS', 'This workspace was connected by another instance. Refresh and use Reauthorize.');
      const previousToken = await this.vault.read(config.id);
      try {
        await this.vault.write(config.id, token);
        if (await this.vault.read(config.id) !== token)
          throw new DomainError('VAULT_UNAVAILABLE', 'The saved credential could not be read back.');
        this.store.saveConnection(config, proof, replace, owner);
      } catch (error) {
        try {
          if (previousToken === null) await this.vault.remove(config.id);
          else await this.vault.write(config.id, previousToken);
          if (await this.vault.read(config.id) !== previousToken) throw new Error('ROLLBACK_READBACK_FAILED');
        } catch {
          throw new DomainError('CREDENTIAL_STATE_UNCERTAIN', 'Saving failed and the prior credential could not be confirmed. Reconnect or reauthorize this workspace before using it.');
        }
        if (error instanceof DomainError) throw error;
        throw new DomainError('LOCAL_SAVE_FAILED', 'The local connection could not be saved. The previous credential was restored; retry after checking local storage.');
      }
    } finally { this.store.releaseConnection(config.id, owner); }
  }
  async connectWorkspace(input: unknown): Promise<Result<WorkspaceView>> {
    let id: string | null = null;
    try {
      const parsed = ConnectWorkspaceInput.safeParse(input);
      if (!parsed.success) throw new DomainError('INVALID_INPUT', 'Enter a token, a display name of at most 80 characters, and confirm this is a test workspace.');
      const { label, token } = parsed.data;
      this.assertTestName(label);
      const adapter = this.makeAdapter(token);
      const identity = await this.identity(adapter);
      id = identity.workspace_id;
      if (this.store.list().some(w => w.id === id))
        throw new DomainError('WORKSPACE_EXISTS', 'This workspace is already connected. Use its Reauthorize action to replace the credential.');
      const access = await this.readAccess(adapter);
      const config = WorkspaceInput.parse({ id, label: label || identity.workspace_name.slice(0, 80), environment: 'test' });
      await this.saveCredential(config, token, this.proof(identity, access), false);
      return this.connectionReply(id);
    } catch (error) { return this.failed(id, 'Workspace connection failed', error, error instanceof DomainError && error.code === 'CREDENTIAL_STATE_UNCERTAIN'); }
  }
  async reauthorizeWorkspace(input: unknown): Promise<Result<WorkspaceView>> {
    let id: string | null = null;
    try {
      const parsed = ReauthorizeWorkspaceInput.safeParse(input);
      if (!parsed.success) throw new DomainError('INVALID_INPUT', 'Select a registered test workspace and enter a replacement token.');
      id = parsed.data.workspace_id.toLowerCase();
      const current = this.store.list().find(w => w.id === id);
      if (!current) throw new DomainError('UNKNOWN_WORKSPACE', 'Select a registered test workspace.');
      this.assertTestName(current.label);
      const adapter = this.makeAdapter(parsed.data.token);
      const identity = await this.identity(adapter, id);
      const access = await this.readAccess(adapter);
      await this.saveCredential(current, parsed.data.token, this.proof(identity, access), true);
      return this.connectionReply(id);
    } catch (error) { return this.failed(id, 'Workspace reauthorization failed', error, error instanceof DomainError && error.code === 'CREDENTIAL_STATE_UNCERTAIN'); }
  }
  private async read<T>(id: string, action: string, callback: (adapter: NotionAdapter) => Promise<T>): Promise<Result<T>> {
    try {
      const { adapter, identity } = await this.verifiedAdapter(id);
      const data = await callback(adapter);
      this.store.verification(id, this.proof(identity, this.store.list().find(w => w.id === id)?.read_access ?? null));
      this.store.log({ level: 'info', action, workspace_id: id, code: 'OK' });
      return result(data, id);
    } catch (error) {
      return this.failed<T>(id, action, error);
    }
  }
  async verify(id: string): Promise<Result<WorkspaceView>> {
    try {
      const { adapter, identity } = await this.verifiedAdapter(id);
      const access = await this.readAccess(adapter);
      this.store.verification(id, this.proof(identity, access));
      this.store.log({ level: 'info', action: 'Workspace verified', workspace_id: id, code: 'OK' });
      return this.connectionReply(id);
    } catch (error) { return this.failed(id, 'Workspace verification failed', error); }
  }
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
      capabilities: { connect_in_gui: true, routing: false, client_config: false, migration: false, content_write: false },
    };
  }
}
