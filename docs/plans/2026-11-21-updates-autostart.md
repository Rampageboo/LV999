# Updates and Windows startup

Owner request: automatic updates and launch at Windows login.

- Native Settings reads/writes the actual current-user startup registration, under the new application ID. Enable only from an installed path. A single-instance plugin prevents duplicated GUI/management backends.
- Automatic update checks use the existing pinned public key and repository endpoint. Checks do not install. Installation is explicit, verifies the updater signature, refuses in-flight/unknown/unverified writes and holds a shared maintenance lease that blocks new dispatch. The Windows updater exit callback reaps the owned management backend.
- Existing MCP sessions keep their immutable runtime. New sessions use a fixed managed launcher, which selects only complete, hash-verified runtime bundles. Updating the GUI must not leave client configurations pointing at disposable CI artifacts or lock installer-owned Node binaries.
- Source originals, Notion credentials, project routes, boards and migration evidence are unaffected. No automatic model turns or removed chat/wake features are restored.
- Prepare Windows CI and a reviewable installer first. Public updater deployment requires provisioning the existing matching signing key to this repository's Actions and publishing a signed normal release; neither a bare endpoint nor an unsigned preview is a working update channel.

Acceptance: actual startup enable/disable/readback, relaunch and duplicate-launch checks; stable MCP entry selects a changed bundle; maintenance blocks new writes and unresolved outcomes block install; real signed-package update and restart when the release channel is authorized and provisioned. Do not claim an actual Windows login test without observing one.
