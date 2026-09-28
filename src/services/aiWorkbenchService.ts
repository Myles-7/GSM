import { z } from 'zod';
import { useAppStore } from '../store/useAppStore';
import type { Repository } from '../types';
import type {
  WorkbenchCandidate,
  WorkbenchDepth,
  WorkbenchProject,
  WorkbenchRequirements,
  WorkbenchSearchBatch,
  WorkbenchTaskState,
} from '../types/aiWorkbench';
import type { RepositoryChatMessage, RepositoryChatSession, ToolEvidence } from '../types/repositoryChat';
import { forceSyncToBackend } from './autoSync';
import { AIService, isAIStreamUnsupportedError } from './aiService';
import { createGitHubApiService } from './githubApiFactory';
import { runRepositoryChatTurn } from './repositoryChatRunner';

type RuntimeListener = () => void;

const initialRuntimeState: WorkbenchTaskState = {
  sessionId: null,
  ownerId: null,
  stage: '',
  running: false,
};

let runtimeState = initialRuntimeState;
let runtimeController: AbortController | null = null;
let runtimeGeneration = 0;
const runtimeListeners = new Set<RuntimeListener>();

const publishRuntime = (next: WorkbenchTaskState): void => {
  runtimeState = next;
  runtimeListeners.forEach((listener) => listener());
};

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const abortError = (): Error => {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
};

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError();
};

export const workbenchRuntime = {
  subscribe(listener: RuntimeListener): () => void {
    runtimeListeners.add(listener);
    return () => runtimeListeners.delete(listener);
  },
  getSnapshot(): WorkbenchTaskState {
    return runtimeState;
  },
  stop(): void {
    if (!runtimeController || runtimeController.signal.aborted) return;
    runtimeController.abort();
    publishRuntime({ ...runtimeState, stage: 'stopped' });
  },
  async run(
    sessionId: string,
    ownerId: string,
    action: (signal: AbortSignal, stage: (stage: string) => void) => Promise<void>,
  ): Promise<void> {
    if (runtimeState.running) {
      throw new Error('Another AI workbench task is already running.');
    }

    const controller = new AbortController();
    const generation = ++runtimeGeneration;
    runtimeController = controller;
    publishRuntime({ sessionId, ownerId, stage: 'starting', running: true });

    const stage = (nextStage: string): void => {
      if (
        generation !== runtimeGeneration
        || runtimeController !== controller
        || controller.signal.aborted
        || !runtimeState.running
      ) return;
      publishRuntime({ ...runtimeState, stage: nextStage });
    };

    try {
      await action(controller.signal, stage);
      throwIfAborted(controller.signal);
    } catch (error) {
      if (generation === runtimeGeneration && runtimeController === controller) {
        publishRuntime({
          ...runtimeState,
          stage: controller.signal.aborted ? 'stopped' : 'error',
          error: controller.signal.aborted ? undefined : errorMessage(error),
        });
      }
      if (controller.signal.aborted && (!(error instanceof Error) || error.name !== 'AbortError')) {
        throw abortError();
      }
      throw error;
    } finally {
      if (generation === runtimeGeneration && runtimeController === controller) {
        runtimeController = null;
        publishRuntime({ ...runtimeState, running: false });
      }
    }
  },
};

const requirementsSchema = z.object({
  purpose: z.string().trim().min(1).max(2_000),
  required: z.array(z.string().trim().min(1).max(500)).max(12),
  preferred: z.array(z.string().trim().min(1).max(500)).max(12),
  excluded: z.array(z.string().trim().min(1).max(500)).max(12),
  questions: z.array(z.string().trim().min(1).max(500)).max(3),
  queries: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
}).strict();

const assessmentSchema = z.object({
  relevant: z.boolean(),
  summary: z.string().trim().min(1).max(2_000),
  reasons: z.array(z.string().trim().min(1).max(800)).max(8),
  limitations: z.array(z.string().trim().min(1).max(800)).max(8),
  sources: z.array(z.string().url()).min(1).max(4),
}).strict();

const uniqueStrings = (values: string[]): string[] => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const parseStrictJson = <T>(raw: string, schema: z.ZodType<T>, label: string): T => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new Error(`${label} returned an invalid JSON shape.`);
  return result.data;
};

