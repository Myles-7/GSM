import { useAppStore } from '../store/useAppStore';
import { backend } from '../services/backendAdapter';
import { repositoryChatStorage } from '../services/repositoryChatStorage';
import { desktopDiscoveryStoreRecords, exportCustomDiscovery, discoveryStoreProjection, applyDiscoveryProjection, migrateDesktopDiscovery, mergeDesktopDiscoveryConfig } from './discoveryDesktop';
import { migrateDesktopXCredentials } from './desktopXCredentials';
import { loadEncryptedXAuthViaDesktop } from '../services/electronProxy';
import { HomeApi } from './api';
import { HomeSync } from './sync';
import type { Capabilities, Collection, HomeRecord } from './types';
import type { AppState, Release, Repository } from '../types';
import { hasPendingLocalBackupRestore } from '../services/localBackupRecoveryGate';
import { classificationExport } from '../store/helpers/classificationSchemes';
import { incomingOrganizationSnapshot } from '../store/helpers/repositoryOrganization';
import { repositoryHomeProjection } from './repositoryProjection';
import { classificationSyncToken } from '../services/classificationSyncReceipt';

type Seed = { collection: Collection; id: string; data: Record<string, unknown> };
let active: HomeSync | null = null;
let cleanup: (() => void) | null = null;
let projecting = false;
let captureTail = Promise.resolve();
let projectionTail = Promise.resolve();
let classificationReceiptToken: string | null = null;
const listeners = new Set<() => void>();
export const getDesktopHomeSync = () => active;
export const getDesktopClassificationReceiptToken = () => classificationReceiptToken;
export const waitForDesktopHomeCapture = async () => { let observed: Promise<void>; do { observed = captureTail; await observed; } while (observed !== captureTail); };
export const subscribeDesktopHome = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const notify = () => listeners.forEach(listener => listener());
export const desktopApi = () => new HomeApi(backend.backendUrl ?? backend.configuredUrl ?? '', () => useAppStore.getState().backendApiSecret ?? '');
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

export function desktopStoreRecords(state: AppState): Seed[] {
  const organization = {
    classificationSchemes: classificationExport(state),
    customCategories: state.customCategories, hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
    categoryOrder: state.categoryOrder, subcategories: state.subcategories, subcategoryOrder: state.subcategoryOrder,
    repositoryOrder: state.repositoryOrder, defaultCategoryOverrides: state.defaultCategoryOverrides,
    categoryListIdMap: state.categoryListIdMap, releaseSourceSettings: state.releaseSourceSettings,
  };
  return [
    ...state.repositories.map(data => ({ collection: 'repositories' as const, id: String(data.id), data: repositoryHomeProjection(data) })),
    ...state.releases.map(data => ({ collection: 'releases' as const, id: String(data.id), data: json(data) })),
    { collection: 'organization', id: 'default', data: json(organization) },
    ...Array.from(state.releaseSubscriptions).map(id => ({ collection: 'subscriptions' as const, id: String(id), data: { repoId: id, subscribed: true } })),
    ...Array.from(state.readReleases).map(id => ({ collection: 'release_reads' as const, id: String(id), data: { releaseId: id, isRead: true } })),
    ...desktopDiscoveryStoreRecords(state),
  ];
}
export async function desktopSeed(): Promise<Seed[]> {
  const state = useAppStore.getState();
  if (!state.user) throw new Error('请先登录 GitHub');
  const chat = await repositoryChatStorage.exportWorkbench(String(state.user.id)) as Record<string, Array<Record<string, unknown>>>;
  return [...desktopStoreRecords(state), ...await exportCustomDiscovery(String(state.user.id)), ...(['sessions','messages','evidence','projects','proposals'] as const).flatMap(collection => (chat[collection] ?? []).map(data => ({ collection, id: String(data.id), data })))];
}
async function projectNow(sync: HomeSync) {
  let observed: Promise<void>; let records: HomeRecord[];
  do { observed = captureTail; await observed; records = await sync.db.allRecords(); } while (observed !== captureTail);
  if (active !== sync) return;
  if (useAppStore.getState().user?.id !== sync.identity.githubUserId) { stopDesktopHome(); return; }
  projecting = true;
  try {
    const live = records.filter(row => !row.deleted);
    const org = live.find(row => row.collection === 'organization' && row.id === 'default')?.data ?? {};
    const allowed = ['classificationSchemes','customCategories','hiddenDefaultCategoryIds','categoryOrder','subcategories','subcategoryOrder','repositoryOrder','defaultCategoryOverrides','categoryListIdMap','releaseSourceSettings'];
    const settings = Object.fromEntries(Object.entries(org).filter(([key]) => allowed.includes(key)));
    const organization = incomingOrganizationSnapshot(useAppStore.getState(), settings, live.filter(row => row.collection === 'repositories').map(row => row.data as unknown as Repository));
    useAppStore.setState({ ...organization, ...discoveryStoreProjection(useAppStore.getState(), records),
      releases: live.filter(row => row.collection === 'releases').map(row => row.data as unknown as Release),
      releaseSubscriptions: new Set(live.filter(row => row.collection === 'subscriptions' && row.data?.subscribed !== false && row.data?.enabled !== false).map(row => Number(row.id))),
      readReleases: new Set(live.filter(row => row.collection === 'release_reads' && row.data?.isRead !== false && row.data?.is_read !== false).map(row => Number(row.id))),
    });
  } finally { projecting = false; }
  await applyDiscoveryProjection(String(sync.identity.githubUserId), records);
  await repositoryChatStorage.applyHomeProjection(String(sync.identity.githubUserId), await sync.db.allRecords());
}
function project(sync: HomeSync) {
  const current = projectionTail.then(() => projectNow(sync));
  projectionTail = current.catch(error => { console.error('[home-sync] Projection failed', error); notify(); });
  return current;
}

