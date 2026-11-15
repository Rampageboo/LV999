// Native integration test: replace only Notion HTTP in an isolated copy of the application.
// No adapter override or QA mode is built into the production application.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fixtureId, fixtureToken } from '../tests/fixtures/workspace-identity.ts';
import { runRoutingFlow } from './routing-gui-flow.mjs';

const base = await mkdtemp(join(tmpdir(), 'lv999-workspace-test-'));
const positionalArgs = process.argv.slice(2).filter(arg => arg !== '--routing');
const evidence = resolve(positionalArgs[1] ?? join(tmpdir(), process.argv.includes('--routing') ? 'lv999-routing-qa' : 'lv999-workspace-qa'));
const original = resolve(positionalArgs[0] ?? 'apps/desktop/src-tauri/target/release/lv999-desktop.exe');
const runtime = join(base, 'app', 'runtime');
const seed = randomUUID();
const ids = ['alpha', 'beta', 'forbidden', 'production'].map(kind => fixtureId(seed, kind));
const tokens = ['alpha', 'alpha-rotated', 'alpha-forbidden', 'beta', 'unauthorized', 'network', 'forbidden', 'production']
  .map(kind => fixtureToken(seed, kind));
let app, browser, page, backendPid, vault;
const errors = [];
const ownedCredentialIds = new Set();
const bundleOptions = { bundle: true, platform: 'node', target: 'node26', format: 'esm',
  banner: { js: "import { createRequire as __qaRequire } from 'node:module'; const require = __qaRequire(import.meta.url);" } };

