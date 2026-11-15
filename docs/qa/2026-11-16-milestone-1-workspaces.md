# Milestone 1 Workspace GUI slice — 2026-11-16

**Engineering slice passed; real Notion acceptance deferred at the Owner's request.** This work implements GUI connection, verification and reauthorization. It does not complete all of M1. The two real test workspaces are not ready; no real Notion credential or workspace was used, and Vibecode/Honour content was not read. Existing Claude/Codex configuration was not changed.

## Resulting behavior

- Workspaces → Connect workspace opens a keyboard-accessible modal with optional display name, masked token and mandatory test confirmation. Real workspace ID/name come from the backend rather than user-entered IDs.
- The backend checks the token identity, blocks production names, and performs a read-only search before persisting credentials. A successful search returning no objects shows a sharing/indexing warning. Counts are first-batch samples, not a root-page guarantee or whole-workspace inventory.
- Tokens persist only in Windows Credential Manager. The GUI field clears immediately on submit; cancellation/Escape discards unsent input. Stored tokens never return to the frontend. No token is put in React state, browser storage, command arguments, environment configuration, SQLite or audit output.
- Verify connection reads the saved token and repeats identity/read checks. Reauthorize pins the existing ID; a mismatched replacement cannot read content or change the prior credential. Duplicate new connections require explicit reauthorization.
- Vault writes are read back. A SQLite transaction saves metadata, verification and success audit together. Caught failures compensate credential changes and check restoration. Failed restoration is explicitly uncertain and clears prior positive evidence. A short credential-save lease serializes independent registry connections; it is separate from future migration/job locking.
- Notion remains read-only. Private management IPC gained two credential-management methods; MCP still exposes only the same four read-only tools. The production entry has no fixture/adapter-override mode.

## Verification and environment

Existing Windows x64 host, Tauri/WebView2 native window (1200×820 configured), system Node removed from PATH for native runs, bundled Node 26.13.1. Unit tests were also run directly using the bundled LTS. The Browser plugin/skill was absent; Playwright attached to process-scoped loopback WebView2 debug ports. These ports are not enabled in production configuration.

| Check | Result / exit |
|---|---|
| `npm run typecheck` (also in final package build) | 0 |
| Bundled Node → `node_modules/vitest/vitest.mjs run` | 0; 45 tests across three files |
| `npm run test:workspace-gui` with an explicit evidence directory | 0; native UI + private pipes + real Service/SQLite/Windows vault, with Notion HTTP replaced |
| `npm run test:desktop` with an explicit evidence directory | 0; production native entry, all seven pages, connection dialog/cancel, forward/reverse Tab trapping, refresh, dark/narrow layout and backend-disconnect error state; no token submitted |
| `npm run test:smoke` | 0; production staged runtime, real vault probe, private management snapshot, MCP v2 initialize/list/call/input rejection/close |
| `npm run package:desktop` | 0; unsigned engineering-preview NSIS installer |
| Isolated silent install, installed native shell checks and silent uninstall | 0; installed backend/credential bridge/Node hashes match the verified bundle; local registry hash preserved on uninstall |
| Public source scan, staged secret-pattern grep and whitespace check | Passed |

The native connection flow exercised required confirmation, optional-name fallback, cancellation and immediate password clearing; successful save/readback; HTTP 401, network and HTTP 403 failures; production rejection; duplicate rejection; wrong-workspace replacement rejection; two distinct workspace identities; empty-search warnings; successful token rotation; actual vault-entry removal followed by Auth required; read failure followed by Degraded and cleared proof; reauthorization recovery; and persistence plus verification after restarting the isolated app. Forward/reverse keyboard navigation was tested on the production dialog. No blank page, framework overlay, relevant console errors or dialog horizontal overflow was observed. Dark and 390×844 CSS viewport screenshots were inspected.

The added keyboard assertions found that native modal tabbing could escape at the last field. Explicit forward/reverse focus wrapping was added, then the production modal checks and full native connection flow passed. The state/credential tests also cover DB commit failure, failed/readback-mismatched vault writes, rollback failure, concurrent credential saves through independent Store connections, expired lease recovery and token absence in results/audit/SQLite. These are actual local tests; they do not validate remote Notion permissions.

## Evidence boundaries

`scripts/workspace-gui-smoke.mjs` builds a separate test-only backend composition into a temporary copy of the native app. The official Notion SDK receives an injected fake HTTP implementation; all remote responses are simulated. The real Windows vault, shared backend implementation, SQLite and native IPC are exercised. Test tokens/IDs are generated per run, checked absent before use, and removed/read back as absent afterwards. Temporary application/database files are removed. No permanent test registration or credential is left in the normal application state.

Screenshots remain outside Git in the session visualization directory:

- `lv999-m1-shell/connect-workspace-dialog.png`: production connection form, no credentials submitted and no simulated Connected state.
- `lv999-m1-workspace/connect-dialog.png`, `connect-dialog-dark.png`, `connect-dialog-narrow.png`: isolated native form variants.
- `lv999-m1-workspace/reauthorize-mismatch.png`: simulated identity mismatch, old credential preserved.
- `lv999-m1-workspace/connected-workspaces.png`: **simulated Notion identities**, real local persistence; not real Workspace acceptance.

## Remaining acceptance

When the Owner prepares the two real test workspaces, follow [GUI setup](../setup-windows.md): connect both, verify actual names/IDs and shared content, test cross-workspace replacement rejection and actual permission failures. Keep IDs/tokens out of this public report. A 404 remains “not found or not shared,” never proof that an object is absent.

Root-page browsing, disconnect, CRUD, project routing and Claude/Codex configuration/integration are outside this slice and still required for the rest of M1. Independent clean Windows installation without Node remains an open M0 gate. Caught-error compensation is verified; atomic recovery across process/OS failure between vault and SQLite is not guaranteed and remains later recovery work. No release/tag, Actions secret upload, GitHub workflow run or deployment was performed.

## Local preview artifact

`apps/desktop/src-tauri/target/release/bundle/nsis/LV999_0.1.0_x64-setup.exe` — unsigned engineering preview, approximately 28.34 MiB. This local build supersedes the M0 preview at the same version/path; the earlier M0 report describes its historical artifact.

SHA-256: `606ca94f6b930872d88fdda8ec49b649b3f6645679228a1b21ddd4611edf8b30`.

The QA installation was removed after testing. Normal application state retains only local bootstrap activity and has no test workspace registration. All generated credential entries from the isolated connection tests were removed and checked absent.
