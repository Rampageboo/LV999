# Production target environment and onboarding

## Engineering evidence

- 139 unit/contract tests passed, including actual in-memory MCP initialize/call checks for legacy test-only reads, explicitly scoped production reads, an explicitly empty scope, write denial and independent Workspace policy.
- Production enrollment checks expected Notion name and exact returned identity. Reauthorization preserves environment. New production connections are read-only; enabling writes requires an exact-ID Owner confirmation, while disabling writes works offline.
- Protected source names use Unicode normalization, and encountered protected IDs remain blocked after renaming. Tests verify rejection before page access. Vibecode/Honour content was not read or migrated.
- Client generation, SDK handshake and installed Claude/Codex isolated handshake passed. New profiles always encode explicit content read scope; legacy unscoped profiles retain test-only access. No global client configuration was overwritten and no native model turn was started.
- Windows CI [44479831945](https://github.com/Rampageboo/LV999/actions/runs/44479831945) passed for the initial environment implementation. CI [44481838927](https://github.com/Rampageboo/LV999/actions/runs/44481838927) passed for runtime commit `d967af43b7e6004c164d1a45bcda89d3520fb5d6`, including explicit production read scopes. Its exact build-info identity and all 9 artifact SHA-256 hashes matched. The verified portable opened with the two existing test connections preserved, vault/native IPC healthy, and separate read/write/chat controls observed in the native GUI.
- A consistent local registry backup was taken before production enrollment. Existing native bindings were checked before replacing the runtime; no active turn was interrupted or resumed.

## Real onboarding state

Dedicated top-level project home pages were created through the Owner's Notion UI in the three authorized new targets. Existing Getting Started/To Do List templates were preserved. Project keys are NX, KK and CW. Runtime Workspace/page IDs and consent URLs remain in private local evidence, outside this repository.

Production OAuth is paused before final Allow access, pending confirmation of the existing OAuth app's capabilities. Only each target's new project home is intended for sharing. The app's broad Notion capabilities are distinct from LV999's local default read-only policy. No production credential, mapping or group acceptance is claimed yet. No production content write policy has been enabled.

One unintended additional free, single-member Workspace containing only default templates was created during the Notion UI flow. It was distinguished from the original same-name Workspace by its exact ID, was not connected to LV999, and awaits explicit Owner confirmation before permanent deletion. The original Workspace was not modified. No members were invited and no paid trial was selected.

The mapping helper is prepared to verify each exact registered production identity and created root, refuse route replacement, save NX/KK/CW and verify persistent Workspace groups/project topics without starting agents. Automatic approval review rejected running that conditional writer as a purported read-only status check while consent remained pending. It did not run; final mapping verification remains pending consent.

## CI cold-start boundary

The documentation-only head check hit the unchanged vault availability assertion twice. In the retry, the independent CredRead probe returned success with native error 1168 after 6.74 seconds; the isolated management process returned a failed probe after approximately 30 seconds. Runtime commit d967af4 passed the same full checks independently.

The startup-only probe budget was changed from 30 to 45 seconds and the smoke startup wait from 35 to 50 seconds. Both remain bounded below native IPC's 60-second deadline; actual credential reads/writes retain 10 seconds. The vault assertion is unchanged. Local bundled-runtime smoke passed after this adjustment; the final Windows check must be reported separately rather than inferred from local success.
