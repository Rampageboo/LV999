import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { z } from 'zod';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { WorkspaceInput, WorkspaceRef, result } from '../../../../packages/contracts/src/index.js';
import { Service } from '../core/service.js';
import { Store } from '../infra/store.js';
import { WindowsVault } from '../infra/vault.js';
import { createMcpServer } from '../mcp/server.js';

const args = process.argv.slice(2);
const mode = args.shift() ?? 'mcp';
const flag = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const dataDir = flag('--data-dir') ?? join(process.env.LOCALAPPDATA ?? process.cwd(), 'com.rampageboo.lv999');
const store = new Store(dataDir);
const service = new Service(store, new WindowsVault());
await service.initialize();
const Request = z.object({ id: z.number().int(), method: z.enum(['snapshot', 'verify_workspace']), params: z.unknown().optional() }).strict();

if (mode === 'management') {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    let id: number | null = null;
    try {
      if (line.length > 8192) throw new Error('INVALID_INPUT');
      const request = Request.parse(JSON.parse(line));
      id = request.id;
      const value = request.method === 'snapshot' ? service.snapshot() :
        await service.verify(WorkspaceRef.parse(request.params).workspace_id);
      process.stdout.write(JSON.stringify({ id, result: value }) + '\n');
    } catch { process.stdout.write(JSON.stringify({ id, error: result(null, null, 'INVALID_INPUT', ['Invalid management request.']) }) + '\n'); }
  }
  store.close();
} else if (mode === 'mcp') {
  const server = createMcpServer(service);
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
    else throw new Error('INVALID_INPUT');
  } catch {
    console.error(JSON.stringify(result(null, null, 'INVALID_INPUT', ['Use status, register --workspace-id <id> --label <label> --test, or verify --workspace-id <id>.'])));
    process.exitCode = 1;
  } finally { store.close(); }
} else { console.error('Unknown entry mode. Use mcp, management or cli.'); store.close(); process.exitCode = 1; }
