import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { AppState } from '../types';
import type { HomeRecord } from './types';
import { desktopDiscoveryStoreRecords, customDiscoveryRecords, discoveryStoreProjection, projectCustomDiscovery, applyDiscoveryProjection, exportCustomDiscovery, migrateDesktopDiscovery } from './discoveryDesktop';
import { HomeDatabase } from './database';
import { emptyData } from '../features/discovery/custom/model';
import { makeChannel, makeEdition } from '../features/discovery/custom/fixtures.test-support';
import { loadData, transact } from '../features/discovery/custom/storage';
const state = (): AppState => ({ discoveryChannels: [{ id: 'trending', enabled: true, name: 'Trending' }, { id: 'x-tweets', enabled: true, name: 'X' }], selectedDiscoveryChannel: 'trending', xTweetFollows: [{ handle: 'User', addedAt: '2026-09-28' }], telegramFollows: [{ channel: 'News', addedAt: '2026-09-28' }], trendingSnapshots: [{ period: 'daily', platform: 'All', capturedAt: '2026-09-28T12:00:00Z', entries: [{ repositoryFullName: 'org/repo', rank: 1, stars: 2 }] }], xTweetAuth: { authToken: 'secret-auth', ct0: 'secret-cookie' }, githubToken: 'secret-github', backendApiSecret: 'secret-backend' } as unknown as AppState);
const record = (collection: HomeRecord['collection'], id: string, data: HomeRecord['data'], deleted = false): HomeRecord => ({ collection, id, data, deleted, version: 4 });
describe('desktop discovery synchronization', () => {
  it('exports stable source and history IDs, supported settings only, and no credentials', () => {
    const rows = desktopDiscoveryStoreRecords(state());
    expect(rows.map(row => row.id)).toEqual(['default', 'source:x:user', 'source:telegram:news', 'trending:daily:All:2026-09-28']);
    expect(JSON.stringify(rows)).not.toContain('secret');
    expect(rows[0].data.channels).toHaveLength(2);
  });
  it('merges sources by stable ID, honors tombstones, and ignores unknown records', () => {
    const patch = discoveryStoreProjection(state(), [record('discovery_subscriptions', 'source:x:user', null, true), record('discovery_subscriptions', 'source:telegram:other', { handle: 'Other', enabled: true }), record('discovery_config', 'default', { channels: [{ id: 'trending', enabled: false }] }), record('discovery_history', 'trending:daily:All:2026-09-28', null, true), record('discovery_subscriptions', 'unknown', { handle: 'never' })]);
    expect(patch.xTweetFollows).toEqual([]); expect(patch.telegramFollows?.map(f => f.channel)).toEqual(['News', 'Other']); expect(patch.trendingSnapshots).toEqual([]); expect(patch.selectedDiscoveryChannel).toBe('x-tweets');
    expect(discoveryStoreProjection(state(), [])).toEqual({});
  });
  it('round trips full custom plans and editions; preserves cache and applies read tombstones idempotently', () => {
    const source = { ...emptyData(), channels: [{ ...makeChannel(), read: [1, 2] }], editions: [makeEdition()] };
    const records = customDiscoveryRecords(source).map(row => record(row.collection, row.id, row.data));
    const target = { ...emptyData(), cache: { keep: { text: 'cache', fetchedAt: 1, pushedAt: 'now' } } };
    projectCustomDiscovery(target, records); expect(target.channels).toEqual(source.channels); expect(target.editions).toEqual(source.editions);
    const unread = record('discovery_reads', 'custom:test:1', null, true); projectCustomDiscovery(target, [unread]); projectCustomDiscovery(target, [unread]);
    expect(target.channels[0].read).toEqual([2]); expect(target.cache.keep.text).toBe('cache');
    projectCustomDiscovery(target, [record('discovery_subscriptions', 'custom:test', null, true)]); expect(target.channels).toEqual([]);
  });
  it('ignores edition, source post, mismatched and malformed read records', () => {
    const data = { ...emptyData(), channels: [{ ...makeChannel(), read: [3] }] };
    projectCustomDiscovery(data, [
      record('discovery_reads', 'custom:test:2026-09-30:1', { channelId: 'custom:test', isRead: true }),
      record('discovery_reads', 'custom:test:2026-09-30:1', { channelId: 'custom:test', repoId: 1, isRead: true }),
      record('discovery_reads', 'custom:test:2026-09-30:3', null, true),
      record('discovery_reads', 'post:x-tweet:1', { kind: 'post', channelId: 'custom:test', repoId: 1, isRead: true }),
      record('discovery_reads', 'custom:test:2', { channelId: 'custom:test', repoId: 1, isRead: true }),
      record('discovery_reads', 'custom:test:01', { channelId: 'custom:test', repoId: 1, isRead: true }),
      record('discovery_reads', 'custom:test:4', { channelId: 'custom:test', isRead: true }),
    ]);
    expect(data.channels[0].read).toEqual([3]);
    projectCustomDiscovery(data, [record('discovery_reads', 'custom:test:1', { channelId: 'custom:test', repoId: 1, isRead: true })]);
    expect(data.channels[0].read).toEqual([3, 1]);
    projectCustomDiscovery(data, [record('discovery_reads', 'custom:test:3', null, true)]);
    expect(data.channels[0].read).toEqual([1]);
  });
  it('migrates missing desktop records once without reviving tombstones or overwriting remote settings', async () => {
    const db = new HomeDatabase(crypto.randomUUID());
    await db.applyRemote([record('discovery_subscriptions', 'source:x:user', null, true), record('discovery_config', 'default', { channels: [{ id: 'trending', enabled: false }] })], 1, true);
    const legacy = desktopDiscoveryStoreRecords(state());
    await migrateDesktopDiscovery(db, [...legacy, ...legacy]);
    expect((await db.pending()).map(row => row.id).sort()).toEqual(['source:telegram:news', 'trending:daily:All:2026-09-28']);
    expect((await db.allRecords()).find(row => row.id === 'source:x:user')?.deleted).toBe(true);
    expect((await db.list()).find(row => row.id === 'default')?.data?.channels).toEqual([{ id: 'trending', enabled: false }]);
    const pending = await db.pending(); await migrateDesktopDiscovery(db, legacy); expect(await db.pending()).toEqual(pending);
  });
  it('emits committed writes once, keeps reads silent, and labels projections to prevent capture loops', async () => {
    const account = crypto.randomUUID(); const listener = vi.fn(); window.addEventListener('gsm:custom-discovery-changed', listener);
    try {
      await loadData(account); expect(listener).not.toHaveBeenCalled();
      await transact(account, data => { data.channels = [makeChannel()]; }); expect(listener).toHaveBeenCalledTimes(1);
      expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ account, source: 'local' });
      const exported = await exportCustomDiscovery(account); expect(listener).toHaveBeenCalledTimes(1);
      await applyDiscoveryProjection(account, exported.map(row => record(row.collection, row.id, row.data)));
      expect(listener).toHaveBeenCalledTimes(2); expect((listener.mock.calls[1][0] as CustomEvent).detail.source).toBe('home-projection');
      expect((await loadData(account)).channels[0].id).toBe('custom:test'); expect(listener).toHaveBeenCalledTimes(2);
    } finally { window.removeEventListener('gsm:custom-discovery-changed', listener); }
  });
});
