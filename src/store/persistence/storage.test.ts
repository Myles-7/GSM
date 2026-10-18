import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import * as backend from '../../services/indexedDbStorage';
import { createInitialState } from '../initialState';
import { appPersistenceOptions } from './options';
import type { AppStoreState } from '../types';
import { emptyAccountWorkspace, ACCOUNT_WORKSPACE_PERSISTED_FIELDS } from '../helpers/accountWorkspace';
import { PERSISTENCE_SHARD_NAMES, PERSISTENCE_SHARD_FIELDS, WORKSPACE_REFERENCE_FIELDS, WORKSPACE_VALUE_FIELDS, buildShardViews, findDirtyShards, generationKeyFor, metaKeyFor, shardKeyFor } from './shards';
import { __setPersistTimingsForTest, debouncedPersistStorage as storage, flushAppStorePersistence, readFullPersistedSnapshot, removePersistedSnapshot } from './storage';

vi.mock('../../services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), errorFromError: vi.fn() } }));
const name = 'persistence-test';
const payload = (state: Record<string, unknown>) => ({ state, version: 17 });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const save = async (state: Record<string, unknown>) => { await storage.setItem(name, payload(state)); await flushAppStorePersistence(); };
const state = () => ({ theme: 'dark', repositories: [{ id: 1, full_name: 'owner/repo' }], classificationSchemes: { purpose: { repositoryOrder: [1] }, technology: { repositoryOrder: [1] } }, accountWorkspaces: { '42': emptyAccountWorkspace() } });

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  localStorage.clear();
  await removePersistedSnapshot(name);
  __setPersistTimingsForTest({ debounceMs: 5, idleTimeoutMs: 5, largeShardIdleMinIntervalMs: 60_000 });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await removePersistedSnapshot(name);
  vi.unstubAllGlobals();
});

