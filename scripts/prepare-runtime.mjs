import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { writeNpmNotices } from './notices.mjs';
const version = 'v26.13.1';
// Recorded from the official v26.13.1 SHASUMS256.txt. Updates require a deliberate pin change.
const expected = 'f5109dc868ec38703ad8f305e0aceece717cb60d4889873f434017af4e96cccb';
const runtime = 'apps/desktop/src-tauri/runtime';
await mkdir(runtime, { recursive: true });
const base = `https://nodejs.org/dist/${version}`;
async function download(path) {
  const response = await fetch(`${base}/${path}`);
  if (!response.ok) throw new Error(`Node distribution download failed (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}
let binary;
try { binary = await readFile(`${runtime}/lv999-node.exe`); } catch {}
if (!binary || createHash('sha256').update(binary).digest('hex') !== expected) {
  const manifest = (await download('SHASUMS256.txt')).toString();
  const published = manifest.split('\n').find(line => line.endsWith(' win-x64/node.exe'))?.split(/\s+/)[0];
  if (published !== expected) throw new Error('Official Node manifest differs from the reviewed runtime pin.');
  binary = await download('win-x64/node.exe');
}
const actual = createHash('sha256').update(binary).digest('hex');
if (actual !== expected) throw new Error('Node runtime checksum mismatch.');
await writeFile(`${runtime}/lv999-node.exe`, binary);
try { await readFile(`${runtime}/node-LICENSE.txt`); } catch {
  const license = await fetch(`https://raw.githubusercontent.com/nodejs/node/${version}/LICENSE`);
  if (!license.ok) throw new Error('Node license download failed.');
  await writeFile(`${runtime}/node-LICENSE.txt`, await license.text());
}
await writeFile(`${runtime}/runtime-manifest.json`, JSON.stringify({ version, platform: 'win-x64', sha256: actual, source: `${base}/win-x64/node.exe` }, null, 2));
await copyFile('dist/server/backend.mjs', `${runtime}/backend.mjs`);
await copyFile('dist/server/credential-vault.ps1', `${runtime}/credential-vault.ps1`);
await writeNpmNotices(`${runtime}/third-party-notices.txt`);
execFileSync(`${runtime}/lv999-node.exe`, ['--version'], { stdio: 'inherit', windowsHide: true });
console.log('Bundled runtime staged and checksum verified.');
