import { useCallback, useEffect, useRef, useState } from 'react';
import { getDesktopHomeSync, subscribeDesktopHome } from './desktop';
import type { HomeSync } from './sync';

type View = { id: string; sync: HomeSync | null; isRead: boolean; available: boolean; busy: boolean; error: string };
type Scope = { id: string; active: boolean; sync: HomeSync | null; epoch: number; request: number; version: number; ready: boolean; writing: symbol | null };
const emptyView = (id: string, sync: HomeSync | null): View => ({ id, sync, isRead: false, available: false, busy: false, error: '' });

/** Desktop source modals use the same account-scoped record as the phone. */
export function useDiscoveryPostRead(channelId: 'x-tweet' | 'telegram', postId: string, enabled: boolean) {
  const id = `post:${channelId}:${postId}`;
  const [view, setView] = useState<View>(() => emptyView(id, null));
  const currentScope = useRef<Scope | null>(null);
  useEffect(() => {
    const scope: Scope = { id, active: true, sync: null, epoch: 0, request: 0, version: 0, ready: false, writing: null };
    currentScope.current = scope;
    setView(emptyView(id, null));
    const load = async () => {
      const sync = enabled ? getDesktopHomeSync() : null;
      if (scope.sync !== sync) {
        scope.sync = sync; scope.epoch++; scope.ready = false; scope.writing = null; scope.version = 0;
        setView(emptyView(id, sync));
      }
      const request = ++scope.request;
      if (!sync) return;
      const isCurrent = () => scope.active && request === scope.request && scope.sync === sync && getDesktopHomeSync() === sync;
      try {
        const record = await sync.db.getRecord('discovery_reads', id);
        if (!isCurrent()) return;
        scope.version = record?.version ?? 0;
        scope.ready = true;
        setView(previous => ({ ...previous, id, sync, available: true, error: '', isRead: !record?.deleted && record?.data?.isRead === true }));
      } catch {
        if (!isCurrent()) return;
        scope.ready = false;
        setView(previous => ({ ...previous, available: false, error: 'Unable to load read status' }));
      }
    };
    void load();
    const unsubscribe = subscribeDesktopHome(() => { void load(); });
    return () => { scope.active = false; unsubscribe(); };
  }, [enabled, id]);
  const mark = useCallback(async (value: boolean) => {
    const scope = currentScope.current;
    const sync = getDesktopHomeSync();
    if (!enabled || !scope?.active || scope.id !== id || !scope.ready || !sync || scope.sync !== sync || scope.writing) return;
    const operation = Symbol(id);
    const epoch = scope.epoch;
    const isCurrent = () => scope.active && currentScope.current === scope && scope.epoch === epoch && getDesktopHomeSync() === sync;
    scope.writing = operation;
    // A read started before the write must not undo the completed optimistic state.
    scope.request++;
    setView(previous => ({ ...previous, busy: true, error: '' }));
    try {
      await sync.db.edit('discovery_reads', id, { kind: 'post', channelId, isRead: value }, 'user', scope.version);
      if (getDesktopHomeSync() === sync) sync.changed();
      if (!isCurrent()) return;
      scope.request++;
      setView(previous => ({ ...previous, isRead: value }));
    } catch (reason) {
      if (isCurrent()) setView(previous => ({ ...previous, error: reason instanceof Error ? reason.message : 'Unable to save read status' }));
    } finally {
      if (scope.writing === operation) scope.writing = null;
      if (isCurrent()) setView(previous => ({ ...previous, busy: false }));
    }
  }, [enabled, id, channelId]);
  const visible = enabled && view.id === id && view.sync === getDesktopHomeSync() ? view : emptyView(id, null);
  return { isRead: visible.isRead, available: visible.available, busy: visible.busy, error: visible.error, mark };
}
