import { beforeAll, describe, expect, it, vi } from 'vitest';
import { makeRepo } from '../features/discovery/custom/fixtures.test-support';
let useAppStore: typeof import('./useAppStore').useAppStore;
beforeAll(async () => { ({ useAppStore } = await vi.importActual<typeof import('./useAppStore')>('./useAppStore')); });
describe('discovery navigation', () => {
  it('changes only the active target, preserving content, pagination, errors and reading positions', () => {
    const repo = { ...makeRepo(), channel: 'trending' as const, platform: 'All' as const, rank: 1 };
    const initial = useAppStore.getInitialState();
    useAppStore.setState({ discoveryRepos: { ...initial.discoveryRepos, trending: [repo] }, discoveryNextPage: { ...initial.discoveryNextPage, trending: 4 }, discoveryHasMore: { ...initial.discoveryHasMore, trending: true }, discoveryTotalCount: { ...initial.discoveryTotalCount, trending: 80 }, discoveryScrollPositions: { ...initial.discoveryScrollPositions, trending: 650 }, discoveryLoadMoreError: { ...initial.discoveryLoadMoreError, trending: 'retry' } });
    const before = useAppStore.getState();
    before.setSelectedDiscoveryChannel('most-popular'); before.setSelectedDiscoveryChannel('trending');
    const after = useAppStore.getState();
    for (const key of ['discoveryRepos', 'discoveryNextPage', 'discoveryHasMore', 'discoveryTotalCount', 'discoveryScrollPositions', 'discoveryLoadMoreError'] as const) expect(after[key]).toBe(before[key]);
    expect(after.discoveryRepos.trending).toEqual([repo]);
  });
});
