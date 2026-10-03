import { create } from 'zustand';
import { z } from 'zod';
import type { AIConfig, Repository } from '../types';
import type { RepositoryDetailsAnalysis } from '../types/repositoryDetails';
import type { CustomDiscoveryData, DiscoveryAnalysisRecord } from '../features/discovery/custom/model';
import { discoveryAnalysisIdentity } from '../features/discovery/custom/analysisIdentity';
import { transact } from '../features/discovery/custom/storage';
import { clearRepositoryDetailReadmeCache } from './repositoryDetailReadme';
import { repositoryDetailsSchema } from '../utils/repositoryDetailsSchema';
import { validateRepositoryIdentityMappings, type RepositoryIdentityMapping } from '../utils/repositoryIdentity';
import { assertRepositoryIdentityWritable } from './repositoryIdentityGate';
import { useAppStore } from '../store/useAppStore';

export type { RepositoryIdentityMapping } from '../utils/repositoryIdentity';
export const REPOSITORY_ANALYSIS_SCHEMA = 'detail-prompt-v2';
export const repositoryAnalysisTaskKey = discoveryAnalysisIdentity;
export function claimRepositoryAnalysisTask(data: CustomDiscoveryData,
  work: { key: string; channelId: string; revision: number; force: boolean }, owner: string, now = Date.now()): boolean {
  const previous = data.analyses?.[work.key];
  if ((previous?.status === 'running' && (previous.expires || 0) > now) || (previous?.details && !work.force)) return false;
  data.analyses ??= {};
  data.analyses[work.key] = {
    ...previous, status: 'running', issue: undefined, owner, expires: now + 90000,
    channelId: work.channelId, revision: work.revision, updatedAt: now,
  };
  return true;
}
export function commitRepositoryAnalysisTask(data: CustomDiscoveryData, key: string, owner: string, patch: Partial<DiscoveryAnalysisRecord>): boolean {
  const entry = data.analyses?.[key];
  if (!entry || entry.owner !== owner || (entry.expires || 0) <= Date.now()) return false;
  Object.assign(entry, patch, { owner: undefined, expires: undefined, updatedAt: Date.now() });
  return true;
}
export async function claimRepositoryAnalysisTaskLease(account: string, key: string, owner: string, valid = () => true): Promise<boolean> {
  return transact(account, data => valid() && claimRepositoryAnalysisTask(data,
    { key, channelId: 'repository-details', revision: 1, force: true }, owner));
}
export async function renewRepositoryAnalysisTaskLease(account: string, key: string, owner: string, valid = () => true): Promise<boolean> {
  return transact(account, data => {
    if (!valid() || data.analyses?.[key]?.owner !== owner || (data.analyses[key].expires ?? 0) <= Date.now()) return false;
    data.analyses[key].expires = Date.now() + 90000;
    return true;
  });
}
export async function finishRepositoryAnalysisTaskLease(account: string, key: string, owner: string,
  status: 'done' | 'failed' | 'cancelled', details?: RepositoryDetailsAnalysis, valid = () => true): Promise<boolean> {
  return transact(account, data => valid() && commitRepositoryAnalysisTask(data, key, owner, {
    status, ...(details ? { details, issue: undefined } : {}),
  }));
}
export function cancelRepositoryAnalysisTasks(account?: string, repoIds?: number[]): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('gsm:repository-analysis-tasks-cancel', {
    detail: { account, repositoryIds: repoIds },
  }));
}
export function clearRepositoryAnalysisRuntime(): void {
  cancelRepositoryAnalysisTasks();
  clearRepositoryDetailReadmeCache();
}
const assetSchema = z.object({
  version: z.literal(1), accountId: z.string().min(1), repositoryId: z.number().int().positive().safe(),
  fullName: z.string(), language: z.string().min(1), schemaVersion: z.string(),
  configIdentity: z.string().nullable(), details: repositoryDetailsSchema,
}).strict();
export type RepositoryAnalysisAsset = z.infer<typeof assetSchema>;
export interface RepositoryAnalysisProvenance {
  readonly accountId: string;
  readonly language: string;
  readonly schemaVersion: string;
  readonly configIdentity: string | null;
}
export interface RepositoryWithAnalysisAsset extends Repository {
  readonly analysisAssetProvenance?: Readonly<RepositoryAnalysisProvenance>;
}
export interface RepositoryAnalysisAssetWriteVersion {
  readonly accountId: string;
  readonly repositoryId: number;
  readonly generation: number;
  readonly repositoryGeneration: number;
}
export const useRepositoryAnalysisAssets = create<{
  account: string | null; assets: Readonly<Record<string, RepositoryAnalysisAsset>>;
}>(() => ({ account: null, assets: {} }));

