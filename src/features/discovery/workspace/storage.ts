import { z } from 'zod';
import type { RepositoryIdentityMapping } from '../../../utils/repositoryIdentity';
import { assertRepositoryIdentityWritable } from '../../../services/repositoryIdentityGate';
import { anchorSchema, browseSessionSchema, defaultReadingPreferences, readingPreferencesSchema,
  type DiscoveryBrowseSession, type DiscoveryProjectRecord, type DiscoveryRankingStage,
  type DiscoveryReadingAnchor, type DiscoveryReadingPreferences, type DiscoveryWorkspaceSnapshot } from './model';

const STORES = ['sessions', 'projects', 'preferences', 'anchors', 'stages'] as const;
type StoreName = typeof STORES[number];
interface Row<T = unknown> { account: string; key: string; value: T }
const request = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
});
let broadcast: BroadcastChannel | undefined;
function changed(account: string) {
  if (typeof window === 'undefined') return;
  if (!broadcast && typeof window.BroadcastChannel !== 'undefined') {
    broadcast = new window.BroadcastChannel('gsm-discovery-workspace');
    broadcast.onmessage = event => {
      if (typeof event.data?.account === 'string') window.dispatchEvent(new CustomEvent('gsm:discovery-workspace-changed', { detail: event.data }));
    };
  }
  window.dispatchEvent(new CustomEvent('gsm:discovery-workspace-changed', { detail: { account } }));
  broadcast?.postMessage({ account });
}
async function transaction<T>(account: string, mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>, migration = false): Promise<T> {
  if (!account.trim()) throw new Error('DISCOVERY_WORKSPACE_ACCOUNT_REQUIRED');
  if (mode === 'readwrite' && !migration) assertRepositoryIdentityWritable(account);
  if (typeof indexedDB === 'undefined') throw new Error('DISCOVERY_WORKSPACE_STORAGE_UNAVAILABLE');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('gsm-discovery-workspace', 1);
    req.onupgradeneeded = () => {
      for (const name of STORES) req.result.createObjectStore(name, { keyPath: ['account', 'key'] }).createIndex('account', 'account');
    };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('DISCOVERY_WORKSPACE_STORAGE_BLOCKED'));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction([...STORES], mode);
      let value: T; let failure: unknown;
      const timer = setTimeout(() => tx.abort(), 15000);
      tx.oncomplete = () => { clearTimeout(timer); if (mode === 'readwrite') changed(account); resolve(value); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(failure || tx.error || new Error('DISCOVERY_WORKSPACE_TRANSACTION_ABORTED')); };
      void work(tx).then(result => { value = result; }).catch(error => { failure = error; try { tx.abort(); } catch { reject(error); } });
    });
  } finally { db.close(); }
}
const get = async <T>(tx: IDBTransaction, store: StoreName, account: string, key: string) =>
  (await request(tx.objectStore(store).get([account, key])) as Row<T> | undefined)?.value;
const all = <T>(tx: IDBTransaction, store: StoreName, account: string) =>
  request(tx.objectStore(store).index('account').getAll(account)) as Promise<Row<T>[]>;
const put = (tx: IDBTransaction, store: StoreName, account: string, key: string, value: unknown) =>
  tx.objectStore(store).put({ account, key, value });
