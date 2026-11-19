# Production target Workspace onboarding

Owner request: support production Workspace environments and permissions, then authorize the newly created Nihilux, Kuru Kuru and 公司狼 Workspaces, map projects and create their group chats. No migration or access to Vibecode/Honour is authorized.

## Decisions

- Register each new space as `production`, separately from the two existing `test` connections. Production enrollment requires its expected Notion Workspace name; callback identity and ID remain mandatory. Reauthorization cannot silently change environments.
- Production starts read-only. Enabling writes requires an explicit exact-ID Owner confirmation, separate from OAuth capabilities, client startup write scope and managed-session tool access. Disabling writes works offline. Destructive approvals, routing revisions and retry fencing remain unchanged.
- Protected source names are normalized; once a source identity is encountered its ID stays protected even after renaming. No page search/read is sent for a protected identity.
- Project keys: Nihilux `NX`, Kuru Kuru `KK`, 公司狼 `CW`. Dedicated project home pages will be created in their respective new spaces through Notion's own UI, then specifically selected for OAuth and mapped locally. Existing templates remain intact. No global write policy is needed to create pages through the Owner's Notion session.
- New group and project topics use the existing persistent Messenger overview. No agent is automatically enabled/resumed and no quota-consuming model acceptance is needed for this environment/onboarding change.

## Verification gates

1. Production defaults, expected-name mismatch, environment preservation, protected source refusal, explicit write confirmation, offline disable, existing client/chat/CRUD regressions.
2. Source build and bundled runtime smoke; Windows CI/native build. Keep the old app from loading production registry rows until it has been replaced with the compatible version.
3. Real OAuth for exactly the three new spaces using the existing app secret in Windows Credential Manager, read-only page identity/root checks, exact mappings, one group per Workspace and project topics in the shared overview.
4. Existing test connections and user Stop states persist; production content writes remain off; no source migration, broad credential display or global client-config overwrite.

Private runtime IDs, consent receipts and page links remain outside the public repository. Final evidence must distinguish implementation/tests, real OAuth, mapping/group persistence and any remaining manual boundary.