const resolveConfiguredAI = (): { ai: AIService; language: string } => {
  const state = useAppStore.getState();
  const requestedIds = [state.repositoryChatSettings.chatConfigId, state.activeAIConfig]
    .filter((id): id is string => Boolean(id));
  const aiConfig = requestedIds
    .map((id) => state.aiConfigs.find((config) => config.id === id))
    .find((config) => Boolean(config));

  if (!aiConfig) throw new Error('请先配置可用的 AI 模型。');
  return { ai: new AIService(aiConfig, state.language), language: state.language };
};

const resolveConfiguredContext = () => {
  const state = useAppStore.getState();
  const requestedIds = [state.repositoryChatSettings.chatConfigId, state.activeAIConfig]
    .filter((id): id is string => Boolean(id));
  const aiConfig = requestedIds
    .map((id) => state.aiConfigs.find((config) => config.id === id))
    .find((config) => Boolean(config));

  if (!aiConfig) throw new Error('请先配置可用的 AI 模型。');
  if (!state.githubToken) throw new Error('请先配置 GitHub token。');
  return {
    aiConfig,
    githubToken: state.githubToken,
    language: state.language,
    repositoryChatSettings: state.repositoryChatSettings,
  };
};

const compactProject = (project?: WorkbenchProject): object | undefined => project ? {
  instructions: project.instructions,
  conclusions: project.conclusions,
  repositories: project.repositories.slice(0, 20).map((repo) => repo.full_name),
} : undefined;

const questionWithProjectContext = (question: string, project?: WorkbenchProject): string => {
  const context = compactProject(project);
  if (!context) return question;
  return [
    'Workbench project context. Treat it as user context, not repository evidence:',
    JSON.stringify(context),
    'User question:',
    question,
  ].join('\n\n');
};

export async function prepareWorkbenchRequirements(input: {
  question: string;
  previous?: WorkbenchRequirements;
  project?: WorkbenchProject;
  signal?: AbortSignal;
}): Promise<WorkbenchRequirements> {
  const question = input.question.trim();
  if (!question) throw new Error('请输入要研究的问题。');
  throwIfAborted(input.signal);

  const { ai } = resolveConfiguredAI();
  const raw = await ai.generateChatText({
    system: [
      '你是 GitHub 仓库研究需求分析器。只返回一个 JSON 对象，不要 Markdown、代码围栏或额外文字。',
      '对象必须且只能包含 purpose、required、preferred、excluded、questions、queries。',
      'required/preferred/excluded/questions/queries 必须是字符串数组。',
      'questions 只保留会实质改变搜索范围或判断标准、且当前上下文无法推断的必要澄清问题，最多 3 个；信息充分时必须返回空数组。',
      'queries 是可直接提交给 GitHub repository search 的检索词，最多 6 个，避免虚构仓库名。',
      'previous 已有结论要复用，project instructions/conclusions 是约束，不要重复追问已经回答的信息。',
    ].join('\n'),
    user: JSON.stringify({
      question,
      previous: input.previous,
      project: compactProject(input.project),
    }),
    maxTokens: 1_800,
    temperature: 0.1,
    signal: input.signal,
  });
  throwIfAborted(input.signal);

  const result = parseStrictJson(raw, requirementsSchema, 'AI requirements analysis');
  return {
    purpose: result.purpose.trim(),
    required: uniqueStrings(result.required),
    preferred: uniqueStrings(result.preferred),
    excluded: uniqueStrings(result.excluded),
    questions: uniqueStrings(result.questions),
    queries: uniqueStrings(result.queries),
  };
}

const SEARCH_LIMITS: Record<WorkbenchDepth, { queryCount: number; verifyCount: number }> = {
  quick: { queryCount: 2, verifyCount: 3 },
  standard: { queryCount: 4, verifyCount: 5 },
  deep: { queryCount: 6, verifyCount: 8 },
};

