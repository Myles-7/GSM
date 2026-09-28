import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig, Repository } from '../types';
import type { WorkbenchDepth, WorkbenchProject, WorkbenchRequirements, WorkbenchSearchBatch } from '../types/aiWorkbench';
import type { RepositoryChatSession } from '../types/repositoryChat';

const mocks = vi.hoisted(() => ({
  storeState: {} as Record<string, unknown>,
  aiConstructors: [] as AIConfig[],
  generateChatText: vi.fn(),
  generateChatTextStream: vi.fn(),
  searchRepositories: vi.fn(),
  getRepositoryMeta: vi.fn(),
  getRepositoryHeadSha: vi.fn(),
  getRepositoryReadme: vi.fn(),
  starRepository: vi.fn(),
  addRepository: vi.fn(),
  forceSyncToBackend: vi.fn(),
  runRepositoryChatTurn: vi.fn(),
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: {
    getState: () => mocks.storeState,
  },
}));

vi.mock('./aiService', () => ({
  AIService: class {
    constructor(config: AIConfig) {
      mocks.aiConstructors.push(config);
    }

    generateChatText = mocks.generateChatText;
    generateChatTextStream = mocks.generateChatTextStream;
  },
  isAIStreamUnsupportedError: (error: unknown): boolean => error instanceof Error && error.name === 'AIStreamUnsupportedError',
}));

vi.mock('./githubApiFactory', () => ({
  createGitHubApiService: () => ({
    searchRepositories: mocks.searchRepositories,
    getRepositoryMeta: mocks.getRepositoryMeta,
    getRepositoryHeadSha: mocks.getRepositoryHeadSha,
    getRepositoryReadme: mocks.getRepositoryReadme,
    starRepository: mocks.starRepository,
  }),
}));

vi.mock('./autoSync', () => ({
  forceSyncToBackend: mocks.forceSyncToBackend,
}));

vi.mock('./repositoryChatRunner', () => ({
  runRepositoryChatTurn: mocks.runRepositoryChatTurn,
}));

import {
  WorkbenchStarSyncError,
  answerWorkbench,
  prepareWorkbenchRequirements,
  searchWorkbench,
  starWorkbenchRepository,
  workbenchRuntime,
} from './aiWorkbenchService';

const chatConfig: AIConfig = {
  id: 'chat-ai',
  name: 'Chat AI',
  baseUrl: 'https://ai.example.com/v1',
  apiKey: 'chat-key',
  model: 'chat-model',
  isActive: true,
};

const activeConfig: AIConfig = {
  ...chatConfig,
  id: 'active-ai',
  name: 'Active AI',
  apiKey: 'active-key',
};

const makeRepository = (id: number, fullName = `owner/repo-${id}`): Repository => {
  const [owner, name] = fullName.split('/');
  return {
    id,
    name,
    full_name: fullName,
    description: `Repository ${id}`,
    html_url: `https://github.com/${fullName}`,
    stargazers_count: 100 - id,
    forks_count: id,
    forks: id,
    language: 'TypeScript',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    pushed_at: '2026-09-01T00:00:00.000Z',
    owner: { login: owner, avatar_url: `https://avatars.example.com/${owner}` },
    topics: ['workbench'],
  };
};

const requirements: WorkbenchRequirements = {
  purpose: '寻找 TypeScript 工具',
  required: ['TypeScript'],
  preferred: ['维护活跃'],
  excluded: [],
  questions: [],
  queries: ['typescript cli', 'typescript automation', 'ts workflow', 'ts tooling', 'ts scripts', 'ts utilities'],
};

const session: RepositoryChatSession = {
  id: 'session-1',
  repoId: 0,
  repoFullName: '',
  sourceRefSha: '',
  title: 'Workbench',
  kind: 'workbench',
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
};

