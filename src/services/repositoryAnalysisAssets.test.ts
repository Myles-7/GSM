import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig, Repository } from '../types';
import type { RepositoryDetailsAnalysis } from '../types/repositoryDetails';
import { emptyData } from '../features/discovery/custom/model';
import { discoveryAnalysisIdentity } from '../features/discovery/custom/analysisIdentity';
import { applyRepositoryAnalysisAsset, beginRepositoryAnalysisAssetWrite, deleteRepositoryAnalysisAssets, exportRepositoryAnalysisAssets, hasRepositoryAnalysisAsset,
  importRepositoryAnalysisAssets, initializeRepositoryAnalysisAssets, migrateRepositoryAnalysisAssetIdentities,
  repositoryAnalysisFreshness, saveRepositoryAnalysisAsset, useRepositoryAnalysisAssets } from './repositoryAnalysisAssets';

vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => ({ language: 'zh', aiConfigs: [], activeAIConfig: '' }) } }));
const repo = { id: 42, full_name: 'owner/tool', description: 'Original', pushed_at: '2026-09-01T00:00:00Z',
  custom_description: '', custom_category: 'manual', custom_tags: ['personal'], category_locked: true } as Repository;
const config = { id: 'ai', model: 'test', name: 'test', baseUrl: 'https://model.test', apiKey: 'secret' } as AIConfig;
const details: RepositoryDetailsAnalysis = { version: 1, generated_at: '2026-10-01T00:00:00Z', repository_pushed_at: repo.pushed_at!,
  model: 'test', sources: [], summary: 'Saved overview', tags: ['tool'], platforms: ['Linux'], software_forms: [], deployment_modes: [], problem: null,
  features: [], scenarios: [], architecture: null, quickstart: [], deployment: null, cost: null, maintenance: null };
