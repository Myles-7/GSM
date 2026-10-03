import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultReadingPreferences, workspaceSessionKey } from './model';
import { clearDiscoveryList, clearRankingStage, exportDiscoveryWorkspace, importDiscoveryWorkspace, loadBrowseSession, loadRankingStage, saveBrowsePage, saveRankingStage, saveReadingAnchor, saveReadingPreferences } from './storage';

let account: string;
const key = workspaceSessionKey('most-popular', 'all');
const repo = (id: number, stars = 1000) => ({ id, name: `r${id}`, full_name: `a/r${id}`, html_url: `https://github.com/a/r${id}`, stargazers_count: stars });
beforeEach(() => { account = crypto.randomUUID(); });
describe('persistent discovery workspace', () => {
  it('retains loaded pages and order across refresh with a durable cursor', async () => {
    await saveBrowsePage(account, { key, channelId: 'most-popular', signature: 'all', items: [repo(1), repo(2)], nextPage: 2, hasMore: true, totalCount: 100, mode: 'stable' });
    await saveBrowsePage(account, { key, channelId: 'most-popular', signature: 'all', items: [repo(3), repo(1, 2000)], nextPage: 2, hasMore: true, totalCount: 100, mode: 'stable', preserveCursor: true });
    const saved = await loadBrowseSession(account, key);
    expect(saved?.items.map(r => r.id)).toEqual([1, 2, 3]);
    expect(saved?.items[0].stargazers_count).toBe(2000);
    expect(saved?.session.nextPage).toBe(2);
    expect(await loadBrowseSession('different-account', key)).toBeNull();
  });
  it('buffers overflow rather than changing source pagination when batch size changes', async () => {
    await saveBrowsePage(account, { key, channelId: 'search', signature: '', items: Array.from({ length: 60 }, (_, i) => repo(i)), nextPage: 4, hasMore: true, totalCount: 100, mode: 'replace', exposeCount: 50 });
    expect((await loadBrowseSession(account, key))?.items).toHaveLength(50);
    await saveBrowsePage(account, { key, channelId: 'search', signature: '', items: [], nextPage: 4, hasMore: true, totalCount: 100, mode: 'append', exposeCount: 20 });
    expect((await loadBrowseSession(account, key))?.items).toHaveLength(60);
  });
  it('backs up anchors/settings and refuses cross-account restore before writing', async () => {
    await saveReadingAnchor(account, { sessionKey: key, itemKey: 'repo:2', offset: 83, previousKeys: ['repo:1'], updatedAt: Date.now() });
    await saveReadingPreferences(account, 'most-popular', { ...defaultReadingPreferences(), batchSize: 50 });
    const backup = await exportDiscoveryWorkspace(account);
    expect(backup.anchors[0].offset).toBe(83);
    expect(backup.preferences[0].value.batchSize).toBe(50);
    await expect(importDiscoveryWorkspace('other', backup, 'replace')).rejects.toThrow('ACCOUNT');
    expect((await exportDiscoveryWorkspace('other')).preferences).toEqual([]);
  });
  it('clears list data independently of preferences and reading records', async () => {
    await saveBrowsePage(account, { key, channelId: 'most-popular', signature: 'all', items: [repo(1)], nextPage: 2, hasMore: true, totalCount: 100, mode: 'replace' });
    await saveReadingPreferences(account, 'most-popular', defaultReadingPreferences());
    await clearDiscoveryList(account, key);
    expect(await loadBrowseSession(account, key)).toBeNull();
    expect((await exportDiscoveryWorkspace(account)).preferences).toHaveLength(1);
  });
  it('rejects late task writes and replaces atomically without leaking unreferenced projects', async () => {
    const input = { key, channelId: 'most-popular', signature: 'all', items: [repo(1)], nextPage: 2, hasMore: true, totalCount: 100, mode: 'replace' as const };
    await saveBrowsePage(account, input);
    await expect(saveBrowsePage(account, { ...input, items: [repo(2)], isCurrent: () => false })).rejects.toThrow('Stale');
    expect((await loadBrowseSession(account, key))?.items[0].id).toBe(1);
    await saveBrowsePage(account, { ...input, items: [repo(3)] });
    expect((await exportDiscoveryWorkspace(account)).projects.map(row => row.value.id)).toEqual([3]);
  });
  it('merges concurrent append pages without regressing cursor or newer project data', async () => {
    const input = { key, channelId: 'most-popular', signature: 'all', nextPage: 3, hasMore: true, totalCount: 100, mode: 'append' as const };
    await saveBrowsePage(account, { ...input, items: [repo(1, 2000), repo(3)] });
    await saveBrowsePage(account, { ...input, nextPage: 2, items: [repo(1, 1000), repo(2)] });
    const saved = await loadBrowseSession(account, key);
    expect(saved?.session.nextPage).toBe(3);
    expect(saved?.items.map(r => r.id)).toEqual([1, 3, 2]);
    expect(saved?.items[0].stargazers_count).toBe(2000);
  });
  it('does not regress another tab\'s ranking stage or clear its newer generation', async () => {
    const stage = { key, channelId: 'most-popular', signature: 'all', baseVersion: 0,
      mode: 'reorder' as const, targetCount: 120, nextPage: 4, projectKeys: ['repo:1'], hasMore: true, totalCount: 1000 };
    await saveRankingStage(account, stage, [repo(1)]);
    await saveRankingStage(account, { ...stage, nextPage: 2, projectKeys: ['repo:2'] }, [repo(2)]);
    expect((await loadRankingStage(account, key))?.nextPage).toBe(4);
    await saveBrowsePage(account, { key, channelId: 'most-popular', signature: 'all', items: [repo(1)],
      nextPage: 2, hasMore: true, totalCount: 1000, mode: 'replace' });
    await saveRankingStage(account, { ...stage, baseVersion: 1, nextPage: 2 }, [repo(1)]);
    await clearRankingStage(account, key, 0);
    expect((await loadRankingStage(account, key))?.baseVersion).toBe(1);
    await clearRankingStage(account, key, 1);
    expect(await loadRankingStage(account, key)).toBeUndefined();
  });
});