const makeId = (prefix: string): string => {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid ? `${prefix}-${randomUuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

const cloneCandidate = (candidate: WorkbenchCandidate): WorkbenchCandidate => ({
  ...candidate,
  repository: { ...candidate.repository, owner: { ...candidate.repository.owner }, topics: [...candidate.repository.topics] },
  reasons: [...candidate.reasons],
  limitations: [...candidate.limitations],
  sources: [...candidate.sources],
});

const cloneBatch = (batch: WorkbenchSearchBatch): WorkbenchSearchBatch => ({
  ...batch,
  requirements: {
    ...batch.requirements,
    required: [...batch.requirements.required],
    preferred: [...batch.requirements.preferred],
    excluded: [...batch.requirements.excluded],
    questions: [...batch.requirements.questions],
    queries: [...batch.requirements.queries],
  },
  candidates: batch.candidates.map(cloneCandidate),
  queries: [...batch.queries],
});

const splitRepositoryName = (fullName: string): [string, string] => {
  const slash = fullName.indexOf('/');
  if (slash <= 0 || slash === fullName.length - 1) throw new Error(`Invalid repository name: ${fullName}`);
  return [fullName.slice(0, slash), fullName.slice(slash + 1)];
};

const repositoryGitHubUrl = (fullName: string): string => {
  const [owner, name] = splitRepositoryName(fullName);
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
};

// Search returns GitHub wire records (including owner extras and license objects).
// Keep the application shape stable for cards, Store writes, and strict backups.
const normalizeSearchRepository = (repo: Repository): Repository => {
  const license: unknown = repo.license;
  const value = license && typeof license === 'object' ? license as { spdx_id?: unknown; name?: unknown } : null;
  return {
    id: repo.id, name: repo.name, full_name: repo.full_name,
    description: repo.description ?? '', html_url: repositoryGitHubUrl(repo.full_name),
    stargazers_count: repo.stargazers_count, forks_count: repo.forks_count,
    forks: repo.forks ?? repo.forks_count, language: repo.language,
    created_at: repo.created_at, updated_at: repo.updated_at, pushed_at: repo.pushed_at,
    owner: { login: repo.owner.login, avatar_url: repo.owner.avatar_url },
    topics: repo.topics ?? [], default_branch: repo.default_branch,
    license: typeof license === 'string' ? license : typeof value?.spdx_id === 'string' ? value.spdx_id : null,
    archived: repo.archived,
  };
};

const verifyCandidate = async (
  candidate: WorkbenchCandidate,
  requirements: WorkbenchRequirements,
  ai: AIService,
  github: ReturnType<typeof createGitHubApiService>,
  signal?: AbortSignal,
): Promise<WorkbenchCandidate> => {
  throwIfAborted(signal);
  const repository = candidate.repository;
  const [owner, name] = splitRepositoryName(repository.full_name);
  const repositorySource = repositoryGitHubUrl(repository.full_name);
  const readmeSource = `${repositorySource}#readme`;

  let readme: string;
  try {
    readme = await github.getRepositoryReadme(owner, name, signal);
    throwIfAborted(signal);
  } catch (error) {
    if (signal?.aborted) throw abortError();
    return {
      ...candidate,
      status: 'insufficient',
      summary: 'README 不可用，无法完成基于项目说明的验证。',
      limitations: uniqueStrings([...candidate.limitations, `README 读取失败：${errorMessage(error)}`]),
      sources: [repositorySource],
    };
  }

  if (!readme.trim()) {
    return {
      ...candidate,
      status: 'insufficient',
      summary: 'README 未返回内容，现有证据不足以完成验证。',
      limitations: uniqueStrings([...candidate.limitations, 'README 缺失或不可读取，原因未知。']),
      sources: [repositorySource],
    };
  }

  const allowedSources = [repositorySource, readmeSource];
  try {
    const raw = await ai.generateChatText({
      system: [
        '你是 GitHub 仓库验证器。只能依据给出的仓库元数据和 README 判断，不得补充外部事实或虚构仓库。',
        '只返回严格 JSON，不要 Markdown 或额外文字。对象必须且只能包含 relevant、summary、reasons、limitations、sources。',
        'summary、reasons、limitations 使用简体中文；summary 是简洁的中文能力摘要。',
        'sources 必须从 allowedSources 中逐字选择，至少一个；不得改写、拼接或新增 URL。',
        '若证据不能满足 required 或触发 excluded，relevant=false 并明确说明限制。',
      ].join('\n'),
      user: JSON.stringify({
        requirements,
        repository: {
          full_name: repository.full_name,
          description: repository.description,
          language: repository.language,
          topics: repository.topics,
          stars: repository.stargazers_count,
          updated_at: repository.updated_at,
        },
        allowedSources,
        readme: readme.slice(0, 16_000),
      }),
      temperature: 0.1,
      maxTokens: 1_500,
      signal,
    });
    throwIfAborted(signal);
    const assessment = parseStrictJson(raw, assessmentSchema, 'AI repository assessment');
    if (!/[\u3400-\u9fff]/u.test(assessment.summary)) {
      throw new Error('AI repository assessment summary must be Chinese.');
    }
    if (assessment.sources.some((source) => !allowedSources.includes(source))) {
      throw new Error('AI repository assessment cited an unsupported source.');
    }
    if (assessment.relevant && !assessment.sources.includes(readmeSource)) {
      throw new Error('AI repository assessment marked a repository verified without README evidence.');
    }
    return {
      ...candidate,
      status: assessment.relevant ? 'verified' : 'insufficient',
      summary: assessment.summary,
      reasons: uniqueStrings(assessment.reasons),
      limitations: uniqueStrings(assessment.limitations),
      sources: uniqueStrings(assessment.sources),
    };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    return {
      ...candidate,
      status: 'insufficient',
      summary: 'AI 验证未能生成可核验的结构化结论。',
      limitations: uniqueStrings([...candidate.limitations, errorMessage(error)]),
      sources: [repositorySource, readmeSource],
    };
  }
};

