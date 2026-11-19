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

After explicit Owner confirmation of the existing app's capabilities, all three OAuth grants completed. Only the respective new project home was selected in each grant; default templates and system pages remained unchecked. Each callback verified the expected name and real identity and saved a separate credential in Windows Credential Manager. The app's Notion capability grant is distinct from LV999's local read-only policy; all three production write policies remain off.

One unintended additional free, single-member Workspace containing only default templates was created during the UI flow. After explicit Owner permission, its exact ID was rechecked in General settings, its name entered in the permanent-deletion confirmation, and deletion completed. The Workspace menu returned to eight entries with exactly one original same-name Workspace retained. The extra space was never connected to LV999. The original space was not modified, no members were invited and no paid trial was selected.

Automatic approval review initially rejected the conditional mapping writer while consent was pending; it did not run then. After Owner confirmation and observed successful OAuth for all targets, the explicitly described mapping write was approved and executed. It verified each identity/root, refused conflicting route replacement, and saved and resolved the exact mappings:

| Project | Workspace | Root | Environment / policy |
|---|---|---|---|
| NX | Nihilux | Nihilux | Production / read-only |
| KK | Kuru Kuru | Kuru Kuru | Production / read-only |
| CW | 公司狼 | 公司狼 | Production / read-only |

Real MCP checks against the final artifact verified that legacy clients cannot read any of the new production roots, an explicit empty scope exposes no Workspaces, and explicit target scopes can read the roots and resolve the matching routes. A read-only client's mutation **preview** was rejected before mutation; no content mutation tool was executed and the mutation ledger count stayed unchanged. No production content was edited beyond the three authorized project home pages created earlier through Notion UI.

The native app was restarted after confirming zero active native turns. It retained five Connected Workspaces, three production targets, all three routes and five persistent Workspace groups. Routing → project chat, Workspaces → group chat and the standalone Chats overview were exercised. The overview displayed NX/KK/CW and all five groups; the app was left open there. No message or quota-consuming native turn was started, no existing user session was attached, and no global client configuration was changed.

## CI cold-start boundary

The documentation-only head check hit the unchanged vault availability assertion twice. In the retry, the independent CredRead probe returned success with native error 1168 after 6.74 seconds; the isolated management process returned a failed probe after approximately 30 seconds. Runtime commit d967af4 passed the same full checks independently.

The startup-only probe budget was changed from 30 to 45 seconds and the smoke startup wait from 35 to 50 seconds. Both remain bounded below native IPC's 60-second deadline; actual credential reads/writes retain 10 seconds. The vault assertion is unchanged. Final Windows CI [44483649923](https://github.com/Rampageboo/LV999/actions/runs/44483649923) passed for runtime commit `80396425da29f2e4787bdc1483cbee5e23af17c4`. Exact build-info and all nine artifact hashes matched; this verified build was opened and used for completed onboarding and restart acceptance. Hash checking establishes authenticated artifact integrity, not an Authenticode signature. No merge or release was performed.
