# Milestone 1 page browsing and routing slice — 2026-11-16

**Engineering slice verified; real Notion acceptance remains deferred.** The Owner requested accessible-page browsing and Project Routing GUI/backend wiring while the two test workspaces are not ready. This does not complete all of M1. No real Notion token/workspace was used; Vibecode/Honour content and existing AI-client configurations were not read or changed.

## Resulting behavior

- Workspaces → Browse pages runs a page-only title search for one exact connection. Refresh, opaque-cursor pagination, ID deduplication, omission warnings and exact Notion-link/ID inspection are available. Search is explicitly an incomplete index; metadata inspection does not load a full page tree or become a Notion editor.
- Routing → Add mapping selects a canonical unique Project Key, name, exact Workspace and inspected root. Switching Workspace clears the old root and ignores late results. Saved targets always show IDs rather than relying on titles. The backend revalidates identity and retrieves the page on every save/reassignment and resolution.
- Roots must be active ordinary pages, including ordinary child pages. Database records, archived/trashed pages and unsupported parent types are rejected. Missing/unshared pages return 404 attribution without trying another workspace's token or treating that one object as proof the entire workspace is disconnected.
- Local route saves and their success audit commit transactionally. Revision matching rejects duplicate creation/stale editors; resolution also rejects a route changed during live validation. Configuration and its saved validation timestamp remain distinct from a fresh Check route result and from content-write authorization.
- Distinct keys may share names. Normalized exact-name resolution requires one match or returns `AMBIGUOUS_TARGET` before credential/page reads. Exact keys select one route and do not fall back to names or same-titled pages.
- GUI, CLI and MCP share the same service/SQLite state. MCP now exposes six read-only tools, adding `list_projects` and `resolve_project`; route mutation is native management or an explicit CLI action. Notion content remains read-only, with `changed_objects: 0` for these operations.

## Checks

Existing Windows x64 host and actual Tauri/WebView2, 1200×820 configured window plus dark and 390×844 CSS viewport checks. Native runs invoke bundled Node 26.13.1 with system Node removed from PATH. The Browser plugin/skill was absent, so Playwright attached to process-scoped loopback CDP ports; the application does not enable these ports in its configuration. Unit tests were run on the bundled LTS. Existing visual tokens/components were extended, without a new design concept.

| Command/check | Result / exit |
|---|---|
| `npm run typecheck` and bundled Node → `node_modules/vitest/vitest.mjs run` | 0; 65 tests across four files |
| Native `test:routing-gui` flow with an explicit evidence directory | 0; isolated Notion HTTP, real GUI/private pipes/vault/SQLite and actual MCP stdio client |
| `npm run test:smoke` | 0; staged production runtime, vault probe, management IPC, MCP handshake/list/calls including project tools and invalid/unknown targets |
| `npm run package:desktop` | 0; unsigned preview NSIS installer |
| Isolated silent install, runtime hash comparison and installed native shell check | 0; installed backend, credential bridge and Node match tested resources |
| Silent QA uninstall | 0; local registry hash preserved and test uninstall entry removed |
| Public source scan, staged secret-pattern grep and whitespace check | Passed |

The native flow covered page pagination/deduplication, empty title search, exact Notion-link lookup, wrong-workspace page 404, disabled record-root selection, backend archive-root rejection, selecting a specific ID among same-titled pages, add/save/check route, duplicate-name warning and refusal, stale-editor conflict, explicit reassignment, local filtering, and persistence after restarting the app. A delayed page search was left in flight during a Workspace switch; old results/selection were not reused. The MCP client listed the same saved routes and live-resolved the reassigned exact key through a separate backend process sharing the isolated registry.

No relevant console error, blank page, framework overlay or horizontal dialog overflow was observed. Root inspection and selected-target panels were reviewed visually. Dialog actions remain visible while scrolling long results; keyboard focus stays in the modal. Page/route operations refresh backend state so credential failures are not hidden behind stale connection badges.

Unit/SDK contract coverage includes page-only filtering and exact GET paths, API version pinning, broken cursors, unsupported/partial objects, link validation, identity swapping, root eligibility, cross-workspace rejection, no title guessing, stale revisions, atomic save/audit failure, normalized duplicate names before any vault lookup, root renaming/revocation, route changes during resolution and malformed input. The earlier Workspace credential rollback tests remain in the 65-test suite.

## Evidence and limits

The native harness uses a temporary application copy and replaces **only Notion HTTP** in the official SDK. Real private IPC, shared backend code, SQLite and Windows Credential Manager are exercised. Synthetic identities/page IDs/tokens are generated per run; the test checks credential absence before use, removes/read-checks its generated credentials afterward, and removes temporary application/data files. No fixture/adapter override exists in the production entry. The ordinary installed production shell is separately checked without submitting a token or contacting Notion.

Screenshots remain outside Git in the session visualization directory, under `lv999-m1-routing/`: `routing-editor.png`, `routing-ambiguous.png`, `routing-restart.png`, `routing-dark.png` and `routing-narrow.png`. Their identities/pages are **simulated Notion responses**, not real acceptance evidence. Public reports do not contain real workspace/page/data-source IDs.

When the Owner creates the two real test workspaces, follow [setup](../setup-windows.md): connect them, browse actual shared pages, bind and edit exact roots, test mismatched/unshared/archived targets, restart and validate the same route through GUI/MCP. Verify actual permissions and indexing behavior rather than inferring success from this harness.

Disconnect/route removal, full page-content/tree browsing, CRUD, AI-client setup and migration remain outside this slice. Independent clean Windows-without-Node acceptance remains open from M0. No tag, release, deployment, workflow run or signing-secret upload was performed.

## Local artifact

`apps/desktop/src-tauri/target/release/bundle/nsis/LV999_0.1.0_x64-setup.exe` — approximately 28.36 MiB, unsigned engineering preview. It replaces the previous local preview at the same version/path; older QA reports describe historical builds.

SHA-256: `c0dbd84e08905aaf1b5dda07b517afa4e085a4d5ed68b0cc96988a170a132cf2`.

The isolated QA installation was removed after testing. Normal application state contains no test Workspace registration or project route; its local bootstrap activity was retained. Generated test credentials were removed and checked absent.
