import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category, Repository } from '../types';
import type { WorkbenchOperation, WorkbenchProposal } from '../types/aiWorkbench';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  saved: new Map<string, WorkbenchProposal>(),
  searchRepositoriesWithSelection: vi.fn(),
  generateChatText: vi.fn(),
  getCurrentUser: vi.fn(),
  unstarRepository: vi.fn(),
  starRepository: vi.fn(),
  isRepositoryStarred: vi.fn(),
  forceSyncToBackend: vi.fn(),
  updateRepository: vi.fn(),
  deleteRepository: vi.fn(),
  setRepositories: vi.fn(),
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: {
    getState: () => mocks.state,
  },
}));

vi.mock('./aiService', () => ({
  AIService: class {
    searchRepositoriesWithSelection(...args: unknown[]) {
      return mocks.searchRepositoriesWithSelection(...args);
    }

    generateChatText(...args: unknown[]) {
      return mocks.generateChatText(...args);
    }
  },
}));

vi.mock('./githubApiFactory', () => ({
  createGitHubApiService: () => ({
    getCurrentUser: mocks.getCurrentUser,
    unstarRepository: mocks.unstarRepository,
    starRepository: mocks.starRepository,
    isRepositoryStarred: mocks.isRepositoryStarred,
  }),
}));

vi.mock('./autoSync', () => ({
  forceSyncToBackend: mocks.forceSyncToBackend,
}));

vi.mock('./repositoryChatStorage', () => ({
  repositoryChatStorage: {
    saveProposal: vi.fn(async (proposal: WorkbenchProposal) => {
      mocks.saved.set(proposal.id, structuredClone(proposal));
    }),
    getProposal: vi.fn(async (proposalId: string) => {
      const proposal = mocks.saved.get(proposalId);
      return proposal ? structuredClone(proposal) : null;
    }),
  },
}));

import {
  executeWorkbenchProposal,
  proposeWorkbenchOperations,
  restoreWorkbenchProposal,
} from './aiWorkbenchOperations';

const category = (id: string, name: string): Category => ({
  id,
  name,
  icon: 'folder',
  keywords: [],
  isCustom: true,
});

const repo = (id: number, overrides: Partial<Repository> = {}): Repository => ({
  id,
  name: `repo-${id}`,
  full_name: `owner/repo-${id}`,
  description: `Repository ${id}`,
  html_url: `https://github.com/owner/repo-${id}`,
  stargazers_count: 10,
  forks_count: 1,
  forks: 1,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  pushed_at: '2026-09-01T00:00:00.000Z',
  starred_at: '2026-05-01T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: '' },
  topics: ['tool'],
  ...overrides,
});

const editable = (repository: Repository) => ({
  custom_category: repository.custom_category,
  category_locked: repository.category_locked,
  custom_tags: repository.custom_tags ? [...repository.custom_tags] : repository.custom_tags,
  custom_description: repository.custom_description,
});

const proposalFor = (operation: WorkbenchOperation): WorkbenchProposal => ({
  id: `proposal-${operation.id}`,
  ownerId: '1',
  sessionId: 'session-1',
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
  operations: [operation],
});

const updateOperation = (
  repository: Repository,
  after: WorkbenchOperation['after'],
  overrides: Partial<WorkbenchOperation> = {},
): WorkbenchOperation => ({
  id: `op-${repository.id}`,
  repository: structuredClone(repository),
  kind: 'update',
  reason: 'Update personal metadata',
  before: editable(repository),
  after,
  selected: true,
  overrideLocked: false,
  status: 'proposed',
  ...overrides,
});

const persist = (proposal: WorkbenchProposal) => {
  mocks.saved.set(proposal.id, structuredClone(proposal));
};

const setRepositories = (repositories: Repository[]) => {
  (mocks.state as { repositories: Repository[] }).repositories = repositories;
};

