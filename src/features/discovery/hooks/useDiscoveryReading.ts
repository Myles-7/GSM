import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { DiscoveryChannelId, DiscoveryRepo } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { defaultReadingPreferences, workspaceSessionKey, type DiscoveryReadingAnchor, type DiscoveryReadingPreferences } from '../workspace/model';
import { clearDiscoveryList, loadBrowseSession, loadReadingAnchor, loadReadingPreferences, resetReadingAnchor, saveReadingAnchor, saveReadingPreferences } from '../workspace/storage';

function independentReadingEvent(event: Event) {
  return event.target instanceof Element && !!event.target.closest('[role="dialog"], [role="alertdialog"], [data-independent-reading], input, textarea, select, [contenteditable="true"]');
}

export function useChannelReadingPreferences(account: string, channelId: string, defaults?: Partial<DiscoveryReadingPreferences>) {
  const [preferences, setPreferences] = useState<DiscoveryReadingPreferences>({ ...defaultReadingPreferences(), ...defaults });
  const [ready, setReady] = useState(false);
  const [issue, setIssue] = useState(false);
  const defaultsRef = useRef(defaults); defaultsRef.current = defaults;
  const inheritedAuto = defaults?.autoAnalyze;
  const inheritedLimit = defaults?.autoAnalysisLimit;
  useEffect(() => {
    let alive = true; setReady(false); setIssue(false);
    if (!account) return;
    void loadReadingPreferences(account, channelId, defaultsRef.current).then(value => {
      if (alive) { setPreferences(value); setReady(true); }
    }).catch(() => { if (alive) { setPreferences({ ...defaultReadingPreferences(), ...defaultsRef.current }); setIssue(true); setReady(true); } });
    return () => { alive = false; };
  }, [account, channelId, inheritedAuto, inheritedLimit]);
  const save = useCallback(async (value: DiscoveryReadingPreferences) => {
    await saveReadingPreferences(account, channelId, value); setPreferences(value); setIssue(false);
  }, [account, channelId]);
  return { preferences, ready, issue, setIssue, save };
}

/** Read positions use item identity; layout shifts are corrected until deliberate user input. */
export function useReadingAnchor(account: string, sessionKey: string, root: RefObject<HTMLElement | null>, enabled: boolean, ready: boolean) {
  const [issue, setIssue] = useState(false);
  const anchorRef = useRef<DiscoveryReadingAnchor>();
  const settled = useRef(false);
  const token = useRef(0);
  const persist = useCallback(() => {
    if (!account || !root.current || !settled.current) return;
    const nodes = [...root.current.querySelectorAll<HTMLElement>('[data-reading-key]')];
    const index = nodes.findIndex(node => node.getBoundingClientRect().bottom > 90);
    const node = nodes[index]; if (!node) return;
    const anchor: DiscoveryReadingAnchor = { sessionKey, itemKey: node.dataset.readingKey!, offset: node.getBoundingClientRect().top,
      previousKeys: Array.from({ length: 5 }, (_, distance) => [nodes[index + distance + 1], nodes[index - distance - 1]])
        .flat().filter((n): n is HTMLElement => !!n).map(n => n.dataset.readingKey!), updatedAt: Date.now() };
    anchorRef.current = anchor;
    void saveReadingAnchor(account, anchor).catch(() => setIssue(true));
  }, [account, sessionKey, root]);
  useEffect(() => {
    if (!ready || !account || !root.current) return;
    let alive = true; let desired: DiscoveryReadingAnchor | undefined; let correcting = enabled;
    const current = ++token.current; settled.current = false; setIssue(false);
    let timer: ReturnType<typeof setTimeout>;
    const find = () => {
      const nodes = new Map([...(root.current?.querySelectorAll<HTMLElement>('[data-reading-key]') || [])].map(node => [node.dataset.readingKey, node]));
      return nodes.get(desired?.itemKey) || desired?.previousKeys.map(key => nodes.get(key)).find(Boolean);
    };
    const restore = () => {
      if (!alive || !correcting || !desired) return;
      const node = find(); if (!node) return;
      const delta = node.getBoundingClientRect().top - desired.offset;
      if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'auto' });
    };
    const onIntent = (event: Event) => {
      if (independentReadingEvent(event)) return;
      if (event instanceof KeyboardEvent && !['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) return;
      if (typeof PointerEvent !== 'undefined' && event instanceof PointerEvent && event.clientX < document.documentElement.clientWidth) return;
      correcting = false; settled.current = true;
    };
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        persist();
        desired = anchorRef.current;
        correcting = enabled && !!desired;
      }, 250);
    };
    const explicitRestore = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.account === account && detail.sessionKey === sessionKey) { desired = anchorRef.current; correcting = true; requestAnimationFrame(restore); }
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(restore) : null;
    observer?.observe(root.current);
    window.addEventListener('wheel', onIntent, { passive: true }); window.addEventListener('touchstart', onIntent, { passive: true });
    window.addEventListener('keydown', onIntent); window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointerdown', onIntent, { passive: true });
    window.addEventListener('pagehide', persist);
    window.addEventListener('gsm:discovery-restore-anchor', explicitRestore);
    void loadReadingAnchor(account, sessionKey).then(saved => {
      if (!alive || token.current !== current) return;
      desired = saved; anchorRef.current = saved;
      requestAnimationFrame(() => {
        if (!alive) return;
        if (enabled && correcting && desired) restore(); else if (enabled && correcting) window.scrollTo({ top: 0, behavior: 'auto' });
        settled.current = true;
      });
    }).catch(() => { if (alive) { settled.current = true; setIssue(true); } });
    return () => {
      const last = anchorRef.current;
      if (last?.sessionKey === sessionKey) void saveReadingAnchor(account, last).catch(() => {});
      alive = false; clearTimeout(timer); observer?.disconnect();
      window.removeEventListener('wheel', onIntent); window.removeEventListener('touchstart', onIntent);
      window.removeEventListener('keydown', onIntent); window.removeEventListener('scroll', onScroll); window.removeEventListener('pagehide', persist);
      window.removeEventListener('pointerdown', onIntent);
      window.removeEventListener('gsm:discovery-restore-anchor', explicitRestore);
    };
  }, [account, sessionKey, root, enabled, ready, persist]);
  const reset = useCallback(async () => {
    await resetReadingAnchor(account, sessionKey); anchorRef.current = undefined; settled.current = true;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [account, sessionKey]);
  return { issue, reset, persist };
}

