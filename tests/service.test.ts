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
  const vault = { read: vi.fn(async (id: string) => secrets.get(id) ?? null), probe: vi.fn(async () => true) };
  const service = new Service(store, vault, secret => adapters.get(secret)!);
  return { store, service, a, b, secrets, adapters, vault, directory };
}
describe('workspace isolation and truthful state', () => {
  it('starts configured, and only live identity evidence makes a workspace connected', async () => {
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
    expect(Object.values(snapshot.capabilities).every(v => v === false)).toBe(true);
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
