import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
const folder = await mkdtemp(join(tmpdir(), 'lv999-m0-'));
const env = { SYSTEMROOT: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  LOCALAPPDATA: folder, PATH: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32') };
let management;
let client;
try {
  await cp('apps/desktop/src-tauri/runtime', join(folder, 'runtime'), { recursive: true });
  const exe = join(folder, 'runtime', 'lv999-node.exe');
  const script = join(folder, 'runtime', 'backend.mjs');
  await mkdir(join(folder, 'management-data'));
  management = spawn(exe, [script, 'management', '--data-dir', join(folder, 'management-data')], { env, cwd: folder, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let diagnostics = '';
  management.stderr.on('data', chunk => { diagnostics += chunk; });
  const lines = createInterface({ input: management.stdout });
  management.stdin.write(JSON.stringify({ id: 1, method: 'snapshot' }) + '\n');
  const [line] = await Promise.race([once(lines, 'line'), new Promise((_, reject) => setTimeout(() => reject(new Error('Management startup timed out')), 35000).unref())]);
  const snapshot = JSON.parse(line).result;
  assert.equal(snapshot.backend.node, 'v26.13.1');
  assert.equal(resolve(snapshot.backend.executable), resolve(exe));
  assert.equal(snapshot.backend.status, 'Running');
  assert.equal(snapshot.workspaces.length, 0);
  assert.equal(snapshot.diagnostics.find(d => d.key === 'vault').status, 'pass');
  assert.equal(snapshot.settings.remote_enabled, false);
  console.log('PASS: staged bundled runtime, private management IPC, Windows vault probe, empty registry, no system Node in PATH');
  management.stdin.end();
  await once(management, 'exit'); management = null;
  client = new Client({ name: 'lv999-m0-smoke', version: '0.1.0' });
  const transport = new StdioClientTransport({ command: exe, args: [script, 'mcp', '--data-dir', join(folder, 'mcp-data')], env, cwd: folder, stderr: 'pipe' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), ['get_page','list_projects','list_workspaces','resolve_project','search_workspace','verify_workspace','search_all',
    'get_page_tree','get_block_children','get_database_schema','get_data_source','query_data_source','list_databases','get_page_markdown','list_views',
    'create_page','update_page','append_blocks','update_block','delete_block','trash_page','restore_page','create_database','create_data_source','update_data_source','create_record','update_record','create_view','upload_file','prepare_mutation','get_mutation_status'].sort());
  const response = await client.callTool({ name: 'list_workspaces', arguments: {} });
  assert.equal(JSON.parse(response.content[0].text).ok, true);
  assert.deepEqual(JSON.parse(response.content[0].text).data, []);
  const projects = await client.callTool({ name: 'list_projects', arguments: {} });
  assert.deepEqual(JSON.parse(projects.content[0].text).data, []);
  const unknownRoute = await client.callTool({ name: 'resolve_project', arguments: { project_key: 'QA' } });
  assert.equal(JSON.parse(unknownRoute.content[0].text).code, 'UNKNOWN_PROJECT');
  const rejected = await client.callTool({ name: 'verify_workspace', arguments: { workspace_id: 'invalid' } });
  assert.equal(rejected.isError, true);
  await client.close(); client = null;
  console.log('PASS: MCP v2 initialize, tools/list, tools/call, input rejection and graceful close using staged runtime');
} finally {
  if (client) await client.close();
  if (management) { management.kill(); await once(management, 'exit').catch(() => {}); }
  if (!resolve(folder).startsWith(resolve(tmpdir()) + '\\lv999-m0-')) throw new Error('Cleanup escaped test directory');
  await rm(folder, { recursive: true, force: true });
}
