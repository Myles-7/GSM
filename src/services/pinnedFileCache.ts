interface Entry<T> { value: T; at: number; }
const cache = new Map<string, Entry<unknown>>();

/** In-memory only. Account and token changes clear the cache at the runner boundary. */
let currentIdentity = '';
export function bindFileCacheIdentity(identity: string) {
  if (identity !== currentIdentity) { currentIdentity = identity; cache.clear(); }
}
export async function readPinnedFile<T>(key: string, signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const identity = currentIdentity;
  if (!identity) {
    const value = await read();
    signal.throwIfAborted();
    return value;
  }
  const prior = cache.get(key) as Entry<T> | undefined;
  if (prior && Date.now() - prior.at < 10 * 60_000) return prior.value;
  const value = await read();
  signal.throwIfAborted();
  if (identity === currentIdentity) {
    if (cache.size >= 80) cache.delete(cache.keys().next().value!);
    cache.set(key, { value, at: Date.now() });
  }
  return value;
}
