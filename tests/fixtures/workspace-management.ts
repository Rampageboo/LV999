// Test-only composition. Not referenced by the production entry or resource preparation scripts.
// Only Notion HTTP is replaced; native IPC, Service, SQLite and Windows Credential Manager are real.
import { Service } from '../../apps/server/src/core/service.js';
import { Store } from '../../apps/server/src/infra/store.js';
import { WindowsVault } from '../../apps/server/src/infra/vault.js';
import { OfficialNotionAdapter } from '../../apps/server/src/notion/adapter.js';
import { runManagement } from '../../apps/server/src/management/protocol.js';
import { fixtureId } from './workspace-identity.js';
import { createMcpServer } from '../../apps/server/src/mcp/server.js';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { ClientManager } from '../../apps/server/src/management/clients.js';
import { join } from 'node:path';
import { ChatActor, type ChatIdentity } from '../../packages/contracts/src/index.js';

const directory = process.env.LV999_QA_DIRECTORY;
const seed = process.env.LV999_QA_SEED;
if (!directory || !seed) throw new Error('Isolated QA configuration is required.');
const store = new Store(directory);
const service = new Service(store, new WindowsVault(), token => {
  const [, kind, tokenSeed] = token.split(':');
  const workspace = kind?.startsWith('alpha') ? 'alpha' : kind;
  const id = fixtureId(seed, workspace ?? 'invalid');
  function pages() {
    return ['root', 'root-two', 'record', 'archived'].map(pageKind => ({ object: 'page', id: fixtureId(seed!, `${workspace}-${pageKind}`),
      properties: { custom_title: { type: 'title', title: [{ plain_text: pageKind.startsWith('root') ? 'Shared root' : pageKind === 'record' ? 'Database record' : 'Archived page' }] } },
      parent: { type: pageKind === 'record' ? 'data_source_id' : 'workspace' }, archived: pageKind === 'archived', in_trash: false,
      last_edited_time: new Date().toISOString() }));
  }
  const fetchMock: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (kind === 'network') throw new Error(`Untrusted network error ${token}`);
    if (tokenSeed !== seed || kind === 'unauthorized')
      return Response.json({ object: 'error', status: 401, code: 'unauthorized', message: token }, { status: 401 });
    if (request.url.endsWith('/v1/users/me')) {
      return Response.json({ object: 'user', id: fixtureId(seed, 'bot'), type: 'bot',
        bot: { workspace_id: id, workspace_name: kind === 'production' ? 'Honour' : workspace === 'alpha' ? 'Test Alpha' : 'Test Beta' } });
    }
    if (request.url.endsWith('/v1/search')) {
      if (kind === 'forbidden' || kind === 'alpha-forbidden')
        return Response.json({ object: 'error', status: 403, code: 'restricted_resource', message: token }, { status: 403 });
      const body = await request.json() as { query?: string; start_cursor?: string; filter?: { value?: string } };
      if (body.filter?.value === 'page') {
        const all = pages();
        if (body.query === 'slow') await new Promise(resolve => setTimeout(resolve, 700));
        const filtered = body.query && body.query !== 'slow' ? all.filter(page => page.properties.custom_title.title[0].plain_text.toLowerCase().includes(body.query!.toLowerCase())) : all;
        const results = body.query ? filtered : body.start_cursor ? [all[1], all[0]] : [all[0], all[2], all[3]];
        return Response.json({ object: 'list', results, has_more: !body.query && !body.start_cursor, next_cursor: !body.query && !body.start_cursor ? 'qa-page-two' : null });
      }
      return Response.json({ object: 'list', results: workspace === 'beta' ? [] : [
        { object: 'page', id: fixtureId(seed, 'page'), properties: {} },
        { object: 'data_source', id: fixtureId(seed, 'source'), title: [] },
      ], has_more: workspace !== 'beta', next_cursor: workspace === 'beta' ? null : 'qa-next-batch' });
    }
    if (request.url.includes('/v1/pages/')) {
      const pageId = request.url.split('/').at(-1);
      const found = pages().find(page => page.id === pageId);
      if (found) return Response.json(found);
      return Response.json({ object: 'error', status: 404, code: 'object_not_found', message: token }, { status: 404 });
    }
    throw new Error('Unexpected Notion endpoint in GUI test.');
  };
  return new OfficialNotionAdapter(token, fetchMock);
}, { clients: new ClientManager(directory, { home: directory, codexHome: join(directory, 'client-profile'), claudeConfig: join(directory, 'claude-profile.json'),
  transportEnv: { LV999_QA_DIRECTORY: directory, LV999_QA_SEED: seed } }) });
await service.initialize();
if (process.argv[2] === 'mcp') {
  const args = process.argv.slice(2);
  const actor = ChatActor.safeParse(args[args.indexOf('--client') + 1]);
  const identity: ChatIdentity | undefined = actor.success && actor.data !== 'human' ? { actor: actor.data, workspace_ids: args.flatMap((arg, index) => arg === '--chat-workspace' ? [args[index + 1]] : []) } : undefined;
  const server = createMcpServer(service, identity);
  await server.connect(new StdioServerTransport());
  process.stdin.once('end', () => { void server.close().finally(() => store.close()); });
} else { await runManagement(service); store.close(); }
