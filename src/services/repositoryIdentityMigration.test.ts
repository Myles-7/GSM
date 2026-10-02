import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState, Repository } from '../types';
import type { RepositoryIdentityParticipantBackup } from './repositoryIdentityParticipants';
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
