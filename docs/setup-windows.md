# Windows bootstrap

Milestone 0 is a read-only engineering preview. Two real test workspaces have not yet been created; do not use Vibecode or Honour. Closing the window stops its backend. Tray/background operation, autostart and single-instance recovery belong to M2.

## Build and run

Development needs Node **26.13.1 LTS**, npm 11+, Rust stable with the MSVC target, Visual Studio C++ Build Tools and WebView2. The installer includes Node for end users; it does not require npm or a global Node installation.

```powershell
npm ci
npm test
npm run build:bundle
npm run test:smoke
npm run desktop
```

`npm run dev` alone opens the frontend development server without native IPC; it deliberately shows Backend unavailable. Use `npm run desktop` for the working desktop application. `scripts/tauri.mjs` also recognizes an isolated `.tools/cargo` + `.tools/rustup` toolchain without changing the machine's PATH.

```powershell
npm run package:desktop
```

Output: `apps/desktop/src-tauri/target/release/bundle/nsis/LV999_0.1.0_x64-setup.exe`. Resource preparation downloads official Node `v26.13.1` for Windows x64, checks its SHA-256 against the reviewed source pin and official distribution manifest, stages its license/notices and the bundled backend, and fails on any mismatch. Verified runtime/license files are reused on subsequent builds. Node is launched by absolute resource path with `NODE_OPTIONS` and `NODE_PATH` removed. The app uses Windows system PowerShell for Credential Manager; no PowerShell 7 installation is needed.

Application identifier: `com.rampageboo.lv999`. Default program directory: `%LOCALAPPDATA%\com.rampageboo.lv999\app`. User state: `%LOCALAPPDATA%\com.rampageboo.lv999\registry.db` (SQLite WAL). The old `%LOCALAPPDATA%\LV999` directory and its updater are never opened. The custom NSIS template also isolates uninstall keys, shortcuts and autostart cleanup, disables legacy WiX discovery, and removes the data-deletion checkbox. Uninstall keeps user state; no migration backups exist in M0. Do not delete the registry/vault to troubleshoot without first saving any needed local configuration.

## Secure test enrollment (M0 developer path)

M1 adds GUI enrollment. M0 intentionally disables its Connect button. This temporary developer path keeps tokens out of command arguments, environment variables, SQLite, source control and model context.

1. Manually create **two test workspaces** in Notion. Create an Internal Connection separately in each. Grant read access to a test root page. Do not connect production workspaces.
2. In a local terminal, set `$testWorkspaceId` and `$testWorkspaceLabel` to the first test workspace's actual values. IDs/names are runtime configuration, not repository fixtures. Never paste the token into chat.
3. Run the hidden credential prompt:

```powershell
./scripts/credential-vault.ps1 -Enroll -WorkspaceId $testWorkspaceId
```

The token is stored as a generic Windows credential under `com.rampageboo.lv999/notion/<workspace-id>`. The prompt does not log or print it. Re-running enrollment replaces only that exact test credential.

4. Register its public metadata and verify through the shared backend:

```powershell
npm run cli -- register --workspace-id $testWorkspaceId --label $testWorkspaceLabel --test
npm run cli -- verify --workspace-id $testWorkspaceId
```

5. Repeat for the second workspace. Open LV999 → Workspaces → Refresh status → Verify connection. Each real identity check records ID/name/time and safe error code. Configuration alone is not connection evidence. A renamed label is not a substitute for a test environment: `--test` is an explicit developer assertion, and both registration labels and actual identities named Vibecode/Honour are blocked.
6. Test deliberately swapping the two test vault tokens: expect `WORKSPACE_MISMATCH` before a content read. Restore them afterwards. Verify a shared page and an unshared/nonexistent page in each workspace; record 403/404 honestly. Do not put resulting IDs/names in public acceptance reports.

The CLI's default state directory matches Tauri. `--data-dir` supports isolated temporary test state. `npm run mcp` starts stdio MCP; installed clients can invoke `<install-dir>\runtime\lv999-node.exe` with `<install-dir>\runtime\backend.mjs`, `mcp`. M0 does not edit existing Claude or Codex configuration.

## Release signing

`.github/workflows/release.yml` uses `tauri-action`, NSIS, the LV999-specific updater key, and this repository's `latest.json`. The public key is in `tauri.conf.json`. Local preview builds are unsigned; updater artifacts are created only with `tauri.release.conf.json` and a signing key.

A new LV999 key pair was generated locally in ignored `.tools/updater.key` and `.tools/updater.key.pub`. Do not regenerate it casually, commit it, copy Silverbench's key, or print it into a chat/log. Back up the private key securely before removing `.tools`. Before a release, configure Actions secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (this initial key has an empty password). No secrets were uploaded and no release was published during M0.

Tags must match the app version. The workflow creates a draft prerelease for review. A draft prerelease does not establish a working `releases/latest` channel; publish an appropriate signed release only after its acceptance gate. Updater signatures are not Windows Authenticode signing and do not by themselves satisfy Smart App Control.
