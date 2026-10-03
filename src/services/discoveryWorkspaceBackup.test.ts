import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportDiscoveryWorkspace, saveBrowsePage, saveReadingAnchor, saveReadingPreferences } from '../features/discovery/workspace/storage';
import { defaultReadingPreferences } from '../features/discovery/workspace/model';
import { loadData, transact } from '../features/discovery/custom/storage';
import { exportRepositoryAnalysisAssets, importRepositoryAnalysisAssets } from './repositoryAnalysisAssets';
import { exportDiscoveryWorkspaceBackup, importDiscoveryWorkspaceBackup, validateDiscoveryWorkspaceBackup } from './discoveryWorkspaceBackup';

const account = '42';
const details = {
  version: 1, generated_at: '2026-10-02T00:00:00Z', repository_pushed_at: null, model: 'model', sources: [],
  summary: 'Saved analysis', tags: [], platforms: [], software_forms: [], deployment_modes: [],
  problem: null, features: [], scenarios: [], architecture: null, quickstart: [], deployment: null, cost: null, maintenance: null,
};
const asset = { version: 1, accountId: account, repositoryId: 7, fullName: 'a/r7', language: 'en',
  schemaVersion: 'detail-prompt-v2', configIdentity: null, details };
const plan = { version: 1, required: [], excluded: [], preferred: [], branches: [{ terms: ['tool'], readme: false }],
  filters: { language: null, minStars: null, maxStars: null, createdWithinDays: null },
  filterSources: { language: null, minStars: null, maxStars: null, createdWithinDays: null }, conflicts: [] };
const channel = (id = 'custom:one') => ({ id, name: 'one', instruction: 'tool', revision: 1, plan,
  enabled: true, paused: false, ai: false, limit: 10, hour: 8, cursors: [], blocked: [], read: [], recommended: {} });

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

async function seed() {
  await saveBrowsePage(account, { key: 'queue', channelId: 'most-popular', signature: '',
    items: [{ id: 7, full_name: 'a/r7', name: 'r7' }], nextPage: 4, hasMore: true, totalCount: 40, mode: 'replace' });
  await saveReadingAnchor(account, { sessionKey: 'queue', itemKey: 'repo:7', offset: 50, previousKeys: [], updatedAt: 10 });
  await saveReadingPreferences(account, 'most-popular', { ...defaultReadingPreferences(), batchSize: 50 });
  await importRepositoryAnalysisAssets(account, { version: 1, accountId: account, assets: [asset] }, 'replace');
  await transact(account, data => {
    data.channels = [channel() as never];
    data.editions = [{ channelId: 'custom:one', date: '2026-10-02', revision: 1, instruction: 'tool',
      entries: [{ repo: { id: 7, full_name: 'a/r7' }, verdict: 'match', reason: 'reason', evidence: ['evidence'],
        method: 'rules', relevance: 1, preference: 0 }], pending: [], errors: [], complete: true,
      searched: 1, filtered: 0, generatedAt: '2026-10-02T00:00:00Z' } as never];
    data.lease = { owner: 'worker', expires: Date.now() + 1000 };
    data.cache = { '7': { text: 'runtime cache', fetchedAt: 10, pushedAt: 'sha' } };
    Object.assign(data, { tasks: ['running'], githubToken: 'private-token' });
  });
}

