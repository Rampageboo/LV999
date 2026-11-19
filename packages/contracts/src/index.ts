import { z } from 'zod';

export const APP_ID = 'com.rampageboo.lv999';
export const APP_VERSION = '0.1.0';
export const NOTION_VERSION = '2026-03-11';
export const WorkspaceEnvironment=z.enum(['test','production']);
export type WorkspaceEnvironmentId=z.infer<typeof WorkspaceEnvironment>;
export const isProtectedWorkspaceName=(name:string)=>['vibecode','honour'].includes(name.normalize('NFKC').trim().toLowerCase());
const ExpectedWorkspaceName=z.string().trim().min(1).max(200);
export const WorkspaceInput = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1).max(80),
  environment: WorkspaceEnvironment,
}).strict();
export type WorkspaceConfig = z.infer<typeof WorkspaceInput>;
export const WorkspaceRef = z.object({ workspace_id: z.uuid().transform(id => id.toLowerCase()) }).strict();
export const ConnectWorkspaceInput = z.object({
  label: z.string().trim().max(80).default(''),
  token: z.string().trim().min(1).max(2048),
  environment: WorkspaceEnvironment,
  expected_workspace_name:ExpectedWorkspaceName.optional(),
}).strict();
export const ReauthorizeWorkspaceInput = ConnectWorkspaceInput.omit({ label: true }).extend({ workspace_id: z.uuid() });
export type ConnectWorkspaceRequest = z.infer<typeof ConnectWorkspaceInput>;
export type ReauthorizeWorkspaceRequest = z.infer<typeof ReauthorizeWorkspaceInput>;
export const OAuthConfigInput = z.object({ client_id: z.uuid().transform(id => id.toLowerCase()),
  client_secret: z.string().trim().min(1).max(500).optional() }).strict();
export const OAuthStartInput = z.object({ label: z.string().trim().max(80).default(''), environment: WorkspaceEnvironment,
  expected_workspace_name:ExpectedWorkspaceName.optional(),
  workspace_id: z.uuid().transform(id => id.toLowerCase()).optional() }).strict();
export type OAuthStatus = { configured: boolean; client_id: string | null; redirect_uri: string;
  phase: 'idle' | 'awaiting' | 'exchanging' | 'complete' | 'failed' | 'cancelled' | 'expired';
  outcome: Result<WorkspaceView> | null };
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
export const ClientId = z.enum(['claude', 'codex']);
export type ClientKind = z.infer<typeof ClientId>;
export const ClientConfigInput = z.object({ client: ClientId, chat_workspace_ids: z.array(z.uuid().transform(id => id.toLowerCase())).max(100).default([]),
  read_workspace_ids:z.array(z.uuid().transform(id=>id.toLowerCase())).max(100).default([]),
  board_project_keys:z.array(ProjectKey).max(100).default([]),boards_only:z.boolean().default(false),
  write_workspace_ids:z.array(z.uuid().transform(id=>id.toLowerCase())).max(100).default([]) }).strict();
export const ClientTestInput = ClientConfigInput.extend({ kind: z.enum(['sdk', 'native']).default('native') });
export type ClientView = {
  id: ClientKind; name: string; status: 'Not tested' | 'Not installed' | 'Not configured' | 'Configured' | 'Degraded';
  version: string | null; executable: string | null; config_path: string; config_state: 'Unknown' | 'Missing' | 'Matching' | 'Different' | 'Invalid';
  detail: string; detected_at: string | null;
  handshake: { kind: 'sdk' | 'native'; ok: boolean; checked_at: string; tool_count: number; detail: string } | null;
};
export type GeneratedConfig = { client: ClientKind; format: 'JSON' | 'TOML'; config_path: string; server_name: string; text: string; chat_workspace_ids: string[]; write_workspace_ids:string[];read_workspace_ids:string[];board_project_keys:string[];boards_only:boolean };
export const ChatActor = z.enum(['human', 'claude', 'codex']);
export type ChatActorId = z.infer<typeof ChatActor>;
export type ChatIdentity = { actor: ChatActorId; workspace_ids: string[] | 'owner' };
export const ChatScopeInput = z.object({ workspace_id: z.uuid().transform(id => id.toLowerCase()).optional(), project_key: ProjectKey.optional(),
  before_seq: z.number().int().positive().optional(), limit: z.number().int().min(1).max(100).default(50) }).strict()
  .refine(value => Boolean(value.workspace_id || value.project_key));
