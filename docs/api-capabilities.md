# Notion API capability matrix

Checked 2026-11-16 against the [official endpoint index](https://developers.notion.com/llms.txt) and installed `@notionhq/client` 5.31.1 types. Every adapter instance explicitly sends `Notion-Version: 2026-03-11`; the SDK default is not used. “Official” means a documented API, not that LV999 has implemented or live-tested it.

| Official content API | LV999 engineering preview | Planned boundary |
|---|---|---|
| [Token bot identity](https://developers.notion.com/reference/get-self) (`GET /v1/users/me`) | Implemented; ID/name must match registration before content access | Missing identity fails closed |
| [Search](https://developers.notion.com/reference/post-search) (`POST /v1/search`) | Implemented; one exact workspace, page-only GUI browsing and cursor forwarding | Title search, not a complete workspace inventory |
| [Retrieve page](https://developers.notion.com/reference/retrieve-a-page) (`GET /v1/pages/:id`) | Implemented | Metadata/properties only; not the page tree |
| [Read blocks/children](https://developers.notion.com/reference/get-block-children) | Not implemented | Recursive pagination and unknown-block reporting in M1 |
| [Page properties](https://developers.notion.com/reference/retrieve-a-page-property) | Not implemented | Property-item pagination in M1 |
| [Create page](https://developers.notion.com/reference/post-page), [update page](https://developers.notion.com/reference/patch-page), [append blocks](https://developers.notion.com/reference/patch-block-children) | Disabled | Exact routing, validation, audit and idempotency in M1 |
| [Page markdown](https://developers.notion.com/reference/retrieve-page-markdown) | Not implemented | Read/update through a central adapter; unsupported content reported |
| [Databases](https://developers.notion.com/reference/retrieve-database) | Not implemented | Container metadata; data-source schema is separate |
| [Data-source schema](https://developers.notion.com/reference/retrieve-a-data-source), [query](https://developers.notion.com/reference/query-a-data-source) | Not implemented | Use data-source endpoints, not legacy database queries |
| [Create/update data sources](https://developers.notion.com/reference/create-a-data-source) | Disabled | Relation rebuilding needs a migration plan |
| [Views](https://developers.notion.com/reference/create-view) and [view queries](https://developers.notion.com/reference/create-view-query) | Not implemented | Recreate supported configurations; report fidelity gaps |
| [Move page](https://developers.notion.com/reference/move-page) | Disabled | Same-workspace ordinary pages only; never cross-workspace migration |
| [Comments](https://developers.notion.com/reference/list-comments) | Not implemented | Do not impersonate historical authors |
| [File upload lifecycle](https://developers.notion.com/reference/file-upload) | Not implemented | Upload/copy after SSRF, size and timeout controls |
| [Users](https://developers.notion.com/reference/get-users), [custom emojis](https://developers.notion.com/reference/list-custom-emojis) | Not implemented | Only if needed for content fidelity |
| [Trash page](https://developers.notion.com/reference/trash-page), [delete block](https://developers.notion.com/reference/delete-a-block) | Disabled | Destructive approval required |
| [OAuth token management](https://developers.notion.com/reference/authentication) | Not implemented | Internal Connections first; no reuse of connector credentials |
| Workspace creation/billing/admin | Outside this content integration | User creates workspaces in Notion |

The official Notion MCP has additional capabilities; those are not automatically public content API capabilities or LV999 tools. Agent, calendar, compliance and enterprise administration APIs are outside this bootstrap.

## Exposed MCP tools

`list_workspaces`, `verify_workspace`, `search_workspace`, `get_page`, `list_projects`, `resolve_project`. All return the shared result envelope (`ok`, `code`, workspace/project/resource identity, changes, warnings/errors, job, dry-run and approval fields). No Notion write tool or credential-management tool is registered. `list_projects` returns local configuration with historical validation time; `resolve_project` rechecks the exact workspace identity and active ordinary root page. GUI uses private process pipes; MCP uses the v2 SDK's stdio transport. GUI, CLI and MCP call the same `Service` and `Store`.


GUI-only management now also configures OAuth, starts/cancels the one-use localhost authorization callback, reports its safe status, and explicitly refreshes OAuth credentials. The token exchange uses only Notion's fixed official HTTPS endpoint. No general-purpose command execution or Notion content mutation was added.

The private management pipe additionally accepts `connect_workspace` and `reauthorize_workspace`. These accept transient token input from the native GUI, verify the actual identity and a read-only search, then save/read back the token through Windows Credential Manager. They are not MCP tools and do not change Notion content. `verify_workspace` also checks read access; an identity-only success does not count as Connected. Search returns only a first-batch sample for this diagnostic and cannot establish a full workspace inventory.

Management also exposes `browse_pages`, `inspect_page`, `save_project` and `resolve_project`. Browsing filters search to pages, forwards opaque cursors, reports omitted incomplete objects and refuses broken pagination. Exact page checks accept UUIDs or supported Notion HTTPS page links, extract only the ID, and call the fixed Notion API; arbitrary URLs are not fetched. Page summaries contain metadata only, not block content. Saving a mapping is a local SQLite change and makes only read-only Notion calls; it re-retrieves the proposed page and rejects archived/trash/record roots. Every project key is unique; revision matching prevents stale editors from overwriting mappings.

The pinned `2026-03-11` API removed `archived` from page responses. Normalization requires the current `in_trash` flag, without requiring `archived`; a supplied legacy `archived: true` also blocks root eligibility. Missing trash status is not treated as active. See the [official page schema](https://developers.notion.com/reference/page). Routing/GUI fixtures use the current response shape so synthetic tests cannot conceal this contract regression.

## Failure attribution

- `AUTH_REQUIRED`: no vault entry, or HTTP 401. Reauthorize this exact workspace.
- `FORBIDDEN`: HTTP 403. Check connection capabilities and page sharing.
- `NOT_FOUND_OR_NOT_SHARED`: HTTP 404. The API cannot distinguish a nonexistent object from one unavailable to this token. Never infer absence or try a different workspace's token.
- `WORKSPACE_MISMATCH`: token identity differs from the selected ID. Content request is blocked.
- `IDENTITY_UNAVAILABLE`: identity cannot be established. Content request is blocked.
- `WORKSPACE_EXISTS`: use the existing row's Reauthorize action; the credential is not silently replaced.
- `CONNECTION_BUSY`: another process holds this connection's short credential-save lease; wait and refresh.
- `LOCAL_SAVE_FAILED` / `VAULT_UNAVAILABLE`: no success is claimed; completed credential changes are compensated and read back when saving fails.
- `CREDENTIAL_STATE_UNCERTAIN`: compensation/readback could not confirm the prior credential. Existing positive verification is cleared; reconnect or reauthorize before use.
- `INVALID_RESPONSE`: incomplete page metadata or invalid/repeated pagination; refresh rather than treating the list as complete.
- `INELIGIBLE_ROOT`: a trashed/archived page, database record or unsupported parent cannot be this ordinary-page root.
- `UNKNOWN_PROJECT` / `AMBIGUOUS_TARGET`: no unique configured route was found. Ambiguous names fail before any credential/page read; exact keys do not fall back to similar names.
- `ROUTE_CONFLICT`: the revision changed before save or during resolution. Existing mappings are preserved; refresh and reopen/resolve again.
- `RATE_LIMITED` / `NETWORK_ERROR`: no success is fabricated. M0 disables SDK retries so requests remain bounded; shared retry/rate-limit policy belongs to M2.

See [official status codes](https://developers.notion.com/reference/status-codes) and [API versioning](https://developers.notion.com/reference/versioning). Contract tests inject fetch into the official SDK; they are not live Notion acceptance.
