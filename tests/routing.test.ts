import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '../apps/server/src/infra/store.js';
import { Service } from '../apps/server/src/core/service.js';
import { DomainError, type NotionAdapter } from '../apps/server/src/notion/adapter.js';
import { pageReference } from '../apps/server/src/notion/page-metadata.js';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(close => close()); });
function rawPage(id: string, title = 'Shared root', parent = 'workspace', active = true) {
  return { object: 'page', id, properties: { custom_title_property: { type: 'title', title: [{ plain_text: title }] } },
    parent: { type: parent }, archived: !active, in_trash: !active, last_edited_time: new Date().toISOString(), url: 'javascript:untrusted' };
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'lv999-routing-'));
  const store = new Store(directory); cleanup.push(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const a = randomUUID(), b = randomUUID(), rootA = randomUUID(), rootB = randomUUID(), extraA = randomUUID();
  const secretA = randomUUID(), secretB = randomUUID();
  store.add({ id: a, label: 'Test Alpha', environment: 'test' }); store.add({ id: b, label: 'Test Beta', environment: 'test' });
  const secrets = new Map<string, string>([[a, secretA], [b, secretB]]);
  const pagesA = new Map<string, ReturnType<typeof rawPage>>([[rootA, rawPage(rootA)], [extraA, rawPage(extraA, 'Second result')]]);
  const pagesB = new Map<string, ReturnType<typeof rawPage>>([[rootB, rawPage(rootB)]]);
  function adapter(id: string, pages: Map<string, ReturnType<typeof rawPage>>) {
    return {
      identity: vi.fn(async () => ({ workspace_id: id, workspace_name: id === a ? 'Test Alpha' : 'Test Beta', bot_id: randomUUID() })),
      search: vi.fn(async (_query: string, cursor?: string, _pagesOnly?: boolean): Promise<unknown> => ({ results: [...pages.values()].slice(cursor ? 1 : 0, cursor ? 2 : 1), has_more: !cursor && pages.size > 1, next_cursor: !cursor && pages.size > 1 ? 'batch-two' : null })),
      page: vi.fn(async (pageId: string): Promise<unknown> => { const page = pages.get(pageId); if (!page) throw new DomainError('NOT_FOUND_OR_NOT_SHARED', 'Not found or not shared.'); return page; }),
    };
  }
  const adapterA = adapter(a, pagesA), adapterB = adapter(b, pagesB);
  const adapters = new Map<string, NotionAdapter>([[secretA, adapterA], [secretB, adapterB]]);
  const vault = { read: vi.fn(async (id: string) => secrets.get(id) ?? null), write: vi.fn(async () => {}), remove: vi.fn(async () => {}), probe: vi.fn(async () => true) };
  const service = new Service(store, vault, token => adapters.get(token)!);
  const input = { project_key: 'qa', name: 'Shared project', workspace_id: a, root_page_id: rootA, expected_revision: 0 };
  return { store, service, directory, a, b, rootA, rootB, extraA, secrets, secretA, secretB, adapterA, adapterB, pagesA, pagesB, vault, input };
}

