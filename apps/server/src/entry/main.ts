import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { WorkspaceInput, WorkspaceRef, ChatActor, result, type ChatIdentity } from '../../../../packages/contracts/src/index.js';
import { Service } from '../core/service.js';
import { Store } from '../infra/store.js';
import { WindowsVault } from '../infra/vault.js';
import { createMcpServer } from '../mcp/server.js';
import { runManagement } from '../management/protocol.js';

const args = process.argv.slice(2);
const mode = args.shift() ?? 'mcp';
const flag = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const dataDir = flag('--data-dir') ?? join(process.env.LOCALAPPDATA ?? process.cwd(), 'com.rampageboo.lv999');
const store = new Store(dataDir);
const service = new Service(store, new WindowsVault());
await service.initialize();

if (mode === 'management') {
  await runManagement(service);
  store.close();
} else if (mode === 'mcp') {
  const actor = ChatActor.safeParse(flag('--client'));
  const workspaceIds = args.flatMap((arg, index) => arg === '--chat-workspace' ? [args[index + 1]?.toLowerCase()] : []).filter(Boolean) as string[];
  const identity: ChatIdentity | undefined = actor.success && actor.data !== 'human' ? { actor: actor.data, workspace_ids: workspaceIds } : undefined;
  const server = createMcpServer(service, identity);
  await server.connect(new StdioServerTransport());
  process.stdin.once('end', () => { void server.close().finally(() => store.close()); });
} else if (mode === 'cli') {
  try {
    const command = args[0] ?? 'status';
    if (command === 'register') {
      store.add(WorkspaceInput.parse({ id: flag('--workspace-id')?.toLowerCase(), label: flag('--label'), environment: args.includes('--test') ? 'test' : undefined }));
      console.log(JSON.stringify(result({ status: 'Configured', note: 'Run verify after secure token enrollment.' })));
    } else if (command === 'verify') {
      const { workspace_id } = WorkspaceRef.parse({ workspace_id: flag('--workspace-id')?.toLowerCase() });
      const value = await service.verify(workspace_id);
      console.log(JSON.stringify(value));
      if (!value.ok) process.exitCode = 1;
    } else if (command === 'status') console.log(JSON.stringify(service.snapshot(), null, 2));
    else if (command === 'projects') console.log(JSON.stringify(service.listProjects()));
    else if (command === 'resolve') {
      const value = await service.resolveProject({ ...(flag('--project-key') ? { project_key: flag('--project-key') } : { name: flag('--name') }) });
      console.log(JSON.stringify(value)); if (!value.ok) process.exitCode = 1;
    } else if (command === 'map') {
      const value = await service.saveProject({ project_key: flag('--project-key'), name: flag('--name'), workspace_id: flag('--workspace-id'),
        root_page_id: flag('--root-page-id'), expected_revision: Number(flag('--expected-revision') ?? NaN) });
      console.log(JSON.stringify(value)); if (!value.ok) process.exitCode = 1;
    }
    else throw new Error('INVALID_INPUT');
  } catch {
    console.error(JSON.stringify(result(null, null, 'INVALID_INPUT', ['Use status, register, verify, projects, resolve or map. See docs/setup-windows.md for required arguments.'])));
    process.exitCode = 1;
  } finally { store.close(); }
} else { console.error('Unknown entry mode. Use mcp, management or cli.'); store.close(); process.exitCode = 1; }
