import type { StateStorage } from 'zustand/middleware';

export const DB_NAME = 'github-stars-manager-db';
const STORE_NAME = 'app_state';
const DB_VERSION = 1;

const canUseIndexedDB = () => typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

const safeLocalStorageGet = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeLocalStorageSet = (key: string, value: string): boolean => {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    // Quota/security errors are expected in some environments; report failure to caller.
    return false;
  }
};

const safeLocalStorageRemove = (key: string): void => {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
};

/** 仅对「打开数据库」设超时；事务本身由 oncomplete/onabort/onerror 保证收敛。 */
const openDb = (): Promise<IDBDatabase> => new Promise<IDBDatabase>((resolve, reject) => {
  let settled = false;
  const timer = setTimeout(() => { settled = true; reject(new Error('IndexedDB open timeout')); }, 2000);
  let request: IDBOpenDBRequest;
  try { request = window.indexedDB.open(DB_NAME, DB_VERSION); }
  catch (error) { clearTimeout(timer); reject(error); return; }

  request.onupgradeneeded = () => {
    if (settled) { request.transaction?.abort(); return; }
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME);
    }
  };

  request.onsuccess = () => { clearTimeout(timer); if (settled) request.result.close(); else { settled = true; resolve(request.result); } };
  request.onerror = () => { clearTimeout(timer); settled = true; reject(request.error); };
});

const idbGet = async (key: string): Promise<string | null> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);

    req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('[storage] IndexedDB read transaction aborted'));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
};

const idbSet = async (key: string, value: string): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('[storage] IndexedDB write transaction aborted'));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
};

const idbDelete = async (key: string): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('[storage] IndexedDB delete transaction aborted'));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
};

/** 单事务批量写入：所有键要么一起提交，要么一起回滚（分片持久化的原子提交点）。 */
const idbSetMany = async (entries: ReadonlyArray<readonly [string, string]>): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    let failure: unknown;

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(failure ?? tx.error ?? new Error('[storage] IndexedDB batch transaction aborted'));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    try { for (const [key, value] of entries) store.put(value, key); }
    catch (error) { failure = error; tx.abort(); }
  });
};

export class StorageGenerationConflictError extends Error {
  readonly code = 'PERSISTENCE_GENERATION_CONFLICT';
  constructor() {
    super('Persistence generation changed in another tab');
    this.name = 'StorageGenerationConflictError';
  }
}

/**
 * Atomic compare-and-write for the sharded Store lineage. IndexedDB serializes
 * readwrite transactions on the same object store, so a concurrent clear that
 * advances the generation either happens entirely before this transaction
 * (and the comparison rejects) or entirely after it (and the clear wins).
 */
const idbSetManyGuarded = async (
  entries: ReadonlyArray<readonly [string, string]>,
  generationKey: string,
  expectedGeneration: string | null,
  alternateExpectedGeneration?: string | null,
): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    let failure: unknown;
    const guard = store.get(generationKey);

    guard.onerror = () => { failure = guard.error; tx.abort(); };
    guard.onsuccess = () => {
      const current = (guard.result as string | undefined) ?? null;
      if (current !== expectedGeneration
        && (alternateExpectedGeneration === undefined || current !== alternateExpectedGeneration)) {
        failure = new StorageGenerationConflictError();
        tx.abort();
        return;
      }
      try { for (const [key, value] of entries) store.put(value, key); }
      catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(failure ?? tx.error ?? new Error('[storage] IndexedDB guarded write transaction aborted')); };
    tx.onerror = () => { if (!failure) failure = tx.error; };
  });
};

/** 单连接 + 单 readonly 事务批量读取，避免水合阶段并发打开多个连接。 */
const idbGetMany = async (keys: ReadonlyArray<string>): Promise<Array<string | null>> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const results: Array<string | null> = new Array(keys.length).fill(null);
    keys.forEach((key, index) => {
      const req = store.get(key);
      req.onsuccess = () => {
        results[index] = (req.result as string | undefined) ?? null;
      };
      req.onerror = () => reject(req.error);
    });

    tx.oncomplete = () => {
      db.close();
      resolve(results);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('[storage] IndexedDB batch read transaction aborted'));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
};

/** 只探测键是否存在（不传输值），用于廉价的 legacy 快照存在性检查。 */
const idbHasKey = async (key: string): Promise<boolean> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getKey(key);

    req.onsuccess = () => resolve(req.result !== undefined);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('[storage] IndexedDB key probe aborted'));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
};

