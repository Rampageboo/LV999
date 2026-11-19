import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WorkspaceInput,isProtectedWorkspaceName, type Activity, type WorkspaceConfig, type WorkspaceView, type ProjectRoute, type SaveProjectRequest, type AccessiblePage } from '../../../../packages/contracts/src/index.js';
export const projectNameLookup = (name: string) => name.normalize('NFKC').trim().toLowerCase();

export class Store {
  readonly db: DatabaseSync;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'registry.db'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, config TEXT NOT NULL, verification TEXT);
      CREATE TABLE IF NOT EXISTS activity (seq INTEGER PRIMARY KEY, event TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS connection_locks (id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_settings (singleton INTEGER PRIMARY KEY CHECK(singleton=1), client_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notion_request_slots (connection_hash TEXT PRIMARY KEY,next_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS protected_workspaces (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS project_routes (
        project_key TEXT PRIMARY KEY, name_lookup TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        revision INTEGER NOT NULL, route TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS project_routes_name ON project_routes(name_lookup);`);
  }
  add(input: WorkspaceConfig) {
    const config = WorkspaceInput.parse(input);
    if (isProtectedWorkspaceName(config.label)||this.isProtected(config.id)) throw new Error('PROTECTED_WORKSPACE');
    this.db.prepare('INSERT INTO workspaces (id,config) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config,verification=NULL')
      .run(config.id, JSON.stringify(config));
  }
  isProtected(id:string){return Boolean(this.db.prepare('SELECT id FROM protected_workspaces WHERE id=?').get(id.toLowerCase()));}
  protect(id:string){this.db.prepare('INSERT OR IGNORE INTO protected_workspaces(id) VALUES(?)').run(id.toLowerCase());}
  async requestSlot(connectionHash:string,signal?:AbortSignal){
    signal?.throwIfAborted();this.db.exec('BEGIN IMMEDIATE');let scheduled:number;
    try{const next=Number(this.db.prepare('SELECT next_at FROM notion_request_slots WHERE connection_hash=?').get(connectionHash)?.next_at??0);scheduled=Math.max(Date.now(),next);
      this.db.prepare('INSERT INTO notion_request_slots(connection_hash,next_at) VALUES(?,?) ON CONFLICT(connection_hash) DO UPDATE SET next_at=excluded.next_at').run(connectionHash,scheduled+350);this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    if(scheduled>Date.now())await delay(scheduled-Date.now(),undefined,{signal});signal?.throwIfAborted();
  }
  list(): WorkspaceView[] {
    return (this.db.prepare('SELECT config,verification FROM workspaces ORDER BY id').all() as {config: string; verification: string | null}[])
      .map(row => ({ ...WorkspaceInput.parse(JSON.parse(row.config)), status: 'Configured',
        verified_name: null, bot_id: null, checked_at: null, code: 'OK', message: null, read_access: null,
        ...(row.verification ? JSON.parse(row.verification) : {}) }));
  }
  verification(id: string, value: Partial<WorkspaceView>) {
    this.db.prepare('UPDATE workspaces SET verification=? WHERE id=?').run(JSON.stringify(value), id);
  }
  acquireConnection(id: string, owner: string) {
    const now = Date.now();
    return this.db.prepare(`INSERT INTO connection_locks(id,owner,expires) VALUES (?,?,?)
      ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE connection_locks.expires<?`)
      .run(id, owner, now + 180000, now).changes === 1;
  }
  releaseConnection(id: string, owner: string) {
    this.db.prepare('DELETE FROM connection_locks WHERE id=? AND owner=?').run(id, owner);
  }
  saveConnection(config: WorkspaceConfig, verification: Partial<WorkspaceView>, replace: boolean, owner: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.db.prepare('SELECT id FROM connection_locks WHERE id=? AND owner=? AND expires>?').get(config.id, owner, Date.now()))
        throw new Error('CONNECTION_LEASE_EXPIRED');
      if (replace) {
        const changed = this.db.prepare('UPDATE workspaces SET verification=? WHERE id=?')
          .run(JSON.stringify(verification), config.id).changes;
        if (changed !== 1) throw new Error('CONNECTION_DISAPPEARED');
      } else {
        this.db.prepare('INSERT INTO workspaces(id,config,verification) VALUES (?,?,?)')
          .run(config.id, JSON.stringify(WorkspaceInput.parse(config)), JSON.stringify(verification));
      }
      this.log({ level: 'info', action: replace ? 'Workspace reauthorized' : 'Workspace connected', workspace_id: config.id, code: 'OK' });
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  projects(): ProjectRoute[] {
    return (this.db.prepare('SELECT route FROM project_routes ORDER BY project_key').all() as { route: string }[]).map(row => JSON.parse(row.route));
  }
  saveProject(input: SaveProjectRequest, root: AccessiblePage): ProjectRoute | null {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.db.prepare('SELECT revision FROM project_routes WHERE project_key=?').get(input.project_key);
      if (Number(current?.revision ?? 0) !== input.expected_revision) { this.db.exec('ROLLBACK'); return null; }
      const now = new Date().toISOString();
      const route: ProjectRoute = { project_key: input.project_key, name: input.name, workspace_id: input.workspace_id,
        root_page: root, revision: input.expected_revision + 1, updated_at: now, validated_at: now };
      this.db.prepare(`INSERT INTO project_routes(project_key,name_lookup,workspace_id,revision,route) VALUES (?,?,?,?,?)
        ON CONFLICT(project_key) DO UPDATE SET name_lookup=excluded.name_lookup,workspace_id=excluded.workspace_id,revision=excluded.revision,route=excluded.route`)
        .run(input.project_key, projectNameLookup(input.name), input.workspace_id, route.revision, JSON.stringify(route));
      this.log({ level: 'info', action: `Project route ${input.project_key} saved`, workspace_id: input.workspace_id, code: 'OK' });
      this.db.exec('COMMIT');
      return route;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  log(event: Omit<Activity, 'time'>) {
    this.db.prepare('INSERT INTO activity(event) VALUES (?)').run(JSON.stringify({ ...event, time: new Date().toISOString() }));
  }
  activity(): Activity[] {
    return (this.db.prepare('SELECT event FROM activity ORDER BY seq DESC LIMIT 100').all() as {event:string}[]).map(row => JSON.parse(row.event));
  }
  close() { this.db.close(); }
}