describe('shared discovery backup', () => {
  it('round trips lists, cursor, anchors, preferences, analyses and custom bookmark context without runtime credentials', async () => {
    await seed();
    const backup = await exportDiscoveryWorkspaceBackup(account);
    expect(backup.workspace?.sessions[0].nextPage).toBe(4);
    expect(backup.workspace?.anchors[0].itemKey).toBe('repo:7');
    expect(backup.analyses?.assets[0].details.summary).toBe('Saved analysis');
    expect(backup.customDiscovery?.editions).toHaveLength(1);
    const serialized = JSON.stringify(backup);
    expect(serialized).not.toMatch(/private-token|runtime cache|"lease"|"tasks"|"githubToken"/);
    await saveReadingPreferences(account, 'most-popular', defaultReadingPreferences());
    await importRepositoryAnalysisAssets(account, { version: 1, accountId: account, assets: [] }, 'replace');
    await importDiscoveryWorkspaceBackup(account, JSON.parse(serialized), 'replace');
    expect((await exportDiscoveryWorkspace(account)).preferences[0].value.batchSize).toBe(50);
    expect((await exportRepositoryAnalysisAssets(account)).assets).toHaveLength(1);
    expect((await loadData(account)).editions[0].entries[0].reason).toBe('reason');
  });

  it.each(['merge', 'replace'] as const)('keeps new local data when old backup blocks are absent (%s)', async mode => {
    await seed();
    const before = await exportDiscoveryWorkspaceBackup(account);
    await importDiscoveryWorkspaceBackup(account, undefined, mode);
    expect(await exportDiscoveryWorkspaceBackup(account)).toEqual(before);
    await importDiscoveryWorkspaceBackup(account, { version: 1, accountId: account, customDiscovery: { channels: [], editions: [] } }, mode);
    expect(await exportDiscoveryWorkspace(account)).toEqual(before.workspace);
    expect(await exportRepositoryAnalysisAssets(account)).toEqual(before.analyses);
  });

  it('preflights every block and refuses foreign accounts or malformed records before writing a valid workspace', async () => {
    await seed();
    const before = await exportDiscoveryWorkspaceBackup(account);
    const incoming = structuredClone(before);
    incoming.workspace!.sessions[0].nextPage = 99;
    incoming.analyses!.assets[0].details = {} as never;
    await expect(importDiscoveryWorkspaceBackup(account, incoming, 'replace')).rejects.toThrow();
    expect(await exportDiscoveryWorkspaceBackup(account)).toEqual(before);
    const foreign = structuredClone(before);
    foreign.analyses!.assets[0].accountId = 'other';
    await expect(importDiscoveryWorkspaceBackup(account, foreign, 'replace')).rejects.toThrow('ACCOUNT');
    await expect(importDiscoveryWorkspaceBackup('other', before, 'replace')).rejects.toThrow('ACCOUNT');
    expect(await exportDiscoveryWorkspaceBackup(account)).toEqual(before);
  });

  it('rejects malformed workspace and custom edition records rather than publishing partial imports', async () => {
    await seed();
    const before = await exportDiscoveryWorkspaceBackup(account);
    const invalid = structuredClone(before);
    invalid.workspace!.projects[0].value.id = '7';
    await expect(importDiscoveryWorkspaceBackup(account, invalid, 'replace')).rejects.toThrow();
    const badCustom = structuredClone(before);
    badCustom.customDiscovery!.editions[0].entries[0].repo.id = -1;
    expect(() => validateDiscoveryWorkspaceBackup(account, badCustom)).toThrow();
    expect(await exportDiscoveryWorkspaceBackup(account)).toEqual(before);
  });

  it('merges channel context while retaining existing rules, reading preferences and account data', async () => {
    await seed();
    const backup = await exportDiscoveryWorkspaceBackup(account);
    backup.customDiscovery!.channels[0].name = 'incoming';
    backup.customDiscovery!.channels.push(channel('custom:two') as never);
    backup.workspace!.preferences[0].value.batchSize = 100;
    await importDiscoveryWorkspaceBackup(account, backup, 'merge');
    const current = await loadData(account);
    expect(current.channels.map(row => row.name)).toEqual(['one', 'one']);
    expect((await exportDiscoveryWorkspace(account)).preferences[0].value.batchSize).toBe(50);
    expect((await exportDiscoveryWorkspace('other')).sessions).toEqual([]);
  });

  it('strips nested credentials and task leases while retaining repository owner metadata', async () => {
    await seed();
    const backup = await exportDiscoveryWorkspaceBackup(account);
    Object.assign(backup.workspace!.projects[0].value, { owner: { login: 'a', accessToken: 'private' }, apiSecret: 'private',
      taskState: { running: true }, leaseOwner: 'worker', password: 'private' });
    const safe = validateDiscoveryWorkspaceBackup(account, backup)!;
    expect(safe.workspace!.projects[0].value.owner).toEqual({ login: 'a' });
    expect(JSON.stringify(safe)).not.toMatch(/private|taskState|leaseOwner/);
  });

  it('rejects inconsistent repository keys and duplicated queue entries before writes', async () => {
    await seed();
    const backup = await exportDiscoveryWorkspaceBackup(account);
    backup.workspace!.projects[0].value.id = 8;
    await expect(importDiscoveryWorkspaceBackup(account, backup, 'replace')).rejects.toThrow('IDENTITY');
    backup.workspace!.projects[0].value.id = 7;
    backup.workspace!.sessions[0].itemKeys.push('repo:7');
    await expect(importDiscoveryWorkspaceBackup(account, backup, 'replace')).rejects.toThrow('DUPLICATE');
    expect((await exportDiscoveryWorkspace(account)).sessions[0].itemKeys).toEqual(['repo:7']);
  });
});
