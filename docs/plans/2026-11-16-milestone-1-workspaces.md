# Milestone 1 — Workspace connection slice

Owner scope: first implement GUI Workspace connection and verification; defer real acceptance until the two test workspaces are ready. This does not authorize reading Vibecode/Honour or imply that all of M1 is complete.

## Decisions

- Extend the existing native shell. New connection input is an optional display name, masked Internal Connection token and explicit test confirmation. Derive real ID/name from Notion; do not require users to enter IDs.
- Verify identity and read-only search before saving. Reauthorization targets one existing immutable ID, preserves the prior credential on validation failure, and rejects duplicate new registrations.
- Persist tokens only in Windows Credential Manager. Clear transient GUI input on submit/cancel. Pass credentials only through trusted native/private-process IPC, not command arguments, environment variables, logs or browser/SQLite storage.
- Read back vault writes. Commit local metadata/proof/audit in one SQLite transaction; compensate caught vault/DB failures and report uncertain restoration. A narrow three-minute credential-save lease prevents simultaneous replacements across instances sharing the registry. Migration job leases and crash-safe cross-store recovery remain M2 work.
- Keep empty search results distinct from authorization failure. Display a first-batch count and sharing/indexing guidance; do not claim a full inventory or root-page access.

## Acceptance for this slice

Connection modal, keyboard focus/escape, immediate token-field clearing, actual backend result handling, per-row verify/reauthorize, exact identity binding, persistence after restart, safe errors, and no token leakage. Automated native tests use an isolated application copy and replace only Notion HTTP while exercising real Windows vault, SQLite and private pipes. The production bundle has no test-adapter override mode.

## Deferred

Real two-workspace acceptance; authorized root-page browsing and disconnect; content CRUD; Project Routing; Claude/Codex configuration and actual client integration. Existing independent Windows-without-Node acceptance remains open. See [the slice acceptance record](../qa/2026-11-16-milestone-1-workspaces.md).