async function start() {
  const env = { ...process.env, LV999_QA_DIRECTORY: join(base, 'data'), LV999_QA_SEED: seed,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=19336 --remote-debugging-address=127.0.0.1' };
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'Path';
  env[pathKey] = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  delete env.NODE_OPTIONS; delete env.NODE_PATH;
  app = spawn(join(base, 'app', 'lv999-desktop.exe'), [], { env, stdio: 'ignore', windowsHide: true });
  for (let attempt = 0; attempt < 60; attempt++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:19336'); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(browser, 'Native WebView2 was not available');
  const context = browser.contexts()[0];
  for (let attempt = 0; attempt < 60; attempt++) {
    page = context.pages().find(candidate => candidate.url().includes('tauri.localhost'));
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(page, 'Native frontend not found');
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  await page.getByText('Running', { exact: true }).waitFor({ timeout: 15000 });
  const snapshot = await state(); backendPid = snapshot.backend.pid;
  assert.equal(resolve(snapshot.settings.data_dir), resolve(join(base, 'data')));
  assert.equal(snapshot.backend.node, 'v26.13.1');
  await page.getByRole('navigation').getByRole('button', { name: 'Workspaces', exact: true }).click();
}
async function stop() {
  if (browser) { await browser.close(); browser = undefined; }
  if (backendPid) { try { process.kill(backendPid); } catch {} backendPid = undefined; }
  if (app) {
    const closed = app.exitCode !== null ? Promise.resolve() : once(app, 'exit');
    app.kill(); await closed; app = undefined;
  }
}
function state() { return page.evaluate(() => window.__TAURI_INTERNALS__.invoke('backend_snapshot')); }
async function open() {
  await page.getByRole('button', { name: 'Connect workspace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect test workspace' });
  await dialog.waitFor(); return dialog;
}
async function submit(dialog, kind, label) {
  if (label !== undefined) await dialog.locator('input[name="display_name"]').fill(label);
  await dialog.locator('input[name="connection_token"]').fill(fixtureToken(seed, kind));
  await dialog.locator('input[name="test_confirm"]').check();
  await dialog.getByRole('button', { name: /Verify &/ }).click();
  assert.equal(await dialog.locator('input[name="connection_token"]').inputValue(), '', 'Token remained in the password field after submission');
}
function card(name = 'Alpha alias') { return page.locator('.workspace').filter({ has: page.getByRole('heading', { name, exact: true }) }); }
async function connected(dialog, name) {
  await dialog.waitFor({ state: 'hidden', timeout: 30000 });
  await card(name).getByText('Connected', { exact: true }).waitFor();
}
async function noLeak() {
  const visible = await page.locator('body').innerText();
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  const snapshot = JSON.stringify(await state());
  for (const token of tokens) {
    assert.equal(visible.includes(token) || storage.includes(token) || snapshot.includes(token), false, 'Credential leaked to UI, browser storage or management results');
    for (const file of ['registry.db', 'registry.db-wal']) {
      let bytes; try { bytes = await readFile(join(base, 'data', file)); } catch { continue; }
      assert.equal(bytes.includes(Buffer.from(token)), false, 'Credential leaked to SQLite');
    }
  }
}

try {
  await mkdir(runtime, { recursive: true }); await mkdir(evidence, { recursive: true });
  await copyFile(original, join(base, 'app', 'lv999-desktop.exe'));
  await copyFile('apps/desktop/src-tauri/runtime/lv999-node.exe', join(runtime, 'lv999-node.exe'));
  await copyFile('scripts/credential-vault.ps1', join(runtime, 'credential-vault.ps1'));
  await copyFile('scripts/credential-vault.ps1', join(base, 'credential-vault.ps1'));
  await build({ ...bundleOptions, entryPoints: ['tests/fixtures/workspace-management.ts'], outfile: join(runtime, 'backend.mjs') });
  await build({ ...bundleOptions, entryPoints: ['tests/fixtures/vault-library.ts'], outfile: join(base, 'vault-library.mjs') });
  const { WindowsVault } = await import(pathToFileURL(join(base, 'vault-library.mjs')).href);
  vault = new WindowsVault();
  for (const id of ids) {
    assert.equal(await vault.read(id), null, 'Generated QA credential already exists');
    ownedCredentialIds.add(id);
  }
  await start();

  let dialog = await open();
  assert.equal(await page.locator(':focus').getAttribute('name'), 'display_name');
  for (let tab = 0; tab < 6; tab++) {
    await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'Focus escaped the modal');
  }
  assert.equal(await dialog.locator('input[name="connection_token"]').getAttribute('type'), 'password');
  await dialog.locator('input[name="connection_token"]').fill(fixtureToken(seed, 'alpha'));
  await dialog.getByRole('button', { name: 'Verify & connect' }).click();
  assert.equal((await state()).workspaces.length, 0, 'Missing test confirmation was accepted');
  await page.keyboard.press('Escape');
  dialog = await open();
  assert.equal(await dialog.locator('input[name="connection_token"]').inputValue(), '', 'Cancel retained a token');
  await page.screenshot({ path: join(evidence, 'connect-dialog.png'), fullPage: true });
  await submit(dialog, 'alpha', 'Alpha alias');
  assert.equal(await dialog.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(), true);
  await connected(dialog, 'Alpha alias');
  assert.equal(await vault.read(ids[0]), fixtureToken(seed, 'alpha'));
  assert.equal((await state()).workspaces[0].read_access.sampled_objects, 2);
  console.log('PASS: native form confirmation, masked input, cancel cleanup, API identity/read probe and real vault write/readback');

  if (process.argv.includes('--routing')) {
    dialog = await open(); await submit(dialog, 'beta', ''); await connected(dialog, 'Test Beta');
    await runRoutingFlow({ getPage: () => page, getBrowser: () => browser, state, seed, base, evidence, stop, start });
    await noLeak(); assert.deepEqual(errors, []);
    console.log(`Routing evidence (simulated Notion HTTP, real native/vault/storage): ${evidence}`);
  } else {

  for (const [kind, expected] of [['unauthorized', 'AUTH_REQUIRED'], ['network', 'NETWORK_ERROR'], ['forbidden', 'FORBIDDEN'], ['production', 'TEST_WORKSPACE_ONLY'], ['alpha', 'WORKSPACE_EXISTS']]) {
    dialog = await open(); await submit(dialog, kind, '');
    await dialog.getByRole('alert').filter({ hasText: expected }).waitFor({ timeout: 30000 });
    await noLeak();
    assert.equal((await state()).workspaces.length, 1);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await card().getByRole('button', { name: 'Reauthorize', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Reauthorize workspace' });
  await submit(dialog, 'beta');
  await dialog.getByRole('alert').filter({ hasText: 'WORKSPACE_MISMATCH' }).waitFor();
  assert.equal(await vault.read(ids[0]), fixtureToken(seed, 'alpha'));
  await page.screenshot({ path: join(evidence, 'reauthorize-mismatch.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  console.log('PASS: 401/network/403/production/duplicate errors and mismatched replacement keep the stored connection intact');

  dialog = await open(); await submit(dialog, 'beta', ''); await connected(dialog, 'Test Beta');
  await card('Test Beta').getByText(/No shared objects were found/).waitFor();
  await card().getByRole('button', { name: 'Reauthorize', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Reauthorize workspace' });
  await submit(dialog, 'alpha-rotated'); await connected(dialog, 'Alpha alias');
  assert.equal(await vault.read(ids[0]), fixtureToken(seed, 'alpha-rotated'));
  await vault.write(ids[0], fixtureToken(seed, 'alpha-forbidden'));
  await card().getByRole('button', { name: 'Verify connection', exact: true }).click();
  await card().getByText('Degraded', { exact: true }).waitFor({ timeout: 30000 });
  assert.equal((await state()).workspaces.find(w => w.id === ids[0]).read_access, null);
  await vault.remove(ids[0]);
  await card().getByRole('button', { name: 'Verify connection', exact: true }).click();
  await card().getByText('Auth required', { exact: true }).waitFor({ timeout: 30000 });
  await card().getByRole('button', { name: 'Reauthorize', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Reauthorize workspace' });
  await submit(dialog, 'alpha-rotated'); await connected(dialog, 'Alpha alias');
  await noLeak();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(evidence, 'connected-workspaces.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  dialog = await open(); await page.screenshot({ path: join(evidence, 'connect-dialog-dark.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  const cdp = await browser.contexts()[0].newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth), false, 'Connection dialog overflows');
  await page.screenshot({ path: join(evidence, 'connect-dialog-narrow.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await stop(); await start();
  assert.equal((await state()).workspaces.length, 2);
  await card().getByRole('button', { name: 'Verify connection', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Workspace identity and read access verified.' }).waitFor({ timeout: 30000 });
  await noLeak();
  assert.deepEqual(errors, []);
  console.log('PASS: two isolated connections, empty search warning, token rotation, degraded/auth-required recovery, restart persistence, dark/narrow dialogs and no credential leakage');
  console.log(`Evidence (simulated Notion HTTP, real native/vault/storage): ${evidence}`);
  }
} finally {
  await stop();
  if (vault) {
    for (const id of ownedCredentialIds) { await vault.remove(id); assert.equal(await vault.read(id), null, 'QA credential cleanup failed'); }
    console.log('PASS: generated test credentials removed from Windows Credential Manager');
  }
  if (!resolve(base).startsWith(resolve(tmpdir()) + '\\lv999-workspace-test-')) throw new Error('Cleanup escaped QA directory');
  await rm(base, { recursive: true, force: true });
}
