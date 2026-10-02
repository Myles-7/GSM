import type { AppState } from '../types';
import { useAppStore, setIdentityMigrationStoreState } from '../store/useAppStore';
import { appPersistenceOptions } from '../store/persistence/options';
import { flushAppStorePersistence } from '../store/persistence/storage';
import { indexedDBStorage } from './indexedDbStorage';
import { createGitHubApiService } from './githubApiFactory';
import { backend } from './backendAdapter';
import { waitForInFlightSync } from './autoSync';
import { getDesktopHomeSync, pauseDesktopHomeForIdentity, activateDesktopHome, desktopApi, flushDesktopHome } from '../home/desktop';
import { HomeSync } from '../home/sync';
import type { HomeRecord } from '../home/types';
import { holdRepositoryIdentityWrites, releaseRepositoryIdentityWrites } from './repositoryIdentityGate';
import { inspectRepositoryIdentities, remapRepositoryList, validateRepositoryIdentityMappings, type RepositoryIdentityMapping } from '../utils/repositoryIdentity';
import { backupParticipantIdentities, restoreParticipantIdentities, migrateWorkbenchRepositoryIdentities, migrateCustomDiscoveryRepositoryIdentities, migrateVectorRepositoryIdentities, remapWorkbench, type RepositoryIdentityParticipantBackup } from './repositoryIdentityParticipants';
import { VectorSearchService, type VectorRepositoryIdentityBackup } from './vectorSearchService';
import { remapCustomDiscoveryRepositoryIdentityData } from '../features/discovery/custom/model';

type Snapshot = ReturnType<NonNullable<typeof appPersistenceOptions.partialize>>;
interface IdentityJournal {
  version: 1;
  id: string;
  account: string;
  workspace: string | null;
  phase: 'prepared'|'applying'|'complete'|'restoring'|'restored';
  mappings: RepositoryIdentityMapping[];
  steps: string[];
  backup: { store: Snapshot; participants: RepositoryIdentityParticipantBackup; home?: HomeRecord[]; vectors?: VectorRepositoryIdentityBackup };
  serverInputHash?: string;
  recoveryFingerprints?: { store: string[]; participants: string[] };
  error?: string;
}
const journalKey = (account: string) => `gsm-identity-journal:${account}`;
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]),
  );
  return value;
}
async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
function numericIds(value: unknown): number[] {
  return value instanceof Set || Array.isArray(value)
    ? Array.from(value).filter((id): id is number => typeof id === 'number')
    : [];
}
/** Recovery covers identity-bearing account data, never global settings or other accounts. */
export function identityStoreRecoveryView(state: Partial<AppState> | Snapshot) {
  return {
    repositories: state.repositories ?? [],
    repositoryOrder: state.repositoryOrder ?? [],
    releases: state.releases ?? [],
    releaseSubscriptions: numericIds(state.releaseSubscriptions),
    releaseExpandedRepositories: numericIds(state.releaseExpandedRepositories),
  };
}
function restoredStorePatch(before: Snapshot, state: AppState, account: string): Partial<AppState> {
  const patch: Partial<AppState> = {
    ...identityStoreRecoveryView(before),
    releaseSubscriptions: new Set(numericIds(before.releaseSubscriptions)),
    releaseExpandedRepositories: new Set(numericIds(before.releaseExpandedRepositories)),
    searchResults: before.repositories,
    similarView: null,
  };
  const parked = state.accountWorkspaces[account];
  if (parked) patch.accountWorkspaces = { ...state.accountWorkspaces, [account]: {
    ...parked, repositories: before.repositories!, repositoryOrder: before.repositoryOrder,
    releases: before.releases!, releaseSubscriptions: numericIds(before.releaseSubscriptions),
  } };
  return patch;
}
export async function readRepositoryIdentityJournal(account: string): Promise<IdentityJournal | null> {
  const value = await indexedDBStorage.getItem(journalKey(account));
  return value ? JSON.parse(value) as IdentityJournal : null;
}
async function saveJournal(journal: IdentityJournal) {
  await indexedDBStorage.setItem(journalKey(journal.account), JSON.stringify(journal));
}
export async function previewRepositoryIdentityMigration() {
  const state = useAppStore.getState();
  if (!state.user || !state.githubToken) throw new Error('IDENTITY_GITHUB_ACCOUNT_REQUIRED');
  const account = state.user.id, token = state.githubToken;
  const incoming = await createGitHubApiService(token).getAllStarredRepositories();
  if (useAppStore.getState().user?.id !== account || useAppStore.getState().githubToken !== token) throw new Error('IDENTITY_ACCOUNT_CHANGED');
  return { account: String(account), incoming, candidates: inspectRepositoryIdentities(useAppStore.getState().repositories, incoming) };
}

