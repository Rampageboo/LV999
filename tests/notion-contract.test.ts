import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { OfficialNotionAdapter, safeError } from '../apps/server/src/notion/adapter.js';
import { NOTION_VERSION } from '../packages/contracts/src/index.js';

it('pins the API version and verifies workspace ID/name using the official /users/me endpoint', async () => {
  const id = randomUUID(); const calls: Request[] = [];
  const fetchMock: typeof fetch = async (input, init) => {
    const request = new Request(input, init); calls.push(request);
    return Response.json({ object: 'user', id: randomUUID(), type: 'bot', bot: { owner: { type: 'workspace', workspace: true }, workspace_id: id, workspace_name: 'Test Alpha' } });
  };
  const adapter = new OfficialNotionAdapter(randomUUID(), fetchMock);
  expect(await adapter.identity()).toMatchObject({ workspace_id: id, workspace_name: 'Test Alpha' });
  expect(calls[0].url).toBe('https://api.notion.com/v1/users/me');
  expect(calls[0].headers.get('Notion-Version')).toBe(NOTION_VERSION);
  expect(calls[0].method).toBe('GET');
});
it.each([
  [401, 'unauthorized', 'AUTH_REQUIRED'],
  [403, 'restricted_resource', 'FORBIDDEN'],
  [404, 'object_not_found', 'NOT_FOUND_OR_NOT_SHARED'],
  [429, 'rate_limited', 'RATE_LIMITED'],
] as const)('attributes HTTP %s without reflecting secret-bearing API errors', async (status, code, expected) => {
  const secret = randomUUID();
  const adapter = new OfficialNotionAdapter(secret, async () => Response.json({ object: 'error', status, code, message: secret }, { status }));
  try { await adapter.identity(); throw new Error('Request unexpectedly succeeded'); }
  catch (error) {
    const failure = safeError(error); expect(failure.code).toBe(expected); expect(failure.message).not.toContain(secret);
    if (status === 404) expect(failure.message).toContain('cannot distinguish');
  }
});
it('forwards search pagination without exposing a generic HTTP or write surface', async () => {
  let body: unknown;
  const adapter = new OfficialNotionAdapter(randomUUID(), async (input, init) => {
    const request = new Request(input, init); body = await request.json();
    expect(request.url).toBe('https://api.notion.com/v1/search');
    return Response.json({ object: 'list', results: [], has_more: false, next_cursor: null });
  });
  await adapter.search('test query', 'test-cursor');
  expect(body).toEqual({ query: 'test query', page_size: 50, start_cursor: 'test-cursor' });
  expect('request' in adapter).toBe(false); expect('createPage' in adapter).toBe(false);
});
it('fails closed when workspace identity is unavailable', async () => {
  const adapter = new OfficialNotionAdapter(randomUUID(), async () => Response.json({ object: 'user', type: 'bot', bot: {}, id: randomUUID() }));
  await expect(adapter.identity()).rejects.toMatchObject({ code: 'IDENTITY_UNAVAILABLE' });
});
it('filters accessible-page search through the official SDK and retrieves only the exact requested page', async () => {
  const id = randomUUID(), requests: Request[] = [];
  const adapter = new OfficialNotionAdapter(randomUUID(), async (input, init) => {
    const request = new Request(input, init); requests.push(request);
    return Response.json(request.method === 'GET' ? { object: 'page', id } : { results: [], has_more: false, next_cursor: null });
  });
  await adapter.search('Root', 'next-batch', true); await adapter.page(id);
  expect(await requests[0].json()).toEqual({ query: 'Root', page_size: 50, start_cursor: 'next-batch', filter: { property: 'object', value: 'page' } });
  expect(requests[1].url).toBe(`https://api.notion.com/v1/pages/${id}`); expect(requests[1].method).toBe('GET');
  expect(requests.every(request => request.headers.get('Notion-Version') === NOTION_VERSION)).toBe(true);
});
