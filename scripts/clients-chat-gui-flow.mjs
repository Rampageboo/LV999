import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fixtureId } from '../tests/fixtures/workspace-identity.ts';

export async function runClientsChatFlow({ getPage, getBrowser, state, seed, base, evidence, stop, start }) {
  let page = getPage();
  const a = fixtureId(seed, 'alpha'), b = fixtureId(seed, 'beta');
  const rpc = (method, input) => page.evaluate(({ method, input }) => window.__TAURI_INTERNALS__.invoke('client_chat_request', { method, input }), { method, input });
  const mapped = await page.evaluate(input => window.__TAURI_INTERNALS__.invoke('page_route_request', { method: 'save_project', input }), {
    project_key: 'QA', name: 'Chat project', workspace_id: a, root_page_id: fixtureId(seed, 'alpha-root'), expected_revision: 0,
  });
  assert.equal(mapped.ok, true);
  await page.getByRole('button', { name: 'Refresh status', exact: false }).click();
  const card = page.locator('.workspace').filter({ has: page.getByRole('heading', { name: 'Alpha alias', exact: true }) });
  await card.getByRole('button', { name: 'Open group chat', exact: true }).click();
  await page.getByRole('heading', { name: 'Chats', exact: true, level: 1 }).waitFor();
  const note = 'Hello Workspace group. @Codex is plain text.';
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(note);
  await page.getByRole('button', { name: 'Send message', exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await page.locator('.message-body').filter({ hasText: note }).waitFor();
  assert.equal(await page.locator('.own-message .message-bubble').count(), 1);
  assert.equal(await page.locator('.chat-composer').evaluate(element => element.getBoundingClientRect().bottom <= innerHeight + 1), true, 'Composer was not kept inside the desktop viewport');
  const overview = await rpc('chat_overview', {});
  assert.equal(overview.data.workspaces.length, 2);
  assert.equal(overview.data.workspaces.find(w => w.workspace_id === a).agent_unread.codex, 1);
  assert.equal(overview.data.auto_wake, true);
  await page.getByRole('navigation').getByRole('button', { name: 'Clients', exact: true }).click();
  const claude = page.getByRole('region', { name: 'Claude Code integration', exact: true });
  await claude.getByText('Not installed', { exact: true }).waitFor();
  await claude.getByRole('checkbox', { name: 'Alpha alias', exact: true }).check();
  await claude.getByRole('button', { name: 'Generate configuration', exact: true }).click();
  const text = await page.getByRole('textbox', { name: 'Generated configuration', exact: true }).inputValue();
  const config = JSON.parse(text); assert.ok(config.mcpServers.lv999.args.includes('claude')); assert.ok(config.mcpServers.lv999.args.includes(a));
  await claude.getByRole('button', { name: 'Test LV999 transport', exact: true }).click();
  await claude.getByRole('status').filter({ hasText: 'Handshake passed' }).waitFor({ timeout: 30000 });
  assert.equal((await rpc('chat_overview', {})).data.workspaces.find(w => w.workspace_id === a).agent_unread.codex, 1);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: join(evidence, 'clients-configuration.png'), fullPage: true });
  console.log('PASS: Workspace chat entry, ordinary @ text persistence, opt-in configuration generation and real SDK handshake without Agent read receipt');

  let agent;
  try {
    agent = new Client({ name: 'scripted-codex-chat-test', version: '0.1.0' });
    await agent.connect(new StdioClientTransport({ command: join(base, 'app', 'runtime', 'lv999-node.exe'),
      args: [join(base, 'app', 'runtime', 'backend.mjs'), 'mcp', '--client', 'codex', '--chat-workspace', a],
      env: { LV999_QA_DIRECTORY: join(base, 'data'), LV999_QA_SEED: seed }, stderr: 'pipe' }));
    const summaries = JSON.parse((await agent.callTool({ name: 'list_unread', arguments: {} })).content[0].text);
    assert.equal(summaries.data.unread, 1);
    assert.equal((await rpc('chat_overview', {})).data.workspaces.find(w => w.workspace_id === a).agent_unread.codex, 1);
    const full = JSON.parse((await agent.callTool({ name: 'read_message', arguments: { message_id: summaries.data.messages[0].id } })).content[0].text);
    assert.equal(full.data.body, note);
    await page.getByRole('navigation').getByRole('button', { name: 'Chats', exact: true }).click();
    await page.getByRole('button', { name: /All conversations/ }).click();
    const incoming = 'Scripted Codex reply through MCP';
    const response = JSON.parse((await agent.callTool({ name: 'send_message', arguments: { workspace_id: a, project_key: 'QA', route_revision: 1,
      body: incoming, reply_to_id: full.data.id, idempotency_key: randomUUID() } })).content[0].text);
    assert.equal(response.ok, true); assert.equal(response.data.sender_id, 'codex');
    const denied = JSON.parse((await agent.callTool({ name: 'send_message', arguments: { workspace_id: b, body: 'Unauthorized', idempotency_key: randomUUID() } })).content[0].text);
    assert.equal(denied.code, 'CHAT_ACCESS_DENIED');
    assert.equal((await rpc('chat_overview', {})).data.total_unread, 1);
    await page.getByRole('button', { name: /Refresh chats/ }).click();
    await page.getByRole('button', { name: /All conversations · 1 unread/ }).waitFor();
    await page.getByRole('button', { name: 'Alpha alias group chat', exact: true }).click();
    await page.getByText(incoming, { exact: true }).waitFor();
    assert.equal((await rpc('chat_overview', {})).data.total_unread, 0);
    await page.getByRole('textbox', { name: 'Search loaded messages', exact: true }).fill(incoming);
    assert.equal(await page.getByRole('article').count(), 1);
    await page.getByRole('textbox', { name: 'Search loaded messages', exact: true }).fill('');
    await page.screenshot({ path: join(evidence, 'workspace-group-chat.png'), fullPage: true });
    await page.locator('.chat-directory').getByRole('button', { name: /QA · Chat project/ }).click();
    await page.getByText(incoming, { exact: true }).waitFor();
    assert.equal(await page.getByText(note, { exact: true }).count(), 0, 'General message was scattered into the project topic');
    const projectMessage = 'Project topic from the shared overview';
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(projectMessage);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText(projectMessage, { exact: true }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(evidence, 'project-chat-overview.png'), fullPage: true });
    await page.getByRole('navigation').getByRole('button', { name: 'Routing', exact: true }).click();
    await page.getByRole('region', { name: 'Mapping QA', exact: true }).getByRole('button', { name: 'Open project chat', exact: true }).click();
    await page.getByRole('heading', { name: 'Chats', exact: true, level: 1 }).waitFor();
    await page.getByText(projectMessage, { exact: true }).waitFor();
  } finally { if (agent) await agent.close(); }
  await stop(); await start(); page = getPage();
  await page.getByRole('navigation').getByRole('button', { name: 'Chats', exact: true }).click();
  await page.getByRole('heading', { name: 'Conversation overview', exact: true }).waitFor();
  await page.locator('.chat-directory').getByRole('button', { name: /QA · Chat project/ }).click();
  await page.getByText('Project topic from the shared overview', { exact: true }).waitFor();
  await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: join(evidence, 'chats-dark.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  const cdp = await getBrowser().contexts()[0].newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert.equal(await page.locator('body').evaluate(element => element.scrollWidth > innerWidth), false);
  await page.screenshot({ path: join(evidence, 'chats-narrow.png'), fullPage: true });
  console.log('PASS: startup-bound MCP sender, allowlist denial, summary/read separation, grouped project timeline, independent read receipts and restart persistence');
}
