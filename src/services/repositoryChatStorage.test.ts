import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { repositoryChatStorage } from './repositoryChatStorage';
import type { RepositoryChatMessage, RepositoryChatSession, RepositoryChatToolEvent, ToolEvidence } from '../types/repositoryChat';
import type { Repository } from '../types';
import type { WorkbenchProject, WorkbenchProposal } from '../types/aiWorkbench';

const createSession = (id: string, repoId: number, updatedAt: string): RepositoryChatSession => ({
  id,
  repoId,
  repoFullName: `owner/repository-${repoId}`,
  sourceRefSha: 'abcdef1234567890',
  title: id,
  createdAt: updatedAt,
  updatedAt,
});

const createMessage = (id: string, sessionId: string, evidenceIds: string[] = []): RepositoryChatMessage => ({
  id,
  sessionId,
  role: 'assistant',
  content: 'Answer',
  status: 'complete',
  evidenceIds,
  createdAt: '2026-08-26T00:00:00.000Z',
});

const createToolEvent = (sessionId: string, evidenceId?: string): RepositoryChatToolEvent => ({
  id: `tool-${sessionId}`,
  sessionId,
  messageId: `message-${sessionId}`,
  toolName: 'read_repo_readme',
  status: 'success',
  paramSummary: 'README.md',
  ...(evidenceId ? { evidenceId } : {}),
  createdAt: '2026-08-26T00:00:00.000Z',
});

const createEvidence = (id: string): ToolEvidence => ({
  id,
  source: 'github',
  repoFullName: 'owner/repository-1',
  refSha: 'abcdef1234567890',
  path: 'README.md',
  lineStart: 1,
  lineEnd: 2,
  url: 'https://github.com/owner/repository-1/blob/abcdef1234567890/README.md#L1-L2',
  excerpt: 'README',
  retrievedAt: '2026-08-26T00:00:00.000Z',
});

const createRepository = (id = 1): Repository => ({
  id,
  name: `repository-${id}`,
  full_name: `owner/repository-${id}`,
  description: null,
  html_url: `https://github.com/owner/repository-${id}`,
  stargazers_count: 10,
  forks_count: 2,
  forks: 2,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-08-26T00:00:00.000Z',
  pushed_at: '2026-08-26T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: ['test'],
});

const createProject = (id: string, ownerId: string): WorkbenchProject => ({
  id,
  ownerId,
  name: id,
  instructions: '',
  conclusions: '',
  repositories: [createRepository()],
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
});

const createProposal = (
  id: string,
  ownerId: string,
  sessionId: string,
  status: WorkbenchProposal['operations'][number]['status'] = 'proposed',
): WorkbenchProposal => ({
  id,
  ownerId,
  sessionId,
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
  operations: [{
    id: `operation-${id}`,
    repository: createRepository(),
    kind: 'update',
    reason: 'test proposal',
    before: {},
    after: { custom_description: 'updated' },
    selected: true,
    overrideLocked: false,
    status,
  }],
});

