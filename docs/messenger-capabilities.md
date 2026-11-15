# Native client capability matrix — 2026-11-16

Observed locally: Claude Code **2.1.205**, Codex CLI **0.144.1**. Handshake tests use disposable profiles and no model turns. Separate wake tests use the existing native sign-in without copying credentials, with tools disabled, explicit models/efforts and bounded waits. Only app-created sessions are resumed; user MCP configuration and existing conversations are not modified.

| Capability | Evidence/status |
|---|---|
| Claude Code stdio MCP | **Verified**: isolated `claude mcp get lv999` health check; separate SDK initialize/list/local call. Eleven tools discovered in the client-bound profile. |
| Codex stdio MCP | **Verified**: installed `codex app-server --stdio`, `initialize`, `initialized`, `mcpServerStatus/list`; LV999 server info and its tool inventory returned. Eleven tools discovered. |
| LV999 SDK transport for both generated profiles | **Verified**: initialize, tools/list and local list_workspaces call. This is displayed separately from native-client evidence. |
| User/global configuration detection | **Verified**: known user paths parsed safely; only the owned LV999 entry's state returned. Actual local files currently have no LV999 entry. No success is inferred from file presence. |
| Project/managed client configuration detection | Not implemented; the UI explicitly reports user-scope paths. |
| Claude Channels | Documented research preview; no running Channel/session or policy compatibility test performed. Not used. |
| Claude CLI session create/resume | Implemented via safe-mode print/stream JSON and app-owned session IDs. **Live blocked: AUTH_REQUIRED**; no successful Claude model turn or resume is claimed. `--bare` is deliberately not used because installed help says it skips the native OAuth/keychain sign-in. |
| Codex thread/start, thread/resume and turn/start | **Verified**: a new owned session and a second turn in the same session returned matching receipt JSON. Native model discovery identified `gpt-5.6-sol` as available; low effort used. A requested `gpt-6.1-sol` turn was unavailable to this native account; it is not used as the default. |
| Codex Stop | **Verified**: a separate owned turn was interrupted immediately after delivery; it returned CANCELLED and no accepted reply. Durable pause/late-reply fencing/restart tests also pass with a scripted bridge. |
| Codex queue | Not advertised by this installed CLI's command list; do not depend on it. `queue --help` returned the root help rather than proving queue support. |
| Existing desktop chat synchronization | Unverified. Native MCP discovery does not establish control/synchronization of the Owner's currently open desktop conversations. |
| Automatic wake and binding | Implemented for explicitly selected @ targets, with app-created sessions and queued busy turns. Scripted UI/backend tests verify pause, retry and same-session behavior. New native GUI build is blocked by local Windows compiler-DLL policy. |
| Task execution/completion | Not implemented. Native turns are message-only; a matching consumption acknowledgement is not task Done. Claude model success and full supervisor acceptance remain unverified. |

Installed protocol schemas were generated locally and checked rather than assuming the current website exactly matched 0.144.1. For example this installation's status-list input does not have the documented newer `serverName` field, so the test isolates the profile instead of relying on that filter.

Primary references: [Claude MCP](https://code.claude.com/docs/en/mcp), [Claude Channels](https://code.claude.com/docs/en/channels), [Codex MCP](https://developers.openai.com/codex/mcp), [Codex App Server](https://developers.openai.com/codex/app-server). Local runtime results, not these links alone, establish the Verified rows.
