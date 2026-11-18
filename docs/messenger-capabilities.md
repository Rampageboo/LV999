# Native client capability matrix — 2026-11-19

Observed locally: Claude Code **2.1.205**, Codex CLI **0.144.1**. Handshake tests use disposable profiles and no model turns. Separate real wake tests use native sign-in without copying credentials, explicit models/efforts and bounded waits. Message-only mode has tools disabled; opt-in Notion mode enables only the bound LV999 MCP. Only app-created sessions are resumed; acceptance did not modify user MCP configuration or existing conversations. See [live content acceptance](qa/2026-11-19-m1-content.md).

| Capability | Evidence/status |
|---|---|
| Claude Code stdio MCP | **Verified**: isolated `claude mcp get lv999` health check; separate SDK initialize/list/local call. 36 tools discovered in the client-bound profile. |
| Codex stdio MCP | **Verified**: installed `codex app-server --stdio`, `initialize`, `initialized`, `mcpServerStatus/list`; LV999 server info and its tool inventory returned. 36 tools discovered. |
| LV999 SDK transport for both generated profiles | **Verified**: initialize, tools/list and local list_workspaces call. This is displayed separately from native-client evidence. |
| User/global configuration detection | **Verified**: known user paths parsed safely; only the owned LV999 entry's state returned. Actual local files currently have no LV999 entry. No success is inferred from file presence. |
| Project/managed client configuration detection | Not implemented; the UI explicitly reports user-scope paths. |
| Claude Channels | Documented research preview; no running Channel/session or policy compatibility test performed. Not used. |
| Claude CLI session create/resume | **Verified in both test Workspaces**: owned session, real scoped Notion tool write/readback and a second turn reusing that session. Native `sonnet`, low effort and strict JSON receipt schema. Message-only uses safe-mode; Notion mode uses strict MCP config and no built-in shell/file tools. `--bare` is not used because it skips native OAuth/keychain sign-in. |
| Codex thread/start, thread/resume and turn/start | **Verified**: a new owned session and a second turn in the same session returned matching receipt JSON. Native model discovery identified `gpt-5.6-sol` as available; low effort used. A requested `gpt-6.1-sol` turn was unavailable to this native account; it is not used as the default. |
| Codex Stop | **Verified**: a separate owned turn was interrupted immediately after delivery; it returned CANCELLED and no accepted reply. Durable pause/late-reply fencing/restart tests also pass with a scripted bridge. |
| Claude Stop | **Verified in both test Workspaces**: stopped after native delivery, cancelled without late accepted reply, later mentions blocked and scheduler restart retained pause without launching another turn. |
| Native Notion content tools | **Verified for both actors in both test Workspaces**: actual create/write/readback through MCP plus ledger evidence. Managed profiles expose 31 content/router tools, restrict reads to the bound Workspace and omit Messenger send tools. Destructive approval is stored in LV999; no model can self-approve. |
| Codex queue | Not advertised by this installed CLI's command list; do not depend on it. `queue --help` returned the root help rather than proving queue support. |
| Existing desktop chat synchronization | Unverified. Native MCP discovery does not establish control/synchronization of the Owner's currently open desktop conversations. |
| Automatic wake and binding | **Verified** for structured @ targets, owned sessions and same-session follow-up. Ordinary text/literal @ does not launch a turn. Busy-turn queue, explicit retry and late-reply fencing have regression coverage. The verified Windows CI app was opened and its native Content write/readback passed. |
| Task execution/completion | Scoped Notion content actions are implemented and independently verified. OS/project-command execution and full Supervisor recovery are not implemented; a consumption receipt is not a general task Done claim. |

Installed protocol schemas were generated locally and checked rather than assuming the current website exactly matched 0.144.1. For example this installation's status-list input does not have the documented newer `serverName` field, so the test isolates the profile instead of relying on that filter.

Primary references: [Claude MCP](https://code.claude.com/docs/en/mcp), [Claude Channels](https://code.claude.com/docs/en/channels), [Codex MCP](https://developers.openai.com/codex/mcp), [Codex App Server](https://developers.openai.com/codex/app-server). Local runtime results, not these links alone, establish the Verified rows.