const normalizeLanguage = (language: string) => language.trim().replace(/_/g, '-').toLowerCase();
const keyOf = (asset: Pick<RepositoryAnalysisAsset, 'repositoryId' | 'language'>) =>
  JSON.stringify([asset.repositoryId, normalizeLanguage(asset.language)]);
const configIdentity = (config?: AIConfig) => config
  ? JSON.stringify(JSON.parse(discoveryAnalysisIdentity({ id: 1 } as Repository, '', config)).slice(3)) : null;
const activeConfig = () => {
  const state = useAppStore.getState?.();
  return state?.aiConfigs?.find(config => config.id === state.activeAIConfig);
};
const accounts = new Map<string, Record<string, RepositoryAnalysisAsset>>();
interface MigrationState {
  deletedRepositoryIds: number[]; blocked: boolean;
  generation: number; repositoryGenerations: Record<string, number>;
}
const migrationStates = new Map<string, MigrationState>();
const metadataSchema = z.object({
  deletedRepositoryIds: z.array(z.number().int().positive().safe()).default([]), blocked: z.boolean().default(false),
  generation: z.number().int().nonnegative().default(0), repositoryGenerations: z.record(z.string(), z.number().int().nonnegative()).default({}),
});
const snapshotSchema = metadataSchema.extend({ assets: z.array(assetSchema) });
function readSnapshot(account: string, raw: unknown) {
  const snapshot = Array.isArray(raw) ? { assets: raw, ...metadataSchema.parse({}) } : snapshotSchema.parse(raw);
  return { assets: normalizeAssets(account, snapshot.assets), migration: metadataSchema.parse(snapshot) };
}
const accountRequired = (account: string) => {
  if (!account?.trim()) throw new Error('ANALYSIS_ASSET_ACCOUNT_REQUIRED');
};
const newer = (a: RepositoryAnalysisAsset, b: RepositoryAnalysisAsset) =>
  Date.parse(a.details.generated_at) >= Date.parse(b.details.generated_at) ? a : b;
function normalizeAssets(account: string, raw: unknown): Record<string, RepositoryAnalysisAsset> {
  if (!Array.isArray(raw)) throw new Error('INVALID_ANALYSIS_ASSETS');
  const assets: Record<string, RepositoryAnalysisAsset> = {};
  for (const row of raw) {
    const asset = assetSchema.parse(row);
    if (asset.accountId !== account) throw new Error('ANALYSIS_ASSET_ACCOUNT_CONFLICT');
    asset.language = normalizeLanguage(asset.language);
    if (!asset.language) throw new Error('INVALID_ANALYSIS_ASSET_LANGUAGE');
    const key = keyOf(asset);
    assets[key] = assets[key] ? newer(assets[key], asset) : asset;
  }
  return assets;
}
const publish = (account: string, assets: Record<string, RepositoryAnalysisAsset>) => {
  accounts.set(account, assets);
  if (useRepositoryAnalysisAssets.getState().account === account) useRepositoryAnalysisAssets.setState({ assets });
};

