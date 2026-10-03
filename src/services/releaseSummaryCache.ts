import { create } from 'zustand';
import { z } from 'zod';
import { indexedDBStorage } from './indexedDbStorage';

const entry = z.object({ content: z.string(), source: z.string(), at: z.string() });
type Entry = z.infer<typeof entry>;
const useCache = create<{ records: Record<string, Record<number, Entry>> }>(() => ({ records: {} }));
const loaded = new Set<string>();
const writes = new Map<string, Promise<void>>();
const storageKey = (owner: string) => `gsm:release-summary-cache:${encodeURIComponent(owner)}`;
export const useReleaseSummaryCache = (owner: string) => useCache(state => state.records[owner]);
export async function loadReleaseSummaryCache(owner: string) {
  if (!owner || loaded.has(owner)) return;
  loaded.add(owner);
  try {
    const raw = await indexedDBStorage.getItem(storageKey(owner));
    if (!raw) return;
    const records = z.record(z.string(), entry).parse(JSON.parse(raw));
    useCache.setState(state => ({ records: { ...state.records, [owner]: { ...records, ...state.records[owner] } } }));
  } catch { loaded.delete(owner); }
}
export function saveReleaseSummaryCache(owner: string, id: number, content: string, source: string): Promise<void> {
  if (!owner) return Promise.resolve();
  useCache.setState(state => ({ records: { ...state.records, [owner]: { ...state.records[owner], [id]: { content, source, at: new Date().toISOString() } } } }));
  const pending = (writes.get(owner) ?? Promise.resolve()).catch(() => {}).then(() =>
    indexedDBStorage.setItem(storageKey(owner), JSON.stringify(useCache.getState().records[owner]))).then(() => {});
  writes.set(owner, pending);
  return pending;
}
