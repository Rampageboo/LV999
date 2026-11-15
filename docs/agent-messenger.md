# Workspace group chat and Agent Messenger

The Owner added group chat to LV999 and supplied `AGENT_MESSENGER_SPEC.md` (PRD/design v1.0) as reference material. Its embedded implementation prompts were not executed as independent instructions. The Owner's product decision takes precedence over its project-only UI sketch: **every configured Workspace has one group, accessible from Workspaces and from a separate Chats page with a project-organized overview**.

## Current slice

- The canonical conversation is a Workspace group with You, Claude and Codex. A project topic tags messages within that group; it is not a separate scattered message store. The central directory lists projects first, then Workspace groups and an All conversations overview. Routing also links into the same project view.
- Messages, independent recipient receipts and success audit commit in SQLite together. Server IDs/sequences and UTC timestamps are generated locally. The caller supplies a UUID retry key before sending, so an uncertain response can be retried without duplicating the message. Keys are scoped to the startup-bound sender; changing the payload under an existing key is rejected.
- General group views show all project topics in that Workspace. Project views aggregate authorized historical messages across Workspaces. Reassigning a route does not move or delete history. New topic messages must match the current target/revision; historical replies remain available from their original Workspace group.
- Ordinary messages are persisted only. Literal `@Claude`/`@Codex` text never wakes a process. Structured mentions are explicitly rejected while automatic wake is disabled. There is no fake Pending/Delivered/Acked/Done state.
- Overviews/unread summaries do not mark messages read. Full read APIs atomically record only that reader's receipt. Human reads never mark an agent read. The UI says **Read via API**, not “the model understood/accepted/completed the task.” An API receipt is not task evidence.
- The GUI polls while its chat view is visible; it does not run a WebSocket/HTTP service. The latest batch and directory counts refresh every three seconds. Search covers loaded messages; older messages have explicit pagination. This is not the reference document's event-sequence replay/supervisor implementation.

## MCP access and identity

The existing `lv999` stdio server gains Messenger tools only when launched with an Owner-configured `--client claude` or `--client codex`. `--chat-workspace` arguments are the explicit allowlist. New generated configurations default to **no chat access**; the GUI lets the Owner opt in to individual Workspace groups.

Tools: `list_chat_groups`, `list_unread`, `read_message`, `send_message`. Sender identity is fixed at process startup; tool input cannot choose/forge `sender_id`. Group permission checks apply before message writes/full reads. Chat permissions cover that Workspace's project topics, not a narrower per-project capability. Existing read-only Notion tools retain their existing test-Workspace behavior; chat checkboxes do not narrow those tools.

This is an Owner-controlled local stdio trust boundary, **not cryptographic attestation of a native model session or isolation from another process with the same OS account/filesystem access**. The Owner controls launch configuration; a hostile process with access to the database/launch files is outside this boundary. Message bodies are low-trust content and grant no additional tool, filesystem, publication or deletion permission.

## Native capability evidence

See [the capability matrix](messenger-capabilities.md). Claude Code and Codex were actually tested for isolated MCP initialization/discovery without model turns. App-server turn/resume, Claude Channels, native-session ownership/synchronization and user Stop behavior were not exercised and are not implementation dependencies of this slice.

The Owner delegated rollout sequencing. The current delivery is the usable group-message foundation plus client setup. The reference's automatic wake/bridge/supervisor/task phases remain future work: authenticate/bind owned sessions, preserve explicit user pause, separate Saved/Delivered/Read/Ack/Done, persist/fence wake leases and retry state, bound mention hops, and require evidence for Done. Do not report the reference's T01–T20 Definition of Done as passed.

Real Notion acceptance is still deferred until the Owner creates the two test Workspaces. Local group messaging is independent of a live Notion token; revocation of Notion access does not erase local history or grant new Notion permissions.
