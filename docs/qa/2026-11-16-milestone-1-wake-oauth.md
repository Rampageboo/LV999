# Milestone 1 wake and OAuth — engineering evidence, native build blocked

## Result

The selected-mention/session and OAuth source paths are implemented. Engineering checks below passed, including real Codex model turns and Stop. **No updated native executable/installer was produced.** The existing open app was preserved and still lacks the changed native UI/commands. Real Notion acceptance and authenticated Claude model acceptance remain pending; M1 is not complete.

## Verified behavior

- A plain message or literal @ text persists without a wake. Selecting an actor in the menu adds an authoritative wake chip. Message/recipients/wake/audit share one transaction; repeated sends are idempotent.
- Bindings opt in by Workspace/project with explicit model/effort. First mention creates an owned native session; later mentions resume only that saved session. Busy turns queue and two dispatchers cannot claim one active binding.
- A process launch/transport delivery does not mark a message read. The message ID and fresh nonce must match a native reply before the reply, consumption receipt and acknowledgement commit. Replies do not automatically mention another actor. Causal handoffs have a hop limit. No task Done is claimed.
- Stop cancels outstanding attempts, persists pause/generation and interrupts only owned processes. Late responses cannot write a reply/receipt. Stale editor, Resume or Retry revisions cannot undo a newer Stop. New mentions, manual acknowledgement and restart cannot unpause. Explicit Resume permits future messages, and old messages need their own Retry.
- OAuth uses one runtime-configured app for individual Workspace authorizations. The loopback callback validates state, Host/path/method, expires, consumes a code once and rejects an occupied port. Wrong target/identity and production names block before content reads. Denial/cancel/expiry save no credential.
- Client secrets use separate per-client Windows vault entries; each Workspace stores access/refresh tokens with authoritative identity in one atomic vault blob. No secret goes to SQLite, browser storage, process arguments, snapshots or source fixtures. Explicit refresh rotates credentials and rechecks identity/read access. Uncertain post-refresh persistence requires reauthorization; it does not pretend an old refresh token is reusable.

## Checks

Environment: Windows host, bundled Node **26.13.1**, Claude Code **2.1.205**, Codex CLI **0.144.1**. Native model probes use existing sign-in without copying credentials, disable project tools and use private app-owned session directories.

| Check | Evidence/result |
|---|---|
| TypeScript | `npm run typecheck`, exit 0 |
| Automated suite | Bundled Node running `node_modules/vitest/vitest.mjs run`, exit 0: **108 tests / 8 files**. Includes callback HTTP, refresh rotation/uncertain save, Stop races, leases, idempotency, project binding isolation and malformed receipts. |
| JS/UI resources | `npm run build:bundle`, exit 0; Node distribution checksum verified. This does not compile Rust. |
| Production entry/transport | Bundled Node running `scripts/smoke.mjs`, exit 0: staged runtime with system Node absent from PATH, private management IPC, real vault probe, generic six-tool MCP initialize/list/call/rejection/close. |
| Native client MCP | `scripts/client-probe.mjs`, exit 0: both clients passed SDK and isolated native handshakes; **11 tools** in each actor-bound profile. No model turns in these handshake checks. |
| Real Codex wake | New thread and same-thread second turn returned matched receipt JSON; `gpt-5.6-sol`, low effort. Native discovery confirmed availability; `gpt-6.1-sol` was unavailable to this account and was not used as default. |
| Real Codex Stop | `scripts/wake-native-probe.mjs --stop-only`, exit 0: delivered turn interrupted, CANCELLED, no reply accepted. |
| Claude model execution | **Blocked AUTH_REQUIRED**, current local client signed out. Safe-mode create/resume implemented but no successful Claude model turn/resume/Stop is claimed. |
| Frontend interactions | Built frontend in isolated installed Chrome, 1200×900 and 390×844, light/dark; **passed**. Test-only IPC binding drives a real separate management process, real SQLite and Windows vault. Notion HTTP and model bridge are scripted. Browser plugin absent; Playwright fallback used without installing browser dependencies. |
| Native Rust/new installer | **Blocked**, `node scripts/tauri.mjs build --no-bundle`, isolated target directory, exit 1. See below. |

The native probe script returns nonzero for a failed/blocked model probe; a successful MCP health check must not be presented as a successful model turn.

## UI interaction evidence

The flow under test: Workspace group → Agent sessions → enable Codex → select @ → reply in an automatically created session → Stop a delayed turn → no late reply → paused mention/Retry rejected → explicit Resume and Retry → same session → scripted Claude sign-in block → backend restart → bindings still paused.

The OAuth flow under test: Workspaces → Connect with Notion → enter generated client settings → password field cleared → authorize → reject wrong state → receive scripted valid callback → verify/save second Workspace → automatic group → explicit token refresh → exact-target reauthorization rejects another Workspace → dark/narrow modal → no secret in status/storage/SQLite.

Page identity, nonblank content, absence of framework overlay, target interactions and clean console passed. Screenshots were visually inspected. Private evidence is outside the repository under `%USERPROFILE%\.codex\visualizations\2026\11\15\<current-session>\`: `wake-bindings.png`, `wake-chat-stop.png`, `oauth-connected.png`, `oauth-mismatch-dark.png`, `oauth-narrow.png`, plus `wake-oauth-gui-probe.mjs`. These are synthetic test Workspaces, not real Notion screenshots. The test adapter is not built into the production entry. Generated vault keys and temporary app data were removed and read back absent.

## Native build blocker and remaining acceptance

Rust compilation failed with E0463 for `zerovec_derive` and `displaydoc`. Windows **Microsoft-Windows-CodeIntegrity/Operational** events **3077/3033**, observed at 09:24 Sydney time, explicitly identify Smart App Control/signing-policy denial while `rustc.exe` loads the freshly compiled dependency DLLs under `.tools/wake-target/release/build/`. This is evidence of a Windows policy block, not proof that the Rust host typechecks. No build success, native UI verification or installer update is claimed.

The build used a separate target to preserve the running old app. Security policy, trust stores and signing settings were not changed, and blocked binaries were not moved or reused to evade the denial. A legitimate CI/approved build and new native IPC/browser-opener/exit acceptance remain required. No remote branch, workflow run, tag, release or deployment was performed in this slice.

The Owner's Chrome Developer portal was inspected read-only: a public OAuth app with the localhost callback exists. Its client secret remained masked; no consent, permission change or real token exchange was performed. One public app may install in multiple Workspaces as its installation scope permits; authorization results remain separate. Real tests require the Owner to enter its secret in the new GUI and authorize each test Workspace. Vibecode/Honour content was not accessed. Automatic Workspace creation, full task execution/supervision, desktop chat synchronization, content CRUD and independent clean Windows acceptance remain outside the verified result.
