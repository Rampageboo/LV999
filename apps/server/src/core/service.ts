import { z } from 'zod';
import { randomUUID,createHash } from 'node:crypto';
import { APP_ID, APP_VERSION, NOTION_VERSION, ConnectWorkspaceInput, ReauthorizeWorkspaceInput, WorkspaceInput,
  BrowsePagesInput, InspectPageInput, SaveProjectInput, ResolveProjectInput,
  result,isProtectedWorkspaceName, type Result, type Snapshot, type WorkspaceConfig, type WorkspaceView, type AccessiblePage, type PageBatch, type ProjectRoute,type WorkspaceEnvironmentId } from '../../../../packages/contracts/src/index.js';
import { DomainError, OfficialNotionAdapter, safeError, type NotionAdapter, type Identity } from '../notion/adapter.js';
import { Store, projectNameLookup } from '../infra/store.js';
import { pageBatch, pageMetadata, pageReference } from '../notion/page-metadata.js';
import type { Vault } from '../infra/vault.js';
import { ClientManager } from '../management/clients.js';
import { MessageHub } from '../messenger/hub.js';
import { WakeEngine } from '../messenger/wake-engine.js';
import type { AgentBridge } from '../messenger/native-bridge.js';
import type { ChatIdentity } from '../../../../packages/contracts/src/index.js';
import { NotionOAuth } from '../management/notion-oauth.js';
import { decodeCredential, encodeCredential, type OAuthCredential, type OAuthEvidence, type OAuthExchange } from '../notion/oauth-credential.js';
import { ContentService } from './content-service.js';
import { notionRequestSignal } from '../notion/request-budget.js';
import {MessageBoards} from './boards.js';
import type {SourceReadAccess} from './source-reader.js';
import {MigrationSnapshots} from './migration-snapshots.js';

