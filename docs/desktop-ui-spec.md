# Milestone 0 desktop shell

The shell uses a generated primary-screen concept (built-in Image Gen, `ui-mockup`) as a visual reference: 220 px gray sidebar, white main canvas, charcoal Segoe UI, indigo actions, thin separators, no charts or fabricated metrics. The concept's unconditional green connection indicator was corrected to a pending state when test workspaces are absent. Data correctness takes precedence over illustrative sample status.

Tokens: accent `#4338b8`, text `#17171f`, secondary `#646575`, sidebar `#f3f4f8`, border `#dedee6`, setup strip `#eeedff`. The OS dark theme has corresponding dark surfaces and readable semantic colors. Controls have keyboard focus rings; navigation uses `aria-current`, errors use `role=alert`, and progress messages use `role=status`. The layout wraps at narrow widths and supports Windows scaling.

| Page | M0 behavior |
|---|---|
| Dashboard | Running process, runtime path/version, vault probe, registered versus verified count, native WebView2 IPC check, real activity |
| Workspaces | Local metadata, actual verification action, identity/time/error evidence; GUI enrollment disabled until M1 |
| Routing | Empty registry and disabled mapping action until M1 |
| Clients | Explicit Not tested; no claim from file presence; configuration disabled until M1 |
| Migration | No jobs; discovery/execution disabled until M3/M4 |
| Logs | Backend-generated safe events, no raw Notion responses or tokens |
| Settings | Actual identity/data/runtime/API configuration; autostart and remote access off; later settings disabled |

Refresh asks the native host for a fresh backend snapshot. On failure the shell clears the previous snapshot and shows Backend unavailable, so stale green status cannot survive a failed refresh. Workspace checks are timestamped, last-known identity evidence; the app does not poll Notion or claim continuing live connectivity. The frontend never calls Notion, accesses SQLite, or receives credentials.

Concept brief: “LV999 Windows console, complete dashboard with seven named navigation pages, backend status, test-workspace setup strip, four first-run diagnostic rows, empty workspaces and recent activity. Practical code-native controls, no invented metrics, restrained Segoe UI/gray/indigo system.” This is a shell for engineering acceptance, not a completed M1 management flow.