/** 删除精确键及其全部派生键（`${name}#` 前缀：分片与 meta）。 */
const idbDeleteWithDerivedKeys = async (name: string): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(name);
    if (typeof IDBKeyRange !== 'undefined') {
      store.delete(IDBKeyRange.bound(`${name}#`, `${name}#\uffff`));
    }

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('[storage] IndexedDB delete transaction aborted'));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
};

/** Clear a Store and advance its lineage fence in the same IDB transaction. */
const idbReplaceWithGeneration = async (name: string, generationKey: string, generation: string): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(name);
    if (typeof IDBKeyRange !== 'undefined') store.delete(IDBKeyRange.bound(`${name}#`, `${name}#\uffff`));
    store.put(generation, generationKey);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('[storage] IndexedDB generation reset transaction aborted')); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
};

const safeLocalStorageRemoveByPrefix = (prefix: string): void => {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // ignore
  }
};

const safeLocalStorageRemoveWithDerivedKeys = (name: string): void => {
  safeLocalStorageRemove(name);
  safeLocalStorageRemoveByPrefix(`${name}#`);
};

/**
 * localStorage 兜底权威标记：IndexedDB 批量写失败而回退写入成功时置位，
 * 表示「这些键的最新已提交值在 localStorage，读取必须优先 localStorage」。
 * 下一次 IndexedDB 写入成功、且 localStorage 不再持有任何派生数据键时清除
 * （仍有残留就保留，防止 IndexedDB 旧值遮蔽新值）。若不标记，读取端会继续
 * 优先返回 IndexedDB 中的旧值，localStorage 里的新值永远不会生效（状态静默回滚）。
 */
const fallbackMarkerKey = (name: string): string => `${name}#fallback`;

const strictLocalStorageGet = (key: string): string | null => window.localStorage.getItem(key);

/** New fallback batches use one atomic localStorage value, including authority. */
function readFallbackEntries(name: string): {
  marked: boolean;
  entries: Map<string, string>;
  resetGeneration?: string;
  resetFromGeneration?: string | null;
} {
  const raw = strictLocalStorageGet(fallbackMarkerKey(name));
  const entries = new Map<string, string>();
  if (raw === null) return { marked: false, entries };
  if (raw.startsWith('{')) {
    const parsed = JSON.parse(raw) as {
      format?: unknown;
      entries?: unknown;
      resetGeneration?: unknown;
      resetFromGeneration?: unknown;
    };
    if (parsed.format !== 1 || !parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) throw new Error('[storage] Invalid fallback snapshot');
    for (const [key, value] of Object.entries(parsed.entries)) {
      if (typeof value !== 'string' || key === fallbackMarkerKey(name) || (key !== name && !key.startsWith(name + '#'))) throw new Error('[storage] Invalid fallback entry');
      entries.set(key, value);
    }
    if (parsed.resetGeneration !== undefined) {
      if (typeof parsed.resetGeneration !== 'string'
        || (parsed.resetFromGeneration !== null && typeof parsed.resetFromGeneration !== 'string')) {
        throw new Error('[storage] Invalid fallback generation reset');
      }
      if (entries.get(`${name}#generation`) !== parsed.resetGeneration) throw new Error('[storage] Invalid fallback generation reset');
      return {
        marked: true,
        entries,
        resetGeneration: parsed.resetGeneration,
        resetFromGeneration: parsed.resetFromGeneration as string | null,
      };
    }
  } else {
    // Read compatibility for the original timestamp marker with separate keys.
    if (!Number.isFinite(Date.parse(raw))) throw new Error('[storage] Invalid fallback authority');
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key && key !== fallbackMarkerKey(name) && (key === name || key.startsWith(name + '#'))) {
        const value = strictLocalStorageGet(key);
        if (value !== null) entries.set(key, value);
      }
    }
  }
  return { marked: true, entries };
}

export const writeEntriesToFallbackStorage = async (name: string, entries: ReadonlyArray<readonly [string, string]>): Promise<void> => {
  const current = readFallbackEntries(name);
  const merged = current.entries;
  for (const [key, value] of entries) merged.set(key, value);
  if (current.resetGeneration && merged.get(`${name}#generation`) !== current.resetGeneration) {
    throw new StorageGenerationConflictError();
  }
  // setItem is atomic. Quota/denied authority writes leave the previous complete
  // envelope intact; there is no multi-key half-commit or unmarked new shard.
  window.localStorage.setItem(fallbackMarkerKey(name), JSON.stringify({
    format: 1,
    ...(current.resetGeneration ? {
      resetGeneration: current.resetGeneration,
      resetFromGeneration: current.resetFromGeneration ?? null,
    } : {}),
    entries: Object.fromEntries(merged),
  }));
};

