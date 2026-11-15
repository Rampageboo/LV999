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
      CREATE TABLE IF NOT EXISTS activity (seq INTEGER PRIMARY KEY, event TEXT NOT NULL);`);
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
        verified_name: null, bot_id: null, checked_at: null, code: 'OK', message: null,
        ...(row.verification ? JSON.parse(row.verification) : {}) }));
  }
  verification(id: string, value: Partial<WorkspaceView>) {
    this.db.prepare('UPDATE workspaces SET verification=? WHERE id=?').run(JSON.stringify(value), id);
  }
  log(event: Omit<Activity, 'time'>) {
    this.db.prepare('INSERT INTO activity(event) VALUES (?)').run(JSON.stringify({ ...event, time: new Date().toISOString() }));
  }
  activity(): Activity[] {
    return (this.db.prepare('SELECT event FROM activity ORDER BY seq DESC LIMIT 100').all() as {event:string}[]).map(row => JSON.parse(row.event));
  }
  close() { this.db.close(); }
}
