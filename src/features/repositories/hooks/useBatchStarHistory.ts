import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import {
  batchStarHistoryKey, normalizeBatchStarHistory, readBatchStarHistory, writeBatchStarHistory,
  type BatchStarHistoryEntry,
} from '../../../services/batchStarHistoryStorage';

export function useBatchStarHistory() {
  const accountId = useAppStore(state => state.user?.id);
  const generationRef = useRef(0);
  const generation = generationRef.current;
  const [state, setState] = useState<{ accountId: typeof accountId; history: BatchStarHistoryEntry[]; error: boolean }>({ accountId, history: [], error: false });

  useEffect(() => {
    const unsubscribe = useAppStore.subscribe((next, previous) => {
      if (next.user?.id !== previous.user?.id) {
        generationRef.current += 1;
        setState({ accountId: next.user?.id, history: [], error: false });
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const refresh = () => {
      try {
        setState({ accountId, history: accountId == null ? [] : readBatchStarHistory(String(accountId)), error: false });
      } catch {
        setState({ accountId, history: [], error: true });
      }
    };
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (accountId != null && (event.key === null || event.key === batchStarHistoryKey(String(accountId)))) refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [accountId, generation]);

  // Bind callbacks to the rendered account; an old callback must not write to a new account.
  const save = useCallback((update: (entries: BatchStarHistoryEntry[]) => BatchStarHistoryEntry[]) => {
    if (accountId == null || generationRef.current !== generation
      || useAppStore.getState().user?.id !== accountId) return false;
    try {
      const next = normalizeBatchStarHistory(update(readBatchStarHistory(String(accountId))));
      writeBatchStarHistory(String(accountId), next);
      setState({ accountId, history: next, error: false });
      return true;
    } catch {
      setState({ accountId, history: [], error: true });
      return false;
    }
  }, [accountId, generation]);

  const record = (text: string, previousText?: string) => text.trim() ? save(entries => [
    { text, generatedAt: Date.now() },
    ...entries.filter(entry => entry.text !== text && entry.text !== previousText),
  ]) : false;
  const edit = (previousText: string, text: string) => text.trim()
    ? save(entries => entries.map(entry => entry.text === previousText ? { ...entry, text } : entry)) : false;

  return {
    accountId, generation, history: state.accountId === accountId ? state.history : [],
    historyError: state.accountId === accountId && state.error, record, edit,
  };
}
