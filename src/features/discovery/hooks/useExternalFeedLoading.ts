import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { loadExternalDiscoveryFeed, type ExternalFeedRepositoryApi } from '../../../services/externalDiscoveryFeed';
import type { ExternalDiscoveryChannelId } from '../../../types/externalFeed';
import { startExternalFeedRequest } from '../application/externalFeedRequest';

/** External feeds never enter Custom Discovery's database, AI runner or scheduler. */
export function useExternalFeedLoading() {
  const requests = useRef(new Map<string, ReturnType<typeof startExternalFeedRequest>>());
  useEffect(() => {
    const pending = requests.current;
    return () => {
      const previous = [...pending.values()];
      pending.clear();
      for (const request of previous) { request.cancel(); request.finish(); }
    };
  }, []);
  return useCallback(async (channelId: ExternalDiscoveryChannelId, api: ExternalFeedRepositoryApi) => {
    const state = useAppStore.getState();
    const channel = state.discoveryChannels.find(item => item.id === channelId);
    if (!channel?.enabled || !channel.sourceUrl || !state.user) return;
    const previous = requests.current.get(channelId);
    requests.current.delete(channelId);
    previous?.cancel();
    previous?.finish();
    const request = startExternalFeedRequest(useAppStore, channelId);
    requests.current.set(channelId, request);
    const isCurrent = () => requests.current.get(channelId) === request && request.isCurrent();
    const onAbort = () => {
      const current = useAppStore.getState();
      if (requests.current.get(channelId) === request && current.user?.id === state.user?.id
        && current.githubToken === state.githubToken && current.discoveryChannels.some(item => item.id === channelId)) {
        current.setDiscoveryLoading(channelId, false);
      }
    };
    request.signal.addEventListener('abort', onAbort, { once: true });
    // Store subscribers can synchronously switch accounts or delete the channel.
    const publish = (write: (current: ReturnType<typeof useAppStore.getState>) => void) => {
      if (!isCurrent()) return false;
      write(useAppStore.getState());
      return isCurrent();
    };
    try {
      if (!publish(current => current.setDiscoveryLoading(channelId, true))) return;
      if (!publish(current => current.setDiscoveryLoadMoreError(channelId, null))) return;
      const result = await loadExternalDiscoveryFeed(channel.sourceUrl, channelId, api, channel.sourceKind, request.signal);
      if (!publish(current => current.setDiscoveryRepos(channelId, result.repos))) return;
      if (!publish(current => current.setDiscoveryHasMore(channelId, false))) return;
      if (!publish(current => current.setDiscoveryNextPage(channelId, result.nextPageIndex))) return;
      if (!publish(current => current.setDiscoveryTotalCount(channelId, result.totalCount))) return;
      publish(current => current.setDiscoveryLastRefresh(channelId, new Date().toISOString()));
    } catch (cause) {
      if (!isCurrent()) return;
      useAppStore.getState().setDiscoveryLoadMoreError(channelId,
        cause instanceof Error ? cause.message : 'Could not read the feed.');
    } finally {
      request.signal.removeEventListener('abort', onAbort);
      if (isCurrent()) useAppStore.getState().setDiscoveryLoading(channelId, false);
      request.finish();
      if (requests.current.get(channelId) === request) requests.current.delete(channelId);
    }
  }, []);
}
