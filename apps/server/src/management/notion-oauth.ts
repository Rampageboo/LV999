import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuthConfigInput, OAuthStartInput,isProtectedWorkspaceName, result, type OAuthStatus, type Result, type WorkspaceView,type WorkspaceEnvironmentId } from '../../../../packages/contracts/src/index.js';
import { DomainError, safeError } from '../notion/adapter.js';
import { OfficialOAuthExchange, type OAuthCredential, type OAuthExchange } from '../notion/oauth-credential.js';
import type { Store } from '../infra/store.js';
import type { Vault } from '../infra/vault.js';

type Start = { label: string; environment: WorkspaceEnvironmentId; workspace_id?: string;expected_workspace_name?:string };
export class NotionOAuth {
  private server: Server | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private phase: OAuthStatus['phase'] = 'idle';
  private outcome: Result<WorkspaceView> | null = null;
  private operation: Promise<void> | null = null;
  readonly redirectUri: string;
  constructor(private store: Store, private vault: Vault,
    private connect: (credential: OAuthCredential, input: Start) => Promise<Result<WorkspaceView>>,
    readonly exchange: OAuthExchange = new OfficialOAuthExchange(), private port = 8765, private ttlMs = 600000) {
    this.redirectUri = `http://localhost:${port}/oauth/notion/callback`;
  }
  clientId() { return this.store.db.prepare('SELECT client_id FROM oauth_settings WHERE singleton=1').get()?.client_id as string | undefined; }
  status(): OAuthStatus { return { configured: Boolean(this.clientId()), client_id: this.clientId() ?? null,
    redirect_uri: this.redirectUri, phase: this.phase, outcome: this.outcome }; }
  private failure<T>(error: unknown): Result<T> { const safe = safeError(error); return result<T>(null, null, safe.code, [safe.message]); }
  async configure(input: unknown) {
    try {
      const parsed = OAuthConfigInput.safeParse(input);
      if (!parsed.success) throw new DomainError('INVALID_INPUT', 'Enter a valid OAuth client ID and client secret.');
      if (this.phase === 'awaiting' || this.phase === 'exchanging') throw new DomainError('CONNECTION_BUSY', 'Finish or cancel the current authorization first.');
      const { client_id, client_secret } = parsed.data, key = `oauth-client/${client_id}`;
      const owner = randomBytes(24).toString('hex');
      if (!this.store.acquireConnection('oauth-settings', owner)) throw new DomainError('CONNECTION_BUSY', 'Another instance is saving OAuth settings.');
      try {
        const previous = await this.vault.read(key), secret = client_secret ?? previous;
        if (!secret) throw new DomainError('AUTH_REQUIRED', 'Enter the OAuth client secret from the Notion Developer portal.');
        try {
          await this.vault.write(key, secret);
          if (await this.vault.read(key) !== secret) throw new Error();
          this.store.db.prepare('INSERT INTO oauth_settings(singleton,client_id) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET client_id=excluded.client_id').run(client_id);
        } catch {
          try { if (previous === null) await this.vault.remove(key); else await this.vault.write(key, previous);
            if (await this.vault.read(key) !== previous) throw new Error(); }
          catch { throw new DomainError('CREDENTIAL_STATE_UNCERTAIN', 'OAuth settings could not be confirmed. Enter the client secret again before authorizing.'); }
          throw new DomainError('LOCAL_SAVE_FAILED', 'OAuth settings could not be saved. The previous secret was restored.');
        }
      } finally { this.store.releaseConnection('oauth-settings', owner); }
      return result(this.status());
    } catch (error) { return this.failure<OAuthStatus>(error); }
  }
  private stopListener() {
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    this.server?.close(); this.server?.closeAllConnections(); this.server = null;
  }
  cancel() {
    if (this.phase === 'exchanging') return this.failure<OAuthStatus>(new DomainError('CONNECTION_BUSY', 'The authorization is being verified. Wait for the result.'));
    this.stopListener(); this.phase = 'cancelled'; this.outcome = null;
    return result(this.status());
  }
  async close() { this.cancel(); await this.operation; this.stopListener(); }
  async start(input: unknown): Promise<Result<{ authorization_url: string }>> {
    try {
      const parsed = OAuthStartInput.safeParse(input);
      if (!parsed.success) throw new DomainError('INVALID_INPUT', 'Confirm a Workspace before authorizing.');
      if(parsed.data.environment==='production'&&!parsed.data.expected_workspace_name)throw new DomainError('INVALID_INPUT','Enter the exact Notion Workspace name for this production target.');
      if(isProtectedWorkspaceName(parsed.data.label)||isProtectedWorkspaceName(parsed.data.expected_workspace_name??''))throw new DomainError('PROTECTED_WORKSPACE','Vibecode and Honour remain protected; do not authorize them in this workflow.');
      if (this.phase === 'awaiting' || this.phase === 'exchanging') throw new DomainError('CONNECTION_BUSY', 'An authorization is already in progress.');
      const clientId = this.clientId();
      if (!clientId) throw new DomainError('AUTH_REQUIRED', 'Save your Notion OAuth app settings first.');
      const secret = await this.vault.read(`oauth-client/${clientId}`);
      if (!secret) throw new DomainError('AUTH_REQUIRED', 'The OAuth client secret is missing from Windows Credential Manager.');
      if (parsed.data.workspace_id && !this.store.list().some(w => w.id === parsed.data.workspace_id))
        throw new DomainError('UNKNOWN_WORKSPACE', 'Select a registered Workspace to reauthorize.');
      if(parsed.data.workspace_id&&this.store.list().find(w=>w.id===parsed.data.workspace_id)?.environment!==parsed.data.environment)throw new DomainError('WORKSPACE_MISMATCH','Reauthorization cannot change the registered environment.');
      const state = randomBytes(32).toString('base64url');
      this.phase = 'awaiting'; this.outcome = null;
      const server = createServer((request, response) => {
        response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        const finish = (code: number, text: string) => { response.writeHead(code); response.end(text); };
        if (request.method !== 'GET' || request.headers.host !== `localhost:${this.port}` || (request.url?.length ?? 0) > 6000)
          return finish(400, 'Invalid authorization callback. Return to LV999.');
        const url = new URL(request.url ?? '/', this.redirectUri), supplied = url.searchParams.get('state') ?? '';
        if (url.pathname !== '/oauth/notion/callback') return finish(404, 'Not found.');
        if (url.searchParams.getAll('state').length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(state)))
          return finish(400, 'Authorization state did not match. Start authorization from LV999.');
        if (this.phase !== 'awaiting') return finish(409, 'This authorization has already been used. Return to LV999.');
        const code = url.searchParams.get('code');
        if (url.searchParams.has('error')) {
          this.phase = 'cancelled'; finish(200, 'Notion authorization was declined. Return to LV999.');
          setImmediate(() => this.stopListener()); return;
        }
        if (!code || code.length > 2048 || url.searchParams.getAll('code').length !== 1)
          return finish(400, 'Authorization code missing. Start again from LV999.');
        this.phase = 'exchanging'; if (this.timer) clearTimeout(this.timer); this.timer = null;
        finish(200, 'Notion authorization received. Return to LV999 to see the verification result. You can close this tab.');
        this.operation = (async () => {
          try { this.outcome = await this.connect(await this.exchange.token(clientId, secret, { code, redirect_uri: this.redirectUri }), parsed.data);
            this.phase = this.outcome.ok ? 'complete' : 'failed'; }
          catch (error) { this.outcome = this.failure<WorkspaceView>(error); this.phase = 'failed'; }
          finally { this.stopListener(); }
        })();
      });
      server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxConnections = 8;
      this.server = server;
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host: '127.0.0.1', port: this.port, exclusive: true }, () => { server.removeListener('error', reject); resolve(); });
      }).catch(() => { this.stopListener(); this.phase = 'failed'; throw new DomainError('OAUTH_CALLBACK_BUSY', 'The local callback port is unavailable. Close the other authorization listener or LV999 instance, then retry.'); });
      this.timer = setTimeout(() => { this.phase = 'expired'; this.stopListener(); }, this.ttlMs); this.timer.unref();
      const url = new URL('https://api.notion.com/v1/oauth/authorize');
      url.search = new URLSearchParams({ client_id: clientId, response_type: 'code', owner: 'user', redirect_uri: this.redirectUri, state }).toString();
      return result({ authorization_url: url.toString() });
    } catch (error) { return this.failure<{ authorization_url: string }>(error); }
  }
}
