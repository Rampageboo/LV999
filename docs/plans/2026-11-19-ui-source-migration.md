# LV999 Workspace, custom window chrome and all-project migration

Owner request: connect the newly created LV999 Workspace, place the next-step plan there, upgrade/clean the UI, replace Windows default chrome with a custom title bar and begin moving all Vibecode projects to their corresponding Workspaces. Owner also approved creating a free single-member AutoHoyo Workspace and assigning the separate IPC Wolf planning page to 公司狼.

## Execution boundaries

- Preserve existing roots/boards, client scopes and disabled automatic turns. Add a dedicated LV999 project home/plan and AutoHoyo target without changing unrelated environments or credentials.
- UI keeps the existing visual system and information architecture. Replace native decorations with a draggable caption and minimize/maximize/restore/close controls; remove static development/acceptance narration, move technical diagnostics to Settings, retain permission/loss/error warnings.
- Vibecode becomes an explicit read-only source role. Writes stay denied even for Owner, limited board capabilities and startup write scopes; it cannot be a project destination. Honour stays protected. Source OAuth consent is separate from application hard read-only enforcement.
- Fresh read-only MCP discovery confirmed five registered software projects, 31 Issues and 4 Releases. Shared data sources must be partitioned by project relations; these counts are discovery evidence, not migration success. Standalone pages and project records are distinct and both must be discovered.
- Migration is copy-first: discovery, encrypted private snapshot/checkpoint, exact target/risk preview, concrete approval, staged copy, ID mapping/relinking and verification. Source deletion/archive and routing replacement remain separate explicit actions. Unsupported content must never be silently lost, nor all shared rows replicated into every target.
- Source data/IDs, snapshots and credential references stay outside this public repository. Backups must be encrypted and recoverable; UI metadata contains hashes/counts/status. Unknown writes never retry with a new key.
- No project scope list exists. Coupled contracts/window/permission changes are integrated here; no new threads are created.

## Delivery gates

1. Source role read/write isolation and existing test/production/board regressions.
2. Frameless Windows build; native drag/double-click/maximize/restore/minimize/close checks and cleaned UI screenshots.
3. Real LV999/AutoHoyo target enrollment, exact roots and next-step Notion plan; no invites, paid plan or automatic model turn.
4. Source snapshot/plans covering AH/BB/KK/NX/SB plus approved CW source page; pagination, dependencies, files and version checks before copy.
5. Progress/reporting distinguishes verified objects from unsupported, missing-target or permission-blocked ones. No fake completion or destructive source cleanup.
