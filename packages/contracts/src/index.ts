import { z } from 'zod';

export const APP_ID = 'com.rampageboo.lv999';
export const APP_VERSION = '0.1.0';
export const NOTION_VERSION = '2026-03-11';
export const WorkspaceInput = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1).max(80),
  environment: z.literal('test'),
}).strict();
export type WorkspaceConfig = z.infer<typeof WorkspaceInput>;
export const WorkspaceRef = z.object({ workspace_id: z.uuid() }).strict();
export type ErrorCode = 'OK' | 'AUTH_REQUIRED' | 'FORBIDDEN' | 'NOT_FOUND_OR_NOT_SHARED' |
  'WORKSPACE_MISMATCH' | 'TEST_WORKSPACE_ONLY' | 'UNKNOWN_WORKSPACE' | 'RATE_LIMITED' |
  'NETWORK_ERROR' | 'VAULT_UNAVAILABLE' | 'IDENTITY_UNAVAILABLE' | 'INVALID_INPUT' | 'UNSUPPORTED' | 'INTERNAL_ERROR';
export type Result<T> = {
  ok: boolean; code: ErrorCode; workspace_id: string | null; project_key: null;
  resource_url: string | null; changed_objects: number; warnings: string[];
  errors: string[]; job_id: null; dry_run: boolean; requires_approval: boolean; data: T | null;
};
export function result<T>(data: T | null, workspace_id: string | null = null,
  code: ErrorCode = 'OK', errors: string[] = []): Result<T> {
  return { ok: code === 'OK', code, workspace_id, project_key: null, resource_url: null,
    changed_objects: 0, warnings: [], errors, job_id: null, dry_run: false,
    requires_approval: false, data };
}
export type WorkspaceView = WorkspaceConfig & {
  status: 'Configured' | 'Connected' | 'Auth required' | 'Degraded';
  verified_name: string | null; bot_id: string | null; checked_at: string | null;
  code: ErrorCode; message: string | null;
};
export type Diagnostic = { key: string; label: string; status: 'pass' | 'pending' | 'error'; detail: string };
export type Activity = { time: string; level: 'info' | 'error'; action: string; workspace_id: string | null; code: ErrorCode };
export type Snapshot = {
  app_version: string; app_id: string; captured_at: string;
  backend: { status: 'Running'; pid: number; node: string; executable: string; transport: 'Private stdio'; started_at: string };
  diagnostics: Diagnostic[]; workspaces: WorkspaceView[]; activity: Activity[];
  projects: []; clients: { name: string; status: 'Not tested'; detail: string }[]; jobs: [];
  settings: { read_only: true; remote_enabled: false; autostart: false; api_version: string; data_dir: string; updater_configured: boolean };
  capabilities: { connect_in_gui: false; routing: false; client_config: false; migration: false; content_write: false };
};