const projectKey = (sessionKey: string, itemKey: string) => JSON.stringify([sessionKey, itemKey]);
const unsafeFields = new Set(['githubToken', 'apiKey', 'authToken', 'ct0', 'password', 'secret', 'controller', 'lease', 'ownerToken']);
function safeValue(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true;
  return Object.entries(value).every(([key, item]) => !unsafeFields.has(key) && safeValue(item));
}
function projectValue(value: Record<string, unknown>): Record<string, unknown> {
  const result = { ...value };
  for (const key of ['ai_details', 'ai_summary', 'ai_tags', 'ai_platforms', 'analysis_failed', 'analysis_error']) delete result[key];
  if (!safeValue(result)) throw new Error('DISCOVERY_WORKSPACE_UNSAFE_DATA');
  return result;
}
export async function loadBrowseSession(account: string, key: string) {
  return transaction(account, 'readonly', async tx => {
    const session = await get<DiscoveryBrowseSession>(tx, 'sessions', account, key);
    if (!session) return null;
    const records = await Promise.all([...session.itemKeys, ...session.bufferKeys].map(id => get<DiscoveryProjectRecord>(tx, 'projects', account, projectKey(key, id))));
    const values = new Map(records.filter((row): row is DiscoveryProjectRecord => !!row).map(row => [row.key, row.value]));
    return { session, items: session.itemKeys.map(id => values.get(id)).filter((v): v is Record<string, unknown> => !!v),
      buffer: session.bufferKeys.map(id => values.get(id)).filter((v): v is Record<string, unknown> => !!v) };
  });
}
export interface SaveBrowsePage {
  key: string; channelId: string; signature: string; items: object[]; itemKeys?: string[];
  nextPage: number; hasMore: boolean; totalCount: number; mode: 'replace' | 'append' | 'stable';
  preserveCursor?: boolean; exposeCount?: number; expectedVersion?: number;
  isCurrent?: () => boolean;
}
export async function saveBrowsePage(account: string, input: SaveBrowsePage): Promise<DiscoveryBrowseSession> {
  return transaction(account, 'readwrite', async tx => {
    const old = await get<DiscoveryBrowseSession>(tx, 'sessions', account, input.key);
    if (input.isCurrent && !input.isCurrent()) throw new DOMException('Stale discovery task', 'AbortError');
    if (input.expectedVersion !== undefined && (old?.version || 0) !== input.expectedVersion) throw new Error('DISCOVERY_WORKSPACE_STALE_WRITE');
    const items = input.items as Record<string, unknown>[];
    const ids = input.itemKeys ?? items.map(item => `repo:${item.id}`);
    if (ids.length !== items.length || ids.some(id => !id)) throw new Error('DISCOVERY_WORKSPACE_INVALID_KEYS');
    for (let i = 0; i < input.items.length; i++) {
      if (input.mode === 'append' && old && old.nextPage > input.nextPage && old.itemKeys.includes(ids[i])) continue;
      put(tx, 'projects', account, projectKey(input.key, ids[i]), {
      key: ids[i], sessionKey: input.key, value: projectValue(items[i]),
      });
    }
    const prior = input.mode === 'replace' ? [] : old?.itemKeys ?? [];
    const available = [...new Set([...(input.mode === 'replace' ? [] : old?.bufferKeys ?? []), ...ids])].filter(id => !prior.includes(id));
    const visible = input.exposeCount === undefined ? available : available.slice(0, input.exposeCount);
    const session = browseSessionSchema.parse({
      key: input.key, channelId: input.channelId, signature: input.signature, itemKeys: [...prior, ...visible],
      bufferKeys: available.slice(visible.length), nextPage: input.preserveCursor && old ? old.nextPage : input.mode === 'append' ? Math.max(old?.nextPage || 1, input.nextPage) : input.nextPage,
      hasMore: old && (input.preserveCursor || input.mode === 'append' && old.nextPage > input.nextPage) ? old.hasMore : input.hasMore, totalCount: input.totalCount,
      refreshedAt: new Date().toISOString(), version: (old?.version || 0) + 1, updatedAt: Date.now(),
    });
    put(tx, 'sessions', account, input.key, session);
    if (input.mode === 'replace') {
      const retained = new Set([...session.itemKeys, ...session.bufferKeys]);
      for (const row of await all<DiscoveryProjectRecord>(tx, 'projects', account)) {
        if (row.value.sessionKey === input.key && !retained.has(row.value.key)) tx.objectStore('projects').delete([account, row.key]);
      }
    }
    return session;
  });
}
export const loadReadingAnchor = (account: string, key: string) => transaction(account, 'readonly', tx => get<DiscoveryReadingAnchor>(tx, 'anchors', account, key));
export const saveReadingAnchor = (account: string, anchor: DiscoveryReadingAnchor) => transaction(account, 'readwrite', async tx => {
  const parsed = anchorSchema.parse(anchor), old = await get<DiscoveryReadingAnchor>(tx, 'anchors', account, parsed.sessionKey);
  if (!old || old.updatedAt <= parsed.updatedAt) put(tx, 'anchors', account, parsed.sessionKey, parsed);
});
export const resetReadingAnchor = (account: string, key: string) => transaction(account, 'readwrite', async tx => { tx.objectStore('anchors').delete([account, key]); });
export const loadReadingPreferences = (account: string, channelId: string, defaults?: Partial<DiscoveryReadingPreferences>) => transaction(account, 'readonly', async tx =>
  await get<DiscoveryReadingPreferences>(tx, 'preferences', account, channelId) || { ...defaultReadingPreferences(), ...defaults });
