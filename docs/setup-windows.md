# Windows bootstrap

Milestone 1 now includes scoped Notion content writes, GUI content review, safe client configuration application. Both test Workspaces passed real CRUD and Claude/Codex creation/write/readback; See [content and native-client acceptance](qa/2026-11-19-m1-content.md) for build/GUI evidence and remaining boundaries. Do not use Vibecode or Honour. Local native compilation remains blocked by Smart App Control; Windows packages are built in GitHub CI. Closing the host stops its owned management backend. Startup registration and duplicate-window handling are now native Settings features; tray/background operation and crash recovery remain separate work.

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

Application identifier: `com.rampageboo.lv999`. Default program directory: `%LOCALAPPDATA%\com.rampageboo.lv999\app`. User state: `%LOCALAPPDATA%\com.rampageboo.lv999\registry.db` (SQLite WAL). The old `%LOCALAPPDATA%\LV999` directory and its updater are never opened. The custom NSIS template also isolates uninstall keys, shortcuts and autostart cleanup, disables legacy WiX discovery, and removes the data-deletion checkbox. Uninstall keeps user state and vault credentials. Do not delete the registry/vault to troubleshoot without first saving any needed local configuration.

## Connect and verify in the GUI

1. Create the target Workspace in Notion and share its intended project root with the connection. Workspace creation is a manual Notion action; LV999 does not create Workspaces. The two existing test connections remain separate from production targets.
2. Open LV999 → Workspaces → **Connect workspace**, choose **Production target** or **Test**, optionally enter a display name and paste the Internal Connection token in the masked field. Production enrollment requires the exact expected Notion Workspace name. Do not paste tokens into chat. No Workspace ID needs to be entered manually.
3. Select **Verify & connect**. The backend discovers the real identity, checks the expected production name, rejects protected source identities before any page access, checks read access, then saves and reads back the credential in Windows Credential Manager. Production starts read-only. The token field clears immediately. Cancel/Escape discards unsubmitted input; saving disables dismissal and duplicate submission.
4. Success shows the display name, actual Notion name/ID, verification time and search sample. Zero returned objects triggers a sharing/indexing warning. It does not prove a root page is shared or that the whole workspace is empty. Repeat for the second workspace.
5. Use **Verify connection** to read the saved credential and repeat identity/read-access checks. Stored configuration alone is not connectivity evidence; the displayed timestamp is the last completed verification, not continuous monitoring.
6. Use **Reauthorize** on an existing row to replace an expired/revoked token. The target ID is fixed. A token from another workspace is rejected before content access, and the current credential/verification is preserved if replacement validation fails. Connecting the same ID again returns `WORKSPACE_EXISTS` rather than silently replacing it.

Tokens persist only in Windows Credential Manager under `com.rampageboo.lv999/notion/<workspace-id>`. They are never returned in GUI/MCP snapshots or put in React state, browser local/session storage, SQLite or command arguments. If validation fails, re-enter a token to retry. A caught local save failure restores the previous credential (or removes the new one) and checks that restoration; an unconfirmed restoration is reported as `CREDENTIAL_STATE_UNCERTAIN`. A connection-save lock may remain for up to three minutes after a crash. Restart and refresh after an unknown backend result before retrying. Full crash recovery is an M2 gate.

`AUTH_REQUIRED` means missing/expired/revoked credentials. `FORBIDDEN` means Notion returned 403; check capabilities and sharing. `NOT_FOUND_OR_NOT_SHARED` means 404 and cannot distinguish missing from inaccessible objects. `WORKSPACE_MISMATCH` never falls back to another credential and reauthorization cannot change environments. `PROTECTED_WORKSPACE` blocks Vibecode/Honour before page access; an encountered protected ID stays blocked after renaming. The production classification never grants access to these sources.

Real test-Workspace verification is recorded in the M1 acceptance report. The repeatable native integration test replaces Notion HTTP only in a disposable application copy, exercises real IPC/SQLite/vault operations with generated credentials, and cleans them afterwards:

```powershell
npm run test:workspace-gui
```

## Browse pages and map a project

