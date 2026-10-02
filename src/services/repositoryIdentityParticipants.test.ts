import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import type { WorkbenchProject, WorkbenchProposal } from '../types/aiWorkbench';
import type { RepositoryChatSession } from '../types/repositoryChat';
type Participants = typeof import('./repositoryIdentityParticipants');
const migrateWorkbenchRepositoryIdentities = async (...args: Parameters<Participants['migrateWorkbenchRepositoryIdentities']>) =>
  (await import('./repositoryIdentityParticipants')).migrateWorkbenchRepositoryIdentities(...args);
const migrateCustomDiscoveryRepositoryIdentities = async (...args: Parameters<Participants['migrateCustomDiscoveryRepositoryIdentities']>) =>
  (await import('./repositoryIdentityParticipants')).migrateCustomDiscoveryRepositoryIdentities(...args);
const migrateVectorRepositoryIdentities = async (...args: Parameters<Participants['migrateVectorRepositoryIdentities']>) =>
  (await import('./repositoryIdentityParticipants')).migrateVectorRepositoryIdentities(...args);

const oldId = 1700000000000;
const newId = 42;
const mappings = [{ oldId, newId, fullName: 'owner/repo', evidence: 'Confirmed canonical metadata' }];
const fallbackKey = 'gsm-repository-chat-fallback-v1';
const repository = (id = oldId, full_name = 'owner/repo') => ({
  id, full_name, name: 'repo', stargazers_count: oldId,
} as Repository);
const session = (ownerId = 'alice'): RepositoryChatSession => ({
  id: `session-${ownerId}`, ownerId, repoId: oldId, repoFullName: 'owner/repo',
  title: String(oldId), sourceRefSha: 'sha', kind: 'workbench',
  createdAt: '2026-09-01', updatedAt: '2026-09-01',
  workbench: {
    scope: 'selected', depth: 'standard', selectedRepositories: [repository()],
    searchBatches: [{
      id: 'historical-search', createdAt: '2026-09-01', requirements: {
        purpose: '', required: [], preferred: [], excluded: [], questions: [], queries: [],
      },
      candidates: [{ repository: repository(), summary: 'historical', reasons: [], limitations: [], sources: [], status: 'verified' }],
      queries: [], nextPage: 1,
    }],
  },
});
const project = (): WorkbenchProject => ({
  id: 'project', ownerId: 'alice', name: 'project', instructions: '', conclusions: String(oldId),
  repositories: [repository()], createdAt: '2026-09-01', updatedAt: '2026-09-01',
});
const proposal = (): WorkbenchProposal => ({
  id: 'proposal', ownerId: 'alice', sessionId: 'session-alice', createdAt: '2026-09-01', updatedAt: '2026-09-01',
  operations: ['proposed', 'success'].map((status, index) => ({
    id: `op-${index}`, repository: repository(), kind: 'update', reason: String(oldId),
    before: {}, after: {}, selected: true, overrideLocked: false,
    status: status as 'proposed' | 'success',
  })),
  organization: {
    version: 1, revision: 7, scope: { name: 'scope', repositoryIds: [oldId] },
    instruction: '', configId: 'model', maxNewSubcategories: 0, structureReady: true,
    categories: [], entries: [{
      repositoryId: oldId, before: { categoryId: null, subcategoryId: null, locked: false },
      categoryId: null, subcategoryId: null, reason: String(oldId), disposition: 'move',
      selected: true, overrideLocked: false, manual: false, status: 'pending',
    }],
    batches: [{ repositoryIds: [oldId], status: 'pending' }],
    status: 'ready', createdCategoryIds: [],
  },
});

