# Windows CI preview and OAuth setup — 2026-11-16

The Owner explicitly approved publishing the branch, running Windows CI, opening the resulting preview and continuing OAuth. [Draft PR #1](https://github.com/Rampageboo/LV999/pull/1) is open; no merge, release tag or production deployment was performed.

## Build evidence

- Initial CI runs passed unit tests and resource builds but failed the real vault smoke assertion. An independent credential-free probe returned `ok: true` with Windows' expected not-found error. The full staged startup took longer than the initial ten-second helper budget. The startup probe budget was raised to thirty seconds, and smoke's startup wait to thirty-five; the actual vault success assertion was retained. Credential read/write operation budgets were not extended.
- [Run 43772160375](https://github.com/Rampageboo/LV999/actions/runs/43772160375) at `d52cb0f` then passed 108 tests, public-content scan, TypeScript/resources, real staged Node/MCP/vault smoke, Rust compilation, NSIS packaging and artifact upload. Rust's optimized build completed in 2m57s. Local Smart App Control/trust policy was not modified.
- An existing Owner-configured Internal Connection was discovered in the real GUI. A missing GUI upgrade path was fixed with **Switch to OAuth**. The added test verifies exact-target validation, preservation of the configured display name, replacement only after validation and a single group rather than a duplicate.
- [Run 43773044716](https://github.com/Rampageboo/LV999/actions/runs/43773044716) at runtime/UI commit `97f80010916d10988610ffc6f3a59038b3dd790a` passed **109 tests**, public scan, TypeScript/resources, real staged Node/MCP/vault smoke, native/NSIS build and artifact upload. Artifact: `LV999-windows-x64-43773044716`, retained for seven days.
- Downloaded into ignored `.tools/ci-builds/43773044716/`. Verified build-info commit/run and all **9 files** listed in SHA256SUMS. This checks artifact identity/integrity over the authenticated GitHub download, not an Authenticode signature.

| Artifact | SHA-256 |
|---|---|
| `portable/lv999-desktop.exe` | `db97069ec58f680cf454998a250ef7a5ac555d29dcb9e8615d9bde42e0a66887` |
| `installer/LV999_0.1.0_x64-setup.exe` | `0454703cb6e334fb6d8da60f05e93773f1ebdc33b0748c7badd1bd06da2272b9` |

## Native observation

The portable preview from that exact CI directory was opened on the Owner's Windows desktop. The native UI reported Node 26.13.1, Windows Credential Manager available, Running backend and a successful WebView2 IPC handshake. Workspaces displayed the Owner's existing connection and the new Switch to OAuth button. Connect with Notion opened the native-backed OAuth settings modal with the fixed `http://localhost:8765/oauth/notion/callback` redirect. Only the Owner-provided public client ID was filled, in runtime UI; no secret was revealed or copied through the agent.

The previous CI preview was closed normally through its own window, and both its exact application process and owned Node process were verified exited before the final preview was opened. The older pre-CI minimized app was not overwritten. The NSIS installer was built/downloaded but not installed over existing software; the opened application is the verified portable preview.

Native startup and the new setup/switch entry are now observed evidence. Earlier scripted wake/Notion flows remain scripted; this launch does not retroactively prove real OAuth exchange, dual-Workspace isolation, actual page sharing, Claude model authentication or full M1 acceptance.

## OAuth handoff

The current window is left at Connect with Notion with the public client ID filled and client secret empty. The Owner was asked to enter the existing app's secret directly in the local GUI and save, then complete consent for the test Workspaces. The existing Internal Connection and local chat history were retained. No real OAuth code exchange, new page grant or token refresh has been claimed successful. Once saved, authorize the new test Workspace and use Switch to OAuth for the existing one if desired; both require their own browser consent.

All Workspace/page/client identifiers and credentials remain runtime-only; no real Notion ID or secret was added to this public report. Vibecode/Honour content was not accessed. Further OAuth results must be recorded from the actual callback/identity/read response, not inferred from this prepared setup window.
