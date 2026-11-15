import { invoke } from '@tauri-apps/api/core';
import type { ConnectWorkspaceRequest, ReauthorizeWorkspaceRequest, Result, Snapshot, WorkspaceView,
  BrowsePagesRequest, AccessiblePage, PageBatch, ProjectRoute, SaveProjectRequest, ResolveProjectRequest } from '../../../../packages/contracts/src/index.js';
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