const makeProject = (repositories = [makeRepository(1)]): WorkbenchProject => ({
  id: 'private-project-id',
  ownerId: 'private-owner-id',
  name: 'Private project name',
  instructions: 'Prefer projects with a stable CLI.',
  conclusions: 'Saved conclusion: repository evidence still decides factual claims.',
  repositories,
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
});

const resetStore = (): void => {
  mocks.storeState = {
    user: { id: 7, login: 'fixture' },
    repositories: [],
    githubToken: 'github-token',
    language: 'zh',
    aiConfigs: [chatConfig, activeConfig],
    activeAIConfig: activeConfig.id,
    repositoryChatSettings: {
      enabled: true,
      chatConfigId: chatConfig.id,
      streamingMode: 'off',
      taskDepth: 'default',
      enableWebTools: false,
      retainSessionDays: 90,
      enableAgentToolLoop: false,
      maxToolsPerTurn: 20,
      agentBudget: {
        maxTurns: 4,
        maxToolCalls: 20,
        maxReadFiles: 8,
        maxCodeReads: 3,
        maxNoProgressRounds: 2,
        maxDurationMs: 90_000,
      },
    },
    addRepository: mocks.addRepository,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.aiConstructors.length = 0;
  resetStore();
  mocks.forceSyncToBackend.mockResolvedValue(undefined);
  mocks.getRepositoryMeta.mockResolvedValue({ defaultBranch: 'main' });
  mocks.getRepositoryHeadSha.mockResolvedValue('abcdef1234567890');
  mocks.getRepositoryReadme.mockResolvedValue('# README\nVerified capability.');
});

