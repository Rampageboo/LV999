import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function writeNpmNotices(destination) {
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  const parts = ['LV999 bundled JavaScript third-party notices. Node.js has its separate node-LICENSE.txt.\n'];
  for (const [path, metadata] of Object.entries(lock.packages)) {
    if (!path || metadata.dev || metadata.optional) continue;
    const pkg = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
    const files = (await readdir(path)).filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name));
    if (!files.length) throw new Error(`License text missing for bundled production dependency ${pkg.name}`);
    parts.push(`\n=== ${pkg.name} ${pkg.version} (${pkg.license ?? 'see license'}) ===\n`);
    for (const file of files) parts.push(await readFile(join(path, file), 'utf8'));
  }
  await writeFile(destination, parts.join('\n'));
}