/** Bootstrap detection never falls back to legacy writes if the server announced a v2 workspace. */
export async function activateDesktopHome(caps?: Capabilities): Promise<boolean> {
  if (await hasPendingLocalBackupRestore()) throw new Error('BACKUP_RECOVERY_REQUIRED');
  if (!backend.isAvailable || !useAppStore.getState().backendApiSecret) return false;
  const api = desktopApi(); const capabilities = caps ?? await api.capabilities();
  if (!capabilities.workspace) return false;
  if (capabilities.workspace.githubUserId !== useAppStore.getState().user?.id) throw new Error('家庭后端绑定的 GitHub 账户与当前桌面账户不同');
  stopDesktopHome();
  const sync = new HomeSync(api, capabilities); active = sync; notify();
  const discoveryBeforeProjection = [...desktopDiscoveryStoreRecords(useAppStore.getState()), ...await exportCustomDiscovery(String(sync.identity.githubUserId))];
  await sync.sync();
  if (sync.view.status === 'error' || sync.view.status === 'auth-required') {
    // A transient GitHub/proxy failure must not tear down the local Home
    // workspace or fall through to the legacy writer. HomeSync owns the
    // bounded retry/backoff and will retry once the binding/API is reachable.
    console.warn('[home-sync] Initial v2 sync deferred:', sync.view.error ?? 'sync unavailable');
  }
  if (active !== sync || useAppStore.getState().user?.id !== sync.identity.githubUserId) return false;
  if (capabilities.discovery?.available && typeof window !== 'undefined' && window.electronAPI?.xAuth?.get) {
    try { await migrateDesktopXCredentials(api, sync.identity, loadEncryptedXAuthViaDesktop); }
    catch { console.warn('[home-sync] Desktop X credential migration unavailable; existing desktop login was retained.'); }
  }
  let discoveryMigrated=false;
  let deferredDiscovery:Promise<void>|undefined;
  if (await sync.db.metadata('initialized')) {
    await migrateDesktopDiscovery(sync.db, discoveryBeforeProjection); discoveryMigrated=true;
    await project(sync);
  }
  if (active !== sync) return false;
  const chatRecords = (raw: unknown): Seed[] => {
    const data = raw as Record<string, Array<Record<string, unknown>>>;
    return (['sessions','messages','evidence','projects','proposals'] as const).flatMap(collection => (data[collection] ?? []).map(row => ({ collection, id: String(row.id), data: row })));
  };
  let previousDiscovery = await exportCustomDiscovery(String(sync.identity.githubUserId));
  let previousChat = chatRecords(await repositoryChatStorage.exportWorkbench(String(sync.identity.githubUserId)));
  if (active !== sync) return false;
  const recordKey = (row: Pick<HomeRecord,'collection'|'id'>) => `${row.collection}:${row.id}`;
  const capture = (next: Seed[], previous?: Seed[]) => {
    if (projecting || active !== sync) return;
    captureTail = captureTail.then(async () => {
      if (active !== sync) return;
      const baseline = previous ?? (await sync.db.list()).filter(row => ['sessions','messages','evidence','projects','proposals'].includes(row.collection)).map(row => ({ ...row, data: row.data! }));
      const before = new Map(baseline.map(row => [recordKey(row), row]));
      const edits: Parameters<typeof sync.db.editMany>[0] = [];
      for (const row of next) {
        const old = before.get(recordKey(row));
        if (JSON.stringify(old?.data) !== JSON.stringify(row.data)) {
          let data = row.data;
          if (row.collection === 'discovery_config' && row.id === 'default') {
            const canonical = (await sync.db.allRecords()).find(item => item.collection === 'discovery_config' && item.id === 'default');
            data = mergeDesktopDiscoveryConfig(data, canonical, old?.data ?? undefined);
          }
          if (active !== sync) return;
          edits.push({ collection: row.collection, id: row.id, data });
        }
        before.delete(recordKey(row));
      }
      if (previous) for (const row of before.values()) edits.push({ collection: row.collection, id: row.id, data: null });
      if (edits.length) { await sync.db.editMany(edits); sync.changed(); }
    }).catch(error => { console.error('[home-sync] Local persistence failed', error); notify(); });
  };
  const unstore = useAppStore.subscribe((state, previous) => {
    if (state.user?.id !== sync.identity.githubUserId) { stopDesktopHome(); return; }
    if (projecting) return;
    if (state.classificationSchemes === previous.classificationSchemes && state.repositories === previous.repositories && state.releases === previous.releases && state.customCategories === previous.customCategories && state.subcategories === previous.subcategories && state.categoryOrder === previous.categoryOrder && state.repositoryOrder === previous.repositoryOrder && state.readReleases === previous.readReleases && state.releaseSubscriptions === previous.releaseSubscriptions && state.hiddenDefaultCategoryIds === previous.hiddenDefaultCategoryIds && state.defaultCategoryOverrides === previous.defaultCategoryOverrides && state.subcategoryOrder === previous.subcategoryOrder && state.categoryListIdMap === previous.categoryListIdMap && state.releaseSourceSettings === previous.releaseSourceSettings && state.discoveryChannels === previous.discoveryChannels && state.xTweetFollows === previous.xTweetFollows && state.telegramFollows === previous.telegramFollows && state.trendingSnapshots === previous.trendingSnapshots) return;
    capture(desktopStoreRecords(state), desktopStoreRecords(previous));
  });
  const onChat = (event: Event) => {
    if (active !== sync) return;
    const detail = (event as CustomEvent<import('../services/repositoryChatStorage').ChatHistoryChange>).detail;
    const isProjection = detail?.source === 'home-projection';
    // Queue the export immediately: a slow export must not be overtaken by projection.
    captureTail = captureTail.then(async () => {
      if (active !== sync) return;
      // Existing exported records are already known to be syncable. Updating one
      // checkpoint must not export and validate every historical draft again.
      const beforeProposal = detail?.proposalId && detail.ownerId === String(sync.identity.githubUserId)
        ? previousChat.find(row => row.collection === 'proposals' && row.id === detail.proposalId) : undefined;
      if (!isProjection && beforeProposal) {
        const changed = await repositoryChatStorage.getProposal(beforeProposal.id);
        if (active !== sync) return;
        if (changed && changed.ownerId === detail.ownerId && changed.sessionId === detail.sessionId) {
          if (changed.updatedAt !== beforeProposal.data.updatedAt) {
            const next = { collection: 'proposals' as const, id: changed.id, data: json(changed) };
            await sync.db.edit(next.collection, next.id, next.data);
            previousChat = previousChat.map(row => row === beforeProposal ? next : row);
            sync.changed();
          }
          return;
        }
      }
      const next = chatRecords(await repositoryChatStorage.exportWorkbench(String(sync.identity.githubUserId)));
      if (!isProjection) {
        const before = new Map(previousChat.map(row => [recordKey(row), row]));
        for (const row of next) {
          if (JSON.stringify(before.get(recordKey(row))?.data) !== JSON.stringify(row.data)) await sync.db.edit(row.collection, row.id, row.data);
          before.delete(recordKey(row));
        }
        for (const row of before.values()) await sync.db.edit(row.collection, row.id, null);
        sync.changed();
      }
      previousChat = next;
    }).catch(error => { console.error('[home-sync] Chat persistence failed', error); notify(); });
  };
  const onDiscovery = (event: Event) => {
    const detail = (event as CustomEvent<{ account?: string; source?: string }>).detail;
    if (active !== sync || detail?.account !== String(sync.identity.githubUserId)) return;
    const isProjection = detail.source === 'home-projection';
    captureTail = captureTail.then(async () => {
      if (active !== sync) return;
      const next = await exportCustomDiscovery(String(sync.identity.githubUserId));
      if (!isProjection) {
        const before = new Map(previousDiscovery.map(row => [recordKey(row), row]));
        let changed = false;
        for (const row of next) {
          if (JSON.stringify(before.get(recordKey(row))?.data) !== JSON.stringify(row.data)) { await sync.db.edit(row.collection, row.id, row.data); changed = true; }
          before.delete(recordKey(row));
        }
        for (const row of before.values()) { await sync.db.edit(row.collection, row.id, null); changed = true; }
        if (changed) sync.changed();
      }
      previousDiscovery = next;
    }).catch(error => { console.error('[home-sync] Discovery persistence failed', error); notify(); });
  };
  window.addEventListener('gsm:custom-discovery-changed', onDiscovery);
  window.addEventListener('gsm:global-chat-history-changed', onChat);
  let classificationRequestSnapshot: AppState | undefined;
  const unsubscribe = sync.subscribe(() => {
    notify();
    if (sync.view.status === 'syncing') classificationRequestSnapshot = useAppStore.getState();
    if (['synced', 'conflict'].includes(sync.view.status)) {
      const snapshot = classificationRequestSnapshot;
      if (snapshot) classificationReceiptToken = classificationSyncToken(snapshot);
      if (snapshot?.classificationSchemes?.generation?.syncPending) void import('../services/classificationSync')
        .then(({ acknowledgeDesktopClassification }) => acknowledgeDesktopClassification(snapshot)).catch(() => {});
    }
    if(['synced','conflict'].includes(sync.view.status)) {
      // Deferred first activation must migrate discovery before its first
      // projection. Local edits have already been captured in the durable outbox.
      if(!discoveryMigrated) {
        deferredDiscovery??=captureTail.then(async()=>{await migrateDesktopDiscovery(sync.db,discoveryBeforeProjection);discoveryMigrated=true;}).finally(()=>{deferredDiscovery=undefined;});
        captureTail=deferredDiscovery.catch(error=>{console.error('[home-sync] Deferred discovery migration failed',error);});
        void deferredDiscovery.then(()=>project(sync)).catch(()=>{});
        return;
      }
      void project(sync);
    }
  });
  const stop = sync.start();
  cleanup = () => { stop(); unsubscribe(); unstore(); window.removeEventListener('gsm:global-chat-history-changed', onChat); window.removeEventListener('gsm:custom-discovery-changed', onDiscovery); };
  performance.mark?.('gsm:home-initialized');
  return true;
}
export function stopDesktopHome() { active?.stop(); cleanup?.(); cleanup = null; active = null; classificationReceiptToken = null; notify(); }
export async function pauseDesktopHomeForIdentity(): Promise<HomeSync | null> {
  const sync = active;
  stopDesktopHome();
  await sync?.drain();
  await captureTail; await projectionTail;
  return sync;
}
export async function flushDesktopHome(): Promise<boolean> {
  if (!active) return false;
  await captureTail; await active.sync();
  if (!['synced','conflict'].includes(active.view.status)) throw new Error(active.view.error ?? '资料尚未同步');
  return true;
}

/** Local durability barrier only; remote delivery is reported separately. */
export async function checkpointDesktopHomeRepository(account: string, repositoryId: number): Promise<void> {
  const sync = active;
  if (!sync) return;
  const validate = () => {
    if (active !== sync || String(sync.identity.githubUserId) !== account || String(useAppStore.getState().user?.id) !== account) throw new Error('账户已变化，本地仓库保存未完成。');
  };
  validate();
  const checkpoint = captureTail.then(async () => {
    validate();
    const previous = await sync.db.getRecord('repositories', String(repositoryId)); validate();
    // Read after the asynchronous lookup, and queue future store captures behind
    // this checkpoint so newer manual edits cannot be overwritten by its snapshot.
    const repo = useAppStore.getState().repositories.find(item => item.id === repositoryId);
    if (!repo) throw new Error('待保存的仓库资料不存在。');
    const data = repositoryHomeProjection(repo);
    if (JSON.stringify(previous?.data) !== JSON.stringify(data)) {
      await sync.db.edit('repositories', String(repositoryId), data); validate(); sync.changed();
    }
  });
  captureTail = checkpoint.catch(() => undefined);
  await checkpoint;
}
