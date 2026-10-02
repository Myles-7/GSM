import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExternalFeedLoading } from './useExternalFeedLoading';

const mocks = vi.hoisted(() => ({ useAppStore: vi.fn(), load: vi.fn() }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: mocks.useAppStore }));
vi.mock('../../../services/externalDiscoveryFeed', () => ({ loadExternalDiscoveryFeed: mocks.load }));
const makeState = () => ({
  user: { id: 7 }, githubToken: 'token',
  discoveryChannels: [{ id: 'external:one', sourceUrl: 'https://example.com/feed', sourceKind: 'rss' as const, enabled: true }],
  setDiscoveryLoading: vi.fn(), setDiscoveryLoadMoreError: vi.fn(), setDiscoveryRepos: vi.fn(),
  setDiscoveryHasMore: vi.fn(), setDiscoveryNextPage: vi.fn(), setDiscoveryTotalCount: vi.fn(), setDiscoveryLastRefresh: vi.fn(),
});
let state = makeState();
type TestState = ReturnType<typeof makeState>;
const listeners = new Set<(next: TestState) => void>();
Object.assign(mocks.useAppStore, {
  getState: () => state,
  subscribe: (listener: (next: TestState) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
});
const change = (patch: Partial<typeof state>) => {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener(state));
};
const data = { repos: [{ id: 1, channel: 'external:one', rank: 1, platform: 'All' }], hasMore: false, nextPageIndex: 2, totalCount: 1 };
const api = { getRepositoryDetails: vi.fn() };
function deferred() {
  let resolve!: (value: typeof data) => void;
  const promise = new Promise<typeof data>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { vi.clearAllMocks(); listeners.clear(); state = makeState(); mocks.load.mockResolvedValue(data); });

describe('external feed loading lifecycle', () => {
  it('loads feed configuration and publishes finite pagination without any custom/AI storage', async () => {
    const { result } = renderHook(() => useExternalFeedLoading());
    await act(async () => { await result.current('external:one', api); });
    expect(mocks.load).toHaveBeenCalledWith('https://example.com/feed', 'external:one', api, 'rss', expect.any(AbortSignal));
    expect(state.setDiscoveryRepos).toHaveBeenCalledWith('external:one', data.repos);
    expect(state.setDiscoveryHasMore).toHaveBeenCalledWith('external:one', false);
    expect(state.setDiscoveryNextPage).toHaveBeenCalledWith('external:one', 2);
    expect(state.setDiscoveryTotalCount).toHaveBeenCalledWith('external:one', 1);
    expect(state.setDiscoveryLoading).toHaveBeenLastCalledWith('external:one', false);
    expect(listeners.size).toBe(0);
  });
  it.each(['account', 'away-back', 'delete', 'delete-recreate', 'url', 'disabled', 'token'] as const)(
    'cancels %s and blocks late result and map resurrection', async transition => {
      const load = deferred();
      mocks.load.mockReturnValue(load.promise);
      const { result } = renderHook(() => useExternalFeedLoading());
      let pending!: Promise<void>;
      act(() => { pending = result.current('external:one', api); });
      const old = state;
      const channel = state.discoveryChannels[0];
      act(() => {
        if (transition === 'account' || transition === 'away-back') {
          change({ user: { id: 8 } });
          if (transition === 'away-back') change({ user: { id: 7 } });
        } else if (transition === 'token') change({ githubToken: 'new-token' });
        else if (transition === 'url') change({ discoveryChannels: [{ ...channel, sourceUrl: 'https://example.com/new' }] });
        else if (transition === 'disabled') change({ discoveryChannels: [{ ...channel, enabled: false }] });
        else {
          change({ discoveryChannels: [] });
          if (transition === 'delete-recreate') change({ discoveryChannels: [channel] });
        }
      });
      expect(mocks.load.mock.calls[0][4].aborted).toBe(true);
      const countAfterTransition = old.setDiscoveryLoading.mock.calls.length;
      await act(async () => { load.resolve(data); await pending; });
      expect(old.setDiscoveryRepos).not.toHaveBeenCalled();
      expect(old.setDiscoveryLastRefresh).not.toHaveBeenCalled();
      expect(old.setDiscoveryLoading).toHaveBeenCalledTimes(countAfterTransition);
      expect(listeners.size).toBe(0);
    },
  );
  it('supersedes the same channel request without stale finally resetting a new spinner', async () => {
    const first = deferred();
    const second = deferred();
    mocks.load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useExternalFeedLoading());
    let one!: Promise<void>;
    let two!: Promise<void>;
    act(() => { one = result.current('external:one', api); });
    act(() => { two = result.current('external:one', api); });
    expect(mocks.load.mock.calls[0][4].aborted).toBe(true);
    await act(async () => { first.resolve(data); await one; });
    expect(state.setDiscoveryLoading).toHaveBeenLastCalledWith('external:one', true);
    expect(state.setDiscoveryRepos).not.toHaveBeenCalled();
    await act(async () => { second.resolve(data); await two; });
    expect(state.setDiscoveryRepos).toHaveBeenCalledOnce();
    expect(state.setDiscoveryLoading).toHaveBeenLastCalledWith('external:one', false);
  });
  it('preserves existing cards and exposes failures for retry', async () => {
    mocks.load.mockRejectedValue(new Error('CORS failure'));
    const { result } = renderHook(() => useExternalFeedLoading());
    await act(async () => { await result.current('external:one', api); });
    expect(state.setDiscoveryRepos).not.toHaveBeenCalled();
    expect(state.setDiscoveryLoadMoreError).toHaveBeenLastCalledWith('external:one', 'CORS failure');
    expect(state.setDiscoveryLoading).toHaveBeenLastCalledWith('external:one', false);
  });
  it.each(['account', 'delete'] as const)('stops metadata writes when a synchronous subscriber performs %s during result publication', async transition => {
    const old = state;
    old.setDiscoveryRepos.mockImplementation(() => {
      change(transition === 'account'
        ? { user: { id: 8 }, githubToken: 'new-token', discoveryChannels: [] }
        : { discoveryChannels: [] });
    });
    const { result } = renderHook(() => useExternalFeedLoading());
    await act(async () => { await result.current('external:one', api); });
    expect(old.setDiscoveryRepos).toHaveBeenCalledOnce();
    expect(old.setDiscoveryHasMore).not.toHaveBeenCalled();
    expect(old.setDiscoveryNextPage).not.toHaveBeenCalled();
    expect(old.setDiscoveryTotalCount).not.toHaveBeenCalled();
    expect(old.setDiscoveryLastRefresh).not.toHaveBeenCalled();
    expect(old.setDiscoveryLoading).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });
  it('does not clear another account error or start transport if loading publication switches accounts', async () => {
    const old = state;
    old.setDiscoveryLoading.mockImplementation(() => {
      change({ user: { id: 8 }, githubToken: 'new-token', discoveryChannels: [] });
    });
    const { result } = renderHook(() => useExternalFeedLoading());
    await act(async () => { await result.current('external:one', api); });
    expect(old.setDiscoveryLoadMoreError).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
  it('does not load removed or disabled feeds and aborts pending work on unmount', async () => {
    const load = deferred();
    mocks.load.mockReturnValue(load.promise);
    const { result, unmount } = renderHook(() => useExternalFeedLoading());
    await result.current('external:missing', api);
    expect(mocks.load).not.toHaveBeenCalled();
    let pending!: Promise<void>;
    act(() => { pending = result.current('external:one', api); });
    unmount();
    expect(mocks.load.mock.calls[0][4].aborted).toBe(true);
    load.resolve(data);
    await pending;
    expect(state.setDiscoveryRepos).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
});
