# Milestone 1 — selected mentions, owned sessions and Notion OAuth

## Accepted outcome

- The Owner requested automatic wake/session binding for @Claude/@Codex. Ordinary messages must not wake an agent; user Stop must never automatically resume.
- The Owner delegated sequencing. This slice creates message-only native sessions automatically after explicit binding opt-in, with Workspace defaults and optional project overrides. Project commands/tools, desktop conversation synchronization and full task supervision remain outside the slice.
- The Owner subsequently created one public Notion OAuth app and reported creating the test Workspaces. One app should authorize those Workspaces individually; manual per-Workspace Internal Connection remains supported. Credentials must be entered locally, never in chat or the public repository.

## Implementation

1. Persist bindings, structured mentions, wake attempts, revisions, generations and leases alongside local group messages. Keep Workspace groups and project topics in the existing shared history.
2. Dispatch only selected targets to app-created native sessions. Serialize each binding, queue busy turns, bound handoff hops and verify a response nonce before recording native consumption.
3. Persist Stop/cancel state before interruption, fence late replies, reject stale Resume/Retry and block unknown outcomes instead of automatically resubmitting. Normal app exit pauses enabled bindings.
4. Add a GUI binding editor and selected-mention chips, compact wake state, Stop and explicit Resume/Retry. Report native authentication/model/quota failures truthfully.
5. Add per-client OAuth secret configuration, a fixed short-lived loopback callback with one-use state, per-Workspace vault token bundles, exact-target reauthorization and explicit token refresh. Keep all Notion content access read-only.

## Acceptance and current gate

Source/Node implementation, 108 automated tests, built frontend interaction tests, real Codex new/resume/Stop probes and both clients' isolated MCP handshakes passed. Claude model execution remains blocked by local sign-out. Real Notion authorization/read isolation awaits Owner consent and credentials in the new GUI.

The new native Rust host has **not** passed build or native GUI acceptance: Windows Smart App Control blocked freshly compiled Rust macro dependency DLLs. The old open executable was preserved. No security setting was disabled, no blocked DLL was relocated/re-signed and no new installer is claimed. Complete the native build in an approved Windows build environment (for example repository CI), then test the new host and actual authorization. Details: [QA record](../qa/2026-11-16-milestone-1-wake-oauth.md).

M1 as a whole remains open: this slice does not complete content CRUD, migration, production Workspace access or the independent clean-machine gate.

## Authorized CI follow-up

The Owner subsequently approved pushing the branch, building in Windows CI and opening the preview. The latest runtime/UI commit passed 109 tests, bundled Node/MCP smoke and a full native/NSIS build. Both installer and portable artifacts were downloaded and their commit/file hashes verified. The portable native app started successfully and displayed the existing Internal Connection plus OAuth setup/switch actions. A normal close of the preceding CI preview also reaped its owned backend. Real OAuth authorization remains waiting on the Owner's local client-secret entry and consent. Details: [CI follow-up](../qa/2026-11-16-windows-ci-oauth.md).

## Real OAuth follow-up — 2026-11-19

Both test Workspaces now passed real grants, identity/search/page reads, cross-Workspace denial and restart persistence. Their one-per-Workspace group entries were observed in Chats. Live testing exposed and fixed the removed archived field and OAuth-method loss after failed reads. The final runtime commit passed 113 tests and Windows CI; its checked portable artifact was reopened with both OAuth connections intact. Real refresh/revocation, route mutations, authenticated Claude and full M1 remain separate gates. See [live acceptance](../qa/2026-11-19-real-oauth.md).