it('browses only pages and forwards title queries and opaque cursors to the selected identity', async () => {
  const f = fixture();
  const first = await f.service.browsePages({ workspace_id: f.a, query: 'Shared' });
  expect(first.data).toMatchObject({ pages: [{ workspace_id: f.a, id: f.rootA, title: 'Shared root', root_eligible: true }], next_cursor: 'batch-two', has_more: true });
  const second = await f.service.browsePages({ workspace_id: f.a, query: 'Shared', start_cursor: 'batch-two' });
  expect(second.data?.pages[0].id).toBe(f.extraA);
  expect(f.adapterA.search.mock.calls).toEqual([['Shared', undefined, true], ['Shared', 'batch-two', true]]);
  expect(f.adapterB.search).not.toHaveBeenCalled(); expect(first.warnings.join(' ')).toContain('not a complete');
});
it('reports omitted partial/unsupported search objects instead of inventing full pages', async () => {
  const f = fixture();
  f.adapterA.search.mockResolvedValueOnce({ results: [rawPage(f.rootA), { object: 'data_source', id: randomUUID() }, { object: 'page', id: randomUUID() }], has_more: false, next_cursor: null });
  const reply = await f.service.browsePages({ workspace_id: f.a });
  expect(reply.data?.pages).toHaveLength(1); expect(reply.data?.skipped_objects).toBe(2);
  expect(reply.warnings.join(' ')).toContain('2 incomplete');
});
it.each([
  { results: [], has_more: true, next_cursor: null },
  { results: [], has_more: true, next_cursor: 'same-cursor' },
])('rejects broken pagination without presenting a complete inventory', async response => {
  const f = fixture(); f.adapterA.search.mockResolvedValueOnce(response);
  expect((await f.service.browsePages({ workspace_id: f.a, start_cursor: 'same-cursor' })).code).toBe('INVALID_RESPONSE');
});
it('accepts exact IDs and Notion links but never fetches arbitrary URLs', async () => {
  const f = fixture(); const compact = f.rootA.replaceAll('-', '');
  expect(pageReference(f.rootA)).toBe(f.rootA); expect(pageReference(compact)).toBe(f.rootA);
  const reply = await f.service.inspectPage({ workspace_id: f.a, reference: `https://www.notion.so/Project-${compact}?source=copy_link` });
  expect(reply.data?.id).toBe(f.rootA); expect(reply.resource_url).toBe(`https://www.notion.so/${compact}`);
  for (const reference of [`https://evil.example/Page-${compact}`, `http://evil.example/Page-${compact}`, `https://name:secret@notion.so/${compact}`, 'javascript:alert(1)'])
    expect((await f.service.inspectPage({ workspace_id: f.a, reference })).code).toBe('INVALID_INPUT');
  expect(f.adapterA.page).toHaveBeenCalledTimes(1);
});
it('attributes an unshared page to that workspace without invalidating the entire connection', async () => {
  const f = fixture(); await f.service.verify(f.a); const before = f.store.list().find(w => w.id === f.a);
  expect((await f.service.inspectPage({ workspace_id: f.a, reference: f.rootB })).code).toBe('NOT_FOUND_OR_NOT_SHARED');
  expect(f.store.list().find(w => w.id === f.a)).toEqual(before); expect(f.adapterB.page).not.toHaveBeenCalled();
});
it('blocks a swapped workspace token before browsing or reading the proposed root', async () => {
  const f = fixture(); f.secrets.set(f.a, f.secretB);
  expect((await f.service.browsePages({ workspace_id: f.a })).code).toBe('WORKSPACE_MISMATCH');
  expect((await f.service.saveProject(f.input)).code).toBe('WORKSPACE_MISMATCH');
  expect(f.adapterA.page).not.toHaveBeenCalled(); expect(f.adapterB.page).not.toHaveBeenCalled(); expect(f.adapterB.search).not.toHaveBeenCalled();
});
it('saves a canonical unique key only after a fresh root read, with no Notion content mutation', async () => {
  const f = fixture(); const reply = await f.service.saveProject(f.input);
  expect(reply).toMatchObject({ ok: true, project_key: 'QA', workspace_id: f.a, changed_objects: 0,
    data: { project_key: 'QA', name: 'Shared project', revision: 1, root_page: { id: f.rootA, title: 'Shared root' } } });
  expect(f.adapterA.page).toHaveBeenCalledWith(f.rootA);
  expect(f.service.snapshot().projects).toEqual([reply.data]);
});
it.each(['data_source_id', 'database_id', 'unsupported'])('rejects a %s parent as a project root', async parent => {
  const f = fixture(); f.pagesA.set(f.rootA, rawPage(f.rootA, 'Record', parent));
  expect((await f.service.saveProject(f.input)).code).toBe('INELIGIBLE_ROOT'); expect(f.store.projects()).toEqual([]);
});
it('rechecks an archived page before saving an edit and retains the existing target', async () => {
  const f = fixture(); await f.service.saveProject(f.input); const before = f.store.projects();
  f.pagesA.set(f.rootA, rawPage(f.rootA, 'Root', 'workspace', false));
  expect((await f.service.saveProject({ ...f.input, expected_revision: 1 })).code).toBe('INELIGIBLE_ROOT');
  expect(f.store.projects()).toEqual(before);
});
it('does not substitute a same-titled page from a different workspace', async () => {
  const f = fixture(); await f.service.saveProject(f.input); const before = f.store.projects();
  expect((await f.service.saveProject({ ...f.input, root_page_id: f.rootB, expected_revision: 1 })).code).toBe('NOT_FOUND_OR_NOT_SHARED');
  expect(f.adapterB.page).not.toHaveBeenCalled(); expect(f.store.projects()).toEqual(before);
});
it('rejects duplicate creation and stale edits instead of silently overwriting', async () => {
  const f = fixture(); await f.service.saveProject(f.input);
  expect((await f.service.saveProject(f.input)).code).toBe('ROUTE_CONFLICT');
  const secondStore = new Store(f.directory); cleanup.push(() => secondStore.close());
  const current = await f.service.saveProject({ ...f.input, name: 'Updated', expected_revision: 1 });
  expect(current.data?.revision).toBe(2);
  expect(secondStore.saveProject({ ...f.input, project_key: 'QA', expected_revision: 1 }, current.data!.root_page)).toBeNull();
  expect(f.store.projects()[0].name).toBe('Updated');
});
it('rolls back the route if its success audit cannot be committed', async () => {
  const f = fixture(); vi.spyOn(f.store, 'log').mockImplementationOnce(() => { throw Object.assign(new Error('Disk full'), { code: 'ERR_SQLITE_ERROR' }); });
  expect((await f.service.saveProject(f.input)).code).toBe('LOCAL_SAVE_FAILED'); expect(f.store.projects()).toEqual([]);
});
it('refuses ambiguous normalized names before reading any credential or page', async () => {
  const f = fixture(); await f.service.saveProject(f.input);
  await f.service.saveProject({ ...f.input, project_key: 'QB', workspace_id: f.b, root_page_id: f.rootB });
  f.vault.read.mockClear(); f.adapterA.page.mockClear(); f.adapterB.page.mockClear();
  expect((await f.service.resolveProject({ name: ' Ｓｈａｒｅｄ ｐｒｏｊｅｃｔ ' })).code).toBe('AMBIGUOUS_TARGET');
  expect(f.vault.read).not.toHaveBeenCalled(); expect(f.adapterA.page).not.toHaveBeenCalled(); expect(f.adapterB.page).not.toHaveBeenCalled();
  const reply = await f.service.resolveProject({ project_key: 'qa' }); expect(reply.ok).toBe(true); expect(reply.workspace_id).toBe(f.a);
});
it('revalidates a resolved root and reports its fresh title without rewriting the saved mapping', async () => {
  const f = fixture(); await f.service.saveProject(f.input);
  f.pagesA.set(f.rootA, rawPage(f.rootA, 'Renamed root'));
  const reply = await f.service.resolveProject({ project_key: 'QA' });
  expect(reply.data?.root_page.title).toBe('Renamed root'); expect(f.store.projects()[0].root_page.title).toBe('Shared root');
  f.adapterA.page.mockRejectedValueOnce(new DomainError('NOT_FOUND_OR_NOT_SHARED', 'Not found or not shared.'));
  expect((await f.service.resolveProject({ project_key: 'QA' })).code).toBe('NOT_FOUND_OR_NOT_SHARED');
  expect(f.store.projects()).toHaveLength(1);
});
it('rejects a resolution whose mapping changed while its root was being checked', async () => {
  const f = fixture(); await f.service.saveProject(f.input);
  let finish!: (value: unknown) => void;
  f.adapterA.page.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.service.resolveProject({ project_key: 'QA' });
  await vi.waitFor(() => expect(f.adapterA.page).toHaveBeenCalledTimes(2));
  await f.service.saveProject({ ...f.input, expected_revision: 1, workspace_id: f.b, root_page_id: f.rootB });
  finish(rawPage(f.rootA)); expect((await pending).code).toBe('ROUTE_CONFLICT');
});
it('fails malformed/unknown targets without guessing a project or credential', async () => {
  const f = fixture();
  expect((await f.service.saveProject({ ...f.input, root_title: 'Forged' })).code).toBe('INVALID_INPUT');
  expect((await f.service.resolveProject({ project_key: 'QA', name: 'Shared project' })).code).toBe('INVALID_INPUT');
  expect((await f.service.resolveProject({ project_key: 'MISSING' })).code).toBe('UNKNOWN_PROJECT');
  expect((await f.service.inspectPage({ workspace_id: randomUUID(), reference: f.rootA })).code).toBe('UNKNOWN_WORKSPACE');
  expect(f.vault.read).not.toHaveBeenCalled();
});