const storageKey = (asset: RepositoryAnalysisAsset) => [asset.accountId, asset.repositoryId, asset.language];
const idbRequest = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('gsm-repository-analysis-assets', 2);
    let failure: unknown;
    request.onupgradeneeded = () => {
      const db = request.result;
      const assets = db.createObjectStore('assets', { keyPath: ['accountId', 'repositoryId', 'language'] });
      assets.createIndex('account', 'accountId');
      assets.createIndex('repository', ['accountId', 'repositoryId']);
      const metadata = db.createObjectStore('metadata');
      if (!db.objectStoreNames.contains('accounts')) return;
      // Upgrade the original account snapshots atomically, preserving deletion markers.
      const cursor = request.transaction!.objectStore('accounts').openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) { db.deleteObjectStore('accounts'); return; }
        try {
          const account = String(row.key);
          const snapshot = readSnapshot(account, row.value);
          for (const asset of Object.values(snapshot.assets)) assets.put(asset);
          metadata.put(snapshot.migration, account);
          row.continue();
        } catch (error) { failure = error; request.transaction!.abort(); }
      };
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(failure || request.error);
    request.onblocked = () => reject(new Error('Analysis asset storage is blocked'));
  });
}

// Each write touches only changed asset rows and small account metadata.
async function transaction<T>(account: string, change: (assets: Record<string, RepositoryAnalysisAsset>, state: MigrationState) => T,
  write = true, migration = false, repositoryIds?: readonly number[]): Promise<T> {
  accountRequired(account);
  if (write && !migration) assertRepositoryIdentityWritable(account);
  const fallbackKey = `gsm-repository-analysis-assets-v1:${encodeURIComponent(account)}`;
  if (typeof indexedDB === 'undefined') {
    const work = () => {
      const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(fallbackKey);
      const { assets, migration: state } = raw ? readSnapshot(account, JSON.parse(raw)) : {
        assets: { ...accounts.get(account) }, migration: metadataSchema.parse(migrationStates.get(account) ?? {}),
      };
      const result = change(assets, state);
      if (write && typeof localStorage !== 'undefined') localStorage.setItem(fallbackKey, JSON.stringify({ assets: Object.values(assets), ...state }));
      migrationStates.set(account, state);
      publish(account, assets);
      return result;
    };
    return typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request(fallbackKey, work) : work();
  }
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(['assets', 'metadata'], write ? 'readwrite' : 'readonly');
      let result: T;
      let assets: Record<string, RepositoryAnalysisAsset>;
      let state: MigrationState;
      let failure: unknown;
      let scoped = repositoryIds !== undefined;
      let migratedFallback = false;
      const timer = setTimeout(() => tx.abort(), 15000);
      tx.oncomplete = () => {
        clearTimeout(timer);
        migrationStates.set(account, state);
        if (scoped && repositoryIds?.length === 0) {
          // A version check reads metadata only and does not redraw repository cards.
        } else if (scoped) {
          const merged = { ...accounts.get(account) };
          const ids = new Set(repositoryIds);
          for (const [key, asset] of Object.entries(merged)) if (ids.has(asset.repositoryId)) delete merged[key];
          publish(account, Object.assign(merged, assets));
        } else publish(account, assets);
        if (migratedFallback) localStorage.removeItem(fallbackKey);
        resolve(result);
      };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(failure || tx.error || new Error('Analysis asset transaction aborted')); };
      const assetStore = tx.objectStore('assets');
      const metadataStore = tx.objectStore('metadata');
      const rows = repositoryIds === undefined ? idbRequest(assetStore.index('account').getAll(account))
        : Promise.all([...new Set(repositoryIds)].map(id => idbRequest(assetStore.index('repository').getAll([account, id])))).then(groups => groups.flat());
      void Promise.all([idbRequest(metadataStore.get(account)), rows]).then(([rawMetadata, rawAssets]) => {
        try {
          const fallback = rawMetadata === undefined && typeof localStorage !== 'undefined' ? localStorage.getItem(fallbackKey) : null;
          const snapshot = fallback ? readSnapshot(account, JSON.parse(fallback)) : {
            assets: normalizeAssets(account, rawAssets), migration: metadataSchema.parse(rawMetadata ?? {}),
          };
          assets = snapshot.assets; state = snapshot.migration;
          if (fallback) scoped = false;
          const before = fallback ? {} : { ...assets };
          const previousMetadata = JSON.stringify(state);
          result = change(assets, state);
          if (write) {
            if (!migration) assertRepositoryIdentityWritable(account);
            for (const [key, asset] of Object.entries(before)) if (!assets[key]) assetStore.delete(storageKey(asset));
            for (const [key, asset] of Object.entries(assets)) if (asset !== before[key]) assetStore.put(asset);
            if (rawMetadata === undefined || JSON.stringify(state) !== previousMetadata) metadataStore.put(state, account);
            migratedFallback = !!fallback;
          }
        } catch (error) { failure = error; tx.abort(); }
      }).catch(error => { failure = error; tx.abort(); });
    });
  } finally { db.close(); }
}

