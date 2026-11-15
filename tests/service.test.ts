import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../apps/server/src/infra/store.js';
import { Service } from '../apps/server/src/core/service.js';
import { DomainError, type NotionAdapter } from '../apps/server/src/notion/adapter.js';
import { WorkspaceInput } from '../packages/contracts/src/index.js';

const fixtures: { directory: string; store: Store }[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) { f.store.close(); rmSync(f.directory, { recursive: true, force: true }); } });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'lv999-unit-'));
  const store = new Store(directory); fixtures.push({ directory, store });
  const a = randomUUID(), b = randomUUID();
  store.add({ id: a, label: 'Test Alpha', environment: 'test' });
  store.add({ id: b, label: 'Test Beta', environment: 'test' });
  const secrets = new Map<string, string>([[a, randomUUID()], [b, randomUUID()]]);
  const adapters = new Map<string, NotionAdapter>();
  for (const [id, secret] of secrets) adapters.set(secret, {
    identity: vi.fn(async () => ({ workspace_id: id, workspace_name: id === a ? 'Test Alpha' : 'Test Beta', bot_id: randomUUID() })),
    search: vi.fn(async () => ({ object: 'list', results: [], has_more: false, next_cursor: null })),
    page: vi.fn(async pageId => ({ object: 'page', id: pageId })),
  });
  const vault = {
    read: vi.fn(async (id: string) => secrets.get(id) ?? null),
    write: vi.fn(async (id: string, secret: string) => { secrets.set(id, secret); }),
    remove: vi.fn(async (id: string) => { secrets.delete(id); }),
    probe: vi.fn(async () => true),
  };
  const service = new Service(store, vault, secret => adapters.get(secret)!);
  return { store, service, a, b, secrets, adapters, vault, directory };
}
describe('workspace isolation and truthful state', () => {
  it('starts configured, and only live identity and read evidence make a workspace connected', async () => {
    const f = fixture(); await f.service.initialize();
    expect(f.service.snapshot().workspaces.map(w => w.status)).toEqual(['Configured', 'Configured']);
    expect((await f.service.verify(f.a)).ok).toBe(true);
    expect(f.store.list().find(w => w.id === f.a)?.status).toBe('Connected');
    expect(f.store.list().find(w => w.id === f.b)?.status).toBe('Configured');
  });
  it('uses separate vault lookups and adapters for two workspaces', async () => {
    const f = fixture();
    await f.service.search(f.a, 'alpha'); await f.service.search(f.b, 'beta');
    expect(f.vault.read.mock.calls).toEqual([[f.a], [f.b]]);
    expect(f.adapters.get(f.secrets.get(f.a)!)!.search).toHaveBeenCalledWith('alpha', undefined);
    expect(f.adapters.get(f.secrets.get(f.b)!)!.search).toHaveBeenCalledWith('beta', undefined);
  });
  it('rejects token A registered as token B before reading any content', async () => {
    const f = fixture(); const secretA = f.secrets.get(f.a)!;
    f.secrets.set(f.b, secretA);
    const reply = await f.service.search(f.b, 'must not be read');
    expect(reply.code).toBe('WORKSPACE_MISMATCH');
    expect(f.adapters.get(secretA)!.search).not.toHaveBeenCalled();
    expect(f.store.list().find(w => w.id === f.b)?.status).toBe('Degraded');
  });
  it('checks token identity again before each content call', async () => {
    const f = fixture(); await f.service.verify(f.a);
    f.secrets.set(f.a, f.secrets.get(f.b)!);
    expect((await f.service.page(f.a, randomUUID())).code).toBe('WORKSPACE_MISMATCH');
    expect(f.adapters.get(f.secrets.get(f.b)!)!.page).not.toHaveBeenCalled();
  });
  it('rejects unknown workspace without any vault lookup', async () => {
    const f = fixture(); expect((await f.service.verify(randomUUID())).code).toBe('UNKNOWN_WORKSPACE');
    expect(f.vault.read).not.toHaveBeenCalled();
  });
  it('distinguishes missing credentials from configured metadata', async () => {
    const f = fixture(); f.secrets.delete(f.a);
    expect((await f.service.verify(f.a)).code).toBe('AUTH_REQUIRED');
    expect(f.store.list().find(w => w.id === f.a)?.status).toBe('Auth required');
  });
  it.each(['Vibecode', 'Honour'])('blocks production identity %s before content access', async name => {
    const f = fixture(); const adapter = f.adapters.get(f.secrets.get(f.a)!)!;
    adapter.identity = async () => ({ workspace_id: f.a, workspace_name: name, bot_id: randomUUID() });
    expect((await f.service.search(f.a, '')).code).toBe('TEST_WORKSPACE_ONLY');
    expect(adapter.search).not.toHaveBeenCalled();
  });
  it.each(['Vibecode', 'Honour'])('refuses production registration %s', label => {
    const f = fixture(); expect(() => f.store.add({ id: randomUUID(), label, environment: 'test' })).toThrow('TEST_WORKSPACE_ONLY');
  });
  it('does not accept non-test or credential-bearing registry input', () => {
    expect(WorkspaceInput.safeParse({ id: randomUUID(), label: 'Example', environment: 'production' }).success).toBe(false);
    expect(WorkspaceInput.safeParse({ id: randomUUID(), label: 'Example', environment: 'test', token: randomUUID() }).success).toBe(false);
  });
  it('keeps tokens and untrusted error bodies out of snapshots, audit and SQLite', async () => {
    const f = fixture(); const secret = f.secrets.get(f.a)!;
    f.adapters.get(secret)!.identity = async () => { throw new Error(`Authorization: Bearer ${secret}`); };
    const reply = await f.service.verify(f.a);
    const output = JSON.stringify({ reply, snapshot: f.service.snapshot() });
    expect(output).not.toContain(secret);
    for (const file of ['registry.db', 'registry.db-wal']) expect(readFileSync(join(f.directory, file)).includes(Buffer.from(secret))).toBe(false);
  });
  it('reports vault failures and does not fabricate API/client health', async () => {
    const f = fixture(); f.vault.probe.mockResolvedValue(false); await f.service.initialize();
    const snapshot = f.service.snapshot();
    expect(snapshot.diagnostics.find(d => d.key === 'vault')?.status).toBe('error');
    expect(snapshot.diagnostics.find(d => d.key === 'notion')?.status).toBe('pending');
    expect(snapshot.clients.every(c => c.status === 'Not tested')).toBe(true);
    expect(snapshot.capabilities).toEqual({ connect_in_gui: true, browse_pages: true, routing: true, client_config: true, group_chat: true, auto_wake: false, migration: false, content_write: false });
  });
  it('returns the required read-only result envelope', async () => {
    const f = fixture(); const reply = await f.service.search(f.a, '');
    expect(reply).toMatchObject({ ok: true, code: 'OK', workspace_id: f.a, project_key: null, resource_url: null,
      changed_objects: 0, warnings: [], errors: [], job_id: null, dry_run: false, requires_approval: false });
  });
  it('does not misattribute a 403 to the other workspace', async () => {
    const f = fixture(); f.adapters.get(f.secrets.get(f.a)!)!.identity = async () => { throw new DomainError('FORBIDDEN', 'Check connection capabilities and page sharing.'); };
    const reply = await f.service.verify(f.a); expect(reply.workspace_id).toBe(f.a); expect(reply.code).toBe('FORBIDDEN');
    expect((await f.service.verify(f.b)).ok).toBe(true);
  });
});

