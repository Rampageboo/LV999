import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Service } from '../apps/server/src/core/service.js';
import { Store } from '../apps/server/src/infra/store.js';
import { OfficialNotionAdapter } from '../apps/server/src/notion/adapter.js';
import { OfficialOAuthExchange, decodeCredential, type OAuthCredential, type OAuthExchange } from '../apps/server/src/notion/oauth-credential.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const done of cleanup.splice(0).reverse()) await done(); });
async function freePort() {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
async function fixture(ttlMs = 600000) {
  const directory = mkdtempSync(join(tmpdir(), 'lv999-oauth-unit-')), store = new Store(directory), port = await freePort();
  const secrets = new Map<string, string>(), grants = new Map<string, OAuthCredential>();
  const vault = { read: vi.fn(async (key: string) => secrets.get(key) ?? null),
    write: vi.fn(async (key: string, secret: string) => { secrets.set(key, secret); }),
    remove: vi.fn(async (key: string) => { secrets.delete(key); }), probe: async () => true };
  const token = vi.fn<OAuthExchange['token']>(async (_id, _secret, grant) => grants.get('code' in grant ? grant.code : '')!);
  let invalidIdentity = false;
  const content = vi.fn();
  const service = new Service(store, vault, (secret, evidence) => new OfficialNotionAdapter(secret, async (url) => {
    const credential = [...grants.values()].find(c => c.access_token === secret)!;
    if (String(url).endsWith('/users/me')) return Response.json({ object: 'user', type: 'person', id: invalidIdentity ? randomUUID() : credential.owner_id });
    content(); return Response.json({ object: 'list', results: [], has_more: false, next_cursor: null });
  }, evidence), { oauth: { token }, oauthPort: port, oauthTtlMs: ttlMs });
  cleanup.push(async () => { await service.oauth.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const clientId = randomUUID(), clientSecret = randomUUID();
  expect((await service.oauth.configure({ client_id: clientId, client_secret: clientSecret })).ok).toBe(true);
  function grant(name = 'Test Alpha') {
    const code = randomUUID(), value: OAuthCredential = { kind: 'lv999-oauth-v1', client_id: clientId,
      access_token: randomUUID(), refresh_token: randomUUID(), owner_id: randomUUID(),
      identity: { workspace_id: randomUUID(), workspace_name: name, bot_id: randomUUID() } };
    grants.set(code, value); return { code, value };
  }
  async function start(extra = {}) {
    const reply = await service.oauth.start({ environment: 'test', label: '', ...extra }); expect(reply.ok).toBe(true);
    return new URL(reply.data!.authorization_url);
  }
  function callback(state: string | null, code?: string, extra = '') {
    const query = new URLSearchParams({ ...(state === null ? {} : { state }), ...(code ? { code } : {}) });
    return fetch(`http://localhost:${port}/oauth/notion/callback?${query}${extra}`);
  }
  return { service, store, secrets, vault, directory, port, grants, token, clientId, clientSecret, grant, start, callback, content,
    invalidateIdentity: () => { invalidIdentity = true; } };
}
it('one OAuth app connects two Workspaces with separate atomic vault credentials and no secret in SQLite/status', async () => {
  const f = await fixture(); const a = f.grant(), b = f.grant('Test Beta');
  for (const item of [a, b]) {
    const url = await f.start(); expect(url.origin + url.pathname).toBe('https://api.notion.com/v1/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe(f.clientId);
    expect((await f.callback(url.searchParams.get('state'), item.code)).status).toBe(200);
    await vi.waitFor(() => expect(f.service.oauth.status().phase).toBe('complete'));
  }
  expect(f.store.list()).toHaveLength(2);
  expect(f.service.chatOverview().data!.workspaces).toHaveLength(2);
  for (const item of [a, b]) {
    const saved = decodeCredential(f.secrets.get(item.value.identity.workspace_id)!);
    expect(saved.oauth?.refresh_token).toBe(item.value.refresh_token);
    expect((await f.service.verify(item.value.identity.workspace_id)).ok).toBe(true);
    expect(f.store.list().find(w => w.id === item.value.identity.workspace_id)?.auth_kind).toBe('oauth');
  }
  for (const secret of [f.clientSecret, a.code, a.value.access_token, a.value.refresh_token!, b.value.access_token]) {
    expect(JSON.stringify({ status: f.service.oauth.status(), snapshot: f.service.snapshot() })).not.toContain(secret);
    for (const file of ['registry.db', 'registry.db-wal']) expect(readFileSync(join(f.directory, file)).includes(Buffer.from(secret))).toBe(false);
  }
});
it('rejects missing, wrong, duplicate and non-ASCII state without consuming the valid authorization', async () => {
  const f = await fixture(), a = f.grant(), url = await f.start(), state = url.searchParams.get('state')!;
  for (const bad of [null, randomUUID(), 'é'.repeat(43)]) expect((await f.callback(bad, a.code)).status).toBe(400);
  expect((await f.callback(state, a.code, `&state=${state}`)).status).toBe(400);
  expect(f.token).not.toHaveBeenCalled();
  expect((await f.callback(state, a.code)).status).toBe(200);
  await vi.waitFor(() => expect(f.service.oauth.status().phase).toBe('complete'));
  expect(f.token).toHaveBeenCalledTimes(1);
});
it('consumes an authorization only once while exchange is pending and refuses cancellation during commit', async () => {
  const f = await fixture(), a = f.grant(); let finish!: (value: OAuthCredential) => void;
  f.token.mockImplementationOnce(async () => new Promise<OAuthCredential>(resolve => { finish = resolve; }));
  const url = await f.start(), state = url.searchParams.get('state'); await f.callback(state, a.code);
  expect((await f.callback(state, a.code)).status).toBe(409); expect(f.service.oauth.cancel().code).toBe('CONNECTION_BUSY');
  finish(a.value); await vi.waitFor(() => expect(f.service.oauth.status().phase).toBe('complete')); expect(f.token).toHaveBeenCalledTimes(1);
});
it('cancel, denial and expiry close the loopback listener without exchanging or saving a token', async () => {
  const f = await fixture(50); const url = await f.start();
  await f.callback(url.searchParams.get('state'), undefined, '&error=access_denied');
  await vi.waitFor(() => expect(f.service.oauth.status().phase).toBe('cancelled'));
  await new Promise(resolve => setTimeout(resolve, 10));
  await f.start(); f.service.oauth.cancel(); expect(f.service.oauth.status().phase).toBe('cancelled');
  await f.start(); await vi.waitFor(() => expect(f.service.oauth.status().phase).toBe('expired'));
  expect(f.token).not.toHaveBeenCalled(); expect(f.store.list()).toHaveLength(0);
});
it('does not authorize if another process already owns the callback port', async () => {
  const f = await fixture(), server = createServer(); await new Promise<void>(resolve => server.listen(f.port, '127.0.0.1', resolve));
  try { expect((await f.service.oauth.start({ environment: 'test' })).code).toBe('OAUTH_CALLBACK_BUSY'); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
it('explicit refresh rotates the atomic vault bundle and preserves exact Workspace identity', async () => {
  const f=await fixture(),a=f.grant(),url=await f.start();await f.callback(url.searchParams.get('state'),a.code);
  await vi.waitFor(()=>expect(f.service.oauth.status().phase).toBe('complete'));
  const rotated={...a.value,access_token:randomUUID(),refresh_token:randomUUID()};f.grants.set('rotated',rotated);f.token.mockResolvedValueOnce(rotated);
  const reply=await f.service.refreshOAuth(a.value.identity.workspace_id);expect(reply.ok).toBe(true);
  expect(decodeCredential(f.secrets.get(a.value.identity.workspace_id)!).oauth).toEqual(rotated);
  expect(f.token.mock.calls.at(-1)![2]).toEqual({refresh_token:a.value.refresh_token});
  expect(reply.data!.auth_kind).toBe('oauth');
});
it('switches an existing Internal Connection to OAuth only after validating that same Workspace', async () => {
  const f=await fixture(),a=f.grant(),id=a.value.identity.workspace_id,oldToken=randomUUID();
  f.store.add({id,label:'Existing test connection',environment:'test'});f.secrets.set(id,oldToken);
  f.store.verification(id,{auth_kind:'internal',status:'Connected'});
  const url=await f.start({workspace_id:id});await f.callback(url.searchParams.get('state'),a.code);
  await vi.waitFor(()=>expect(f.service.oauth.status().phase).toBe('complete'));
  expect(f.store.list()).toHaveLength(1);expect(f.store.list()[0]).toMatchObject({id,label:'Existing test connection',auth_kind:'oauth'});
  expect(decodeCredential(f.secrets.get(id)!).oauth?.identity.workspace_id).toBe(id);
  expect(f.service.chatOverview().data!.workspaces).toHaveLength(1);
});
it('refresh never pretends the old refresh token was restored after renewal and a local save failure', async () => {
  const f=await fixture(),a=f.grant(),url=await f.start();await f.callback(url.searchParams.get('state'),a.code);
  await vi.waitFor(()=>expect(f.service.oauth.status().phase).toBe('complete'));
  const rotated={...a.value,access_token:randomUUID(),refresh_token:randomUUID()};f.grants.set('rotated',rotated);f.token.mockResolvedValueOnce(rotated);
  f.vault.write.mockRejectedValueOnce(new Error(rotated.access_token));
  const reply=await f.service.refreshOAuth(a.value.identity.workspace_id);expect(reply.code).toBe('CREDENTIAL_STATE_UNCERTAIN');
  expect(JSON.stringify(reply)).not.toContain(rotated.access_token);expect(f.store.list()[0].status).toBe('Degraded');
  expect(f.store.list()[0].read_access).toBeNull();expect(f.token).toHaveBeenCalledTimes(2);
});
it('rejects production, unexpected identity and wrong reauthorization target before a content request', async () => {
  const f = await fixture(); const a = f.grant();
  let url = await f.start(); await f.callback(url.searchParams.get('state'), a.code);
  await vi.waitFor(() => expect(f.service.oauth.status().phase).toBe('complete')); f.content.mockClear();
  const wrong = f.grant('Test Beta'); url = await f.start({ workspace_id: a.value.identity.workspace_id });
  await f.callback(url.searchParams.get('state'), wrong.code); await vi.waitFor(() => expect(f.service.oauth.status().phase).toBe('failed'));
  expect(f.service.oauth.status().outcome!.code).toBe('WORKSPACE_MISMATCH'); expect(f.content).not.toHaveBeenCalled();
  const production = f.grant('Honour'); url = await f.start(); await f.callback(url.searchParams.get('state'), production.code);
  await vi.waitFor(() => expect(f.service.oauth.status().phase).toBe('failed')); expect(f.service.oauth.status().outcome!.code).toBe('TEST_WORKSPACE_ONLY');
  f.invalidateIdentity(); url = await f.start(); await f.callback(url.searchParams.get('state'), wrong.code);
  await vi.waitFor(() => expect(f.service.oauth.status().phase).toBe('failed')); expect(f.content).not.toHaveBeenCalled();
  expect(f.store.list()).toHaveLength(1);
});
it('uses the fixed official token endpoint and sanitizes exchange failures including secrets', async () => {
  const id = randomUUID(), secret = randomUUID(), code = randomUUID(), workspace = randomUUID(), bot = randomUUID();
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    expect(input).toBe('https://api.notion.com/v1/oauth/token');
    expect(init?.redirect).toBe('error'); expect(JSON.parse(String(init?.body)).grant_type).toBe('authorization_code');
    return Response.json({ access_token: randomUUID(), refresh_token: null, token_type: 'bearer', workspace_id: workspace, bot_id: bot, workspace_name: 'Test Alpha' });
  });
  const exchange = new OfficialOAuthExchange(fetchMock);
  expect((await exchange.token(id, secret, { code, redirect_uri: 'http://localhost/callback' })).identity.workspace_id).toBe(workspace);
  fetchMock.mockResolvedValueOnce(Response.json({ message: secret + code }, { status: 400 }));
  await expect(exchange.token(id, secret, { code, redirect_uri: 'http://localhost/callback' })).rejects.toMatchObject({ code: 'OAUTH_FAILED' });
});