export function remapIdentityStoreSnapshot(state: Partial<AppState>, mappings: readonly RepositoryIdentityMapping[]): Partial<AppState> {
  validateRepositoryIdentityMappings(mappings);
  const map = new Map(mappings.map(row => [row.oldId,row.newId]));
  const id = (value: number) => map.get(value) ?? value;
  const list = (value: number[]|Set<number>|undefined) => [...new Set(Array.from(value ?? []).map(id))];
  const patch: Partial<AppState> = {
    repositories: remapRepositoryList(state.repositories ?? [], mappings),
    repositoryOrder: list(state.repositoryOrder),
    releaseSubscriptions: new Set(list(state.releaseSubscriptions)),
    releases: (state.releases ?? []).map(release => ({ ...release, repository: { ...release.repository, id:id(release.repository.id) } })),
    searchResults: remapRepositoryList(state.searchResults ?? [], mappings),
    releaseExpandedRepositories: new Set(list(state.releaseExpandedRepositories)),
  };
  if (state.similarView) patch.similarView = { ...state.similarView,
    similarResults: remapRepositoryList(state.similarView.similarResults,mappings),
    originalSearchResults: remapRepositoryList(state.similarView.originalSearchResults,mappings),
  };
  return patch;
}
const snapshot = () => json(appPersistenceOptions.partialize!(useAppStore.getState()));
function assertAccount(account: string) {
  if (String(useAppStore.getState().user?.id) !== account) throw new Error('IDENTITY_ACCOUNT_CHANGED');
}
function assertIdle() {
  const state = useAppStore.getState();
  if (state.isSyncingStars || state.vectorIndexingState.isIndexing || state.listsPush.isRunning
    || state.analyzingRepositoryIds.size || state.analyzingGistIds.size) throw new Error('IDENTITY_PAUSE_ACTIVE_WRITERS');
}
function vectorService(): VectorSearchService | null {
  const config=useAppStore.getState().vectorSearchConfig;
  return config.activeIndex ? new VectorSearchService(config,undefined,config.activeIndex) : null;
}
async function assertHomeReady(sync: HomeSync | null) {
  if (!sync) {
    if (backend.isAvailable) throw new Error('IDENTITY_CANONICAL_HOME_REQUIRED');
    return;
  }
  await flushDesktopHome();
  if (await sync.db.metadata('inFlight') || await sync.db.metadata('unconfirmedTask') || (await sync.db.pending()).length) {
    throw new Error('IDENTITY_CONFIRM_PENDING_OPERATIONS_FIRST');
  }
}