export async function searchWorkbench(input: {
  requirements: WorkbenchRequirements;
  depth: WorkbenchDepth;
  page?: number;
  signal?: AbortSignal;
  onUpdate: (batch: WorkbenchSearchBatch) => Promise<void> | void;
}): Promise<WorkbenchSearchBatch> {
  throwIfAborted(input.signal);
  const state = useAppStore.getState();
  if (!state.githubToken) throw new Error('请先配置 GitHub token。');
  const { ai } = resolveConfiguredAI();
  const github = createGitHubApiService(state.githubToken);
  const limits = SEARCH_LIMITS[input.depth];
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const queries = uniqueStrings(input.requirements.queries)
    .slice(0, limits.queryCount);
  if (queries.length === 0) {
    const fallback = input.requirements.purpose.trim();
    if (!fallback) throw new Error('搜索需求缺少可执行的 GitHub 查询。');
    queries.push(fallback);
  }

  const batch: WorkbenchSearchBatch = {
    id: makeId('workbench-search'),
    createdAt: new Date().toISOString(),
    requirements: input.requirements,
    candidates: [],
    queries: [],
    nextPage: page + 1,
  };
  const byFullName = new Map<string, WorkbenchCandidate>();
  const emit = async (): Promise<void> => {
    throwIfAborted(input.signal);
    await input.onUpdate(cloneBatch(batch));
    throwIfAborted(input.signal);
  };

  for (const query of queries) {
    throwIfAborted(input.signal);
    const result = await github.searchRepositories(query, 'All', 'All', 'BestMatch', 'Descending', page, 20);
    throwIfAborted(input.signal);
    batch.queries.push(query);

    for (const raw of result.repos) {
      const repository = normalizeSearchRepository(raw);
      const key = repository.full_name.toLowerCase();
      const existing = byFullName.get(key);
      const reason = `GitHub 搜索命中：${query}`;
      if (existing) {
        existing.reasons = uniqueStrings([...existing.reasons, reason]);
        continue;
      }
      const candidate: WorkbenchCandidate = {
        repository,
        summary: repository.description ? `GitHub 描述：${repository.description}` : '暂无仓库描述，等待进一步验证。',
        reasons: [reason],
        limitations: [],
        sources: [repositoryGitHubUrl(repository.full_name)],
        status: 'candidate',
      };
      byFullName.set(key, candidate);
      batch.candidates.push(candidate);
    }
    await emit();
  }

  const targets = batch.candidates.slice(0, limits.verifyCount);
  for (const target of targets) {
    throwIfAborted(input.signal);
    target.status = 'verifying';
    await emit();
    const verified = await verifyCandidate(target, input.requirements, ai, github, input.signal);
    Object.assign(target, verified);
    await emit();
  }

  return cloneBatch(batch);
}

const depthToRepositoryChatDepth = (depth: WorkbenchDepth): 'quick' | 'default' | 'deep' => (
  depth === 'standard' ? 'default' : depth
);