export class Service {
  readonly started = new Date().toISOString();
  private vaultReady = false;
  readonly clients: ClientManager;
  readonly messages: MessageHub;
  readonly wake:WakeEngine;
  readonly oauth: NotionOAuth;
  readonly content: ContentService;
  readonly boards:MessageBoards;
  readonly migrations:MigrationSnapshots;
  private makeAdapter:(token:string,oauth?:OAuthEvidence)=>NotionAdapter;
  constructor(readonly store: Store, private vault: Vault,
    makeAdapter?: (token: string, oauth?: OAuthEvidence) => NotionAdapter,
    local?: { clients?: ClientManager; bridge?:AgentBridge; oauth?: OAuthExchange; oauthPort?: number; oauthTtlMs?: number }) {
    this.makeAdapter=makeAdapter??((token,oauth)=>new OfficialNotionAdapter(token,undefined,oauth,()=>store.requestSlot(createHash('sha256').update(token).digest('hex'),notionRequestSignal())));
    this.clients = local?.clients ?? new ClientManager(store.directory);
    this.messages = new MessageHub(store);
    this.wake=new WakeEngine(this.messages,local?.bridge,{executable:this.clients.paths.executable,entry:this.clients.paths.entry});
    this.oauth = new NotionOAuth(store, vault, (credential, input) => this.connectOAuth(credential, input), local?.oauth, local?.oauthPort, local?.oauthTtlMs);
    this.content = new ContentService(store,id=>this.verifiedAdapter(id));
    this.boards=new MessageBoards(store,this.content);
    this.migrations=new MigrationSnapshots(store,vault);
  }
  detectClients() { return this.clients.detect(); }
  async sourceReader(workspaceId:string):Promise<SourceReadAccess>{
    if(this.store.list().find(w=>w.id===workspaceId)?.access_role!=='source')throw new DomainError('CONTENT_ACCESS_DENIED','Select an explicit read-only source connection.');
    const {adapter}=await this.verifiedAdapter(workspaceId);if(!adapter.content)throw new DomainError('INVALID_RESPONSE','Source content reader is unavailable.');
    const content=adapter.content;
    return Object.freeze({resource:content.resource.bind(content),children:content.children.bind(content),read:content.read.bind(content),...(content.comments?{comments:content.comments.bind(content)}:{}),...(content.property?{property:content.property.bind(content)}:{})});
  }
  generateClientConfig(input: unknown) { return this.clients.generate(input); }
  previewClientConfig(input:unknown){return this.clients.previewApply(input);}
  applyClientConfig(input:unknown){return this.clients.apply(input);}
  testClient(input: unknown) { return this.clients.test(input); }
  chatOverview() { return this.messages.overview({ actor: 'human', workspace_ids: 'owner' }); }
  readChat(input: unknown) { return this.messages.read({ actor: 'human', workspace_ids: 'owner' }, input); }
  sendChat(input: unknown) { return this.messages.send({ actor: 'human', workspace_ids: 'owner' }, input); }
  configureAgent(input:unknown){return this.wake.configure(input);}
  stopAgent(id:string){return this.wake.stop(id);}
  resumeAgent(id:string,revision:number){return this.wake.resume(id,revision);}
  retryWake(id:string,revision:number){return this.wake.retry(id,revision);}
  async initialize() {
    this.vaultReady = await this.vault.probe();
    this.store.log({ level: 'info', action: 'Backend started', workspace_id: null, code: 'OK' });
  }
  private assertAllowedWorkspace(name: string,id?:string,role?:'source'|'target') {
    if(projectNameLookup(name)==='honour')throw new DomainError('PROTECTED_WORKSPACE','Honour remains protected.');
    if(isProtectedWorkspaceName(name)||(id&&this.store.isProtected(id))){
      if(id)this.store.protect(id);
      if(role!=='source')throw new DomainError('PROTECTED_WORKSPACE','This protected Workspace requires an explicit read-only source connection.');
    }
  }
  private confirmEnvironment(input:{environment:WorkspaceEnvironmentId;expected_workspace_name?:string;access_role?:'source'|'target'},identity:Identity){
    if(input.access_role==='source'&&(input.environment!=='production'||projectNameLookup(identity.workspace_name)!=='vibecode'))throw new DomainError('WORKSPACE_MISMATCH','Only the explicitly authorized Vibecode source may use read-only source mode.');
    if(input.environment==='production'&&(!input.expected_workspace_name||projectNameLookup(input.expected_workspace_name)!==projectNameLookup(identity.workspace_name)))
      throw new DomainError('WORKSPACE_MISMATCH','Production authorization must match the exact expected Notion Workspace name. Nothing was saved and no content request was sent.');
  }
  private async identity(adapter: NotionAdapter, expectedId?: string,role?:'source'|'target') {
    const parsed = z.object({ workspace_id: z.uuid(), workspace_name: z.string().trim().min(1).max(200), bot_id: z.uuid() })
      .safeParse(await adapter.identity());
    if (!parsed.success) throw new DomainError('IDENTITY_UNAVAILABLE', 'Notion did not return a complete workspace identity.');
    const identity = { ...parsed.data, workspace_id: parsed.data.workspace_id.toLowerCase() };
    if (expectedId && identity.workspace_id !== expectedId.toLowerCase())
      throw new DomainError('WORKSPACE_MISMATCH', 'The token belongs to a different workspace. No content request was sent; the previous credential was kept.');
    this.assertAllowedWorkspace(identity.workspace_name,identity.workspace_id,role);
    if(role==='source'&&projectNameLookup(identity.workspace_name)!=='vibecode')throw new DomainError('WORKSPACE_MISMATCH','The source credential does not belong to Vibecode.');
    return identity;
  }
  private async readAccess(adapter: NotionAdapter): Promise<NonNullable<WorkspaceView['read_access']>> {
    const response = z.object({ results: z.array(z.unknown()).max(50), has_more: z.boolean() }).safeParse(await adapter.search(''));
    if (!response.success) throw new DomainError('IDENTITY_UNAVAILABLE', 'Notion returned an invalid read-access response. The connection was not saved.');
    return { checked_at: new Date().toISOString(), sampled_objects: response.data.results.length, has_more: response.data.has_more };
  }
  private proof(identity: Identity, access: WorkspaceView['read_access'], authKind: 'internal' | 'oauth'): Partial<WorkspaceView> {
    return { auth_kind: authKind,
      status: 'Connected', verified_name: identity.workspace_name, bot_id: identity.bot_id,
      checked_at: new Date().toISOString(), code: 'OK', message: null, read_access: access };
  }
  private async verifiedAdapter(id: string) {
    const config = this.store.list().find(w => w.id === id);
    if (!config) throw new DomainError('UNKNOWN_WORKSPACE', 'Select a registered Workspace.');
    this.assertAllowedWorkspace(config.label,id,config.access_role);
    const token = await this.vault.read(id);
    if (!token) throw new DomainError('AUTH_REQUIRED', 'No token is stored for this workspace in Windows Credential Manager.');
    const decoded = decodeCredential(token);
    if (decoded.oauth && decoded.oauth.identity.workspace_id.toLowerCase() !== id.toLowerCase())
      throw new DomainError('WORKSPACE_MISMATCH', 'The OAuth credential belongs to a different workspace. Reauthorize this workspace.');
    const adapter = this.makeAdapter(decoded.token, decoded.oauth);
    return { adapter, identity: await this.identity(adapter, id,config.access_role), authKind: decoded.oauth ? 'oauth' as const : 'internal' as const };
  }
  private failed<T>(id: string | null, action: string, error: unknown, updateStatus = true): Result<T> {
    const failure = safeError(error);
    if (id && updateStatus) this.store.verification(id, { auth_kind: this.store.list().find(w => w.id === id)?.auth_kind,
      status: failure.code === 'AUTH_REQUIRED' ? 'Auth required' : 'Degraded',
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
      if (!parsed.success) throw new DomainError('INVALID_INPUT', 'Enter a token, a display name of at most 80 characters, and confirm this is a Workspace.');
      if(parsed.data.environment==='production'&&!parsed.data.expected_workspace_name)throw new DomainError('INVALID_INPUT','Enter the exact expected Notion Workspace name for a production target.');
      const { label, token } = parsed.data;
      this.assertAllowedWorkspace(label,undefined,parsed.data.access_role);
      const adapter = this.makeAdapter(token);
      const identity = await this.identity(adapter,undefined,parsed.data.access_role);
      this.confirmEnvironment(parsed.data,identity);
      id = identity.workspace_id;
      if (this.store.list().some(w => w.id === id))
        throw new DomainError('WORKSPACE_EXISTS', 'This workspace is already connected. Use its Reauthorize action to replace the credential.');
      const access = await this.readAccess(adapter);
      const config = WorkspaceInput.parse({ id, label: label || identity.workspace_name.slice(0, 80), environment: parsed.data.environment,...(parsed.data.access_role==='source'?{access_role:'source'}:{}) });
      await this.saveCredential(config, token, this.proof(identity, access, 'internal'), false);
      return this.connectionReply(id);
    } catch (error) { return this.failed(id, 'Workspace connection failed', error, error instanceof DomainError && error.code === 'CREDENTIAL_STATE_UNCERTAIN'); }
  }
  async reauthorizeWorkspace(input: unknown): Promise<Result<WorkspaceView>> {
    let id: string | null = null;
    try {
      const parsed = ReauthorizeWorkspaceInput.safeParse(input);
      if (!parsed.success) throw new DomainError('INVALID_INPUT', 'Select a registered Workspace and enter a replacement token.');
      id = parsed.data.workspace_id.toLowerCase();
      const current = this.store.list().find(w => w.id === id);
      if (!current) throw new DomainError('UNKNOWN_WORKSPACE', 'Select a registered Workspace.');
      this.assertAllowedWorkspace(current.label,id,current.access_role);
      if(current.environment!==parsed.data.environment)throw new DomainError('WORKSPACE_MISMATCH','Reauthorization cannot change the registered environment.');
      if((current.access_role??'target')!==(parsed.data.access_role??'target'))throw new DomainError('WORKSPACE_MISMATCH','Reauthorization cannot change the connection role.');
      const adapter = this.makeAdapter(parsed.data.token);
      const identity = await this.identity(adapter, id,current.access_role);
      this.confirmEnvironment(parsed.data,identity);
      const access = await this.readAccess(adapter);
      await this.saveCredential(current, parsed.data.token, this.proof(identity, access, 'internal'), true);
      return this.connectionReply(id);
    } catch (error) { return this.failed(id, 'Workspace reauthorization failed', error, error instanceof DomainError && error.code === 'CREDENTIAL_STATE_UNCERTAIN'); }
  }
  private async connectOAuth(credential: OAuthCredential, input: { label: string; workspace_id?: string;environment:WorkspaceEnvironmentId;expected_workspace_name?:string;access_role?:'source'|'target' }) {
    let id: string | null = null;
    try {
      this.assertAllowedWorkspace(input.label,undefined,input.access_role);
      const adapter = this.makeAdapter(credential.access_token, credential);
      const identity = await this.identity(adapter, input.workspace_id ?? credential.identity.workspace_id,input.access_role);
      this.confirmEnvironment(input,identity);
      id = identity.workspace_id;
      const current = this.store.list().find(w => w.id === id);
      if (!input.workspace_id && current)
        throw new DomainError('WORKSPACE_EXISTS', 'This workspace is already connected. Select its Reauthorize action to replace the credential.');
      if (input.workspace_id && !current) throw new DomainError('UNKNOWN_WORKSPACE', 'The workspace is no longer registered.');
      if(current&&current.environment!==input.environment)throw new DomainError('WORKSPACE_MISMATCH','Reauthorization cannot change the registered environment.');
      if(current&&(current.access_role??'target')!==(input.access_role??'target'))throw new DomainError('WORKSPACE_MISMATCH','Reauthorization cannot change the connection role.');
      const access = await this.readAccess(adapter);
      const config = current ?? WorkspaceInput.parse({ id, label: input.label || identity.workspace_name.slice(0, 80), environment: input.environment,...(input.access_role==='source'?{access_role:'source'}:{}) });
      await this.saveCredential(config, encodeCredential(credential), this.proof(identity, access, 'oauth'), Boolean(input.workspace_id));
      return this.connectionReply(id);
    } catch (error) { return this.failed<WorkspaceView>(id, 'Workspace OAuth connection failed', error, error instanceof DomainError && error.code === 'CREDENTIAL_STATE_UNCERTAIN'); }
  }
  async refreshOAuth(id: string): Promise<Result<WorkspaceView>> {
    const owner = randomUUID(); let locked = false, refreshed = false;
    try {
      const current = this.store.list().find(w => w.id === id);
      if (!current) throw new DomainError('UNKNOWN_WORKSPACE', 'Select a registered Workspace.');
      if (current.auth_kind !== 'oauth') throw new DomainError('INVALID_INPUT', 'This workspace uses an Internal Connection. Use Reauthorize to replace its token.');
      this.assertAllowedWorkspace(current.label,id,current.access_role);
      if (!this.store.acquireConnection(id, owner)) throw new DomainError('CONNECTION_BUSY', 'Another instance is updating this connection.');
      locked = true;
      const raw = await this.vault.read(id), previous = raw ? decodeCredential(raw).oauth : undefined;
      if (!previous?.refresh_token) throw new DomainError('AUTH_REQUIRED', 'No OAuth refresh token is stored. Use Reauthorize to connect this workspace again.');
      if (previous.identity.workspace_id.toLowerCase() !== id.toLowerCase()) throw new DomainError('WORKSPACE_MISMATCH', 'The OAuth credential belongs to a different workspace.');
      const secret = await this.vault.read(`oauth-client/${previous.client_id}`);
      if (!secret) throw new DomainError('AUTH_REQUIRED', 'The OAuth client secret is missing. Restore its settings, then Reauthorize.');
      const credential = await this.oauth.exchange.token(previous.client_id, secret, { refresh_token: previous.refresh_token }, previous);
      refreshed = true;
      if (credential.identity.workspace_id.toLowerCase() !== id.toLowerCase() || credential.identity.bot_id !== previous.identity.bot_id)
        throw new DomainError('WORKSPACE_MISMATCH', 'The refreshed token returned a different workspace or connection identity. Reauthorize this workspace.');
      const adapter = this.makeAdapter(credential.access_token, credential), identity = await this.identity(adapter, id,current.access_role), access = await this.readAccess(adapter);
      const encoded = encodeCredential(credential);
      await this.vault.write(id, encoded);
      if (await this.vault.read(id) !== encoded) throw new Error();
      this.store.saveConnection(current, this.proof(identity, access, 'oauth'), true, owner);
      return this.connectionReply(id);
    } catch (error) {
      const failure = refreshed ? new DomainError('CREDENTIAL_STATE_UNCERTAIN', 'Notion renewed the credential, but saving or validation could not be confirmed. Use Reauthorize; the old refresh token may already be consumed.') : safeError(error);
      return this.failed(id, 'OAuth token refresh failed', failure, !['CONNECTION_BUSY','INVALID_INPUT','UNKNOWN_WORKSPACE'].includes(failure.code));
    } finally { if (locked) this.store.releaseConnection(id, owner); }
  }
  private async read<T>(id: string, action: string, callback: (adapter: NotionAdapter) => Promise<T>, targetRead = false): Promise<Result<T>> {
    try {
      const { adapter, identity, authKind } = await this.verifiedAdapter(id);
      const data = await callback(adapter);
      this.store.verification(id, this.proof(identity, this.store.list().find(w => w.id === id)?.read_access ?? null, authKind));
      this.store.log({ level: 'info', action, workspace_id: id, code: 'OK' });
      return result(data, id);
    } catch (error) {
      return targetRead ? this.targetFailure<T>(id, action, error) : this.failed<T>(id, action, error);
    }
  }
  async verify(id: string): Promise<Result<WorkspaceView>> {
    try {
      const { adapter, identity, authKind } = await this.verifiedAdapter(id);
      const access = await this.readAccess(adapter);
      this.store.verification(id, this.proof(identity, access, authKind));
      this.store.log({ level: 'info', action: 'Workspace verified', workspace_id: id, code: 'OK' });
      return this.connectionReply(id);
    } catch (error) { return this.failed(id, 'Workspace verification failed', error); }
  }
  search(id: string, query: string, cursor?: string) { return this.read(id, 'Workspace search', a => a.search(query, cursor)); }
  page(id: string, pageId: string) { return this.read(id, 'Page read', a => a.page(pageId), true); }
  async browsePages(input: unknown): Promise<Result<PageBatch>> {
    const parsed = BrowsePagesInput.safeParse(input);
    if (!parsed.success) return result<PageBatch>(null, null, 'INVALID_INPUT', ['Select a Workspace and a valid title query/cursor.']);
    const { workspace_id, query, start_cursor } = parsed.data;
    const reply = await this.read(workspace_id, 'Accessible pages searched', async adapter =>
      pageBatch(await adapter.search(query, start_cursor, true), workspace_id, start_cursor));
    if (reply.ok) {
      reply.warnings.push('Search is an index of shared pages, not a complete workspace inventory. Refresh for newly shared pages or check an exact page link/ID.');
      if (reply.data!.skipped_objects) reply.warnings.push(`${reply.data!.skipped_objects} incomplete or unsupported objects were omitted.`);
    }
    return reply;
  }
  private async inspect(workspaceId: string, pageId: string) {
    const { adapter, identity, authKind } = await this.verifiedAdapter(workspaceId);
    const page = pageMetadata(await adapter.page(pageId), workspaceId);
    if (page.id !== pageId) throw new DomainError('INVALID_RESPONSE', 'Notion returned a different page ID. No mapping was changed.');
    this.store.verification(workspaceId, this.proof(identity, this.store.list().find(w => w.id === workspaceId)?.read_access ?? null, authKind));
    return page;
  }
  private targetFailure<T>(id: string | null, action: string, error: unknown): Result<T> {
    const failure = safeError(error);
    // A missing/unshared object is not proof that the workspace connection itself failed.
    const connectionFailure = ['AUTH_REQUIRED', 'WORKSPACE_MISMATCH', 'PROTECTED_WORKSPACE', 'TEST_WORKSPACE_ONLY', 'VAULT_UNAVAILABLE', 'NETWORK_ERROR'].includes(failure.code);
    return this.failed<T>(id, action, failure, connectionFailure);
  }
  async inspectPage(input: unknown): Promise<Result<AccessiblePage>> {
    const parsed = InspectPageInput.safeParse(input);
    if (!parsed.success) return result<AccessiblePage>(null, null, 'INVALID_INPUT', ['Select a workspace and enter a page ID or Notion link.']);
    const id = parsed.data.workspace_id;
    try {
      const page = await this.inspect(id, pageReference(parsed.data.reference));
      this.store.log({ level: 'info', action: 'Page access checked', workspace_id: id, code: 'OK' });
      const reply = result(page, id); reply.resource_url = page.url;
      return reply;
    } catch (error) { return this.targetFailure(id, 'Page access check failed', error); }
  }
  private async rootPage(workspaceId: string, pageId: string) {
    const page = await this.inspect(workspaceId, pageId);
    if (!page.root_eligible) throw new DomainError('INELIGIBLE_ROOT', page.root_reason!);
    return page;
  }
  async saveProject(input: unknown): Promise<Result<ProjectRoute>> {
    const parsed = SaveProjectInput.safeParse(input);
    if (!parsed.success) return result<ProjectRoute>(null, null, 'INVALID_INPUT', ['Provide a unique project key, name, workspace, page ID and expected route revision.']);
    const value = parsed.data;
    try {
      if(this.store.list().find(w=>w.id===value.workspace_id)?.access_role==='source')throw new DomainError('WRITE_ACCESS_DENIED','A source connection cannot be a project destination.');
      const root = await this.rootPage(value.workspace_id, value.root_page_id);
      const route = this.store.saveProject(value, root);
      if (!route) throw new DomainError('ROUTE_CONFLICT', 'This project key was added or changed by another editor. Refresh the mappings and reopen the editor; nothing was overwritten.');
      const reply = result(route, value.workspace_id);
      reply.project_key = route.project_key; reply.resource_url = root.url;
      return reply;
    } catch (error) {
      const reply = this.targetFailure<ProjectRoute>(value.workspace_id, 'Project route save failed', error);
      reply.project_key = value.project_key;
      return reply;
    }
  }
  listProjects() { return result(this.store.projects()); }
  async resolveProject(input: unknown): Promise<Result<ProjectRoute>> {
    const parsed = ResolveProjectInput.safeParse(input);
    if (!parsed.success) return result<ProjectRoute>(null, null, 'INVALID_INPUT', ['Resolve by exactly one project key or exact project name.']);
    const routes = this.store.projects().filter(route => parsed.data.project_key ? route.project_key === parsed.data.project_key :
      projectNameLookup(route.name) === projectNameLookup(parsed.data.name!));
    if (!routes.length) return result<ProjectRoute>(null, null, 'UNKNOWN_PROJECT', ['No matching project route is configured.']);
    if (routes.length !== 1) return result<ProjectRoute>(null, null, 'AMBIGUOUS_TARGET', ['More than one project has this name. Select an exact project key; no workspace was guessed.']);
    const route = routes[0];
    try {
      const root = await this.rootPage(route.workspace_id, route.root_page.id);
      // Do not return a target that changed while its live validation was in flight.
      if (this.store.projects().find(current => current.project_key === route.project_key)?.revision !== route.revision)
        throw new DomainError('ROUTE_CONFLICT', 'The mapping changed during validation. Refresh and resolve again.');
      const reply = result({ ...route, root_page: root, validated_at: new Date().toISOString() }, route.workspace_id);
      reply.project_key = route.project_key; reply.resource_url = root.url;
      this.store.log({ level: 'info', action: `Project route ${route.project_key} resolved`, workspace_id: route.workspace_id, code: 'OK' });
      return reply;
    } catch (error) {
      const reply = this.targetFailure<ProjectRoute>(route.workspace_id, 'Project route resolution failed', error);
      reply.project_key = route.project_key;
      return reply;
    }
  }
  snapshot(): Snapshot {
    const boardRows=this.boards.list('owner').data??[];
    const workspaces = this.store.list().map(workspace=>({...workspace,write_enabled:this.content.enabled(workspace.id),board_append_projects:boardRows.filter(b=>b.workspace_id===workspace.id&&b.enabled&&b.route_current).map(b=>b.project_key)}));
    return {
      app_version: APP_VERSION, app_id: APP_ID, captured_at: new Date().toISOString(),
      backend: { status: 'Running', pid: process.pid, node: process.version, executable: process.execPath,
        transport: 'Private stdio', started_at: this.started },
      diagnostics: [
        { key: 'runtime', label: 'Node runtime', status: 'pass', detail: `${process.version} · ${process.arch}` },
        { key: 'vault', label: 'Credential vault', status: this.vaultReady ? 'pass' : 'error', detail: this.vaultReady ? 'Windows Credential Manager available' : 'Windows Credential Manager unavailable' },
        { key: 'notion', label: 'Notion connections', status: workspaces.length > 0 && workspaces.every(w => w.status === 'Connected') ? 'pass' : 'pending',
          detail: `${workspaces.filter(w => w.status === 'Connected').length} verified / ${workspaces.length} configured · ${workspaces.filter(w=>w.environment==='production'&&w.access_role!=='source').length} production targets` },
        { key: 'transport', label: 'Management transport', status: 'pass', detail: 'Private process pipes · OAuth callback listens only during authorization on localhost:8765' },
      ],
      workspaces, activity: this.store.activity(), projects: this.store.projects(),
      clients: this.clients.snapshot(),
      jobs: this.migrations.list(), settings: { read_only: !workspaces.some(w=>w.write_enabled||w.board_append_projects.length), remote_enabled: false, autostart: false, api_version: NOTION_VERSION,
        data_dir: this.store.directory, updater_configured: false },
      capabilities: { connect_in_gui: true, browse_pages: true, routing: true, client_config: true, group_chat: true, auto_wake: true, migration: false, content_write: true },
    };
  }
}
