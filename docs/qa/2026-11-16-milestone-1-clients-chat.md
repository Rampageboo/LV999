# Milestone 1 AI Clients and Workspace group chat — 2026-11-16

**Engineering slice passed; real Notion acceptance remains deferred.** The Owner requested client configuration detection/generation and MCP handshakes, added Agent Messenger as a product feature, and specified one group per Workspace with both Workspace and standalone Chats entry points organized by Project. The Owner delegated rollout order, then steered the UI toward an ordinary chat interface. This delivery implements usable local group messaging and client integration; automatic wake/bridges/supervision remain later work. It is not completion of the reference Messenger's T01–T20 or all of M1.

## What changed

- Clients detects CLI versions and known user-scope configuration, returns only owned-entry status, and generates credential-free JSON/TOML snippets. Existing user/global files and model sessions are not modified. Chat access is explicitly selected per client; default profiles grant no Messenger group access.
- SDK transport and installed-native-client checks have separate evidence. Native probes use disposable configuration **and working directories** containing only LV999, with bounded waits. No model turn, session resume, unrelated project MCP startup or Notion read is part of the probe.
- Every registered Workspace has a group, including Workspaces without projects/messages. Workspaces and Routing shortcuts open the same standalone Chats screen. Its project-first directory, Workspace groups and All conversations overview use the same stored records; project reassignment retains historical Workspace context.
- The Owner's UI correction is implemented as an ordinary group chat: participant initials/names, left/right message bubbles, compact read hints, independent timeline scrolling and a fixed input. Enter sends; Shift+Enter adds a line. Configuration/protocol diagnostics remain on Clients.
- SQLite atomically stores message, per-recipient receipts and success audit. Repeated sender/retry keys return the same message; changed payloads conflict. Full-body reads update only that reader. Summary views and handshake tests never mark another agent read. Receipts mean Read via API, not model understanding, task acceptance or completion.
- Owner-controlled stdio startup fixes Claude/Codex sender identity and Workspace allowlist. Tool input cannot forge a sender. This is local application-interface authorization, not isolation from a hostile same-account process or native-model attestation. Ordinary @ text does not wake anything; structured mentions return Unsupported.

## Verification

Existing Windows x64/Tauri/WebView2 host; bundled Node 26.13.1. Unit tests ran on that bundled LTS. Browser plugin/skill absent, so native UI checks used Playwright against a process-scoped loopback WebView2 debug port, not a production HTTP listener. Native test Workspaces/messages/agents are synthetic; Notion HTTP is injected only into a temporary test copy.

| Check | Result / exit |
|---|---|
| Typecheck and bundled Node → Vitest | 0; 83 tests across six files |
| `npm run test:clients-native` | 0; real installed Claude Code 2.1.205 and Codex 0.144.1; SDK and native checks passed for both profiles, ten tools discovered |
| Native Clients/Chats flow | 0; real UI/private pipes/SQLite/vault and scripted stdio MCP agent, with simulated Notion HTTP |
| `npm run test:smoke` | 0; generic production MCP still exposes its six read-only Notion/project tools and passes handshake/list/call checks |
| `npm run package:desktop` | 0; final unsigned local preview installer |
| Isolated install and runtime hash comparison | 0; installed backend, vault bridge and Node match tested resources |
| Installed production-shell check and QA uninstall | 0; eight pages/dialog behavior passed; local registry hash preserved and QA uninstall entry removed |
| Public source scan, staged secret-pattern grep and whitespace check | Passed |

Native capability evidence was obtained from actual installed versions and generated local Codex protocol schemas. Claude's isolated MCP health check and Codex App Server initialize/status discovery succeeded without model turns. Actual user files still have no LV999 entry: **Not configured** and **isolated handshake passed** are deliberately distinct. Full session resume, Claude Channels, current desktop chat synchronization and automatic wake are not claimed; see [the matrix](../messenger-capabilities.md).

The UI flow verified Workspace group entry, opt-in configuration generation, SDK handshake without Agent-read changes, literal @ persistence without a wake, scripted MCP sender identity, allowlist rejection, unread summary versus full-read separation, quote replies, project filtering, central overview, Routing project-chat entry and restart persistence. The ordinary layout was checked for message bubbles, Enter-to-send, fixed desktop composer, dark theme, 390×844 CSS layout and clean console. It used generated credentials/state and cleaned them afterward; no real Agent model wrote the scripted test replies.

The Enter-to-send assertion was tightened to wait for the saved message bubble rather than matching text that was still in the composer. The final native flow passed this stricter persistence assertion.

Unit coverage includes independent Human/Claude/Codex receipts, no wake from body text, rejected structured wake, sender spoofing rejection, cross-Workspace access/reply rejection, idempotent versus distinct messages, route-reassignment history, stale-topic rejection, atomic rollback, history pagination and persistence. Configuration tests cover JSON/TOML parsing, no unrelated-value disclosure/file mutation, missing clients, malformed/mismatched/remote entries and no handshake success inferred from configuration.

## Evidence and boundaries

Screenshots remain outside Git under the session visualization directory's `lv999-m1-clients-chat/`: `clients-configuration.png`, `workspace-group-chat.png`, `project-chat-overview.png`, `chats-dark.png`, `chats-narrow.png`. Their Workspace identities and agent replies are synthetic. Installed production-shell screenshots are separate and involve no token submission. Original attachment instructions were treated as reference content; adapted product requirements are in [agent-messenger.md](../agent-messenger.md).

Temporary client profiles, application/data copies and generated vault entries were removed and checked absent. Normal application state retains only local bootstrap activity and has no test Workspace/chat history. User/global client files were read for owned-entry detection only, never overwritten; no existing conversation was resumed. No model generation, automatic agent start, tag/release, deployment or signing-secret upload occurred.

Real Notion still awaits two prepared test Workspaces; independent clean Windows-without-Node acceptance is also open. Disconnect, Notion CRUD/attachments, full event-sequence replay, authenticated remote service, automatic wake/supervisor and evidence-backed task workflow are not implemented by this slice. Visibility-scoped polling refreshes current messages/counts; this is not the reference's WebSocket/event-replay system.

## Artifact

`apps/desktop/src-tauri/target/release/bundle/nsis/LV999_0.1.0_x64-setup.exe` — approximately 28.40 MiB, unsigned engineering preview, superseding earlier local previews at the same version/path.

SHA-256: `ab573f720077bfb15bf38a2023229406212249b8fb2422cd49e3c3732df11700`.
