# Windows bootstrap

Milestone 1 is in progress. GUI test-workspace connection, page browsing and local project routing are implemented; Notion content remains read-only. Two real test workspaces have not yet been created, so real acceptance is still pending. Do not use Vibecode or Honour. Closing the window stops its backend. Tray/background operation, autostart and single-instance recovery belong to M2.

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

1. Manually create **two test workspaces** in Notion and a separate Internal Connection in each. Grant each connection access to a test root page. Workspace creation is a manual Notion action; LV999 does not create workspaces.
2. Open LV999 → Workspaces → **Connect workspace**. Optionally enter a display name, paste that test connection's token in the masked field and confirm this is a test workspace. Do not paste tokens into chat. No Workspace ID needs to be entered.
3. Select **Verify & connect**. The backend discovers the real workspace ID/name, blocks production identities, checks read access using a first search batch, and only then writes and reads back the credential in Windows Credential Manager. The input field is immediately cleared on submission. Cancel/Escape discards unsubmitted input; during saving, dismissal and duplicate submission are disabled.
4. Success shows the display name, actual Notion name/ID, verification time and search sample. Zero returned objects triggers a sharing/indexing warning. It does not prove a root page is shared or that the whole workspace is empty. Repeat for the second workspace.
5. Use **Verify connection** to read the saved credential and repeat identity/read-access checks. Stored configuration alone is not connectivity evidence; the displayed timestamp is the last completed verification, not continuous monitoring.
6. Use **Reauthorize** on an existing row to replace an expired/revoked token. The target ID is fixed. A token from another workspace is rejected before content access, and the current credential/verification is preserved if replacement validation fails. Connecting the same ID again returns `WORKSPACE_EXISTS` rather than silently replacing it.

Tokens persist only in Windows Credential Manager under `com.rampageboo.lv999/notion/<workspace-id>`. They are never returned in GUI/MCP snapshots or put in React state, browser local/session storage, SQLite or command arguments. If validation fails, re-enter a token to retry. A caught local save failure restores the previous credential (or removes the new one) and checks that restoration; an unconfirmed restoration is reported as `CREDENTIAL_STATE_UNCERTAIN`. A connection-save lock may remain for up to three minutes after a crash. Restart and refresh after an unknown backend result before retrying. Full crash recovery is an M2 gate.

`AUTH_REQUIRED` means missing/expired/revoked credentials. `FORBIDDEN` means Notion returned 403; check connection capabilities and page sharing. `NOT_FOUND_OR_NOT_SHARED` means 404 and does not distinguish missing from inaccessible objects. `WORKSPACE_MISMATCH` never falls back to a different credential. Only test workspaces are allowed: the checkbox is an explicit user assertion, and both labels and actual names Vibecode/Honour are blocked. Renaming a production workspace does not make it a test environment.

Real verification remains pending until the Owner prepares the workspaces. The native integration test replaces Notion HTTP only in a disposable application copy, exercises real IPC/SQLite/vault operations with generated synthetic credentials, and cleans them afterwards:

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

Real two-workspace route/permission acceptance is still pending. Do not put workspace, page or data-source IDs in public docs or fixtures. Route removal, disconnect, content CRUD, AI-client setup and full migration are not implemented by this slice.

## Developer fallback

The CLI/hidden local prompt from M0 remains available for recovery. It writes a credential before API verification and requires a known real test Workspace ID, so GUI enrollment above is the recommended path. Set `$testWorkspaceId` and `$testWorkspaceLabel` locally, never in repository fixtures, then run:

```powershell
./scripts/credential-vault.ps1 -Enroll -WorkspaceId $testWorkspaceId
npm run cli -- register --workspace-id $testWorkspaceId --label $testWorkspaceLabel --test
npm run cli -- verify --workspace-id $testWorkspaceId
```

The CLI's default state directory matches Tauri. `--data-dir` supports isolated temporary test state. `npm run mcp` starts stdio MCP; installed clients can invoke `<install-dir>\runtime\lv999-node.exe` with `<install-dir>\runtime\backend.mjs`, `mcp`. This step does not edit Claude or Codex configuration or expose credential management as MCP tools.

## Release signing

`.github/workflows/release.yml` uses `tauri-action`, NSIS, the LV999-specific updater key, and this repository's `latest.json`. The public key is in `tauri.conf.json`. Local preview builds are unsigned; updater artifacts are created only with `tauri.release.conf.json` and a signing key.

A new LV999 key pair was generated locally in ignored `.tools/updater.key` and `.tools/updater.key.pub`. Do not regenerate it casually, commit it, copy Silverbench's key, or print it into a chat/log. Back up the private key securely before removing `.tools`. Before a release, configure Actions secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (this initial key has an empty password). No secrets were uploaded and no release was published during M0.

Tags must match the app version. The workflow creates a draft prerelease for review. A draft prerelease does not establish a working `releases/latest` channel; publish an appropriate signed release only after its acceptance gate. Updater signatures are not Windows Authenticode signing and do not by themselves satisfy Smart App Control.
