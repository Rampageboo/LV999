import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { parse } from 'smol-toml';
import { ClientManager, claudeHealthPassed } from '../apps/server/src/management/clients.js';
const folders: string[] = [];
afterEach(() => folders.splice(0).forEach(folder => rmSync(folder, { recursive: true, force: true })));
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'lv999-client-unit-')); folders.push(base); mkdirSync(join(base, 'codex'));
  const manager = new ClientManager(join(base, 'data'), { home: base, codexHome: join(base, 'codex'), claudeConfig: join(base, '.claude.json'),
    executable: join(base, 'runtime', 'node.exe'), entry: join(base, 'runtime', 'backend.mjs'), path: join(base, 'no-cli') });
  return { base, manager };
}
it('generates parseable credential-free configurations with startup-bound roles and explicit chat access', () => {
  const f = fixture(), id = randomUUID();
  const claude = f.manager.generate({ client: 'claude', chat_workspace_ids: [id] }).data!;
  expect(JSON.parse(claude.text).mcpServers.lv999.args).toContain('claude'); expect(JSON.parse(claude.text).mcpServers.lv999.args).toContain(id);
  const codex = f.manager.generate({ client: 'codex' }).data!;
  expect((parse(codex.text).mcp_servers as any).lv999.args).toContain('codex'); expect(codex.chat_workspace_ids).toEqual([]);
  expect(codex.text).not.toContain('token'); expect(codex.text).not.toContain('chat-workspace');
});
it('detection returns only owned-entry status and preserves unrelated private configuration', async () => {
  const f = fixture(), privateValue = randomUUID();
  const source = JSON.stringify({ mcpServers: { other: { env: { PRIVATE_VALUE: privateValue } }, lv999: JSON.parse(f.manager.generate({ client: 'claude' }).data!.text).mcpServers.lv999 }, unrelated: privateValue });
  writeFileSync(join(f.base, '.claude.json'), source);
  writeFileSync(join(f.base, 'codex', 'config.toml'), f.manager.generate({ client: 'codex' }).data!.text + '\n# preserved comment\n');
  const response = await f.manager.detect();
  expect(response.data!.every(client => client.config_state === 'Matching')).toBe(true);
  expect(JSON.stringify(response)).not.toContain(privateValue); expect(readFileSync(join(f.base, '.claude.json'), 'utf8')).toBe(source);
  expect(response.data!.every(client => client.status === 'Not installed')).toBe(true);
});
it('malformed and mismatched configurations never become Connected', async () => {
  const f = fixture(); writeFileSync(join(f.base, '.claude.json'), '{malformed'); writeFileSync(join(f.base, 'codex', 'config.toml'), '[mcp_servers.lv999]\ncommand="unrelated"\nargs=[]\n');
  const response = await f.manager.detect();
  expect(response.data!.find(c => c.id === 'claude')!.config_state).toBe('Invalid');
  expect(response.data!.find(c => c.id === 'codex')!.config_state).toBe('Different');
  expect(response.data!.every(c => c.handshake === null)).toBe(true);
});
it('reports missing native clients without inventing a handshake', async () => {
  const f = fixture(); const response = await f.manager.test({ client: 'codex', kind: 'native' });
  expect(response.code).toBe('HANDSHAKE_FAILED'); expect(response.data?.handshake?.ok).toBe(false);
});
it('does not mistake a remote/disabled entry for the generated local stdio profile', async () => {
  const f = fixture();
  const entry = JSON.parse(f.manager.generate({ client: 'claude' }).data!.text).mcpServers.lv999;
  writeFileSync(join(f.base, '.claude.json'), JSON.stringify({ mcpServers: { lv999: { ...entry, type: 'http', url: 'https://example.invalid/mcp' } } }));
  expect((await f.manager.detect()).data!.find(c => c.id === 'claude')!.config_state).toBe('Different');
});
it('requires explicit native Connected evidence rather than a generic check mark', () => {
  expect(claudeHealthPassed(0, 'Status: ✓ Connected')).toBe(true);
  for (const output of ['✓ Configured', 'Not Connected', 'Failed to connect', 'Pending approval']) expect(claudeHealthPassed(0, output)).toBe(false);
  expect(claudeHealthPassed(1, 'Connected')).toBe(false);
});
