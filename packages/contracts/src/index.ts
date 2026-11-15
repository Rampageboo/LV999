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
export const WorkspaceRef = z.object({ workspace_id: z.uuid().transform(id => id.toLowerCase()) }).strict();
export const ConnectWorkspaceInput = z.object({
  label: z.string().trim().max(80).default(''),
  token: z.string().trim().min(1).max(2048),
  environment: z.literal('test'),
}).strict();
export const ReauthorizeWorkspaceInput = ConnectWorkspaceInput.omit({ label: true }).extend({ workspace_id: z.uuid() });
export type ConnectWorkspaceRequest = z.infer<typeof ConnectWorkspaceInput>;
export type ReauthorizeWorkspaceRequest = z.infer<typeof ReauthorizeWorkspaceInput>;
export const BrowsePagesInput = WorkspaceRef.extend({ query: z.string().trim().max(500).default(''), start_cursor: z.string().min(1).max(200).optional() });
export const InspectPageInput = WorkspaceRef.extend({ reference: z.string().trim().min(1).max(2048) });
export const ProjectKey = z.string().trim().transform(key => key.toUpperCase()).pipe(z.string().regex(/^[A-Z][A-Z0-9_-]{0,31}$/));
export const SaveProjectInput = z.object({
  project_key: ProjectKey, name: z.string().trim().min(1).max(80), workspace_id: z.uuid().transform(id => id.toLowerCase()),
  root_page_id: z.uuid().transform(id => id.toLowerCase()), expected_revision: z.number().int().min(0),
}).strict();
export const ResolveProjectInput = z.object({ project_key: ProjectKey.optional(), name: z.string().trim().min(1).max(80).optional() })
  .strict().refine(input => Number(Boolean(input.project_key)) + Number(Boolean(input.name)) === 1);
export type BrowsePagesRequest = z.infer<typeof BrowsePagesInput>;
export type SaveProjectRequest = z.infer<typeof SaveProjectInput>;
export type ResolveProjectRequest = z.infer<typeof ResolveProjectInput>;
export type AccessiblePage = {
  workspace_id: string; id: string; title: string; url: string; parent_kind: string;
  last_edited_time: string | null; root_eligible: boolean; root_reason: string | null;
};
export type PageBatch = { pages: AccessiblePage[]; has_more: boolean; next_cursor: string | null; skipped_objects: number };
export type ProjectRoute = {
  project_key: string; name: string; workspace_id: string; root_page: AccessiblePage;
  revision: number; updated_at: string; validated_at: string;
};
export type ErrorCode = 'OK' | 'AUTH_REQUIRED' | 'FORBIDDEN' | 'NOT_FOUND_OR_NOT_SHARED' |
  'WORKSPACE_MISMATCH' | 'TEST_WORKSPACE_ONLY' | 'UNKNOWN_WORKSPACE' | 'RATE_LIMITED' |
  'NETWORK_ERROR' | 'VAULT_UNAVAILABLE' | 'IDENTITY_UNAVAILABLE' | 'INVALID_INPUT' | 'UNSUPPORTED' | 'INTERNAL_ERROR' |
  'WORKSPACE_EXISTS' | 'CONNECTION_BUSY' | 'LOCAL_SAVE_FAILED' | 'CREDENTIAL_STATE_UNCERTAIN' |
  'INVALID_RESPONSE' | 'INELIGIBLE_ROOT' | 'UNKNOWN_PROJECT' | 'AMBIGUOUS_TARGET' | 'ROUTE_CONFLICT';
export type Result<T> = {
  ok: boolean; code: ErrorCode; workspace_id: string | null; project_key: string | null;
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
  read_access: { checked_at: string; sampled_objects: number; has_more: boolean } | null;
};
export type Diagnostic = { key: string; label: string; status: 'pass' | 'pending' | 'error'; detail: string };
export type Activity = { time: string; level: 'info' | 'error'; action: string; workspace_id: string | null; code: ErrorCode };
export type Snapshot = {
  app_version: string; app_id: string; captured_at: string;
  backend: { status: 'Running'; pid: number; node: string; executable: string; transport: 'Private stdio'; started_at: string };
  diagnostics: Diagnostic[]; workspaces: WorkspaceView[]; activity: Activity[];
  projects: ProjectRoute[]; clients: { name: string; status: 'Not tested'; detail: string }[]; jobs: [];
  settings: { read_only: true; remote_enabled: false; autostart: false; api_version: string; data_dir: string; updater_configured: boolean };
  capabilities: { connect_in_gui: boolean; browse_pages: boolean; routing: boolean; client_config: false; migration: false; content_write: false };
};
