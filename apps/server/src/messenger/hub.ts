import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SendMessageInput, ChatScopeInput, result, type ChatIdentity, type ChatMessage, type ChatOverview, type ChatScope, type ChatActorId, type Result } from '../../../../packages/contracts/src/index.js';
import { DomainError, safeError } from '../notion/adapter.js';
import type { Store } from '../infra/store.js';
import { WakeStore } from './wake-store.js';

export class MessageHub {
  readonly wakes:WakeStore;
  constructor(private store: Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS chat_groups (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chat_messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        workspace_id TEXT NOT NULL REFERENCES chat_groups(workspace_id), project_key TEXT, project_name TEXT,
        sender_id TEXT NOT NULL CHECK(sender_id IN ('human','claude','codex')), body TEXT NOT NULL CHECK(length(body)>0 AND length(body)<=8000),
        reply_to_id TEXT REFERENCES chat_messages(id), idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(sender_id,idempotency_key));
      CREATE INDEX IF NOT EXISTS chat_messages_scope ON chat_messages(workspace_id,project_key,seq);
      CREATE INDEX IF NOT EXISTS chat_messages_project ON chat_messages(project_key,seq);
      CREATE TABLE IF NOT EXISTS chat_receipts (message_id TEXT NOT NULL REFERENCES chat_messages(id),
        recipient_id TEXT NOT NULL CHECK(recipient_id IN ('human','claude','codex')), read_at TEXT, read_source TEXT,
        PRIMARY KEY(message_id,recipient_id));
      CREATE INDEX IF NOT EXISTS chat_receipts_unread ON chat_receipts(recipient_id,read_at);`);
    const columns=store.db.prepare('PRAGMA table_info(chat_messages)').all().map(row=>row.name);
    for(const [name,definition] of [['mentions_json',"TEXT NOT NULL DEFAULT '[]'"],['correlation_id','TEXT'],['hop_count','INTEGER NOT NULL DEFAULT 0']])
      if(!columns.includes(name))store.db.exec(`ALTER TABLE chat_messages ADD COLUMN ${name} ${definition}`);
    this.wakes=new WakeStore(store);
  }
  private ensureGroups() {
    this.store.db.prepare('INSERT OR IGNORE INTO chat_groups(workspace_id,created_at) SELECT id,? FROM workspaces').run(new Date().toISOString());
  }
  private allowed(identity: ChatIdentity, workspaceId: string) {
    if (!this.store.list().some(w => w.id === workspaceId) || (identity.workspace_ids !== 'owner' && !identity.workspace_ids.includes(workspaceId)))
      throw new DomainError('CHAT_ACCESS_DENIED', 'This connection is not authorized for that Workspace group.');
  }
  private failed<T>(error: unknown, identity?: ChatIdentity): Result<T> {
    const failure = safeError(error);
    this.store.log({ level: 'error', action: `Chat ${identity?.actor ?? 'unknown'} request failed`, workspace_id: null, code: failure.code });
    return result<T>(null, null, failure.code, [failure.message]);
  }
  overview(identity: ChatIdentity): Result<ChatOverview> {
    this.ensureGroups();
    const visible = this.store.list().filter(w => identity.workspace_ids === 'owner' || identity.workspace_ids.includes(w.id));
    const workspaces = visible.map(w => {
      const count = (actor: ChatActorId) => Number(this.store.db.prepare(`SELECT count(*) AS n FROM chat_receipts r JOIN chat_messages m ON m.id=r.message_id
        WHERE m.workspace_id=? AND r.recipient_id=? AND r.read_at IS NULL`).get(w.id, actor)!.n);
      const last = this.store.db.prepare('SELECT body FROM chat_messages WHERE workspace_id=? ORDER BY seq DESC LIMIT 1').get(w.id);
      return { workspace_id: w.id, label: w.label,
        message_count: Number(this.store.db.prepare('SELECT count(*) AS n FROM chat_messages WHERE workspace_id=?').get(w.id)!.n),
        unread: count(identity.actor), agent_unread: { claude: count('claude'), codex: count('codex') }, last_preview: last ? String(last.body).slice(0, 120) : null };
    });
    const projects = this.store.projects().filter(route => visible.some(w => w.id === route.workspace_id)).map(route => ({
      project_key: route.project_key, name: route.name, workspace_id: route.workspace_id as string | null, revision: route.revision as number | null,
      message_count: 0, unread: 0,
    }));
    for (const workspace of visible) {
      const rows = this.store.db.prepare(`SELECT project_key,project_name,count(*) AS n FROM chat_messages WHERE workspace_id=? AND project_key IS NOT NULL GROUP BY project_key`).all(workspace.id);
      for (const row of rows) {
        let project = projects.find(p => p.project_key === row.project_key);
        if (!project) { project = { project_key: String(row.project_key), name: String(row.project_name), workspace_id: null, revision: null, message_count: 0, unread: 0 }; projects.push(project); }
        project.message_count += Number(row.n);
        project.unread += Number(this.store.db.prepare(`SELECT count(*) AS n FROM chat_messages m JOIN chat_receipts r ON m.id=r.message_id
          WHERE m.workspace_id=? AND m.project_key=? AND r.recipient_id=? AND r.read_at IS NULL`).get(workspace.id, project.project_key, identity.actor)!.n);
      }
    }
    return result({ workspaces, projects: projects.sort((a, b) => a.project_key.localeCompare(b.project_key)), total_unread: workspaces.reduce((n, w) => n + w.unread, 0), auto_wake: true,
      bindings:this.wakes.rows().filter(row=>visible.some(w=>w.id===row.workspace_id)).map(row=>this.wakes.view(row)) });
  }
  private message(id: string): ChatMessage {
    const row = this.store.db.prepare('SELECT * FROM chat_messages WHERE id=?').get(id)!;
    const receipts = this.store.db.prepare('SELECT recipient_id,read_at,read_source FROM chat_receipts WHERE message_id=? ORDER BY recipient_id').all(id);
    return { id: String(row.id), seq: Number(row.seq), workspace_id: String(row.workspace_id), project_key: row.project_key as string | null,
      project_name: row.project_name as string | null, sender_id: row.sender_id as ChatActorId, body: String(row.body),
      reply_to_id: row.reply_to_id as string | null, created_at: String(row.created_at), receipts: receipts as ChatMessage['receipts'],
      mentions:JSON.parse(String(row.mentions_json??'[]')),wakes:this.wakes.messages(id) };
  }
  send(identity: ChatIdentity, input: unknown): Result<ChatMessage> {
    try {
      const parsed = SendMessageInput.safeParse(input);
      if (!parsed.success) throw new DomainError('INVALID_INPUT', 'Select a group and provide a message with a stable retry key.');
      const value = parsed.data; this.allowed(identity, value.workspace_id);
      const mentions=[...new Set(value.mentions)].sort();
      if(identity.actor!=='human'&&mentions.includes(identity.actor))throw new DomainError('INVALID_INPUT','Agents cannot automatically wake themselves.');
      if(identity.actor!=='human'&&mentions.length&&!value.reply_to_id)throw new DomainError('INVALID_INPUT','Agent handoffs must reference the causal message.');
      this.ensureGroups();
      this.store.db.exec('BEGIN IMMEDIATE');
      try {
        const previous = this.store.db.prepare('SELECT * FROM chat_messages WHERE sender_id=? AND idempotency_key=?').get(identity.actor, value.idempotency_key);
        if (previous) {
          if (previous.workspace_id !== value.workspace_id || previous.project_key !== (value.project_key ?? null) || previous.body !== value.body || previous.reply_to_id !== (value.reply_to_id ?? null)||previous.mentions_json!==JSON.stringify(mentions))
            throw new DomainError('IDEMPOTENCY_CONFLICT', 'This retry key belongs to a different message. Refresh before retrying.');
          const message = this.message(String(previous.id)); this.store.db.exec('COMMIT'); return result(message, message.workspace_id);
        }
        const project = value.project_key ? this.store.projects().find(p => p.project_key === value.project_key) : null;
        if (value.project_key && (!project || project.workspace_id !== value.workspace_id || project.revision !== value.route_revision))
          throw new DomainError('ROUTE_CONFLICT', 'The project target changed. Refresh and choose the current Workspace before sending.');
        let parent:Record<string,unknown>|undefined;
        if (value.reply_to_id) {
          parent = this.store.db.prepare('SELECT * FROM chat_messages WHERE id=?').get(value.reply_to_id) as Record<string,unknown>|undefined;
          if (!parent || parent.workspace_id !== value.workspace_id) throw new DomainError('MESSAGE_NOT_FOUND', 'Reply to a message in this same Workspace group.');
        }
        const id = randomUUID();
        const hop=identity.actor==='human'?0:Number(parent?.hop_count??0)+1,correlation=identity.actor==='human'?id:String(parent?.correlation_id??parent?.id??id);
        this.store.db.prepare(`INSERT INTO chat_messages(id,workspace_id,project_key,project_name,sender_id,body,reply_to_id,idempotency_key,created_at,mentions_json,correlation_id,hop_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, value.workspace_id, value.project_key ?? null, project?.name ?? null, identity.actor, value.body, value.reply_to_id ?? null, value.idempotency_key, new Date().toISOString(),JSON.stringify(mentions),correlation,hop);
        for (const actor of ['human', 'claude', 'codex'] as const) if (actor !== identity.actor)
          this.store.db.prepare('INSERT INTO chat_receipts(message_id,recipient_id) VALUES (?,?)').run(id, actor);
        this.wakes.queue(id,value.workspace_id,value.project_key??null,mentions,hop);
        this.store.log({ level: 'info', action: 'Group message saved', workspace_id: value.workspace_id, code: 'OK' });
        const message = this.message(id); this.store.db.exec('COMMIT'); return result(message, value.workspace_id);
      } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    } catch (error) { return this.failed(error, identity); }
  }
  read(identity: ChatIdentity, input: unknown): Result<{ messages: ChatMessage[]; has_more: boolean }> {
    try {
      const parsed = ChatScopeInput.safeParse(input);
      if (!parsed.success) throw new DomainError('INVALID_INPUT', 'Choose a Workspace group or a project conversation.');
      const scope = parsed.data;
      if (scope.workspace_id) this.allowed(identity, scope.workspace_id);
      const ids = this.store.list().filter(w => identity.workspace_ids === 'owner' || identity.workspace_ids.includes(w.id)).map(w => w.id);
      if (!ids.length) throw new DomainError('CHAT_ACCESS_DENIED', 'No Workspace group is authorized for this connection.');
      const conditions = [`workspace_id IN (${ids.map(() => '?').join(',')})`];
      const values: (string | number)[] = [...ids];
      if (scope.workspace_id) { conditions.push('workspace_id=?'); values.push(scope.workspace_id); }
      if (scope.project_key) { conditions.push('project_key=?'); values.push(scope.project_key); }
      if (scope.before_seq) { conditions.push('seq<?'); values.push(scope.before_seq); }
      this.store.db.exec('BEGIN IMMEDIATE');
      try {
        const rows = this.store.db.prepare(`SELECT id FROM chat_messages WHERE ${conditions.join(' AND ')} ORDER BY seq DESC LIMIT ?`).all(...values, scope.limit + 1);
        const selected = rows.slice(0, scope.limit);
        for (const row of selected) this.markRead(String(row.id), identity.actor);
        const messages = selected.reverse().map(row => this.message(String(row.id)));
        this.store.db.exec('COMMIT'); return result({ messages, has_more: rows.length > scope.limit }, scope.workspace_id ?? null);
      } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    } catch (error) { return this.failed(error, identity); }
  }
  private markRead(id: string, actor: ChatActorId) {
    this.store.db.prepare('UPDATE chat_receipts SET read_at=COALESCE(read_at,?),read_source=COALESCE(read_source,?) WHERE message_id=? AND recipient_id=?')
      .run(new Date().toISOString(), actor === 'human' ? 'human_read_api' : 'mcp_read_api', id, actor);
  }
  readOne(identity: ChatIdentity, id: string): Result<ChatMessage> {
    try {
      if (!z.uuid().safeParse(id).success) throw new DomainError('INVALID_INPUT', 'A valid message ID is required.');
      const row = this.store.db.prepare('SELECT workspace_id FROM chat_messages WHERE id=?').get(id);
      if (!row) throw new DomainError('MESSAGE_NOT_FOUND', 'Message not found in an authorized group.');
      this.allowed(identity, String(row.workspace_id));
      this.store.db.exec('BEGIN IMMEDIATE');
      try { this.markRead(id, identity.actor); const message = this.message(id); this.store.db.exec('COMMIT'); return result(message, message.workspace_id); }
      catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    } catch (error) { return this.failed(error, identity); }
  }
  unread(identity: ChatIdentity) {
    const overview = this.overview(identity).data!;
    const ids = overview.workspaces.map(w => w.workspace_id);
    const rows = (ids.length ? this.store.db.prepare(`SELECT m.id,m.workspace_id,m.project_key,m.sender_id,m.body,m.created_at FROM chat_messages m JOIN chat_receipts r ON r.message_id=m.id
      WHERE r.recipient_id=? AND r.read_at IS NULL AND m.workspace_id IN (${ids.map(() => '?').join(',')}) ORDER BY m.seq DESC LIMIT 100`).all(identity.actor, ...ids) : [])
      .map(row => ({ id: String(row.id), workspace_id: String(row.workspace_id), project_key: row.project_key,
        sender_id: row.sender_id, preview: String(row.body).slice(0, 120), created_at: row.created_at }));
    return result({ messages: rows, unread: overview.total_unread, note: 'Summaries do not mark messages read.' });
  }
  ack(identity:ChatIdentity,wakeId:string){
    try{
      const wake=this.store.db.prepare('SELECT * FROM wake_requests WHERE id=?').get(wakeId);
      if(!wake||wake.actor!==identity.actor)throw new DomainError('CHAT_ACCESS_DENIED','Only the target agent can acknowledge this wake.');
      this.allowed(identity,String(wake.workspace_id));
      const receipt=this.store.db.prepare('SELECT read_at FROM chat_receipts WHERE message_id=? AND recipient_id=?').get(wake.message_id!,identity.actor);
      if(!receipt?.read_at)throw new DomainError('INVALID_INPUT','Read the full message before acknowledging it.');
      this.store.db.exec('BEGIN IMMEDIATE');
      try{
        this.store.db.prepare(`UPDATE wake_requests SET status='ACKNOWLEDGED',code=NULL,updated_at=? WHERE id=?`).run(new Date().toISOString(),wakeId);
        this.store.db.prepare(`UPDATE agent_bindings SET generation=generation+1,updated_at=? WHERE active_wake_id=?`).run(new Date().toISOString(),wakeId);
        this.store.db.exec('COMMIT');return result(this.wakes.messages(String(wake.message_id)).find(row=>row.id===wakeId)!);
      }catch(error){this.store.db.exec('ROLLBACK');throw error;}
    }catch(error){return this.failed(error,identity);}
  }
}