export const SendMessageInput = z.object({ workspace_id: z.uuid().transform(id => id.toLowerCase()), project_key: ProjectKey.optional(),
  route_revision: z.number().int().positive().optional(), body: z.string().trim().min(1).max(8000),
  reply_to_id: z.uuid().optional(), idempotency_key: z.uuid(), mentions: z.array(z.enum(['claude', 'codex'])).max(2).default([]) }).strict();
export type SendMessageRequest = z.infer<typeof SendMessageInput>;
export type ChatScope = z.infer<typeof ChatScopeInput>;
export const BindingInput = z.object({ workspace_id: z.uuid().transform(id => id.toLowerCase()), project_key: ProjectKey.optional(), actor: z.enum(['claude','codex']),
  model: z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/), effort: z.enum(['low','medium','high']).default('low'), enabled: z.boolean(),notion_tools:z.boolean().default(false), expected_revision:z.number().int().min(0) }).strict();
export type AgentBinding = { id:string; workspace_id:string; project_key:string|null; actor:'claude'|'codex'; model:string; effort:'low'|'medium'|'high';
  enabled:boolean; paused:boolean; status:'Idle'|'Busy'|'Paused'|'Blocked'; native_session_id:string|null; revision:number; generation:number;
  last_code:string|null; updated_at:string; stopping:boolean;notion_tools:boolean };
export type WakeView = { id:string; actor:'claude'|'codex'; status:'PENDING'|'DISPATCHING'|'DELIVERED'|'ACKNOWLEDGED'|'BLOCKED'|'CANCELLED'; code:string|null; attempts:number };
export type ChatMessage = { id: string; seq: number; workspace_id: string; project_key: string | null; project_name: string | null;
  sender_id: ChatActorId; body: string; reply_to_id: string | null; created_at: string;
  receipts: { recipient_id: ChatActorId; read_at: string | null; read_source: string | null }[]; mentions:('claude'|'codex')[]; wakes:WakeView[] };
export type ChatOverview = {
  workspaces: { workspace_id: string; label: string; message_count: number; unread: number; agent_unread: { claude: number; codex: number }; last_preview: string | null }[];
  projects: { project_key: string; name: string; workspace_id: string | null; revision: number | null; message_count: number; unread: number }[];
  total_unread: number; auto_wake: boolean; bindings:AgentBinding[];
};
export type ErrorCode = 'OK' | 'AUTH_REQUIRED' | 'FORBIDDEN' | 'NOT_FOUND_OR_NOT_SHARED' |
  'WORKSPACE_MISMATCH' | 'TEST_WORKSPACE_ONLY' | 'PROTECTED_WORKSPACE' | 'UNKNOWN_WORKSPACE' | 'RATE_LIMITED' |
  'NETWORK_ERROR' | 'VAULT_UNAVAILABLE' | 'IDENTITY_UNAVAILABLE' | 'INVALID_INPUT' | 'UNSUPPORTED' | 'INTERNAL_ERROR' |
  'WORKSPACE_EXISTS' | 'CONNECTION_BUSY' | 'LOCAL_SAVE_FAILED' | 'CREDENTIAL_STATE_UNCERTAIN' | 'OAUTH_FAILED' | 'OAUTH_CALLBACK_BUSY' |
  'INVALID_RESPONSE' | 'INELIGIBLE_ROOT' | 'UNKNOWN_PROJECT' | 'AMBIGUOUS_TARGET' | 'ROUTE_CONFLICT' |
  'CHAT_ACCESS_DENIED' | 'MESSAGE_NOT_FOUND' | 'IDEMPOTENCY_CONFLICT' | 'CLIENT_UNAVAILABLE' | 'HANDSHAKE_FAILED' | 'BINDING_CONFLICT' | 'SESSION_BUSY' |
  'WRITE_DISABLED' | 'WRITE_ACCESS_DENIED' | 'CONTENT_ACCESS_DENIED' | 'CONTENT_CONFLICT' | 'APPROVAL_REQUIRED' | 'APPROVAL_INVALID' | 'MUTATION_BUSY' | 'MUTATION_OUTCOME_UNKNOWN' | 'READBACK_FAILED';
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
  write_enabled?: boolean;
  board_append_projects?:string[];
  auth_kind?: 'internal' | 'oauth';
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
  projects: ProjectRoute[]; clients: ClientView[]; jobs: [];
  settings: { read_only: boolean; remote_enabled: false; autostart: false; api_version: string; data_dir: string; updater_configured: boolean };
  capabilities: { connect_in_gui: boolean; browse_pages: boolean; routing: boolean; client_config: boolean; group_chat: boolean; auto_wake: boolean; migration: false; content_write: boolean };
};
export * from './content.js';