const pinWorkbenchSessionToRepository = async (
  session: RepositoryChatSession,
  repository: Repository,
  githubToken: string,
  signal?: AbortSignal,
): Promise<RepositoryChatSession> => {
  const github = createGitHubApiService(githubToken);
  const [owner, name] = splitRepositoryName(repository.full_name);
  const branch = repository.default_branch?.trim()
    || (await github.getRepositoryMeta(owner, name, signal)).defaultBranch;
  throwIfAborted(signal);
  const sourceRefSha = await github.getRepositoryHeadSha(owner, name, branch, signal);
  throwIfAborted(signal);
  return {
    ...session,
    repoId: repository.id,
    repoFullName: repository.full_name,
    sourceRefSha,
  };
};

const MULTI_REPO_LIMITS: Record<WorkbenchDepth, number> = {
  quick: 2,
  standard: 4,
  deep: 6,
};

const shortHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const extractUrls = (text: string): string[] => text.match(/https?:\/\/[^\s)\]}>,]+/g) ?? [];

const appendSourceLinks = (content: string, evidences: ToolEvidence[], language: string): string => {
  const links = [...new Map(evidences.map((evidence) => [evidence.url, evidence.repoFullName])).entries()];
  if (links.length === 0) return content.trim();
  const heading = language === 'zh' ? '来源' : 'Sources';
  return `${content.trim()}\n\n${heading}：\n${links.map(([url, name]) => `- [${name}](${url})`).join('\n')}`;
};

