import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig, Repository } from '../types';
import type { WorkbenchDepth, WorkbenchProject, WorkbenchRequirements, WorkbenchSearchBatch } from '../types/aiWorkbench';
import type { RepositoryChatSession } from '../types/repositoryChat';
import type { RepositoryChatTurnInput } from './repositoryChatService';

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
  researchLocalProject: vi.fn(),
}));
vi.mock('./localResearch', () => ({ researchLocalProject: mocks.researchLocalProject }));

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
  answerWorkbenchOverview,
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

const agyConfig: AIConfig = {
  id: 'agy-ai', name: 'AGY', provider: 'agy-cli', model: 'fixture-model',
  isActive: true, agyEffort: 'high', agyMode: 'research', deviceBound: true,
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
  vi.resetAllMocks();
  vi.stubGlobal('electronAPI', undefined);
  mocks.aiConstructors.length = 0;
  resetStore();
  mocks.forceSyncToBackend.mockResolvedValue(undefined);
  mocks.getRepositoryMeta.mockResolvedValue({ defaultBranch: 'main' });
  mocks.getRepositoryHeadSha.mockResolvedValue('abcdef1234567890');
  mocks.getRepositoryReadme.mockResolvedValue('# README\nVerified capability.');
  mocks.runRepositoryChatTurn.mockImplementation(async (input: { repository: Repository; session: RepositoryChatSession }) => ({
    content: `Research for ${input.repository.full_name}`,
    evidences: [{
      id: `evidence-${input.repository.id}`,
      source: 'github',
      repoFullName: input.repository.full_name,
      refSha: input.session.sourceRefSha,
      path: 'src/index.ts',
      url: `${input.repository.html_url}/blob/${input.session.sourceRefSha}/src/index.ts#L1-L10`,
      excerpt: `Implementation evidence for ${input.repository.full_name}`,
      retrievedAt: '2026-09-28T00:00:00.000Z',
    }],
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const assessRelevant = async (options: { user: string }): Promise<string> => {
  const payload = JSON.parse(options.user) as { allowedSources: string[] };
  return JSON.stringify({
    relevant: true,
    summary: 'Matches the requested capability.',
    reasons: ['Documented in the README.'],
    limitations: [],
    sources: [payload.allowedSources[1]],
  });
};

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
  it.each(['missing', 'empty-key', 'decrypt-failed', 'disabled-cli', 'unbound-cli', 'no-cli-bridge'])(
    'rejects the explicitly selected %s config without falling back to the active model',
    async (scenario) => {
      mocks.storeState.language = 'en';
      let selected: AIConfig | undefined;
      if (scenario === 'empty-key') selected = { ...chatConfig, apiKey: '' };
      if (scenario === 'decrypt-failed') selected = { ...chatConfig, apiKeyStatus: 'decrypt_failed' };
      if (scenario.endsWith('cli') || scenario === 'no-cli-bridge') {
        selected = {
          ...agyConfig,
          id: chatConfig.id,
          isActive: scenario !== 'disabled-cli',
          deviceBound: scenario !== 'unbound-cli',
        };
        if (scenario !== 'no-cli-bridge') vi.stubGlobal('electronAPI', { agy: {} });
      }
      mocks.storeState.aiConfigs = selected ? [selected, activeConfig] : [activeConfig];

      await expect(prepareWorkbenchRequirements({ question: 'Find a CLI' })).rejects.toThrow(/selected AI configuration is unavailable/);
      await expect(answerWorkbench({
        question: 'Explain implementation', repositories: [makeRepository(1), makeRepository(2)],
        session, messages: [], depth: 'quick',
      })).rejects.toThrow(/selected AI configuration is unavailable/);

      expect(mocks.aiConstructors).toEqual([]);
      expect(mocks.generateChatText).not.toHaveBeenCalled();
      expect(mocks.runRepositoryChatTurn).not.toHaveBeenCalled();
      expect(mocks.getRepositoryHeadSha).not.toHaveBeenCalled();
    },
  );

  it('uses the available active config when no chat config was explicitly chosen', async () => {
    (mocks.storeState.repositoryChatSettings as { chatConfigId: string | null }).chatConfigId = null;
    mocks.generateChatText.mockResolvedValue(JSON.stringify(requirements));

    await prepareWorkbenchRequirements({ question: 'Find a CLI' });

    expect(mocks.aiConstructors).toEqual([activeConfig]);
  });

  it.each([
    ['en', 'English'],
    ['fr', 'French'],
    ['ja', 'Japanese'],
  ])('requests requirements in the configured %s output language', async (language, expected) => {
    mocks.storeState.language = language;
    mocks.generateChatText.mockResolvedValue(JSON.stringify(requirements));

    await prepareWorkbenchRequirements({ question: 'Find a CLI.' });

    expect(mocks.generateChatText.mock.calls[0][0].system).toContain(expected);
  });

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

  it('summarizes every result in overview mode and keeps earlier page introductions', async () => {
    mocks.searchRepositories.mockResolvedValue({ repos: [makeRepository(1), makeRepository(2)] });
    mocks.getRepositoryReadme.mockResolvedValue('A scientific Markdown editor for local research notes.');
    mocks.generateChatText.mockImplementation(async (options: { user: string }) => {
      const { projects } = JSON.parse(options.user);
      return JSON.stringify({ summary: 'Research note tools', items: projects.map((item: { name: string }) => ({
        name: item.name, summary: 'A local editor', category: 'Notes', categoryDescription: 'Reading notes', kind: 'tool', insufficient: false,
      })) });
    });
    const first = await searchWorkbench({ requirements, depth: 'quick', overview: true, onUpdate: vi.fn() });
    expect(first.candidates.every(item => item.overview?.status === 'ready')).toBe(true);
    mocks.searchRepositories.mockResolvedValue({ repos: [makeRepository(2), makeRepository(3)] });
    const second = await searchWorkbench({ requirements, depth: 'quick', overview: true, previous: first, page: 2, onUpdate: vi.fn() });
    expect(second.id).toBe(first.id);
    expect(second.candidates.map(item => item.repository.id)).toEqual([1, 2, 3]);
    expect(JSON.parse(mocks.generateChatText.mock.calls[mocks.generateChatText.mock.calls.length - 1][0].user).projects).toHaveLength(1);
    expect(mocks.runRepositoryChatTurn).not.toHaveBeenCalled();
  });

  it('answers overview questions from supplied facts without requiring a GitHub token', async () => {
    mocks.storeState.githubToken = '';
    mocks.generateChatText.mockResolvedValue('The supplied project is a note editor. Cloud sync is unknown.');
    const result = await answerWorkbenchOverview({ question: 'What is this?', candidates: [{ repository: makeRepository(1), summary: 'Note editor',
      reasons: [], limitations: [], sources: [], status: 'candidate' }], messages: [] });
    expect(result.quality).toBe('unreviewed');
    expect(mocks.getRepositoryReadme).not.toHaveBeenCalled();
    expect(mocks.runRepositoryChatTurn).not.toHaveBeenCalled();
  });
});

describe('searchWorkbench', () => {
  it('interleaves ranked candidates so later queries are verified before the first query exhausts the budget', async () => {
    mocks.searchRepositories
      .mockResolvedValueOnce({ repos: Array.from({ length: 20 }, (_, index) => makeRepository(index + 1)) })
      .mockResolvedValueOnce({ repos: Array.from({ length: 20 }, (_, index) => makeRepository(index + 21)) });
    mocks.generateChatText.mockImplementation(assessRelevant);

    const result = await searchWorkbench({ requirements, depth: 'quick', onUpdate: vi.fn() });

    expect(result.candidates.filter((candidate) => candidate.status === 'verified')
      .map((candidate) => candidate.repository.id)).toEqual([1, 21, 2]);
    expect(result.candidates.slice(0, 6).map((candidate) => candidate.repository.id)).toEqual([1, 21, 2, 22, 3, 23]);
  });

  it('does not let duplicate hits consume another query contribution', async () => {
    mocks.searchRepositories
      .mockResolvedValueOnce({ repos: [makeRepository(1), makeRepository(2), makeRepository(3)] })
      .mockResolvedValueOnce({ repos: [makeRepository(1, 'OWNER/REPO-1'), makeRepository(4)] });
    mocks.generateChatText.mockImplementation(assessRelevant);
    const updates: WorkbenchSearchBatch[] = [];

    const result = await searchWorkbench({ requirements, depth: 'quick', onUpdate: (batch) => { updates.push(batch); } });

    expect(result.candidates.map((candidate) => candidate.repository.id)).toEqual([1, 4, 2, 3]);
    expect(updates[1].candidates[0].reasons).toHaveLength(2);
    expect(result.candidates.filter((candidate) => candidate.status === 'verified')
      .map((candidate) => candidate.repository.id)).toEqual([1, 4, 2]);
  });

  it('replaces missing README, irrelevant, and malformed assessments until the verified target is filled', async () => {
    mocks.searchRepositories.mockResolvedValue({ repos: Array.from({ length: 10 }, (_, index) => makeRepository(index + 1)) });
    mocks.getRepositoryReadme.mockResolvedValueOnce('');
    mocks.generateChatText
      .mockImplementationOnce(async (options: { user: string }) => JSON.stringify({
        ...JSON.parse(await assessRelevant(options)),
        relevant: false,
      }))
      .mockResolvedValueOnce('not JSON')
      .mockImplementation(assessRelevant);

    const result = await searchWorkbench({ requirements, depth: 'quick', onUpdate: vi.fn() });

    expect(result.candidates.filter((candidate) => candidate.status === 'insufficient')).toHaveLength(3);
    expect(result.candidates.filter((candidate) => candidate.status === 'verified')).toHaveLength(3);
    expect(result.candidates.filter((candidate) => candidate.status === 'candidate')).toHaveLength(4);
    expect(mocks.getRepositoryReadme).toHaveBeenCalledTimes(6);
  });

  it('bounds replacement attempts when every candidate fails verification', async () => {
    mocks.searchRepositories.mockResolvedValue({ repos: Array.from({ length: 20 }, (_, index) => makeRepository(index + 1)) });
    mocks.getRepositoryReadme.mockRejectedValue(new Error('README unavailable'));

    const result = await searchWorkbench({ requirements, depth: 'quick', onUpdate: vi.fn() });

    expect(mocks.getRepositoryReadme).toHaveBeenCalledTimes(6);
    expect(mocks.generateChatText).not.toHaveBeenCalled();
    expect(result.candidates.filter((candidate) => candidate.status === 'insufficient')).toHaveLength(6);
    expect(result.candidates.filter((candidate) => candidate.status === 'candidate')).toHaveLength(14);
  });

  it.each([
    ['en', 'English', 'Supports the requested CLI.'],
    ['de', 'German', 'Unterstuetzt die angefragte CLI.'],
    ['ja', 'Japanese', 'このCLIをサポートします。'],
  ])('accepts a verified %s summary without a Chinese-character gate', async (language, directive, summary) => {
    mocks.storeState.language = language;
    mocks.searchRepositories.mockResolvedValue({ repos: [makeRepository(1)] });
    mocks.generateChatText.mockImplementation(async (options: { user: string }) => JSON.stringify({
      ...JSON.parse(await assessRelevant(options)),
      summary,
    }));

    const result = await searchWorkbench({ requirements, depth: 'quick', onUpdate: vi.fn() });

    expect(result.candidates[0]).toMatchObject({ status: 'verified', summary });
    expect(mocks.generateChatText.mock.calls[0][0].system).toContain(directive);
    expect(mocks.generateChatText.mock.calls[0][0].system).not.toContain('使用简体中文');
  });

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
  it('resumes same-version completed repositories and researches only the previously failed repository', async () => {
    localStorage.clear();
    const normal = mocks.runRepositoryChatTurn.getMockImplementation()!;
    mocks.runRepositoryChatTurn.mockImplementationOnce(normal).mockRejectedValueOnce(new Error('temporary'));
    mocks.generateChatText.mockResolvedValue('Comparison');
    const input = { question: 'Compare resume fixture', repositories: [makeRepository(1), makeRepository(2)], session, messages: [], depth: 'quick' as const };
    await answerWorkbench(input);
    mocks.runRepositoryChatTurn.mockClear();
    const result = await answerWorkbench({ ...input, resumeResearch: true });
    expect(mocks.runRepositoryChatTurn).toHaveBeenCalledOnce();
    expect(mocks.runRepositoryChatTurn.mock.calls[0][0].repository.id).toBe(2);
    expect(result.researchSources?.map(item => item.status)).toEqual(['reused', 'complete']);
    localStorage.clear();
  });
  it('does not reuse a repository after its pinned SHA changes', async () => {
    localStorage.clear();
    mocks.generateChatText.mockResolvedValue('Comparison');
    const input = { question: 'Compare changed fixture', repositories: [makeRepository(1), makeRepository(2)], session, messages: [], depth: 'quick' as const };
    await answerWorkbench(input);
    mocks.runRepositoryChatTurn.mockClear();
    mocks.getRepositoryHeadSha.mockResolvedValue('new-sha');
    const result = await answerWorkbench({ ...input, resumeResearch: true });
    expect(mocks.runRepositoryChatTurn).toHaveBeenCalledTimes(2);
    expect(result.researchSources?.every(item => item.status === 'changed')).toBe(true);
    localStorage.clear();
  });
  it('researches a local project and selected GitHub repository before synthesizing both', async () => {
    mocks.generateChatText.mockResolvedValue('Mixed answer');
    mocks.researchLocalProject.mockResolvedValue({ content: 'Local evidence', evidences: [{
      id: 'local-e', source: 'local', repoFullName: 'local/Fixture', path: 'README.md', url: 'local-evidence:fixture',
      excerpt: 'Local evidence', contentHash: 'hash', retrievedAt: '',
    }] });
    const result = await answerWorkbench({ question: 'Compare sources', repositories: [makeRepository(1)], session,
      messages: [], depth: 'quick', localProject: { id: 'grant', identity: 'local-hash', name: 'Fixture', entries: [], truncated: false } });
    expect(mocks.researchLocalProject).toHaveBeenCalledOnce();
    expect(mocks.runRepositoryChatTurn).toHaveBeenCalledOnce();
    expect(result.researchSources?.map(item => item.repository)).toEqual(['owner/repo-1', 'local/Fixture']);
    expect(result.content).not.toContain('](local-evidence:');
  });
  it('reviews the final comparison against the original question and returns persisted review metadata', async () => {
    const answer = 'Repository one has implementation evidence.';
    const review = {
      answer, claims: [{ text: answer, evidenceId: 'evidence-1', quote: 'Implementation evidence for owner/repo-1' }],
      coverage: [{ requirement: 'Compare purposes', status: 'answered', answerExcerpt: answer }], missing: [],
    };
    mocks.generateChatText.mockResolvedValueOnce('Draft comparison').mockResolvedValueOnce(JSON.stringify(review));
    const events: string[] = [];
    const result = await answerWorkbench({ question: 'Compare purposes', repositories: [makeRepository(1), makeRepository(2)],
      session, messages: [], depth: 'quick', onAnswerEvent: event => events.push(event.phase) });
    expect(result).toMatchObject({ quality: 'model-reviewed', claims: review.claims, coverage: review.coverage });
    expect(result.content).toContain(answer);
    expect(events).toEqual(['reviewing', 'final']);
    expect(JSON.parse(mocks.generateChatText.mock.calls[1][0].user).question).toBe('Compare purposes');
  });

  it.each(['invalid JSON', JSON.stringify({ answer: 'Fabrication', claims: [], coverage: [], missing: [] })])(
    'keeps the draft explicitly unreviewed when comparison review fails: %s', async raw => {
      mocks.generateChatText.mockResolvedValueOnce('Original comparison').mockResolvedValueOnce(raw);
      const result = await answerWorkbench({ question: 'Compare', repositories: [makeRepository(1), makeRepository(2)],
        session, messages: [], depth: 'quick' });
      expect(result.quality).toBe('unreviewed');
      expect(result.content).toContain('Original comparison');
      expect(result.claims).toEqual([]);
    },
  );

  const locales = [
    ['zh', '研究覆盖', '待研究批次', '研究时间预算已用尽', '汇总时间预算已用尽', '本轮未获得仓库证据', '来源', '已移除无法核验的引用'],
    ['en', 'Research coverage', 'Pending batch', 'Research deadline reached', 'Synthesis deadline reached', 'No repository evidence', 'Sources', 'Unverified citations were removed'],
    ['zh-TW', '研究涵蓋', '待研究批次', '研究時間預算已用盡', '彙整時間預算已用盡', '本輪未取得儲存庫證據', '來源', '已移除無法核驗的引用'],
    ['fr', 'Couverture de recherche', 'Lot en attente', 'Délai de recherche atteint', 'Délai de synthèse atteint', 'Aucune preuve du dépôt', 'Sources', 'Les citations non vérifiables'],
    ['de', 'Rechercheabdeckung', 'Ausstehende Gruppe', 'Recherchezeitlimit erreicht', 'Zeitlimit für die Zusammenfassung', 'keine Repository-Belege', 'Quellen', 'Nicht überprüfbare Quellenangaben'],
    ['es', 'Cobertura de investigación', 'Lote pendiente', 'Plazo de investigación agotado', 'Plazo de síntesis agotado', 'No se obtuvieron pruebas', 'Fuentes', 'Se eliminaron las citas'],
    ['pt-BR', 'Cobertura da pesquisa', 'Lote pendente', 'Prazo da pesquisa esgotado', 'Prazo da síntese esgotado', 'Nenhuma evidência', 'Fontes', 'Citações não verificáveis'],
    ['ru', 'Охват исследования', 'Ожидающая группа', 'Время исследования истекло', 'Время на обобщение истекло', 'не получено подтверждающих данных', 'Источники', 'Непроверяемые ссылки удалены'],
    ['ja', '調査範囲', '未調査バッチ', '調査の制限時間に到達', '統合の制限時間に到達', 'リポジトリの根拠を取得できませんでした', '出典', '検証できない引用を削除'],
    ['ko', '조사 범위', '대기 중인 묶음', '조사 시간 한도에 도달', '종합 시간 한도에 도달', '저장소 근거를 가져오지 못했습니다', '출처', '검증할 수 없는 인용을 제거'],
  ] as const;

  it.each(locales)('returns localized coverage, gaps, sources and synthesis timeout in %s', async (
    language, coverage, _pending, _researchTimeout, synthesisTimeout, noEvidence, sources, citationsRemoved,
  ) => {
    vi.useFakeTimers();
    mocks.storeState.language = language;
    const research = mocks.runRepositoryChatTurn.getMockImplementation()!;
    mocks.runRepositoryChatTurn
      .mockImplementationOnce(async (input: RepositoryChatTurnInput) => ({
        ...await research(input),
        content: 'OK.\n\nUnsupported https://invalid.example/unknown',
      }))
      .mockResolvedValueOnce({ content: 'OK.', evidences: [] });
    mocks.generateChatText.mockImplementation(() => new Promise(() => {}));

    const pending = answerWorkbench({
      question: 'Compare', repositories: [makeRepository(1), makeRepository(2)],
      session, messages: [], depth: 'quick',
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;

    expect(result.content).toContain(coverage);
    expect(result.content).toContain('2/2');
    expect(result.content).toContain(noEvidence);
    expect(result.content).toContain(synthesisTimeout);
    expect(result.content).toContain(citationsRemoved);
    expect(result.content).toContain(`\n\n${sources}:\n`);
    expect(result.content).not.toContain('invalid.example');
    if (language !== 'en') {
      expect(result.content).not.toContain('Research coverage');
      expect(result.content).not.toContain('Synthesis deadline reached');
      expect(result.content).not.toContain('No repository evidence retrieved');
      expect(result.content).not.toContain('Unverified citations were removed');
    }
  });

  it.each(locales)('returns localized pending batches and research timeouts in %s', async (
    language, coverage, pendingBatch, researchTimeout,
  ) => {
    vi.useFakeTimers();
    mocks.storeState.language = language;
    mocks.runRepositoryChatTurn.mockImplementation(() => new Promise(() => {}));
    mocks.generateChatText.mockResolvedValue('');

    const pending = answerWorkbench({
      question: 'Compare', repositories: Array.from({ length: 5 }, (_, index) => makeRepository(index + 1)),
      session, messages: [], depth: 'quick',
    });
    await vi.advanceTimersByTimeAsync(45_000);
    const result = await pending;

    expect(result.content).toContain(coverage);
    expect(result.content).toContain('0/5');
    expect(result.content).toContain(pendingBatch);
    expect(result.content).toContain(researchTimeout);
    expect(result.content).toContain('owner/repo-3, owner/repo-4');
    expect(result.content).toContain('owner/repo-5');
    if (language !== 'en') {
      expect(result.content).not.toContain('Pending batch');
      expect(result.content).not.toContain('Research deadline reached');
      expect(result.content).not.toContain('completed: none');
    }
  });

  it('retains valid fallback sections and resolves identical relative citations within each pinned repository', async () => {
    vi.useFakeTimers();
    mocks.storeState.language = 'en';
    mocks.getRepositoryHeadSha.mockImplementation(async (_owner: string, name: string) => `sha-${name}`);
    mocks.runRepositoryChatTurn.mockImplementation(async (input: RepositoryChatTurnInput) => ({
      content: [
        `Supported ${input.repository.name}. \`/README.md - 2-3\``,
        'Usage [readme](./README.md#L4-L5).',
        'Details [details][source].',
        'Shortcut [source].',
        'Unknown [missing](https://invalid.example/unsupported).',
        'Unread range `/README.md - 20-30`.',
        'Wrong commit [old](https://github.com/owner/repo-1/blob/old-sha/README.md#L1-L10).',
        '[source]: README.md#L6-L7',
      ].join('\n\n'),
      evidences: [{
        id: `evidence-${input.repository.id}`, source: 'github',
        repoFullName: input.repository.full_name, refSha: input.session.sourceRefSha,
        path: 'README.md', lineStart: 1, lineEnd: 10,
        url: `${input.repository.html_url}/blob/${input.session.sourceRefSha}/README.md#L1-L10`,
        excerpt: 'Supported feature.', retrievedAt: '2026-09-28T00:00:00.000Z',
      }],
    }));
    mocks.generateChatText.mockImplementation(() => new Promise(() => {}));
    const pending = answerWorkbench({
      question: 'Compare', repositories: [makeRepository(1), makeRepository(2)],
      session, messages: [], depth: 'quick',
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;
    const payload = JSON.parse(mocks.generateChatText.mock.calls[0][0].user);

    for (const [index, repo] of ['repo-1', 'repo-2'].entries()) {
      const url = `https://github.com/owner/${repo}/blob/sha-${repo}/README.md#L1-L10`;
      expect(result.content).toContain(`Supported ${repo}. [/README.md - 2-3](${url})`);
      expect(payload.research[index].content).toContain(`[readme](${url})`);
      expect(payload.research[index].content).toContain(`[details](${url})`);
      expect(payload.research[index].content).toContain(`[source](${url})`);
      expect(payload.research[index].content).not.toContain(index === 0 ? '/repo-2/' : '/repo-1/');
    }
    expect(result.evidences).toHaveLength(2);
    expect(result.content).not.toContain('invalid.example');
    expect(result.content).not.toContain('old-sha');
    expect(result.content).not.toContain('Unknown');
    expect(result.content).not.toContain('Unread range');
    expect(result.content).not.toContain('[source]:');
    expect(result.missing).toEqual(expect.arrayContaining([
      'owner/repo-1: Unverified citations were removed; the remaining research is retained.',
      'owner/repo-2: Unverified citations were removed; the remaining research is retained.',
    ]));
  });

  it('retains valid bare source URLs with punctuation and repository-scoped release evidence in fallback', async () => {
    vi.useFakeTimers();
    const releaseUrl = 'https://github.com/owner/repo-1/releases/tag/v1.0.0';
    mocks.runRepositoryChatTurn.mockResolvedValueOnce({
      content: `Release changes \`/release-v1.0.0.md - 2-3\`.\n\nSource: ${releaseUrl}.`,
      evidences: [{
        id: 'release-1', source: 'github', repoFullName: 'owner/repo-1',
        path: 'release-v1.0.0.md', lineStart: 1, lineEnd: 10,
        url: releaseUrl, excerpt: 'Release notes.', retrievedAt: '2026-09-28T00:00:00.000Z',
      }],
    });
    mocks.generateChatText.mockImplementation(() => new Promise(() => {}));
    const pending = answerWorkbench({
      question: 'Compare releases', repositories: [makeRepository(1), makeRepository(2)],
      session, messages: [], depth: 'quick',
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;

    expect(result.content).toContain(`Release changes [/release-v1.0.0.md - 2-3](${releaseUrl})`);
    expect(result.content).toContain(`Source: [owner/repo-1](${releaseUrl}).`);
    expect(result.evidences).toHaveLength(2);
    expect(result.missing).toHaveLength(1);
  });

  it('deduplicates case-insensitive repository inputs before budgeting and aggregating evidence', async () => {
    const first = makeRepository(1);
    mocks.generateChatText.mockResolvedValue('Comparison');

    const result = await answerWorkbench({
      question: 'Compare', repositories: [first, makeRepository(2), first, makeRepository(9, 'OWNER/REPO-1')],
      session, messages: [], depth: 'quick',
    });

    expect(mocks.getRepositoryHeadSha).toHaveBeenCalledTimes(2);
    expect(mocks.runRepositoryChatTurn).toHaveBeenCalledTimes(2);
    expect(result.evidences).toHaveLength(2);
    const payload = JSON.parse(mocks.generateChatText.mock.calls[0][0].user);
    expect(payload.coverage.requested).toEqual(['owner/repo-1', 'owner/repo-2']);
    expect(payload.coverage.completed).toHaveLength(2);
  });

  it('uses the single-repository path when all selections identify the same repository', async () => {
    await answerWorkbench({
      question: 'Explain', repositories: [makeRepository(1), makeRepository(1), makeRepository(9, 'OWNER/REPO-1')],
      session, messages: [], depth: 'quick',
    });

    expect(mocks.runRepositoryChatTurn).toHaveBeenCalledOnce();
    expect(mocks.getRepositoryHeadSha).toHaveBeenCalledOnce();
    expect(mocks.generateChatText).not.toHaveBeenCalled();
  });

  it('reallocates unused time after nonzero pinning and research latency and passes effective depth budgets', async () => {
    vi.useFakeTimers();
    mocks.storeState.language = 'en';
    const research = mocks.runRepositoryChatTurn.getMockImplementation()!;
    mocks.getRepositoryHeadSha.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return 'pinned-sha';
    });
    mocks.runRepositoryChatTurn.mockImplementation(async (input: RepositoryChatTurnInput) => {
      await new Promise((resolve) => setTimeout(resolve, input.repository.id === 1 ? 5_000 : 25_000));
      return research(input);
    });
    mocks.generateChatText.mockResolvedValue('Completed comparison');
    const pending = answerWorkbench({
      question: 'Compare', repositories: [makeRepository(1), makeRepository(2)],
      session, messages: [], depth: 'quick',
    });

    await vi.advanceTimersByTimeAsync(39_000);
    const result = await pending;

    expect(result.missing).toEqual([]);
    expect(result.evidences).toHaveLength(2);
    const inputs = mocks.runRepositoryChatTurn.mock.calls.map(([input]) => input as RepositoryChatTurnInput);
    expect(inputs.map((input) => input.taskDepth)).toEqual(['default', 'default']);
    expect(inputs.map((input) => input.agentBudget?.maxDurationMs)).toEqual([16_000, 27_000]);
    expect(inputs.every(input => input.evidenceOnly)).toBe(true);
    expect(inputs.every((input) => input.agentBudget?.maxToolCalls === 8 && input.agentBudget?.maxTurns === 2)).toBe(true);
    expect(inputs.every((input) => !input.signal?.aborted)).toBe(true);
  });

  it.each([
    [15_000, 11_250],
    [40_000, 15_000],
  ])('starts research with a %ims total budget despite pinning and synthesis overhead', async (totalMs, initialShareMs) => {
    vi.useFakeTimers();
    mocks.storeState.language = 'en';
    (mocks.storeState.repositoryChatSettings as { agentBudget: { maxDurationMs: number } }).agentBudget.maxDurationMs = totalMs;
    const research = mocks.runRepositoryChatTurn.getMockImplementation()!;
    const startedAt = Date.now();
    const starts: number[] = [];
    mocks.getRepositoryMeta.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { defaultBranch: 'main' };
    });
    mocks.getRepositoryHeadSha.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return 'pinned-sha';
    });
    mocks.runRepositoryChatTurn.mockImplementation(async (input: RepositoryChatTurnInput) => {
      starts.push(Date.now() - startedAt);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return research(input);
    });
    mocks.generateChatText.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return 'Completed comparison';
    });
    const pending = answerWorkbench({
      question: 'Compare', repositories: [makeRepository(1), makeRepository(2)],
      session, messages: [], depth: 'standard',
    });

    await vi.advanceTimersByTimeAsync(4_500);
    const result = await pending;

    expect(starts).toEqual([750, 2_500]);
    expect(initialShareMs - starts[0]).toBeLessThan(15_000);
    expect(mocks.runRepositoryChatTurn).toHaveBeenCalledTimes(2);
    expect(result.evidences).toHaveLength(2);
    expect(result.missing).toEqual([]);
    expect(result.content).toContain('Research coverage: 2/2');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the minimum total deadline authoritative when the runner and synthesis ignore cancellation', async () => {
    vi.useFakeTimers();
    mocks.storeState.language = 'en';
    (mocks.storeState.repositoryChatSettings as { agentBudget: { maxDurationMs: number } }).agentBudget.maxDurationMs = 15_000;
    mocks.getRepositoryHeadSha.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return 'pinned-sha';
    });
    mocks.runRepositoryChatTurn.mockImplementation(() => new Promise(() => {}));
    mocks.generateChatText.mockImplementation(() => new Promise(() => {}));
    const onChunk = vi.fn();
    const pending = answerWorkbench({
      question: 'Compare', repositories: [makeRepository(1), makeRepository(2)],
      session, messages: [], depth: 'standard', onChunk,
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.runRepositoryChatTurn).toHaveBeenCalledOnce();
    const runnerSignal = mocks.runRepositoryChatTurn.mock.calls[0][0].signal as AbortSignal;
    await vi.advanceTimersByTimeAsync(10_750);
    expect(runnerSignal.aborted).toBe(true);
    expect(mocks.generateChatText).toHaveBeenCalledOnce();
    expect(onChunk).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_750);
    const result = await pending;

    expect(mocks.generateChatText.mock.calls[0][0].signal.aborted).toBe(true);
    expect(result.missing?.join('\n')).toContain('owner/repo-1: Research deadline reached');
    expect(result.missing?.join('\n')).toContain('Pending batch 1 (total research deadline reached): owner/repo-2');
    expect(result.missing?.join('\n')).toContain('Synthesis deadline reached');
    expect(onChunk).toHaveBeenCalledExactlyOnceWith(result.content);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives slow medium-effort CLI research fair shares and reallocates unused time', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('electronAPI', { agy: {} });
    mocks.storeState.aiConfigs = [{ ...agyConfig, agyEffort: 'medium', concurrency: 1 }];
    (mocks.storeState.repositoryChatSettings as { chatConfigId: string }).chatConfigId = agyConfig.id;
    (mocks.storeState.repositoryChatSettings as { agentBudget: { maxDurationMs: number } }).agentBudget.maxDurationMs = 300_000;
    const research = mocks.runRepositoryChatTurn.getMockImplementation()!;
    mocks.runRepositoryChatTurn.mockImplementation(async (input: RepositoryChatTurnInput) => {
      await new Promise((resolve) => setTimeout(resolve, input.repository.id === 1 ? 60_000 : 100_000));
      return research(input);
    });
    mocks.generateChatText.mockResolvedValue('Completed comparison');
    const pending = answerWorkbench({
      question: 'Compare', repositories: [makeRepository(1), makeRepository(2)],
      session, messages: [], depth: 'standard',
    });

    await vi.advanceTimersByTimeAsync(190_000);
    const result = await pending;

    expect(result.evidences).toHaveLength(2);
    expect(result.missing).toEqual([]);
    const inputs = mocks.runRepositoryChatTurn.mock.calls.map(([input]) => input as RepositoryChatTurnInput);
    expect(inputs.map((input) => input.agentBudget?.maxDurationMs)).toEqual([90_000, 120_000]);
    expect(inputs.every((input) => !input.signal?.aborted)).toBe(true);
  });

  it('preserves the second CLI repository time share when the first research never completes', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('electronAPI', { agy: {} });
    mocks.storeState.language = 'en';
    mocks.storeState.aiConfigs = [{ ...agyConfig, agyEffort: 'medium', concurrency: 1 }];
    (mocks.storeState.repositoryChatSettings as { chatConfigId: string }).chatConfigId = agyConfig.id;
    (mocks.storeState.repositoryChatSettings as { agentBudget: { maxDurationMs: number } }).agentBudget.maxDurationMs = 300_000;
    const research = mocks.runRepositoryChatTurn.getMockImplementation()!;
    mocks.runRepositoryChatTurn
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(async (input: RepositoryChatTurnInput) => {
        await new Promise((resolve) => setTimeout(resolve, 80_000));
        return research(input);
      });
    mocks.generateChatText.mockResolvedValue('Available facts');
    const pending = answerWorkbench({
      question: 'Compare their purposes', repositories: [makeRepository(1), makeRepository(2)],
      session, messages: [], depth: 'standard',
    });

    await vi.advanceTimersByTimeAsync(235_000);
    const result = await pending;
    const inputs = mocks.runRepositoryChatTurn.mock.calls.map(([input]) => input as RepositoryChatTurnInput);

    expect(inputs.map((input) => input.agentBudget?.maxDurationMs)).toEqual([90_000, 90_000]);
    expect(inputs[0].signal?.aborted).toBe(true);
    expect(inputs[1].signal?.aborted).toBe(false);
    expect(result.evidences.map((evidence) => evidence.repoFullName)).toEqual(['owner/repo-2']);
    expect(result.missing?.join('\n')).toContain('owner/repo-1: Research deadline reached');
    expect(result.missing?.join('\n')).not.toContain('owner/repo-2:');
  });

  it.each(['http', 'agy-cli'] as const)('uses the selected %s configuration for both repository research and synthesis', async (provider) => {
    const config: AIConfig = provider === 'http' ? { ...chatConfig, provider } : agyConfig;
    vi.stubGlobal('electronAPI', { agy: {} });
    mocks.storeState.aiConfigs = [config];
    mocks.storeState.activeAIConfig = config.id;
    (mocks.storeState.repositoryChatSettings as { chatConfigId: string }).chatConfigId = config.id;
    mocks.generateChatText.mockResolvedValue('Requested answer');

    await answerWorkbench({
      question: 'Explain their implementation', repositories: [makeRepository(1), makeRepository(2)],
      session, messages: [], depth: 'quick',
    });

    const expected = provider === 'agy-cli' ? { ...config, agyFeature: 'workbench', agyPriority: 'interactive' } : config;
    expect(mocks.runRepositoryChatTurn.mock.calls.map(([input]) => input.aiConfig)).toEqual([expected, expected]);
    expect(mocks.aiConstructors).toEqual([expected]);
  });

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

  it.each([
    ['quick', 3, 'default'],
    ['standard', 5, 'default'],
    ['deep', 7, 'default'],
  ] as const)('researches every repository beyond the old %s cutoff with a pinned SHA and scoped fact questions', async (depth, count, taskDepth) => {
    const repositories = Array.from({ length: count }, (_, index) => ({ ...makeRepository(index + 1), default_branch: 'main' }));
    const question = 'Explain their implementation';
    const project = makeProject(repositories);
    mocks.getRepositoryHeadSha.mockImplementation(async (_owner: string, name: string) => `sha-${name}`);
    mocks.generateChatText.mockResolvedValue(`比较结果见 [repo-1](${repositories[0].html_url}/blob/sha-repo-1/src/index.ts#L1-L10)。`);

    const result = await answerWorkbench({
      question,
      repositories,
      project,
      session,
      messages: [],
      depth,
    });

    expect(mocks.runRepositoryChatTurn).toHaveBeenCalledTimes(count);
    expect(mocks.getRepositoryReadme).not.toHaveBeenCalled();
    expect(result.evidences).toHaveLength(count);
    for (const [index, repository] of repositories.entries()) {
      expect(mocks.runRepositoryChatTurn).toHaveBeenNthCalledWith(index + 1, expect.objectContaining({
        repository,
        session: expect.objectContaining({
          repoId: repository.id, repoFullName: repository.full_name, sourceRefSha: `sha-${repository.name}`,
        }),
        taskDepth,
        streaming: false,
        aiConfig: chatConfig,
        signal: expect.any(AbortSignal),
      }));
      expect(result.content).toContain(`[${repository.full_name}](${repository.html_url}/blob/sha-${repository.name}/src/index.ts#L1-L10)`);
    }
    const questions = mocks.runRepositoryChatTurn.mock.calls.map(([input]) => input.question);
    for (const [index, scopedQuestion] of questions.entries()) {
      expect(scopedQuestion).toContain(`Extract facts only about ${repositories[index].full_name}`);
      expect(scopedQuestion).toContain(question);
      expect(scopedQuestion).toContain(project.instructions);
      expect(scopedQuestion).toContain('not the final comparison or recommendation');
      expect(scopedQuestion).toContain('Their absence is not a missing requirement');
      expect(scopedQuestion).toContain('Do not expand the task to unrequested platforms or features');
    }
    const payload = JSON.parse(mocks.generateChatText.mock.calls[0][0].user);
    expect(payload.repositories).toEqual(repositories.map((repository) => repository.full_name));
    expect(payload.question).toBe(question);
    expect(payload.coverage.completed).toEqual(payload.repositories);
    expect(payload.research).toHaveLength(count);
    expect(payload.evidence[count - 1].excerpt).toContain(repositories[count - 1].full_name);
    expect(result.missing).toEqual([]);
    expect(session.sourceRefSha).toBe('');
  });

  it('aggregates per-repository missing evidence and continues after a pinning failure', async () => {
    mocks.storeState.language = 'en';
    mocks.getRepositoryHeadSha.mockRejectedValueOnce(new Error('Cannot resolve branch'));
    mocks.runRepositoryChatTurn.mockResolvedValueOnce({
      content: 'No implementation was found.',
      evidences: [],
      missing: ['Configuration details unknown'],
    });
    mocks.generateChatText.mockResolvedValue('Available research');

    const result = await answerWorkbench({
      question: 'Explain configuration', repositories: [makeRepository(1), makeRepository(2), makeRepository(3)],
      session, messages: [], depth: 'quick',
    });

    expect(mocks.runRepositoryChatTurn).toHaveBeenCalledTimes(2);
    expect(result.evidences).toHaveLength(1);
    expect(result.missing).toEqual(expect.arrayContaining([
      'owner/repo-1: Cannot resolve branch',
      'owner/repo-2: Configuration details unknown',
      'owner/repo-2: No repository evidence retrieved in this turn.',
    ]));
    const payload = JSON.parse(mocks.generateChatText.mock.calls[0][0].user);
    expect(payload.coverage.failed).toEqual(['owner/repo-1']);
    expect(payload.missing).toEqual(result.missing);
    expect(result.content).toContain('Research coverage: 2/3');
  });

  it('returns explicit pending batches when non-settling research exhausts the deadline', async () => {
    vi.useFakeTimers();
    mocks.storeState.language = 'en';
    const signals: AbortSignal[] = [];
    mocks.runRepositoryChatTurn.mockImplementation((input: { signal: AbortSignal }) => {
      signals.push(input.signal);
      return new Promise(() => {});
    });
    mocks.generateChatText.mockResolvedValue('Research is incomplete.');
    const pending = answerWorkbench({
      question: 'Compare implementations', repositories: Array.from({ length: 5 }, (_, index) => makeRepository(index + 1)),
      session, messages: [], depth: 'quick',
    });

    await vi.advanceTimersByTimeAsync(45_000);
    const result = await pending;

    expect(mocks.runRepositoryChatTurn).toHaveBeenCalledTimes(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(result.content).toContain('Research coverage: 0/5');
    expect(result.missing).toContain('Pending batch 1 (total research deadline reached): owner/repo-3, owner/repo-4');
    const payload = JSON.parse(mocks.generateChatText.mock.calls[0][0].user);
    expect(payload.coverage.requested).toHaveLength(5);
    expect(payload.coverage.pendingBatches).toEqual([['owner/repo-3', 'owner/repo-4'], ['owner/repo-5']]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('continues to later repositories after one research timeout', async () => {
    vi.useFakeTimers();
    mocks.storeState.language = 'en';
    mocks.runRepositoryChatTurn.mockImplementationOnce(() => new Promise(() => {}));
    mocks.generateChatText.mockResolvedValue('Available implementation comparison.');
    const pending = answerWorkbench({
      question: 'Compare implementations', repositories: [makeRepository(1), makeRepository(2), makeRepository(3)],
      session, messages: [], depth: 'quick',
    });

    await vi.advanceTimersByTimeAsync(22_500);
    const result = await pending;

    expect(mocks.runRepositoryChatTurn).toHaveBeenCalledTimes(3);
    expect(result.evidences.map((evidence) => evidence.repoFullName)).toEqual(['owner/repo-2', 'owner/repo-3']);
    expect(result.content).toContain('Research coverage: 2/3');
    expect(result.missing?.join('\n')).toContain('owner/repo-1: Research deadline reached');
    expect(result.missing?.join('\n')).not.toContain('Pending batch');
  });

  it('retains completed research if synthesis ignores cancellation and exceeds the total deadline', async () => {
    vi.useFakeTimers();
    mocks.storeState.language = 'en';
    mocks.generateChatText.mockImplementation(() => new Promise(() => {}));
    const onChunk = vi.fn();
    const pending = answerWorkbench({
      question: 'Compare implementations', repositories: [makeRepository(1), makeRepository(2)],
      session, messages: [], depth: 'quick', onChunk,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;

    expect(result.content).toContain('Research for owner/repo-1');
    expect(result.content).toContain('Research for owner/repo-2');
    expect(result.missing?.join(' ')).toContain('Synthesis deadline reached');
    expect(mocks.generateChatText.mock.calls[0][0].signal.aborted).toBe(true);
    expect(onChunk).toHaveBeenCalledExactlyOnceWith(result.content);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates cancellation without starting another repository or publishing partial text', async () => {
    const controller = new AbortController();
    mocks.runRepositoryChatTurn.mockImplementationOnce(() => {
      controller.abort();
      return new Promise(() => {});
    });
    const onChunk = vi.fn();

    await expect(answerWorkbench({
      question: 'Compare implementations', repositories: [makeRepository(1), makeRepository(2)],
      session, messages: [], depth: 'quick', signal: controller.signal, onChunk,
    })).rejects.toMatchObject({ name: 'AbortError' });

    expect(mocks.runRepositoryChatTurn).toHaveBeenCalledOnce();
    expect(mocks.generateChatText).not.toHaveBeenCalled();
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('requests the configured language and requested deliverable in multi-repository synthesis', async () => {
    mocks.storeState.language = 'fr';
    mocks.generateChatText.mockResolvedValue('Voici un article.');

    await answerWorkbench({
      question: 'Write an article about these projects', repositories: [makeRepository(1), makeRepository(2)],
      session, messages: [], depth: 'quick',
    });

    const options = mocks.generateChatText.mock.calls[0][0];
    expect(options.system).toContain('French');
    expect(options.system).toContain('write the requested article or draft');
    expect(options.system).not.toContain('Compare only');
    expect(JSON.parse(options.user).question).toBe('Write an article about these projects');
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

  it('falls back from unsupported streaming within the same synthesis deadline', async () => {
    (mocks.storeState.repositoryChatSettings as { streamingMode: string }).streamingMode = 'auto';
    const unsupported = new Error('Streaming unsupported');
    unsupported.name = 'AIStreamUnsupportedError';
    mocks.generateChatTextStream.mockRejectedValue(unsupported);
    mocks.generateChatText.mockResolvedValue('Requested answer');
    const onChunk = vi.fn();

    const result = await answerWorkbench({
      question: 'Explain their implementation', repositories: [makeRepository(1), makeRepository(2)],
      session, messages: [], depth: 'quick', onChunk,
    });

    expect(mocks.generateChatTextStream).toHaveBeenCalledOnce();
    expect(mocks.generateChatText).toHaveBeenCalledTimes(2);
    expect(mocks.generateChatText.mock.calls[0][0].signal).toBe(mocks.generateChatTextStream.mock.calls[0][0].signal);
    expect(onChunk).toHaveBeenCalledExactlyOnceWith(result.content);
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