describe('aiWorkbenchOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saved.clear();
    mocks.state = {
      githubToken: 'github-token',
      user: { id: 1, login: 'octocat', name: 'Octo', avatar_url: '', email: null },
      repositories: [],
      aiConfigs: [{ id: 'ai', name: 'AI', baseUrl: 'https://ai.example.com/v1', apiKey: 'key', model: 'model', isActive: true }],
      activeAIConfig: 'ai',
      repositoryChatSettings: { chatConfigId: null },
      language: 'en',
      customCategories: [category('keep', 'Keep'), category('archive', 'Archive')],
      hiddenDefaultCategoryIds: [],
      defaultCategoryOverrides: {},
      updateRepository: mocks.updateRepository,
      deleteRepository: mocks.deleteRepository,
      setRepositories: mocks.setRepositories,
    };
    mocks.getCurrentUser.mockResolvedValue({ id: 1, login: 'octocat', name: 'Octo', avatar_url: '', email: null });
    mocks.searchRepositoriesWithSelection.mockImplementation(async (repositories: Repository[]) => repositories);
    mocks.generateChatText.mockResolvedValue('{"operations":[]}');
    mocks.unstarRepository.mockResolvedValue(undefined);
    mocks.starRepository.mockResolvedValue(undefined);
    mocks.isRepositoryStarred.mockResolvedValue(false);
    mocks.forceSyncToBackend.mockResolvedValue(undefined);
    mocks.updateRepository.mockImplementation((repository: Repository) => {
      setRepositories((mocks.state as { repositories: Repository[] }).repositories.map((current) => (
        current.id === repository.id ? repository : current
      )));
    });
    mocks.deleteRepository.mockImplementation((repositoryId: number) => {
      setRepositories((mocks.state as { repositories: Repository[] }).repositories.filter((current) => current.id !== repositoryId));
    });
    mocks.setRepositories.mockImplementation((repositories: Repository[]) => setRepositories(repositories));
  });

  it('constrains AI metadata proposals to current repository IDs and existing category IDs without blocking safe edits on locked rows', async () => {
    const unlocked = repo(1, { custom_category: 'Keep', category_locked: false });
    const locked = repo(2, { custom_category: 'Keep', category_locked: true });
    setRepositories([unlocked, locked]);
    mocks.generateChatText.mockResolvedValue(JSON.stringify({
      operations: [
        { repositoryId: 1, reason: 'Better grouping', categoryId: 'archive' },
        { repositoryId: 2, reason: 'Add a personal tag', customTags: ['review'] },
      ],
    }));

    const proposal = await proposeWorkbenchOperations({
      question: 'organize these repositories',
      sessionId: 'session-ai',
      signal: new AbortController().signal,
    });

    expect(proposal.ownerId).toBe('1');
    expect(proposal.operations).toHaveLength(2);
    expect(proposal.operations[0]).toMatchObject({ kind: 'update', selected: true, overrideLocked: false });
    expect(proposal.operations[0].after).toMatchObject({ custom_category: 'Archive', category_locked: false });
    expect(proposal.operations[1]).toMatchObject({ kind: 'update', selected: true, overrideLocked: false });
    expect(proposal.operations[1].after.category_locked).toBe(true);
    expect(mocks.saved.get(proposal.id)?.operations).toHaveLength(2);
  });

  it('rejects AI operations that escape the repository or category allowlists', async () => {
    const repository = repo(1, { custom_category: 'Keep' });
    setRepositories([repository]);
    mocks.generateChatText.mockResolvedValueOnce(JSON.stringify({
      operations: [{ repositoryId: 1, reason: 'Invent category', categoryId: 'made-up' }],
    }));

    await expect(proposeWorkbenchOperations({
      question: 'organize this repository',
      sessionId: 'session-invalid-category',
      signal: new AbortController().signal,
    })).rejects.toThrow('unavailable category ID');

    mocks.generateChatText.mockResolvedValueOnce(JSON.stringify({
      operations: [{ repositoryId: 999, reason: 'Unknown repository', customDescription: 'bad' }],
    }));
    await expect(proposeWorkbenchOperations({
      question: 'organize this repository',
      sessionId: 'session-invalid-repo',
      signal: new AbortController().signal,
    })).rejects.toThrow('unavailable repository');

    mocks.generateChatText.mockResolvedValueOnce(JSON.stringify({
      operations: [{ repositoryId: 1, reason: 'Try a tool', customDescription: 'bad', tool: 'deleteRepository' }],
    }));
    await expect(proposeWorkbenchOperations({
      question: 'organize this repository',
      sessionId: 'session-arbitrary-tool',
      signal: new AbortController().signal,
    })).rejects.toThrow('required schema');
  });

  it('turns an explicit unstar request into review-only unstar proposals without asking the model for mutation actions', async () => {
    const repository = repo(1);
    setRepositories([repository]);

    const proposal = await proposeWorkbenchOperations({
      question: 'unstar repositories that match this cleanup request',
      sessionId: 'session-unstar',
      signal: new AbortController().signal,
    });

    expect(proposal.operations).toHaveLength(1);
    expect(proposal.operations[0]).toMatchObject({ kind: 'unstar', selected: false, status: 'proposed' });
    expect(mocks.generateChatText).not.toHaveBeenCalled();
    expect(mocks.unstarRepository).not.toHaveBeenCalled();
  });

  it('rejects a stale or tampered proposal payload before any side effect', async () => {
    const repository = repo(1, { custom_description: 'before' });
    setRepositories([repository]);
    const operation = updateOperation(repository, { ...editable(repository), custom_description: 'after' });
    const proposal = proposalFor(operation);
    persist(proposal);
    const tampered = structuredClone(proposal);
    tampered.operations[0].after.custom_description = 'attacker value';

    await expect(executeWorkbenchProposal(tampered, new AbortController().signal, async () => undefined))
      .rejects.toThrow('payload was modified');
    expect(mocks.updateRepository).not.toHaveBeenCalled();
    expect(mocks.unstarRepository).not.toHaveBeenCalled();
  });

  it('rejects a proposal when the authenticated GitHub account no longer matches its owner', async () => {
    const repository = repo(1, { custom_description: 'before' });
    setRepositories([repository]);
    const operation = updateOperation(repository, { ...editable(repository), custom_description: 'after' });
    const proposal = proposalFor(operation);
    persist(proposal);
    mocks.state.user = { id: 2, login: 'other', name: 'Other', avatar_url: '', email: null };
    mocks.getCurrentUser.mockResolvedValue({ id: 2, login: 'other', name: 'Other', avatar_url: '', email: null });

    await expect(executeWorkbenchProposal(proposal, new AbortController().signal, async () => undefined))
      .rejects.toThrow('different GitHub account');
    expect(mocks.updateRepository).not.toHaveBeenCalled();
    expect(mocks.unstarRepository).not.toHaveBeenCalled();
  });

  it('keeps partial operation failures separate from backend sync failures', async () => {
    const first = repo(1, { custom_description: 'one' });
    const second = repo(2, { custom_description: 'two' });
    setRepositories([first, second]);
    const firstOp = updateOperation(first, { ...editable(first), custom_description: 'one-updated' });
    const secondOp = updateOperation(second, { ...editable(second), custom_description: 'two-updated' });
    const proposal: WorkbenchProposal = {
      ...proposalFor(firstOp),
      id: 'proposal-partial',
      operations: [firstOp, secondOp],
    };
    persist(proposal);
    setRepositories([first, { ...second, custom_description: 'edited elsewhere' }]);
    mocks.forceSyncToBackend.mockRejectedValueOnce(new Error('backend offline'));

    const result = await executeWorkbenchProposal(proposal, new AbortController().signal, async () => undefined);

    expect(result.operations.map((operation) => operation.status)).toEqual(['success', 'conflict']);
    expect(result.syncError).toBe('backend offline');
    expect((mocks.state as { repositories: Repository[] }).repositories[0].custom_description).toBe('one-updated');
    expect((mocks.state as { repositories: Repository[] }).repositories[1].custom_description).toBe('edited elsewhere');
  });

  it('requires a separate explicit override before changing a locked category', async () => {
    const repository = repo(1, { custom_category: 'Keep', category_locked: true });
    setRepositories([repository]);
    const operation = updateOperation(repository, { ...editable(repository), custom_category: 'Archive' }, { selected: false });
    const proposal = proposalFor(operation);
    persist(proposal);
    const selected = structuredClone(proposal);
    selected.operations[0].selected = true;

    const blocked = await executeWorkbenchProposal(selected, new AbortController().signal, async () => undefined);
    expect(blocked.operations[0].status).toBe('conflict');
    expect((mocks.state as { repositories: Repository[] }).repositories[0].custom_category).toBe('Keep');

    const overridden = structuredClone(blocked);
    overridden.operations[0].overrideLocked = true;
    const applied = await executeWorkbenchProposal(overridden, new AbortController().signal, async () => undefined);
    expect(applied.operations[0].status).toBe('success');
    expect((mocks.state as { repositories: Repository[] }).repositories[0]).toMatchObject({
      custom_category: 'Archive',
      category_locked: true,
    });
  });

  it('marks an ambiguous unstar as unknown and reconciles later without blindly repeating the remote delete', async () => {
    const repository = repo(1);
    setRepositories([repository]);
    const before = editable(repository);
    const operation: WorkbenchOperation = {
      id: 'op-unstar',
      repository: structuredClone(repository),
      kind: 'unstar',
      reason: 'Cleanup',
      before,
      after: structuredClone(before),
      selected: false,
      overrideLocked: false,
      status: 'proposed',
    };
    const proposal = proposalFor(operation);
    persist(proposal);
    const selected = structuredClone(proposal);
    selected.operations[0].selected = true;
    mocks.unstarRepository.mockRejectedValueOnce(new Error('network dropped'));
    mocks.isRepositoryStarred.mockRejectedValueOnce(new Error('status unavailable'));

    const result = await executeWorkbenchProposal(selected, new AbortController().signal, async () => undefined);

    expect(result.operations[0].status).toBe('unknown');
    expect(mocks.unstarRepository).toHaveBeenCalledTimes(1);
    expect(mocks.deleteRepository).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();

    mocks.isRepositoryStarred.mockResolvedValueOnce(false);
    const reconciled = await executeWorkbenchProposal(result, new AbortController().signal, async () => undefined);
    expect(reconciled.operations[0].status).toBe('success');
    expect(mocks.unstarRepository).toHaveBeenCalledTimes(1);
    expect(mocks.deleteRepository).toHaveBeenCalledWith(repository.id);
  });

  it('reconciles an unstar request error to success only after GitHub confirms the repository is no longer starred', async () => {
    const repository = repo(1);
    setRepositories([repository]);
    const before = editable(repository);
    const operation: WorkbenchOperation = {
      id: 'op-unstar-reconciled',
      repository: structuredClone(repository),
      kind: 'unstar',
      reason: 'Cleanup',
      before,
      after: structuredClone(before),
      selected: false,
      overrideLocked: false,
      status: 'proposed',
    };
    const proposal = proposalFor(operation);
    persist(proposal);
    const selected = structuredClone(proposal);
    selected.operations[0].selected = true;
    mocks.unstarRepository.mockRejectedValueOnce(new Error('connection closed after request'));
    mocks.isRepositoryStarred.mockResolvedValueOnce(false);

    const result = await executeWorkbenchProposal(selected, new AbortController().signal, async () => undefined);

    expect(result.operations[0].status).toBe('success');
    expect(mocks.unstarRepository).toHaveBeenCalledTimes(1);
    expect(mocks.isRepositoryStarred).toHaveBeenCalledTimes(1);
    expect(mocks.deleteRepository).toHaveBeenCalledWith(repository.id);
  });

  it('reconciles a journaled running update before retrying and does not apply it twice', async () => {
    const repository = repo(1, { custom_description: 'before' });
    const operation = updateOperation(repository, { ...editable(repository), custom_description: 'after' }, { status: 'running' });
    const proposal = proposalFor(operation);
    persist(proposal);
    setRepositories([{ ...repository, custom_description: 'after' }]);

    const result = await executeWorkbenchProposal(proposal, new AbortController().signal, async () => undefined);

    expect(result.operations[0].status).toBe('success');
    expect(mocks.updateRepository).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).toHaveBeenCalledWith({ reportFailures: true });
  });

  it('refuses to roll back an update after the user has changed the edited fields again', async () => {
    const repository = repo(1, { custom_description: 'before' });
    const operation = updateOperation(repository, { ...editable(repository), custom_description: 'after' }, { status: 'success' });
    const proposal = proposalFor(operation);
    persist(proposal);
    setRepositories([{ ...repository, custom_description: 'new user edit' }]);

    const result = await restoreWorkbenchProposal(proposal, new AbortController().signal, async () => undefined);

    expect(result.operations[0].status).toBe('conflict');
    expect((mocks.state as { repositories: Repository[] }).repositories[0].custom_description).toBe('new user edit');
    expect(mocks.updateRepository).not.toHaveBeenCalled();
  });

  it('reconciles an interrupted restore before retrying it', async () => {
    const repository = repo(1, { custom_description: 'before' });
    const after = { ...editable(repository), custom_description: 'after' };
    const operation = updateOperation(repository, after, {
      status: 'running',
      error: '__workbench_restore_running__',
    });
    const proposal = proposalFor(operation);
    persist(proposal);
    setRepositories([repository]);

    const result = await restoreWorkbenchProposal(proposal, new AbortController().signal, async () => undefined);

    expect(result.operations[0].status).toBe('restored');
    expect(mocks.updateRepository).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).toHaveBeenCalledWith({ reportFailures: true });
  });

  it('restores a successful unstar without reusing the original starred_at timestamp', async () => {
    const repository = repo(1, { custom_category: 'Keep', custom_tags: ['personal'], custom_description: 'mine' });
    const before = editable(repository);
    const operation: WorkbenchOperation = {
      id: 'op-unstar-restore',
      repository: structuredClone(repository),
      kind: 'unstar',
      reason: 'Cleanup',
      before,
      after: structuredClone(before),
      selected: true,
      overrideLocked: false,
      status: 'success',
    };
    const proposal = proposalFor(operation);
    persist(proposal);
    setRepositories([]);
    mocks.isRepositoryStarred.mockResolvedValueOnce(false);

    const result = await restoreWorkbenchProposal(proposal, new AbortController().signal, async () => undefined);

    expect(result.operations[0].status).toBe('restored');
    expect(mocks.starRepository).toHaveBeenCalledWith('owner', 'repo-1');
    const restored = (mocks.state as { repositories: Repository[] }).repositories[0];
    expect(restored).toMatchObject({ id: 1, custom_category: 'Keep', custom_tags: ['personal'], custom_description: 'mine' });
    expect(restored).not.toHaveProperty('starred_at');
  });

  it('does not re-star during rollback when a conflicting local copy has appeared', async () => {
    const repository = repo(1, { custom_description: 'before' });
    const before = editable(repository);
    const operation: WorkbenchOperation = {
      id: 'op-unstar-conflict',
      repository: structuredClone(repository),
      kind: 'unstar',
      reason: 'Cleanup',
      before,
      after: structuredClone(before),
      selected: true,
      overrideLocked: false,
      status: 'success',
    };
    const proposal = proposalFor(operation);
    persist(proposal);
    setRepositories([{ ...repository, custom_description: 'changed after unstar' }]);

    const result = await restoreWorkbenchProposal(proposal, new AbortController().signal, async () => undefined);

    expect(result.operations[0].status).toBe('conflict');
    expect(mocks.starRepository).not.toHaveBeenCalled();
  });
});
