# Milestone 0 boundaries

- Only test workspace registrations are accepted; labels and live identities named Vibecode/Honour are blocked. A developer must explicitly assert `--test`; this does not magically identify every possible renamed production workspace.
- Tokens stay in Windows Credential Manager and transient backend memory. The developer enrollment prompt uses SecureString; tokens are never command-line arguments, repository fixtures, environment configuration or SQLite fields. GUI/MCP cannot enumerate or retrieve credentials.
- Each content request resolves an exact registered ID, obtains only its credential, calls `/users/me`, compares the returned workspace ID, and blocks content access on mismatch or unavailable identity. No fallback credential or cross-space guessing exists.
- Notion calls are centralized in the official SDK adapter with a fixed API version/base endpoint and disabled logger. Errors are mapped to fixed messages; untrusted API error bodies are discarded. Audit stores time, action, workspace ID, level and error code, not search text or page bodies.
- Management uses private parent/child pipes, with an allowlist of snapshot and verification requests and a bounded host wait. No HTTP port is bound. Notion content cannot execute commands. The frontend has restrictive CSP and no shell/filesystem/network plugins.
- Node is bundled, SHA-256 verified against the official distribution manifest and invoked by absolute path. Checksums downloaded from the same HTTPS origin protect against corruption; this is not an independent signature verification of Node. The host removes `NODE_OPTIONS` and `NODE_PATH` from the child environment.
- SQLite WAL and a busy timeout support read-only bootstrap concurrency. Job leases, write conflict handling, migration approval, idempotency and append-only write auditing are future gates, not implemented claims.
- The registry and timestamps are local user metadata. The local account can edit them; this is not an OS-user isolation or tamper-proof audit product. No remote access is supported in M0.

Do not treat M0 as production-ready or interpret simulated adapter tests as real Notion acceptance. No production credential was read for this milestone.
