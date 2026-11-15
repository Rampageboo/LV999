import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile, access, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, delimiter, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { parse } from 'smol-toml';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { ClientConfigInput, ClientTestInput, result, type ClientKind, type ClientView, type GeneratedConfig, type Result } from '../../../../packages/contracts/src/index.js';

const SERVER_NAME = 'lv999';
export const claudeHealthPassed = (code: number | null, output: string) => code === 0 && /\bconnected\b/i.test(output) && !/\b(?:failed|not\s+connected|pending\s+approval)\b/i.test(output);
type Entry = { type?: string; url?: string; command?: string; args?: string[]; enabled?: boolean; env?: Record<string, string> };
export type ClientPaths = { home: string; codexHome: string; claudeConfig: string; executable: string; entry: string; data: string; path: string; transportEnv?: Record<string, string> };
function childEnvironment(values: Record<string, string>) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(values)) env[Object.keys(env).find(existing => existing.toLowerCase() === key.toLowerCase()) ?? key] = value;
  return env;
}
const defaultPaths = (data: string): ClientPaths => ({ home: homedir(), codexHome: process.env.CODEX_HOME ?? join(homedir(), '.codex'),
  claudeConfig: process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json'),
  executable: process.execPath, entry: fileURLToPath(import.meta.url), data, path: process.env.PATH ?? '' });
