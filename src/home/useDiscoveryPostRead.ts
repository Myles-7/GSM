import { useCallback, useEffect, useRef, useState } from 'react';
import { getDesktopHomeSync, subscribeDesktopHome } from './desktop';

/** Desktop source modals use the same account-scoped record as the phone. */
export function useDiscoveryPostRead(channelId: 'x-tweet' | 'telegram', postId: string, enabled: boolean) {
  const [isRead, setIsRead] = useState(false); const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const version = useRef(0); const generation = useRef(0); const writing = useRef(false);
  const id = `post:${channelId}:${postId}`;
  const refresh = useCallback(async () => {
    const turn = ++generation.current; const sync = getDesktopHomeSync();
    if (!enabled || !sync) { setAvailable(false); setIsRead(false); return; }
    const rows = await sync.db.allRecords();
    if (turn !== generation.current || getDesktopHomeSync() !== sync) return;
    const record = rows.find(row => row.collection === 'discovery_reads' && row.id === id);
    version.current = record?.version ?? 0;
    setAvailable(true); setIsRead(!record?.deleted && record?.data?.isRead === true);
  }, [enabled, id]);
  useEffect(() => {
    const load = () => { void refresh().catch(() => setError('Unable to load read status')); };
    load(); const unsubscribe = subscribeDesktopHome(load);
    return () => { generation.current++; unsubscribe(); };
  }, [refresh]);
  const mark = useCallback(async (value: boolean) => {
    const sync = getDesktopHomeSync(); if (!enabled || !sync || writing.current) return;
    writing.current = true; setBusy(true); setError('');
    try {
      await sync.db.edit('discovery_reads', id, { kind: 'post', channelId, isRead: value }, 'user', version.current);
      if (getDesktopHomeSync() !== sync) return;
      setIsRead(value); sync.changed();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save read status'); }
    finally { writing.current = false; setBusy(false); }
  }, [enabled, id, channelId]);
  return { isRead, available, busy, error, mark };
}