let operationInProgress = false;
async function exclusiveIdentityOperation(work: () => Promise<void>): Promise<void> {
  if (operationInProgress) throw new Error('IDENTITY_OPERATION_IN_PROGRESS');
  operationInProgress = true;
  const account = String(useAppStore.getState().user?.id ?? '');
  const execute = async () => { assertAccount(account); await work(); };
  try {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      await navigator.locks.request(`gsm-repository-identity:${account}`, execute);
    } else await execute();
  } finally { operationInProgress = false; }
}
/** Explicit user confirmation only. Each step acknowledges a durable participant checkpoint. */
export function runRepositoryIdentityMigration(mappings?: RepositoryIdentityMapping[]): Promise<void> {
  return exclusiveIdentityOperation(() => applyRepositoryIdentityMigration(mappings));
}
async function applyRepositoryIdentityMigration(mappings?: RepositoryIdentityMapping[]): Promise<void> {
  const account = String(useAppStore.getState().user?.id ?? '');
  if (!account) throw new Error('IDENTITY_GITHUB_ACCOUNT_REQUIRED');
  let journal = await readRepositoryIdentityJournal(account);
  let sync = getDesktopHomeSync();
  if (journal?.phase === 'restoring') throw new Error('IDENTITY_CONTINUE_RECOVERY');
  if ((journal?.phase === 'complete' || journal?.phase === 'restored') && !mappings?.length) {
    delete journal.error;
    await saveJournal(journal);
    releaseRepositoryIdentityWrites(account);
    if (journal.workspace) await activateDesktopHome();
    return;
  }
  if (journal && journal.phase !== 'complete' && journal.workspace && !sync) {
    const api=desktopApi(), capabilities=await api.capabilities();
    if (capabilities.workspace?.id !== journal.workspace || String(capabilities.workspace.githubUserId) !== account) throw new Error('IDENTITY_RECONNECT_ORIGINAL_HOME');
    sync=new HomeSync(api,capabilities);
  }
  if (!journal || journal.phase === 'complete' || journal.phase === 'restored') {
    if (!mappings?.length) throw new Error('IDENTITY_CONFIRMED_MAPPING_REQUIRED');
    validateRepositoryIdentityMappings(mappings);
    assertIdle(); await waitForInFlightSync(); await assertHomeReady(sync); assertAccount(account); assertIdle();
    const before = snapshot();
    const participants = await backupParticipantIdentities(account);
    const plannedParticipants = json(participants);
    remapWorkbench(plannedParticipants.workbench, account, mappings);
    const workbenchOnly = json(plannedParticipants);
    if (plannedParticipants.customDiscovery) remapCustomDiscoveryRepositoryIdentityData(plannedParticipants.customDiscovery, mappings);
    const customOnly = { ...plannedParticipants, workbench: participants.workbench };
    const plannedStore = remapIdentityStoreSnapshot(useAppStore.getState(), mappings);
    const service=vectorService();
    const vectors=service ? await service.backupRepositoryIdentities(mappings) : undefined;
    if (!service && useAppStore.getState().repositories.some(repo=>mappings.some(mapping=>mapping.oldId===repo.id) && repo.vector_indexed_at)) throw new Error('IDENTITY_VECTOR_GENERATION_UNKNOWN');
    if (JSON.stringify(snapshot()) !== JSON.stringify(before)) throw new Error('IDENTITY_PREVIEW_CHANGED');
    remapRepositoryList(useAppStore.getState().repositories,mappings); // Collision/name validation before any participant writes.
    journal = { version:1,id:crypto.randomUUID(),account,workspace:sync?.identity.workspaceId ?? null,phase:'prepared',mappings:json(mappings),steps:[],
      backup:{store:before,participants,...(sync ? {home:await sync.db.allRecords()} : {}),...(vectors?{vectors}:{})},
      recoveryFingerprints: {
        store: [await fingerprint(identityStoreRecoveryView(before)), await fingerprint(identityStoreRecoveryView(plannedStore))],
        participants: await Promise.all([participants, workbenchOnly, plannedParticipants, customOnly].map(fingerprint)),
      } };
    // Persist the recovery input before freezing. No business write has occurred yet.
    await saveJournal(journal);
  }
  if (journal.account !== account || journal.workspace !== (sync?.identity.workspaceId ?? journal.workspace)) throw new Error('IDENTITY_SCOPE_CHANGED');
  holdRepositoryIdentityWrites(account,journal.id);
  if (journal.phase === 'prepared' && !journal.steps.length && JSON.stringify(snapshot()) !== JSON.stringify(journal.backup.store)) {
    releaseRepositoryIdentityWrites(account);
    await indexedDBStorage.removeItem(journalKey(account));
    throw new Error('IDENTITY_PREVIEW_CHANGED');
  }
  sync = await pauseDesktopHomeForIdentity() ?? sync;
  const current = journal;
  const step = async (name: string, work: () => Promise<void>) => {
    assertAccount(account);
    if (current.steps.includes(name)) return;
    current.phase='applying'; await saveJournal(current);
    await work();
    current.steps.push(name); current.phase='applying'; delete current.error; await saveJournal(current);
  };
  try {
    if (current.phase === 'prepared' && current.recoveryFingerprints
      && !current.recoveryFingerprints.participants.includes(await fingerprint(await backupParticipantIdentities(account)))) {
      throw new Error('IDENTITY_PREVIEW_CHANGED');
    }
    if (current.workspace) {
      if (!sync || sync.identity.workspaceId !== current.workspace) throw new Error('IDENTITY_RECONNECT_ORIGINAL_HOME');
      await step('canonical-home',async () => {
        const input={...sync!.identity,mappings:current.mappings};
        if (!current.serverInputHash) {
          const preview=await desktopApi().request<{inputHash:string}>('/sync/v2/identity',{...input,phase:'preview'});
          current.serverInputHash=preview.inputHash; await saveJournal(current);
        }
        // The exact request and journal ID survive a lost ACK; never regenerate them on retry.
        await desktopApi().request('/sync/v2/identity',{...input,phase:'apply',journalId:current.id,inputHash:current.serverInputHash});
      });
      await step('home-cache',()=>sync!.reloadSnapshotForIdentityMaintenance());
    }
    await step('vectors',async()=>{
      if (!current.backup.vectors) return;
      const service=vectorService();
      if (!service) throw new Error('IDENTITY_VECTOR_SCOPE_CHANGED');
      await migrateVectorRepositoryIdentities(current.backup.vectors.scope.namespace,current.mappings,{service,backup:current.backup.vectors});
    });
    await step('workbench',async()=>{ await migrateWorkbenchRepositoryIdentities({ownerId:account},current.mappings); });
    await step('custom-discovery',async()=>{
      if (current.backup.participants.customDiscovery) await migrateCustomDiscoveryRepositoryIdentities(account,current.mappings);
    });
    await step('app-store',async()=>{
      const state=useAppStore.getState();
      const patch=remapIdentityStoreSnapshot(state,current.mappings);
      const parked=state.accountWorkspaces[account];
      if (parked) {
        const changed=remapIdentityStoreSnapshot({ ...parked,releaseSubscriptions:new Set(parked.releaseSubscriptions),readReleases:new Set(parked.readReleases),readForks:new Set(parked.readForks) },current.mappings);
        patch.accountWorkspaces={...state.accountWorkspaces,[account]:{...parked,repositories:changed.repositories!,repositoryOrder:changed.repositoryOrder,
          releases:changed.releases!,releaseSubscriptions:Array.from(changed.releaseSubscriptions!)}};
      }
      setIdentityMigrationStoreState(patch); await flushAppStorePersistence();
    });
    // Capture participant combinations as well: an interruption can leave only Workbench migrated.
    current.recoveryFingerprints ??= { store: [], participants: [] };
    current.recoveryFingerprints.store.push(await fingerprint(identityStoreRecoveryView(snapshot())));
    current.recoveryFingerprints.participants.push(await fingerprint(await backupParticipantIdentities(account)));
    current.phase='complete'; delete current.error; await saveJournal(current);
    releaseRepositoryIdentityWrites(account);
    if (sync) await activateDesktopHome();
  } catch (error) {
    if (current.phase === 'prepared' && !current.steps.length && !current.serverInputHash
      && error instanceof Error && error.message === 'IDENTITY_PREVIEW_CHANGED') {
      await indexedDBStorage.removeItem(journalKey(account));
      releaseRepositoryIdentityWrites(account);
      if (sync) await activateDesktopHome().catch(() => undefined);
      throw error;
    }
    current.error=error instanceof Error ? error.message : 'IDENTITY_MIGRATION_FAILED';
    await saveJournal(current);
    throw error; // Writer gate deliberately stays held until resume or coordinated recovery.
  }
}

