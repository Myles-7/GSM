import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState, Repository } from '../types';
import type { RepositoryIdentityParticipantBackup } from './repositoryIdentityParticipants';
import type { RepositoryChatSession } from '../types/repositoryChat';
import { assertRepositoryIdentityWritable, releaseRepositoryIdentityWrites } from './repositoryIdentityGate';
import {
  readRepositoryIdentityJournal, remapIdentityStoreSnapshot,
  runRepositoryIdentityMigration, restoreRepositoryIdentityMigration,
} from './repositoryIdentityMigration';

const fixture = vi.hoisted(() => ({
  state: {} as AppState,
  participants: {} as RepositoryIdentityParticipantBackup,
  journals: new Map<string, string>(),
  home: null as null | {
    identity: { workspaceId: string; githubUserId: number };
    db: { metadata: ReturnType<typeof vi.fn>; pending: ReturnType<typeof vi.fn>; allRecords: ReturnType<typeof vi.fn> };
    reloadSnapshotForIdentityMaintenance: ReturnType<typeof vi.fn>;
  },
  request: vi.fn(), restore: vi.fn(), workbench: vi.fn(), custom: vi.fn(),
  backup: vi.fn(),
}));
vi.mock('../store/useAppStore', () => ({
  useAppStore: { getState: () => fixture.state },
  setIdentityMigrationStoreState: (patch: Partial<AppState>) => Object.assign(fixture.state, patch),
}));
vi.mock('../store/persistence/options', () => ({
  appPersistenceOptions: { partialize: (state: AppState) => ({
    ...state, releaseSubscriptions: [...state.releaseSubscriptions],
    releaseExpandedRepositories: [...state.releaseExpandedRepositories],
  }) },
}));
vi.mock('../store/persistence/storage', () => ({ flushAppStorePersistence: vi.fn() }));
vi.mock('./indexedDbStorage', () => ({ indexedDBStorage: {
  getItem: async (key: string) => fixture.journals.get(key) ?? null,
  setItem: async (key: string, data: string) => { fixture.journals.set(key, data); },
  removeItem: async (key: string) => { fixture.journals.delete(key); },
} }));
vi.mock('./autoSync', () => ({ waitForInFlightSync: vi.fn() }));
vi.mock('./backendAdapter', () => ({ backend: { isAvailable: false } }));
vi.mock('../home/desktop', () => ({
  getDesktopHomeSync: () => fixture.home,
  pauseDesktopHomeForIdentity: async () => fixture.home,
  flushDesktopHome: vi.fn(),
  activateDesktopHome: vi.fn(),
  desktopApi: () => ({
    request: fixture.request,
    capabilities: async () => ({ workspace: { id: 'home', githubUserId: 42 } }),
  }),
}));
vi.mock('../home/sync', () => ({ HomeSync: class {
  identity = { workspaceId: 'home', githubUserId: 42 };
  db = { setMetadata: vi.fn() };
} }));
vi.mock('./repositoryIdentityParticipants', async importOriginal => {
  const original = await importOriginal<typeof import('./repositoryIdentityParticipants')>();
  return { ...original,
    backupParticipantIdentities: fixture.backup,
    restoreParticipantIdentities: fixture.restore,
    migrateWorkbenchRepositoryIdentities: fixture.workbench,
    migrateCustomDiscoveryRepositoryIdentities: fixture.custom,
  };
});