export function useDiscoveryBrowseRestore(account: string, channelId: DiscoveryChannelId, signature: string, enabled: boolean) {
  const key = workspaceSessionKey(channelId, signature);
  const identity = `${account}:${key}`;
  const [restoredKey, setRestoredKey] = useState('');
  const [issue, setIssue] = useState(false);
  useEffect(() => {
    let alive = true; setIssue(false);
    if (!enabled || !account || channelId === 'code-search') { setRestoredKey(identity); return; }
    void loadBrowseSession(account, key).then(saved => {
      if (!alive || String(useAppStore.getState().user?.id) !== account) return;
      const state = useAppStore.getState();
      if (saved) {
        state.setDiscoveryRepos(channelId, saved.items as unknown as DiscoveryRepo[]);
        state.setDiscoveryNextPage(channelId, saved.session.nextPage);
        state.setDiscoveryHasMore(channelId, saved.session.hasMore || saved.session.bufferKeys.length > 0);
        state.setDiscoveryTotalCount(channelId, saved.session.totalCount);
        if (saved.session.refreshedAt) state.setDiscoveryLastRefresh(channelId, saved.session.refreshedAt);
      } else {
        state.setDiscoveryRepos(channelId, []); state.setDiscoveryNextPage(channelId, 1);
        useAppStore.setState(s => ({ discoveryLastRefresh: { ...s.discoveryLastRefresh, [channelId]: null } })); state.setDiscoveryHasMore(channelId, false); state.setDiscoveryTotalCount(channelId, 0);
      }
      state.setDiscoveryLoadMoreError(channelId, null); setRestoredKey(identity);
    }).catch(() => { if (alive) { setIssue(true); setRestoredKey(identity); } });
    return () => { alive = false; };
  }, [account, channelId, signature, key, enabled, identity]);
  const clear = useCallback(async () => {
    await clearDiscoveryList(account, key);
    useAppStore.getState().setDiscoveryRepos(channelId, []);
    useAppStore.getState().setDiscoveryNextPage(channelId, 1);
    useAppStore.getState().setDiscoveryHasMore(channelId, false);
    useAppStore.getState().setDiscoveryTotalCount(channelId, 0);
    useAppStore.setState(s => ({ discoveryLastRefresh: { ...s.discoveryLastRefresh, [channelId]: null } }));
  }, [account, key, channelId]);
  return { key, ready: restoredKey === identity, issue, clear };
}

export function useAutomaticDiscoveryLoading(root: RefObject<HTMLElement | null>, enabled: boolean, loading: boolean, hasMore: boolean, error: boolean, loadMore: () => void, identity: string) {
  const callback = useRef(loadMore); callback.current = loadMore;
  const intent = useRef(false);
  useEffect(() => { intent.current = false; }, [identity]);
  useEffect(() => {
    if (!enabled || !root.current || !hasMore || error || loading) return;
    const onIntent = (event: Event) => {
      if (independentReadingEvent(event)) return;
      if (event instanceof WheelEvent && event.deltaY <= 0) return;
      if (event instanceof KeyboardEvent && !['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) return;
      if (typeof PointerEvent !== 'undefined' && event instanceof PointerEvent && event.clientX < document.documentElement.clientWidth) return;
      intent.current = true;
      requestAnimationFrame(check);
    };
    const check = () => {
      if (intent.current && root.current && root.current.getBoundingClientRect().bottom < window.innerHeight + 300) {
        intent.current = false; callback.current();
      }
    };
    window.addEventListener('wheel', onIntent, { passive: true }); window.addEventListener('touchmove', onIntent, { passive: true });
    window.addEventListener('keydown', onIntent); window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('pointerdown', onIntent, { passive: true });
    return () => { window.removeEventListener('wheel', onIntent); window.removeEventListener('touchmove', onIntent); window.removeEventListener('keydown', onIntent); window.removeEventListener('scroll', check); window.removeEventListener('pointerdown', onIntent); };
  }, [root, enabled, loading, hasMore, error, identity]);
}