function candidate(f: ReturnType<typeof fixture>, id = randomUUID()) {
  const token = randomUUID();
  const adapter = {
    identity: vi.fn(async () => ({ workspace_id: id, workspace_name: 'Detected Test Workspace', bot_id: randomUUID() })),
    search: vi.fn(async () => ({ results: [{ object: 'page', id: randomUUID() }], has_more: false })),
    page: vi.fn(async () => ({})),
  };
  f.adapters.set(token, adapter);
  return { id, token, adapter, input: { label: 'My test connection', token, environment: 'test' as const } };
}

describe('GUI connection and credential replacement', () => {
  it('discovers the real identity and proves read access before writing a credential', async () => {
    const f = fixture(), c = candidate(f);
    const reply = await f.service.connectWorkspace(c.input);
    expect(reply).toMatchObject({ ok: true, workspace_id: c.id, changed_objects: 0,
      data: { id: c.id, label: c.input.label, verified_name: 'Detected Test Workspace', status: 'Connected', read_access: { sampled_objects: 1 } } });
    expect(c.adapter.search.mock.invocationCallOrder[0]).toBeLessThan(f.vault.write.mock.invocationCallOrder[0]);
    expect(f.secrets.get(c.id)).toBe(c.token);
  });
  it('uses the real Notion name when the display name is omitted', async () => {
    const f = fixture(), c = candidate(f);
    const reply = await f.service.connectWorkspace({ token: c.token, environment: 'test' });
    expect(reply.data?.label).toBe('Detected Test Workspace');
  });
  it.each([
    { token: '', environment: 'test' },
    { token: randomUUID() },
    { token: randomUUID(), environment: 'production' },
    { token: randomUUID(), environment: 'test', workspace_id: randomUUID() },
  ])('rejects invalid or unacknowledged input without touching the vault', async input => {
    const f = fixture(); expect((await f.service.connectWorkspace(input)).code).toBe('INVALID_INPUT');
    expect(f.vault.write).not.toHaveBeenCalled(); expect(f.vault.read).not.toHaveBeenCalled();
  });
  it('does not persist an identity-only success when the read probe fails', async () => {
    const f = fixture(), c = candidate(f);
    c.adapter.search.mockRejectedValue(new DomainError('FORBIDDEN', 'Read permission is missing.'));
    expect((await f.service.connectWorkspace(c.input)).code).toBe('FORBIDDEN');
    expect(f.vault.write).not.toHaveBeenCalled(); expect(f.store.list().some(w => w.id === c.id)).toBe(false);
  });
  it('rejects duplicate connection without changing the previous credential or verification', async () => {
    const f = fixture(); await f.service.verify(f.a);
    const before = f.store.list().find(w => w.id === f.a);
    const c = candidate(f, f.a);
    expect((await f.service.connectWorkspace(c.input)).code).toBe('WORKSPACE_EXISTS');
    expect(c.adapter.search).not.toHaveBeenCalled(); expect(f.vault.write).not.toHaveBeenCalled();
    expect(f.store.list().find(w => w.id === f.a)).toEqual(before);
  });
  it('replaces a token only for the exact existing workspace and retains its label', async () => {
    const f = fixture(), c = candidate(f, f.a);
    const reply = await f.service.reauthorizeWorkspace({ workspace_id: f.a, token: c.token, environment: 'test' });
    expect(reply.data).toMatchObject({ id: f.a, label: 'Test Alpha', status: 'Connected' });
    expect(f.secrets.get(f.a)).toBe(c.token);
  });
  it('keeps an existing connection intact when a replacement token belongs elsewhere', async () => {
    const f = fixture(); await f.service.verify(f.a);
    const before = f.store.list().find(w => w.id === f.a), secret = f.secrets.get(f.a);
    const c = candidate(f, f.b);
    expect((await f.service.reauthorizeWorkspace({ workspace_id: f.a, token: c.token, environment: 'test' })).code).toBe('WORKSPACE_MISMATCH');
    expect(c.adapter.search).not.toHaveBeenCalled(); expect(f.vault.write).not.toHaveBeenCalled();
    expect(f.secrets.get(f.a)).toBe(secret); expect(f.store.list().find(w => w.id === f.a)).toEqual(before);
  });
  it('rolls back both registry and credential when SQLite saving fails', async () => {
    const f = fixture(), c = candidate(f);
    const oldOrphan = randomUUID(); f.secrets.set(c.id, oldOrphan);
    vi.spyOn(f.store, 'log').mockImplementationOnce(() => { throw new Error('Disk full'); });
    expect((await f.service.connectWorkspace(c.input)).code).toBe('LOCAL_SAVE_FAILED');
    expect(f.store.list().some(w => w.id === c.id)).toBe(false); expect(f.secrets.get(c.id)).toBe(oldOrphan);
  });
  it('attributes a registry lock failure to local storage without writing credentials', async () => {
    const f = fixture(), c = candidate(f);
    vi.spyOn(f.store, 'acquireConnection').mockImplementationOnce(() => { throw Object.assign(new Error('Untrusted SQL details'), { code: 'ERR_SQLITE_ERROR' }); });
    const reply = await f.service.connectWorkspace(c.input);
    expect(reply.code).toBe('LOCAL_SAVE_FAILED'); expect(reply.errors[0]).toContain('local connection registry');
    expect(f.vault.write).not.toHaveBeenCalled();
  });
  it('removes a newly written credential when registration cannot be committed', async () => {
    const f = fixture(), c = candidate(f);
    vi.spyOn(f.store, 'saveConnection').mockImplementationOnce(() => { throw new Error('Disk full'); });
    expect((await f.service.connectWorkspace(c.input)).code).toBe('LOCAL_SAVE_FAILED');
    expect(f.secrets.has(c.id)).toBe(false); expect(f.vault.remove).toHaveBeenCalledWith(c.id);
  });
  it('rolls back a new credential when vault readback does not match what was written', async () => {
    const f = fixture(), c = candidate(f);
    f.vault.read.mockResolvedValueOnce(null).mockResolvedValueOnce('unexpected-readback');
    expect((await f.service.connectWorkspace(c.input)).code).toBe('VAULT_UNAVAILABLE');
    expect(f.secrets.has(c.id)).toBe(false); expect(f.store.list().some(w => w.id === c.id)).toBe(false);
  });
  it('recovers an expired credential lease without allowing a different owner to release a live lease', () => {
    const f = fixture(), id = randomUUID(), first = randomUUID(), second = randomUUID();
    expect(f.store.acquireConnection(id, first)).toBe(true);
    f.store.releaseConnection(id, second);
    expect(f.store.acquireConnection(id, second)).toBe(false);
    f.store.db.prepare('UPDATE connection_locks SET expires=0 WHERE id=?').run(id);
    expect(f.store.acquireConnection(id, second)).toBe(true);
  });
  it('restores the prior token even if a vault write fails after mutating it', async () => {
    const f = fixture(), c = candidate(f, f.a); const old = f.secrets.get(f.a);
    f.vault.write.mockImplementationOnce(async (id, token) => {
      f.secrets.set(id, token); throw new DomainError('VAULT_UNAVAILABLE', 'Write result unknown.');
    });
    expect((await f.service.reauthorizeWorkspace({ workspace_id: f.a, token: c.token, environment: 'test' })).code).toBe('VAULT_UNAVAILABLE');
    expect(f.secrets.get(f.a)).toBe(old);
  });
  it('fails closed and clears old positive proof when credential restoration cannot be confirmed', async () => {
    const f = fixture(), c = candidate(f, f.a); await f.service.verify(f.a);
    vi.spyOn(f.store, 'saveConnection').mockImplementationOnce(() => { throw new Error('Disk full'); });
    f.vault.write.mockImplementationOnce(async (id, token) => { f.secrets.set(id, token); })
      .mockRejectedValueOnce(new DomainError('VAULT_UNAVAILABLE', 'Restore failed'));
    expect((await f.service.reauthorizeWorkspace({ workspace_id: f.a, token: c.token, environment: 'test' })).code).toBe('CREDENTIAL_STATE_UNCERTAIN');
    expect(f.store.list().find(w => w.id === f.a)).toMatchObject({ status: 'Degraded', read_access: null });
  });
  it('does not show Connected while an identity-only verification is awaiting read access', async () => {
    const f = fixture(); const adapter = f.adapters.get(f.secrets.get(f.a)!)!;
    let finish!: (value: unknown) => void;
    adapter.search = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.service.verify(f.a);
    await vi.waitFor(() => expect(adapter.search).toHaveBeenCalled());
    expect(f.store.list().find(w => w.id === f.a)?.status).toBe('Configured');
    finish({ results: [], has_more: false });
    const reply = await pending; expect(reply.ok).toBe(true); expect(reply.warnings).toHaveLength(1);
  });
  it('serializes credential mutation across two backend instances sharing one registry', async () => {
    const f = fixture(), c = candidate(f), secondStore = new Store(f.directory);
    const second = new Service(secondStore, f.vault, token => f.adapters.get(token)!);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.vault.write.mockImplementationOnce(async (id, token) => { await gate; f.secrets.set(id, token); });
    const first = f.service.connectWorkspace(c.input);
    try {
      await vi.waitFor(() => expect(f.vault.write).toHaveBeenCalledTimes(1));
      expect((await second.connectWorkspace(c.input)).code).toBe('CONNECTION_BUSY');
      release(); expect((await first).ok).toBe(true);
      expect(f.secrets.get(c.id)).toBe(c.token); expect(f.vault.remove).not.toHaveBeenCalled();
    } finally { release(); await first; secondStore.close(); }
  });
  it('does not expose submitted tokens in successful/failed results, audit or SQLite', async () => {
    const f = fixture(), c = candidate(f);
    const success = await f.service.connectWorkspace(c.input);
    const badToken = randomUUID();
    f.adapters.set(badToken, { ...c.adapter, identity: async () => { throw new Error(`Untrusted body: ${badToken}`); } });
    const failed = await f.service.connectWorkspace({ ...c.input, token: badToken });
    const output = JSON.stringify({ success, failed, snapshot: f.service.snapshot() });
    for (const token of [c.token, badToken]) {
      expect(output).not.toContain(token);
      for (const file of ['registry.db', 'registry.db-wal']) expect(readFileSync(join(f.directory, file)).includes(Buffer.from(token))).toBe(false);
    }
  });
});
