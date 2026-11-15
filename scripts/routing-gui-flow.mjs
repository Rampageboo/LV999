// Invoked only by the isolated workspace GUI harness; Notion HTTP is simulated there.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fixtureId } from '../tests/fixtures/workspace-identity.ts';

export async function runRoutingFlow({ getPage, getBrowser, state, seed, base, evidence, stop, start }) {
  let page = getPage();
  const workspaceA = fixtureId(seed, 'alpha'), workspaceB = fixtureId(seed, 'beta');
  const rootA = fixtureId(seed, 'alpha-root'), secondA = fixtureId(seed, 'alpha-root-two'), rootB = fixtureId(seed, 'beta-root');
  function card() { return page.locator('.workspace').filter({ has: page.getByRole('heading', { name: 'Alpha alias', exact: true }) }); }
  function dialog() { return page.getByRole('dialog', { name: /project mapping/ }); }
  function mapping(key) { return page.getByRole('region', { name: `Mapping ${key}`, exact: true }); }
  async function inspectRoot(id) {
    const picker = dialog().locator('.page-browser');
    await picker.getByRole('textbox', { name: 'Page link or ID', exact: true }).fill(id);
    await picker.getByRole('button', { name: 'Inspect exact page', exact: true }).click();
    const details = picker.getByRole('region', { name: 'Inspected page', exact: true });
    await details.getByText(id, { exact: true }).waitFor();
    return details;
  }
  async function useRoot(id) {
    const details = await inspectRoot(id);
    await details.getByRole('button', { name: 'Use as project root', exact: true }).click();
    await dialog().getByRole('region', { name: 'Selected route target' }).getByText(`Page: ${id}`, { exact: false }).waitFor();
  }
  async function save() {
    await dialog().getByRole('button', { name: 'Save mapping', exact: true }).click();
    await dialog().waitFor({ state: 'hidden', timeout: 30000 });
  }
  function rpc(method, input) { return page.evaluate(({ method, input }) => window.__TAURI_INTERNALS__.invoke('page_route_request', { method, input }), { method, input }); }

  await card().getByRole('button', { name: 'Browse pages', exact: true }).click();
  const pages = card().locator('.page-browser');
  await pages.locator('.page-results li').first().waitFor();
  assert.equal(await pages.locator('.page-results li').count(), 3);
  await pages.getByRole('button', { name: 'Load more pages', exact: true }).click();
  await pages.getByText('4 pages loaded.', { exact: true }).waitFor();
  assert.equal(await pages.locator('.page-results li').count(), 4, 'Pagination did not deduplicate repeated page IDs');
  await pages.getByRole('textbox', { name: 'Page title', exact: true }).fill('no matching title');
  await pages.getByRole('button', { name: 'Search pages', exact: true }).click();
  await pages.getByText(/No matching pages found/).waitFor();
  await pages.getByRole('textbox', { name: 'Page link or ID', exact: true }).fill(`https://www.notion.so/Root-${rootA.replaceAll('-', '')}`);
  await pages.getByRole('button', { name: 'Inspect exact page', exact: true }).click();
  await pages.getByRole('region', { name: 'Inspected page', exact: true }).getByText(rootA, { exact: true }).waitFor();
  await pages.getByRole('textbox', { name: 'Page link or ID', exact: true }).fill(rootB);
  await pages.getByRole('button', { name: 'Inspect exact page', exact: true }).click();
  await pages.getByRole('alert').filter({ hasText: 'NOT_FOUND_OR_NOT_SHARED' }).waitFor();
  await card().getByText('Connected', { exact: true }).waitFor();
  console.log('PASS: native accessible-page pagination/deduplication, empty search, exact Notion-link lookup and wrong-workspace 404 attribution');

  await page.getByRole('navigation').getByRole('button', { name: 'Routing', exact: true }).click();
  await page.getByRole('button', { name: 'Add mapping', exact: true }).click();
  await dialog().getByRole('textbox', { name: 'Project key', exact: true }).fill('QA');
  await dialog().getByRole('textbox', { name: 'Project name', exact: true }).fill('Shared project');
  await dialog().getByRole('combobox', { name: 'Target workspace', exact: true }).selectOption(workspaceA);
  await dialog().locator('.page-results li').first().waitFor();
  const record = await inspectRoot(fixtureId(seed, 'alpha-record'));
  assert.equal(await record.getByRole('button', { name: 'Use as project root', exact: true }).isDisabled(), true);
  const archived = await rpc('save_project', { project_key: 'BAD', name: 'Invalid root', workspace_id: workspaceA,
    root_page_id: fixtureId(seed, 'alpha-archived'), expected_revision: 0 });
  assert.equal(archived.code, 'INELIGIBLE_ROOT');
  await useRoot(secondA);
  await dialog().evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: join(evidence, 'routing-editor.png'), fullPage: true });
  await save();
  await mapping('QA').waitFor();
  let routes = (await state()).projects;
  assert.equal(routes.find(route => route.project_key === 'QA').root_page.id, secondA, 'Same-title pages were guessed instead of bound by ID');
  await mapping('QA').getByRole('button', { name: 'Check route', exact: true }).click();
  await page.getByRole('region', { name: 'Resolved route', exact: true }).getByText(`Page: ${secondA}`, { exact: false }).waitFor();

  await page.getByRole('button', { name: 'Add mapping', exact: true }).click();
  await dialog().getByRole('textbox', { name: 'Project key', exact: true }).fill('QB');
  await dialog().getByRole('textbox', { name: 'Project name', exact: true }).fill('Shared project');
  await dialog().getByRole('note').filter({ hasText: 'ambiguous' }).waitFor();
  await dialog().getByRole('combobox', { name: 'Target workspace', exact: true }).selectOption(workspaceB);
  await useRoot(rootB); await save(); await mapping('QB').waitFor();
  await page.getByRole('textbox', { name: 'Exact project name', exact: true }).fill('Shared project');
  await page.getByRole('button', { name: 'Resolve name', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'AMBIGUOUS_TARGET' }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(evidence, 'routing-ambiguous.png'), fullPage: true });
  console.log('PASS: inspected root selection, record/archive rejection, exact same-title page binding, saved route resolution and duplicate-name refusal');

  await mapping('QA').getByRole('button', { name: 'Edit mapping', exact: true }).click();
  await dialog().locator('.page-results li').first().waitFor();
  assert.equal(await dialog().getByRole('textbox', { name: 'Project key', exact: true }).getAttribute('readonly'), '');
  const old = (await state()).projects.find(route => route.project_key === 'QA');
  assert.equal((await rpc('save_project', { project_key: 'QA', name: 'External update', workspace_id: workspaceA,
    root_page_id: secondA, expected_revision: old.revision })).ok, true);
  await dialog().getByRole('textbox', { name: 'Project name', exact: true }).fill('Stale editor');
  await dialog().getByRole('button', { name: 'Save mapping', exact: true }).click();
  await dialog().getByRole('alert').filter({ hasText: 'ROUTE_CONFLICT' }).waitFor();
  assert.equal((await state()).projects.find(route => route.project_key === 'QA').name, 'External update');
  await dialog().getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh status', exact: false }).click();
  await mapping('QA').getByText('QA · External update', { exact: true }).waitFor();
  await mapping('QA').getByRole('button', { name: 'Edit mapping', exact: true }).click();
  await dialog().locator('.page-results li').first().waitFor();
  await dialog().getByRole('textbox', { name: 'Page title', exact: true }).fill('slow');
  await dialog().getByRole('button', { name: 'Search pages', exact: true }).click();
  await dialog().getByRole('combobox', { name: 'Target workspace', exact: true }).selectOption(workspaceB);
  assert.equal(await dialog().getByRole('button', { name: 'Save mapping', exact: true }).isDisabled(), true, 'Changing workspace retained a root from the old workspace');
  await dialog().locator('.page-results li').first().waitFor();
  assert.equal((await dialog().locator('.page-results').innerText()).includes(rootA), false, 'Late results from the previous workspace were displayed');
  assert.equal(await dialog().getByRole('textbox', { name: 'Page title', exact: true }).inputValue(), '');
  await useRoot(rootB);
  await dialog().getByRole('textbox', { name: 'Project name', exact: true }).fill('Routed project');
  await save();
  const updated = (await state()).projects.find(route => route.project_key === 'QA');
  assert.equal(updated.workspace_id, workspaceB); assert.equal(updated.root_page.id, rootB); assert.equal(updated.revision, 3);
  await page.getByRole('textbox', { name: 'Filter mappings', exact: true }).fill('Routed project');
  assert.equal(await page.locator('.project-route').count(), 1);
  await page.getByRole('textbox', { name: 'Filter mappings', exact: true }).fill('');

  let client;
  try {
    client = new Client({ name: 'routing-qa', version: '0.1.0' });
    await client.connect(new StdioClientTransport({ command: join(base, 'app', 'runtime', 'lv999-node.exe'),
      args: [join(base, 'app', 'runtime', 'backend.mjs'), 'mcp'],
      env: { LV999_QA_DIRECTORY: join(base, 'data'), LV999_QA_SEED: seed }, stderr: 'pipe' }));
    const listing = await client.callTool({ name: 'list_projects', arguments: {} });
    assert.equal(JSON.parse(listing.content[0].text).data.length, 2);
    const resolved = await client.callTool({ name: 'resolve_project', arguments: { project_key: 'qa' } });
    assert.equal(JSON.parse(resolved.content[0].text).data.root_page.id, rootB);
  } finally { if (client) await client.close(); }
  await stop(); await start(); page = getPage();
  await page.getByRole('navigation').getByRole('button', { name: 'Routing', exact: true }).click();
  await mapping('QA').getByText('QA · Routed project', { exact: true }).waitFor();
  assert.equal((await state()).projects.find(route => route.project_key === 'QA').revision, 3);
  await mapping('QA').getByRole('button', { name: 'Edit mapping', exact: true }).click();
  await dialog().getByRole('textbox', { name: 'Project key', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog().evaluate(element => element.contains(document.activeElement)), true);
  await dialog().locator('.page-results li').first().waitFor();
  await dialog().evaluate(element => { element.scrollTop = 0; });
  await getPage().screenshot({ path: join(evidence, 'routing-restart.png'), fullPage: true });
  await getPage().emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: join(evidence, 'routing-dark.png'), fullPage: true });
  await getPage().emulateMedia({ colorScheme: 'light' });
  const cdp = await getBrowser().contexts()[0].newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert.equal(await dialog().evaluate(element => element.scrollWidth > element.clientWidth), false);
  await page.screenshot({ path: join(evidence, 'routing-narrow.png'), fullPage: true });
  await dialog().getByRole('button', { name: 'Cancel', exact: true }).click();
  console.log('PASS: stale-editor conflict, workspace-switch selection reset, explicit reassignment, local filtering, MCP route reads, restart persistence and dark/narrow modal');
}
