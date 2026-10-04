import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { repositoryChatStorage } from './repositoryChatStorage';
import type { WorkbenchProject, WorkbenchProposal } from '../types/aiWorkbench';
import type { RepositoryChatMessage, RepositoryChatSession, RepositoryChatToolEvent, ToolEvidence } from '../types/repositoryChat';
import type { Repository } from '../types';
import { loadResearchCheckpoint, saveResearchCheckpoint } from './workbenchResearchCheckpoint';

const DAY_MS = 24 * 60 * 60 * 1000;

const createRepository = (id = 1): Repository => ({
  id,
  name: `repository-${id}`,
  full_name: `owner/repository-${id}`,
  description: 'Repository',
  html_url: `https://github.com/owner/repository-${id}`,
  stargazers_count: 10,
  forks_count: 2,
  forks: 2,
  language: 'TypeScript',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  pushed_at: '2026-09-01T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://avatars.example/owner' },
  topics: ['storage'],
});

const createSession = (
  id: string,
  ownerId?: string,
  options: Partial<RepositoryChatSession> = {},
): RepositoryChatSession => ({
  id,
  repoId: 1,
  repoFullName: 'owner/repository-1',
  sourceRefSha: 'abcdef1234567890',
  title: id,
  ...(ownerId ? { ownerId } : {}),
  kind: 'workbench',
  workbench: {
    scope: 'selected',
    depth: 'standard',
    selectedRepositories: [createRepository()],
    searchBatches: [],
  },
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...options,
});

const createProject = (id: string, ownerId: string): WorkbenchProject => ({
  id,
  ownerId,
  name: id,
  instructions: 'Use primary sources.',
  conclusions: '',
  repositories: [createRepository()],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
});

const createProposal = (id: string, ownerId: string, sessionId: string): WorkbenchProposal => ({
  id,
  ownerId,
  sessionId,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  operations: [
    {
      id: `${id}-success`,
      repository: createRepository(),
      kind: 'update',
      reason: 'Update metadata',
      before: {},
      after: { custom_category: 'Research' },
      selected: true,
      overrideLocked: false,
      status: 'success',
    },
    {
      id: `${id}-running`,
      repository: createRepository(2),
      kind: 'unstar',
      reason: 'Remove stale repository',
      before: {},
      after: {},
      selected: true,
      overrideLocked: false,
      status: 'running',
    },
  ],
});

const createMessage = (sessionId: string, evidenceId: string): RepositoryChatMessage => ({
  id: `message-${sessionId}`,
  sessionId,
  role: 'assistant',
  content: 'Answer',
  status: 'complete',
  evidenceIds: [evidenceId],
  createdAt: '2026-09-01T00:00:00.000Z',
});

const createToolEvent = (sessionId: string, evidenceId: string): RepositoryChatToolEvent => ({
  id: `tool-${sessionId}`,
  sessionId,
  messageId: `message-${sessionId}`,
  toolName: 'read_repo_readme',
  status: 'success',
  paramSummary: 'README.md',
  evidenceId,
  createdAt: '2026-09-01T00:00:00.000Z',
});

const createEvidence = (id: string): ToolEvidence => ({
  id,
  source: 'github',
  repoFullName: 'owner/repository-1',
  url: 'https://github.com/owner/repository-1#readme',
  excerpt: 'README',
  retrievedAt: '2026-09-01T00:00:00.000Z',
});