describe('GSM v17 strict sharded persistence', () => {
  it('migrates a complete v17 monolithic snapshot without data changes and retires legacy only after commit', async () => {
    const original = state();
    await backend.indexedDBStorage.setItem(name, JSON.stringify(payload(original)));
    expect(await storage.getItem(name)).toEqual(payload(original));
    expect(await backend.getStorageItemStrict(name, name)).not.toBeNull();
    await save(original);
    expect(await backend.getStorageItemStrict(name, name)).toBeNull();
    expect(await readFullPersistedSnapshot(name)).toEqual(payload(original));
    expect(await storage.getItem(name)).toEqual(payload(original));
  });
  it('assigns every partialize field exactly once, with all local taxonomy fields in organization', () => {
    const persisted = appPersistenceOptions.partialize!(createInitialState() as AppStoreState);
    const declared = Object.values(PERSISTENCE_SHARD_FIELDS).flat();
    expect(new Set(declared).size).toBe(declared.length);
    expect(Object.keys(persisted).filter(key => declared.filter(field => field === key).length !== 1)).toEqual([]);
    expect(PERSISTENCE_SHARD_FIELDS.organization).toEqual(expect.arrayContaining(['classificationSchemes', 'classificationNavigation', 'subcategories', 'subcategoryOrder', 'repositoryOrder']));
    expect(appPersistenceOptions.version).toBe(17);
  });
  it('covers every workspace field and treats unknown fields as dirty even when counts match', () => {
    const fields = [...WORKSPACE_REFERENCE_FIELDS, ...WORKSPACE_VALUE_FIELDS];
    expect(new Set(fields).size).toBe(fields.length);
    expect(new Set(fields)).toEqual(new Set(ACCOUNT_WORKSPACE_PERSISTED_FIELDS));
    const a = buildShardViews({ accountWorkspaces: { '42': { ...emptyAccountWorkspace(), futureField: 'a' } } });
    const b = buildShardViews({ accountWorkspaces: { '42': { ...emptyAccountWorkspace(), futureField: 'b' } } });
    expect(findDirtyShards(b, a)).toEqual(['accountWorkspaces']);
  });
  it.each(['classificationSchemes', 'classificationNavigation', 'externalDiscoveryChannels', 'subcategories', 'subcategoryOrder', 'repositoryOrder'] as const)('persists an isolated parked-workspace %s change', async field => {
    const workspace = emptyAccountWorkspace();
    await save({ accountWorkspaces: { '42': workspace } });
    const updated = { ...workspace, [field]: field === 'repositoryOrder' ? [1] : field === 'classificationSchemes' ? { technology: { repositoryOrder: [1] } } : field === 'classificationNavigation' ? { technology: { selectedCategory: 'tech' } } : ['changed'] };
    await save({ accountWorkspaces: { '42': updated } });
    expect(await readFullPersistedSnapshot(name)).toEqual(payload({ accountWorkspaces: { '42': updated } }));
  });
  it('recovers a missing directory only when every shard remains readable', async () => {
    const original = state(); await save(original);
    await backend.removeLegacySnapshot(metaKeyFor(name));
    expect(await readFullPersistedSnapshot(name)).toEqual(payload(original));
    expect(await storage.getItem(name)).toEqual(payload(original));
    await save(original);
    expect(await backend.getStorageItemStrict(name, metaKeyFor(name))).not.toBeNull();
  });
  it.each(['missing', 'corrupt', 'version'] as const)('refuses %s shards and prevents default state overwriting intact data', async corruption => {
    const original = state(); await save(original);
    const key = shardKeyFor(name, 'repositories');
    if (corruption === 'missing') await backend.removeLegacySnapshot(key);
    else await backend.setStorageEntries(name, [[key, corruption === 'corrupt' ? '{broken' : JSON.stringify({ format: 1, version: 16, state: { repositories: [] } })]]);
    const before = await backend.getStorageEntriesStrict(name, [metaKeyFor(name), ...PERSISTENCE_SHARD_NAMES.map(shard => shardKeyFor(name, shard))]);
    await expect(storage.getItem(name)).rejects.toThrow();
    await storage.setItem(name, payload({ repositories: [] }));
    await expect(flushAppStorePersistence()).rejects.toThrow('Hydration incomplete');
    expect(await backend.getStorageEntriesStrict(name, [metaKeyFor(name), ...PERSISTENCE_SHARD_NAMES.map(shard => shardKeyFor(name, shard))])).toEqual(before);
  });
  it('strict full reads never clear a failed hydration gate or change the dirty baseline', async () => {
    const original = state(); await save(original);
    const read = vi.spyOn(backend, 'getStorageEntriesStrict').mockRejectedValueOnce(new Error('read unavailable'));
    await expect(storage.getItem(name)).rejects.toThrow('read unavailable'); read.mockRestore();
    expect(await readFullPersistedSnapshot(name)).toEqual(payload(original));
    await storage.setItem(name, payload({ ...original, theme: 'light' }));
    await expect(flushAppStorePersistence()).rejects.toThrow('Hydration incomplete');
    await storage.getItem(name); await save({ ...original, theme: 'light' });
    expect(await readFullPersistedSnapshot(name)).toEqual(payload({ ...original, theme: 'light' }));
  });
  it('propagates explicit flush failures and can retry without losing the previous snapshot', async () => {
    const original = state(); await save(original);
    const write = vi.spyOn(backend, 'setStorageEntriesGuarded').mockRejectedValueOnce(new Error('durable write failed'));
    await storage.setItem(name, payload({ ...original, theme: 'light' }));
    await expect(flushAppStorePersistence()).rejects.toThrow('durable write failed');
    expect(await readFullPersistedSnapshot(name)).toEqual(payload(original));
    write.mockRestore(); await flushAppStorePersistence();
    expect(await readFullPersistedSnapshot(name)).toEqual(payload({ ...original, theme: 'light' }));
  });
  it('changes only core for a light UI preference while preserving repository and organization bytes', async () => {
    const original = state(); await save(original);
    const heavyKeys = ['repositories', 'organization'].map(shard => shardKeyFor(name, shard as 'repositories' | 'organization'));
    const before = await backend.getStorageEntriesStrict(name, heavyKeys);
    const write = vi.spyOn(backend, 'setStorageEntriesGuarded');
    await save({ ...original, theme: 'light' });
    expect(write.mock.calls[write.mock.calls.length - 1]?.[3].map(([key]) => key)).toEqual([
      shardKeyFor(name, 'core'), metaKeyFor(name), generationKeyFor(name),
    ]);
    expect(await backend.getStorageEntriesStrict(name, heavyKeys)).toEqual(before);
  });
  it('actually cools a >5MiB shard for 60 seconds while core commits, then pagehide bypasses cooldown', async () => {
    const repositories = [{ id: 1, description: 'x'.repeat(5 * 1024 * 1024 + 1) }];
    const original = { repositories, theme: 'dark' };
    await save(original);
    const key = shardKeyFor(name, 'repositories');
    expect((await backend.getStorageItemStrict(name, key))!.length).toBeGreaterThan(5 * 1024 * 1024);
    const updated = { repositories: [...repositories, { id: 2, description: '' }], theme: 'light' };
    await storage.setItem(name, payload(updated));
    await vi.waitFor(async () => expect((await readFullPersistedSnapshot(name))?.state).toMatchObject({ theme: 'light' }));
    expect((await readFullPersistedSnapshot(name))?.state).toMatchObject({ repositories });
    window.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(async () => expect((await readFullPersistedSnapshot(name))?.state).toEqual(updated));
  });
  it('deletes only this Store and its derived keys, preserving identity/restore journals', async () => {
    await save(state());
    const journalKeys = ['gsm-local-backup-journal:42', 'gsm-identity-journal:42'];
    for (const key of journalKeys) await backend.indexedDBStorage.setItem(key, 'keep');
    await storage.setItem(name, payload({ theme: 'scheduled' }));
    await removePersistedSnapshot(name); await wait(15);
    expect(await readFullPersistedSnapshot(name)).toBeNull();
    for (const key of journalKeys) expect(await backend.indexedDBStorage.getItem(key)).toBe('keep');
  });
  it('refuses a stale partial write after another tab clears the Store, then recovers only after rehydration', async () => {
    const original = state();
    await save(original);
    const externalGeneration = 'external-generation';
    await backend.replaceStorageWithGeneration(name, generationKeyFor(name), externalGeneration);

    await storage.setItem(name, payload({ ...original, theme: 'stale-tab' }));
    await expect(flushAppStorePersistence()).rejects.toThrow('Persistence generation changed');
    expect(await readFullPersistedSnapshot(name)).toBeNull();
    expect(await backend.getStorageItemStrict(name, generationKeyFor(name))).toBe(externalGeneration);

    await storage.setItem(name, payload({ ...original, theme: 'still-stale' }));
    await expect(flushAppStorePersistence()).rejects.toThrow('rehydrate before writing');
    expect(await readFullPersistedSnapshot(name)).toBeNull();

    expect(await storage.getItem(name)).toBeNull();
    await save({ theme: 'fresh-after-rehydrate' });
    expect(await readFullPersistedSnapshot(name)).toEqual(payload({ theme: 'fresh-after-rehydrate' }));
  });
});
