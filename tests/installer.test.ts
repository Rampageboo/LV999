import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const config = JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8'));
const template = readFileSync('apps/desktop/src-tauri/installer/template.nsi', 'utf8');
it('keeps legacy LV999 installation and registry identity separate from the new display name', () => {
  expect(config.productName).toBe('LV999');
  expect(config.identifier).toBe('com.rampageboo.lv999');
  expect(config.bundle.windows.nsis.template).toBe('installer/template.nsi');
  expect(template).toContain('Uninstall\\${BUNDLEID}');
  expect(template).toContain('!define MANUPRODUCTKEY "${MANUKEY}\\${BUNDLEID}"');
  expect(template).toContain('$LOCALAPPDATA\\${BUNDLEID}\\app');
  expect(template).not.toContain('$LOCALAPPDATA\\${PRODUCTNAME}');
  expect(template).not.toContain('EnumRegKey');
  expect(template).toContain('DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "${BUNDLEID}"');
});
it('never recursively deletes user data during uninstall and isolates shortcuts', () => {
  expect(/RmDir\s+\/r\b/i.test(template)).toBe(false);
  expect(template).not.toContain('DeleteAppDataCheckbox');
  expect(template).not.toContain('${PRODUCTNAME}.lnk');
  expect(template).toContain('${PRODUCTNAME} (Notion).lnk');
});
it('packages the runtime and uses only the new signed updater channel', () => {
  expect(config.bundle.resources).toEqual({ 'runtime/': 'runtime/' });
  expect(config.plugins.updater.endpoints).toEqual(['https://github.com/Rampageboo/LV999/releases/latest/download/latest.json']);
  expect(Buffer.from(config.plugins.updater.pubkey, 'base64').toString()).toContain('minisign public key');
  expect(config.plugins.updater.requireSignedVersion).toBe(true);
  const root = JSON.parse(readFileSync('package.json', 'utf8'));
  expect(root.version).toBe(config.version);
  expect(root.dependencies['@modelcontextprotocol/server']).toMatch(/^2\./);
  expect(root.dependencies).not.toHaveProperty('@modelcontextprotocol/sdk');
});
