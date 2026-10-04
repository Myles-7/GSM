import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeDatabase } from '../home/database';
import { createInitialState } from '../store/initialState';
import type { AppStoreState } from '../store/types';
import type { LocalBackup } from './localBackup';
import type { Repository } from '../types';
import { planLocalBackupRestore } from './localBackupRestorePlan';
import { executeLocalBackupRestore, recoverLocalBackupRestore, readLocalBackupRestoreJournal } from './localBackupRestore';
import { assertRepositoryIdentityWritable, releaseRepositoryIdentityWrites, assertRepositoryMaintenanceOwner } from './repositoryIdentityGate';
const f = vi.hoisted(() => ({ state: {} as AppStoreState, storage: new Map<string, string>(), failPhase: '', failPersist: false, workspace: null as string | null, active: null as null | { db: HomeDatabase; identity: { githubUserId: number; workspaceId: string } }, retained: null as unknown, switchAccount: false }));
vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => f.state }, setLocalBackupRestoreStoreState: (account: string, id: string, patch: Partial<AppStoreState>) => { assertRepositoryMaintenanceOwner(account, id); Object.assign(f.state, patch); } }));
vi.mock('./indexedDbStorage', () => ({ indexedDBStorage: {
  getItem: async (key: string) => f.storage.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    if (key.startsWith('gsm-local-backup-journal:') && JSON.parse(value).phase === f.failPhase) { f.failPhase = ''; throw new Error('CHECKPOINT_INTERRUPTION'); }
    f.storage.set(key, value);
    if (f.switchAccount) { f.switchAccount = false; f.state.user = { id: 43 } as never; }
  }, removeItem: async (key: string) => { f.storage.delete(key); },
} }));
vi.mock('../store/persistence/storage', () => ({ flushAppStorePersistence: async () => {
  if (f.failPersist) { f.failPersist = false; throw new Error('PERSIST_INTERRUPTION'); }
  f.storage.set('github-stars-manager', JSON.stringify({ state: { ...f.state, releaseExpandedRepositories: [...f.state.releaseExpandedRepositories] } }));
} }));
vi.mock('./autoSync', () => ({ waitForInFlightSync: vi.fn() }));
vi.mock('./backendAdapter', () => ({ backend: { isAvailable: true, init: vi.fn() } }));
vi.mock('../store/persistence/options', () => ({ appPersistenceOptions: { name: 'github-stars-manager' } }));
vi.mock('./localBackupScope', () => ({ getLocalBackupIdentity: () => ({ githubUserId: String(f.state.user?.id ?? '') || null, workspaceId: f.workspace }) }));
vi.mock('../home/desktop', () => ({
  getDesktopHomeSync: () => f.active,
  pauseDesktopHomeForIdentity: async () => { const sync = f.active; f.active = null; return sync; },
  activateDesktopHome: vi.fn(async () => { f.active = f.retained as typeof f.active; return !!f.active; }),
  desktopApi: () => ({ url: 'https://home.invalid', capabilities: async () => ({ workspace: { id: f.workspace, githubUserId: 42 } }) }),
}));
const repo = (id: number): Repository => ({ id, name: `repo-${id}`, full_name: `fixture/repo-${id}`, description: '', html_url: '', stargazers_count: 1, forks_count: 0, forks: 0, language: null, created_at: '', updated_at: '', pushed_at: '', owner: { login: 'fixture', avatar_url: '' }, topics: [], category_id: null, subcategory_id: null });
const backup = (data: LocalBackup['data']): LocalBackup => ({ version: '1.1', exportDate: '', appVersion: '', identity: { githubUserId: '42', workspaceId: f.workspace }, included: ['repositories', 'customCategories', 'uiSettings'], data });
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); releaseRepositoryIdentityWrites('42'); localStorage.clear(); f.storage.clear();
  f.state = { ...createInitialState(), user: { id: 42 }, repositories: [repo(1)], repositoryOrder: [1] } as AppStoreState;
  f.workspace = null; f.active = null; f.retained = null; f.failPhase = ''; f.failPersist = false; f.switchAccount = false;
});
afterEach(() => { releaseRepositoryIdentityWrites('42'); vi.unstubAllGlobals(); });
async function home() {
  f.workspace = crypto.randomUUID();
  const db = new HomeDatabase(`https://home.invalid|${f.workspace}`);
  await db.applyRemote([{ collection: 'repositories', id: '1', version: 1, data: repo(1) as unknown as Record<string, unknown> }, { collection: 'organization', id: 'default', version: 1, data: { repositoryOrder: [1], categoryListIdMap: { keep: 'list' }, releaseSourceSettings: { keep: true } } }, { collection: 'sessions', id: 'untouched', version: 1, data: { text: 'keep' } }], 1, true);
  f.active = { db, identity: { githubUserId: 42, workspaceId: f.workspace } }; f.retained = f.active;
  return db;
}
const plan = () => planLocalBackupRestore(f.state, backup({ repositories: [repo(2)], repositoryOrder: [2], theme: 'dark' }), ['repositories', 'customCategories', 'uiSettings'], 'merge', backup({}).identity!, false);
describe('backup journal and scoped Home recovery', () => {
  it('rejects a journal with writes outside its selected scope before recovery', async () => {
    f.failPersist = true;
    await expect(executeLocalBackupRestore(plan())).rejects.toThrow('PERSIST_INTERRUPTION');
    const journal = (await readLocalBackupRestoreJournal())!;
    journal.after.searchFilters = { query: 'unexpected' };
    f.storage.set('gsm-local-backup-journal:42', JSON.stringify(journal));
    const current = structuredClone(f.state.repositories);
    await expect(recoverLocalBackupRestore(false)).rejects.toThrow('JOURNAL_INVALID');
    expect(f.state.repositories).toEqual(current);
    expect(() => assertRepositoryIdentityWritable()).toThrow();
  });
  it('commits only selected ranges, preserving other collections and organization fields, then replays stable operations', async () => {
    const db = await home();
    expect(await executeLocalBackupRestore(plan())).toEqual({ homePending: true });
    expect(f.state.repositories.map(row => row.id)).toEqual([1, 2]); expect(f.state.theme).toBe('dark');
    expect(await readLocalBackupRestoreJournal()).toBeNull(); expect(() => assertRepositoryIdentityWritable()).not.toThrow();
    expect((await db.list('sessions'))[0].data).toEqual({ text: 'keep' });
    expect((await db.list('organization'))[0].data).toMatchObject({ categoryListIdMap: { keep: 'list' }, releaseSourceSettings: { keep: true } });
    const pending = await db.pending(); expect(pending).toHaveLength(3); // existing membership normalization + new repo + organization
    const batch = await db.nextBatch(); expect(await db.nextBatch()).toEqual(batch); expect(batch.operations.map(row => row.opId)).toEqual(pending.map(row => row.opId));
  });
  it.each([false, true])('recovers a crash between Home transaction and checkpoint; undo=%s', async undo => {
    const db = await home(); f.failPhase = 'home-staged';
    await expect(executeLocalBackupRestore(plan())).rejects.toThrow('CHECKPOINT_INTERRUPTION');
    const ids = (await db.pending()).map(row => row.opId);
    expect((await readLocalBackupRestoreJournal())?.phase).toBe('prepared'); expect(() => assertRepositoryIdentityWritable()).toThrow();
    await recoverLocalBackupRestore(undo);
    expect(f.state.repositories.map(row => row.id)).toEqual(undo ? [1] : [1, 2]);
    expect((await db.pending()).map(row => row.opId)).toEqual(undo ? [] : ids);
    expect(await readLocalBackupRestoreJournal()).toBeNull();
  });
  it('undoes interrupted app persistence and refuses fingerprint drift', async () => {
    f.failPersist = true; await expect(executeLocalBackupRestore(plan())).rejects.toThrow('PERSIST_INTERRUPTION');
    expect(f.state.repositories).toHaveLength(2);
    const original = f.state.repositories[0];
    f.state.repositories[0] = { ...original, description: 'external change' };
    await expect(recoverLocalBackupRestore(true)).rejects.toThrow('DRIFT');
    f.state.repositories[0] = original; await recoverLocalBackupRestore(true);
    expect(f.state.repositories).toHaveLength(1);
  });
  it('preserves pending operations and rejects secrets before journal creation', async () => {
    const db = await home(); await db.edit('repositories', '1', { changed: true }); const pending = await db.pending();
    await expect(executeLocalBackupRestore(plan())).rejects.toThrow('PENDING_OPERATIONS'); expect(await db.pending()).toEqual(pending); expect(await readLocalBackupRestoreJournal()).toBeNull();
    f.active = null; f.workspace = null;
    const input = plan(); (input.after.repositories as unknown as Record<string, unknown>[])[0].api_key = 'never persist';
    await expect(executeLocalBackupRestore(input)).rejects.toThrow('SECRET_FORBIDDEN'); expect(f.storage.size).toBe(0);
  });
  it('blocks account and workspace changes during recovery and safely aborts a pre-write account switch', async () => {
    await home(); f.failPhase = 'home-staged'; await expect(executeLocalBackupRestore(plan())).rejects.toThrow();
    f.workspace = 'other'; await expect(recoverLocalBackupRestore(false)).rejects.toThrow('IDENTITY_MISMATCH');
    f.state.user = { id: 43 } as never; await expect(recoverLocalBackupRestore(false)).rejects.toThrow('NO_RECOVERY');
    releaseRepositoryIdentityWrites('42'); f.storage.clear(); f.active = null; f.workspace = null; f.state.user = { id: 42 } as never;
    f.switchAccount = true; await expect(executeLocalBackupRestore(plan())).rejects.toThrow('ACCOUNT_CHANGED');
    expect(f.state.repositories).toHaveLength(1); expect(f.storage.size).toBe(0);
  });
  it('never rolls canonical data back after the staged operation was dispatched and acknowledged', async () => {
    const db = await home(); f.failPhase = 'home-staged'; await expect(executeLocalBackupRestore(plan())).rejects.toThrow();
    const journal = (await readLocalBackupRestoreJournal())!;
    releaseRepositoryIdentityWrites('42');
    const batch = await db.nextBatch();
    for (const op of batch.operations) await db.acknowledge(op, { collection: op.collection, id: op.id, version: op.baseVersion + 1, data: op.data ?? null });
    await db.finishBatch(batch.operations);
    localStorage.setItem('gsm:repository-identity-maintenance:42', journal.id);
    await expect(recoverLocalBackupRestore(true)).rejects.toThrow(/VERSION_DRIFT|DISPATCHED_OR_CHANGED/);
    expect((await db.list('repositories')).find(row => row.id === '2')?.version).toBe(1);
    expect(await readLocalBackupRestoreJournal()).not.toBeNull();
  });
});
