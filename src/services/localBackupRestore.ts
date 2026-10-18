import { useAppStore, setLocalBackupRestoreStoreState } from '../store/useAppStore';
import { appPersistenceOptions } from '../store/persistence/options';
import * as persistenceApi from '../store/persistence/storage';
import { indexedDBStorage } from './indexedDbStorage';
import { getLocalBackupIdentity } from './localBackupScope';
import { ORGANIZATION_BACKUP_KEYS, PREFERENCE_BACKUP_KEYS } from './localBackup';
import type { BackupIdentity } from './localBackup';
import { RELEASE_BACKUP_KEYS, restoreScopeSnapshot, restoreStorePatch, type LocalRestorePlan } from './localBackupRestorePlan';
import { exportDiscoveryWorkspaceBackup, importDiscoveryWorkspaceBackup, validateDiscoveryWorkspaceBackup } from './discoveryWorkspaceBackup';
import { writeAuthMirror, writeSessionBackendSecret } from '../store/persistence/authStorage';
import { assertRepositoryIdentityWritable, assertRepositoryMaintenanceOwner, holdRepositoryIdentityWrites, releaseRepositoryIdentityWrites } from './repositoryIdentityGate';
import { getDesktopHomeSync, pauseDesktopHomeForIdentity, activateDesktopHome, desktopApi } from '../home/desktop';
import { HomeDatabase, type LocalRestoreOperation } from '../home/database';
import { waitForInFlightSync } from './autoSync';
import { backend } from './backendAdapter';
import type { AppStoreState } from '../store/types';
import { localBackupJournalKey as journalKey, hasPendingLocalBackupRestore } from './localBackupRecoveryGate';

const flushAppStorePersistence = persistenceApi.flushAppStorePersistence;
const readFullPersistedSnapshot = persistenceApi.readFullPersistedSnapshot;