describe('workbenchRuntime', () => {
  it('enforces one global task and ignores late stages after stop', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let lateStage!: (stage: string) => void;
    let observedSignal!: AbortSignal;

    const running = workbenchRuntime.run('session-a', 'owner-a', async (signal, stage) => {
      observedSignal = signal;
      lateStage = stage;
      stage('searching');
      await pending;
      stage('too-late');
    });

    expect(workbenchRuntime.getSnapshot()).toMatchObject({ running: true, stage: 'searching' });
    await expect(workbenchRuntime.run('session-b', 'owner-b', async () => {})).rejects.toThrow(/already running/i);

    workbenchRuntime.stop();
    expect(observedSignal.aborted).toBe(true);
    lateStage('ignored');
    expect(workbenchRuntime.getSnapshot().stage).toBe('stopped');
    release();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(workbenchRuntime.getSnapshot()).toMatchObject({ running: false, stage: 'stopped' });
  });

  it('surfaces task errors and releases the lock', async () => {
    await expect(workbenchRuntime.run('session-error', 'owner', async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');

    expect(workbenchRuntime.getSnapshot()).toMatchObject({ running: false, stage: 'error', error: 'boom' });
  });
});

describe('prepareWorkbenchRequirements', () => {
  it('uses the configured chat model before the active model and accepts only strict JSON', async () => {
    mocks.generateChatText.mockResolvedValue(JSON.stringify(requirements));
    const project = makeProject();

    const result = await prepareWorkbenchRequirements({ question: '帮我找一个 TypeScript CLI', project });

    expect(result).toEqual(requirements);
    expect(mocks.aiConstructors[mocks.aiConstructors.length - 1]?.id).toBe(chatConfig.id);
    expect(mocks.generateChatText).toHaveBeenCalledOnce();
    const firstCall = mocks.generateChatText.mock.calls[0]?.[0] as { user: string };
    const payload = JSON.parse(firstCall.user) as { project: Record<string, unknown> };
    expect(Object.keys(payload.project).sort()).toEqual(['conclusions', 'instructions', 'repositories']);
    expect(payload.project).toEqual({
      instructions: project.instructions,
      conclusions: project.conclusions,
      repositories: project.repositories.map((repository) => repository.full_name),
    });
    expect(firstCall.user).not.toContain(project.id);
    expect(firstCall.user).not.toContain(project.ownerId);
    expect(firstCall.user).not.toContain(project.name);

    mocks.generateChatText.mockResolvedValue('```json\n{}\n```');
    await expect(prepareWorkbenchRequirements({ question: 'another query' })).rejects.toThrow(/invalid JSON/i);
  });
});

describe('searchWorkbench', () => {
  it('bounds GitHub searches, deduplicates repositories, and verifies only the depth budget', async () => {
    const repo1 = makeRepository(1);
    const repo2 = makeRepository(2);
    const repo3 = makeRepository(3);
    const repo4 = makeRepository(4);
    mocks.searchRepositories
      .mockResolvedValueOnce({ repos: [repo1, repo2, repo3], hasMore: true, nextPageIndex: 2 })
      .mockResolvedValueOnce({ repos: [repo2, repo4], hasMore: false, nextPageIndex: 2 });
    mocks.generateChatText.mockImplementation(async (options: { user: string }) => {
      const payload = JSON.parse(options.user) as { allowedSources: string[] };
      return JSON.stringify({
        relevant: true,
        summary: '适合当前需求，README 提供了直接证据。',
        reasons: ['README 与需求相符。'],
        limitations: [],
        sources: [payload.allowedSources[1]],
      });
    });
    const updates: WorkbenchSearchBatch[] = [];
    const onUpdate = vi.fn((batch: WorkbenchSearchBatch) => { updates.push(batch); });

    const result = await searchWorkbench({ requirements, depth: 'quick', onUpdate });

    expect(mocks.searchRepositories).toHaveBeenCalledTimes(2);
    expect(mocks.searchRepositories).toHaveBeenNthCalledWith(1, requirements.queries[0], 'All', 'All', 'BestMatch', 'Descending', 1, 20);
    expect(mocks.searchRepositories).toHaveBeenNthCalledWith(2, requirements.queries[1], 'All', 'All', 'BestMatch', 'Descending', 1, 20);
    expect(result.candidates.map((candidate) => candidate.repository.full_name)).toEqual([
      repo1.full_name,
      repo2.full_name,
      repo3.full_name,
      repo4.full_name,
    ]);
    expect(result.candidates.filter((candidate) => candidate.status === 'verified')).toHaveLength(3);
    expect(result.candidates[3].status).toBe('candidate');
    expect(mocks.getRepositoryReadme).toHaveBeenCalledTimes(3);
    expect(mocks.generateChatText).toHaveBeenCalledTimes(3);
    expect(result.candidates.slice(0, 3).every((candidate) => candidate.sources[0].endsWith('#readme'))).toBe(true);
    expect(onUpdate.mock.calls.length).toBeGreaterThan(2);
    const repo1Statuses = updates
      .map((batch) => batch.candidates.find((candidate) => candidate.repository.full_name === repo1.full_name)?.status)
      .filter(Boolean);
    expect(repo1Statuses.indexOf('verifying')).toBeGreaterThanOrEqual(0);
    expect(repo1Statuses.indexOf('verified')).toBeGreaterThan(repo1Statuses.indexOf('verifying'));
  });

  it.each([
    ['quick', 2, 3],
    ['standard', 4, 5],
    ['deep', 6, 8],
  ] as const)('uses the %s search budget (%i queries, %i README verifications)', async (depth, queryCount, verifyCount) => {
    const candidates = Array.from({ length: 8 }, (_, index) => makeRepository(index + 1));
    mocks.searchRepositories.mockImplementation(async () => ({
      repos: mocks.searchRepositories.mock.calls.length === 1 ? candidates : [],
      hasMore: false,
      nextPageIndex: 2,
    }));
    mocks.generateChatText.mockImplementation(async (options: { user: string }) => {
      const payload = JSON.parse(options.user) as { allowedSources: string[] };
      return JSON.stringify({
        relevant: true,
        summary: 'README 提供了可核验的直接证据。',
        reasons: ['README 与需求相符。'],
        limitations: [],
        sources: [payload.allowedSources[1]],
      });
    });

    await searchWorkbench({ requirements, depth: depth as WorkbenchDepth, onUpdate: vi.fn() });

    expect(mocks.searchRepositories).toHaveBeenCalledTimes(queryCount);
    expect(mocks.searchRepositories.mock.calls.every((call) => call[6] === 20)).toBe(true);
    expect(mocks.getRepositoryReadme).toHaveBeenCalledTimes(verifyCount);
    expect(mocks.generateChatText).toHaveBeenCalledTimes(verifyCount);
  });

  it('uses canonical GitHub provenance and treats a missing README as unknown', async () => {
    const repository = { ...makeRepository(1), html_url: 'https://mirror.example.invalid/owner/repo-1' };
    mocks.searchRepositories
      .mockResolvedValueOnce({ repos: [repository], hasMore: false, nextPageIndex: 2 })
      .mockResolvedValueOnce({ repos: [], hasMore: false, nextPageIndex: 2 });
    mocks.getRepositoryReadme.mockResolvedValue('');

    const result = await searchWorkbench({ requirements, depth: 'quick', onUpdate: vi.fn() });

    expect(result.candidates[0]).toMatchObject({
      status: 'insufficient',
      sources: ['https://github.com/owner/repo-1'],
    });
    expect(result.candidates[0].summary).toMatch(/未返回内容/);
    expect(result.candidates[0].limitations.join(' ')).toMatch(/原因未知/);
    expect(mocks.generateChatText).not.toHaveBeenCalled();
  });

  it('does not mark a repository verified unless the assessment cites README evidence', async () => {
    mocks.searchRepositories
      .mockResolvedValueOnce({ repos: [makeRepository(1)], hasMore: false, nextPageIndex: 2 })
      .mockResolvedValueOnce({ repos: [], hasMore: false, nextPageIndex: 2 });
    mocks.generateChatText.mockImplementation(async (options: { user: string }) => {
      const payload = JSON.parse(options.user) as { allowedSources: string[] };
      return JSON.stringify({
        relevant: true,
        summary: '仓库看起来适合当前需求。',
        reasons: ['只有仓库页来源。'],
        limitations: [],
        sources: [payload.allowedSources[0]],
      });
    });

    const result = await searchWorkbench({ requirements, depth: 'quick', onUpdate: vi.fn() });

    expect(result.candidates[0].status).toBe('insufficient');
    expect(result.candidates[0].limitations.join(' ')).toMatch(/without README evidence/i);
  });

  it('checks cancellation after an unabortable GitHub search returns', async () => {
    let release!: (value: unknown) => void;
    mocks.searchRepositories.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const controller = new AbortController();

    const pending = searchWorkbench({ requirements, depth: 'quick', signal: controller.signal, onUpdate: vi.fn() });
    controller.abort();
    release({ repos: [makeRepository(1)], hasMore: false, nextPageIndex: 2 });

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.getRepositoryReadme).not.toHaveBeenCalled();
    expect(mocks.generateChatText).not.toHaveBeenCalled();
  });
});

