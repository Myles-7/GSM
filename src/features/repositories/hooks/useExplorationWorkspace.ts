import { useCallback, useSyncExternalStore } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ExplorationCamera, SavedExploration } from '../exploration/types';

const owners = new Map<string, Map<string, unknown>>();
const listeners = new Set<() => void>();
const panelKeys = new Set(['sidebar', 'results', 'commands', 'status', 'unified-panel']);
const defaults = new Map<string, unknown>();
interface ViewportSnapshot { camera?: ExplorationCamera; positions?: SavedExploration['layoutPositions']; selection?: number | null; scrollTop?: number; visibleCount?: number }
const viewports = new Map<string, ViewportSnapshot>();
export const explorationViewportCache = {
  read: (owner: string) => viewports.get(owner),
  write: (owner: string, value: ViewportSnapshot) => { viewports.set(owner, { ...viewports.get(owner), ...value }); },
};
export function clearExplorationWorkspace() { owners.clear(); defaults.clear(); viewports.clear(); }
/** Small UI snapshots survive view unmounts; no repository trees or DOM nodes are retained. */
export function useExplorationWorkspace<T>(owner: string, key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const identity = `${owner}:${key}`;
  if (!defaults.has(identity)) defaults.set(identity, initial);
  if (!owners.has(owner)) {
    const values = new Map<string, unknown>();
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(`gsm:exploration-panels:v1:${encodeURIComponent(owner)}`) ?? '{}');
      if (saved && typeof saved === 'object') for (const name of panelKeys) if (typeof (saved as Record<string, unknown>)[name] === 'boolean') values.set(name, (saved as Record<string, unknown>)[name]);
    } catch { /* Optional presentation preferences do not block browsing. */ }
    try {const id=localStorage.getItem(`gsm:exploration-active:v1:${encodeURIComponent(owner)}`);if(id)values.set('workspace-id',id);}catch { /* Optional last workspace preference. */ }
    owners.set(owner, values);
  }
  const values = owners.get(owner)!;
  const read = useCallback(() => (values.has(key) ? values.get(key) : defaults.get(identity)) as T, [values, key, identity]);
  const value = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, read, read);
  const set: Dispatch<SetStateAction<T>> = useCallback(update => {
    const next = typeof update === 'function' ? (update as (previous: T) => T)(read()) : update;
    if (Object.is(next, read())) return;
    values.set(key, next);
    if(key==='workspace-id')try{localStorage.setItem(`gsm:exploration-active:v1:${encodeURIComponent(owner)}`,String(next));}catch { /* In-memory state remains available. */ }
    if (panelKeys.has(key)) try { localStorage.setItem(`gsm:exploration-panels:v1:${encodeURIComponent(owner)}`, JSON.stringify(Object.fromEntries([...values].filter(([name]) => panelKeys.has(name))))); } catch { /* Memory state remains usable. */ }
    listeners.forEach(listener => listener());
  }, [values, key, read, owner]);
  return [value, set];
}