describe('repositoryChatStorage local fallback', () => {
  const originalIndexedDb = Object.getOwnPropertyDescriptor(window, 'indexedDB');
  const originalLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');

  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalIndexedDb) Object.defineProperty(window, 'indexedDB', originalIndexedDb);
    else delete (window as { indexedDB?: IDBFactory }).indexedDB;
    if (originalLocalStorage) Object.defineProperty(window, 'localStorage', originalLocalStorage);
  });

  it('filters, orders, and soft-deletes sessions strictly within the selected repository', async () => {
    await repositoryChatStorage.saveSession(createSession('older', 1, '2026-08-24T00:00:00.000Z'));
    await repositoryChatStorage.saveSession(createSession('other-repository', 2, '2026-08-26T00:00:00.000Z'));
    await repositoryChatStorage.saveSession(createSession('newer', 1, '2026-08-25T00:00:00.000Z'));

    await expect(repositoryChatStorage.listSessionsByRepository(1)).resolves.toMatchObject([
      { id: 'newer', repoId: 1 },
      { id: 'older', repoId: 1 },
    ]);

    await repositoryChatStorage.softDeleteSession('newer');
    await expect(repositoryChatStorage.listSessionsByRepository(1)).resolves.toMatchObject([
      { id: 'older', repoId: 1 },
    ]);
    await expect(repositoryChatStorage.listSessionsByRepository(2)).resolves.toMatchObject([
      { id: 'other-repository', repoId: 2 },
    ]);
  });

  it('moves expired legacy repository sessions to trash without assigning an owner', async () => {
    await repositoryChatStorage.saveSession(createSession('expired', 1, '2026-01-01T00:00:00.000Z'));
    await repositoryChatStorage.saveSession(createSession('current', 1, new Date().toISOString()));

    await repositoryChatStorage.purgeExpiredSessions(1, 1);

    const expired = await repositoryChatStorage.getSession('expired');
    expect(expired).toMatchObject({ id: 'expired', deletedAt: expect.any(String) });
    expect(expired?.ownerId).toBeUndefined();
    await expect(repositoryChatStorage.getSession('current')).resolves.toMatchObject({ id: 'current' });
  });

  it('physically deletes all messages, tool events, and evidence connected to the deleted session', async () => {
    const session = createSession('session-1', 1, '2026-08-26T00:00:00.000Z');
    const messageEvidence = createEvidence('message-evidence');
    const toolEvidence = createEvidence('tool-evidence');
    await repositoryChatStorage.saveSession(session);
    await repositoryChatStorage.saveMessage(createMessage('message-1', session.id, [messageEvidence.id]));
    await repositoryChatStorage.saveToolEvent(createToolEvent(session.id, toolEvidence.id));
    await repositoryChatStorage.saveEvidence(messageEvidence);
    await repositoryChatStorage.saveEvidence(toolEvidence);

    await repositoryChatStorage.permanentlyDeleteSession(session.id);

    await expect(repositoryChatStorage.getSession(session.id)).resolves.toBeNull();
    await expect(repositoryChatStorage.listMessages(session.id)).resolves.toEqual([]);
    await expect(repositoryChatStorage.listToolEvents(session.id)).resolves.toEqual([]);
    await expect(repositoryChatStorage.listEvidence([messageEvidence.id, toolEvidence.id])).resolves.toEqual([]);
  });

  it('lists recent sessions across repositories in recency order with a limit', async () => {
    await repositoryChatStorage.saveSession(createSession('repo1-older', 1, '2026-08-24T00:00:00.000Z'));
    await repositoryChatStorage.saveSession(createSession('repo2-newer', 2, '2026-08-26T00:00:00.000Z'));
    await repositoryChatStorage.saveSession(createSession('repo1-middle', 1, '2026-08-25T00:00:00.000Z'));

    await expect(repositoryChatStorage.listRecentSessions(2)).resolves.toMatchObject([
      { id: 'repo2-newer', repoId: 2 },
      { id: 'repo1-middle', repoId: 1 },
    ]);
    await expect(repositoryChatStorage.listRecentSessions()).resolves.toMatchObject([
      { id: 'repo2-newer', repoId: 2 },
      { id: 'repo1-middle', repoId: 1 },
      { id: 'repo1-older', repoId: 1 },
    ]);

    await repositoryChatStorage.softDeleteSession('repo2-newer');
    await expect(repositoryChatStorage.listRecentSessions()).resolves.toMatchObject([
      { id: 'repo1-middle', repoId: 1 },
      { id: 'repo1-older', repoId: 1 },
    ]);
  });

  it('scopes workbench session modes by owner and only claims unowned legacy sessions', async () => {
    const ownerId = 'owner-a';
    await repositoryChatStorage.saveSession(createSession('legacy', 1, '2026-08-20T00:00:00.000Z'));
    await repositoryChatStorage.saveSession({
      ...createSession('active', 1, '2026-08-26T00:00:00.000Z'),
      ownerId,
      kind: 'workbench',
    });
    await repositoryChatStorage.saveSession({
      ...createSession('archived', 1, '2026-08-25T00:00:00.000Z'),
      ownerId,
      kind: 'workbench',
      archived: true,
    });
    await repositoryChatStorage.saveSession({
      ...createSession('trash', 1, '2026-08-24T00:00:00.000Z'),
      ownerId,
      kind: 'workbench',
      deletedAt: '2026-08-24T12:00:00.000Z',
    });
    await repositoryChatStorage.saveSession({
      ...createSession('foreign', 1, '2026-08-27T00:00:00.000Z'),
      ownerId: 'owner-b',
      kind: 'workbench',
    });

    await expect(repositoryChatStorage.listWorkbenchSessions(ownerId, 'active')).resolves.toMatchObject([{ id: 'active' }]);
    await expect(repositoryChatStorage.listWorkbenchSessions(ownerId, 'archived')).resolves.toMatchObject([{ id: 'archived' }]);
    await expect(repositoryChatStorage.listWorkbenchSessions(ownerId, 'trash')).resolves.toMatchObject([{ id: 'trash' }]);
    await expect(repositoryChatStorage.listWorkbenchSessions(ownerId, 'legacy')).resolves.toMatchObject([{ id: 'legacy' }]);

    await expect(repositoryChatStorage.claimSession('legacy', ownerId)).resolves.toMatchObject({ id: 'legacy', ownerId });
    await expect(repositoryChatStorage.claimSession('legacy', 'owner-b')).resolves.toBeNull();
    await expect(repositoryChatStorage.listWorkbenchSessions(ownerId, 'legacy')).resolves.toEqual([]);
    await expect(repositoryChatStorage.listWorkbenchSessions(ownerId, 'active')).resolves.toMatchObject([
      { id: 'active' },
      { id: 'legacy' },
    ]);
  });

  it('stores projects and proposals per owner and filters proposals by session', async () => {
    const ownerId = 'owner-a';
    await repositoryChatStorage.saveProject(createProject('project-a', ownerId));
    await repositoryChatStorage.saveProject(createProject('project-b', 'owner-b'));
    await repositoryChatStorage.saveProposal(createProposal('proposal-a1', ownerId, 'session-a'));
    await repositoryChatStorage.saveProposal(createProposal('proposal-a2', ownerId, 'session-b'));
    await repositoryChatStorage.saveProposal(createProposal('proposal-b', 'owner-b', 'session-a'));

    await expect(repositoryChatStorage.listProjects(ownerId)).resolves.toMatchObject([{ id: 'project-a', ownerId }]);
    await expect(repositoryChatStorage.getProposal('proposal-a1')).resolves.toMatchObject({ id: 'proposal-a1', ownerId });
    await expect(repositoryChatStorage.listProposals(ownerId, 'session-a')).resolves.toMatchObject([
      { id: 'proposal-a1', sessionId: 'session-a' },
    ]);
    await expect(repositoryChatStorage.listProposals(ownerId)).resolves.toHaveLength(2);
  });

  it('cleans up ordinary expired sessions while retaining protected and operation records', async () => {
    const ownerId = 'owner-a';
    const old = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const oldTrash = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const owned = (id: string): RepositoryChatSession => ({ ...createSession(id, 1, old), ownerId, kind: 'workbench' });
    await repositoryChatStorage.saveSession(owned('ordinary'));
    await repositoryChatStorage.saveSession({ ...owned('pinned'), pinned: true });
    await repositoryChatStorage.saveSession({ ...owned('project'), projectId: 'project-a' });
    await repositoryChatStorage.saveSession({ ...owned('archived'), archived: true });
    await repositoryChatStorage.saveSession(owned('running'));
    await repositoryChatStorage.saveSession(owned('active-task'));
    await repositoryChatStorage.saveSession({ ...owned('old-trash'), deletedAt: oldTrash });
    await repositoryChatStorage.saveProposal(createProposal('running-proposal', ownerId, 'running', 'running'));
    await repositoryChatStorage.saveProposal(createProposal('retained-proposal', ownerId, 'old-trash', 'success'));

    await repositoryChatStorage.cleanupWorkbench(ownerId, 1, 'active-task');

    await expect(repositoryChatStorage.getSession('ordinary')).resolves.toMatchObject({ deletedAt: expect.any(String) });
    for (const id of ['pinned', 'project', 'archived', 'running', 'active-task']) {
      await expect(repositoryChatStorage.getSession(id)).resolves.not.toMatchObject({ deletedAt: expect.any(String) });
    }
    await expect(repositoryChatStorage.getSession('old-trash')).resolves.toBeNull();
    await expect(repositoryChatStorage.getProposal('retained-proposal')).resolves.toMatchObject({
      id: 'retained-proposal',
      sessionId: 'old-trash',
    });
  });

  it('exports and restores a bounded owner backup with collision-safe relationships and inert operations', async () => {
    const ownerId = 'owner-a';
    const session: RepositoryChatSession = {
      ...createSession('workbench-session', 0, '2026-08-26T00:00:00.000Z'),
      ownerId,
      kind: 'workbench',
      repoFullName: '',
      sourceRefSha: '',
      projectId: 'project-a',
      workbench: {
        scope: 'selected',
        depth: 'standard',
        selectedRepositories: [createRepository()],
        searchBatches: [],
      },
    };
    const evidence = createEvidence('evidence-a');
    const message = createMessage('message-a', session.id, [evidence.id]);
    const toolEvent = {
      ...createToolEvent(session.id, evidence.id),
      id: 'tool-a',
      messageId: message.id,
    };
    await repositoryChatStorage.saveProject(createProject('project-a', ownerId));
    await repositoryChatStorage.saveSession(session);
    await repositoryChatStorage.saveMessage(message);
    await repositoryChatStorage.saveEvidence(evidence);
    await repositoryChatStorage.saveToolEvent(toolEvent);
    await repositoryChatStorage.saveProposal(createProposal('proposal-a', ownerId, session.id));

    const backup = await repositoryChatStorage.exportWorkbench(ownerId);
    await repositoryChatStorage.importWorkbench(ownerId, backup);

    const sessions = await repositoryChatStorage.listWorkbenchSessions(ownerId);
    const importedSession = sessions.find((item) => item.id !== session.id);
    expect(importedSession?.id).toBe('workbench-session-import-1');
    expect(importedSession?.projectId).toBe('project-a-import-1');
    const importedMessages = await repositoryChatStorage.listMessages(importedSession!.id);
    expect(importedMessages).toHaveLength(1);
    expect(importedMessages[0]).toMatchObject({
      id: 'message-a-import-1',
      sessionId: importedSession!.id,
      evidenceIds: ['evidence-a-import-1'],
    });
    await expect(repositoryChatStorage.listEvidence(['evidence-a-import-1'])).resolves.toMatchObject([
      { id: 'evidence-a-import-1' },
    ]);
    const proposals = await repositoryChatStorage.listProposals(ownerId, importedSession!.id);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      id: 'proposal-a-import-1',
      sessionId: importedSession!.id,
      operations: [{ selected: false, status: 'restored' }],
    });
  });

  it('keeps retained proposal journals detached when an orphaned session id collides on import', async () => {
    const ownerId = 'owner-a';
    await repositoryChatStorage.saveProposal(createProposal('orphan-proposal', ownerId, 'orphan-session'));
    const backup = await repositoryChatStorage.exportWorkbench(ownerId);
    await repositoryChatStorage.saveSession({
      ...createSession('orphan-session', 0, '2026-08-27T00:00:00.000Z'),
      ownerId,
      kind: 'workbench',
      repoFullName: '',
      sourceRefSha: '',
    });

    await repositoryChatStorage.importWorkbench(ownerId, backup);

    const imported = (await repositoryChatStorage.listProposals(ownerId))
      .find((proposal) => proposal.id === 'orphan-proposal-import-1');
    expect(imported).toMatchObject({
      id: 'orphan-proposal-import-1',
      sessionId: 'orphan-session-import-1',
      operations: [{ selected: false, status: 'restored' }],
    });
    await expect(repositoryChatStorage.getSession('orphan-session-import-1')).resolves.toBeNull();
  });

  it('round-trips organization drafts as inert history and rejects invalid classification references', async () => {
    const ownerId = 'organization-owner';
    const session = { ...createSession('organization-session', 0, '2026-09-28T00:00:00.000Z'), ownerId, kind: 'workbench' as const };
    const proposal = createProposal('organization-proposal', ownerId, session.id);
    proposal.operations = [];
    proposal.organization = {
      version: 1, revision: 1, scope: { name: 'pending', repositoryIds: [1] }, instruction: 'Organize', configId: 'model',
      maxNewSubcategories: 6, structureReady: true, categories: [{ id: 'new-category', name: 'Tools', icon: 'folder', parentId: null, isNew: true }],
      entries: [{ repositoryId: 1, before: { categoryId: null, subcategoryId: null, locked: false }, categoryId: 'new-category', subcategoryId: null,
        disposition: 'move', reason: 'Tool', selected: true, overrideLocked: false, manual: false, status: 'pending' }],
      batches: [{ repositoryIds: [1], status: 'complete' }], status: 'ready', createdCategoryIds: [],
    };
    await repositoryChatStorage.saveSession(session);
    await repositoryChatStorage.saveProposal(proposal);
    const backup = await repositoryChatStorage.exportWorkbench(ownerId);
    await repositoryChatStorage.importWorkbench(ownerId, backup);
    const imported = (await repositoryChatStorage.listProposals(ownerId)).find(p => p.id !== proposal.id)!;
    expect(imported.organization).toMatchObject({ status: 'imported', entries: [{ selected: false, categoryId: 'new-category' }] });
    const invalid = structuredClone(backup) as { proposals: WorkbenchProposal[] };
    invalid.proposals[0].organization!.entries[0].subcategoryId = 'invalid-child';
    await expect(repositoryChatStorage.importWorkbench(ownerId, invalid)).rejects.toThrow();
    expect(await repositoryChatStorage.listProposals(ownerId)).toHaveLength(2);
  });

  it('rejects malformed and foreign backups before writing any records', async () => {
    const ownerId = 'owner-a';
    await repositoryChatStorage.saveSession({
      ...createSession('owned', 1, '2026-08-26T00:00:00.000Z'),
      ownerId,
      kind: 'workbench',
    });
    const backup = await repositoryChatStorage.exportWorkbench(ownerId) as Record<string, unknown>;
    const before = await repositoryChatStorage.listWorkbenchSessions(ownerId);

    await expect(repositoryChatStorage.importWorkbench(ownerId, { ...backup, githubToken: 'secret' }))
      .rejects.toThrow('secret-like field');
    await expect(repositoryChatStorage.importWorkbench(ownerId, { ...backup, ownerId: 'owner-b' }))
      .rejects.toThrow('another account');
    await expect(repositoryChatStorage.listWorkbenchSessions(ownerId)).resolves.toEqual(before);
  });

  it('dispatches the global history notification after storage writes', async () => {
    const listener = vi.fn();
    window.addEventListener('gsm:global-chat-history-changed', listener);
    await repositoryChatStorage.saveSession(createSession('event-session', 1, '2026-08-26T00:00:00.000Z'));
    await repositoryChatStorage.saveProject(createProject('event-project', 'owner-a'));
    await repositoryChatStorage.saveProposal(createProposal('event-proposal', 'owner-a', 'event-session'));
    window.removeEventListener('gsm:global-chat-history-changed', listener);

    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('rejects fallback writes when localStorage persistence is unavailable', async () => {
    // 直接把 window.localStorage 换成抛错桩：不同平台的 jsdom 对 Storage 原型/
    // 实例方法的实现有差异，逐方法 spy 在 CI（Linux）上不可靠。
    const storageError = () => { throw new DOMException('storage is unavailable'); };
    const throwingStorage = {
      getItem: storageError,
      setItem: storageError,
      removeItem: storageError,
      clear: storageError,
      key: storageError,
      get length() { throw new DOMException('storage is unavailable'); },
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: throwingStorage });

    await expect(repositoryChatStorage.saveSession(createSession('cannot-persist', 1, '2026-08-26T00:00:00.000Z')))
      .rejects.toThrow('unable to persist fallback snapshot');
  });
});