export async function answerWorkbench(input: {
  question: string;
  repositories: Repository[];
  project?: WorkbenchProject;
  session: RepositoryChatSession;
  messages: RepositoryChatMessage[];
  depth: WorkbenchDepth;
  signal?: AbortSignal;
  onChunk?: (content: string) => void;
}): Promise<{ content: string; evidences: ToolEvidence[] }> {
  const question = input.question.trim();
  if (!question) throw new Error('请输入问题。');
  if (input.repositories.length === 0) throw new Error('至少选择一个仓库后再提问。');
  throwIfAborted(input.signal);

  const context = resolveConfiguredContext();
  if (input.repositories.length === 1) {
    const repository = input.repositories[0];
    const runnerSession = input.session.kind === 'workbench'
      || input.session.repoFullName !== repository.full_name
      || !input.session.sourceRefSha
      ? await pinWorkbenchSessionToRepository(input.session, repository, context.githubToken, input.signal)
      : input.session;
    return await runRepositoryChatTurn({
      repository,
      session: runnerSession,
      messages: input.messages,
      question: questionWithProjectContext(question, input.project),
      githubToken: context.githubToken,
      aiConfig: context.aiConfig,
      language: context.language,
      maxToolsPerTurn: context.repositoryChatSettings.maxToolsPerTurn,
      agentBudget: context.repositoryChatSettings.agentBudget,
      taskDepth: depthToRepositoryChatDepth(input.depth),
      streaming: context.repositoryChatSettings.streamingMode !== 'off' && Boolean(input.onChunk),
      enableAgentToolLoop: context.repositoryChatSettings.enableAgentToolLoop,
      onAnswerChunk: input.onChunk,
      signal: input.signal,
    });
  }

  const github = createGitHubApiService(context.githubToken);
  const selected = input.repositories.slice(0, MULTI_REPO_LIMITS[input.depth]);
  const evidences: ToolEvidence[] = [];
  for (const repository of selected) {
    throwIfAborted(input.signal);
    const [owner, name] = splitRepositoryName(repository.full_name);
    const repositorySource = repositoryGitHubUrl(repository.full_name);
    const retrievedAt = new Date().toISOString();
    try {
      const readme = await github.getRepositoryReadme(owner, name, input.signal);
      throwIfAborted(input.signal);
      if (readme.trim()) {
        const excerpt = readme.slice(0, 12_000);
        evidences.push({
          id: `workbench-${repository.id}-${shortHash(excerpt)}`,
          source: 'github',
          repoFullName: repository.full_name,
          url: `${repositorySource}#readme`,
          contentHash: shortHash(readme),
          excerpt,
          retrievedAt,
        });
        continue;
      }
    } catch {
      if (input.signal?.aborted) throw abortError();
    }

    const metadataExcerpt = [
      repository.description ?? '',
      `language=${repository.language ?? 'unknown'}`,
      `stars=${repository.stargazers_count}`,
      repository.topics.length ? `topics=${repository.topics.join(', ')}` : '',
    ].filter(Boolean).join('\n');
    evidences.push({
      id: `workbench-${repository.id}-metadata`,
      source: 'github',
      repoFullName: repository.full_name,
      url: repositorySource,
      excerpt: metadataExcerpt || repository.full_name,
      retrievedAt,
    });
  }

  throwIfAborted(input.signal);
  const ai = new AIService(context.aiConfig, context.language);
  const allowedUrls = uniqueStrings(evidences.map((evidence) => evidence.url));
  const conversation = input.messages.slice(-8).map((message) => ({
    role: message.role,
    content: message.content.slice(0, 2_000),
  }));
  const userPayload = JSON.stringify({
    question,
    project: compactProject(input.project),
    conversation,
    repositories: selected.map((repository) => repository.full_name),
    evidence: evidences.map((evidence) => ({
      repository: evidence.repoFullName,
      source: evidence.url,
      excerpt: evidence.excerpt,
    })),
    allowedUrls,
  });
  const system = context.language === 'zh'
    ? '你是只读的多仓库研究助手。只比较输入中列出的仓库，只依据 evidence 回答。逐项说明适用场景、关键差异和证据不足之处。涉及仓库事实时使用 allowedUrls 中的原始 URL 作为 Markdown 链接；不得新增或改写 URL，不得建议或执行写操作。'
    : 'You are a read-only multi-repository research assistant. Compare only the listed repositories and ground every repository fact in the provided evidence. Explain fit, material differences, and evidence gaps. Use only exact URLs from allowedUrls as Markdown links. Do not invent or rewrite URLs and do not perform write actions.';

  let content: string;
  if (input.onChunk && context.repositoryChatSettings.streamingMode !== 'off') {
    try {
      content = await ai.generateChatTextStream({
        system,
        user: userPayload,
        temperature: 0.2,
        maxTokens: input.depth === 'quick' ? 2_000 : input.depth === 'deep' ? 6_000 : 4_000,
        signal: input.signal,
        // Buffer provider chunks inside AIService. The workbench publishes only the
        // final response after source validation, so invented URLs never flash in UI.
        onChunk: () => undefined,
      });
    } catch (error) {
      if (input.signal?.aborted) throw abortError();
      if (!isAIStreamUnsupportedError(error)) throw error;
      content = await ai.generateChatText({
        system,
        user: userPayload,
        temperature: 0.2,
        maxTokens: input.depth === 'quick' ? 2_000 : input.depth === 'deep' ? 6_000 : 4_000,
        signal: input.signal,
      });
    }
  } else {
    content = await ai.generateChatText({
      system,
      user: userPayload,
      temperature: 0.2,
      maxTokens: input.depth === 'quick' ? 2_000 : input.depth === 'deep' ? 6_000 : 4_000,
      signal: input.signal,
    });
  }

  throwIfAborted(input.signal);
  const unsupportedUrl = extractUrls(content).find((url) => !allowedUrls.includes(url));
  if (unsupportedUrl) throw new Error(`AI answer cited an unsupported source: ${unsupportedUrl}`);
  const linkedContent = appendSourceLinks(content, evidences, context.language);
  input.onChunk?.(linkedContent);
  return { content: linkedContent, evidences };
}

export class WorkbenchStarSyncError extends Error {
  readonly githubStarred = true;
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'WorkbenchStarSyncError';
    this.cause = cause;
  }
}

export async function starWorkbenchRepository(repository: Repository): Promise<void> {
  const state = useAppStore.getState();
  if (!state.githubToken || !state.user) throw new Error('请先配置 GitHub token。');
  const [owner, name] = splitRepositoryName(repository.full_name);
  const github = createGitHubApiService(state.githubToken);

  await github.starRepository(owner, name);
  const current = useAppStore.getState();
  if (current.githubToken !== state.githubToken || current.user?.id !== state.user.id) {
    throw new WorkbenchStarSyncError('GitHub Star succeeded for the original account; the active account changed and local data was not modified.');
  }
  if (!current.repositories.some((item) => item.id === repository.id)) {
    current.addRepository({ ...repository, starred_at: new Date().toISOString() });
  }

  try {
    await forceSyncToBackend({ reportFailures: true });
  } catch (error) {
    throw new WorkbenchStarSyncError(
      `Repository was starred on GitHub and saved locally, but backend sync failed: ${errorMessage(error)}`,
      error,
    );
  }
}