const put = (assets: Record<string, RepositoryAnalysisAsset>, asset: RepositoryAnalysisAsset) => {
  const key = keyOf(asset);
  assets[key] = assets[key] ? newer(assets[key], asset) : asset;
};
function legacyAssets(account: string, repositories: Repository[], legacy?: CustomDiscoveryData): RepositoryAnalysisAsset[] {
  const names = new Map(repositories.map(repo => [repo.id, repo.full_name]));
  for (const edition of legacy?.editions ?? []) for (const entry of edition.entries) names.set(entry.repo.id, entry.repo.full_name);
  return Object.entries(legacy?.analyses ?? {}).flatMap(([key, record]) => {
    try {
      const identity: unknown = JSON.parse(key);
      if (!Array.isArray(identity) || identity.length < 4 || typeof identity[0] !== 'number' || typeof identity[2] !== 'string') return [];
      const parsed = assetSchema.safeParse({ version: 1, accountId: account, repositoryId: identity[0],
        fullName: names.get(identity[0]) ?? '', language: normalizeLanguage(identity[2]),
        schemaVersion: identity[3], configIdentity: identity.length > 4 ? JSON.stringify(identity.slice(3)) : null, details: record.details });
      return parsed.success ? [parsed.data] : [];
    } catch { return []; }
  });
}
export function canUseLegacyRepositoryAnalysisAssets(account: string, repositoryId: number): boolean {
  const state = migrationStates.get(account);
  return !state?.blocked && !state?.deletedRepositoryIds.includes(repositoryId);
}
export function findLegacyRepositoryAnalysisAsset(account: string, repo: Repository, language: string, legacy: CustomDiscoveryData): RepositoryAnalysisAsset | undefined {
  if (!canUseLegacyRepositoryAnalysisAssets(account, repo.id)) return undefined;
  return select(legacyAssets(account, [repo], legacy), repo.id, language);
}
function select(assets: RepositoryAnalysisAsset[], id: number, language: string) {
  const matches = assets.filter(asset => asset.repositoryId === id);
  const sameLanguage = matches.filter(asset => asset.language === normalizeLanguage(language));
  return (sameLanguage.length ? sameLanguage : matches).reduce<RepositoryAnalysisAsset | undefined>(
    (latest, asset) => latest ? newer(latest, asset) : asset, undefined);
}
export function projectRepositoryAnalysisAsset(repo: Repository, asset: RepositoryAnalysisAsset): RepositoryWithAnalysisAsset {
  const details = asset.details;
  const projected: RepositoryWithAnalysisAsset = {
    ...repo, ai_details: details, ai_summary: details.summary ?? details.problem ?? repo.ai_summary,
    ai_tags: details.tags, ai_platforms: details.platforms,
    analyzed_at: details.generated_at, analysis_failed: false, analysis_error: undefined,
  };
  // Provenance is local, readonly UI metadata; do not put it into root snapshots/backups.
  Object.defineProperty(projected, 'analysisAssetProvenance', { value: Object.freeze({
    accountId: asset.accountId, language: asset.language, schemaVersion: asset.schemaVersion, configIdentity: asset.configIdentity,
  }), enumerable: false });
  return projected;
}
function selectedAsset(account: string, repositoryId: number, language: string) {
  const assets = accounts.get(account) ?? {};
  return assets[keyOf({ repositoryId, language })] ?? select(Object.values(assets), repositoryId, language);
}
export function applyRepositoryAnalysisAsset(account: string, repo: Repository, language: string): Repository {
  const asset = selectedAsset(account, repo.id, language);
  if (asset) return projectRepositoryAnalysisAsset(repo, asset);
  const provenance = (repo as RepositoryWithAnalysisAsset).analysisAssetProvenance;
  if ((provenance && provenance.accountId !== account) || !canUseLegacyRepositoryAnalysisAssets(account, repo.id)) return {
    ...repo, ai_details: undefined, ai_summary: undefined, ai_tags: undefined, ai_platforms: undefined,
    analyzed_at: undefined, analysis_failed: false, analysis_error: undefined,
  };
  return repo;
}
export function hasRepositoryAnalysisAsset(account: string, repo: Repository, language: string): boolean {
  return !!selectedAsset(account, repo.id, language);
}
export function repositoryAnalysisFreshness(repo: Repository, language: string, config = activeConfig()) {
  const provenance = (repo as RepositoryWithAnalysisAsset).analysisAssetProvenance;
  const details = repo.ai_details;
  return {
    language: provenance?.language,
    fallback: !!provenance && provenance.language !== normalizeLanguage(language),
    repositoryChanged: !!details && details.repository_pushed_at !== (repo.pushed_at || null),
    schemaChanged: !!provenance && provenance.schemaVersion !== REPOSITORY_ANALYSIS_SCHEMA,
    configChanged: !!provenance && configIdentity(config) !== provenance.configIdentity,
  };
}
function legacySummaryDetails(repo: Repository): RepositoryDetailsAnalysis | undefined {
  if (repo.ai_details != null || repo.analysis_failed || typeof repo.ai_summary !== 'string' || !repo.ai_summary.trim()) return;
  const parsed = repositoryDetailsSchema.safeParse({
    version: 1, generated_at: repo.analyzed_at, repository_pushed_at: null, model: 'unknown', sources: [],
    summary: repo.ai_summary, tags: repo.ai_tags ?? [], platforms: repo.ai_platforms ?? [],
    software_forms: [], deployment_modes: [], problem: null, features: [], scenarios: [], architecture: null,
    quickstart: [], deployment: null, cost: null, maintenance: null,
  });
  return parsed.success ? parsed.data : undefined;
}
export async function initializeRepositoryAnalysisAssets(account: string, repositories: Repository[], legacy?: CustomDiscoveryData): Promise<void> {
  accountRequired(account);
  useRepositoryAnalysisAssets.setState({ account, assets: accounts.get(account) ?? {} });
  await transaction(account, (assets, state) => {
    if (state.blocked) return;
    const deleted = new Set(state.deletedRepositoryIds);
    const names = new Map(repositories.map(repo => [repo.id, repo.full_name]));
    for (const [key, asset] of Object.entries(assets)) if (!asset.fullName && names.has(asset.repositoryId)) assets[key] = { ...asset, fullName: names.get(asset.repositoryId)! };
    for (const asset of legacyAssets(account, repositories, legacy)) if (!deleted.has(asset.repositoryId)) put(assets, asset);
    const knownRepositories = new Set(Object.values(assets).map(asset => asset.repositoryId));
    for (const repo of repositories) {
      if (deleted.has(repo.id)) continue;
      const provenance = (repo as RepositoryWithAnalysisAsset).analysisAssetProvenance;
      if (provenance && provenance.accountId !== account) continue;
      if (!provenance && knownRepositories.has(repo.id)) continue;
      const details = repositoryDetailsSchema.safeParse(repo.ai_details);
      if (!details.success) continue;
      // Unlabelled saved results predate language tracking. Do not overwrite a labelled asset.
      put(assets, { version: 1, accountId: account, repositoryId: repo.id, fullName: repo.full_name,
        language: normalizeLanguage(provenance?.language || 'und'), schemaVersion: provenance?.schemaVersion || 'legacy',
        configIdentity: provenance?.configIdentity ?? null, details: details.data });
    }
    // Summary-only snapshots are last-resort migration, never replacements for richer assets in any language.
    const populatedRepositories = new Set(Object.values(assets).map(asset => asset.repositoryId));
    for (const repo of repositories) {
      if (deleted.has(repo.id) || populatedRepositories.has(repo.id)) continue;
      const provenance = (repo as RepositoryWithAnalysisAsset).analysisAssetProvenance;
      if (provenance && provenance.accountId !== account) continue;
      const details = legacySummaryDetails(repo);
      if (!details) continue;
      const parsed = assetSchema.safeParse({ version: 1, accountId: account, repositoryId: repo.id, fullName: repo.full_name,
        language: normalizeLanguage(provenance?.language || 'und'), schemaVersion: 'legacy', configIdentity: null, details });
      if (!parsed.success) continue;
      put(assets, parsed.data);
      populatedRepositories.add(repo.id);
    }
  });
}
function checkWriteVersion(state: MigrationState, version: RepositoryAnalysisAssetWriteVersion, account = version.accountId, id = version.repositoryId) {
  if (account !== version.accountId || id !== version.repositoryId || state.generation !== version.generation
    || (state.repositoryGenerations[id] ?? 0) !== version.repositoryGeneration) {
    throw new DOMException('Analysis deleted while running', 'AbortError');
  }
}
export async function beginRepositoryAnalysisAssetWrite(account: string, repositoryId: number): Promise<RepositoryAnalysisAssetWriteVersion> {
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) throw new Error('INVALID_ANALYSIS_ASSET_REPOSITORY_ID');
  return transaction(account, (_assets, state) => Object.freeze({
    accountId: account, repositoryId, generation: state.generation, repositoryGeneration: state.repositoryGenerations[repositoryId] ?? 0,
  }), false, false, []);
}
export async function assertRepositoryAnalysisAssetWrite(version: RepositoryAnalysisAssetWriteVersion): Promise<void> {
  await transaction(version.accountId, (_assets, state) => checkWriteVersion(state, version), false, false, []);
}
export async function saveRepositoryAnalysisAsset(account: string, repo: Repository, language: string, config: AIConfig | undefined,
  details: RepositoryDetailsAnalysis, expectedVersion?: RepositoryAnalysisAssetWriteVersion): Promise<void> {
  const asset = assetSchema.parse({ version: 1, accountId: account, repositoryId: repo.id, fullName: repo.full_name,
    language: normalizeLanguage(language), schemaVersion: REPOSITORY_ANALYSIS_SCHEMA, configIdentity: configIdentity(config), details });
  await transaction(account, (assets, state) => {
    if (expectedVersion) checkWriteVersion(state, expectedVersion, account, repo.id);
    state.deletedRepositoryIds = state.deletedRepositoryIds.filter(id => id !== repo.id);
    put(assets, asset);
  }, true, false, [repo.id]);
}
export async function exportRepositoryAnalysisAssets(account: string): Promise<{ version: 1; accountId: string; assets: RepositoryAnalysisAsset[] }> {
  return transaction(account, assets => ({ version: 1 as const, accountId: account, assets: structuredClone(Object.values(assets)) }), false);
}
export function validateRepositoryAnalysisAssets(account: string, payload: unknown): { version: 1; accountId: string; assets: RepositoryAnalysisAsset[] } {
  accountRequired(account);
  const parsed = z.object({ version: z.literal(1), accountId: z.literal(account), assets: z.array(assetSchema) }).strict().parse(payload);
  return { version: 1, accountId: account, assets: Object.values(normalizeAssets(account, parsed.assets)) };
}
export async function importRepositoryAnalysisAssets(account: string, payload: unknown, mode: 'merge' | 'replace', migration = false): Promise<void> {
  const incoming = validateRepositoryAnalysisAssets(account, payload);
  if (mode !== 'merge' && mode !== 'replace') throw new Error('INVALID_ANALYSIS_ASSET_IMPORT_MODE');
  await transaction(account, (assets, state) => {
    if (mode === 'replace') {
      for (const key of Object.keys(assets)) delete assets[key];
      if (!migration) { state.blocked = true; state.generation += 1; }
    }
    for (const asset of incoming.assets) {
      if (!migration) state.deletedRepositoryIds = state.deletedRepositoryIds.filter(id => id !== asset.repositoryId);
      put(assets, asset);
    }
  }, true, migration, mode === 'merge' ? incoming.assets.map(asset => asset.repositoryId) : undefined);
}
export async function migrateRepositoryAnalysisAssetIdentities(account: string, mappings: readonly RepositoryIdentityMapping[]): Promise<{ changed: number }> {
  validateRepositoryIdentityMappings(mappings);
  return transaction(account, (assets, state) => {
    let changed = 0;
    for (const mapping of mappings) for (const [key, asset] of Object.entries(assets)) {
      if (asset.repositoryId !== mapping.oldId) continue;
      if (asset.fullName && asset.fullName.toLowerCase() !== mapping.fullName.toLowerCase()) throw new Error('ANALYSIS_ASSET_IDENTITY_CONFLICT');
      const moved = { ...asset, repositoryId: mapping.newId, fullName: mapping.fullName };
      const target = assets[keyOf(moved)];
      if (target && (target.fullName.toLowerCase() !== mapping.fullName.toLowerCase()
        || JSON.stringify(target.details) !== JSON.stringify(asset.details))) throw new Error('ANALYSIS_ASSET_IDENTITY_COLLISION');
      delete assets[key];
      put(assets, moved);
      changed += 1;
    }
    state.deletedRepositoryIds = [...new Set(state.deletedRepositoryIds.map(id => mappings.find(mapping => mapping.oldId === id)?.newId ?? id))];
    for (const mapping of mappings) if (state.repositoryGenerations[mapping.oldId] !== undefined) {
      state.repositoryGenerations[mapping.newId] = Math.max(state.repositoryGenerations[mapping.newId] ?? 0, state.repositoryGenerations[mapping.oldId]);
      delete state.repositoryGenerations[mapping.oldId];
    }
    return { changed };
  }, true, true, mappings.flatMap(mapping => [mapping.oldId, mapping.newId]));
}
export async function deleteRepositoryAnalysisAssets(account: string, repoIds?: number[]): Promise<void> {
  if (repoIds?.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('INVALID_ANALYSIS_ASSET_REPOSITORY_ID');
  const ids = repoIds && new Set(repoIds);
  await transaction(account, (assets, state) => {
    for (const [key, asset] of Object.entries(assets)) if (!ids || ids.has(asset.repositoryId)) delete assets[key];
    // Explicit deletion must survive the next legacy migration and page reload.
    if (ids) {
      state.deletedRepositoryIds = [...new Set([...state.deletedRepositoryIds, ...ids])];
      for (const id of ids) state.repositoryGenerations[id] = (state.repositoryGenerations[id] ?? 0) + 1;
    } else { state.blocked = true; state.generation += 1; }
  }, true, false, repoIds);
  cancelRepositoryAnalysisTasks(account, repoIds);
}
