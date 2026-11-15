import { Client, isNotionClientError } from '@notionhq/client';
import { NOTION_VERSION, type ErrorCode } from '../../../../packages/contracts/src/index.js';
import type { OAuthEvidence } from './oauth-credential.js';

export class DomainError extends Error {
  constructor(readonly code: ErrorCode, message: string) { super(message); }
}
export type Identity = { workspace_id: string; workspace_name: string; bot_id: string };
export interface NotionAdapter {
  identity(): Promise<Identity>;
  search(query: string, cursor?: string, pagesOnly?: boolean): Promise<unknown>;
  page(id: string): Promise<unknown>;
}
// Only explicitly allowed read endpoints are exposed. No arbitrary URLs or raw request method.
export class OfficialNotionAdapter implements NotionAdapter {
  private client: Client;
  constructor(secret: string, fetchImplementation?: typeof fetch, private oauth?: OAuthEvidence) {
    this.client = new Client({ auth: secret, notionVersion: NOTION_VERSION, timeoutMs: 15000, retry: false,
      logLevel: undefined, logger: () => {}, ...(fetchImplementation ? { fetch: fetchImplementation } : {}) });
  }
  async identity(): Promise<Identity> {
    const me = await this.client.users.me({});
    if (this.oauth) {
      const expected = this.oauth.identity;
      if (me.type === 'person' && this.oauth.owner_id && me.id === this.oauth.owner_id) return expected;
      if (me.type === 'bot' && me.id === expected.bot_id &&
        (!me.bot.workspace_id || me.bot.workspace_id.toLowerCase() === expected.workspace_id.toLowerCase()))
        return { ...expected, workspace_name: me.bot.workspace_name || expected.workspace_name };
      throw new DomainError('WORKSPACE_MISMATCH', 'The OAuth token identity no longer matches its authorization. Reauthorize this workspace.');
    }
    if (me.type !== 'bot' || !me.bot.workspace_id || !me.bot.workspace_name)
      throw new DomainError('IDENTITY_UNAVAILABLE', 'The token did not expose a verifiable workspace identity.');
    return { workspace_id: me.bot.workspace_id.toLowerCase(), workspace_name: me.bot.workspace_name, bot_id: me.id };
  }
  search(query: string, cursor?: string, pagesOnly = false) {
    return this.client.search({ query, page_size: 50, start_cursor: cursor,
      ...(pagesOnly ? { filter: { property: 'object' as const, value: 'page' as const } } : {}) });
  }
  page(id: string) { return this.client.pages.retrieve({ page_id: id }); }
}
export function safeError(error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  if (error instanceof Error && 'code' in error && String(error.code).startsWith('ERR_SQLITE'))
    return new DomainError('LOCAL_SAVE_FAILED', 'The local connection registry is unavailable. Check disk access and refresh before retrying.');
  if (isNotionClientError(error)) {
    switch (error.code) {
      case 'unauthorized': return new DomainError('AUTH_REQUIRED', 'The connection token is missing, expired or revoked. Reauthorize this workspace.');
      case 'restricted_resource': return new DomainError('FORBIDDEN', 'This connection lacks permission. Check its content capabilities and page sharing.');
      case 'object_not_found': return new DomainError('NOT_FOUND_OR_NOT_SHARED', 'The object does not exist or is not shared with this workspace connection. A 404 cannot distinguish these cases.');
      case 'rate_limited': return new DomainError('RATE_LIMITED', 'Notion rate limit reached. Wait before retrying.');
    }
  }
  return new DomainError('NETWORK_ERROR', 'Notion could not be reached. Check network access and retry; no content was changed.');
}
