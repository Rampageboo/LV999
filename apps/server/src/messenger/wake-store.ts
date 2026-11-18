import { randomUUID } from 'node:crypto';
import { BindingInput, result, type AgentBinding, type WakeView, type ChatIdentity } from '../../../../packages/contracts/src/index.js';
import { DomainError, safeError } from '../notion/adapter.js';
import type { Store } from '../infra/store.js';
export type BindingRow = { id:string; workspace_id:string; project_key:string; actor:'claude'|'codex'; model:string; effort:'low'|'medium'|'high'; enabled:number; paused:number;
  status:AgentBinding['status']; native_session_id:string|null; revision:number; generation:number; active_wake_id:string|null; last_code:string|null; updated_at:string;notion_tools:number };
export class WakeStore {
  constructor(readonly store:Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS agent_bindings (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),project_key TEXT NOT NULL DEFAULT '',actor TEXT NOT NULL CHECK(actor IN ('claude','codex')),
      model TEXT NOT NULL,effort TEXT NOT NULL,enabled INTEGER NOT NULL,paused INTEGER NOT NULL,status TEXT NOT NULL,native_session_id TEXT,
      revision INTEGER NOT NULL,generation INTEGER NOT NULL,active_wake_id TEXT,last_code TEXT,updated_at TEXT NOT NULL,UNIQUE(workspace_id,project_key,actor));
      CREATE TABLE IF NOT EXISTS wake_requests (
        id TEXT PRIMARY KEY,message_id TEXT NOT NULL REFERENCES chat_messages(id),workspace_id TEXT NOT NULL,project_key TEXT NOT NULL DEFAULT '',actor TEXT NOT NULL,
        status TEXT NOT NULL,code TEXT,attempts INTEGER NOT NULL DEFAULT 0,nonce TEXT NOT NULL,lease_owner TEXT,lease_until INTEGER,generation INTEGER,
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(message_id,actor));
      CREATE INDEX IF NOT EXISTS wake_pending ON wake_requests(status,created_at);`);
    if(!store.db.prepare('PRAGMA table_info(agent_bindings)').all().some(row=>row.name==='notion_tools'))store.db.exec('ALTER TABLE agent_bindings ADD COLUMN notion_tools INTEGER NOT NULL DEFAULT 0');
  }
  rows() { return this.store.db.prepare('SELECT * FROM agent_bindings ORDER BY workspace_id,project_key,actor').all() as unknown as BindingRow[]; }
  view(row:BindingRow):AgentBinding { return {id:row.id,workspace_id:row.workspace_id,project_key:row.project_key||null,actor:row.actor,model:row.model,effort:row.effort,
    enabled:Boolean(row.enabled),paused:Boolean(row.paused),status:row.status,native_session_id:row.native_session_id,revision:row.revision,generation:row.generation,last_code:row.last_code,updated_at:row.updated_at,stopping:Boolean(row.paused&&row.active_wake_id),notion_tools:Boolean(row.notion_tools)}; }
  configure(input:unknown) {
    const parsed=BindingInput.safeParse(input);
    if(!parsed.success)return result<AgentBinding>(null,null,'INVALID_INPUT',['Select an exact group, model, effort and binding revision.']);
    const value=parsed.data;
    try {
      if(!this.store.list().some(w=>w.id===value.workspace_id))throw new DomainError('UNKNOWN_WORKSPACE','Connect this Workspace before binding agents.');
      if(value.project_key && !this.store.projects().some(p=>p.project_key===value.project_key&&p.workspace_id===value.workspace_id))throw new DomainError('ROUTE_CONFLICT','The project now targets another Workspace.');
      this.store.db.exec('BEGIN IMMEDIATE');
      try {
        const old=this.rows().find(row=>row.workspace_id===value.workspace_id&&row.project_key===(value.project_key??'')&&row.actor===value.actor);
        if((old?.revision??0)!==value.expected_revision)throw new DomainError('BINDING_CONFLICT','Binding changed. Refresh and reopen agent settings.');
        if(old?.active_wake_id)throw new DomainError('SESSION_BUSY','Stop the active agent before changing its binding.');
        const id=old?.id??randomUUID(), native=old?.model===value.model&&old.effort===value.effort&&Boolean(old.notion_tools)===value.notion_tools?old.native_session_id:null;
        this.store.db.prepare(`INSERT INTO agent_bindings(id,workspace_id,project_key,actor,model,effort,enabled,paused,status,native_session_id,revision,generation,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET model=excluded.model,effort=excluded.effort,enabled=excluded.enabled,paused=excluded.paused,
          status=excluded.status,native_session_id=excluded.native_session_id,revision=excluded.revision,generation=excluded.generation,last_code=NULL,updated_at=excluded.updated_at`)
          .run(id,value.workspace_id,value.project_key??'',value.actor,value.model,value.effort,Number(value.enabled),Number(!value.enabled),value.enabled?'Idle':'Paused',native,
            (old?.revision??0)+1,(old?.generation??0)+1,new Date().toISOString());
        this.store.db.prepare('UPDATE agent_bindings SET notion_tools=? WHERE id=?').run(Number(value.notion_tools),id);
        this.store.log({level:'info',action:`Agent ${value.actor} binding configured`,workspace_id:value.workspace_id,code:'OK'});
        this.store.db.exec('COMMIT');return result(this.view(this.rows().find(row=>row.id===id)!),value.workspace_id);
      }catch(error){this.store.db.exec('ROLLBACK');throw error;}
    }catch(error){const failure=safeError(error);return result<AgentBinding>(null,value.workspace_id,failure.code,[failure.message]);}
  }
  queue(messageId:string, workspaceId:string, projectKey:string|null, actors:('claude'|'codex')[], hop:number) {
    for(const actor of actors) {
      const candidates=this.rows().filter(row=>row.workspace_id===workspaceId&&row.actor===actor);
      const binding=candidates.find(row=>row.project_key===(projectKey??''))??candidates.find(row=>row.project_key==='');
      const code=hop>4?'HOP_LIMIT':!binding?'SESSION_NOT_BOUND':binding.paused||!binding.enabled?'PAUSED_BY_USER':binding.status==='Blocked'?'SESSION_BLOCKED':null;
      const now=new Date().toISOString();
      this.store.db.prepare(`INSERT INTO wake_requests(id,message_id,workspace_id,project_key,actor,status,code,nonce,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(randomUUID(),messageId,workspaceId,binding?.project_key??projectKey??'',actor,code?'BLOCKED':'PENDING',code,randomUUID(),now,now);
    }
  }
  messages(id:string):WakeView[] { return this.store.db.prepare('SELECT id,actor,status,code,attempts FROM wake_requests WHERE message_id=? ORDER BY actor').all(id) as unknown as WakeView[]; }
  pause(id:string) {
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const row=this.rows().find(value=>value.id===id);if(!row)throw new DomainError('INVALID_INPUT','Binding not found.');
      this.store.db.prepare(`UPDATE agent_bindings SET paused=1,status='Paused',generation=generation+1,revision=revision+1,last_code='PAUSED_BY_USER',updated_at=? WHERE id=?`).run(new Date().toISOString(),id);
      this.store.db.prepare(`UPDATE wake_requests SET status='CANCELLED',code='PAUSED_BY_USER',updated_at=? WHERE workspace_id=? AND project_key=? AND actor=? AND status IN ('PENDING','DISPATCHING','DELIVERED','BLOCKED')`)
        .run(new Date().toISOString(),row.workspace_id,row.project_key,row.actor);
      this.store.log({level:'info',action:`Agent ${row.actor} stopped by user`,workspace_id:row.workspace_id,code:'OK'});
      this.store.db.exec('COMMIT');return this.view(this.rows().find(value=>value.id===id)!);
    }catch(error){this.store.db.exec('ROLLBACK');throw error;}
  }
  resume(id:string,revision:number) {
    this.store.db.exec('BEGIN IMMEDIATE');
    try{
      const row=this.rows().find(value=>value.id===id);if(!row)throw new DomainError('INVALID_INPUT','Binding not found.');
      if(row.revision!==revision)throw new DomainError('BINDING_CONFLICT','Binding changed. Refresh before resuming.');
      if(row.active_wake_id)throw new DomainError('SESSION_BUSY','Wait for the stopped native process to exit before resuming.');
      this.store.db.prepare(`UPDATE agent_bindings SET paused=0,enabled=1,status='Idle',generation=generation+1,revision=revision+1,last_code=NULL,updated_at=? WHERE id=?`).run(new Date().toISOString(),id);
      this.store.db.exec('COMMIT');return this.view(this.rows().find(value=>value.id===id)!);
    }catch(error){this.store.db.exec('ROLLBACK');throw error;}
  }
  retry(id:string,revision:number) {
    this.store.db.exec('BEGIN IMMEDIATE');
    try{
    const wake=this.store.db.prepare('SELECT * FROM wake_requests WHERE id=?').get(id);
    if(!wake||!['BLOCKED','CANCELLED'].includes(String(wake.status)))throw new DomainError('INVALID_INPUT','Only a blocked/cancelled wake can be explicitly retried.');
    const candidates=this.rows().filter(row=>row.workspace_id===wake.workspace_id&&row.actor===wake.actor);
    const binding=candidates.find(row=>row.project_key===wake.project_key)??candidates.find(row=>row.project_key==='');
    if(!binding||binding.paused||!binding.enabled||binding.status==='Blocked')throw new DomainError('INVALID_INPUT','Configure and explicitly resume this binding before retrying.');
    if(binding.revision!==revision)throw new DomainError('BINDING_CONFLICT','Binding changed after this retry was requested. Refresh before retrying.');
    const msg=this.store.db.prepare('SELECT hop_count FROM chat_messages WHERE id=?').get(wake.message_id!);
    if(Number(msg?.hop_count??0)>4)throw new DomainError('INVALID_INPUT','Automatic mention hop limit was exceeded. Send a new user-directed request.');
    this.store.db.prepare(`UPDATE wake_requests SET status='PENDING',code=NULL,project_key=?,nonce=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=?`).run(binding.project_key,randomUUID(),new Date().toISOString(),id);
    this.store.db.exec('COMMIT');return this.messages(String(wake.message_id)).find(row=>row.id===id)!;
    }catch(error){this.store.db.exec('ROLLBACK');throw error;}
  }
}
