import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryChannelId } from '../../../types';
const mocks = vi.hoisted(() => ({ state: {
  discoveryRepos: {} as Record<string, unknown[]>, discoveryLastRefresh: {} as Record<string, string>,
  discoveryIsLoading: {} as Record<string, boolean>, discoveryLoadMoreError: {} as Record<string, string>,
} }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => mocks.state } }));
import { useDiscoveryEntryLoading } from './useDiscoveryEntryLoading';
beforeEach(() => { for (const key of Object.keys(mocks.state) as (keyof typeof mocks.state)[]) mocks.state[key] = {}; });
afterEach(cleanup);
describe('cache-first channel entry', () => {
  it('loads an untouched channel once, including empty or failed rounds, rather than on every switch', () => {
    const refresh = vi.fn();
    const { rerender } = renderHook(({ id }: { id: DiscoveryChannelId }) => useDiscoveryEntryLoading('account-a', id, true, refresh), { initialProps: { id: 'trending' as DiscoveryChannelId } });
    rerender({ id: 'most-popular' }); rerender({ id: 'trending' });
    expect(refresh.mock.calls.map(call => call[0])).toEqual(['trending', 'most-popular']);
  });
  it('preserves populated, successfully empty and failed caches on remount', () => {
    const refresh = vi.fn();
    mocks.state.discoveryRepos.trending = [{}]; mocks.state.discoveryLastRefresh.topic = 'today'; mocks.state.discoveryLoadMoreError.weekly = 'offline';
    for (const id of ['trending', 'topic', 'weekly'] as const) {
      const { unmount } = renderHook(() => useDiscoveryEntryLoading('account-a', id, true, refresh)); unmount();
    }
    expect(refresh).not.toHaveBeenCalled();
  });
  it('does not fetch hidden builtin channels, code search or signed-out sessions', () => {
    const refresh = vi.fn();
    renderHook(() => useDiscoveryEntryLoading('account-a', 'trending', false, refresh));
    renderHook(() => useDiscoveryEntryLoading('account-a', 'code-search', true, refresh));
    renderHook(() => useDiscoveryEntryLoading('', 'trending', true, refresh));
    expect(refresh).not.toHaveBeenCalled();
  });
  it('resets attempt ownership on account switch', () => {
    const refresh = vi.fn();
    const { rerender } = renderHook(({ identity }) => useDiscoveryEntryLoading(identity, 'trending', true, refresh), { initialProps: { identity: 'a' } });
    rerender({ identity: 'b' }); expect(refresh).toHaveBeenCalledTimes(2);
  });
});
