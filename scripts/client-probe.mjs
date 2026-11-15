import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const base = await mkdtemp(join(tmpdir(), 'lv999-clients-test-'));
try {
  await build({ entryPoints: ['tests/fixtures/client-library.ts'], outfile: join(base, 'client-library.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node26',
    banner: { js: "import { createRequire as __probeRequire } from 'node:module'; const require = __probeRequire(import.meta.url);" } });
  const { ClientManager } = await import(pathToFileURL(join(base, 'client-library.mjs')).href);
  const manager = new ClientManager(join(base, 'data'), { executable: resolve('apps/desktop/src-tauri/runtime/lv999-node.exe'), entry: resolve('apps/desktop/src-tauri/runtime/backend.mjs') });
  const detected = await manager.detect();
  console.log(JSON.stringify(detected.data.map(value => ({ client: value.id, version: value.version, config: value.config_state, status: value.status }))));
  for (const client of ['claude', 'codex']) for (const kind of ['sdk', 'native']) {
    const response = await manager.test({ client, kind, chat_workspace_ids: [] });
    console.log(JSON.stringify({ client, kind, ok: response.ok, handshake: response.data?.handshake }));
  }
} finally {
  if (!resolve(base).startsWith(resolve(tmpdir()) + '\\lv999-clients-test-')) throw new Error('Cleanup escaped QA directory');
  await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
