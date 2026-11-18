# Real test-Workspace OAuth and read-only acceptance — 2026-11-19

## Observed authorization

The Owner explicitly approved the existing OAuth app's read/edit/create-page and workspace-user-email permissions for **Blenderboo** and **Sliverbench** test Workspaces. The app's capabilities were not changed. The selected top-level pages were Getting Started and To Do List in each Workspace; Notion's inherited child-page access also applies. LV999 performed no Notion content writes.

Both browser grants reached LV999's local callback, then passed identity and read-access validation and were saved. Sliverbench was switched from its existing Internal Connection to OAuth for the same immutable Workspace identity, preserving its configured label and local group. No duplicate Workspace/group was created. The callback success text alone was not treated as verification: the native app reported each named connection saved, and both displayed OAuth refresh actions.

Notion initially defaulted the provider's Workspace selector to Vibecode. The selector was changed to the explicitly authorized test target before each grant; Vibecode/Honour page content was not accessed. Earlier guarded failures were not treated as successful acceptance.

## Live defects found and corrected

1. Page search succeeded remotely but the GUI showed zero pages with unsupported-object warnings. The parser still required `archived`, which the pinned `2026-03-11` API removed. Commit `9a9fdcc` accepts its absence, still requires `in_trash` and conservatively rejects a supplied legacy archived flag. Routing and GUI fixtures now use current response shapes. Regression tests cover valid modern pages, unknown trash status and ineligible roots. [Official page schema](https://developers.notion.com/reference/page).
2. A deliberately wrong-Workspace raw page read returned the expected 404, but its error handling discarded connection-method metadata. Later verification inferred Internal Connection from that lost proof even though the vault still contained a valid OAuth bundle. Commit `fc70577` derives successful proof's kind from the credential actually decoded, retains the known kind on connection failures, and treats missing/unshared raw pages as target failures rather than broken connections. Regression tests cover authentication failure, recovery from stale kind metadata and preservation of proof after a missing page.

## Read-only evidence

| Check | Blenderboo | Sliverbench |
|---|---|---|
| Real OAuth grant and saved identity/read proof | Passed | Passed; existing connection upgraded |
| Connection available after normal app restart | Passed | Passed |
| GUI page browser after schema fix | 10 pages loaded | 10 pages loaded |
| Production MCP identity/search verification | Passed; first batch 11 shared objects | Passed; first batch 11 shared objects |
| Own Getting Started page retrieved | Passed | Passed |
| Other test Workspace's page requested with this connection | Blocked: NOT_FOUND_OR_NOT_SHARED | Blocked: NOT_FOUND_OR_NOT_SHARED |
| OAuth kind / Connected status retained after the negative read using fixed code | Passed | Passed |
| One group entry in central Chats overview, also after restart | Passed | Passed |

Counts are timestamped samples of the shared search index, not complete inventories. The initial grant-time search returned two objects per Workspace; the later checks returned the larger samples above. Parent grants can include child pages and the search index can change over time. No exact Workspace/page/client identifiers, authorization codes, email addresses or tokens are included in this public record.

The live MCP probe used the actual read-only production entry without an agent actor binding, so it did not start model turns or dispatch queued mentions. It resolved only the two approved test connections, verified them, searched the known test title, read each owned page, tested both wrong-Workspace directions and restored fresh verification. The post-fix probe additionally checked kind/status before its final verification, preventing the last verification from hiding the metadata regression. Client/access/refresh credentials remained inside the app/vault/private pipes and were not printed. Private reproducible probe: `%USERPROFILE%\.codex\visualizations\2026\11\15\<session>\live-notion-readonly-probe.mjs`.

## Build/delivery status

The page-schema preview passed [Windows CI 44366951281](https://github.com/Rampageboo/LV999/actions/runs/44366951281), including **111 tests**, TypeScript/resources, staged Node/MCP/vault smoke, Rust/NSIS build and artifact upload. All nine downloaded artifact files and the exact commit were checked. That portable app was launched and the live GUI page lists above were observed. Its preceding application/backend processes exited normally; no active agent turns were present.

The connection-state fix passed **113 tests**, typecheck/public-content checks and the real MCP probe using the rebuilt backend. [Windows CI 44370139548](https://github.com/Rampageboo/LV999/actions/runs/44370139548) then passed its second attempt, including the real staged vault/MCP smoke and native/NSIS packaging. The first attempt hit a cold-runner vault-probe timeout while its independent probe succeeded; the assertion and bounded startup budget were retained.

The final artifact `LV999-windows-x64-44370139548` at runtime commit `fc705778e378726176d03a1ac0ccb01c93440e3c` was downloaded into ignored `.tools/ci-builds/44370139548/`. All nine file hashes and the exact build commit/run were verified. Its packaged backend was byte-for-byte identical to the backend used by the successful post-fix live MCP probe. The preceding preview and its owned backend exited normally with zero active agent turns. The final portable application was opened: Node/vault/native IPC passed, the dashboard showed two verified connections, and both Workspace cards retained OAuth refresh actions after restart. No new authorization or secret entry was needed. Installer built/downloaded; portable preview opened; no installer overwrite or release was performed.

## Remaining gates

This completes the observed dual-test-Workspace OAuth/identity/search/page-read and cross-Workspace denial evidence above. It does not establish full M1 completion. Real token-refresh rotation/revocation, real route save/resolve/reassignment, authenticated Claude model execution, full supervisor behavior, migration/content CRUD and an independent clean Windows GUI machine without Node remain separate checks. No new agent/model activity, Notion content edits, formal-Workspace content access, merge or release occurred during this acceptance.
