import { useAppStore, setLocalBackupRestoreStoreState } from '../store/useAppStore';
import { appPersistenceOptions } from '../store/persistence/options';
import { flushAppStorePersistence } from '../store/persistence/storage';
import { indexedDBStorage } from './indexedDbStorage';
import { getLocalBackupIdentity } from './localBackupScope';
import { ORGANIZATION_BACKUP_KEYS, PREFERENCE_BACKUP_KEYS } from './localBackup';
import type { BackupIdentity } from './localBackup';
import { restoreScopeSnapshot, restoreStorePatch, type LocalRestorePlan } from './localBackupRestorePlan';
import { assertRepositoryIdentityWritable, assertRepositoryMaintenanceOwner, holdRepositoryIdentityWrites, releaseRepositoryIdentityWrites } from './repositoryIdentityGate';
import { getDesktopHomeSync, pauseDesktopHomeForIdentity, activateDesktopHome, desktopApi } from '../home/desktop';
import { HomeDatabase, type LocalRestoreOperation } from '../home/database';
import { waitForInFlightSync } from './autoSync';
import { backend } from './backendAdapter';
import type { AppStoreState } from '../store/types';
import { localBackupJournalKey as journalKey, hasPendingLocalBackupRestore } from './localBackupRecoveryGate';