1. In Workspaces, choose **Browse pages** on one exact test connection. Search page titles, load more batches, or refresh. The list is a search index of accessible pages, not a full inventory. Duplicate results are merged by ID. Missing/partial objects are reported instead of silently described as complete.
2. Choose **Inspect page** to verify a listed page, or paste a page ID / `https://www.notion.so/...` link into **Page link or ID**. No external URL is fetched. Inspection shows metadata and the exact workspace/page IDs; this does not load a full page tree or edit its content. A 404 means missing or not shared with this particular connection.
3. In Routing, choose **Add mapping**, enter a stable project key and display name, select a workspace, inspect a page and choose **Use as project root**. Root pages must be active ordinary pages (top-level or child pages). Database records, archived/trashed pages and unsupported parent types are visible for diagnosis but cannot be chosen as roots.
4. Review **Selected route target**, then **Save mapping**. The backend re-reads the exact page before committing local configuration. It does not create/move/edit Notion content. Selecting a different workspace clears the old root; page titles never substitute for IDs.
5. Use **Edit mapping** to change the name or target under the same immutable key. A changed revision returns `ROUTE_CONFLICT`; cancel, refresh and reopen rather than overwriting the other editor. **Filter mappings** searches locally. **Check route** revalidates the saved workspace identity and root, while the list's Saved validation time remains historical.
6. Distinct keys can share a project name, but **Resolve name** returns `AMBIGUOUS_TARGET` for duplicates without reading a credential. Resolve by exact key instead. A route is configuration, not content-write authorization or a migration finalization receipt.

The read-only MCP tools `list_projects` and `resolve_project` expose the same backend. Developer CLI equivalents (substitute only local runtime values) are:

```powershell
npm run cli -- projects
npm run cli -- resolve --project-key $testProjectKey
npm run cli -- map --project-key $testProjectKey --name $testProjectName --workspace-id $testWorkspaceId --root-page-id $testRootPageId --expected-revision 0
```

Use the currently saved revision when editing; revision `0` creates a new key. Native routing verification uses the same isolated harness as Workspace tests, with simulated Notion HTTP and real local persistence/vault operations:

```powershell
npm run test:routing-gui
```

Real two-workspace route/permission acceptance is still pending. Do not put workspace, page or data-source IDs in public docs or fixtures. Route removal, disconnect, content CRUD and full migration remain unimplemented.

## One OAuth app, multiple Workspaces

This flow requires a successful build of the changed native host. In Notion's Developer portal create one public OAuth connection with the intended installation scope, and register exactly `http://localhost:8765/oauth/notion/callback`. Its development Workspace is not the only Workspace it can authorize when its scope permits others. Workspaces themselves are still created manually in Notion.

In LV999 Workspaces → **Connect with Notion**, enter the app's client ID/secret locally and save. The secret field clears and the secret goes only to Windows Credential Manager. Choose the environment; for a production target, enter the exact expected Notion name. Authorize only that target's intended project root in Notion. The callback verifies identity/name and a read-only search before saving a separate vault entry. The group becomes available automatically. Repeat with the same OAuth app for each target. The app's Notion capability grant and LV999's local read-only/write policy are distinct: default local read-only does not narrow the app's OAuth capabilities.

Start each authorization from LV999; a copied Developer portal URL without LV999's current state cannot complete the callback. The listener opens only while authorizing, is loopback-only and expires after ten minutes. Cancel closes it. If port 8765 is occupied, authorization stops with a clear error rather than killing its owner. Keep LV999 open through exchange/verification; the result appears there, not in the callback page.

**Reauthorize** on an OAuth Workspace enforces that exact target. **Refresh OAuth token** explicitly rotates its saved access/refresh pair and rechecks identity/read access; no automatic token-grant retry is performed. Revoked/unrefreshable credentials require Reauthorize. If remote refresh succeeded but local persistence is uncertain, reauthorize rather than retrying a possibly consumed refresh token. Access/refresh tokens and their authoritative identity evidence share one atomic vault blob; SQLite stores no secrets. A changed OAuth app setting does not replace existing Workspace credentials or erase the earlier per-client secret.

For a Workspace already connected with an Internal Connection, choose **Switch to OAuth** on its card. The existing credential, display name and group history are retained until the same Workspace passes OAuth identity/read validation. This changes the connection method without creating a duplicate Workspace group.

