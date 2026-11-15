import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/server', { recursive: true });
await build({ entryPoints: ['apps/server/src/entry/main.ts'], outfile: 'dist/server/backend.mjs', bundle: true,
  platform: 'node', target: 'node26', format: 'esm', sourcemap: false,
  banner: { js: "import { createRequire as __lvRequire } from 'node:module'; const require = __lvRequire(import.meta.url);" } });
await copyFile('scripts/credential-vault.ps1', 'dist/server/credential-vault.ps1');
