# Ordinary project message boards — acceptance

Owner requested one ordinary Notion page per project, shared through Claude Code/Codex MCP, without automatic turns; explicitly included all five connected project Workspaces.

## Delivered state

| Key | Project | Board | Environment |
|---|---|---|---|
| BB | Blenderboo | 留言板 | Existing test connection |
| SB | Silverbench | 留言板 | Existing test connection |
| NX | Nihilux | 留言板 | Production target |
| KK | Kuru Kuru | 留言板 | Production target |
| CW | 公司狼 | 留言板 | Production target |

Each board is one ordinary child page under its verified project root, not a Notion database or local chat copy. BB/SB received new dedicated project roots under their already shared Getting Started parents and exact local mappings; templates and classifications were preserved. No source migration occurred. Runtime IDs and direct page links remain private local configuration.

The board-only profile exposes exactly `list_message_boards`, `read_message_board`, `post_message_board`. Grants select project keys; the sender is fixed by the client profile. Posting appends plain text plus an ISO UTC timestamp and sender label, with no earlier-block edit/delete, arbitrary page target, generic content tools or Messenger wake tools. Connection-role labels do not impersonate separate Notion user accounts.

Production general-write policies remain off. Registered board append permission is separate and explicitly shown in Workspaces/ Routing; only the exact board operation can use this limited capability. A paused, moved, trashed or rerouted board refuses posting. Normal content edits retain version checks; board append is merge-safe because it adds new blocks rather than overwriting prior content. Active writers use the existing leases and uncertain outcomes remain fenced.

## Observed verification

- **147 tests passed:** exact-page/role/project scope, one-page setup, repeated retry keys, message-body hash mismatch, competing appends, pause/move/route changes, unknown outcomes, no wake requests and Unicode chunk boundaries. Retry metadata stores hashes/version/time rather than message bodies.
- **Real Notion MCP:** both startup-bound client roles appended/read a clearly labelled installation-check message in every board. Identical-key retry added no second message. Ten successful role/project checks used actual Notion readback, with no model invocation. The visible test messages explicitly say they came from configuration checks, not model replies.
- **Both installed clients:** separate SDK and native MCP handshakes passed with exactly three tools. Their owned LV999 entries were applied to user configuration with byte-exact backups and unrelated settings preserved. Both saved entries detected Matching. No credentials were added to snippets, logs or repository files. Native clients need restart/reload to load this new profile into subsequent sessions; no existing model conversation was attached or restarted.
- **Automatic turns:** enabled/unpaused managed bindings, active turns and pending wakes were all zero after setup/readback. The board-only profile omits wake-capable tools; literal @ text in board posts did not create wake requests.
- **Native GUI:** Routing listed all five configured boards and copy/pause controls. Pause/resume of BB posting was exercised and restored. Workspaces explicitly separated general read-only production content from board append permissions. AI Clients recognized both saved configurations as Matching. The verified new app was left open on Routing; a normal Notion board was also opened and visually inspected.
- **Build:** Windows CI [44494031933](https://github.com/Rampageboo/LV999/actions/runs/44494031933) passed for runtime commit `34ac7491363eae98550e5030c947bbf8f420249e`; exact build-info and all nine SHA-256 artifact hashes matched. TypeScript/Vite/runtime build and staged vault/MCP smoke passed. Artifact integrity checking is not an Authenticode signature. No merge/release performed.

Current evidence applies to this Windows host and its installed native clients. Existing independent clean-Windows packaging and M2 background/recovery gates remain separate. Full supervisor execution, automatic polling/model dispatch and Notion comments are not part of this page-based workflow.