describe('repositoryChatStorage workbench fallback', () => {
  it('round trips current stable category fields and editable proposal snapshots', async () => {
    const session = createSession('current-fields', 'field-owner');
    session.workbench!.selectedRepositories[0] = { ...createRepository(), category_id: 'tools', subcategory_id: null,
      category_candidates: ['tools'], category_legacy: { custom_category: 'Old tools', category_locked: true } };
    const proposal = createProposal('current-proposal', 'field-owner', session.id);
    proposal.operations[0].before = { category_id: undefined, subcategory_id: undefined };
    proposal.operations[0].after = { category_id: 'tools', subcategory_id: null };
    await repositoryChatStorage.saveSession(session);
    await repositoryChatStorage.saveProposal(proposal);
    const backup = await repositoryChatStorage.exportWorkbench('field-owner');
    await repositoryChatStorage.importWorkbench('field-owner', JSON.stringify(backup));
    expect(backup).toHaveProperty('sessions.0.workbench.selectedRepositories.0.category_id', 'tools');
    expect(backup).toHaveProperty('proposals.0.operations.0.after.category_id', 'tools');
  });

  it('round trips rich repository details without stripping their source and quickstart data', async () => {
    const session = createSession('details-session', 'details-owner');
    const details = {
      version: 1 as const, generated_at: '2026-10-04T00:00:00.000Z', repository_pushed_at: null, model: 'fixture',
      summary: 'Local note management', platforms: ['Linux'], software_forms: ['cli' as const], deployment_modes: ['local' as const], tags: ['notes'],
      sources: [{ label: 'README', url: 'https://github.com/owner/repository-1#readme', retrieved_at: '2026-10-04T00:00:00.000Z' }],
      problem: 'Organize notes', features: ['Local search'], scenarios: ['Research'], architecture: null,
      quickstart: [{ description: 'Install', command: 'npm install' }], deployment: null, cost: null, maintenance: null,
    };
    session.workbench!.selectedRepositories[0].ai_details = details;
    await repositoryChatStorage.saveSession(session);
    const exported = await repositoryChatStorage.exportWorkbench('details-owner');
    await repositoryChatStorage.importWorkbench('details-owner', JSON.stringify(exported));
    expect((await repositoryChatStorage.getSession('details-session-import-1'))?.workbench?.selectedRepositories[0].ai_details).toEqual(details);
  });

  it('purges session checkpoints and drafts while preserving applied operation history and other owners', async () => {
    const session = createSession('purge-session', 'purge-owner');
    await repositoryChatStorage.saveSession(session);
    const draft = createProposal('purge-draft', 'purge-owner', session.id);
    draft.operations = draft.operations.map(operation => ({ ...operation, status: 'proposed' }));
    const applied = createProposal('purge-applied', 'purge-owner', session.id);
    await repositoryChatStorage.saveProposal(draft);
    await repositoryChatStorage.saveProposal(applied);
    const checkpoint = [{ repository: 'owner/repository-1', version: 'sha', savedAt: Date.now(), result: { content: 'Saved research', evidences: [] } }];
    saveResearchCheckpoint('purge-owner', session.id, 'context', checkpoint);
    saveResearchCheckpoint('other-owner', session.id, 'context', checkpoint);
    expect(loadResearchCheckpoint('purge-owner', session.id, 'context')).toHaveLength(1);
    await repositoryChatStorage.permanentlyDeleteSession(session.id);
    expect(loadResearchCheckpoint('purge-owner', session.id, 'context')).toEqual([]);
    expect(loadResearchCheckpoint('other-owner', session.id, 'context')).toHaveLength(1);
    expect(await repositoryChatStorage.getProposal(draft.id)).toBeNull();
    expect(await repositoryChatStorage.getProposal(applied.id)).toEqual(applied);
    expect(await repositoryChatStorage.getSession(session.id)).toBeNull();
  });
  const originalIndexedDb = Object.getOwnPropertyDescriptor(window, 'indexedDB');

  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalIndexedDb) Object.defineProperty(window, 'indexedDB', originalIndexedDb);
    else delete (window as { indexedDB?: IDBFactory }).indexedDB;
  });

  it('isolates workbench session modes by owner while keeping unowned legacy sessions claimable', async () => {
    await repositoryChatStorage.saveSession(createSession('active-a', 'owner-a'));
    await repositoryChatStorage.saveSession(createSession('archived-a', 'owner-a', { archived: true }));
    await repositoryChatStorage.saveSession(createSession('trash-a', 'owner-a', { deletedAt: '2026-09-20T00:00:00.000Z' }));
    await repositoryChatStorage.saveSession(createSession('active-b', 'owner-b'));
    await repositoryChatStorage.saveSession(createSession('repository-a', 'owner-a', { kind: 'repository', workbench: undefined }));
    await repositoryChatStorage.saveSession(createSession('legacy', undefined, { kind: undefined, workbench: undefined }));

    await expect(repositoryChatStorage.listWorkbenchSessions('owner-a')).resolves.toMatchObject([
      { id: 'active-a' },
      { id: 'repository-a' },
    ]);
    await expect(repositoryChatStorage.listWorkbenchSessions('owner-a', 'archived')).resolves.toMatchObject([{ id: 'archived-a' }]);
    await expect(repositoryChatStorage.listWorkbenchSessions('owner-a', 'trash')).resolves.toMatchObject([{ id: 'trash-a' }]);
    await expect(repositoryChatStorage.listWorkbenchSessions('owner-a', 'legacy')).resolves.toMatchObject([{ id: 'legacy' }]);

    await expect(repositoryChatStorage.claimSession('legacy', 'owner-a')).resolves.toMatchObject({ id: 'legacy', ownerId: 'owner-a' });
    await expect(repositoryChatStorage.claimSession('legacy', 'owner-a')).resolves.toBeNull();
    await expect(repositoryChatStorage.claimSession('active-b', 'owner-a')).resolves.toBeNull();
  });

  it('round-trips conversation-only overview data and rejects invalid overview types', async () => {
    const session = createSession('overview-storage', 'overview-owner');
    const requirements = { purpose: 'Notes', required: [], preferred: [], excluded: [], questions: [], queries: ['notes'] };
    session.workbench!.inputIntent = 'results';
    session.workbench!.searchBatches = [{ id: 'overview-batch', createdAt: session.createdAt, requirements,
      queries: ['notes'], nextPage: 2, overviewSummary: 'A note editor.', candidates: [{ repository: createRepository(),
        summary: 'Editor', reasons: [], limitations: [], sources: [], status: 'candidate', overview: {
          summary: 'A local note editor.', category: 'Notes', categoryDescription: 'Reading notes',
          kind: 'tool', status: 'ready', basis: 'metadata',
        } }] }];
    await repositoryChatStorage.saveSession(session);
    const backup = await repositoryChatStorage.exportWorkbench('overview-owner');
    await repositoryChatStorage.importWorkbench('overview-owner', backup);
    expect((await repositoryChatStorage.getSession(session.id))?.workbench?.searchBatches[0].candidates[0].overview?.category).toBe('Notes');
    const invalid = JSON.parse(JSON.stringify(backup));
    invalid.sessions[0].workbench.searchBatches[0].candidates[0].overview.kind = 'unsupported-kind';
    await expect(repositoryChatStorage.importWorkbench('overview-owner', invalid)).rejects.toThrow(/overview.kind/);
  });

  it('prevents owner-changing overwrites for sessions, projects, and proposal logs', async () => {
    await repositoryChatStorage.saveSession(createSession('session', 'owner-a'));
    await repositoryChatStorage.saveProject(createProject('project', 'owner-a'));
    await repositoryChatStorage.saveProposal(createProposal('proposal', 'owner-a', 'session'));

    await expect(repositoryChatStorage.saveSession(createSession('session', 'owner-b'))).rejects.toThrow('another account');
    await expect(repositoryChatStorage.saveProject(createProject('project', 'owner-b'))).rejects.toThrow('another account');
    await expect(repositoryChatStorage.saveProposal(createProposal('proposal', 'owner-b', 'session'))).rejects.toThrow('another account');

    await expect(repositoryChatStorage.listProjects('owner-a')).resolves.toMatchObject([{ id: 'project', ownerId: 'owner-a' }]);
    await expect(repositoryChatStorage.listProposals('owner-a')).resolves.toMatchObject([{ id: 'proposal', ownerId: 'owner-a' }]);
  });

  it('soft-trashes expired workbench sessions, honors protection and clamps retention, then purges 30-day trash without deleting proposal logs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T00:00:00.000Z'));
    const veryOld = new Date(Date.now() - 400 * DAY_MS).toISOString();
    const oldTrash = new Date(Date.now() - 31 * DAY_MS).toISOString();

    await repositoryChatStorage.saveSession(createSession('expired', 'owner-a', { updatedAt: veryOld }));
    await repositoryChatStorage.saveSession(createSession('pinned', 'owner-a', { updatedAt: veryOld, pinned: true }));
    await repositoryChatStorage.saveSession(createSession('archived', 'owner-a', { updatedAt: veryOld, archived: true }));
    await repositoryChatStorage.saveSession(createSession('project-session', 'owner-a', { updatedAt: veryOld, projectId: 'project' }));
    await repositoryChatStorage.saveSession(createSession('active', 'owner-a', { updatedAt: veryOld }));
    await repositoryChatStorage.saveSession(createSession('repository-chat', 'owner-a', { updatedAt: veryOld, kind: 'repository', workbench: undefined }));
    await repositoryChatStorage.saveSession(createSession('old-trash', 'owner-a', { deletedAt: oldTrash, updatedAt: oldTrash }));
    const auditProposal = createProposal('audit-log', 'owner-a', 'old-trash');
    auditProposal.operations = auditProposal.operations.map((operation) => ({ ...operation, status: 'success' }));
    await repositoryChatStorage.saveProposal(auditProposal);

    await repositoryChatStorage.cleanupWorkbench('owner-a', 999, 'active');

    await expect(repositoryChatStorage.getSession('expired')).resolves.toMatchObject({ id: 'expired', deletedAt: expect.any(String) });
    expect((await repositoryChatStorage.getSession('pinned'))?.deletedAt).toBeUndefined();
    await expect(repositoryChatStorage.getSession('archived')).resolves.toMatchObject({ id: 'archived', archived: true });
    expect((await repositoryChatStorage.getSession('archived'))?.deletedAt).toBeUndefined();
    expect((await repositoryChatStorage.getSession('project-session'))?.deletedAt).toBeUndefined();
    expect((await repositoryChatStorage.getSession('active'))?.deletedAt).toBeUndefined();
    await expect(repositoryChatStorage.getSession('repository-chat')).resolves.toMatchObject({ deletedAt: expect.any(String) });
    await expect(repositoryChatStorage.getSession('old-trash')).resolves.toBeNull();
    await expect(repositoryChatStorage.getProposal('audit-log')).resolves.toMatchObject({ id: 'audit-log', sessionId: 'old-trash' });
  });

  it('restores trash without changing archive state', async () => {
    await repositoryChatStorage.saveSession(createSession('archived-trash', 'owner-a', {
      archived: true,
      deletedAt: '2026-09-20T00:00:00.000Z',
    }));

    await expect(repositoryChatStorage.restoreSession('archived-trash')).resolves.toMatchObject({
      id: 'archived-trash',
      archived: true,
    });
    const restored = await repositoryChatStorage.getSession('archived-trash');
    expect(restored?.deletedAt).toBeUndefined();
    await expect(repositoryChatStorage.listWorkbenchSessions('owner-a', 'archived')).resolves.toMatchObject([{ id: 'archived-trash' }]);
  });

  it('exports strict owner-scoped data and imports remapped relationships with non-executable proposal operations', async () => {
    const session = createSession('session', 'owner-a', { projectId: 'project' });
    const evidence = createEvidence('evidence');
    await repositoryChatStorage.saveProject(createProject('project', 'owner-a'));
    await repositoryChatStorage.saveSession(session);
    await repositoryChatStorage.saveMessage(createMessage(session.id, evidence.id));
    await repositoryChatStorage.saveToolEvent(createToolEvent(session.id, evidence.id));
    await repositoryChatStorage.saveEvidence(evidence);
    await repositoryChatStorage.saveProposal(createProposal('proposal', 'owner-a', session.id));
    await repositoryChatStorage.saveSession(createSession('repository-chat', 'owner-a', { kind: 'repository', workbench: undefined }));

    const exported = await repositoryChatStorage.exportWorkbench('owner-a') as Record<string, unknown>;
    expect((exported.sessions as RepositoryChatSession[]).map((item) => item.id)).toEqual(['session', 'repository-chat']);

    await expect(repositoryChatStorage.importWorkbench('owner-b', exported)).rejects.toThrow('another account');
    await expect(repositoryChatStorage.listWorkbenchSessions('owner-b')).resolves.toEqual([]);

    const invalid = structuredClone(exported) as Record<string, unknown>;
    const invalidSessions = invalid.sessions as Array<Record<string, unknown>>;
    invalidSessions[0].apiToken = 'should-never-import';
    await expect(repositoryChatStorage.importWorkbench('owner-a', invalid)).rejects.toThrow('secret-like field');
    await expect(repositoryChatStorage.listWorkbenchSessions('owner-a')).resolves.toHaveLength(2);

    await repositoryChatStorage.importWorkbench('owner-a', JSON.stringify(exported));

    const sessions = await repositoryChatStorage.listWorkbenchSessions('owner-a');
    const importedSession = sessions.find((item) => item.id === 'session-import-1');
    expect(importedSession).toMatchObject({ ownerId: 'owner-a', projectId: 'project-import-1' });

    const importedMessages = await repositoryChatStorage.listMessages('session-import-1');
    expect(importedMessages).toMatchObject([{
      id: 'message-session-import-1',
      sessionId: 'session-import-1',
      evidenceIds: ['evidence-import-1'],
    }]);
    await expect(repositoryChatStorage.listToolEvents('session-import-1')).resolves.toMatchObject([{
      id: 'tool-session-import-1',
      sessionId: 'session-import-1',
      messageId: 'message-session-import-1',
      evidenceId: 'evidence-import-1',
    }]);

    const proposals = await repositoryChatStorage.listProposals('owner-a', 'session-import-1');
    expect(proposals).toHaveLength(1);
    expect(proposals[0].operations).toMatchObject([
      { id: 'proposal-success', selected: false, status: 'restored' },
      { id: 'proposal-running', selected: false, status: 'restored' },
    ]);
  });

  it('rejects broken backup relationships before writing any imported records', async () => {
    const session = createSession('session', 'owner-a');
    const evidence = createEvidence('evidence');
    await repositoryChatStorage.saveSession(session);
    await repositoryChatStorage.saveMessage(createMessage(session.id, evidence.id));
    await repositoryChatStorage.saveToolEvent(createToolEvent(session.id, evidence.id));
    await repositoryChatStorage.saveEvidence(evidence);
    const exported = await repositoryChatStorage.exportWorkbench('owner-a') as Record<string, unknown>;
    const broken = structuredClone(exported) as Record<string, unknown>;
    broken.evidence = [];

    await expect(repositoryChatStorage.importWorkbench('owner-a', broken)).rejects.toThrow('missing evidence');
    await expect(repositoryChatStorage.listWorkbenchSessions('owner-a')).resolves.toHaveLength(1);
    await expect(repositoryChatStorage.getSession('session-import-1')).resolves.toBeNull();
  });
});
