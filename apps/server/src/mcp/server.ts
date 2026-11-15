import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { APP_VERSION, WorkspaceRef, result } from '../../../../packages/contracts/src/index.js';
import type { Service } from '../core/service.js';

export function createMcpServer(service: Service) {
  const server = new McpServer({ name: 'lv999-notion', version: APP_VERSION });
  const reply = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    isError: typeof value === 'object' && value !== null && 'ok' in value && value.ok === false });
  server.registerTool('list_workspaces', {
    description: 'List registered test workspaces and last verification evidence; never returns credentials.', inputSchema: z.object({}).strict(),
  }, async () => reply(result(service.snapshot().workspaces)));
  server.registerTool('verify_workspace', {
    description: 'Read the token identity from Notion and compare it to this exact registered test workspace.', inputSchema: WorkspaceRef,
  }, async ({ workspace_id }) => reply(await service.verify(workspace_id)));
  server.registerTool('search_workspace', {
    description: 'Read-only search in one identity-verified test workspace. Pass next_cursor to paginate.',
    inputSchema: WorkspaceRef.extend({ query: z.string().max(500).default(''), start_cursor: z.string().max(200).optional() }),
  }, async ({ workspace_id, query, start_cursor }) => reply(await service.search(workspace_id, query, start_cursor)));
  server.registerTool('get_page', {
    description: 'Read a page in an identity-verified test workspace. 404 may mean missing or not shared.',
    inputSchema: WorkspaceRef.extend({ page_id: z.uuid() }),
  }, async ({ workspace_id, page_id }) => reply(await service.page(workspace_id, page_id)));
  return server;
}