/** Destructive recovery is a separate explicit user command, never an automatic error handler. */
export function restoreRepositoryIdentityMigration(): Promise<void> {
  return exclusiveIdentityOperation(restoreRepositoryIdentityMigrationNow);
}
async function restoreRepositoryIdentityMigrationNow(): Promise<void> {
  const account=String(useAppStore.getState().user?.id??'');
  const journal=await readRepositoryIdentityJournal(account);
  if (!journal || journal.phase==='restored') { releaseRepositoryIdentityWrites(account); return; }
  assertAccount(account); assertIdle();
  holdRepositoryIdentityWrites(account,journal.id);
  await pauseDesktopHomeForIdentity();
  try {
    const fingerprints = journal.recoveryFingerprints;
    if (!fingerprints || !fingerprints.store.includes(await fingerprint(identityStoreRecoveryView(snapshot())))
      || !fingerprints.participants.includes(await fingerprint(await backupParticipantIdentities(account)))) {
      throw new Error('IDENTITY_RECOVERY_LOCAL_CHANGED');
    }
    const vectors = journal.backup.vectors ? vectorService() : null;
    if (journal.backup.vectors) {
      if (!vectors) throw new Error('IDENTITY_VECTOR_SCOPE_CHANGED');
      await vectors.checkRestoreRepositoryIdentities(journal.backup.vectors);
    }
    journal.phase='restoring'; await saveJournal(journal);
    if (journal.workspace && (journal.steps.includes('canonical-home') || journal.serverInputHash)) {
      const api=desktopApi(), capabilities=await api.capabilities();
      if (capabilities.workspace?.id!==journal.workspace || String(capabilities.workspace.githubUserId)!==account) throw new Error('IDENTITY_RECOVERY_SCOPE_CONFLICT');
      const acknowledgement = await api.request<{ journalId: string; restored: boolean; notApplied?: boolean }>('/sync/v2/identity',{phase:'restore',workspaceId:journal.workspace,githubUserId:Number(account),journalId:journal.id,
        inputHash:journal.serverInputHash,mappings:journal.mappings});
      if (acknowledgement.journalId !== journal.id
        || (acknowledgement.restored !== true && acknowledgement.notApplied !== true)) throw new Error('IDENTITY_RECOVERY_ACK_REQUIRED');
    }
    if (journal.backup.vectors) {
      await vectors!.restoreRepositoryIdentities(journal.backup.vectors);
    }
    await restoreParticipantIdentities(account,journal.backup.participants);
    setIdentityMigrationStoreState(restoredStorePatch(journal.backup.store,useAppStore.getState(),account));
    await flushAppStorePersistence();
    journal.phase='restored'; delete journal.error; await saveJournal(journal);
    releaseRepositoryIdentityWrites(account);
    if (journal.workspace) {
      const sync=new HomeSync(desktopApi(),await desktopApi().capabilities());
      await sync.db.setMetadata('initialized',false);
      await activateDesktopHome();
    }
  } catch(error) {
    journal.error=error instanceof Error?error.message:String(error); await saveJournal(journal); throw error;
  }
}