export const saveReadingPreferences = (account: string, channelId: string, value: DiscoveryReadingPreferences) => transaction(account, 'readwrite', async tx => {
  put(tx, 'preferences', account, channelId, readingPreferencesSchema.parse(value));
});
export const clearDiscoveryList = (account: string, key: string) => transaction(account, 'readwrite', async tx => {
  const rows = await all<DiscoveryProjectRecord>(tx, 'projects', account);
  for (const row of rows) if (row.value.sessionKey === key) tx.objectStore('projects').delete([account, row.key]);
  tx.objectStore('sessions').delete([account, key]); tx.objectStore('stages').delete([account, key]);
});
export const clearDiscoveryChannelWorkspace = (account: string, channelId: string) => transaction(account, 'readwrite', async tx => {
  const sessions = await all<DiscoveryBrowseSession>(tx, 'sessions', account);
  const keys = new Set(sessions.filter(row => row.value.channelId === channelId).map(row => row.key));
  for (const row of await all<DiscoveryProjectRecord>(tx, 'projects', account)) {
    if (keys.has(row.value.sessionKey)) tx.objectStore('projects').delete([account, row.key]);
  }
  for (const key of keys) {
    tx.objectStore('sessions').delete([account, key]); tx.objectStore('stages').delete([account, key]); tx.objectStore('anchors').delete([account, key]);
  }
  tx.objectStore('preferences').delete([account, channelId]);
});
export const loadRankingStage = (account: string, key: string) => transaction(account, 'readonly', tx => get<DiscoveryRankingStage>(tx, 'stages', account, key));
export const clearRankingStage = (account: string, key: string, baseVersion?: number) => transaction(account, 'readwrite', async tx => {
  const stage = await get<DiscoveryRankingStage>(tx, 'stages', account, key);
  if (baseVersion === undefined || stage?.baseVersion === baseVersion) tx.objectStore('stages').delete([account, key]);
});
export const saveRankingStage = (account: string, stage: DiscoveryRankingStage, projects: Record<string, unknown>[], isCurrent?: () => boolean) => transaction(account, 'readwrite', async tx => {
  const session = await get<DiscoveryBrowseSession>(tx, 'sessions', account, stage.key);
  if (isCurrent && !isCurrent()) throw new DOMException('Stale discovery task', 'AbortError');
  if ((session?.version || 0) !== stage.baseVersion) throw new Error('DISCOVERY_WORKSPACE_STALE_WRITE');
  const current = await get<DiscoveryRankingStage>(tx, 'stages', account, stage.key);
  if (current?.baseVersion === stage.baseVersion && current.mode === stage.mode && current.nextPage > stage.nextPage) return;
  for (const value of projects) put(tx, 'projects', account, projectKey(stage.key, `staged:repo:${value.id}`), {
    key: `staged:repo:${value.id}`, sessionKey: stage.key, value: projectValue(value),
  });
  put(tx, 'stages', account, stage.key, stage);
});
export const loadRankingProjects = (account: string, stage: DiscoveryRankingStage) => transaction(account, 'readonly', async tx => {
  const records = await Promise.all(stage.projectKeys.map(key => get<DiscoveryProjectRecord>(tx, 'projects', account, projectKey(stage.key, `staged:${key}`))));
  return records.filter((r): r is DiscoveryProjectRecord => !!r).map(r => r.value);
});

