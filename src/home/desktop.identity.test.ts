import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../types';
import type { Capabilities, HomeOperation, HomeRecord } from './types';

const mocks = vi.hoisted(() => ({
  state: {} as AppState, url: '',
  listeners: new Set<(next: AppState, previous: AppState) => void>(),
}));
vi.mock('../store/useAppStore', () => ({
  useAppStore: {
    getState: () => mocks.state,
    setState: (patch: Partial<AppState>) => {
      const previous = mocks.state;
      mocks.state = { ...previous, ...patch };
      for (const listener of mocks.listeners) listener(mocks.state, previous);
    },
    subscribe: (listener: (next: AppState, previous: AppState) => void) => {
      mocks.listeners.add(listener);
      return () => { mocks.listeners.delete(listener); };
    },
  },
}));
vi.mock('../services/backendAdapter', () => ({
  backend: { isAvailable: true, get backendUrl() { return mocks.url; } },
}));
vi.mock('../services/repositoryChatStorage', () => ({
  repositoryChatStorage: {
    exportWorkbench: vi.fn(async () => ({})), applyHomeProjection: vi.fn(async () => {}),
  },
}));

import { useAppStore } from '../store/useAppStore';
import { HomeApi } from './api';
import { activateDesktopHome, flushDesktopHome, getDesktopHomeSync, pauseDesktopHomeForIdentity, stopDesktopHome } from './desktop';
import { holdRepositoryIdentityWrites, releaseRepositoryIdentityWrites } from '../services/repositoryIdentityGate';

const fixture = () => ({
  user: { id: 42 }, backendApiSecret: 'fixture', repositories: [], releases: [],
  releaseSubscriptions: new Set(), readReleases: new Set(), customCategories: [],
  hiddenDefaultCategoryIds: [], categoryOrder: [], subcategories: [], subcategoryOrder: [],
  repositoryOrder: [], defaultCategoryOverrides: {}, categoryListIdMap: {}, releaseSourceSettings: {},
  discoveryChannels: [{ id: 'trending', name: 'Trending', enabled: true }],
  selectedDiscoveryChannel: 'trending', xTweetFollows: [], telegramFollows: [], trendingSnapshots: [],
} as unknown as AppState);
const capabilities = (): Capabilities => ({
  protocolVersion: 2, workspace: { id: crypto.randomUUID(), githubUserId: 42 }, github: { configured: true },
});

afterEach(async () => {
  await pauseDesktopHomeForIdentity();
  stopDesktopHome();
  releaseRepositoryIdentityWrites('42');
  mocks.listeners.clear();
  vi.restoreAllMocks();
});

describe('desktop Home identity boundary', () => {
  it('captures edits against canonical unknown fields and honors an external-channel deletion', async () => {
    mocks.state = fixture();
    mocks.url = `https://${crypto.randomUUID()}.example/api`;
    const config: HomeRecord = {
      collection: 'discovery_config', id: 'default', version: 1,
      data: { schemaVersion: 2, futureConfig: { keep: true }, channels: [
        { id: 'trending', enabled: true, futureBuiltin: 'keep' },
        { id: 'external:feed', name: 'Feed', enabled: true, sourceUrl: 'https://feed.example/feed.json', futureFeed: 'keep' },
      ] },
    };
    const sent: HomeOperation[] = [];
    vi.spyOn(HomeApi.prototype, 'request').mockImplementation(async (path, body) => {
      if (path.startsWith('/sync/v2/snapshot')) return { records: [config], cursor: 1, snapshotId: 'fixture', nextOffset: 0, hasMore: false } as never;
      if (path.startsWith('/sync/v2/changes')) return { records: [], cursor: 1, hasMore: false } as never;
      const operations = (body as { operations: HomeOperation[] }).operations;
      sent.push(...structuredClone(operations));
      return { results: operations.map(operation => ({ opId: operation.opId, status: 'applied',
        record: { collection: operation.collection, id: operation.id, version: operation.baseVersion + 1,
          data: operation.data ?? null, deleted: operation.kind === 'delete' } })) } as never;
    });
    await activateDesktopHome(capabilities());
    await getDesktopHomeSync()!.sync();
    useAppStore.setState({ discoveryChannels: mocks.state.discoveryChannels.map(channel =>
      channel.id === 'trending' ? { ...channel, enabled: false } : channel) });
    await flushDesktopHome();
    const first = sent.find(operation => operation.collection === 'discovery_config')!.data!;
    expect(first.futureConfig).toEqual({ keep: true });
    expect((first.channels as Array<Record<string, unknown>>).find(channel => channel.id === 'trending'))
      .toMatchObject({ enabled: false, futureBuiltin: 'keep' });
    expect((first.channels as Array<Record<string, unknown>>).find(channel => channel.id === 'external:feed'))
      .toMatchObject({ futureFeed: 'keep' });
    useAppStore.setState({ discoveryChannels: mocks.state.discoveryChannels.filter(channel => channel.id !== 'external:feed') });
    await flushDesktopHome();
    const configs = sent.filter(operation => operation.collection === 'discovery_config');
    const latest = configs[configs.length - 1].data!;
    expect(latest.futureConfig).toEqual({ keep: true });
    expect((latest.channels as Array<{ id: string }>).some(channel => channel.id === 'external:feed')).toBe(false);
  });

  it('desktop pause waits for a running pull, discards it, and leaves the identity gate held', async () => {
    mocks.state = fixture();
    mocks.url = `https://${crypto.randomUUID()}.example/api`;
    let stall = false;
    let entered!: () => void;
    let reply!: (value: unknown) => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const request = vi.spyOn(HomeApi.prototype, 'request').mockImplementation(async (path, body) => {
      if (stall) { entered(); return new Promise(resolve => { reply = resolve; }) as never; }
      if (path === '/sync/v2/operations') {
        return { results: (body as { operations: HomeOperation[] }).operations.map(operation => ({
          opId: operation.opId, status: 'applied', record: { collection: operation.collection, id: operation.id,
            version: operation.baseVersion + 1, data: operation.data ?? null },
        })) } as never;
      }
      return { records: [], cursor: 1, snapshotId: 'fixture', nextOffset: 0, hasMore: false } as never;
    });
    await activateDesktopHome(capabilities());
    const sync = getDesktopHomeSync()!;
    await sync.sync();
    stall = true;
    const running = sync.sync();
    await started;
    holdRepositoryIdentityWrites('42', 'desktop-drain-test');
    let paused = false;
    const pause = pauseDesktopHomeForIdentity().then(value => { paused = true; return value; });
    await Promise.resolve();
    expect(getDesktopHomeSync()).toBeNull();
    expect(paused).toBe(false);
    const count = request.mock.calls.length;
    reply({ records: [{ collection: 'repositories', id: 'old', version: 1, data: {} }], cursor: 2, hasMore: true });
    expect(await pause).toBe(sync);
    await running;
    expect(request).toHaveBeenCalledTimes(count);
    expect(await sync.db.list('repositories')).toEqual([]);
    await expect(sync.db.edit('repositories', 'new', {})).rejects.toThrow('REPOSITORY_IDENTITY_MAINTENANCE_REQUIRED');
  });
});
