import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const textFiles = files.filter(file => /(?:\.(?:md|json|ya?ml|tsx?|mjs|rs|toml|nsi|ps1|lock)|\.gitignore)$/.test(file));
const failures = [];
const webviewGuid = 'f3017226-fe2a-4295-8bdf-00c3a9a7e4c5'; // Official installer constant, not a Notion object.
for (const file of textFiles) {
  const body = await readFile(file, 'utf8');
  if (/\b(?:ntn_|secret_)[a-zA-Z0-9_-]{20,}/.test(body) || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(body)) failures.push(`${file}: possible credential`);
  for (const value of body.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)) {
    if (value[0].toLowerCase() !== webviewGuid) failures.push(`${file}: unexpected literal object identifier`);
  }
}
if (failures.length) { console.error([...new Set(failures)].join('\n')); process.exitCode = 1; }
else console.log(`PASS: ${textFiles.length} source/config/document files contain no token patterns, private PEM keys or literal Notion-shaped UUIDs (official WebView2 GUID allowlisted).`);
