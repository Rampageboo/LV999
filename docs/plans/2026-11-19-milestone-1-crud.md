# Milestone 1 completion — content CRUD and live Claude acceptance

Owner authorization: implement M1 creation/edit/deletion, validate only in the two already connected test Workspaces, complete real Claude wake acceptance, and open the updated app only after validation passes. Existing test pages are inputs/parents; destructive live checks target only uniquely named objects created by this acceptance.

## Delivery and evidence gates

1. Shared backend/SDK content operations: page and block reading, create/edit/append, reversible trash/restore; database/data-source schema, records/relations, views and bounded local-file upload. No arbitrary HTTP or external file-download endpoint.
2. Explicit per-Workspace write enablement; exact Workspace/project routing and revision checks; pre-write resource validation, single-use destructive approval, bounded write leases, retry keys, unknown-outcome blocking and safe audit. Ordinary write failures must not erase connection method/health.
3. Native GUI content workspace and client write-access configuration, backed by the same operations exposed to MCP/CLI. The GUI calls previews/executes through private IPC; it does not call Notion directly.
4. Automated contract/isolation/conflict/idempotency/approval checks. Real create → edit → read back → trash/restore checks, records/relations and attachment validation in each test Workspace. Real route ambiguity and wrong-Workspace attempts must fail before mutation.
5. Real Claude and Codex MCP tool turns scoped to test resources, plus real @Claude wake/new-session/resume/Stop and restart fencing. Native client sign-in remains with its own authentication flow; credentials/codes are not printed or copied.
6. Windows CI build, artifact identity/hash verification, final GUI validation and acceptance record. No full M1 pass if any required gate remains blocked; no preview presented as finished before it works.

## Engineering choices

- No project scope list exists, so the shared contracts and tightly coupled backend/UI integration are handled in the main conversation. No additional threads are created.
- Notion page/block deletion is a recoverable move to trash through the official API, not a claimed permanent deletion. The generic destructive path still requires review of an exact current target and a one-use approval; the Owner has already authorized cleanup of acceptance-created disposable test objects.
- Notion does not provide a general cross-editor transaction: local leases plus a fresh last-edited comparison detect observed conflicts, without claiming an atomic server-side compare-and-swap.
- Native authentication check: Claude subscription sign-in was confirmed via its own CLI status before model acceptance. The actual model/session/tool results remain to be verified separately.

## Outcome

M1 content/client/native-wake gates passed; implementation and evidence are in [the acceptance record](../qa/2026-11-19-m1-content.md). Windows CI built the runtime, exact artifact identity and hashes passed, and the new native app was opened and exercised. Both test Workspaces passed CRUD plus real Claude/Codex create/write/readback; Claude Stop remained effective across scheduler restart. Configuration application has a reviewed GUI path and isolated backup/preservation/conflict tests. No global client config was modified during acceptance. The remaining clean-Windows/no-Node environment check is stated separately; M2 background/recovery and migration work were not included.
