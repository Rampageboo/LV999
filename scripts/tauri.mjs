import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, delimiter } from 'node:path';
const env = { ...process.env };
// Use an isolated toolchain when the machine has none. Never change the user's PATH or rustup config.
if (existsSync('.tools/cargo/bin/cargo.exe')) {
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'Path';
  env[pathKey] = `${resolve('.tools/cargo/bin')}${delimiter}${env[pathKey] ?? ''}`;
  env.CARGO_HOME = resolve('.tools/cargo');
  env.RUSTUP_HOME = resolve('.tools/rustup');
}
const cli = resolve('node_modules/@tauri-apps/cli/tauri.js');
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { cwd: 'apps/desktop', env, stdio: 'inherit', windowsHide: true });
child.on('exit', code => { process.exitCode = code ?? 1; });
child.on('error', () => { console.error('Unable to start Tauri. Install npm dependencies and a Rust toolchain.'); process.exitCode = 1; });