type Phase = 'prepared' | 'home-staged' | 'app-persisted' | 'committed' | 'rolling-back' | 'rolled-back';
export interface LocalRestoreJournal extends LocalRestorePlan {
  version: 1; id: string; account: string; phase: Phase;
  beforeHash: string; afterHash: string;
  homeNamespace?: string; homeOperations: LocalRestoreOperation[];
  discoveryReceipt?: { beforeHash: string; afterHash: string };
  sessionConfiguration?: 'pending' | 'applied';
}
/** These values exist only in the current call, never in the durable journal. */
export interface RestoreConfigurationLane { before: Partial<AppStoreState>; after: Partial<AppStoreState> }
interface RestoreOptions { configuration?: RestoreConfigurationLane; compensateOnFailure?: boolean }
const configurationKeys = new Set(['aiConfigs', 'activeAIConfig', 'repositoryChatSettings', 'webdavConfigs', 'activeWebDAVConfig', 'proxyConfig', 'rpcDownloadConfig', 'backendApiSecret']);
const account = () => String(useAppStore.getState().user?.id ?? 'global');
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const allowed = new Set<string>(['repositories', ...ORGANIZATION_BACKUP_KEYS, ...PREFERENCE_BACKUP_KEYS, ...RELEASE_BACKUP_KEYS, 'routeMode']);
const collectionScope: Record<string, readonly string[]> = {
  repositories: ['repositories'], organization: [...ORGANIZATION_BACKUP_KEYS, 'releaseSourceSettings'],
  releases: ['releases'], subscriptions: ['releaseSubscriptions'], release_reads: ['readReleases'],
};
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
  assertNoCredentials(journal.discovery);
  const serialized = JSON.stringify(journal);
  await indexedDBStorage.setItem(journalKey(journal.account), serialized);
  if (await indexedDBStorage.getItem(journalKey(journal.account)) !== serialized) throw new Error('BACKUP_JOURNAL_PERSISTENCE_VERIFY_FAILED');
}
export async function readLocalBackupRestoreJournal(): Promise<LocalRestoreJournal | null> {
  const text = await indexedDBStorage.getItem(journalKey(account()));
  if (!text) return null;
  const value = JSON.parse(text) as LocalRestoreJournal;
  if (value.version !== 1 || value.account !== account() || !value.id?.startsWith('local-backup:') || !Array.isArray(value.keys) || value.keys.some(key => !allowed.has(key)) || !['prepared','home-staged','app-persisted','committed','rolling-back','rolled-back'].includes(value.phase)) throw new Error('BACKUP_JOURNAL_INVALID');
  if ((!value.keys.length && !value.discovery && !value.sessionConfiguration) || new Set(value.keys).size !== value.keys.length || !Array.isArray(value.homeOperations)
      || [value.before, value.after].some(snapshot => !snapshot || Array.isArray(snapshot) || typeof snapshot !== 'object'
        || Object.keys(snapshot).some(key => !value.keys.includes(key)))
      || value.homeOperations.some(row => !row?.operation
        || !collectionScope[row.operation.collection]?.some(key => value.keys.includes(key)))) throw new Error('BACKUP_JOURNAL_INVALID');
  if (await hash(value.before) !== value.beforeHash || await hash(value.after) !== value.afterHash) throw new Error('BACKUP_JOURNAL_INVALID');
  if (value.sessionConfiguration !== undefined && !['pending', 'applied'].includes(value.sessionConfiguration)) throw new Error('BACKUP_JOURNAL_INVALID');
  if (value.discovery) {
    validateDiscoveryWorkspaceBackup(value.account, value.discovery.before);
    validateDiscoveryWorkspaceBackup(value.account, value.discovery.after);
    if (await hash(value.discovery.before) !== value.discoveryReceipt?.beforeHash || await hash(value.discovery.after) !== value.discoveryReceipt?.afterHash) throw new Error('BACKUP_JOURNAL_INVALID');
    assertNoCredentials(value.discovery);
  }
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
  if (journal.discovery) {
    const live = await exportDiscoveryWorkspaceBackup(journal.account);
    assertAccount(journal);
    // Each database may have committed before a crash. Accept only known pre/post images.
    for (const key of ['workspace', 'analyses', 'customDiscovery'] as const) {
      if (journal.discovery.after[key] === undefined) continue;
      const fingerprint = await hash(live[key] ?? null);
      if (fingerprint !== await hash(journal.discovery.before[key] ?? null) && fingerprint !== await hash(journal.discovery.after[key])) throw new Error('BACKUP_DISCOVERY_RECOVERY_DRIFT');
    }
  }
}
async function persistDiscovery(journal: LocalRestoreJournal, undo: boolean) {
  if (!journal.discovery) return;
  assertAccount(journal);
  const snapshot = undo ? journal.discovery.before : journal.discovery.after;
  await importDiscoveryWorkspaceBackup(journal.account, snapshot, 'replace', false, journal.id);
  const live = await exportDiscoveryWorkspaceBackup(journal.account);
  assertAccount(journal);
  for (const key of ['workspace', 'analyses', 'customDiscovery'] as const) {
    if (snapshot[key] !== undefined && await hash(live[key] ?? null) !== await hash(snapshot[key])) throw new Error('BACKUP_DISCOVERY_PERSISTENCE_VERIFY_FAILED');
  }
}
async function persistConfiguration(journal: LocalRestoreJournal, lane: RestoreConfigurationLane, undo: boolean) {
  assertAccount(journal);
  const patch = undo ? lane.before : lane.after;
  const keys = Object.keys(patch);
  if (keys.some(key => !configurationKeys.has(key))) throw new Error('BACKUP_CONFIGURATION_SCOPE_INVALID');
  setLocalBackupRestoreStoreState(journal.account, journal.id, patch);
  await flushAppStorePersistence(); assertAccount(journal);
  const durable = (await readFullPersistedSnapshot(appPersistenceOptions.name))?.state as Partial<AppStoreState> ?? {};
  if (await hash(restoreScopeSnapshot(durable, keys)) !== await hash(restoreScopeSnapshot(patch, keys))) throw new Error('BACKUP_CONFIGURATION_PERSISTENCE_VERIFY_FAILED');
  if ('backendApiSecret' in patch) {
    const state = useAppStore.getState();
    writeSessionBackendSecret(state.backendApiSecret);
    writeAuthMirror({ user: state.user, githubToken: state.githubToken, backendApiSecret: state.backendApiSecret });
  }
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
  const stored = await readFullPersistedSnapshot(appPersistenceOptions.name);
  const durable = stored?.state as Partial<AppStoreState> ?? {};
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
async function applyJournal(journal: LocalRestoreJournal, undo: boolean, existingDb?: HomeDatabase | null, options?: RestoreOptions) {
  assertIdle(); assertAccount(journal);
  const db = existingDb === undefined ? await currentHome(journal) : existingDb;
  await pauseDesktopHomeForIdentity(); await waitForInFlightSync();
  let configurationTouched = false;
  const work = async () => {
  if (journal.phase === 'committed' || journal.phase === 'rolled-back') return;
  await verifyLive(journal);
  if (journal.phase === 'rolling-back' && !undo) throw new Error('BACKUP_CONTINUE_ROLLBACK');
  if (undo) {
    journal.phase = 'rolling-back'; await save(journal);
    if (db) await db.stageLocalRestore(journal.account, journal.id, journal.homeOperations, true);
    await persistDiscovery(journal, true);
    await persistPatch(journal, journal.before, journal.beforeHash);
    journal.phase = 'rolled-back'; await save(journal);
    return;
  }
  if (db) await db.stageLocalRestore(journal.account, journal.id, journal.homeOperations);
  journal.phase = 'home-staged'; await save(journal);
  await persistDiscovery(journal, false);
  await persistPatch(journal, journal.after, journal.afterHash);
  journal.phase = 'app-persisted'; await save(journal);
  if (options?.configuration) {
    const keys = Object.keys(options.configuration.before);
    if (await hash(restoreScopeSnapshot(useAppStore.getState(), keys)) !== await hash(restoreScopeSnapshot(options.configuration.before, keys))) throw new Error('BACKUP_CONFIGURATION_PREVIEW_DRIFT');
    configurationTouched = true;
    await persistConfiguration(journal, options.configuration, false);
    journal.sessionConfiguration = 'applied'; await save(journal);
  }
  journal.phase = 'committed'; await save(journal);
  };
  // Share the existing Home maintenance lock with other renderer instances.
  try {
    if (db && typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request(`gsm-home-sync:${db.namespace}`, work);
    else await work();
  } catch (error) {
    if (options?.compensateOnFailure) {
      try {
        if (configurationTouched) await persistConfiguration(journal, options.configuration!, true);
        journal.phase = 'rolling-back';
        await applyJournal(journal, true, db);
      } catch { throw new Error('BACKUP_RESTORE_PARTIAL_RECOVERY_REQUIRED'); }
    }
    throw error;
  }
  await finish(journal, db);
}
export function recoverLocalBackupRestore(undo: boolean): Promise<{ configurationReviewRequired: boolean }> {
  return exclusive(async () => {
    if (!await hasPendingLocalBackupRestore()) throw new Error('BACKUP_NO_RECOVERY');
    const journal = (await readLocalBackupRestoreJournal())!;
    await applyJournal(journal, undo);
    return { configurationReviewRequired: !!journal.sessionConfiguration };
  });
}
export function executeLocalBackupRestore(plan: LocalRestorePlan, options?: RestoreOptions): Promise<{ homePending: boolean }> {
  return exclusive(async () => {
    assertRepositoryIdentityWritable(); assertIdle();
    if ((!plan.keys.length && !plan.discovery && !options?.configuration) || plan.keys.some(key => !allowed.has(key)) || Object.keys(plan.after).some(key => !plan.keys.includes(key))) throw new Error('BACKUP_SCOPE_INVALID');
    if (options?.configuration) {
      const keys = Object.keys(options.configuration.after);
      if (keys.some(key => !configurationKeys.has(key)) || keys.length !== Object.keys(options.configuration.before).length
        || keys.some(key => !(key in options.configuration!.before))) throw new Error('BACKUP_CONFIGURATION_SCOPE_INVALID');
      if (await hash(restoreScopeSnapshot(useAppStore.getState(), keys)) !== await hash(restoreScopeSnapshot(options.configuration.before, keys))) throw new Error('BACKUP_PREVIEW_OR_RECOVERY_DRIFT');
    }
    if (await readLocalBackupRestoreJournal()) throw new Error('BACKUP_RECOVERY_REQUIRED');
    const capturedAccount = account();
    const identity: BackupIdentity = getLocalBackupIdentity(!!plan.discovery || plan.keys.some(key => key === 'repositories' || RELEASE_BACKUP_KEYS.includes(key as typeof RELEASE_BACKUP_KEYS[number]) || ORGANIZATION_BACKUP_KEYS.includes(key as typeof ORGANIZATION_BACKUP_KEYS[number])));
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
        const add = (collection: LocalRestoreOperation['operation']['collection'], id: string, data: Record<string, unknown> | null) => {
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
        for (const [field, collection] of [['releases', 'releases'], ['releaseSubscriptions', 'subscriptions'], ['readReleases', 'release_reads']] as const) {
          if (!(field in plan.after)) continue;
          const incoming = field === 'releases'
            ? (plan.after.releases as AppStoreState['releases']).map(row => [String(row.id), json(row)] as const)
            : (plan.after[field] as number[]).map(id => [String(id), field === 'releaseSubscriptions' ? { repoId: id, subscribed: true } : { releaseId: id, isRead: true }] as const);
          const ids = new Set(incoming.map(([id]) => id));
          for (const [id, data] of incoming) add(collection, id, data as unknown as Record<string, unknown>);
          for (const row of rows) if (row.collection === collection && !row.deleted && !ids.has(row.id)) add(collection, row.id, null);
        }
        const orgKeys = plan.keys.filter(key => key === 'releaseSourceSettings' || ORGANIZATION_BACKUP_KEYS.includes(key as typeof ORGANIZATION_BACKUP_KEYS[number]));
        if (orgKeys.length) add('organization', 'default', { ...byKey.get('organization:default')?.data, ...Object.fromEntries(orgKeys.map(key => [key, plan.after[key]])) });
      }
      const journal: LocalRestoreJournal = { ...json(plan), version: 1, id: `local-backup:${crypto.randomUUID()}`, account: capturedAccount, phase: 'prepared', beforeHash: await hash(plan.before), afterHash: await hash(plan.after), homeNamespace: sync?.db.namespace, homeOperations: operations };
      if (plan.discovery) {
        validateDiscoveryWorkspaceBackup(capturedAccount, plan.discovery.before); validateDiscoveryWorkspaceBackup(capturedAccount, plan.discovery.after);
        journal.discoveryReceipt = { beforeHash: await hash(plan.discovery.before), afterHash: await hash(plan.discovery.after) };
      }
      if (options?.configuration) journal.sessionConfiguration = 'pending';
      if (account() !== capturedAccount) throw new Error('BACKUP_ACCOUNT_CHANGED');
      await save(journal); durableJournal = true;
      if (account() !== capturedAccount) {
        await indexedDBStorage.removeItem(journalKey(capturedAccount)); durableJournal = false;
        throw new Error('BACKUP_ACCOUNT_CHANGED');
      }
      holdRepositoryIdentityWrites(journal.account, journal.id);
      await applyJournal(journal, false, sync?.db ?? null, options);
      return { homePending: operations.length > 0 };
    } finally {
      if (!durableJournal && stopped) { try { await activateDesktopHome(); } catch { /* normal lifecycle can retry */ } }
    }
  });
}