const names = { claude: 'Claude Code', codex: 'Codex' };
export class ClientManager {
  readonly paths: ClientPaths;
  private states: ClientView[];
  constructor(data: string, paths?: Partial<ClientPaths>) {
    this.paths = { ...defaultPaths(data), ...paths };
    this.states = (['claude', 'codex'] as const).map(id => ({ id, name: names[id], status: 'Not tested', version: null, executable: null,
      config_path: id === 'claude' ? this.paths.claudeConfig : join(this.paths.codexHome, 'config.toml'), config_state: 'Unknown',
      detail: 'Detect configuration, then test the transport and installed client separately.', detected_at: null, handshake: null }));
  }
  snapshot() { return this.states.map(state => ({ ...state })); }
  private entry(client: ClientKind, workspaces: string[]): Entry {
    return { type: 'stdio', command: this.paths.executable, args: [this.paths.entry, 'mcp', '--data-dir', this.paths.data,
      '--client', client, ...workspaces.flatMap(id => ['--chat-workspace', id])] };
  }
  generate(input: unknown): Result<GeneratedConfig> {
    const parsed = ClientConfigInput.safeParse(input);
    if (!parsed.success) return result<GeneratedConfig>(null, null, 'INVALID_INPUT', ['Select a client and valid Workspace chat permissions.']);
    const { client, chat_workspace_ids } = parsed.data;
    const entry = this.entry(client, [...new Set(chat_workspace_ids)]);
    const text = client === 'claude' ? JSON.stringify({ mcpServers: { [SERVER_NAME]: entry } }, null, 2) :
      `[mcp_servers.${SERVER_NAME}]\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\nstartup_timeout_sec = 30\ntool_timeout_sec = 60\n`;
    return result({ client, format: client === 'claude' ? 'JSON' : 'TOML', config_path: this.states.find(s => s.id === client)!.config_path,
      server_name: SERVER_NAME, text, chat_workspace_ids });
  }
  private async locate(client: ClientKind) {
    const candidates = process.platform === 'win32' ? [`${client}.exe`, `${client}.cmd`] : [client];
    for (const folder of this.paths.path.split(delimiter).filter(Boolean)) for (const candidate of candidates) {
      const file = join(folder.replace(/^"|"$/g, ''), candidate);
      try { await access(file); return file; } catch {}
    }
    return null;
  }
  private launch(executable: string, args: string[], env: NodeJS.ProcessEnv = process.env, cwd?: string) {
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
      // Only fixed probe arguments are accepted for batch wrappers. No user text or generated JSON enters a shell.
      if (/["%&|<>^\r\n]/.test(executable) || args.some(arg => !/^[a-zA-Z0-9_./:-]+$/.test(arg))) throw new Error('UNSAFE_WRAPPER');
      return spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'), ['/d', '/v:off', '/s', '/c', `""${executable}" ${args.join(' ')}"`],
        { env, cwd, windowsHide: true, stdio: 'pipe', windowsVerbatimArguments: true });
    }
    return spawn(executable, args, { env, cwd, windowsHide: true, stdio: 'pipe' });
  }
  private run(executable: string, args: string[], env?: NodeJS.ProcessEnv, timeout = 15000, cwd?: string): Promise<{ code: number | null; text: string }> {
    return new Promise((resolveRun, reject) => {
      const child = this.launch(executable, args, env, cwd); let output = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('CLIENT_TIMEOUT')); }, timeout);
      child.stdin.end(); child.stderr.resume();
      child.stdout.on('data', bytes => { output += bytes; if (output.length > 200000) child.kill(); });
      child.on('error', () => { clearTimeout(timer); reject(new Error('CLIENT_UNAVAILABLE')); });
      child.on('close', code => { clearTimeout(timer); resolveRun({ code, text: output }); });
    });
  }
  async detect(): Promise<Result<ClientView[]>> {
    for (const state of this.states) {
      state.detected_at = new Date().toISOString(); state.executable = await this.locate(state.id);
      state.status = state.executable ? 'Not configured' : 'Not installed'; state.version = null;
      if (state.executable) {
        try { const probe = await this.run(state.executable, ['--version']); state.version = probe.code === 0 ? probe.text.match(/\d+\.\d+\.\d+/)?.[0] ?? null : null; if (!state.version) state.status = 'Degraded'; }
        catch { state.status = 'Degraded'; }
      }
      try {
        const bytes = await readFile(state.config_path);
        if (bytes.length > 2_000_000) throw new Error('CONFIG_TOO_LARGE');
        const config = state.id === 'claude' ? JSON.parse(bytes.toString()) : parse(bytes.toString());
        const entry = (state.id === 'claude' ? config.mcpServers : config.mcp_servers)?.[SERVER_NAME] as Entry | undefined;
        if (!entry) state.config_state = 'Missing';
        else {
          const expected = this.entry(state.id, []);
          const args = entry.args;
          const matches = entry.enabled !== false && !entry.url && (!entry.type || entry.type === 'stdio') && typeof entry.command === 'string' && resolve(entry.command).toLowerCase() === resolve(expected.command!).toLowerCase() &&
            Array.isArray(args) && args[1] === 'mcp' && resolve(args[0] ?? '').toLowerCase() === resolve(this.paths.entry).toLowerCase() &&
            args.includes('--data-dir') && resolve(args[args.indexOf('--data-dir') + 1] ?? '').toLowerCase() === resolve(this.paths.data).toLowerCase() &&
            args.includes('--client') && args[args.indexOf('--client') + 1] === state.id && !entry.env;
          state.config_state = matches ? 'Matching' : 'Different';
          if (state.executable) state.status = matches && state.version ? 'Configured' : 'Degraded';
        }
      } catch (error) { state.config_state = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Missing' : 'Invalid'; if (state.executable && state.config_state === 'Invalid') state.status = 'Degraded'; }
      state.detail = state.config_state === 'Matching' ? 'LV999 entry matches this runtime. A file match is not a handshake.' :
        state.config_state === 'Different' ? 'LV999 entry differs, is disabled or has custom environment settings. Review the generated configuration; nothing was changed.' :
        state.config_state === 'Invalid' ? 'Configuration could not be parsed safely. Existing content was not changed.' : 'No matching user-scope LV999 entry. Generate a snippet and merge it with existing settings.';
    }
    return result(this.snapshot());
  }
  private async sdk(clientId: ClientKind, workspaces: string[]) {
    const entry = this.entry(clientId, workspaces);
    const client = new Client({ name: 'lv999-handshake-test', version: '0.1.0' });
    try {
      const transport = new StdioClientTransport({ command: entry.command!, args: entry.args, stderr: 'pipe', env: this.paths.transportEnv });
      transport.stderr?.on('data', () => {});
      await client.connect(transport, { timeout: 15000 });
      const listing = await client.listTools({}, { timeout: 10000 });
      if (!listing.tools.some(tool => tool.name === 'list_workspaces') || !listing.tools.some(tool => tool.name === 'resolve_project')) throw new Error('WRONG_SERVER');
      const response = await client.callTool({ name: 'list_workspaces', arguments: {} }, { timeout: 10000 });
      if (!JSON.parse((response.content as { text: string }[])[0].text).ok) throw new Error('CALL_FAILED');
      return listing.tools.length;
    } finally { await client.close(); }
  }
  private async codexNative(executable: string, profile: string): Promise<number> {
    const child = this.launch(executable, ['app-server', '--stdio'], childEnvironment({ CODEX_HOME: profile }), profile);
    const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
    let seq = 0;
    const lines = createInterface({ input: child.stdout }); child.stderr.resume();
    lines.on('line', line => {
      try { const response = JSON.parse(line); const waiter = pending.get(response.id); if (!waiter) return;
        pending.delete(response.id); response.error ? waiter.reject(new Error('RPC_REJECTED')) : waiter.resolve(response.result); } catch {}
    });
    child.on('error', () => { for (const waiter of pending.values()) waiter.reject(new Error('CLIENT_EXITED')); });
    child.on('exit', () => { for (const waiter of pending.values()) waiter.reject(new Error('CLIENT_EXITED')); });
    const call = (method: string, params: object) => new Promise<any>((resolveCall, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('RPC_TIMEOUT')); }, 30000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolveCall(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
    try {
      await call('initialize', { clientInfo: { name: 'lv999-client-probe', version: '0.1.0' } });
      child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
      const listing = await call('mcpServerStatus/list', { detail: 'toolsAndAuthOnly', limit: 100 });
      const server = listing.data?.find((value: any) => value.name === SERVER_NAME);
      if (!server?.serverInfo || !Object.keys(server.tools ?? {}).some(name => name.includes('list_workspaces'))) throw new Error('NATIVE_HANDSHAKE_NOT_CONFIRMED');
      return Object.keys(server.tools).length;
    } finally {
      lines.close();
      if (child.exitCode === null) await new Promise<void>(resolveExit => {
        const timer = setTimeout(() => { child.kill(); resolveExit(); }, 5000);
        child.once('exit', () => { clearTimeout(timer); resolveExit(); }); child.stdin.end();
      });
    }
  }
  async test(input: unknown): Promise<Result<ClientView>> {
    const parsed = ClientTestInput.safeParse(input);
    if (!parsed.success) return result<ClientView>(null, null, 'INVALID_INPUT', ['Select a client and handshake type.']);
    const { client, kind, chat_workspace_ids } = parsed.data;
    const state = this.states.find(value => value.id === client)!;
    let profileRoot: string | null = null;
    try {
      let count: number;
      if (kind === 'sdk') count = await this.sdk(client, chat_workspace_ids);
      else {
        const executable = await this.locate(client);
        if (!executable) throw new Error('CLIENT_NOT_INSTALLED');
        profileRoot = await mkdtemp(join(tmpdir(), 'lv999-client-probe-'));
        const profile = join(profileRoot, 'profile'); await mkdir(profile);
        const generated = this.generate({ client, chat_workspace_ids }).data!;
        if (client === 'codex') { await writeFile(join(profile, 'config.toml'), generated.text); count = await this.codexNative(executable, profile); }
        else {
          await writeFile(join(profile, '.claude.json'), generated.text);
          await writeFile(join(profileRoot, '.claude.json'), generated.text);
          const probe = await this.run(executable, ['mcp', 'get', SERVER_NAME], childEnvironment({ CLAUDE_CONFIG_DIR: profile,
            DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }), 40000, profileRoot);
          if (!claudeHealthPassed(probe.code, probe.text)) throw new Error('NATIVE_HANDSHAKE_NOT_CONFIRMED');
          count = await this.sdk(client, chat_workspace_ids);
        }
      }
      state.handshake = { kind, ok: true, checked_at: new Date().toISOString(), tool_count: count,
        detail: kind === 'sdk' ? 'LV999 SDK initialize, tool list and local read call passed. This does not verify the installed client.' :
          'Installed client initialized LV999 in an isolated profile. Existing user configuration and model sessions were not changed.' };
      return result({ ...state });
    } catch {
      state.handshake = { kind, ok: false, checked_at: new Date().toISOString(), tool_count: 0,
        detail: kind === 'native' ? 'Native client handshake was not confirmed. Check installation/version support. Existing configuration was not changed; no model turn was started.' : 'LV999 MCP handshake failed. Check bundled runtime/backend paths and local permissions.' };
      const reply = result<ClientView>({ ...state }, null, 'HANDSHAKE_FAILED', [state.handshake.detail]); return reply;
    } finally { if (profileRoot && dirname(profileRoot) === tmpdir() && profileRoot.startsWith(join(tmpdir(), 'lv999-client-probe-'))) await rm(profileRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  }
}