const summaryOnly: Repository = { ...repo, ai_summary: 'Original saved summary', ai_tags: ['original'], ai_platforms: ['Windows'],
  analyzed_at: '2026-10-02T00:00:00Z', analysis_failed: false };
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear();
  await initializeRepositoryAnalysisAssets('alice', []);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('shared repository analysis assets', () => {
  it('retains fresh successes through pushed_at and configuration changes without touching personal fields', async () => {
    await saveRepositoryAnalysisAsset('alice', repo, 'ZH', config, details);
    const applied = applyRepositoryAnalysisAsset('alice', repo, 'zh');
    expect(repositoryAnalysisFreshness(applied, 'zh', config)).toMatchObject({ fallback: false, repositoryChanged: false, configChanged: false, schemaChanged: false });
    const changed = applyRepositoryAnalysisAsset('alice', { ...repo, pushed_at: '2026-10-02T00:00:00Z' }, 'zh');
    expect(repositoryAnalysisFreshness(changed, 'zh', { ...config, model: 'next' })).toMatchObject({ repositoryChanged: true, configChanged: true });
    expect(changed).toMatchObject({ ai_details: details, description: 'Original', custom_description: '', custom_category: 'manual', custom_tags: ['personal'], category_locked: true });
    expect(hasRepositoryAnalysisAsset('alice', changed, 'en')).toBe(true);
    expect(JSON.stringify(applied)).not.toContain('analysisAssetProvenance');
    expect(Object.isFrozen((applied as { analysisAssetProvenance?: unknown }).analysisAssetProvenance)).toBe(true);
    expect(JSON.stringify(await exportRepositoryAnalysisAssets('alice'))).not.toContain('secret');
  });
  it('prefers current language even when another language is newer, then falls back to the newest success', async () => {
    await saveRepositoryAnalysisAsset('alice', repo, 'zh', config, details);
    const english = { ...details, summary: 'English overview', generated_at: '2026-10-02T00:00:00Z' };
    await saveRepositoryAnalysisAsset('alice', repo, 'en', config, english);
    expect(applyRepositoryAnalysisAsset('alice', repo, 'zh').ai_summary).toBe('Saved overview');
    const fallback = applyRepositoryAnalysisAsset('alice', repo, 'ja');
    expect(fallback.ai_summary).toBe('English overview');
    expect(repositoryAnalysisFreshness(fallback, 'ja', config)).toMatchObject({ fallback: true, language: 'en' });
    await saveRepositoryAnalysisAsset('alice', repo, 'en', config, details);
    expect(applyRepositoryAnalysisAsset('alice', repo, 'en').ai_summary).toBe('English overview');
  });
  it('isolates accounts, publishes subscriptions, and persists successes across cache initialization', async () => {
    const listener = vi.fn();
    const unsubscribe = useRepositoryAnalysisAssets.subscribe(listener);
    await saveRepositoryAnalysisAsset('alice', repo, 'zh', config, details);
    expect(listener).toHaveBeenCalled();
    await initializeRepositoryAnalysisAssets('bob', []);
    expect(useRepositoryAnalysisAssets.getState()).toMatchObject({ account: 'bob', assets: {} });
    expect(hasRepositoryAnalysisAsset('bob', repo, 'zh')).toBe(false);
    expect(applyRepositoryAnalysisAsset('bob', applyRepositoryAnalysisAsset('alice', repo, 'zh'), 'zh').ai_details).toBeUndefined();
    await initializeRepositoryAnalysisAssets('alice', []);
    expect(useRepositoryAnalysisAssets.getState().assets).toHaveProperty('[42,"zh"]');
    expect(applyRepositoryAnalysisAsset('alice', repo, 'zh').ai_summary).toBe('Saved overview');
    unsubscribe();
  });
  it('migrates account-scoped legacy successes including previous results on failed records and marks older schemas stale', async () => {
    const legacy = emptyData();
    legacy.analyses = { [discoveryAnalysisIdentity(repo, 'en', config)]: { status: 'failed', details, revision: 1, channelId: 'custom:test', updatedAt: 1 },
      '[42,"channel",1]': { status: 'done', details, revision: 1, channelId: 'custom:test', updatedAt: 1 } };
    await initializeRepositoryAnalysisAssets('alice', [], legacy);
    expect(applyRepositoryAnalysisAsset('alice', repo, 'zh').ai_details).toEqual(details);
    expect((await exportRepositoryAnalysisAssets('alice')).assets).toHaveLength(1);
    const payload = await exportRepositoryAnalysisAssets('alice');
    payload.assets[0].schemaVersion = 'detail-prompt-v1';
    await importRepositoryAnalysisAssets('alice', payload, 'replace');
    expect(repositoryAnalysisFreshness(applyRepositoryAnalysisAsset('alice', repo, 'en'), 'en', config).schemaChanged).toBe(true);
  });
  it('validates an entire import before replace, merges the newest results, and preserves successes on malformed input', async () => {
    await saveRepositoryAnalysisAsset('alice', repo, 'zh', config, details);
    const payload = await exportRepositoryAnalysisAssets('alice');
    await expect(importRepositoryAnalysisAssets('bob', payload, 'replace')).rejects.toThrow();
    await expect(importRepositoryAnalysisAssets('alice', { ...payload, assets: [...payload.assets, { broken: true }] }, 'replace')).rejects.toThrow();
    await expect(saveRepositoryAnalysisAsset('alice', repo, 'zh', config, { ...details, features: 'broken' } as never)).rejects.toThrow();
    expect(applyRepositoryAnalysisAsset('alice', repo, 'zh').ai_details).toEqual(details);
    await importRepositoryAnalysisAssets('alice', payload, 'merge');
    expect((await exportRepositoryAnalysisAssets('alice')).assets).toHaveLength(1);
  });
  it('serializes concurrent writes and leaves no lost repository or language assets', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, id) => saveRepositoryAnalysisAsset('alice', { ...repo, id: id + 1 }, 'zh', config, details)));
    expect((await exportRepositoryAnalysisAssets('alice')).assets).toHaveLength(12);
  });
  it('stores independent rows and writes only the selected repository asset instead of the account snapshot', async () => {
    await saveRepositoryAnalysisAsset('alice', repo, 'zh', config, details);
    await saveRepositoryAnalysisAsset('alice', { ...repo, id: 43 }, 'zh', config, details);
    const put = vi.spyOn(FakeObjectStore.prototype, 'put');
    await saveRepositoryAnalysisAsset('alice', repo, 'en', config, details);
    const assetWrites = put.mock.calls.filter((_call, index) => (put.mock.contexts[index] as IDBObjectStore).name === 'assets');
    expect(assetWrites).toHaveLength(1);
    expect(assetWrites[0][0]).toMatchObject({ accountId: 'alice', repositoryId: 42, language: 'en' });
    expect(put.mock.contexts.every(store => (store as IDBObjectStore).name !== 'accounts')).toBe(true);
    expect((await exportRepositoryAnalysisAssets('alice')).assets).toHaveLength(3);
  });
  it('upgrades the previous account-row database to asset rows and metadata without losing successes or tombstones', async () => {
    const payload = await exportRepositoryAnalysisAssets('alice');
    await saveRepositoryAnalysisAsset('alice', repo, 'zh', config, details);
    payload.assets = (await exportRepositoryAnalysisAssets('alice')).assets;
    vi.stubGlobal('indexedDB', new IDBFactory());
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('gsm-repository-analysis-assets', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('accounts');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('accounts', 'readwrite');
        tx.objectStore('accounts').put({ assets: payload.assets, deletedRepositoryIds: [43], blocked: false }, 'alice');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    await initializeRepositoryAnalysisAssets('alice', [{ ...repo, id: 43, ai_details: details }]);
    expect((await exportRepositoryAnalysisAssets('alice')).assets).toEqual(payload.assets);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('gsm-repository-analysis-assets', 2);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        expect([...db.objectStoreNames]).toEqual(['assets', 'metadata']);
        db.close(); resolve();
      };
    });
  });
  it('rejects late successes after repository deletion or account-wide deletion but permits a new explicit analysis', async () => {
    const oldWrite = await beginRepositoryAnalysisAssetWrite('alice', repo.id);
    const otherWrite = await beginRepositoryAnalysisAssetWrite('alice', 43);
    await deleteRepositoryAnalysisAssets('alice', [42]);
    await expect(saveRepositoryAnalysisAsset('alice', repo, 'zh', config, details, oldWrite)).rejects.toMatchObject({ name: 'AbortError' });
    await saveRepositoryAnalysisAsset('alice', { ...repo, id: 43 }, 'zh', config, details, otherWrite);
    expect((await exportRepositoryAnalysisAssets('alice')).assets.map(asset => asset.repositoryId)).toEqual([43]);
    const newWrite = await beginRepositoryAnalysisAssetWrite('alice', repo.id);
    await saveRepositoryAnalysisAsset('alice', repo, 'zh', config, details, newWrite);
    await deleteRepositoryAnalysisAssets('alice');
    await expect(saveRepositoryAnalysisAsset('alice', repo, 'zh', config, details, newWrite)).rejects.toMatchObject({ name: 'AbortError' });
    expect((await exportRepositoryAnalysisAssets('alice')).assets).toEqual([]);
    expect(applyRepositoryAnalysisAsset('alice', { ...repo, ai_details: details }, 'zh').ai_details).toBeUndefined();
  });
  it('rekeys explicit identities atomically and refuses conflicting targets', async () => {
    const oldId = 100000000001;
    await saveRepositoryAnalysisAsset('alice', { ...repo, id: oldId }, 'zh', config, details);
    const mapping = { oldId, newId: 42, fullName: repo.full_name, evidence: 'GitHub verified ID' };
    expect(await migrateRepositoryAnalysisAssetIdentities('alice', [mapping])).toEqual({ changed: 1 });
    expect(await migrateRepositoryAnalysisAssetIdentities('alice', [mapping])).toEqual({ changed: 0 });
    await saveRepositoryAnalysisAsset('alice', { ...repo, id: oldId }, 'zh', config, { ...details, summary: 'conflict' });
    await expect(migrateRepositoryAnalysisAssetIdentities('alice', [mapping])).rejects.toThrow(/COLLISION/);
    expect((await exportRepositoryAnalysisAssets('alice')).assets).toHaveLength(2);
  });
  it('deletes only explicitly selected repositories and prevents initialization from resurrecting deleted successes', async () => {
    await saveRepositoryAnalysisAsset('alice', repo, 'zh', config, details);
    await saveRepositoryAnalysisAsset('alice', { ...repo, id: 43 }, 'zh', config, details);
    await deleteRepositoryAnalysisAssets('alice', []);
    expect((await exportRepositoryAnalysisAssets('alice')).assets).toHaveLength(2);
    await deleteRepositoryAnalysisAssets('alice', [42]);
    await initializeRepositoryAnalysisAssets('alice', [{ ...repo, ai_details: details }]);
    expect(hasRepositoryAnalysisAsset('alice', repo, 'zh')).toBe(false);
    expect((await exportRepositoryAnalysisAssets('alice')).assets.map(asset => asset.repositoryId)).toEqual([43]);
    await saveRepositoryAnalysisAsset('alice', repo, 'zh', config, details);
    expect(hasRepositoryAnalysisAsset('alice', repo, 'zh')).toBe(true);
    await deleteRepositoryAnalysisAssets('alice');
    await initializeRepositoryAnalysisAssets('alice', [{ ...repo, ai_details: details }]);
    expect((await exportRepositoryAnalysisAssets('alice')).assets).toHaveLength(0);
  });
  it.each(['indexedDB', 'localStorage'] as const)('migrates summary-only successes as minimal legacy details and reuses them after a module restart (%s)', async storage => {
    if (storage === 'localStorage') vi.stubGlobal('indexedDB', undefined);
    await initializeRepositoryAnalysisAssets('alice', [summaryOnly]);
    const payload = await exportRepositoryAnalysisAssets('alice');
    expect(payload.assets).toHaveLength(1);
    expect(payload.assets[0]).toEqual({ version: 1, accountId: 'alice', repositoryId: repo.id, fullName: repo.full_name,
      language: 'und', schemaVersion: 'legacy', configIdentity: null, details: {
        version: 1, summary: summaryOnly.ai_summary, tags: summaryOnly.ai_tags, platforms: summaryOnly.ai_platforms,
        generated_at: summaryOnly.analyzed_at, repository_pushed_at: null, model: 'unknown', sources: [],
        software_forms: [], deployment_modes: [], problem: null, features: [], scenarios: [], architecture: null,
        quickstart: [], deployment: null, cost: null, maintenance: null,
      } });
    if (storage === 'indexedDB') {
      const rows = await new Promise<unknown[]>((resolve, reject) => {
        const request = indexedDB.open('gsm-repository-analysis-assets', 2);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('assets', 'readonly');
          const assets = tx.objectStore('assets').index('account').getAll('alice');
          tx.oncomplete = () => { db.close(); resolve(assets.result); };
          tx.onabort = () => { db.close(); reject(tx.error); };
        };
      });
      expect(rows).toEqual(payload.assets);
    } else {
      const snapshot = JSON.parse(localStorage.getItem('gsm-repository-analysis-assets-v1:alice')!);
      expect(snapshot.assets).toEqual(payload.assets);
    }
    vi.resetModules();
    const restarted = await import('./repositoryAnalysisAssets');
    expect(restarted.useRepositoryAnalysisAssets.getState()).toEqual({ account: null, assets: {} });
    expect(restarted.hasRepositoryAnalysisAsset('alice', repo, 'en')).toBe(false);
    await restarted.initializeRepositoryAnalysisAssets('alice', [repo]);
    expect(restarted.hasRepositoryAnalysisAsset('alice', repo, 'en')).toBe(true);
    expect(restarted.applyRepositoryAnalysisAsset('alice', repo, 'en')).toMatchObject({
      ai_summary: summaryOnly.ai_summary, ai_tags: summaryOnly.ai_tags, ai_platforms: summaryOnly.ai_platforms,
      analyzed_at: summaryOnly.analyzed_at, ai_details: payload.assets[0].details,
      description: repo.description, custom_category: repo.custom_category, custom_tags: repo.custom_tags,
    });
    expect(await restarted.exportRepositoryAnalysisAssets('alice')).toEqual(payload);
  });
  it.each([
    { analysis_failed: true }, { ai_summary: undefined }, { ai_summary: '' }, { ai_summary: '   ' },
    { analyzed_at: undefined }, { analyzed_at: '' }, { analyzed_at: 'not-a-date' },
    { analyzed_at: '2026-10-02' }, { analyzed_at: '2026-02-30T00:00:00Z' },
  ])('rejects untrusted summary-only success metadata: %j', async patch => {
    await initializeRepositoryAnalysisAssets('alice', [{ ...summaryOnly, ...patch }]);
    expect((await exportRepositoryAnalysisAssets('alice')).assets).toEqual([]);
  });
  it.each(['zh', 'en'])('does not overwrite richer %s assets with newer summary-only results, including labelled projections', async language => {
    await saveRepositoryAnalysisAsset('alice', repo, language, config, details);
    const labelled = applyRepositoryAnalysisAsset('alice', repo, language);
    labelled.ai_details = undefined;
    labelled.ai_summary = summaryOnly.ai_summary;
    labelled.analyzed_at = summaryOnly.analyzed_at;
    const before = await exportRepositoryAnalysisAssets('alice');
    await initializeRepositoryAnalysisAssets('alice', [summaryOnly, labelled]);
    expect(await exportRepositoryAnalysisAssets('alice')).toEqual(before);
    expect(applyRepositoryAnalysisAsset('alice', repo, 'zh').ai_details).toEqual(details);
  });
  it.each([false, true])('prioritizes full repository details over summary-only duplicates regardless of input order (%s)', async summaryFirst => {
    const full = { ...repo, ai_details: details };
    await initializeRepositoryAnalysisAssets('alice', summaryFirst ? [summaryOnly, full] : [full, summaryOnly]);
    expect((await exportRepositoryAnalysisAssets('alice')).assets).toHaveLength(1);
    expect(applyRepositoryAnalysisAsset('alice', repo, 'zh').ai_details).toEqual(details);
  });
  it('does not replace richer legacy discovery results with a summary-only repository', async () => {
    const legacy = emptyData();
    legacy.analyses = { [discoveryAnalysisIdentity(repo, 'en', config)]: {
      status: 'done', details, revision: 1, channelId: 'custom:test', updatedAt: 1,
    } };
    await initializeRepositoryAnalysisAssets('alice', [summaryOnly], legacy);
    expect((await exportRepositoryAnalysisAssets('alice')).assets).toHaveLength(1);
    expect(applyRepositoryAnalysisAsset('alice', repo, 'zh').ai_details).toEqual(details);
  });
  it('keeps summary-only migration account-isolated and respects repository and account deletion tombstones', async () => {
    await initializeRepositoryAnalysisAssets('alice', [summaryOnly]);
    const labelled = applyRepositoryAnalysisAsset('alice', repo, 'zh');
    labelled.ai_details = undefined;
    await initializeRepositoryAnalysisAssets('bob', [labelled]);
    expect((await exportRepositoryAnalysisAssets('bob')).assets).toEqual([]);
    await deleteRepositoryAnalysisAssets('alice', [repo.id]);
    await initializeRepositoryAnalysisAssets('alice', [summaryOnly]);
    expect((await exportRepositoryAnalysisAssets('alice')).assets).toEqual([]);
    await deleteRepositoryAnalysisAssets('bob');
    await initializeRepositoryAnalysisAssets('bob', [summaryOnly]);
    expect((await exportRepositoryAnalysisAssets('bob')).assets).toEqual([]);
  });
});
