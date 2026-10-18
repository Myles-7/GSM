import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore, IDBKeyRange } from 'fake-indexeddb';
import {
  DB_NAME,
  getStorageEntriesStrict,
  getStorageItemStrict,
  indexedDBStorage,
  replaceStorageWithGeneration,
  setStorageEntries,
  setStorageEntriesGuarded,
  StorageGenerationConflictError,
  writeEntriesToFallbackStorage,
} from './indexedDbStorage';

const name = 'strict-backend-test';
const keys = [name, `${name}#meta`, `${name}#shard:core`];
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange); localStorage.clear(); vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const idbValues = async () => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(DB_NAME); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try { return await new Promise<unknown[]>((resolve, reject) => { const tx = db.transaction('app_state', 'readonly'); const request = tx.objectStore('app_state').getAll(); tx.oncomplete = () => resolve(request.result); tx.onabort = tx.onerror = () => reject(tx.error); }); }
  finally { db.close(); }
};

describe('transactional IndexedDB and fallback authority', () => {
  it('reads missing keys as null and rejects an actual IDB read failure', async () => {
    expect(await getStorageEntriesStrict(name, keys)).toEqual([null, null, null]);
    vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw Error('unreadable'); });
    await expect(getStorageEntriesStrict(name, keys)).rejects.toThrow('unreadable');
  });
  it('commits a fallback batch and its authority in one atomic localStorage value', async () => {
    await setStorageEntries(name, [[keys[0], 'old-base'], [keys[1], 'old-meta'], [keys[2], 'old-core']]);
    await writeEntriesToFallbackStorage(name, [[keys[1], 'new-meta'], [keys[2], 'new-core']]);
    expect(localStorage.getItem(keys[1])).toBeNull();
    expect(localStorage.getItem(keys[2])).toBeNull();
    expect(await getStorageEntriesStrict(name, keys)).toEqual(['old-base', 'new-meta', 'new-core']);
    expect(await idbValues()).toEqual(['old-base', 'old-meta', 'old-core']);
  });
  it('leaves the previous fallback intact if writing its authority is denied', async () => {
    await writeEntriesToFallbackStorage(name, [[keys[1], 'meta'], [keys[2], 'core']]);
    const before = localStorage.getItem(`${name}#fallback`);
    const original = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => { if (key === `${name}#fallback`) throw Error('quota'); original(key, value); });
    await expect(writeEntriesToFallbackStorage(name, [[keys[1], 'must-not-commit'], [keys[2], 'must-not-commit']])).rejects.toThrow('quota');
    expect(localStorage.getItem(`${name}#fallback`)).toBe(before);
  });
  it('reads a complete fallback with IndexedDB offline without exposing stale IDB data', async () => {
    await setStorageEntries(name, [[keys[1], 'old-meta'], [keys[2], 'old-core']]);
    await writeEntriesToFallbackStorage(name, [[keys[1], 'new-meta'], [keys[2], 'new-core']]);
    vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw Error('offline'); });
    expect(await getStorageEntriesStrict(name, keys.slice(1))).toEqual(['new-meta', 'new-core']);
    expect(await getStorageItemStrict(name, keys[2])).toBe('new-core');
  });
  it('does not hydrate a partial overlay when the missing authoritative IDB keys are unreadable', async () => {
    await writeEntriesToFallbackStorage(name, [[keys[2], 'new-core']]);
    vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw Error('offline'); });
    await expect(getStorageEntriesStrict(name, keys)).rejects.toThrow('offline');
  });
  it('promotes all fallback entries together with a later partial IDB write', async () => {
    await setStorageEntries(name, [[keys[0], 'base'], [keys[1], 'old-meta'], [keys[2], 'old-core']]);
    await writeEntriesToFallbackStorage(name, [[keys[1], 'fallback-meta'], [keys[2], 'fallback-core']]);
    await setStorageEntries(name, [[keys[1], 'new-meta']]);
    expect(localStorage.getItem(`${name}#fallback`)).toBeNull();
    expect(await getStorageEntriesStrict(name, keys)).toEqual(['base', 'new-meta', 'fallback-core']);
    expect(await idbValues()).toEqual(['base', 'new-meta', 'fallback-core']);
  });
  it('aborts an IDB batch on a synchronous put failure before falling back, preserving every old IDB key', async () => {
    await setStorageEntries(name, [[keys[1], 'old-meta'], [keys[2], 'old-core']]);
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) { if (key === keys[2]) throw Error('injected second put failure'); return original.call(this, value, key); });
    await setStorageEntries(name, [[keys[1], 'new-meta'], [keys[2], 'new-core']]);
    expect(await idbValues()).toEqual(['old-meta', 'old-core']);
    expect(await getStorageEntriesStrict(name, keys.slice(1))).toEqual(['new-meta', 'new-core']);
  });
  it('retains legacy timestamp-marker compatibility and deletes derived keys without deleting journals', async () => {
    await setStorageEntries(name, [[keys[1], 'old-meta'], [keys[2], 'old-core']]);
    localStorage.setItem(`${name}#fallback`, new Date().toISOString()); localStorage.setItem(keys[2], 'legacy-new-core');
    expect(await getStorageItemStrict(name, keys[2])).toBe('legacy-new-core');
    await indexedDBStorage.setItem('gsm-identity-journal:42', 'keep');
    await indexedDBStorage.removeItem(name);
    expect(await getStorageEntriesStrict(name, keys)).toEqual([null, null, null]);
    expect(await indexedDBStorage.getItem('gsm-identity-journal:42')).toBe('keep');
  });
  it('rejects unreadable localStorage authority rather than interpreting it as missing', async () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw Error('storage denied'); });
    await expect(getStorageEntriesStrict(name, keys)).rejects.toThrow('storage denied');
  });
  it('atomically fences a stale guarded writer after another tab clears and advances generation', async () => {
    const generationKey = `${name}#generation`;
    await replaceStorageWithGeneration(name, generationKey, 'generation-one');
    await setStorageEntriesGuarded(name, generationKey, 'generation-one', [
      [keys[2], 'current-core'], [generationKey, 'generation-one'],
    ]);
    await replaceStorageWithGeneration(name, generationKey, 'generation-two');
    await expect(setStorageEntriesGuarded(name, generationKey, 'generation-one', [
      [keys[1], 'stale-meta'], [keys[2], 'stale-core'], [generationKey, 'generation-one'],
    ])).rejects.toBeInstanceOf(StorageGenerationConflictError);
    expect(await getStorageEntriesStrict(name, [generationKey, keys[1], keys[2]])).toEqual(['generation-two', null, null]);
  });
  it('lets a legacy generation-less writer establish the first lineage exactly once', async () => {
    const generationKey = `${name}#generation`;
    await setStorageEntriesGuarded(name, generationKey, null, [[keys[2], 'first'], [generationKey, 'generation-one']]);
    expect(await getStorageEntriesStrict(name, [generationKey, keys[2]])).toEqual(['generation-one', 'first']);
    await expect(setStorageEntriesGuarded(name, generationKey, null, [[keys[2], 'stale'], [generationKey, 'generation-two']]))
      .rejects.toBeInstanceOf(StorageGenerationConflictError);
    expect(await getStorageEntriesStrict(name, [generationKey, keys[2]])).toEqual(['generation-one', 'first']);
  });
  it('promotes a guarded generation first committed to fallback without weakening the clear fence', async () => {
    const generationKey = `${name}#generation`;
    const originalOpen = indexedDB.open.bind(indexedDB);
    vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw Error('temporarily offline'); });
    await setStorageEntriesGuarded(name, generationKey, null, [[keys[2], 'fallback-core'], [generationKey, 'generation-one']]);
    expect(localStorage.getItem(`${name}#fallback`)).not.toBeNull();
    vi.mocked(indexedDB.open).mockImplementation(originalOpen);
    await setStorageEntriesGuarded(name, generationKey, 'generation-one', [[keys[2], 'promoted-core'], [generationKey, 'generation-one']]);
    expect(localStorage.getItem(`${name}#fallback`)).toBeNull();
    expect(await getStorageEntriesStrict(name, [generationKey, keys[2]])).toEqual(['generation-one', 'promoted-core']);
  });
  it('keeps a clear-generation tombstone authoritative in fallback-only mode and rejects stale writers', async () => {
    const generationKey = `${name}#generation`;
    vi.stubGlobal('indexedDB', undefined);
    await replaceStorageWithGeneration(name, generationKey, 'generation-two', 'generation-one');
    await setStorageEntriesGuarded(name, generationKey, 'generation-two', [
      [keys[1], 'fresh-meta'], [keys[2], 'fresh-core'], [generationKey, 'generation-two'],
    ]);
    expect(await getStorageEntriesStrict(name, [generationKey, keys[1], keys[2]])).toEqual([
      'generation-two', 'fresh-meta', 'fresh-core',
    ]);
    await expect(setStorageEntriesGuarded(name, generationKey, 'generation-one', [
      [keys[2], 'stale-core'], [generationKey, 'generation-one'],
    ])).rejects.toBeInstanceOf(StorageGenerationConflictError);
    expect(await getStorageEntriesStrict(name, [generationKey, keys[2]])).toEqual(['generation-two', 'fresh-core']);
  });
});
