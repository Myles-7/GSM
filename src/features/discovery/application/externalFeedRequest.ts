import type { ExternalFeedConfiguration } from '../../../types/externalFeed';

interface FeedSessionState {
  user: { id: number } | null;
  githubToken: string | null;
  discoveryChannels: Array<{ id: string; enabled: boolean } & ExternalFeedConfiguration>;
}

interface FeedSessionStore {
  getState(): FeedSessionState;
  subscribe(listener: (state: FeedSessionState) => void): () => void;
}

/** Observe synchronous transitions, including an away-and-back inside one React batch. */
export function startExternalFeedRequest(store: FeedSessionStore, channelId?: string) {
  const initial = store.getState();
  const accountId = initial.user?.id;
  const token = initial.githubToken;
  const channel = channelId ? initial.discoveryChannels.find(item => item.id === channelId) : undefined;
  const controller = new AbortController();
  let alive = true;
  const matches = (state: FeedSessionState) => {
    if (state.user?.id !== accountId || state.githubToken !== token) return false;
    if (!channelId) return true;
    const current = state.discoveryChannels.find(item => item.id === channelId);
    return !!channel && !!current && current.enabled
      && current.sourceUrl === channel.sourceUrl && current.sourceKind === channel.sourceKind;
  };
  const cancel = () => controller.abort(new DOMException('Feed request cancelled', 'AbortError'));
  const unsubscribe = store.subscribe(state => { if (!matches(state)) cancel(); });
  if (!accountId || !matches(store.getState())) cancel();
  return {
    accountId,
    signal: controller.signal,
    isCurrent: () => alive && !controller.signal.aborted && matches(store.getState()),
    cancel,
    finish: () => { alive = false; unsubscribe(); },
  };
}
