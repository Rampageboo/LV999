import { z } from 'zod';
import type { AccessiblePage, PageBatch } from '../../../../packages/contracts/src/index.js';
import { DomainError } from './adapter.js';

const Page = z.object({
  object: z.literal('page'), id: z.uuid(), properties: z.record(z.string(), z.unknown()),
  // 2026-03-11 removed archived; in_trash is still required. Keep a supplied legacy flag conservative.
  parent: z.object({ type: z.string() }), archived: z.boolean().optional(), in_trash: z.boolean(),
  last_edited_time: z.string().optional(),
});

export function pageMetadata(raw: unknown, workspaceId: string): AccessiblePage {
  const parsed = Page.safeParse(raw);
  if (!parsed.success) throw new DomainError('INVALID_RESPONSE', 'Notion did not return complete page metadata. Refresh or check the exact page.');
  const page = parsed.data;
  let title = '';
  for (const value of Object.values(page.properties)) {
    if (value && typeof value === 'object' && 'type' in value && value.type === 'title' && 'title' in value && Array.isArray(value.title)) {
      title = value.title.slice(0, 100).map(part => typeof part?.plain_text === 'string' ? part.plain_text :
        typeof part?.text?.content === 'string' ? part.text.content : '').join('').slice(0, 1000);
      break;
    }
  }
  const active = page.archived !== true && !page.in_trash;
  const ordinary = ['workspace', 'page_id'].includes(page.parent.type);
  const id = page.id.toLowerCase();
  return { workspace_id: workspaceId, id, title: title || 'Untitled',
    url: `https://www.notion.so/${id.replaceAll('-', '')}`, parent_kind: page.parent.type,
    last_edited_time: page.last_edited_time ?? null, root_eligible: active && ordinary,
    root_reason: !active ? 'Archived or trashed pages cannot be project roots.' :
      !ordinary ? 'Choose an ordinary page, not a database record or unsupported parent type.' : null };
}

export function pageBatch(raw: unknown, workspaceId: string, cursor?: string): PageBatch {
  const parsed = z.object({ results: z.array(z.unknown()).max(50), has_more: z.boolean(), next_cursor: z.string().min(1).max(200).nullable() }).safeParse(raw);
  if (!parsed.success || (parsed.data.has_more && (!parsed.data.next_cursor || parsed.data.next_cursor === cursor)))
    throw new DomainError('INVALID_RESPONSE', 'Notion returned invalid pagination. Refresh the page search before retrying.');
  const pages: AccessiblePage[] = [];
  let skipped_objects = 0;
  for (const item of parsed.data.results) {
    try { pages.push(pageMetadata(item, workspaceId)); } catch { skipped_objects++; }
  }
  return { pages, has_more: parsed.data.has_more, next_cursor: parsed.data.has_more ? parsed.data.next_cursor : null, skipped_objects };
}

export function pageReference(reference: string): string {
  let candidate = reference.trim();
  let fromUrl = false;
  if (/^https:\/\//i.test(candidate)) {
    let url: URL;
    try { url = new URL(candidate); } catch { throw new DomainError('INVALID_INPUT', 'Enter a page ID or a Notion HTTPS page link.'); }
    if (url.username || url.password || url.port || !['notion.so', 'www.notion.so'].includes(url.hostname))
      throw new DomainError('INVALID_INPUT', 'Use a notion.so HTTPS page link or its page ID. External URLs are not fetched.');
    candidate = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
    fromUrl = true;
  }
  const compact = fromUrl ? candidate.match(/(?:^|-)([0-9a-f]{32})$/i)?.[1] : candidate.match(/^([0-9a-f]{32})$/i)?.[1];
  if (compact) candidate = `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
  const parsed = z.uuid().safeParse(candidate);
  if (!parsed.success) throw new DomainError('INVALID_INPUT', 'Enter a valid page ID or a Notion page link ending in its ID.');
  return parsed.data.toLowerCase();
}