export const setStorageEntries = async (name: string, entries: ReadonlyArray<readonly [string, string]>): Promise<void> => {
  if (typeof window === 'undefined') throw new Error('[storage] No browser storage available');
  if (entries.length === 0) return;
  const fallback = readFallbackEntries(name);
  const merged = new Map(fallback.entries);
  for (const [key, value] of entries) merged.set(key, value);
  if (canUseIndexedDB()) {
    try {
      // Promote the complete overlay and current batch together before retiring
      // its authority. Unchanged IDB shards remain in the same transaction.
      await idbSetMany([...merged]);
      for (const key of merged.keys()) window.localStorage.removeItem(key);
      window.localStorage.removeItem(fallbackMarkerKey(name));
      return;
    } catch (error) {
      console.warn('[storage] IndexedDB batch unavailable; preserving fallback authority');
      // No timeout races a live transaction: idbSetMany settles on abort/commit.
      void error;
    }
  }
  await writeEntriesToFallbackStorage(name, [...merged]);
};

/**
 * Generation-guarded variant used by sharded Zustand persistence. A generation
 * conflict is a correctness signal, never an IndexedDB availability failure,
 * and therefore must not be converted into a fallback write.
 */
export const setStorageEntriesGuarded = async (
  name: string,
  generationKey: string,
  expectedGeneration: string | null,
  entries: ReadonlyArray<readonly [string, string]>,
): Promise<void> => {
  if (typeof window === 'undefined') throw new Error('[storage] No browser storage available');
  if (entries.length === 0) return;
  const fallback = readFallbackEntries(name);
  const merged = new Map(fallback.entries);
  for (const [key, value] of entries) merged.set(key, value);

  if (canUseIndexedDB() && !fallback.marked) {
    try {
      await idbSetManyGuarded([...merged], generationKey, expectedGeneration);
      for (const key of merged.keys()) window.localStorage.removeItem(key);
      window.localStorage.removeItem(fallbackMarkerKey(name));
      return;
    } catch (error) {
      if (error instanceof StorageGenerationConflictError) throw error;
      console.warn('[storage] IndexedDB guarded batch unavailable; preserving fallback authority');
    }
  } else {
    // A fallback envelope is already authoritative (or IndexedDB is absent).
    // The caller holds the cross-tab mutation lock when available, so compare
    // against the merged authoritative view before promoting/writing it.
    const current = (await getStorageEntriesStrict(name, [generationKey]))[0];
    if (current !== expectedGeneration) throw new StorageGenerationConflictError();
    if (canUseIndexedDB()) {
      try {
        // If the first generation was committed only to fallback after an IDB
        // outage, the underlying IDB legitimately has no generation yet. That
        // is the only alternate value accepted; a different non-null lineage
        // still means another tab cleared/replaced the Store.
        const fallbackGeneration = fallback.entries.get(generationKey) ?? null;
        const resetFrom = fallback.resetGeneration === expectedGeneration
          ? fallback.resetFromGeneration
          : undefined;
        await idbSetManyGuarded(
          [...merged],
          generationKey,
          expectedGeneration,
          resetFrom !== undefined
            ? resetFrom
            : expectedGeneration !== null && fallbackGeneration === expectedGeneration
              ? null
              : undefined,
        );
        for (const key of merged.keys()) window.localStorage.removeItem(key);
        window.localStorage.removeItem(fallbackMarkerKey(name));
        return;
      } catch (error) {
        if (error instanceof StorageGenerationConflictError) throw error;
        console.warn('[storage] IndexedDB fallback promotion unavailable; preserving fallback authority');
        void error;
      }
    }
  }
  await writeEntriesToFallbackStorage(name, [...merged]);
};

/**
 * Clear persisted user state while leaving only a non-sensitive lineage fence.
 * The fence prevents an already-open stale tab from resurrecting a partial
 * snapshot after another tab has intentionally cleared the Store.
 */
export const replaceStorageWithGeneration = async (
  name: string,
  generationKey: string,
  generation: string,
  previousGeneration: string | null = null,
): Promise<void> => {
  if (typeof window === 'undefined') return;
  if (canUseIndexedDB()) {
    await idbReplaceWithGeneration(name, generationKey, generation);
    // Mirror the lineage tombstone into fallback storage. This both overwrites
    // any stale fallback overlay and prevents a racing old tab from changing the
    // generation in a later fallback batch.
    safeLocalStorageRemoveWithDerivedKeys(name);
    safeLocalStorageSet(fallbackMarkerKey(name), JSON.stringify({
      format: 1,
      resetGeneration: generation,
      resetFromGeneration: previousGeneration,
      entries: { [generationKey]: generation },
    }));
    return;
  }
  safeLocalStorageRemoveWithDerivedKeys(name);
  window.localStorage.setItem(fallbackMarkerKey(name), JSON.stringify({
    format: 1,
    resetGeneration: generation,
    resetFromGeneration: previousGeneration,
    entries: { [generationKey]: generation },
  }));
};

