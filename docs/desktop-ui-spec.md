# Desktop shell and Workspace connection flow

The shell uses a generated primary-screen concept (built-in Image Gen, `ui-mockup`) as a visual reference: 220 px gray sidebar, white main canvas, charcoal Segoe UI, indigo actions, thin separators, no charts or fabricated metrics. The concept's unconditional green connection indicator was corrected to a pending state when test workspaces are absent. Data correctness takes precedence over illustrative sample status.

Tokens: accent `#4338b8`, text `#17171f`, secondary `#646575`, sidebar `#f3f4f8`, border `#dedee6`, setup strip `#eeedff`. The OS dark theme has corresponding dark surfaces and readable semantic colors. Controls have keyboard focus rings; navigation uses `aria-current`, errors use `role=alert`, and progress messages use `role=status`. The layout wraps at narrow widths and supports Windows scaling.

| Page | Current behavior |
|---|---|
| Dashboard | Running process, runtime path/version, vault probe, registered versus verified count, native WebView2 IPC check, real activity |
| Workspaces | Connect/verify/reauthorize test workspaces; actual ID/name and timestamped read-access evidence; credentials stored by the backend in Windows Credential Manager |
| Routing | Empty registry and disabled mapping action until M1 |
| Clients | Explicit Not tested; no claim from file presence; configuration disabled until M1 |
| Migration | No jobs; discovery/execution disabled until M3/M4 |
| Logs | Backend-generated safe events, no raw Notion responses or tokens |
| Settings | Actual identity/data/runtime/API configuration; autostart and remote access off; later settings disabled |

Refresh asks the native host for a fresh backend snapshot. On failure the shell clears the previous snapshot and shows Backend unavailable, so stale green status cannot survive a failed refresh. Workspace checks are timestamped, last-known identity evidence; the app does not poll Notion or claim continuing live connectivity. The frontend never calls Notion, accesses SQLite, or receives credentials.

Concept brief: “LV999 Windows console, complete dashboard with seven named navigation pages, backend status, test-workspace setup strip, four first-run diagnostic rows, empty workspaces and recent activity. Practical code-native controls, no invented metrics, restrained Segoe UI/gray/indigo system.” This is a shell for engineering acceptance, not a completed M1 management flow.

The Workspace modal extends this established system without a redesign. It uses an uncontrolled password field, an optional display name and mandatory test-workspace confirmation. Submission clears the password field immediately; cancel/escape discards it. Native modal focus stays inside the dialog. During verification/saving, controls and dismiss actions are disabled to avoid an ambiguous cancellation after persistence has started. Failures show fixed error messages and require re-entry of the token. Reauthorization displays the existing immutable target ID; no ID is requested for a new connection.

Connected now requires identity plus a successful read-only search. Zero returned objects gets a sharing/indexing warning. The count is a first-batch sample of at most 50 objects, not a complete inventory or proof that a particular root page is shared. Root browsing, disconnect, routing and client configuration remain later work.
