import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '../apps/server/src/infra/store.js';
import { MessageHub } from '../apps/server/src/messenger/hub.js';
import type { ChatIdentity, AccessiblePage } from '../packages/contracts/src/index.js';
const close: (() => void)[] = [];
afterEach(() => close.splice(0).reverse().forEach(fn => fn()));
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'lv999-messages-'));
  const store = new Store(folder); close.push(() => { store.close(); rmSync(folder, { recursive: true, force: true }); });
  const a = randomUUID(), b = randomUUID();
  store.add({ id: a, label: 'Alpha', environment: 'test' }); store.add({ id: b, label: 'Beta', environment: 'test' });
  const hub = new MessageHub(store);
  const human: ChatIdentity = { actor: 'human', workspace_ids: 'owner' }, claude: ChatIdentity = { actor: 'claude', workspace_ids: [a] }, codex: ChatIdentity = { actor: 'codex', workspace_ids: [a] };
  const send = (body = 'Hello', actor = human, extra: object = {}) => hub.send(actor, { workspace_id: a, body, idempotency_key: randomUUID(), ...extra });
  function route(workspace_id = a, expected_revision = 0) {
    const root: AccessiblePage = { workspace_id, id: randomUUID(), title: 'Root', url: '', root_eligible: true, root_reason: null, parent_kind: 'workspace', last_edited_time: null };
    return store.saveProject({ project_key: 'QA', name: 'Project Alpha', workspace_id, root_page_id: root.id, expected_revision }, root);
  }
  return { folder, store, hub, a, b, human, claude, codex, send, route };
}
it('creates one Workspace group even without projects or messages', () => {
  const f = fixture(); const overview = f.hub.overview(f.human).data!;
  expect(overview.workspaces).toHaveLength(2); expect(overview.projects).toEqual([]); expect(overview.auto_wake).toBe(false);
  expect(f.hub.overview(f.human).data!.workspaces).toHaveLength(2);
});
it('ordinary text including @Codex never creates a wake or changes read receipts', () => {
  const f = fixture(); const message = f.send('@Codex is ordinary text').data!;
  expect(message.receipts.map(r => [r.recipient_id, r.read_at])).toEqual([['claude', null], ['codex', null]]);
  expect(f.hub.overview(f.claude).data!.total_unread).toBe(1);
  expect(f.hub.unread(f.claude).data!.messages).toHaveLength(1);
  expect(f.hub.overview(f.claude).data!.total_unread).toBe(1);
  expect(f.store.db.prepare("SELECT name FROM sqlite_master WHERE name='wake_requests'").get()).toBeUndefined();
});
it('structured wake requests are explicitly unsupported instead of falsely delivered', () => {
  const f = fixture(); expect(f.send('Wake', f.human, { mentions: ['codex'] }).code).toBe('UNSUPPORTED');
  expect(f.hub.overview(f.human).data!.workspaces[0].message_count).toBe(0);
});
it('human retrieval marks only the human recipient, never another agent', () => {
  const f = fixture(); const message = f.send('From Claude', f.claude).data!;
  expect(f.hub.overview(f.human).data!.total_unread).toBe(1);
  const read = f.hub.read(f.human, { workspace_id: f.a }).data!.messages[0];
  expect(read.id).toBe(message.id); expect(read.receipts.find(r => r.recipient_id === 'human')?.read_source).toBe('human_read_api');
  expect(read.receipts.find(r => r.recipient_id === 'codex')?.read_at).toBeNull();
});
it('agent read API records a stable receipt and never a Done/Ack state', () => {
  const f = fixture(); const message = f.send().data!;
  const first = f.hub.readOne(f.codex, message.id).data!;
  const receipt = first.receipts.find(r => r.recipient_id === 'codex')!;
  expect(receipt.read_at).not.toBeNull(); expect(receipt.read_source).toBe('mcp_read_api');
  expect(f.hub.readOne(f.codex, message.id).data!.receipts.find(r => r.recipient_id === 'codex')?.read_at).toBe(receipt.read_at);
  expect(f.hub.overview(f.codex).data!.total_unread).toBe(0); expect(first).not.toHaveProperty('task_status');
});
it('startup-bound agents cannot access unapproved groups or forge a sender field', () => {
  const f = fixture(); const message = f.send('Beta', f.human, { workspace_id: f.b }).data!;
  expect(f.hub.readOne(f.claude, message.id).code).toBe('CHAT_ACCESS_DENIED');
  expect(f.hub.read(f.claude, { workspace_id: f.b }).code).toBe('CHAT_ACCESS_DENIED');
  expect(f.send('Beta', f.claude, { workspace_id: f.b }).code).toBe('CHAT_ACCESS_DENIED');
  expect(f.send('Forged', f.claude, { sender_id: 'human' }).code).toBe('INVALID_INPUT');
  expect(f.store.activity().some(event => event.code === 'CHAT_ACCESS_DENIED')).toBe(true);
});
it('retries are idempotent while distinct ordinary messages stay distinct', () => {
  const f = fixture(); const key = randomUUID();
  const first = f.send('Same text', f.human, { idempotency_key: key });
  expect(f.send('Same text', f.human, { idempotency_key: key }).data!.id).toBe(first.data!.id);
  expect(f.send('Changed', f.human, { idempotency_key: key }).code).toBe('IDEMPOTENCY_CONFLICT');
  expect(f.send('Same text').data!.id).not.toBe(first.data!.id);
  expect(f.send('Same text', f.codex, { idempotency_key: key }).ok).toBe(true);
});
it('reply references cannot cross Workspace group boundaries', () => {
  const f = fixture(); const first = f.send().data!;
  expect(f.send('Reply', f.claude, { reply_to_id: first.id }).ok).toBe(true);
  expect(f.send('Wrong room', f.human, { workspace_id: f.b, reply_to_id: first.id }).code).toBe('MESSAGE_NOT_FOUND');
});
it('project conversations keep historical Workspace messages after reassignment', () => {
  const f = fixture(); f.route();
  expect(f.send('Project message', f.human, { project_key: 'QA', route_revision: 1 }).ok).toBe(true);
  f.route(f.b, 1);
  expect(f.send('Stale', f.human, { project_key: 'QA', route_revision: 1 }).code).toBe('ROUTE_CONFLICT');
  expect(f.send('New room', f.human, { workspace_id: f.b, project_key: 'QA', route_revision: 2 }).ok).toBe(true);
  const history = f.hub.read(f.human, { project_key: 'QA' }).data!.messages;
  expect(history.map(m => m.workspace_id)).toEqual([f.a, f.b]); expect(f.hub.overview(f.human).data!.projects[0].message_count).toBe(2);
});
it('message, recipients and success audit roll back together', () => {
  const f = fixture(); vi.spyOn(f.store, 'log').mockImplementationOnce(() => { throw Object.assign(new Error('Disk full'), { code: 'ERR_SQLITE_ERROR' }); });
  expect(f.send().code).toBe('LOCAL_SAVE_FAILED');
  expect(f.store.db.prepare('SELECT count(*) AS n FROM chat_messages').get()!.n).toBe(0);
  expect(f.store.db.prepare('SELECT count(*) AS n FROM chat_receipts').get()!.n).toBe(0);
});
it('history pagination marks only returned bodies read, not older summaries', () => {
  const f = fixture(); for (let n = 0; n < 4; n++) f.send(`Message ${n}`);
  const first = f.hub.read(f.codex, { workspace_id: f.a, limit: 2 }).data!;
  expect(first.has_more).toBe(true); expect(f.hub.overview(f.codex).data!.total_unread).toBe(2);
  const older = f.hub.read(f.codex, { workspace_id: f.a, limit: 2, before_seq: first.messages[0].seq }).data!;
  expect(older.messages.map(m => m.body)).toEqual(['Message 0', 'Message 1']); expect(older.has_more).toBe(false);
});
it('messages and independent receipts survive a new Hub/SQLite connection', () => {
  const f = fixture(); const message = f.send().data!; f.hub.readOne(f.claude, message.id);
  const other = new Store(f.folder); close.push(() => other.close()); const hub = new MessageHub(other);
  expect(hub.overview(f.claude).data!.total_unread).toBe(0); expect(hub.overview(f.codex).data!.total_unread).toBe(1);
  expect(hub.readOne(f.human, message.id).data!.body).toBe('Hello');
});
