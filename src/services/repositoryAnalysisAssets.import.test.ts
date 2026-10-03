import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportRepositoryAnalysisAssets, importRepositoryAnalysisAssets, validateRepositoryAnalysisAssets } from './repositoryAnalysisAssets';
import { holdRepositoryIdentityWrites, releaseRepositoryIdentityWrites } from './repositoryIdentityGate';

vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => ({ aiConfigs: [], language: 'en' }) } }));

const account = 'asset-import-test';
const payload = { version: 1, accountId: account, assets: [] };

afterEach(() => {
  releaseRepositoryIdentityWrites(account);
  vi.unstubAllGlobals();
});

describe('analysis asset rollback import', () => {
  it.each([false, true])('preserves preexisting tombstones and blocked=%s during migration rollback', async blocked => {
    vi.stubGlobal('indexedDB', undefined);
    const key = `gsm-repository-analysis-assets-v1:${account}`;
    localStorage.setItem(key, JSON.stringify({ assets: [], deletedRepositoryIds: [42], blocked }));
    holdRepositoryIdentityWrites(account, 'test-migration');
    await importRepositoryAnalysisAssets(account, payload, 'replace', true);
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ deletedRepositoryIds: [42], blocked });
  });
  it('keeps ordinary restores gated while allowing explicit migration rollback', async () => {
    vi.stubGlobal('indexedDB', undefined);
    holdRepositoryIdentityWrites(account, 'test-migration');
    await expect(importRepositoryAnalysisAssets(account, payload, 'replace')).rejects.toThrow('REPOSITORY_IDENTITY_MAINTENANCE_REQUIRED');
    await expect(importRepositoryAnalysisAssets(account, payload, 'replace', true)).resolves.toBeUndefined();
    expect(await exportRepositoryAnalysisAssets(account)).toEqual(payload);
    await expect(importRepositoryAnalysisAssets(account, payload, 'merge')).rejects.toThrow('REPOSITORY_IDENTITY_MAINTENANCE_REQUIRED');
  });

  it('preflights without writing and rejects mismatched accounts and malformed assets', () => {
    const before = localStorage.getItem(`gsm-repository-analysis-assets-v1:${account}`);
    expect(validateRepositoryAnalysisAssets(account, payload)).toEqual(payload);
    expect(localStorage.getItem(`gsm-repository-analysis-assets-v1:${account}`)).toBe(before);
    expect(() => validateRepositoryAnalysisAssets(account, { ...payload, accountId: 'other' })).toThrow();
    expect(() => validateRepositoryAnalysisAssets(account, { ...payload, assets: [{}] })).toThrow();
    expect(() => validateRepositoryAnalysisAssets('', payload)).toThrow('ANALYSIS_ASSET_ACCOUNT_REQUIRED');
  });

  it('still validates payload and mode when migration bypass is requested', async () => {
    holdRepositoryIdentityWrites(account, 'test-migration');
    await expect(importRepositoryAnalysisAssets(account, { ...payload, accountId: 'other' }, 'replace', true)).rejects.toThrow();
    await expect(importRepositoryAnalysisAssets(account, payload, 'invalid' as 'merge', true)).rejects.toThrow('INVALID_ANALYSIS_ASSET_IMPORT_MODE');
  });
});
