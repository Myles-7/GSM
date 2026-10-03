import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryRepo } from '../../../types';
import { workspaceSessionKey } from './model';
import { loadBrowseSession, saveBrowsePage } from './storage';
import { refreshPopularReading } from './popularReading';

const repo = (id: number) => ({ id, full_name: `a/r${id}`, name: `r${id}` }) as DiscoveryRepo;
afterEach(() => vi.unstubAllGlobals());
describe('stable popularity reading and atomic reorder', () => {
  it('refreshes metadata without truncating or reordering an existing queue', async () => {
    const account = crypto.randomUUID(), key = workspaceSessionKey('most-popular', 'all');
    await saveBrowsePage(account, { key, channelId: 'most-popular', signature: 'all', items: [repo(1), repo(2)] as unknown as Record<string, unknown>[], nextPage: 3, hasMore: true, totalCount: 40, mode: 'replace' });
    const result = await refreshPopularReading({ account, key, signature: 'all', reorder: false, batchSize: 20,
      signal: new AbortController().signal, isCurrent: () => true, progress: vi.fn(),
      fetchPage: async () => ({ repos: [repo(3), repo(2)], hasMore: false, nextPageIndex: 2, totalCount: 2 }) });
    expect(result.saved?.items.map(item => item.id)).toEqual([1, 2, 3]);
    expect(result.saved?.session.nextPage).toBe(3);
  });
  it('keeps old list on incomplete reorder and continues after the five-request budget', async () => {
    const account = crypto.randomUUID(), key = workspaceSessionKey('most-popular', 'all');
    await saveBrowsePage(account, { key, channelId: 'most-popular', signature: 'all', items: Array.from({ length: 120 }, (_, i) => repo(i)) as unknown as Record<string, unknown>[], nextPage: 7, hasMore: true, totalCount: 1000, mode: 'replace' });
    const fetch = vi.fn(async (page: number) => ({ repos: Array.from({ length: 20 }, (_, i) => repo(1000 - ((page - 1) * 20 + i))), hasMore: true, nextPageIndex: page + 1, totalCount: 1000 }));
    const args = { account, key, signature: 'all', reorder: true, batchSize: 20,
      signal: new AbortController().signal, isCurrent: () => true, progress: vi.fn(), fetchPage: fetch };
    const first = await refreshPopularReading(args);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(first.complete).toBe(false);
    expect((await loadBrowseSession(account, key))?.items[0].id).toBe(0);
    const second = await refreshPopularReading(args);
    expect(second.complete).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(second.saved?.items).toHaveLength(120);
    expect(second.saved?.items[0].id).toBe(1000);
  });
  it('never replaces a queue with a failed ranking response', async () => {
    const account = crypto.randomUUID(), key = workspaceSessionKey('most-popular', 'all');
    await saveBrowsePage(account, { key, channelId: 'most-popular', signature: 'all', items: [repo(1)] as unknown as Record<string, unknown>[], nextPage: 2, hasMore: true, totalCount: 1000, mode: 'replace' });
    const result = await refreshPopularReading({ account, key, signature: 'all', reorder: true, batchSize: 20,
      signal: new AbortController().signal, isCurrent: () => true, progress: vi.fn(), fetchPage: async () => { throw new Error('offline'); } });
    expect(result.complete).toBe(false);
    expect(result.saved?.items[0].id).toBe(1);
  });
  it('collects the full loaded range despite duplicates across ranking pages', async () => {
    const account = crypto.randomUUID(), key = workspaceSessionKey('most-popular', 'all');
    await saveBrowsePage(account, { key, channelId: 'most-popular', signature: 'all',
      items: Array.from({ length: 40 }, (_, i) => repo(i + 1)), nextPage: 3, hasMore: true, totalCount: 1000, mode: 'replace' });
    const fetch = vi.fn(async (page: number) => ({
      repos: Array.from({ length: 20 }, (_, i) => repo((page === 1 ? 101 : page === 2 ? 111 : 131) + i)),
      hasMore: true, nextPageIndex: page + 1, totalCount: 1000,
    }));
    const outcome = await refreshPopularReading({ account, key, signature: 'all', reorder: true, batchSize: 20,
      signal: new AbortController().signal, isCurrent: () => true, progress: vi.fn(), fetchPage: fetch });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(outcome.complete).toBe(true);
    expect(outcome.saved?.items).toHaveLength(40);
    expect(outcome.saved?.buffer).toHaveLength(10);
    expect(new Set(outcome.saved?.items.map(item => item.id)).size).toBe(40);
  });
  it('keeps fetched projects readable when local storage is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const result = await refreshPopularReading({ account: 'offline-storage', key: 'test', signature: '', reorder: false, batchSize: 20,
      signal: new AbortController().signal, isCurrent: () => true, progress: vi.fn(),
      fetchPage: async () => ({ repos: [repo(7)], hasMore: false, nextPageIndex: 2, totalCount: 1 }) });
    expect(result.unsaved?.repos[0].id).toBe(7);
    expect(result.storageIssue).toBeDefined();
    expect(result.complete).toBe(true);
  });
});