Automated OAuth tests use scripted responses and generated vault secrets. Separate real consent/token exchange, page access and two-Workspace denial checks passed with the Owner's test spaces on 2026-11-19; real refresh/revocation remains a separate gate. [Notion's public connection guide](https://developers.notion.com/guides/connections-and-tokens/public-integrations/overview) explains the multi-Workspace scope; [authorization](https://developers.notion.com/guides/authorization/overview) describes state/code exchange and refresh.

## Project message boards — no automatic turns

Each project can have one ordinary `留言板` child page under its mapped root. Open it in Notion to leave a note, or manually ask Claude Code/Codex to read and reply through MCP. Messages never start a model turn by themselves.

Routing offers **Create / verify message board**, **Copy board link** and **Pause board posting**. In AI Clients, choose **Message-board-only profile**, select the project keys, generate/review/apply the LV999 entry, then restart/reload the native client. This profile has exactly three tools: `list_message_boards`, `read_message_board`, `post_message_board`. It grants read/append on those registered pages, with no general page edit/delete tools. Other production content keeps its global read-only policy. Existing full Notion profiles remain an advanced separate option.

For example, ask the client: “读取 NX 留言板；如果需要回复，请追加一条留言。” Posting requires a UUID retry key; repeat the same key/body after a busy or uncertain response and never invent a new key after an unknown outcome. Reading a long board may require pagination. The sender label is the configured connection role; timestamps are ISO UTC. Test/check messages are labelled as checks, not model replies. See [acceptance](qa/2026-11-19-message-boards.md).

## AI Clients

1. Open Clients → **Detect clients**. CLI version/path and the known user configuration path are detected. Only the LV999 entry's state is returned; other server settings/secrets are not displayed. Project/managed scopes are outside this detector. Missing/different/invalid entries are never called Connected.
2. Select **Notion read access** explicitly for production targets. Generated profiles include a read scope even when empty; zero selected means zero content reads. Old unscoped profiles retain test-only reads and never gain production access just because a new target is connected. **Notion write access** is a separate opt-in. Writes also require read scope and the Workspace policy on Content; production policy changes require exact-ID Owner confirmation. Disabling Workspace writes works offline.
3. **Generate configuration**, then **Preview application** → **Apply reviewed LV999 entry** to update the indicated user file (`~/.claude.json` or `~/.codex/config.toml`, honoring configured client-home overrides). Close the native client first and reload it afterwards. Only the LV999 entry changes; existing files receive byte-exact backups, and a changed file requires a fresh preview. Unsupported inline TOML needs a manual merge using **Copy configuration**. Do not put runtime-specific snippets or backups in this public repo.
4. **Test LV999 transport** runs SDK initialize/tool discovery/a local read call. **Test native client** runs the installed client against a temporary profile/working directory containing only LV999. Native Claude uses its MCP health check; native Codex uses App Server initialization/status discovery. Neither starts a model turn or alters an existing session. Isolated handshake success does not mean your saved user entry is installed/enabled in a live model session.

Native versions/capability limits are recorded in [the matrix](messenger-capabilities.md). For repeatable developer checks:

```powershell
npm run test:clients-native
```

## Developer fallback

The CLI/hidden local prompt from M0 remains available for recovery. It writes a credential before API verification and requires a known real test Workspace ID, so GUI enrollment above is the recommended path. Set `$testWorkspaceId` and `$testWorkspaceLabel` locally, never in repository fixtures, then run:

```powershell
./scripts/credential-vault.ps1 -Enroll -WorkspaceId $testWorkspaceId
npm run cli -- register --workspace-id $testWorkspaceId --label $testWorkspaceLabel --test
npm run cli -- verify --workspace-id $testWorkspaceId
```

The CLI's default state directory matches Tauri. `--data-dir` supports isolated temporary test state. `npm run mcp` starts stdio MCP. Generate installed client configurations from the desktop's AI Clients page: its stable managed launcher selects complete, hash-verified runtime bundles under the app's data directory. Existing MCP sessions retain their immutable executable/backend while new sessions use the current bundle. This avoids disposable CI paths and installer file locks. Configuration generation does not apply the entry or expose credential management as MCP tools.

## Startup and updates

In Settings, **Start with Windows** reads and changes the current user's real startup registration. Enable it after installation; portable builds cannot register themselves. Launching LV999 again focuses the existing window. This opens the GUI at login; it does not provide tray/background operation after the window closes.

**Automatically check for updates** defaults on and persists locally. LV999 checks on launch and every six hours. A newer version produces a notice; only **Update to … & restart** starts installation. Pending, unknown or unverified content writes prevent installation. During installation a shared maintenance lease blocks new writes. The app verifies the package signature and its signed version before launching the installer; a download/verification failure keeps the current version. A working published release channel is required for an actual update.

## Release signing

`.github/workflows/release.yml` uses `tauri-action`, NSIS, the LV999-specific updater key, and this repository's `latest.json`. The public key is in `tauri.conf.json`. Local preview builds are unsigned; updater artifacts are created only with `tauri.release.conf.json` and a signing key.

A new LV999 key pair was generated locally in ignored `.tools/updater.key` and `.tools/updater.key.pub`. Do not regenerate it casually, commit it, copy Silverbench's key, or print it into a chat/log. Back up the private key securely before removing `.tools`. Before a release, configure Actions secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (this initial key has an empty password). No secrets were uploaded and no release was published during M0.

Tags must match the app version. The workflow creates a draft normal release for review. Drafts and prereleases do not establish a working `releases/latest` channel; publish an appropriate signed normal release only after its acceptance gate. Updater signatures are not Windows Authenticode signing and do not by themselves satisfy Smart App Control.

The Owner-approved v0.2.0 release is published, Actions signing is configured, and a real installed 0.1.9 → 0.2.0 update/restart passed. See [startup and update acceptance](qa/2026-11-21-updates-autostart.md) for retained settings, MCP continuity and remaining test boundaries.
