import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WorkspaceInput, type Activity, type WorkspaceConfig, type WorkspaceView } from '../../../../packages/contracts/src/index.js';

export class Store {
  readonly db: DatabaseSync;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'registry.db'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, config TEXT NOT NULL, verification TEXT);
      CREATE TABLE IF NOT EXISTS activity (seq INTEGER PRIMARY KEY, event TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS connection_locks (id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);`);
  }
  add(input: WorkspaceConfig) {
    const config = WorkspaceInput.parse(input);
    if (['vibecode', 'honour'].includes(config.label.toLowerCase())) throw new Error('TEST_WORKSPACE_ONLY');
    this.db.prepare('INSERT INTO workspaces (id,config) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config,verification=NULL')
      .run(config.id, JSON.stringify(config));
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
  log(event: Omit<Activity, 'time'>) {
    this.db.prepare('INSERT INTO activity(event) VALUES (?)').run(JSON.stringify({ ...event, time: new Date().toISOString() }));
  }
  activity(): Activity[] {
    return (this.db.prepare('SELECT event FROM activity ORDER BY seq DESC LIMIT 100').all() as {event:string}[]).map(row => JSON.parse(row.event));
  }
  close() { this.db.close(); }
}
