import { createInterface } from 'node:readline';
import { z } from 'zod';
import { WorkspaceRef, result } from '../../../../packages/contracts/src/index.js';
import type { Service } from '../core/service.js';

const Request = z.object({
  id: z.number().int(),
  method: z.enum(['snapshot','begin_app_update','end_app_update', 'verify_workspace', 'connect_workspace', 'reauthorize_workspace', 'browse_pages', 'inspect_page', 'save_project', 'resolve_project',
    'detect_clients', 'generate_client_config','preview_client_config','apply_client_config', 'test_client',
    'oauth_status', 'configure_oauth', 'start_oauth', 'cancel_oauth', 'refresh_oauth',
    'content_read','set_workspace_writes','prepare_mutation','approve_mutation','execute_mutation','mutation_status','pending_mutations','list_message_boards','setup_message_board','set_board_posting']),
  params: z.unknown().optional(),
}).strict();

export async function runManagement(service: Service) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    let id: number | null = null;
    try {
      if (line.length > 4*1024*1024) throw new Error('INVALID_INPUT');
      const request = Request.parse(JSON.parse(line));
      id = request.id;
      let value;
      switch (request.method) {
        case 'begin_app_update':{const input=z.object({owner:z.uuid(),desktop_pid:z.number().int().positive()}).strict().parse(request.params);value=result({ready:service.store.beginAppUpdate(input.owner,input.desktop_pid)});break;}
        case 'end_app_update':{const input=z.object({owner:z.uuid()}).strict().parse(request.params);service.store.endAppUpdate(input.owner);value=result({released:true});break;}
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
        case 'preview_client_config':value=await service.previewClientConfig(request.params);break;
        case 'apply_client_config':value=await service.applyClientConfig(request.params);break;
        case 'test_client': value = await service.testClient(request.params); break;
        case 'oauth_status': value = result(service.oauth.status()); break;
        case 'configure_oauth': value = await service.oauth.configure(request.params); break;
        case 'start_oauth': value = await service.oauth.start(request.params); break;
        case 'cancel_oauth': value = service.oauth.cancel(); break;
        case 'refresh_oauth': value = await service.refreshOAuth(WorkspaceRef.parse(request.params).workspace_id); break;
        case 'content_read':value=await service.content.read(request.params);break;
        case 'set_workspace_writes':value=await service.content.setEnabled(request.params);break;
        case 'prepare_mutation':value=await service.content.prepare(request.params);break;
        case 'approve_mutation':value=service.content.approve(request.params);break;
        case 'execute_mutation':value=await service.content.execute(request.params);break;
        case 'mutation_status':value=service.content.status(z.object({idempotency_key:z.uuid()}).parse(request.params).idempotency_key);break;
        case 'pending_mutations':value=service.content.pending();break;
        case 'list_message_boards':value=service.boards.list('owner');break;
        case 'setup_message_board':value=await service.boards.setup(request.params);break;
        case 'set_board_posting':value=service.boards.setPosting(request.params);break;
      }
      process.stdout.write(JSON.stringify({ id, result: value }) + '\n');
    } catch {
      // Validation errors can contain the rejected token: never stringify the exception or request.
      process.stdout.write(JSON.stringify({ id, error: result(null, null, 'INVALID_INPUT', ['Invalid management request.']) }) + '\n');
    }
  }
}
