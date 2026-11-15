import { createInterface } from 'node:readline';
import { z } from 'zod';
import { WorkspaceRef, result } from '../../../../packages/contracts/src/index.js';
import type { Service } from '../core/service.js';

const Request = z.object({
  id: z.number().int(),
  method: z.enum(['snapshot', 'verify_workspace', 'connect_workspace', 'reauthorize_workspace', 'browse_pages', 'inspect_page', 'save_project', 'resolve_project',
    'detect_clients', 'generate_client_config', 'test_client', 'chat_overview', 'read_chat', 'send_chat', 'configure_agent','stop_agent','resume_agent','retry_wake','shutdown_agents',
    'oauth_status', 'configure_oauth', 'start_oauth', 'cancel_oauth', 'refresh_oauth']),
  params: z.unknown().optional(),
}).strict();

export async function runManagement(service: Service) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    let id: number | null = null;
    try {
      if (line.length > 65536) throw new Error('INVALID_INPUT');
      const request = Request.parse(JSON.parse(line));
      id = request.id;
      let value;
      switch (request.method) {
        case 'snapshot': value = service.snapshot(); break;
        case 'verify_workspace': value = await service.verify(WorkspaceRef.parse(request.params).workspace_id); break;
        case 'connect_workspace': value = await service.connectWorkspace(request.params); break;
        case 'reauthorize_workspace': value = await service.reauthorizeWorkspace(request.params); break;
        case 'browse_pages': value = await service.browsePages(request.params); break;
        case 'inspect_page': value = await service.inspectPage(request.params); break;
        case 'save_project': value = await service.saveProject(request.params); break;
        case 'resolve_project': value = await service.resolveProject(request.params); break;
        case 'detect_clients': value = await service.detectClients(); break;
        case 'generate_client_config': value = service.generateClientConfig(request.params); break;
        case 'test_client': value = await service.testClient(request.params); break;
        case 'chat_overview': value = service.chatOverview(); break;
        case 'read_chat': value = service.readChat(request.params); break;
        case 'send_chat': value = service.sendChat(request.params); break;
        case 'configure_agent': value=service.configureAgent(request.params);break;
        case 'stop_agent':value=service.stopAgent(z.object({binding_id:z.uuid()}).parse(request.params).binding_id);break;
        case 'resume_agent':{const input=z.object({binding_id:z.uuid(),expected_revision:z.number().int()}).parse(request.params);value=service.resumeAgent(input.binding_id,input.expected_revision);break;}
        case 'retry_wake':{const input=z.object({wake_id:z.uuid(),expected_revision:z.number().int()}).parse(request.params);value=service.retryWake(input.wake_id,input.expected_revision);break;}
        case 'shutdown_agents':value=await service.wake.stopAll();await service.oauth.close();break;
        case 'oauth_status': value = result(service.oauth.status()); break;
        case 'configure_oauth': value = await service.oauth.configure(request.params); break;
        case 'start_oauth': value = await service.oauth.start(request.params); break;
        case 'cancel_oauth': value = service.oauth.cancel(); break;
        case 'refresh_oauth': value = await service.refreshOAuth(WorkspaceRef.parse(request.params).workspace_id); break;
      }
      process.stdout.write(JSON.stringify({ id, result: value }) + '\n');
    } catch {
      // Validation errors can contain the rejected token: never stringify the exception or request.
      process.stdout.write(JSON.stringify({ id, error: result(null, null, 'INVALID_INPUT', ['Invalid management request.']) }) + '\n');
    }
  }
}
