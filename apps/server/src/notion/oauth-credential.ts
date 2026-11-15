import { z } from 'zod';
import { NOTION_VERSION } from '../../../../packages/contracts/src/index.js';
import { DomainError, type Identity } from './adapter.js';

const IdentitySchema = z.object({ workspace_id: z.uuid(), workspace_name: z.string().trim().min(1).max(200), bot_id: z.uuid() });
const Credential = z.object({ kind: z.literal('lv999-oauth-v1'), client_id: z.uuid(), access_token: z.string().min(1),
  refresh_token: z.string().min(1).nullable(), identity: IdentitySchema, owner_id: z.uuid().nullable() }).strict();
export type OAuthCredential = z.infer<typeof Credential>;
export type OAuthEvidence = { identity: Identity; owner_id: string | null };
export function decodeCredential(secret: string): { token: string; oauth?: OAuthCredential } {
  if (!secret.startsWith('{')) return { token: secret };
  try { const oauth = Credential.parse(JSON.parse(secret)); return { token: oauth.access_token, oauth }; }
  catch { throw new DomainError('AUTH_REQUIRED', 'The saved OAuth credential is invalid. Reauthorize this workspace.'); }
}
export function encodeCredential(value: OAuthCredential) {
  const secret = JSON.stringify(Credential.parse(value));
  // WinCred permits a 2560-byte blob. Store access + refresh + identity in one atomic credential.
  if (Buffer.byteLength(secret, 'utf16le') > 2560)
    throw new DomainError('VAULT_UNAVAILABLE', 'The OAuth credential exceeds the Windows vault limit. No connection was saved.');
  return secret;
}
export interface OAuthExchange {
  token(clientId: string, clientSecret: string, grant: { code: string; redirect_uri: string } | { refresh_token: string }, previous?: OAuthCredential): Promise<OAuthCredential>;
}
export class OfficialOAuthExchange implements OAuthExchange {
  constructor(private fetchImplementation: typeof fetch = fetch) {}
  async token(clientId: string, clientSecret: string, grant: { code: string; redirect_uri: string } | { refresh_token: string }, previous?: OAuthCredential): Promise<OAuthCredential> {
    try {
      const response = await this.fetchImplementation('https://api.notion.com/v1/oauth/token', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/json', 'Notion-Version': NOTION_VERSION },
        body: JSON.stringify({ grant_type: 'code' in grant ? 'authorization_code' : 'refresh_token', ...grant }),
      });
      if (!response.ok) throw new Error();
      const data = z.object({ access_token: z.string().min(1).max(2048), token_type: z.literal('bearer'),
        refresh_token: z.string().min(1).max(2048).nullable().optional(), workspace_id: z.uuid().optional(),
        workspace_name: z.string().nullable().optional(), bot_id: z.uuid().optional(),
        owner: z.object({ user: z.object({ id: z.uuid() }).passthrough().optional() }).passthrough().optional() }).parse(await response.json());
      const identity = IdentitySchema.parse({ workspace_id: data.workspace_id ?? previous?.identity.workspace_id,
        workspace_name: data.workspace_name ?? previous?.identity.workspace_name, bot_id: data.bot_id ?? previous?.identity.bot_id });
      if (previous && (identity.workspace_id !== previous.identity.workspace_id || identity.bot_id !== previous.identity.bot_id))
        throw new DomainError('WORKSPACE_MISMATCH', 'The refreshed token returned a different identity. Reauthorize this workspace.');
      return Credential.parse({ kind: 'lv999-oauth-v1', client_id: clientId, access_token: data.access_token,
        refresh_token: data.refresh_token ?? null, identity, owner_id: data.owner?.user?.id ?? previous?.owner_id ?? null });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      // Never surface token endpoint bodies, request codes, headers or arbitrary network errors.
      throw new DomainError('OAUTH_FAILED', 'Notion could not exchange the authorization. Check the OAuth client settings and authorize again.');
    }
  }
}
