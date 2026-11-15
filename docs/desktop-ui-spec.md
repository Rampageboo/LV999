# Desktop shell and Workspace connection flow

The shell uses a generated primary-screen concept (built-in Image Gen, `ui-mockup`) as a visual reference: 220 px gray sidebar, white main canvas, charcoal Segoe UI, indigo actions, thin separators, no charts or fabricated metrics. The concept's unconditional green connection indicator was corrected to a pending state when test workspaces are absent. Data correctness takes precedence over illustrative sample status.

Tokens: accent `#4338b8`, text `#17171f`, secondary `#646575`, sidebar `#f3f4f8`, border `#dedee6`, setup strip `#eeedff`. The OS dark theme has corresponding dark surfaces and readable semantic colors. Controls have keyboard focus rings; navigation uses `aria-current`, errors use `role=alert`, and progress messages use `role=status`. The layout wraps at narrow widths and supports Windows scaling.

| Page | Current behavior |
|---|---|
| Dashboard | Running process, runtime path/version, vault probe, registered versus verified count, native WebView2 IPC check, real activity |
| Workspaces | Internal-token or browser OAuth connect/reauthorize, explicit OAuth refresh, read verification; page-title search, pagination and exact page inspection; credentials stored by the backend in Windows Credential Manager |
| Routing | Filter/add/edit exact key→workspace→root mappings, inspect/select roots, warn on duplicate names, live-check routes and reject ambiguous name resolution |
| Clients | User-scope configuration/version detection, credential-free snippets and separate SDK/native isolated handshake evidence; no automatic global-file overwrite |
| Chats | Familiar group-chat layout: project/Workspace conversation directory, message bubbles, participant names/avatars, compact read hints and a composer fixed below the scrolling timeline |
| Migration | No jobs; discovery/execution disabled until M3/M4 |
| Logs | Backend-generated safe events, no raw Notion responses or tokens |
| Settings | Actual identity/data/runtime/API configuration; autostart and remote access off; later settings disabled |

Refresh asks the native host for a fresh backend snapshot. On failure the shell clears the previous snapshot and shows Backend unavailable, so stale green status cannot survive a failed refresh. Workspace checks are timestamped, last-known identity evidence; the app does not poll Notion or claim continuing live connectivity. The frontend never calls Notion, accesses SQLite, or receives credentials.

Concept brief: “LV999 Windows console, complete dashboard with seven named navigation pages, backend status, test-workspace setup strip, four first-run diagnostic rows, empty workspaces and recent activity. Practical code-native controls, no invented metrics, restrained Segoe UI/gray/indigo system.” This is a shell for engineering acceptance, not a completed M1 management flow.

The Workspace modal extends this established system without a redesign. It uses an uncontrolled password field, an optional display name and mandatory test-workspace confirmation. Submission clears the password field immediately; cancel/escape discards it. Native modal focus stays inside the dialog. During verification/saving, controls and dismiss actions are disabled to avoid an ambiguous cancellation after persistence has started. Failures show fixed error messages and require re-entry of the token. Reauthorization displays the existing immutable target ID; no ID is requested for a new connection.

Connected now requires identity plus a successful read-only search. Zero returned objects gets a sharing/indexing warning. The count is a first-batch sample of at most 50 objects, not a complete inventory or proof that a particular root page is shared. Disconnect and content CRUD remain later work.

The shared page browser loads one search batch at a time, deduplicates IDs when loading more, clears old results on a new query, and ignores responses from a previous workspace. Exact link/ID lookup is available when indexing omits a newly shared page. Inspecting shows ID, canonical Notion URL, parent type and edit time; it is not a page-content editor. Metadata is rendered as text, with no external media or HTML execution.

The route editor uses an immutable key on edits, explicit workspace selection and an inspected root. Switching workspaces clears the selected root. Root eligibility is checked in both UI and backend; the backend retrieves the page again on save. The editor's actions remain visible while its long page list scrolls. Saved validation is dated configuration evidence; Check route displays a separate fresh result. Duplicate names are allowed under distinct keys but produce warnings and cannot resolve by name. Revision conflicts retain the current saved mapping and require reopening the editor. Removing mappings is outside this slice.

The Owner requested an ordinary chat interface. Workspace and Routing shortcuts navigate to this same Chats screen; they do not create separate message copies. All conversations remains a visible overview, with projects first and every Workspace group listed even when it has no projects/messages. Group history and project filtering use the same records. Client MCP configuration/handshake diagnostics stay on Clients. Chat shows compact participant/time/read/wake state and an Agent sessions dialog. That dialog opts into Workspace defaults or project overrides, displays the managed session, and provides explicit Stop/Resume with native sign-in guidance.

The composer supports Enter to send and Shift+Enter for a newline. Reply previews are inline; messages from You align right and agent messages left. The timeline scrolls independently while the input stays visible. Unread previews do not mark agents read. Human full-body retrieval records only a human API receipt; receipt details do not imply model/task completion. Clipboard denial falls back to selecting generated configuration text.

Typing @ offers a menu; only explicitly selected wake chips trigger native turns. Plain text does not. Message wake chips distinguish queued/starting/working/acknowledged/stopped/blocked, with an explicit Retry on cancelled/blocked attempts. Stop never auto-resumes after a new mention, acknowledgement or restart. A native reply is conversational only and grants no project tool permission.

Connect with Notion configures one OAuth app and authorizes Workspaces individually in the browser. Client secret input is uncontrolled and cleared on save. The modal displays the exact localhost redirect, test confirmation, progress and safe verification result. Waiting can be cancelled; exchange/save cannot be ambiguously cancelled midway. A mismatched reauthorization preserves the previous target. A missing shared page produces a warning. These new flows passed isolated frontend/backend testing; the changed native Rust binary remains unbuilt because Smart App Control blocked compiler dependency DLLs.
