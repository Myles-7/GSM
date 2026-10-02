import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useT } from '../../../i18n/useT';
import { readExternalDiscoveryFeed, readExternalDiscoveryRssFeed } from '../../../services/externalDiscoveryFeed';
import { isExternalDiscoveryChannelId, MAX_EXTERNAL_FEEDS, normalizeDiscoveryFeedUrl } from '../../../services/externalFeedConfig';
import { ExternalFeedError } from '../../../services/externalFeedErrors';
import type { ExternalDiscoveryChannelId, ExternalFeedKind } from '../../../types/externalFeed';
import { startExternalFeedRequest } from '../application/externalFeedRequest';

export function useExternalFeed() {
  const t = useT('discovery');
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<ReturnType<typeof startExternalFeedRequest> | null>(null);
  const cancel = useCallback(() => {
    const request = requestRef.current;
    requestRef.current = null;
    request?.cancel();
    request?.finish();
  }, []);
  useEffect(() => cancel, [cancel]);

  const add = async (name: string, input: string, kind: ExternalFeedKind = 'json'): Promise<boolean> => {
    cancel();
    setIsChecking(false);
    setError('');
    const sourceUrl = normalizeDiscoveryFeedUrl(input);
    if (!sourceUrl || !name.trim() || name.trim().length > 60 || !['json', 'rss'].includes(kind)) {
      setError(t('externalFeeds.invalid', { defaultValue: 'Enter a name and a public HTTPS feed URL.' }));
      return false;
    }
    const state = useAppStore.getState();
    const feeds = state.discoveryChannels.filter(channel => isExternalDiscoveryChannelId(channel.id));
    if (!state.user) {
      setError(t('externalFeeds.account', { defaultValue: 'Sign in before adding a feed.' }));
      return false;
    }
    if (feeds.some(channel => channel.sourceUrl === sourceUrl) || feeds.length >= MAX_EXTERNAL_FEEDS) {
      setError(t('externalFeeds.duplicate', { defaultValue: 'This feed already exists or the 10-feed limit was reached.' }));
      return false;
    }
    const request = startExternalFeedRequest(useAppStore);
    requestRef.current = request;
    const onAbort = () => {
      if (requestRef.current === request) { setIsChecking(false); setError(''); }
    };
    request.signal.addEventListener('abort', onAbort, { once: true });
    setIsChecking(true);
    try {
      await (kind === 'rss'
        ? readExternalDiscoveryRssFeed(sourceUrl, request.signal)
        : readExternalDiscoveryFeed(sourceUrl, request.signal));
      if (!request.isCurrent()) return false;
      if (!useAppStore.getState().addExternalDiscoveryChannel(name.trim(), sourceUrl, kind, request.accountId)) {
        setError(t('externalFeeds.duplicate', { defaultValue: 'This feed already exists or the 10-feed limit was reached.' }));
        return false;
      }
      return true;
    } catch (cause) {
      if (!request.isCurrent()) return false;
      const fallback = cause instanceof Error ? cause.message : 'Could not read the feed.';
      const key = cause instanceof ExternalFeedError ? cause.code
        : cause instanceof DOMException && cause.name === 'TimeoutError' ? 'timeout' : 'unreadable';
      setError(t(`externalFeeds.errors.${key}`, { defaultValue: key === 'timeout' ? 'The feed request timed out after 15 seconds.' : fallback }));
      return false;
    } finally {
      request.signal.removeEventListener('abort', onAbort);
      request.finish();
      if (requestRef.current === request) {
        requestRef.current = null;
        setIsChecking(false);
      }
    }
  };

  const remove = (id: ExternalDiscoveryChannelId) => {
    if (isExternalDiscoveryChannelId(id)) useAppStore.getState().removeExternalDiscoveryChannel(id);
  };
  return { add, remove, isChecking, error, clearError: () => setError('') };
}
