# Windows startup and confirmed updates

Runtime candidate: `aaaab101d6e685120d7dbf3e807bb9a700884e79`, Windows CI [44860105560](https://github.com/Rampageboo/LV999/actions/runs/44860105560), success. Follow-up `83476b5` changes documentation/release text only.

## Verified

- 141 tests passed, plus TypeScript, frontend/server/runtime packaging, public-data scan and Windows native/NSIS compilation. All ten downloaded artifact manifest entries matched SHA256; build-info matched the candidate commit.
- Installed the feature-bearing 0.1.9 acceptance bootstrap in the isolated LV999 application directory. The ordinary candidate version is 0.2.0; the bootstrap exists only to exercise a real upgrade without publishing two releases.
- Actual Settings enabled Windows startup, the current-user Run entry pointed at the stable installed executable, disabling removed it, and enabling restored it. Final startup registration is on. An actual Windows logout/login has not been performed.
- Disabling automatic checks persisted to disk and both settings appeared off after a clean close/relaunch. Both settings were then enabled. Final automatic-check preference is on. Checks happen at launch/every six hours, with explicit install/restart.
- Launching the installed executable again exited the second process and retained the first GUI PID. Clean window close terminated the owned management backend.
- Both existing user profiles were backed up and changed to the stable managed MCP launcher. Claude Code and Codex each passed SDK initialize/list/local read and actual native-client handshakes, with exactly three message-board tools. Seven project grants retained; no broad content-read/write or legacy chat scope was introduced. No model turn was started.
- Consistent SQLite backup completed before installation. Workspace, project-route and message-board rows retained their exact content digests (8/7/7). General Workspace write policies remained off; no DISPATCHING/UNKNOWN/UNVERIFIED content operations were present. No Notion content or credential was changed for this acceptance.
- Maintenance lease and immutable runtime/pointer behavior have automated coverage, including refusal of unresolved writes, ownership, tamper detection, changed backend/Node selection and real launcher subprocess execution.
- Existing ignored updater private key matches the pinned public key. A local fixture signed with app version 0.2.0 contained a version-bound signature; no key value was printed or uploaded.

## Deployment gate

At this checkpoint the repository has no published release and no Actions signing secret. A check cannot offer a working update from an empty channel; the native UI reported check failure without inventing an available version. The matching signing key must be provisioned to this repository's Actions and a signed normal release must be published after Owner approval. The release workflow deliberately creates a draft.

Real signed 0.1.9 → 0.2.0 download, signature verification, installer restart, settings retention and post-update MCP checks remain pending that deployment. Do not describe a merely configured endpoint as an accepted automatic-update channel. Private backup, screenshots and configuration receipts are retained outside this public repository.

## Deployment and real upgrade completed

The Owner subsequently approved signing-secret provisioning and public v0.2.0 deployment. The existing matching key was securely saved as this repository's `TAURI_SIGNING_PRIVATE_KEY`; no key value entered source or logs. Tag `v0.2.0` points to `b6b40477e372bb8875d244637b4f3a3c59d45a5c`; no branch was merged.

- [Release build 44862447807](https://github.com/Rampageboo/LV999/actions/runs/44862447807) passed. Downloaded draft installer/signature/latest.json were checked before publishing: the update URL matched this release's actual asset, installer size matched GitHub metadata, the package and trusted-comment signatures verified with the pinned key, and the signed version was exactly 0.2.0. Local negative controls rejected modified bytes and the wrong announced version.
- [v0.2.0](https://github.com/Rampageboo/LV999/releases/tag/v0.2.0) is published as the latest normal release. The official Action's update JSON uses the GitHub asset API URL; the installed updater downloads it with `Accept: application/octet-stream`. The installer remains without an Authenticode certificate; updater signing is a separate verification mechanism.
- In the installed 0.1.9 GUI, **Check for updates** offered 0.2.0. Clicking **Update to 0.2.0 & restart** downloaded the signed package, ran its installer and automatically reopened LV999. Native Settings and installed-package registration both reported 0.2.0. The new process automatically checked and showed **You have the latest version**.
- Both settings remained enabled. Startup registration still pointed at the stable installed executable; Windows StartupApproved reported enabled. The old GUI/owned management process exited, exactly one new GUI ran, and the update maintenance lease was recovered/cleared.
- A real MCP transport established before the update successfully called the local board-list tool after the upgrade using the same transport. New Claude and Codex sessions each passed SDK and native-client handshakes with exactly three board tools. Existing seven-project grants and stable profile paths were retained without reapplying user configurations.
- A fresh consistent backup preceded the signed upgrade. Exact row digests for Workspaces (8), routes (7), boards (7), and Workspace write policies (7) all matched afterwards. No pending/unknown/unverified writes or update lease remained. This acceptance changed no Notion content or credentials and started no model turn.

The real signed update channel is accepted. An actual Windows logout/login and a naturally elapsed six-hour interval were not exercised; startup OS registration/approval, settings persistence and automatic checking on the new process were observed. Private screenshots, signatures, integrity summaries and handshake receipts are retained outside this public repository.
