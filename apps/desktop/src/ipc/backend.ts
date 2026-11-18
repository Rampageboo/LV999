import { invoke } from '@tauri-apps/api/core';
import type { ConnectWorkspaceRequest, ReauthorizeWorkspaceRequest, Result, Snapshot, WorkspaceView,
  BrowsePagesRequest, AccessiblePage, PageBatch, ProjectRoute, SaveProjectRequest, ResolveProjectRequest } from '../../../../packages/contracts/src/index.js';
import type { ClientKind, ClientView, GeneratedConfig, ChatOverview, ChatScope, ChatMessage, SendMessageRequest } from '../../../../packages/contracts/src/index.js';
import type { AgentBinding, WakeView } from '../../../../packages/contracts/src/index.js';
import type { OAuthStatus } from '../../../../packages/contracts/src/index.js';
import type { ContentRead,Mutation,MutationPlan,MutationResult } from '../../../../packages/contracts/src/content.js';
export const readContent=(input:ContentRead)=>invoke<Result<any>>('content_request',{method:'content_read',input});
export const setWorkspaceWrites=(workspaceId:string,enabled:boolean)=>invoke<Result<{enabled:boolean}>>('content_request',{method:'set_workspace_writes',input:{workspace_id:workspaceId,enabled}});
export const prepareMutation=(input:Mutation)=>invoke<Result<MutationPlan>>('content_request',{method:'prepare_mutation',input});
export const approveMutation=(plan:MutationPlan)=>invoke<Result<{plan_id:string;plan_hash:string}>>('content_request',{method:'approve_mutation',input:{plan_id:plan.id,plan_hash:plan.hash,confirm:true}});
export const executeMutation=(input:Mutation&{approval?:{plan_id:string;plan_hash:string}})=>invoke<Result<MutationResult>>('content_request',{method:'execute_mutation',input});
export const pendingMutations=()=>invoke<Result<{plans:(MutationPlan&{actor:string})[];operations:any[]}>>('content_request',{method:'pending_mutations',input:{}});
export const oauthStatus = () => invoke<Result<OAuthStatus>>('oauth_request', { method: 'oauth_status', input: {} });
export const configureOAuth = (input: { client_id: string; client_secret?: string }) => invoke<Result<OAuthStatus>>('oauth_request', { method: 'configure_oauth', input });
export const startOAuth = (input: { label: string; environment: 'test'; workspace_id?: string }) => invoke<Result<{authorization_url:string}>>('oauth_request', { method: 'start_oauth', input });
export const cancelOAuth = () => invoke<Result<OAuthStatus>>('oauth_request', { method: 'cancel_oauth', input: {} });
export const refreshOAuth = (workspaceId: string) => invoke<Result<WorkspaceView>>('oauth_request', { method: 'refresh_oauth', input: { workspace_id: workspaceId } });
export const openNotionAuthorization = (url: string) => invoke<void>('open_notion_authorization', { url });
export async function getSnapshot(): Promise<Snapshot> {
  if (!('__TAURI_INTERNALS__' in window)) throw new Error('Desktop backend unavailable. Open the installed LV999 app to use native IPC.');
  return invoke<Snapshot>('backend_snapshot');
}
export const verifyWorkspace = (workspaceId: string) => invoke<Result<WorkspaceView>>('verify_workspace', { workspaceId });
export const connectWorkspace = (input: ConnectWorkspaceRequest) => invoke<Result<WorkspaceView>>('connect_workspace', { input });
export const reauthorizeWorkspace = (input: ReauthorizeWorkspaceRequest) => invoke<Result<WorkspaceView>>('reauthorize_workspace', { input });
export const browsePages = (input: BrowsePagesRequest) => invoke<Result<PageBatch>>('page_route_request', { method: 'browse_pages', input });
export const inspectPage = (workspaceId: string, reference: string) => invoke<Result<AccessiblePage>>('page_route_request', {
  method: 'inspect_page', input: { workspace_id: workspaceId, reference },
});
export const saveProject = (input: SaveProjectRequest) => invoke<Result<ProjectRoute>>('page_route_request', { method: 'save_project', input });
export const resolveProject = (input: ResolveProjectRequest) => invoke<Result<ProjectRoute>>('page_route_request', { method: 'resolve_project', input });
export const detectClients = () => invoke<Result<ClientView[]>>('client_chat_request', { method: 'detect_clients', input: {} });
export const generateClientConfig = (client: ClientKind, chatWorkspaceIds: string[],writeWorkspaceIds:string[]=[]) => invoke<Result<GeneratedConfig>>('client_chat_request', { method: 'generate_client_config', input: { client, chat_workspace_ids: chatWorkspaceIds,write_workspace_ids:writeWorkspaceIds } });
export type ClientConfigPreview={plan_id:string;config_path:string;replaces_existing_entry:boolean;backup_required:boolean};
export const previewClientConfig=(config:GeneratedConfig)=>invoke<Result<ClientConfigPreview>>('client_chat_request',{method:'preview_client_config',input:{client:config.client,chat_workspace_ids:config.chat_workspace_ids,write_workspace_ids:config.write_workspace_ids}});
export const applyClientConfig=(planId:string)=>invoke<Result<{config_path:string;backup_path:string|null;reload_required:boolean}>>('client_chat_request',{method:'apply_client_config',input:{plan_id:planId}});
export const testClient = (client: ClientKind, kind: 'native' | 'sdk', chatWorkspaceIds: string[],writeWorkspaceIds:string[]=[]) => invoke<Result<ClientView>>('client_chat_request', { method: 'test_client', input: { client, kind, chat_workspace_ids: chatWorkspaceIds,write_workspace_ids:writeWorkspaceIds } });
export const getChatOverview = () => invoke<Result<ChatOverview>>('client_chat_request', { method: 'chat_overview', input: {} });
export const readChat = (input: ChatScope) => invoke<Result<{ messages: ChatMessage[]; has_more: boolean }>>('client_chat_request', { method: 'read_chat', input });
export const sendChat = (input: SendMessageRequest) => invoke<Result<ChatMessage>>('client_chat_request', { method: 'send_chat', input });
export const configureAgent = (input: {workspace_id:string;project_key?:string;actor:'claude'|'codex';model:string;effort:'low'|'medium'|'high';enabled:boolean;notion_tools?:boolean;expected_revision:number}) => invoke<Result<AgentBinding>>('client_chat_request',{method:'configure_agent',input});
export const stopAgent = (bindingId:string) => invoke<Result<AgentBinding>>('client_chat_request',{method:'stop_agent',input:{binding_id:bindingId}});
export const resumeAgent = (bindingId:string,revision:number) => invoke<Result<AgentBinding>>('client_chat_request',{method:'resume_agent',input:{binding_id:bindingId,expected_revision:revision}});
export const retryWake = (wakeId:string,revision:number) => invoke<Result<WakeView>>('client_chat_request',{method:'retry_wake',input:{wake_id:wakeId,expected_revision:revision}});