async function seedWorkbench() {
  const { repositoryChatStorage: storage } = await import('./repositoryChatStorage');
  await storage.saveSession(session());
  await storage.saveSession(session('bob'));
  await storage.saveProject(project());
  await storage.saveProposal(proposal());
  await storage.saveMessage({
    id: 'message', sessionId: 'session-alice', role: 'assistant', content: String(oldId),
    status: 'complete', evidenceIds: ['evidence'], createdAt: '2026-09-01',
  });
  await storage.saveEvidence({
    id: 'evidence', source: 'github', repoFullName: 'owner/repo', url: 'https://github.com/owner/repo',
    excerpt: String(oldId), retrievedAt: '2026-09-01',
  });
  await storage.saveToolEvent({
    id: 'tool', sessionId: 'session-alice', messageId: 'message', toolName: 'read_repo_readme',
    status: 'success', paramSummary: String(oldId), evidenceId: 'evidence', createdAt: '2026-09-01',
  });
  return storage;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe.each(['indexeddb', 'fallback'] as const)('Workbench participant (%s)', mode => {
  beforeEach(() => { if (mode === 'fallback') vi.stubGlobal('indexedDB', undefined); });

  it('repairs owned mutable references atomically and preserves historical data', async () => {
    const storage = await seedWorkbench();
    const history = {
      messages: await storage.listMessages('session-alice'),
      tools: await storage.listToolEvents('session-alice'),
      evidence: await storage.listEvidence(['evidence']),
    };
    const foreign = await storage.getSession('session-bob');
    await expect(migrateWorkbenchRepositoryIdentities({ ownerId: 'alice' }, mappings)).resolves.toEqual({ changed: 3 });
    const migrated = await storage.getSession('session-alice');
    expect(migrated).toMatchObject({
      repoId: newId, title: String(oldId), updatedAt: '2026-09-01',
      workbench: { selectedRepositories: [{ id: newId, stargazers_count: oldId }],
        searchBatches: [{ candidates: [{ repository: { id: oldId } }] }] },
    });
    expect(await storage.getSession('session-bob')).toEqual(foreign);
    expect(await storage.listProjects('alice')).toMatchObject([{ repositories: [{ id: newId }] }]);
    expect(await storage.getProposal('proposal')).toMatchObject({
      operations: [{ repository: { id: newId } }, { repository: { id: oldId } }],
      organization: { revision: 7, scope: { repositoryIds: [newId] },
        entries: [{ repositoryId: newId, reason: String(oldId) }], batches: [{ repositoryIds: [newId] }] },
    });
    expect(await storage.listMessages('session-alice')).toEqual(history.messages);
    expect(await storage.listToolEvents('session-alice')).toEqual(history.tools);
    expect(await storage.listEvidence(['evidence'])).toEqual(history.evidence);
    vi.resetModules();
    const persist = vi.spyOn(window.localStorage, 'setItem');
    await expect(migrateWorkbenchRepositoryIdentities({ ownerId: 'alice' }, mappings)).resolves.toEqual({ changed: 0 });
    expect(persist).not.toHaveBeenCalled();
  });

  it('rejects a collision without committing earlier session repairs', async () => {
    const storage = await seedWorkbench();
    await storage.saveProject({ ...project(), repositories: [repository(), repository(newId, 'different/repo')] });
    await expect(migrateWorkbenchRepositoryIdentities({ ownerId: 'alice' }, mappings)).rejects.toThrow(/collision|identity/i);
    expect((await storage.getSession('session-alice'))?.repoId).toBe(oldId);
  });

  it('rejects wrong account, conflicting names and running mutable operations', async () => {
    const storage = await seedWorkbench();
    await expect(migrateWorkbenchRepositoryIdentities({ ownerId: 'charlie' }, mappings)).resolves.toEqual({ changed: 0 });
    expect((await storage.getSession('session-alice'))?.repoId).toBe(oldId);
    await storage.saveSession({ ...session(), repoFullName: 'other/repo' });
    await expect(migrateWorkbenchRepositoryIdentities({ ownerId: 'alice' }, mappings)).rejects.toThrow(/identity/i);
    await storage.saveSession(session());
    const running = proposal();
    running.operations[0].status = 'running';
    await storage.saveProposal(running);
    await expect(migrateWorkbenchRepositoryIdentities({ ownerId: 'alice' }, mappings)).rejects.toThrow(/running|pause/i);
    expect((await storage.getSession('session-alice'))?.repoId).toBe(oldId);
  });

  it('treats an empty account as a no-op but rejects mapped unowned legacy records', async () => {
    await expect(migrateWorkbenchRepositoryIdentities({ ownerId: 'empty' }, mappings)).resolves.toEqual({ changed: 0 });
    const storage = await seedWorkbench();
    await storage.saveSession({ ...session(), id: 'legacy', ownerId: undefined });
    await expect(migrateWorkbenchRepositoryIdentities({ ownerId: 'alice' }, mappings)).rejects.toThrow(/UNOWNED/);
    expect((await storage.getSession('session-alice'))?.repoId).toBe(oldId);
  });

  it('permits only identity mutation during maintenance and restores a durable account snapshot', async () => {
    const storage = await seedWorkbench();
    const { transact, loadData } = await import('../features/discovery/custom/storage');
    const originalCustom = await customData();
    await transact('alice', data => Object.assign(data, originalCustom));
    const { backupParticipantIdentities, restoreParticipantIdentities } = await import('./repositoryIdentityParticipants');
    const { holdRepositoryIdentityWrites, releaseRepositoryIdentityWrites } = await import('./repositoryIdentityGate');
    const backup = JSON.parse(JSON.stringify(await backupParticipantIdentities('alice')));
    const foreign = await storage.getSession('session-bob');
    holdRepositoryIdentityWrites('alice', 'journal');
    try {
      await expect(storage.saveSession({ ...session(), title: 'blocked' })).rejects.toThrow(/MAINTENANCE/);
      await expect(transact('alice', data => { data.channels = []; })).rejects.toThrow(/MAINTENANCE/);
      await migrateWorkbenchRepositoryIdentities({ ownerId: 'alice' }, mappings);
      await migrateCustomDiscoveryRepositoryIdentities('alice', mappings);
      await expect(restoreParticipantIdentities('bob', backup)).rejects.toThrow(/ACCOUNT/);
      await restoreParticipantIdentities('alice', backup);
      expect(await storage.getSession('session-alice')).toEqual(session());
      expect(await storage.getProposal('proposal')).toEqual(proposal());
      expect(await storage.listProjects('alice')).toEqual([project()]);
      expect(await storage.getSession('session-bob')).toEqual(foreign);
      expect(await loadData('alice')).toEqual(backup.customDiscovery);
      await restoreParticipantIdentities('alice', backup);
      await expect(storage.saveProject(project())).rejects.toThrow(/MAINTENANCE/);
    } finally { releaseRepositoryIdentityWrites('alice'); }
  });
});

it('refuses corrupted Workbench fallback rather than replacing it with an empty snapshot', async () => {
  vi.stubGlobal('indexedDB', undefined);
  localStorage.setItem(fallbackKey, '{broken');
  await expect(migrateWorkbenchRepositoryIdentities({ ownerId: 'alice' }, mappings)).rejects.toThrow();
  expect(localStorage.getItem(fallbackKey)).toBe('{broken');
});

const customData = async () => {
  const { emptyData } = await import('../features/discovery/custom/model');
  const data = emptyData();
  data.channels.push({
    id: 'custom:one', name: 'one', instruction: 'history', revision: 3, plan: {} as never,
    enabled: true, paused: false, ai: false, limit: 10, hour: 8,
    cursors: [oldId], blocked: [oldId], read: [oldId], recommended: { [oldId]: '2026-09-01' },
  });
  data.editions.push({
    channelId: 'custom:one', date: '2026-09-01', revision: 3, instruction: 'original',
    entries: [{ repo: repository(), verdict: 'match', reason: String(oldId), evidence: [String(oldId)], method: 'ai', relevance: 1, preference: 0 }],
    pending: [], errors: [String(oldId)], complete: true, searched: oldId, filtered: 0, generatedAt: '2026-09-01',
  });
  data.cache[String(oldId)] = { text: String(oldId), fetchedAt: 9, pushedAt: 'sha' };
  data.analyses = { [JSON.stringify([oldId, 'sha', 'en', 'detail-prompt-v2', 'config'])]: {
    status: 'done', channelId: 'custom:one', revision: 3, updatedAt: 9,
  } };
  return data;
};

describe.each(['indexeddb', 'fallback'] as const)('Custom participant (%s)', mode => {
  beforeEach(() => { if (mode === 'fallback') vi.stubGlobal('indexedDB', undefined); });

  it('rekeys only the selected account and preserves edition evidence and revisions', async () => {
    const { transact, loadData } = await import('../features/discovery/custom/storage');
    const data = await customData();
    await transact('alice', stored => Object.assign(stored, data));
    await transact('bob', stored => Object.assign(stored, data));
    const foreign = await loadData('bob');
    await expect(migrateCustomDiscoveryRepositoryIdentities('alice', mappings)).resolves.toMatchObject({ changed: expect.any(Number) });
    const result = await loadData('alice');
    expect(result.channels[0]).toMatchObject({
      revision: 3, cursors: [oldId], blocked: [newId], read: [newId], recommended: { [newId]: '2026-09-01' },
    });
    expect(result.editions[0]).toMatchObject({
      revision: 3, entries: [{ repo: { id: newId, stargazers_count: oldId }, reason: String(oldId), evidence: [String(oldId)] }],
      searched: oldId, errors: [String(oldId)],
    });
    expect(result.cache).toEqual({ [newId]: data.cache[String(oldId)] });
    expect(Object.keys(result.analyses!)).toEqual([JSON.stringify([newId, 'sha', 'en', 'detail-prompt-v2', 'config'])]);
    expect(await loadData('bob')).toEqual(foreign);
    vi.resetModules();
    const write = vi.spyOn(window.localStorage, 'setItem');
    await expect(migrateCustomDiscoveryRepositoryIdentities('alice', mappings)).resolves.toEqual({ changed: 0 });
    expect(write).not.toHaveBeenCalled();
  });

  it('rolls back collisions and does not create a missing account snapshot', async () => {
    const { transact, loadData } = await import('../features/discovery/custom/storage');
    const data = await customData();
    data.cache[String(newId)] = { text: 'different', fetchedAt: 1, pushedAt: 'sha' };
    await transact('alice', stored => Object.assign(stored, data));
    await expect(migrateCustomDiscoveryRepositoryIdentities('alice', mappings)).rejects.toThrow(/collision/i);
    expect((await loadData('alice')).channels[0].read).toEqual([oldId]);
    await expect(migrateCustomDiscoveryRepositoryIdentities('missing', mappings)).rejects.toThrow(/account/i);
  });

  it('rejects a running producer and corrupted analysis keys without committing channel repairs', async () => {
    const { transact, loadData } = await import('../features/discovery/custom/storage');
    const data = await customData();
    data.lease = { owner: 'producer', expires: Date.now() + 60000 };
    await transact('alice', stored => Object.assign(stored, data));
    await expect(migrateCustomDiscoveryRepositoryIdentities('alice', mappings)).rejects.toThrow(/RUNNING/);
    await transact('alice', stored => { delete stored.lease; stored.analyses = { broken: { status: 'done', channelId: 'custom:one', revision: 1, updatedAt: 0 } }; });
    await expect(migrateCustomDiscoveryRepositoryIdentities('alice', mappings)).rejects.toThrow();
    expect((await loadData('alice')).channels[0].read).toEqual([oldId]);
  });
});

it('rejects ambiguous mappings before any storage work', async () => {
  const open = vi.spyOn(indexedDB, 'open');
  for (const input of [
    [...mappings, { ...mappings[0], newId: 43 }],
    [...mappings, { ...mappings[0], oldId: oldId + 1 }],
    [{ ...mappings[0], evidence: '' }],
    [{ ...mappings[0], newId: NaN }],
    [...mappings, { oldId: newId, newId: 43, fullName: 'other/repo', evidence: 'confirmed' }],
  ]) {
    await expect(migrateWorkbenchRepositoryIdentities({ ownerId: 'alice' }, input)).rejects.toThrow();
  }
  expect(open).not.toHaveBeenCalled();
});

it('does not write, open databases or notify on empty mappings', async () => {
  const open = vi.spyOn(indexedDB, 'open');
  const write = vi.spyOn(window.localStorage, 'setItem');
  const event = vi.spyOn(window, 'dispatchEvent');
  await expect(migrateWorkbenchRepositoryIdentities({ ownerId: 'alice' }, [])).resolves.toEqual({ changed: 0 });
  await expect(migrateCustomDiscoveryRepositoryIdentities('alice', [])).resolves.toEqual({ changed: 0 });
  await expect(migrateVectorRepositoryIdentities('generation', [])).resolves.toEqual({ changed: 0 });
  expect(open).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(event).not.toHaveBeenCalled();
});

it('provides a runtime candidate transform without modifying historical assessment evidence', async () => {
  const { remapCustomDiscoveryCandidates } = await import('../features/discovery/custom/model');
  const data = await customData();
  const candidates = { 'custom:one': { date: '2026-09-01', revision: 3, items: data.editions[0].entries } };
  const result = remapCustomDiscoveryCandidates(candidates, mappings);
  expect(result['custom:one'].items[0]).toMatchObject({ repo: { id: newId }, evidence: [String(oldId)] });
  expect(candidates['custom:one'].items[0].repo.id).toBe(oldId);
  expect(remapCustomDiscoveryCandidates(result, mappings)).toBe(result);
});

it('fails closed for remote vectors without issuing network or AI calls', async () => {
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  await expect(migrateVectorRepositoryIdentities('generation', mappings)).rejects.toThrow(/remote|Vectorize/i);
  expect(network).not.toHaveBeenCalled();
});

it('rekeys supplied vector snapshots, retaining embeddings and marking identity metadata stale', async () => {
  const { remapVectorRepositoryIdentityRecords } = await import('./vectorRepositoryIdentityStorage');
  const vector = {
    id: String(oldId), namespace: 'generation', values: [0.1, 0.2],
    metadata: { full_name: 'owner/repo', content_hash: 'original', identity_hash: 'embedding-identity',
      description: '', language: '', stars: oldId, tags: [] },
  };
  const result = remapVectorRepositoryIdentityRecords('generation', [vector], mappings);
  expect(result[0]).toMatchObject({
    id: String(newId), namespace: 'generation', metadata: {
      content_hash: 'original', identity_hash: 'embedding-identity', repository_identity_stale: true, stars: oldId,
    },
  });
  expect(result[0].values).toBe(vector.values);
  expect(remapVectorRepositoryIdentityRecords('generation', result, mappings)).toBe(result);
  expect(() => remapVectorRepositoryIdentityRecords('different', [vector], mappings)).toThrow(/namespace/i);
  expect(() => remapVectorRepositoryIdentityRecords('generation', [vector, { ...vector, id: String(newId) }], mappings)).toThrow(/collision/i);
  const scoped = { ...vector, id: `generation:${oldId}` };
  expect(remapVectorRepositoryIdentityRecords('generation', [scoped], mappings)[0].id).toBe(`generation:${newId}`);
});