export async function exportDiscoveryWorkspace(account: string): Promise<DiscoveryWorkspaceSnapshot> {
  return transaction(account, 'readonly', async tx => {
    const sessions = await all<DiscoveryBrowseSession>(tx, 'sessions', account);
    const projects = await all<DiscoveryProjectRecord>(tx, 'projects', account);
    const preferences = await all<DiscoveryReadingPreferences>(tx, 'preferences', account);
    const anchors = await all<DiscoveryReadingAnchor>(tx, 'anchors', account);
    const referenced = new Set(sessions.flatMap(r => [...r.value.itemKeys, ...r.value.bufferKeys].map(id => projectKey(r.key, id))));
    return { version: 1, accountId: account, sessions: sessions.map(r => r.value),
      projects: projects.filter(r => referenced.has(r.key)).map(r => r.value),
      preferences: preferences.map(r => ({ channelId: r.key, value: r.value })), anchors: anchors.map(r => r.value), stages: [] };
  });
}
const snapshotSchema = z.object({
  version: z.literal(1), accountId: z.string().min(1), sessions: z.array(browseSessionSchema),
  projects: z.array(z.object({ key: z.string(), sessionKey: z.string(), value: z.record(z.string(), z.unknown()) })),
  preferences: z.array(z.object({ channelId: z.string(), value: readingPreferencesSchema })), anchors: z.array(anchorSchema),
  stages: z.array(z.unknown()).default([]),
});
export function validateDiscoveryWorkspace(account: string, payload: unknown): DiscoveryWorkspaceSnapshot {
  const parsed = snapshotSchema.parse(payload);
  if (parsed.accountId !== account) throw new Error('DISCOVERY_WORKSPACE_ACCOUNT_CONFLICT');
  if (!safeValue(parsed)) throw new Error('DISCOVERY_WORKSPACE_UNSAFE_DATA');
  if (new Set(parsed.sessions.map(s => s.key)).size !== parsed.sessions.length) throw new Error('DISCOVERY_WORKSPACE_DUPLICATE_SESSION');
  const projects = new Set(parsed.projects.map(p => projectKey(p.sessionKey, p.key)));
  if (parsed.sessions.some(s => [...s.itemKeys, ...s.bufferKeys].some(id => !projects.has(projectKey(s.key, id))))) throw new Error('DISCOVERY_WORKSPACE_MISSING_PROJECT');
  return { ...parsed, stages: [] };
}
export async function importDiscoveryWorkspace(account: string, payload: unknown, mode: 'merge' | 'replace', migration = false): Promise<void> {
  const parsed = validateDiscoveryWorkspace(account, payload);
  await transaction(account, 'readwrite', async tx => {
    if (mode === 'replace') for (const name of STORES) {
      const rows = await all(tx, name, account); for (const row of rows) tx.objectStore(name).delete([account, row.key]);
    }
    for (const session of parsed.sessions) {
      const current = await get<DiscoveryBrowseSession>(tx, 'sessions', account, session.key);
      if (mode === 'merge' && current) {
        const combined = [...new Set([...current.itemKeys, ...session.itemKeys])];
        put(tx, 'sessions', account, session.key, { ...current, itemKeys: combined,
          bufferKeys: [...new Set([...current.bufferKeys, ...session.bufferKeys])].filter(id => !combined.includes(id)), version: current.version + 1 });
      } else put(tx, 'sessions', account, session.key, session);
    }
    for (const project of parsed.projects) {
      const key = projectKey(project.sessionKey, project.key);
      const current = mode === 'merge' ? await get(tx, 'projects', account, key) : undefined;
      if (!current) put(tx, 'projects', account, key, project);
    }
    for (const pref of parsed.preferences) {
      if (mode === 'replace' || !await get(tx, 'preferences', account, pref.channelId)) put(tx, 'preferences', account, pref.channelId, pref.value);
    }
    for (const anchor of parsed.anchors) {
      const current = await get<DiscoveryReadingAnchor>(tx, 'anchors', account, anchor.sessionKey);
      if (!current || current.updatedAt < anchor.updatedAt) put(tx, 'anchors', account, anchor.sessionKey, anchor);
    }
  }, migration);
}
export async function migrateDiscoveryWorkspaceIdentities(account: string, mappings: readonly RepositoryIdentityMapping[]): Promise<{ changed: number }> {
  const snapshot = await exportDiscoveryWorkspace(account); let count = 0;
  const identities = new Map(mappings.map(m => [m.fullName.toLowerCase(), m]));
  const remapped = new Map<string, string>();
  for (const project of snapshot.projects) {
    const mapping = typeof project.value.full_name === 'string' ? identities.get(project.value.full_name.toLowerCase()) : undefined;
    if (mapping && project.value.id !== mapping.newId) {
      const old = project.key; project.key = old.replace(/repo:\d+$/, `repo:${mapping.newId}`);
      project.value.id = mapping.newId; remapped.set(projectKey(project.sessionKey, old), project.key); count++;
    }
  }
  const id = (session: string, key: string) => remapped.get(projectKey(session, key)) || key;
  for (const s of snapshot.sessions) { s.itemKeys = s.itemKeys.map(key => id(s.key, key)); s.bufferKeys = s.bufferKeys.map(key => id(s.key, key)); }
  for (const a of snapshot.anchors) { a.itemKey = id(a.sessionKey, a.itemKey); a.previousKeys = a.previousKeys.map(key => id(a.sessionKey, key)); }
  if (count) await importDiscoveryWorkspace(account, snapshot, 'replace', true);
  return { changed: count };
}
