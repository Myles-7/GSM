import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AIConfig } from '../../../types';
import { emptyData, type CustomDiscoveryData } from './model';
import { makeChannel, makeRepo } from './fixtures.test-support';

const mocks = vi.hoisted(() => ({ data: {} as CustomDiscoveryData, assess: vi.fn(),
  state: { user: { id: 123 }, githubToken: 'fixture', repositories: [], discoveryRepos: {}, language: 'zh', aiConfigs: [] as AIConfig[] },
}));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => mocks.state } }));
vi.mock('../../../services/aiService', () => ({ AIService: class { assessDiscoverySubscription = mocks.assess; } }));
vi.mock('../../../services/githubApiFactory', () => ({ createGitHubApiService: () => ({
  searchDiscoveryCandidates: async () => ({ items: Array.from({ length: 6 }, (_, i) => makeRepo(i + 1)), hasMore: false }),
  getTrendingRepositories: async () => ({ repos: [] }),
}) }));
vi.mock('../../../services/repositoryDetailReadme', () => ({ getRepositoryDetailReadme: async () => ({ content: 'Synthetic local AI repository.' }) }));
vi.mock('./analysis', () => ({ enqueueAnalysis: vi.fn(), cancelAnalysis: vi.fn() }));
vi.mock('../../../utils/requestDeadline', async original => ({ ...await original<typeof import('../../../utils/requestDeadline')>(),
  waitForRequest: async (_delay: number, signal?: AbortSignal) => { signal?.throwIfAborted(); },
}));
vi.mock('./storage', () => ({ loadData: async () => structuredClone(mocks.data),
  transact: async (_account: string, change: (data: CustomDiscoveryData) => unknown) => change(mocks.data),
  acquireLease: async (_account: string, owner: string) => { mocks.data.lease = { owner, expires: Date.now() + 120000 }; return true; },
  releaseLease: async () => { mocks.data.lease = undefined; },
}));
import { cancelCustomRun, runChannels } from './runner';
import { useCustomDiscovery } from './store';
const config: AIConfig = { id: 'fixture', name: 'Fixture', model: 'fixture', baseUrl: 'https://fixture.invalid', apiKey: 'fixture', isActive: true, concurrency: 1 };
beforeEach(() => {
  mocks.data = emptyData();
  const channel = makeChannel();
  channel.plan.required = []; channel.plan.excluded = []; channel.plan.preferred = [];
  channel.plan.branches = [channel.plan.branches[0]]; channel.autoAnalyze = false;
  mocks.data.channels = [channel]; mocks.state.aiConfigs = [config]; mocks.assess.mockReset();
  useCustomDiscovery.setState({ account: '123', data: structuredClone(mocks.data), candidates: {} });
});
afterEach(() => cancelCustomRun());
const refresh = async () => { useCustomDiscovery.setState({ data: structuredClone(mocks.data) }); };

it('publishes a successful batch without treating pending or failed screening as accepted recommendations', async () => {
  mocks.assess.mockImplementationOnce(async (_plan, batch: { id: number }[]) => JSON.stringify(batch.map(({ id }) => ({ id, relevance: 3, reason: 'Matches the requested topic', findings: [] }))))
    .mockRejectedValueOnce(new Error('MODEL_TIMEOUT'));
  const snapshots: CustomDiscoveryData[] = [];
  await runChannels(['custom:test'], vi.fn(), async () => { snapshots.push(structuredClone(mocks.data)); await refresh(); }, { config });
  expect(snapshots[0].editions[0].entries.map(item => item.repo.id)).toEqual([1, 2, 3, 4, 5]);
  expect(snapshots[0].editions[0].pending.map(item => item.repo.id)).toEqual([6]);
  expect(mocks.data.channels[0].recommended['6']).toBeUndefined();
  expect(mocks.data.editions[0]).toMatchObject({ complete: false, pending: [expect.objectContaining({ repo: expect.objectContaining({ id: 6 }), verdict: 'unknown' })] });
  expect(mocks.assess).toHaveBeenCalledTimes(2);
});

it('retains candidates as unknown when every AI screening batch fails, even with no hard rules', async () => {
  mocks.assess.mockRejectedValue(new Error('MODEL_TIMEOUT'));
  await runChannels(['custom:test'], vi.fn(), refresh, { config });
  expect(mocks.data.editions[0].entries).toEqual([]);
  expect(mocks.data.editions[0].pending).toHaveLength(6);
  expect(mocks.data.channels[0].recommended).toEqual({});
});

it('preserves rule-only recommendations when the channel does not request AI screening', async () => {
  mocks.data.channels[0].ai = false;
  await refresh();
  await runChannels(['custom:test'], vi.fn(), refresh, { config });
  expect(mocks.assess).not.toHaveBeenCalled();
  expect(mocks.data.editions[0].entries).toHaveLength(6);
  expect(mocks.data.editions[0].complete).toBe(true);
});
