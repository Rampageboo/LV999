// Browser plugin is not available in this session. Playwright attaches to the actual Tauri WebView2.
// The debug port is enabled only for this explicitly launched QA process, never in app configuration.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
const executable = resolve(process.argv[2] ?? 'apps/desktop/src-tauri/target/release/lv999-desktop.exe');
const evidence = resolve(process.argv[3] ?? join(tmpdir(), 'lv999-desktop-qa'));
await mkdir(evidence, { recursive: true });
const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=19335 --remote-debugging-address=127.0.0.1' };
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path');
env[pathKey ?? 'Path'] = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
delete env.NODE_OPTIONS; delete env.NODE_PATH;
const app = spawn(executable, [], { env, windowsHide: true, stdio: 'ignore' });
let browser;
let backendPid;
const errors = [];
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:19335'); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(browser, 'Tauri WebView2 debug endpoint did not open');
  const context = browser.contexts()[0];
  let page;
  for (let attempt = 0; attempt < 40; attempt++) {
    page = context.pages().find(candidate => candidate.url().includes('tauri.localhost'));
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(page, 'LV999 native frontend was not found');
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()); });
  await page.getByText('Running', { exact: true }).waitFor({ timeout: 15000 });
  assert.equal(await page.title(), 'LV999');
  const snapshot = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('backend_snapshot'));
  backendPid = snapshot.backend.pid;
  assert.equal(snapshot.backend.node, 'v26.13.1');
  assert.ok(snapshot.backend.executable.endsWith('runtime\\lv999-node.exe'));
  assert.equal(snapshot.workspaces.length, 0, 'Native smoke expects an empty test registry');
  assert.equal(snapshot.diagnostics.find(d => d.key === 'webview').status, 'pass');
  assert.equal(snapshot.diagnostics.find(d => d.key === 'vault').status, 'pass');
  await page.screenshot({ path: join(evidence, 'dashboard.png'), fullPage: true });
  await page.getByRole('button', { name: 'Set up connections', exact: true }).click();
  await page.getByRole('heading', { name: 'Workspaces', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Connect workspace', exact: true }).isDisabled(), true);
  for (const name of ['Routing', 'Clients', 'Migration', 'Logs', 'Settings', 'Dashboard']) {
    await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
    await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor();
    assert.equal(await page.getByRole('navigation').getByRole('button', { name, exact: true }).getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('body').evaluate(body => body.scrollWidth > innerWidth), false, `${name} overflows`);
  }
  await page.getByRole('button', { name: 'Refresh status', exact: false }).click();
  await page.getByText('Running', { exact: true }).waitFor();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: join(evidence, 'dashboard-dark.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert.equal(await page.locator('body').evaluate(body => body.scrollWidth > innerWidth), false, 'Narrow layout overflows');
  await page.screenshot({ path: join(evidence, 'dashboard-narrow.png'), fullPage: true });
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  assert.deepEqual(errors, [], 'Unexpected frontend console errors');
  console.log('PASS: actual Tauri window, all seven pages, setup navigation, disabled actions, refresh, live backend/vault/WebView2, dark and narrow layout, clean console');
  // Kill only the backend whose PID was returned by this native app, to prove status does not stay green.
  process.kill(backendPid); backendPid = undefined;
  await page.getByRole('button', { name: 'Refresh status', exact: false }).click();
  await page.getByRole('heading', { name: 'Backend unavailable' }).waitFor();
  assert.equal(await page.getByText('Running', { exact: true }).count(), 0);
  await page.screenshot({ path: join(evidence, 'backend-unavailable.png'), fullPage: true });
  console.log('PASS: backend exit clears prior snapshot and renders a truthful error state');
  console.log(`Evidence: ${evidence}`);
} finally {
  if (browser) await browser.close();
  if (backendPid) { try { process.kill(backendPid); } catch {} }
  app.kill();
}
