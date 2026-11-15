# Native client capability matrix — 2026-11-16

Observed locally: Claude Code **2.1.205**, Codex CLI **0.144.1**. Capability tests use disposable client configuration directories and working directories, containing only LV999, with bounded waits. They do not copy authentication files, create a model turn, resume an existing conversation or alter user MCP configuration.

| Capability | Evidence/status |
|---|---|
| Claude Code stdio MCP | **Verified**: isolated `claude mcp get lv999` health check; separate SDK initialize/list/local call. Ten tools discovered in the client-bound profile. |
| Codex stdio MCP | **Verified**: installed `codex app-server --stdio`, `initialize`, `initialized`, `mcpServerStatus/list`; LV999 server info and its tool inventory returned. Ten tools discovered. |
| LV999 SDK transport for both generated profiles | **Verified**: initialize, tools/list and local list_workspaces call. This is displayed separately from native-client evidence. |
| User/global configuration detection | **Verified**: known user paths parsed safely; only the owned LV999 entry's state returned. Actual local files currently have no LV999 entry. No success is inferred from file presence. |
| Project/managed client configuration detection | Not implemented; the UI explicitly reports user-scope paths. |
| Claude Channels | Documented research preview; no running Channel/session or policy compatibility test performed. Not used. |
| Claude CLI session resume | Advertised by installed help; actual session resume/model activity not exercised. Not used. |
| Codex thread/resume and turn/start | Advertised protocol surfaces; actual model turns/session resume/sandbox approvals not exercised. Not used. |
| Codex queue | Not advertised by this installed CLI's command list; do not depend on it. `queue --help` returned the root help rather than proving queue support. |
| Existing desktop chat synchronization | Unverified. Native MCP discovery does not establish control/synchronization of the Owner's currently open desktop conversations. |
| Automatic wake, pause/Stop supervision and task completion | Not implemented in this slice. Ordinary messages remain unread until explicit read API retrieval. |

Installed protocol schemas were generated locally and checked rather than assuming the current website exactly matched 0.144.1. For example this installation's status-list input does not have the documented newer `serverName` field, so the test isolates the profile instead of relying on that filter.

Primary references: [Claude MCP](https://code.claude.com/docs/en/mcp), [Claude Channels](https://code.claude.com/docs/en/channels), [Codex MCP](https://developers.openai.com/codex/mcp), [Codex App Server](https://developers.openai.com/codex/app-server). Local runtime results, not these links alone, establish the Verified rows.
