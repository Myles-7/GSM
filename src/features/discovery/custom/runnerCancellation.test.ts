import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyData, type CustomDiscoveryData } from './model';
import { makeChannel, makeRepo } from './fixtures.test-support';

const mocks = vi.hoisted(() => ({
  data: {} as CustomDiscoveryData,
  state: { user: { id: 123 }, githubToken: 'test', repositories: [], discoveryRepos: {}, language: 'zh', aiConfigs: [] },
  search: vi.fn(), cancelAnalysis: vi.fn(),
}));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => mocks.state } }));
vi.mock('../../../services/githubApiFactory', () => ({ createGitHubApiService: () => ({
  searchDiscoveryCandidates: mocks.search,
  getTrendingRepositories: async () => ({ repos: [] }),
}) }));
vi.mock('./analysis', () => ({ enqueueAnalysis: vi.fn(), cancelAnalysis: mocks.cancelAnalysis }));
vi.mock('../../../utils/requestDeadline', async importOriginal => ({
  ...await importOriginal<typeof import('../../../utils/requestDeadline')>(),
  waitForRequest: async (_delay: number, signal?: AbortSignal) => { signal?.throwIfAborted(); },
}));
vi.mock('./storage', () => ({
  loadData: async () => structuredClone(mocks.data),
  transact: async (_account: string, change: (data: CustomDiscoveryData) => unknown) => change(mocks.data),
  acquireLease: async (_account: string, owner: string) => {
    mocks.data.lease = { owner, expires: Date.now() + 120000 }; return true;
  },
  releaseLease: async () => { mocks.data.lease = undefined; },
}));
import { cancelCustomRun, invalidateCustomRun, runChannels } from './runner';
import { useCustomDiscovery } from './store';

let searchSignal: AbortSignal;
let lateResult: ((value: { items: ReturnType<typeof makeRepo>[]; hasMore: boolean }) => void) | undefined;
let run: Promise<void> | undefined;
const refresh = async () => { useCustomDiscovery.setState({ data: structuredClone(mocks.data) }); };
beforeEach(() => {
  mocks.data = emptyData();
  mocks.data.channels = [
    { ...makeChannel(), ai: false, autoAnalyze: false },
    { ...makeChannel(), id: 'custom:second', ai: false, autoAnalyze: false },
  ];
  mocks.state.user.id = 123;
  useCustomDiscovery.setState({ account: '123', data: structuredClone(mocks.data), candidates: {} });
  mocks.cancelAnalysis.mockClear();
  mocks.search.mockReset().mockImplementationOnce((_query, _page, _recent, signal) => {
    searchSignal = signal;
    return new Promise(resolve => { lateResult = resolve; });
  }).mockResolvedValue({ items: [makeRepo(2)], hasMore: false });
  lateResult = undefined;
  run = undefined;
});
afterEach(async () => {
  cancelCustomRun();
  lateResult?.({ items: [makeRepo(1)], hasMore: false });
  await run?.catch(() => {});
});

describe('channel-owned discovery cancellation', () => {
  it('aborts only the selected channel, rejects its late response and continues other channels', async () => {
    run = runChannels(mocks.data.channels.map(c => c.id), vi.fn(), refresh);
    await waitFor(() => expect(mocks.search).toHaveBeenCalledOnce());
    cancelCustomRun({ channelId: 'custom:test' });
    expect(searchSignal.aborted).toBe(true);
    lateResult?.({ items: [makeRepo(1)], hasMore: false });
    await run;
    expect(mocks.data.editions.map(e => e.channelId)).toEqual(['custom:second']);
    expect(mocks.data.channels[0].recommended).toEqual({});
    expect(mocks.cancelAnalysis).toHaveBeenCalledWith('custom:test');
    expect(mocks.cancelAnalysis).not.toHaveBeenCalledWith('custom:second');
    expect(useCustomDiscovery.getState().candidates).toEqual({});
  });

  it('invalidates edited rules without publishing an old revision or cancelling another channel', async () => {
    run = runChannels(mocks.data.channels.map(c => c.id), vi.fn(), refresh);
    await waitFor(() => expect(mocks.search).toHaveBeenCalledOnce());
    mocks.data.channels[0].revision++;
    await refresh();
    invalidateCustomRun();
    expect(searchSignal.aborted).toBe(true);
    lateResult?.({ items: [makeRepo(1)], hasMore: false });
    await run;
    expect(mocks.data.editions).toHaveLength(1);
    expect(mocks.data.editions[0].channelId).toBe('custom:second');
  });

  it('does not publish or request another channel after the account changes', async () => {
    run = runChannels(mocks.data.channels.map(c => c.id), vi.fn(), refresh);
    await waitFor(() => expect(mocks.search).toHaveBeenCalledOnce());
    mocks.state.user.id = 456;
    lateResult?.({ items: [makeRepo(1)], hasMore: false });
    await run;
    expect(mocks.data.editions).toEqual([]);
    expect(mocks.search).toHaveBeenCalledOnce();
  });
});
