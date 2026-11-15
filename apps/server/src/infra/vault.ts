import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { DomainError } from '../notion/adapter.js';

export interface Vault { read(workspaceId: string): Promise<string | null>; probe(): Promise<boolean> }
export class WindowsVault implements Vault {
  constructor(private script = join(dirname(fileURLToPath(import.meta.url)), 'credential-vault.ps1')) {}
  private invoke(input: object): Promise<{ok: boolean; secret?: string}> {
    return new Promise((resolve, reject) => {
      if (process.platform !== 'win32') return reject(new Error('WINDOWS_VAULT_REQUIRED'));
      const exe = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const child = spawn(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP } });
      let output = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('VAULT_TIMEOUT')); }, 10000);
      child.stdout.on('data', chunk => { output += chunk; if (output.length > 10000) child.kill(); });
      child.stderr.resume(); // Never include raw PowerShell errors or secrets in diagnostics.
      child.on('error', () => { clearTimeout(timer); reject(new Error('VAULT_UNAVAILABLE')); });
      child.on('close', code => {
        clearTimeout(timer);
        try { if (code !== 0) throw new Error(); resolve(JSON.parse(output)); }
        catch { reject(new Error('VAULT_UNAVAILABLE')); }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(input));
    });
  }
  async read(workspaceId: string) {
    const id = z.uuid().parse(workspaceId).toLowerCase();
    try {
      const response = await this.invoke({ operation: 'read', target: `com.rampageboo.lv999/notion/${id}` });
      return response.ok ? response.secret ?? null : null;
    } catch { throw new DomainError('VAULT_UNAVAILABLE', 'Windows Credential Manager could not be read. Check this Windows user session before reauthorizing.'); }
  }
  async probe() { try { return (await this.invoke({ operation: 'probe' })).ok; } catch { return false; } }
}
