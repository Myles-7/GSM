import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { codeItemKey, workspaceSessionKey } from '../features/discovery/workspace/model';
import { exportDiscoveryWorkspace, importDiscoveryWorkspace, loadBrowseSession } from '../features/discovery/workspace/storage';
import { searchGrepApp, type GrepSearchResult } from './grepAppService';
import { codeSearchSignature, defaultCodeSearchSourceState, fetchCodeSearchBatch, loadCodeSearchWorkspace, saveCodeSearchSourceState } from './codeSearchWorkspace';

vi.mock('./grepAppService', async (original) => ({
  ...await original<typeof import('./grepAppService')>(), searchGrepApp: vi.fn(),
}));
const search = vi.mocked(searchGrepApp);
let account: string;
const source = { ...defaultCodeSearchSourceState(), query: 'hello' };
const options = () => ({ signal: new AbortController().signal, isCurrent: () => true });
const result = (start: number, count: number, total = 100): GrepSearchResult => ({
  total, repoFacets: [{ val: 'owner/repo', count: total }], langFacets: [], pathFacets: [],
  hits: Array.from({ length: count }, (_, index) => ({ repo: 'owner/repo', branch: 'main',
    path: `src/${start + index}.ts`, snippetHtml: `<pre>${start + index}</pre>`, language: '', totalMatches: '1' })),
});
beforeEach(() => { account = crypto.randomUUID(); search.mockReset(); });

describe('code search workspace batches', () => {
  it('uses canonical filter signatures and includes branch in hit identity', () => {
    expect(codeSearchSignature({ ...source, langs: ['Go', 'Rust', 'Go'] })).toBe(codeSearchSignature({ ...source, langs: ['Rust', 'Go'] }));
    const hit = result(0, 1).hits[0];
    expect(codeItemKey(hit)).not.toBe(codeItemKey({ ...hit, branch: 'dev' }));
  });

  it('consumes stored overflow without querying or changing the source cursor', async () => {
    search.mockResolvedValueOnce(result(0, 60));
    const first = await fetchCodeSearchBatch(account, source, null, 20, 'replace', options());
    expect(first.snapshot?.buffer).toHaveLength(40);
    const next = await fetchCodeSearchBatch(account, source, first.snapshot, 20, 'append', options());
    expect(search).toHaveBeenCalledTimes(1);
    expect(next.snapshot?.result.hits).toHaveLength(40);
    expect(next.snapshot?.buffer).toHaveLength(20);
    expect(next.snapshot?.nextPage).toBe(2);
    const stored = await loadBrowseSession(account, next.snapshot!.key);
    expect(stored?.items).toHaveLength(40);
    expect(stored?.buffer).toHaveLength(20);
  });

  it('keeps durable order and continuation when explicitly refreshing the same query', async () => {
    search.mockResolvedValueOnce(result(0, 40, 40));
    const first = await fetchCodeSearchBatch(account, source, null, 50, 'replace', options());
    search.mockResolvedValueOnce(result(0, 0));
    const refreshed = await fetchCodeSearchBatch(account, source, first.snapshot, 20, 'stable', options());
    expect(refreshed.snapshot?.result.hits.map(codeItemKey)).toEqual(first.snapshot?.result.hits.map(codeItemKey));
    expect(refreshed.snapshot?.nextPage).toBe(first.snapshot?.nextPage);
    expect((await loadBrowseSession(account, refreshed.snapshot!.key))?.items).toHaveLength(first.snapshot!.result.hits.length);
  });

  it('does not mistake overlapping pages for the end and preserves branch variants', async () => {
    search.mockResolvedValueOnce(result(0, 20, 40));
    const first = await fetchCodeSearchBatch(account, source, null, 20, 'replace', options());
    search.mockResolvedValueOnce(result(10, 20, 40)).mockResolvedValueOnce({
      ...result(30, 9, 40), hits: [...result(30, 9, 40).hits, { ...result(0, 1).hits[0], branch: 'dev' }],
    });
    const next = await fetchCodeSearchBatch(account, source, first.snapshot, 20, 'append', options());
    expect(search).toHaveBeenCalledTimes(3);
    expect(next.snapshot?.result.hits).toHaveLength(40);
    expect(new Set(next.snapshot?.result.hits.map(codeItemKey)).size).toBe(40);
    expect(next.snapshot?.result.hits[39]?.branch).toBe('dev');
    expect(next.snapshot?.hasMore).toBe(false);
  });

  it('persists successful pages after a later failure and retries from the next source page', async () => {
    search.mockResolvedValueOnce(result(0, 10)).mockRejectedValueOnce(new Error('limited'));
    const first = await fetchCodeSearchBatch(account, source, null, 20, 'replace', options());
    expect(first.error).toEqual(new Error('limited'));
    expect(first.snapshot?.result.hits).toHaveLength(10);
    expect(first.snapshot?.nextPage).toBe(2);
    search.mockResolvedValueOnce(result(10, 20));
    const next = await fetchCodeSearchBatch(account, source, first.snapshot, 20, 'append', options());
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.anything());
    expect(next.snapshot?.result.hits).toHaveLength(30);
  });

  it('retains usable results and reports persistence failure when storage is unavailable', async () => {
    search.mockResolvedValueOnce(result(0, 20));
    const spy = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('disk unavailable'); });
    try {
      const outcome = await fetchCodeSearchBatch(account, source, null, 20, 'replace', options());
      expect(outcome.snapshot?.result.hits).toHaveLength(20);
      expect(outcome.persistenceError).toEqual(new Error('disk unavailable'));
    } finally { spy.mockRestore(); }
  });

  it('rejects late results before saving after cancellation', async () => {
    let resolve!: (value: GrepSearchResult) => void;
    search.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
    const controller = new AbortController();
    const pending = fetchCodeSearchBatch(account, source, null, 20, 'replace', { signal: controller.signal, isCurrent: () => true });
    controller.abort(); resolve(result(0, 20));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect((await exportDiscoveryWorkspace(account)).sessions).toEqual([]);
  });

  it('serializes source updates and restores metadata and buffered results after backup import', async () => {
    search.mockResolvedValueOnce(result(0, 30));
    const batch = await fetchCodeSearchBatch(account, source, null, 20, 'replace', options());
    const signature = codeSearchSignature(source);
    const updates = [false, true, false].map(starredOnly => saveCodeSearchSourceState(account, { ...source, starredOnly,
      resultSignature: signature, facets: { repoFacets: [], langFacets: [], pathFacets: [] } }));
    await Promise.all(updates);
    const backup = await exportDiscoveryWorkspace(account);
    await importDiscoveryWorkspace(account, backup, 'replace');
    const restored = await loadCodeSearchWorkspace(account);
    expect(restored.source.starredOnly).toBe(false);
    expect(restored.snapshot?.result.hits).toHaveLength(20);
    expect(restored.snapshot?.buffer).toHaveLength(10);
    expect(restored.snapshot?.key).toBe(workspaceSessionKey('code-search', signature));
    expect(restored.snapshot?.nextPage).toBe(batch.snapshot?.nextPage);
  });
});
