// Test-only composition. Not referenced by the production entry or resource preparation scripts.
// Only Notion HTTP is replaced; native IPC, Service, SQLite and Windows Credential Manager are real.
import { Service } from '../../apps/server/src/core/service.js';
import { Store } from '../../apps/server/src/infra/store.js';
import { WindowsVault } from '../../apps/server/src/infra/vault.js';
import { OfficialNotionAdapter } from '../../apps/server/src/notion/adapter.js';
import { runManagement } from '../../apps/server/src/management/protocol.js';
import { fixtureId } from './workspace-identity.js';

const directory = process.env.LV999_QA_DIRECTORY;
const seed = process.env.LV999_QA_SEED;
if (!directory || !seed) throw new Error('Isolated QA configuration is required.');
const store = new Store(directory);
const service = new Service(store, new WindowsVault(), token => {
  const [, kind, tokenSeed] = token.split(':');
  const workspace = kind?.startsWith('alpha') ? 'alpha' : kind;
  const id = fixtureId(seed, workspace ?? 'invalid');
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
      return Response.json({ object: 'list', results: workspace === 'beta' ? [] : [
        { object: 'page', id: fixtureId(seed, 'page'), properties: {} },
        { object: 'data_source', id: fixtureId(seed, 'source'), title: [] },
      ], has_more: workspace !== 'beta', next_cursor: workspace === 'beta' ? null : 'qa-next-batch' });
    }
    throw new Error('Unexpected Notion endpoint in GUI test.');
  };
  return new OfficialNotionAdapter(token, fetchMock);
});
await service.initialize();
await runManagement(service);
store.close();