/** Missing and unreadable are distinct. A complete fallback works with IDB down. */
export const getStorageEntriesStrict = async (name: string, keys: ReadonlyArray<string>, options: { optionalKeys?: readonly string[] } = {}): Promise<Array<string | null>> => {
  if (typeof window === 'undefined') throw new Error('[storage] No browser storage available');
  const fallback = readFallbackEntries(name);
  if (fallback.marked && keys.every(key => fallback.entries.has(key))) return keys.map(key => fallback.entries.get(key)!);
  if (fallback.marked && keys.every(key => options.optionalKeys?.includes(key) || fallback.entries.has(key))) return keys.map(key => fallback.entries.get(key) ?? null);
  if (!canUseIndexedDB()) return keys.map(key => fallback.entries.get(key) ?? strictLocalStorageGet(key));
  const results = await idbGetMany(keys);
  return keys.map((key, index) => fallback.entries.get(key) ?? results[index] ?? strictLocalStorageGet(key));
};

export const getStorageItemStrict = async (name: string, key: string): Promise<string | null> => (await getStorageEntriesStrict(name, [key]))[0];

/** 廉价探测旧版单键快照是否仍存在（不读取值本身）。 */
export const hasLegacySnapshot = async (name: string): Promise<boolean> => {
  if (typeof window === 'undefined') return false;
  if (safeLocalStorageGet(name) !== null) return true;
  if (!canUseIndexedDB()) return false;
  try {
    return await idbHasKey(name);
  } catch {
    return false;
  }
};

/**
 * 仅删除旧版单键快照（不含分片/派生键）。
 * 分片迁移完成后由持久化层调用以释放旧快照占用的空间；
 * 与 removeItem（连带清扫派生键）语义不同，误用会清掉刚提交的分片。
 */
export const removeLegacySnapshot = async (name: string): Promise<void> => {
  if (typeof window === 'undefined') return;

  safeLocalStorageRemove(name);

  if (!canUseIndexedDB()) return;

  try {
    await idbDelete(name);
  } catch (error) {
    console.warn('[storage] IndexedDB legacy snapshot remove failed:', error);
  }
};

/**
 * IndexedDB-backed Zustand persist storage with seamless migration:
 * - First read from IndexedDB
 * - If empty, migrate an existing localStorage snapshot to IndexedDB and then remove it
 * - Normal writes go to IndexedDB and clear any legacy localStorage snapshot.
 * - localStorage is only kept as the current snapshot when IndexedDB is unavailable or a write fails.
 *   This avoids stale fallback rollbacks while preserving persistence in constrained environments.
 * - removeItem also sweeps the derived sharding keys (`${name}#...`) so data-management
 *   wipes and test resets remove every persisted trace of the app.
 */
export const indexedDBStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (typeof window === 'undefined') return null;

    // Hard fallback for environments without IndexedDB
    if (!canUseIndexedDB()) {
      return safeLocalStorageGet(name);
    }

    try {
      const idbValue = await idbGet(name);
      if (idbValue !== null) return idbValue;

      // Migration path: restore existing localStorage snapshot into IndexedDB
      const legacyValue = safeLocalStorageGet(name);
      if (legacyValue !== null) {
        await idbSet(name, legacyValue);
        safeLocalStorageRemove(name);
        console.info('[storage] migrated state from localStorage to IndexedDB');
      }
      return legacyValue;
    } catch (error) {
      console.warn('[storage] IndexedDB get failed, fallback to localStorage:', error);
      return safeLocalStorageGet(name);
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (typeof window === 'undefined') return;

    // Primary path: IndexedDB first (large data friendly)
    if (canUseIndexedDB()) {
      try {
        await idbSet(name, value);
        safeLocalStorageRemove(name);
        return;
      } catch (error) {
        console.warn('[storage] IndexedDB set failed, fallback to localStorage:', error);
      }
    }

    if (!safeLocalStorageSet(name, value)) {
      throw new Error('[storage] localStorage fallback write failed');
    }
  },

  removeItem: async (name: string): Promise<void> => {
    if (typeof window === 'undefined') return;

    safeLocalStorageRemoveWithDerivedKeys(name);

    if (!canUseIndexedDB()) return;

    // 删除失败如实抛出：残留的分片/meta 会在 reload 后复活，「清空数据」等
    // 调用方必须感知失败，而不是把未完成的删除当作成功继续。
    await idbDeleteWithDerivedKeys(name);
  },
};
