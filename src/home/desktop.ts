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

type Seed = { collection: Collection; id: string; data: Record<string, unknown> };
let active: HomeSync | null = null;
let cleanup: (() => void) | null = null;
let projecting = false;
let captureTail = Promise.resolve();
let projectionTail = Promise.resolve();
const listeners = new Set<() => void>();
export const getDesktopHomeSync = () => active;
export const subscribeDesktopHome = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const notify = () => listeners.forEach(listener => listener());
export const desktopApi = () => new HomeApi(backend.backendUrl ?? backend.configuredUrl ?? '', () => useAppStore.getState().backendApiSecret ?? '');
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

export function desktopStoreRecords(state: AppState): Seed[] {
  const organization = {
    customCategories: state.customCategories, hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
    categoryOrder: state.categoryOrder, subcategories: state.subcategories, subcategoryOrder: state.subcategoryOrder,
    repositoryOrder: state.repositoryOrder, defaultCategoryOverrides: state.defaultCategoryOverrides,
    categoryListIdMap: state.categoryListIdMap, releaseSourceSettings: state.releaseSourceSettings,
  };
  return [
    ...state.repositories.map(data => ({ collection: 'repositories' as const, id: String(data.id), data: json(data) })),
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
export async function previewDesktopBootstrap() {
  const state = useAppStore.getState();
  if (!state.user || !state.repositories.length) throw new Error('请先在电脑登录并同步仓库，不能从空手机初始化');
  const records = await desktopSeed();
  const input = { githubUserId: state.user.id, source: 'desktop', records };
  const preview = await desktopApi().request<{ previewToken: string; counts: Record<string, number>; legacyCounts?: Record<string, number> }>('/sync/v2/bootstrap', input);
  return { input, preview };
}
export async function confirmDesktopBootstrap(preview: Awaited<ReturnType<typeof previewDesktopBootstrap>>) {
  await desktopApi().request('/sync/v2/bootstrap', { ...preview.input, confirm: true, previewToken: preview.preview.previewToken });
  await activateDesktopHome();
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
    const allowed = ['customCategories','hiddenDefaultCategoryIds','categoryOrder','subcategories','subcategoryOrder','repositoryOrder','defaultCategoryOverrides','categoryListIdMap','releaseSourceSettings'];
    const settings = Object.fromEntries(Object.entries(org).filter(([key]) => allowed.includes(key)));
    useAppStore.setState({ ...settings, ...discoveryStoreProjection(useAppStore.getState(), records),
      repositories: live.filter(row => row.collection === 'repositories').map(row => row.data as unknown as Repository),
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
  if (!backend.isAvailable || !useAppStore.getState().backendApiSecret) return false;
  const api = desktopApi(); const capabilities = caps ?? await api.capabilities();
  if (!capabilities.workspace) return false;
  if (capabilities.workspace.githubUserId !== useAppStore.getState().user?.id) throw new Error('家庭后端绑定的 GitHub 账户与当前桌面账户不同');
  stopDesktopHome();
  const sync = new HomeSync(api, capabilities); active = sync; notify();
  const discoveryBeforeProjection = [...desktopDiscoveryStoreRecords(useAppStore.getState()), ...await exportCustomDiscovery(String(sync.identity.githubUserId))];
  await sync.sync();
  if (sync.view.status === 'error' || sync.view.status === 'auth-required') throw new Error(sync.view.error ?? '家庭同步初始化失败');
  if (active !== sync || useAppStore.getState().user?.id !== sync.identity.githubUserId) return false;
  if (capabilities.discovery?.available && typeof window !== 'undefined' && window.electronAPI?.xAuth?.get) {
    try { await migrateDesktopXCredentials(api, sync.identity, loadEncryptedXAuthViaDesktop); }
    catch { console.warn('[home-sync] Desktop X credential migration unavailable; existing desktop login was retained.'); }
  }
  if (await sync.db.metadata('initialized')) {
    await migrateDesktopDiscovery(sync.db, discoveryBeforeProjection);
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
      for (const row of next) {
        const old = before.get(recordKey(row));
        if (JSON.stringify(old?.data) !== JSON.stringify(row.data)) {
          let data = row.data;
          if (row.collection === 'discovery_config' && row.id === 'default') {
            const canonical = (await sync.db.allRecords()).find(item => item.collection === 'discovery_config' && item.id === 'default');
            data = mergeDesktopDiscoveryConfig(data, canonical, old?.data ?? undefined);
          }
          if (active !== sync) return;
          await sync.db.edit(row.collection, row.id, data);
        }
        before.delete(recordKey(row));
      }
      if (previous) for (const row of before.values()) await sync.db.edit(row.collection, row.id, null);
      sync.changed();
    }).catch(error => { console.error('[home-sync] Local persistence failed', error); notify(); });
  };
  const unstore = useAppStore.subscribe((state, previous) => {
    if (state.user?.id !== sync.identity.githubUserId) { stopDesktopHome(); return; }
    if (projecting) return;
    if (state.repositories === previous.repositories && state.releases === previous.releases && state.customCategories === previous.customCategories && state.subcategories === previous.subcategories && state.categoryOrder === previous.categoryOrder && state.repositoryOrder === previous.repositoryOrder && state.readReleases === previous.readReleases && state.releaseSubscriptions === previous.releaseSubscriptions && state.hiddenDefaultCategoryIds === previous.hiddenDefaultCategoryIds && state.defaultCategoryOverrides === previous.defaultCategoryOverrides && state.subcategoryOrder === previous.subcategoryOrder && state.categoryListIdMap === previous.categoryListIdMap && state.releaseSourceSettings === previous.releaseSourceSettings && state.discoveryChannels === previous.discoveryChannels && state.xTweetFollows === previous.xTweetFollows && state.telegramFollows === previous.telegramFollows && state.trendingSnapshots === previous.trendingSnapshots) return;
    capture(desktopStoreRecords(state), desktopStoreRecords(previous));
  });
  const onChat = (event: Event) => {
    if (active !== sync) return;
    const isProjection = (event as CustomEvent<{ source?: string }>).detail?.source === 'home-projection';
    // Queue the export immediately: a slow export must not be overtaken by projection.
    captureTail = captureTail.then(async () => {
      if (active !== sync) return;
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
  const unsubscribe = sync.subscribe(() => { notify(); if (['synced','conflict'].includes(sync.view.status)) void project(sync); });
  const stop = sync.start();
  cleanup = () => { stop(); unsubscribe(); unstore(); window.removeEventListener('gsm:global-chat-history-changed', onChat); window.removeEventListener('gsm:custom-discovery-changed', onDiscovery); };
  return true;
}
export function stopDesktopHome() { active?.stop(); cleanup?.(); cleanup = null; active = null; notify(); }
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