describe('answerWorkbench', () => {
  it('reuses the repository chat runner for one repository', async () => {
    const repository = makeRepository(1);
    const project = makeProject([repository, makeRepository(2)]);
    mocks.runRepositoryChatTurn.mockResolvedValue({ content: 'grounded answer', evidences: [] });

    const result = await answerWorkbench({
      question: 'How does it work?',
      repositories: [repository],
      project,
      session,
      messages: [],
      depth: 'standard',
    });

    expect(result.content).toBe('grounded answer');
    expect(mocks.runRepositoryChatTurn).toHaveBeenCalledWith(expect.objectContaining({
      repository,
      session: expect.objectContaining({
        repoId: repository.id,
        repoFullName: repository.full_name,
        sourceRefSha: 'abcdef1234567890',
      }),
      taskDepth: 'default',
      githubToken: 'github-token',
      aiConfig: chatConfig,
    }));
    expect(mocks.getRepositoryMeta).toHaveBeenCalledWith('owner', 'repo-1', undefined);
    expect(mocks.getRepositoryHeadSha).toHaveBeenCalledWith('owner', 'repo-1', 'main', undefined);
    const runnerInput = mocks.runRepositoryChatTurn.mock.calls[0]?.[0] as { question: string };
    expect(runnerInput.question).toContain(project.instructions);
    expect(runnerInput.question).toContain(project.conclusions);
    expect(runnerInput.question).toContain(project.repositories[1].full_name);
    expect(runnerInput.question).not.toContain(project.id);
    expect(runnerInput.question).not.toContain(project.ownerId);
    expect(runnerInput.question).not.toContain(project.name);
  });

  it('bounds multi-repository README evidence and appends exact source links', async () => {
    const repositories = [makeRepository(1), makeRepository(2), makeRepository(3)];
    mocks.generateChatText.mockResolvedValue(`比较结果见 [repo-1](${repositories[0].html_url}#readme)。`);

    const result = await answerWorkbench({
      question: '比较它们',
      repositories,
      session,
      messages: [],
      depth: 'quick',
    });

    expect(mocks.runRepositoryChatTurn).not.toHaveBeenCalled();
    expect(mocks.getRepositoryReadme).toHaveBeenCalledTimes(2);
    expect(result.evidences).toHaveLength(2);
    expect(result.content).toContain(`[${repositories[0].full_name}](${repositories[0].html_url}#readme)`);
    expect(result.content).toContain(`[${repositories[1].full_name}](${repositories[1].html_url}#readme)`);
  });

  it('rejects multi-repository answers that invent a source URL', async () => {
    mocks.generateChatText.mockResolvedValue('错误来源 https://example.com/invented');

    await expect(answerWorkbench({
      question: '比较它们',
      repositories: [makeRepository(1), makeRepository(2)],
      session,
      messages: [],
      depth: 'quick',
    })).rejects.toThrow(/unsupported source/i);
  });

  it('does not publish streamed multi-repository text before source validation', async () => {
    (mocks.storeState.repositoryChatSettings as { streamingMode: string }).streamingMode = 'auto';
    const invented = '错误来源 https://example.com/invented';
    mocks.generateChatTextStream.mockImplementation(async (options: { onChunk: (delta: string) => void }) => {
      options.onChunk(invented);
      return invented;
    });
    const onChunk = vi.fn();

    await expect(answerWorkbench({
      question: '比较它们',
      repositories: [makeRepository(1), makeRepository(2)],
      session,
      messages: [],
      depth: 'quick',
      onChunk,
    })).rejects.toThrow(/unsupported source/i);

    expect(onChunk).not.toHaveBeenCalled();
  });
});

describe('starWorkbenchRepository', () => {
  it('stars explicitly, updates local state, and reports backend sync failure distinctly', async () => {
    const repository = makeRepository(1, 'owner/tool');
    mocks.starRepository.mockResolvedValue(undefined);
    mocks.forceSyncToBackend.mockRejectedValue(new Error('sync unavailable'));

    const promise = starWorkbenchRepository(repository);
    await expect(promise).rejects.toBeInstanceOf(WorkbenchStarSyncError);
    await expect(promise).rejects.toMatchObject({ githubStarred: true });
    expect(mocks.starRepository).toHaveBeenCalledWith('owner', 'tool');
    expect(mocks.addRepository).toHaveBeenCalledWith(expect.objectContaining({
      full_name: repository.full_name,
      starred_at: expect.any(String),
    }));
    expect(mocks.forceSyncToBackend).toHaveBeenCalledWith({ reportFailures: true });
  });

  it('does not mutate local state when the GitHub star fails', async () => {
    mocks.starRepository.mockRejectedValue(new Error('GitHub denied the request'));

    await expect(starWorkbenchRepository(makeRepository(1))).rejects.toThrow('GitHub denied the request');
    expect(mocks.addRepository).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
  });
});