type Phase = 'prepared' | 'home-staged' | 'app-persisted' | 'committed' | 'rolling-back' | 'rolled-back';
export interface LocalRestoreJournal extends LocalRestorePlan {
  version: 1; id: string; account: string; phase: Phase;
  beforeHash: string; afterHash: string;
  homeNamespace?: string; homeOperations: LocalRestoreOperation[];
}
const account = () => String(useAppStore.getState().user?.id ?? 'global');
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const allowed = new Set<string>(['repositories', ...ORGANIZATION_BACKUP_KEYS, ...PREFERENCE_BACKUP_KEYS]);
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
async function hash(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
function assertNoCredentials(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (/^(api[_-]?key|api[_-]?secret|access[_-]?token|refresh[_-]?token|github[_-]?token|authorization|password|secret|token|credentials?|cookie|ct0)$/i.test(key)) throw new Error('BACKUP_JOURNAL_SECRET_FORBIDDEN');
    assertNoCredentials(item);
  }
}
function assertIdle() {
  const state = useAppStore.getState();
  if (state.isSyncingStars || state.isLoading || state.vectorIndexingState.isIndexing || state.listsPush.isRunning || state.analyzingRepositoryIds.size || state.analyzingGistIds.size) throw new Error('BACKUP_PAUSE_ACTIVE_WRITERS');
}
function assertAccount(journal: LocalRestoreJournal) {
  if (account() !== journal.account) throw new Error('BACKUP_ACCOUNT_CHANGED');
  assertRepositoryMaintenanceOwner(journal.account, journal.id);
}
async function save(journal: LocalRestoreJournal) {
  assertNoCredentials(journal.before); assertNoCredentials(journal.after); assertNoCredentials(journal.homeOperations);
  const serialized = JSON.stringify(journal);
  await indexedDBStorage.setItem(journalKey(journal.account), serialized);
  if (await indexedDBStorage.getItem(journalKey(journal.account)) !== serialized) throw new Error('BACKUP_JOURNAL_PERSISTENCE_VERIFY_FAILED');
}
export async function readLocalBackupRestoreJournal(): Promise<LocalRestoreJournal | null> {
  const text = await indexedDBStorage.getItem(journalKey(account()));
  if (!text) return null;
  const value = JSON.parse(text) as LocalRestoreJournal;
  if (value.version !== 1 || value.account !== account() || !value.id?.startsWith('local-backup:') || !Array.isArray(value.keys) || value.keys.some(key => !allowed.has(key)) || !['prepared','home-staged','app-persisted','committed','rolling-back','rolled-back'].includes(value.phase)) throw new Error('BACKUP_JOURNAL_INVALID');
  if (!value.keys.length || new Set(value.keys).size !== value.keys.length || !Array.isArray(value.homeOperations)
      || [value.before, value.after].some(snapshot => !snapshot || Array.isArray(snapshot) || typeof snapshot !== 'object'
        || Object.keys(snapshot).some(key => !value.keys.includes(key)))
      || value.homeOperations.some(row => !row?.operation
        || (row.operation.collection === 'repositories' ? !value.keys.includes('repositories')
          : row.operation.collection !== 'organization' || !value.keys.some(key => ORGANIZATION_BACKUP_KEYS.includes(key as typeof ORGANIZATION_BACKUP_KEYS[number]))))) throw new Error('BACKUP_JOURNAL_INVALID');
  if (await hash(value.before) !== value.beforeHash || await hash(value.after) !== value.afterHash) throw new Error('BACKUP_JOURNAL_INVALID');
  assertNoCredentials(value.before); assertNoCredentials(value.after); assertNoCredentials(value.homeOperations);
  return value;
}
async function currentHome(journal: LocalRestoreJournal): Promise<HomeDatabase | null> {
  if (!journal.homeNamespace) {
    const identity = getLocalBackupIdentity();
    if (JSON.stringify(identity) !== JSON.stringify(journal.identity)) throw new Error('BACKUP_IDENTITY_MISMATCH');
    return null;
  }
  const api = desktopApi();
  if (`${api.url}|${journal.identity.workspaceId}` !== journal.homeNamespace) throw new Error('BACKUP_HOME_ENDPOINT_CHANGED');
  const caps = await api.capabilities();
  assertAccount(journal);
  if (caps.workspace?.id !== journal.identity.workspaceId || String(caps.workspace?.githubUserId) !== journal.identity.githubUserId) throw new Error('BACKUP_IDENTITY_MISMATCH');
  return new HomeDatabase(journal.homeNamespace);
}
async function verifyLive(journal: LocalRestoreJournal) {
  assertAccount(journal);
  const liveHash = await hash(restoreScopeSnapshot(useAppStore.getState(), journal.keys));
  if (![journal.beforeHash, journal.afterHash].includes(liveHash)) throw new Error('BACKUP_PREVIEW_OR_RECOVERY_DRIFT');
}
async function persistPatch(journal: LocalRestoreJournal, values: Record<string, unknown>, expectedHash: string) {
  assertAccount(journal);
  const patch = restoreStorePatch(values);
  if (patch.repositories) {
    const byId = new Map(patch.repositories.map(repo => [repo.id, repo]));
    patch.searchResults = useAppStore.getState().searchResults.flatMap(repo => byId.get(repo.id) ? [byId.get(repo.id)!] : []);
    patch.similarView = null; // derived query state cannot reference removed entities
  }
  setLocalBackupRestoreStoreState(journal.account, journal.id, patch);
  await flushAppStorePersistence(); assertAccount(journal);
  const stored = await indexedDBStorage.getItem(appPersistenceOptions.name);
  const durable = stored ? JSON.parse(stored).state as Partial<AppStoreState> : {};
  if (await hash(restoreScopeSnapshot(durable, journal.keys)) !== expectedHash) throw new Error('BACKUP_APP_PERSISTENCE_VERIFY_FAILED');
}
async function finish(journal: LocalRestoreJournal, db: HomeDatabase | null) {
  if (db) await db.finishLocalRestore(journal.account, journal.id);
  assertAccount(journal);
  // A terminal journal can recover a crash between releasing the gate and removing it.
  releaseRepositoryIdentityWrites(journal.account);
  await indexedDBStorage.removeItem(journalKey(journal.account));
  if (db) { try { if (!backend.isAvailable) await backend.init(); await activateDesktopHome(); } catch { /* committed outbox is recovered by normal Home v2 */ } }
}
let busy = false;
async function exclusive<T>(work: () => Promise<T>): Promise<T> {
  if (busy) throw new Error('BACKUP_RESTORE_IN_PROGRESS');
  busy = true;
  try {
    if (typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request(`gsm-repository-identity:${account()}`, work);
    return await work();
  } finally { busy = false; }
}
async function applyJournal(journal: LocalRestoreJournal, undo: boolean, existingDb?: HomeDatabase | null) {
  assertIdle(); assertAccount(journal);
  const db = existingDb === undefined ? await currentHome(journal) : existingDb;
  await pauseDesktopHomeForIdentity(); await waitForInFlightSync();
  const work = async () => {
  if (journal.phase === 'committed' || journal.phase === 'rolled-back') return;
  await verifyLive(journal);
  if (journal.phase === 'rolling-back' && !undo) throw new Error('BACKUP_CONTINUE_ROLLBACK');
  if (undo) {
    journal.phase = 'rolling-back'; await save(journal);
    if (db) await db.stageLocalRestore(journal.account, journal.id, journal.homeOperations, true);
    await persistPatch(journal, journal.before, journal.beforeHash);
    journal.phase = 'rolled-back'; await save(journal);
    return;
  }
  if (db) await db.stageLocalRestore(journal.account, journal.id, journal.homeOperations);
  journal.phase = 'home-staged'; await save(journal);
  await persistPatch(journal, journal.after, journal.afterHash);
  journal.phase = 'app-persisted'; await save(journal);
  journal.phase = 'committed'; await save(journal);
  };
  // Share the existing Home maintenance lock with other renderer instances.
  if (db && typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request(`gsm-home-sync:${db.namespace}`, work);
  else await work();
  await finish(journal, db);
}
export function recoverLocalBackupRestore(undo: boolean): Promise<void> {
  return exclusive(async () => {
    if (!await hasPendingLocalBackupRestore()) throw new Error('BACKUP_NO_RECOVERY');
    await applyJournal((await readLocalBackupRestoreJournal())!, undo);
  });
}
export function executeLocalBackupRestore(plan: LocalRestorePlan): Promise<{ homePending: boolean }> {
  return exclusive(async () => {
    assertRepositoryIdentityWritable(); assertIdle();
    if (!plan.keys.length || plan.keys.some(key => !allowed.has(key)) || Object.keys(plan.after).some(key => !plan.keys.includes(key))) throw new Error('BACKUP_SCOPE_INVALID');
    if (await readLocalBackupRestoreJournal()) throw new Error('BACKUP_RECOVERY_REQUIRED');
    const capturedAccount = account();
    const identity: BackupIdentity = getLocalBackupIdentity(plan.keys.some(key => key === 'repositories' || ORGANIZATION_BACKUP_KEYS.includes(key as typeof ORGANIZATION_BACKUP_KEYS[number])));
    if (JSON.stringify(identity) !== JSON.stringify(plan.identity)) throw new Error('BACKUP_IDENTITY_MISMATCH');
    const sync = getDesktopHomeSync();
    await waitForInFlightSync();
    // Pause capture without forcing a network upload. Pending data is never discarded.
    const stopped = await pauseDesktopHomeForIdentity();
    let durableJournal = false;
    try {
      assertIdle(); assertRepositoryIdentityWritable();
      if (account() !== capturedAccount || await hash(restoreScopeSnapshot(useAppStore.getState(), plan.keys)) !== await hash(plan.before)) throw new Error('BACKUP_PREVIEW_OR_RECOVERY_DRIFT');
      if (sync !== stopped) throw new Error('BACKUP_HOME_CHANGED');
      const operations: LocalRestoreOperation[] = [];
      if (sync) {
        if (await sync.db.metadata('inFlight') || await sync.db.metadata('unconfirmedTask') || (await sync.db.pending()).length) throw new Error('BACKUP_PENDING_OPERATIONS');
        const rows = await sync.db.allRecords(), byKey = new Map(rows.map(row => [`${row.collection}:${row.id}`, row]));
        const add = (collection: 'repositories' | 'organization', id: string, data: Record<string, unknown> | null) => {
          const key = `${collection}:${id}`, before = byKey.get(key) ?? null;
          if (JSON.stringify(before?.data ?? null) === JSON.stringify(data) && !before?.deleted) return;
          operations.push({ before, operation: { key, opId: crypto.randomUUID(), collection, id, baseVersion: before?.version ?? 0, kind: data === null ? 'delete' : 'put', ...(data ? { data } : {}), source: 'user' } });
        };
        if ('repositories' in plan.after) {
          const repos = plan.after.repositories as AppStoreState['repositories'];
          const ids = new Set(repos.map(repo => String(repo.id)));
          for (const repo of repos) add('repositories', String(repo.id), json(repo) as unknown as Record<string, unknown>);
          for (const row of rows) if (row.collection === 'repositories' && !row.deleted && !ids.has(row.id)) add('repositories', row.id, null);
        }
        const orgKeys = plan.keys.filter(key => ORGANIZATION_BACKUP_KEYS.includes(key as typeof ORGANIZATION_BACKUP_KEYS[number]));
        if (orgKeys.length) add('organization', 'default', { ...byKey.get('organization:default')?.data, ...Object.fromEntries(orgKeys.map(key => [key, plan.after[key]])) });
      }
      const journal: LocalRestoreJournal = { ...json(plan), version: 1, id: `local-backup:${crypto.randomUUID()}`, account: capturedAccount, phase: 'prepared', beforeHash: await hash(plan.before), afterHash: await hash(plan.after), homeNamespace: sync?.db.namespace, homeOperations: operations };
      if (account() !== capturedAccount) throw new Error('BACKUP_ACCOUNT_CHANGED');
      await save(journal); durableJournal = true;
      if (account() !== capturedAccount) {
        await indexedDBStorage.removeItem(journalKey(capturedAccount)); durableJournal = false;
        throw new Error('BACKUP_ACCOUNT_CHANGED');
      }
      holdRepositoryIdentityWrites(journal.account, journal.id);
      await applyJournal(journal, false, sync?.db ?? null);
      return { homePending: operations.length > 0 };
    } finally {
      if (!durableJournal && stopped) { try { await activateDesktopHome(); } catch { /* normal lifecycle can retry */ } }
    }
  });
}
