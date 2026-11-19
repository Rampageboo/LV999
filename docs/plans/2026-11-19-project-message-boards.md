# Ordinary Notion pages as project message boards

Owner request: one ordinary Notion message-board page per project, read/write through Claude Code and Codex MCP, with no automatic turn triggering. The Owner clarified that all five connected project Workspaces are included.

## Scope and choices

- Existing NX/KK/CW routes keep their production classifications and global content-write policy stays off. BB/SB receive project roots and mappings in their existing test connections; no automatic environment promotion or source migration.
- Create one `留言板` child under each exact project root, with idempotent setup and Notion readback. The existing OAuth grants cover the authorized roots/descendants; do not request broader OAuth access.
- A board-only MCP profile exposes exactly `list_message_boards`, `read_message_board`, `post_message_board`. Grants are startup-bound project keys and connection roles. There is no wake/send-message tool, shell access or generic content write surface in this profile.
- Posting appends timestamped plain text to the registered page only. It cannot edit/delete prior messages, choose another page, create arbitrary content or enable global Workspace writes. Message bodies are not duplicated in local retry metadata. Retries reuse the same key; unknown outcomes remain fenced.
- Board append is merge-safe with unrelated edits: it never replaces existing blocks. Local leases serialize active writers; a busy request can be retried with its original key. All other content operations retain their version checks.
- Apply the scoped LV999 entry to both native clients, preserving unrelated settings and byte-exact backups. New configuration requires native MCP reload/new session. Do not launch model turns for validation or enable managed native bindings.
- Keep setup and posting controls on Routing and profile selection in AI Clients. Notion remains the message store and normal editing surface; no additional chat/supervisor workflow is introduced.

## Completion evidence

Test exact-page permissions, role/scope denial, setup deduplication, changed/moved/paused boards, competing appends, retry-key conflicts, unknown outcomes, Unicode boundaries and zero wake requests. Verify actual pages and board-only MCP reads/appends, clearly label any installation-check messages as checks rather than model replies. Verify both installed client handshakes, saved config preservation, no global production-write enablement and no native model turns. Build/verify Windows artifact and observe the final native GUI. Runtime IDs and private configuration backups stay outside this public repository.

## Outcome

All five boards, exact mappings and both client profiles are configured. Both connection roles performed real read/append and deduplicated retries in every board; installed-client handshakes exposed exactly three tools. Global production writes and automatic turns remained off. Windows CI/runtime hashes, native Routing/pause/permission UI, saved config Matching and the actual ordinary Notion page were verified. See [acceptance evidence](../qa/2026-11-19-message-boards.md). The new app and a board page are open; native clients need restart/reload for their new MCP entry. No source migration, global environment promotion or model turn was performed.