const oldId = 1_700_000_000_001;
const mappings = [{ oldId, newId: 123, fullName: 'owner/repo', evidence: 'GitHub ID independently confirmed by user' }];
const repo = (id = oldId) => ({
  id, full_name: 'owner/repo', name: 'repo', ai_summary: 'keep', custom_description: '',
  category_id: 'category', category_locked: true,
}) as Repository;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  releaseRepositoryIdentityWrites('42');
  localStorage.clear();
  fixture.journals.clear();
  fixture.home = null;
  fixture.state = {
    user: { id: 42 }, githubToken: 'fixture-only', repositories: [repo()],
    repositoryOrder: [oldId], releases: [{ id: 9, repository: { id: oldId } }],
    releaseSubscriptions: new Set([oldId]), releaseExpandedRepositories: new Set([oldId]),
    searchResults: [repo()], similarView: null,
    accountWorkspaces: { '43': { repositories: [{ id: 700, full_name: 'other/repo' }] } },
    vectorSearchConfig: {}, vectorIndexingState: { isIndexing: false },
    listsPush: { isRunning: false }, analyzingRepositoryIds: new Set(), analyzingGistIds: new Set(),
  } as unknown as AppState;
  fixture.participants = {
    account: '42', workbench: { sessions: [], projects: [], proposals: [] },
    customDiscovery: null, vectors: { storage: 'remote-vectorize', backedUp: false },
  };
  fixture.workbench.mockImplementation(async (scope, rows) => {
    const { remapWorkbench } = await vi.importActual<typeof import('./repositoryIdentityParticipants')>('./repositoryIdentityParticipants');
    return remapWorkbench(fixture.participants.workbench, scope.ownerId, rows);
  });
  fixture.restore.mockImplementation(async (_account, backup) => { fixture.participants = structuredClone(backup); });
  fixture.backup.mockImplementation(async () => structuredClone(fixture.participants));
  fixture.request.mockImplementation(async (_path, input) => input.phase === 'preview' ? { inputHash: 'preview' } : { journalId: input.journalId, restored: true });
});
afterEach(() => {
  releaseRepositoryIdentityWrites('42');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('identity migration coordinator', () => {
  it('durably records each step, skips absent Custom Discovery, and preserves Release IDs', async () => {
    await runRepositoryIdentityMigration(mappings);
    const journal = await readRepositoryIdentityJournal('42');
    expect(journal).toMatchObject({ phase: 'complete', mappings, steps: ['vectors', 'workbench', 'custom-discovery', 'app-store'] });
    expect(fixture.custom).not.toHaveBeenCalled();
    expect(fixture.state.repositories).toMatchObject([{ id: 123, ai_summary: 'keep', custom_description: '', category_locked: true }]);
    expect(fixture.state.releases).toMatchObject([{ id: 9, repository: { id: 123 } }]);
    expect(fixture.state.repositoryOrder).toEqual([123]);
    expect(() => assertRepositoryIdentityWritable()).not.toThrow();
    await runRepositoryIdentityMigration();
    expect(fixture.workbench).toHaveBeenCalledTimes(1);
  });

  it('keeps the writer gate after an interrupted participant and resumes without a new journal', async () => {
    fixture.workbench.mockRejectedValueOnce(new Error('interrupted'));
    await expect(runRepositoryIdentityMigration(mappings)).rejects.toThrow('interrupted');
    const journal = await readRepositoryIdentityJournal('42');
    expect(journal?.steps).toEqual(['vectors']);
    expect(() => assertRepositoryIdentityWritable()).toThrow('MAINTENANCE');
    await runRepositoryIdentityMigration();
    expect((await readRepositoryIdentityJournal('42'))?.id).toBe(journal?.id);
    expect((await readRepositoryIdentityJournal('42'))?.phase).toBe('complete');
  });

  it('replays the exact canonical request after a lost ACK', async () => {
    fixture.home = {
      identity: { workspaceId: 'home', githubUserId: 42 },
      db: { metadata: vi.fn(), pending: vi.fn().mockResolvedValue([]), allRecords: vi.fn().mockResolvedValue([]) },
      reloadSnapshotForIdentityMaintenance: vi.fn(),
    };
    let lost = true;
    fixture.request.mockImplementation(async (_path, input) => {
      if (input.phase === 'preview') return { inputHash: 'fixed-hash' };
      if (lost) { lost = false; throw new Error('lost ACK'); }
      return {};
    });
    await expect(runRepositoryIdentityMigration(mappings)).rejects.toThrow('lost ACK');
    await runRepositoryIdentityMigration();
    const applies = fixture.request.mock.calls.filter(([, input]) => input.phase === 'apply');
    expect(applies).toHaveLength(2);
    expect(applies[1][1]).toEqual(applies[0][1]);
    expect(fixture.request.mock.calls.filter(([, input]) => input.phase === 'preview')).toHaveLength(1);
  });

  it('refuses unconfirmed Home operations before any participant or journal write', async () => {
    fixture.home = {
      identity: { workspaceId: 'home', githubUserId: 42 },
      db: { metadata: vi.fn().mockResolvedValue({ opId: 'original-payload' }), pending: vi.fn(), allRecords: vi.fn() },
      reloadSnapshotForIdentityMaintenance: vi.fn(),
    };
    await expect(runRepositoryIdentityMigration(mappings)).rejects.toThrow('CONFIRM_PENDING');
    expect(fixture.journals.size).toBe(0);
    expect(fixture.workbench).not.toHaveBeenCalled();
  });

  it('restores only identity-bearing account fields, preserving other accounts and settings', async () => {
    await runRepositoryIdentityMigration(mappings);
    fixture.state.accountWorkspaces['43'].repositories = [{ id: 701, full_name: 'other/new' } as Repository];
    fixture.state.theme = 'dark';
    await restoreRepositoryIdentityMigration();
    expect(fixture.state.repositories[0].id).toBe(oldId);
    expect(fixture.state.accountWorkspaces['43'].repositories[0].id).toBe(701);
    expect(fixture.state.theme).toBe('dark');
    expect((await readRepositoryIdentityJournal('42'))?.phase).toBe('restored');
    expect(() => assertRepositoryIdentityWritable()).not.toThrow();
  });

  it('refuses restore after new local editing before touching canonical or participants', async () => {
    await runRepositoryIdentityMigration(mappings);
    fixture.state.repositories[0].custom_description = 'new user edit';
    await expect(restoreRepositoryIdentityMigration()).rejects.toThrow('RECOVERY_LOCAL_CHANGED');
    expect(fixture.restore).not.toHaveBeenCalled();
    expect(fixture.request).not.toHaveBeenCalled();
    expect(fixture.state.repositories[0].custom_description).toBe('new user edit');
    expect(() => assertRepositoryIdentityWritable()).toThrow('MAINTENANCE');
  });

  it('rejects new participant edits instead of replacing the owned database', async () => {
    await runRepositoryIdentityMigration(mappings);
    fixture.participants.workbench.projects.push({ id: 'new-project', ownerId: '42' } as never);
    await expect(restoreRepositoryIdentityMigration()).rejects.toThrow('RECOVERY_LOCAL_CHANGED');
    expect(fixture.restore).not.toHaveBeenCalled();
  });

  it('refuses resume after an interrupted migration when new participant edits are detected', async () => {
    fixture.workbench.mockRejectedValueOnce(new Error('interrupted'));
    await expect(runRepositoryIdentityMigration(mappings)).rejects.toThrow('interrupted');
    fixture.participants.workbench.projects.push({ id: 'new-user-edit', ownerId: '42' } as never);
    await expect(runRepositoryIdentityMigration()).rejects.toThrow('RECOVERY_LOCAL_CHANGED');
    expect(fixture.workbench).toHaveBeenCalledTimes(1);
    expect(fixture.restore).not.toHaveBeenCalled();
    expect(fixture.state.repositories[0].id).toBe(oldId);
    expect(() => assertRepositoryIdentityWritable('42')).toThrow('MAINTENANCE');
  });

  it('allows coordinated recovery from an unacknowledged Workbench write', async () => {
    fixture.participants.workbench.sessions.push({
      id: 'session', ownerId: '42', repoId: oldId, repoFullName: 'owner/repo',
    } as never);
    fixture.workbench.mockImplementationOnce(async () => {
      fixture.participants.workbench.sessions[0].repoId = 123;
      throw new Error('after commit before ACK');
    });
    await expect(runRepositoryIdentityMigration(mappings)).rejects.toThrow('before ACK');
    await restoreRepositoryIdentityMigration();
    expect(fixture.participants.workbench.sessions[0].repoId).toBe(oldId);
    expect(fixture.state.repositories[0].id).toBe(oldId);
  });

  it('refuses an unknown indexed vector generation before any business write', async () => {
    fixture.state.repositories[0].vector_indexed_at = '2026-10-01';
    await expect(runRepositoryIdentityMigration(mappings)).rejects.toThrow('VECTOR_GENERATION_UNKNOWN');
    expect(fixture.journals.size).toBe(0);
    expect(fixture.workbench).not.toHaveBeenCalled();
  });

  it('detects metadata collisions without discarding intentional empties or locks', async () => {
    fixture.state.repositories.push({ ...repo(123), custom_description: 'target edit' });
    await expect(runRepositoryIdentityMigration(mappings)).rejects.toThrow('METADATA_COLLISION');
    expect(fixture.journals.size).toBe(0);
    expect(fixture.state.repositories).toHaveLength(2);
  });

  it('safely cancels stale preparation without overwriting a concurrent participant edit or leaving a frozen account', async () => {
    let calls = 0;
    fixture.backup.mockImplementation(async () => {
      if (++calls === 2) fixture.participants.workbench.projects.push({ id: 'new-normal-edit', ownerId: '42' } as never);
      return structuredClone(fixture.participants);
    });
    await expect(runRepositoryIdentityMigration(mappings)).rejects.toThrow('IDENTITY_PREVIEW_CHANGED');
    expect(fixture.state.repositories[0].id).toBe(oldId);
    expect(fixture.participants.workbench.projects[0].id).toBe('new-normal-edit');
    expect(fixture.restore).not.toHaveBeenCalled();
    expect(fixture.workbench).not.toHaveBeenCalled();
    expect(await readRepositoryIdentityJournal('42')).toBeNull();
    expect(() => assertRepositoryIdentityWritable()).not.toThrow();
  });

  it('maps transient references but does not rewrite Release IDs or unrelated category IDs', () => {
    const patch = remapIdentityStoreSnapshot(fixture.state, mappings);
    expect(patch.releases?.[0].id).toBe(9);
    expect(patch.searchResults?.[0].id).toBe(123);
    expect(patch.repositories?.[0].category_id).toBe('category');
  });
});

describe('identity coordinator across real participant databases', () => {
  const session = (ownerId = '42'): RepositoryChatSession => ({
    id: `session-${ownerId}`, ownerId, repoId: oldId, repoFullName: 'owner/repo', title: 'Keep history',
    sourceRefSha: 'sha', kind: 'repository', createdAt: '2026-10-02', updatedAt: '2026-10-02',
  });
  const details = {
    version: 1 as const, generated_at: '2026-10-02T00:00:00Z', repository_pushed_at: null, model: 'fixture', sources: [],
    summary: 'Keep analysis', tags: [], platforms: [], software_forms: [], deployment_modes: [],
    problem: null, features: [], scenarios: [], architecture: null, quickstart: [], deployment: null, cost: null, maintenance: null,
  };

  async function seedDatabases(custom = false) {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const participants = await vi.importActual<typeof import('./repositoryIdentityParticipants')>('./repositoryIdentityParticipants');
    const { repositoryChatStorage: workbench } = await import('./repositoryChatStorage');
    const workspace = await import('../features/discovery/workspace/storage');
    const assets = await import('./repositoryAnalysisAssets');
    const customStorage = await import('../features/discovery/custom/storage');
    for (const account of ['42', '43']) {
      await workbench.saveSession(session(account));
      await workspace.saveBrowsePage(account, { key: 'reading', channelId: 'most-popular', signature: '',
        items: [repo()], mode: 'replace', nextPage: 4, hasMore: true, totalCount: 60 });
      await workspace.saveReadingAnchor(account, { sessionKey: 'reading', itemKey: `repo:${oldId}`, offset: 72,
        previousKeys: [], updatedAt: 1 });
      await assets.importRepositoryAnalysisAssets(account, { version: 1, accountId: account, assets: [{ version: 1,
        accountId: account, repositoryId: oldId, fullName: 'owner/repo', language: 'en',
        schemaVersion: 'detail-prompt-v2', configIdentity: null, details }] }, 'replace');
    }
    if (custom) await customStorage.transact('42', data => {
      data.channels = [{ id: 'custom:one', name: 'one', instruction: '', revision: 1, plan: {} as never,
        enabled: true, paused: false, ai: false, limit: 10, hour: 8, cursors: [], blocked: [oldId],
        read: [oldId], recommended: { [oldId]: '2026-10-02' } }];
    });
    fixture.backup.mockImplementation(participants.backupParticipantIdentities);
    fixture.restore.mockImplementation(participants.restoreParticipantIdentities);
    fixture.workbench.mockImplementation(participants.migrateWorkbenchRepositoryIdentities);
    fixture.custom.mockImplementation(participants.migrateCustomDiscoveryRepositoryIdentities);
    return { participants, workbench, workspace, assets, customStorage };
  }

  async function expectIdentities(databases: Awaited<ReturnType<typeof seedDatabases>>, id: number) {
    expect((await databases.workbench.getSession('session-42'))?.repoId).toBe(id);
    const workspace = await databases.workspace.exportDiscoveryWorkspace('42');
    expect(workspace.sessions[0]).toMatchObject({ itemKeys: [`repo:${id}`], nextPage: 4 });
    expect(workspace.anchors[0]).toMatchObject({ itemKey: `repo:${id}`, offset: 72 });
    expect(workspace.projects[0].value.id).toBe(id);
    expect((await databases.assets.exportRepositoryAnalysisAssets('42')).assets[0]).toMatchObject({ repositoryId: id, details });
  }

  const interruptions = ['workbench', 'workspace', 'analyses', 'custom'] as const;
  async function interruptAfter(phase: typeof interruptions[number], databases: Awaited<ReturnType<typeof seedDatabases>>) {
    if (phase === 'workbench') vi.spyOn(databases.workspace, 'migrateDiscoveryWorkspaceIdentities').mockRejectedValueOnce(new Error('after workbench commit'));
    if (phase === 'workspace') vi.spyOn(databases.assets, 'migrateRepositoryAnalysisAssetIdentities').mockRejectedValueOnce(new Error('after workspace commit'));
    if (phase === 'analyses') fixture.workbench.mockImplementationOnce(async (...args: Parameters<typeof databases.participants.migrateWorkbenchRepositoryIdentities>) => {
      await databases.participants.migrateWorkbenchRepositoryIdentities(...args);
      throw new Error('after analyses commit before ACK');
    });
    if (phase === 'custom') fixture.custom.mockImplementationOnce(async (...args: Parameters<typeof databases.participants.migrateCustomDiscoveryRepositoryIdentities>) => {
      await databases.participants.migrateCustomDiscoveryRepositoryIdentities(...args);
      throw new Error('after custom commit before ACK');
    });
    await expect(runRepositoryIdentityMigration(mappings)).rejects.toThrow(`after ${phase} commit`);
    const journal = await readRepositoryIdentityJournal('42');
    expect(journal?.phase).toBe('applying');
    expect(journal?.steps).not.toContain(phase === 'custom' ? 'custom-discovery' : 'workbench');
    expect(() => assertRepositoryIdentityWritable('42')).toThrow('MAINTENANCE');
    return journal!;
  }

  it.each(interruptions)('rolls back all owned stores after the %s transaction commits without ACK', async phase => {
    const databases = await seedDatabases(phase === 'custom');
    const before = await databases.participants.backupParticipantIdentities('42');
    const foreign = await databases.participants.backupParticipantIdentities('43');
    const journal = await interruptAfter(phase, databases);
    expect(journal.recoveryFingerprints!.participants.length).toBeGreaterThan(4);
    await restoreRepositoryIdentityMigration();
    await expectIdentities(databases, oldId);
    expect(await databases.participants.backupParticipantIdentities('42')).toEqual(before);
    expect(await databases.participants.backupParticipantIdentities('43')).toEqual(foreign);
    expect(fixture.state.repositories[0].id).toBe(oldId);
    expect((await readRepositoryIdentityJournal('42'))?.phase).toBe('restored');
    expect(() => assertRepositoryIdentityWritable('42')).not.toThrow();
  });

  it.each(interruptions)('resumes after the %s transaction without changing the durable journal', async phase => {
    const databases = await seedDatabases(phase === 'custom');
    const foreign = await databases.participants.backupParticipantIdentities('43');
    const original = await interruptAfter(phase, databases);
    await runRepositoryIdentityMigration();
    await expectIdentities(databases, 123);
    expect(await databases.participants.backupParticipantIdentities('43')).toEqual(foreign);
    expect(await readRepositoryIdentityJournal('42')).toMatchObject({ id: original.id, phase: 'complete' });
    expect(fixture.state.repositories[0].id).toBe(123);
    expect(() => assertRepositoryIdentityWritable('42')).not.toThrow();
  });

  it.each(['workbench', 'workspace'] as const)('retries recovery after restoring %s before the next database fails', async phase => {
    const databases = await seedDatabases();
    const before = await databases.participants.backupParticipantIdentities('42');
    await runRepositoryIdentityMigration(mappings);
    const original = await readRepositoryIdentityJournal('42');
    if (phase === 'workbench') vi.spyOn(databases.workspace, 'importDiscoveryWorkspace').mockRejectedValueOnce(new Error('rollback interrupted'));
    else vi.spyOn(databases.assets, 'importRepositoryAnalysisAssets').mockRejectedValueOnce(new Error('rollback interrupted'));
    await expect(restoreRepositoryIdentityMigration()).rejects.toThrow('rollback interrupted');
    expect((await readRepositoryIdentityJournal('42'))?.phase).toBe('restoring');
    expect(() => assertRepositoryIdentityWritable('42')).toThrow('MAINTENANCE');
    expect((await databases.workbench.getSession('session-42'))?.repoId).toBe(oldId);
    await expect(runRepositoryIdentityMigration()).rejects.toThrow('CONTINUE_RECOVERY');
    await restoreRepositoryIdentityMigration();
    expect(await databases.participants.backupParticipantIdentities('42')).toEqual(before);
    expect(await readRepositoryIdentityJournal('42')).toMatchObject({ id: original!.id, phase: 'restored' });
    expect(() => assertRepositoryIdentityWritable('42')).not.toThrow();
  });

  it('refuses recovery when an owned analysis changes after a partial commit', async () => {
    const databases = await seedDatabases();
    await interruptAfter('workspace', databases);
    const changed = await databases.assets.exportRepositoryAnalysisAssets('42');
    changed.assets[0].details.summary = 'Unexpected user edit';
    await databases.assets.importRepositoryAnalysisAssets('42', changed, 'replace', true);
    await expect(restoreRepositoryIdentityMigration()).rejects.toThrow('RECOVERY_LOCAL_CHANGED');
    expect(fixture.restore).not.toHaveBeenCalled();
    expect((await databases.workbench.getSession('session-42'))?.repoId).toBe(123);
    expect((await databases.assets.exportRepositoryAnalysisAssets('42')).assets[0].details.summary).toBe('Unexpected user edit');
  });

  it('recovers an old journal without clearing discovery stores absent from its backup', async () => {
    const databases = await seedDatabases();
    fixture.backup.mockImplementation(async account => {
      const backup = await databases.participants.backupParticipantIdentities(account);
      delete backup.workbench.discoveryWorkspace;
      return backup;
    });
    await runRepositoryIdentityMigration(mappings);
    const saved = await readRepositoryIdentityJournal('42');
    expect(saved!.backup.participants.workbench).not.toHaveProperty('discoveryWorkspace');
    fixture.backup.mockImplementation(databases.participants.backupParticipantIdentities);
    const local = await databases.participants.backupParticipantIdentities('42');
    await restoreRepositoryIdentityMigration();
    expect((await databases.workbench.getSession('session-42'))?.repoId).toBe(oldId);
    expect((await databases.participants.backupParticipantIdentities('42')).workbench.discoveryWorkspace).toEqual(local.workbench.discoveryWorkspace);
    expect((await readRepositoryIdentityJournal('42'))?.phase).toBe('restored');
  });

  it.each(['resume', 'restore'] as const)('expands older checkpoint fingerprints from the durable backup for %s', async action => {
    const databases = await seedDatabases();
    const journal = await interruptAfter('workspace', databases);
    // Prior coordinators retained only initial and fully migrated Workbench checkpoints.
    journal.recoveryFingerprints!.participants = [journal.recoveryFingerprints!.participants[0]];
    fixture.journals.set('gsm-identity-journal:42', JSON.stringify(journal));
    if (action === 'resume') await runRepositoryIdentityMigration();
    else await restoreRepositoryIdentityMigration();
    await expectIdentities(databases, action === 'resume' ? 123 : oldId);
    expect((await readRepositoryIdentityJournal('42'))?.recoveryFingerprints?.participants.length).toBeGreaterThan(4);
    expect(() => assertRepositoryIdentityWritable('42')).not.toThrow();
  });
});
