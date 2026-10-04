import { z } from 'zod';
import { aiTaskJournal } from './aiTaskJournal';
import { bindTaskSignal, taskConfigSnapshot } from './taskExecution';
import type { TaskMetadata, AITaskKind } from './aiTaskJournal';
import type { AIConfig } from '../types';
import { getOutputLanguageDirective } from '../i18n/aiLanguage';
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
import { TASK_DEPTH_PRESETS } from '../types/repositoryChat';
import { isAIConfigAvailable } from '../utils/aiConfig';
import { withDeadline } from '../utils/requestDeadline';
import { forceSyncToBackend } from './autoSync';
import { AIService, isAIStreamUnsupportedError } from './aiService';
import { forAgyFeature, agyFeatureConcurrency, agyProfileIdentity } from './agyProfiles';
import { createGitHubApiService } from './githubApiFactory';
import { runRepositoryChatTurn } from './repositoryChatRunner';
import { workbenchText } from './aiWorkbenchLocalization';
import { ANSWER_REVIEW_PROMPT, parseAnswerQualityReview } from './answerQuality';
import { answerRequirements, USER_REQUIREMENTS_FIRST } from './answerRequirements';
import { selectAnalysisContext } from './analysisContext';
import { canReuseResearch, loadResearchCheckpoint, saveResearchCheckpoint, type ResearchCheckpointEntry } from './workbenchResearchCheckpoint';
import { researchLocalProject } from './localResearch';
import type { AgyLocalProject } from '../types/agy';
import type { RepositoryChatTurnInput, RepositoryChatTurnResult } from './repositoryChatService';
import { mergeWorkbenchCandidates, summarizeWorkbenchCandidates } from './workbenchOverview';

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

const errorMessage = (error: unknown): string => (
  error instanceof Error || error instanceof DOMException ? error.message : String(error)
);

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
  progress(sessionId: string, patch: Pick<Partial<WorkbenchTaskState>, 'readFiles' | 'currentSource'>): void {
    if (runtimeState.sessionId === sessionId && runtimeState.running && !runtimeController?.signal.aborted)
      publishRuntime({ ...runtimeState, ...patch });
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
    options: TaskMetadata & { kind?: AITaskKind; aiConfig?: AIConfig } = {},
  ): Promise<void> {
    if (runtimeState.running) {
      throw new Error('Another AI workbench task is already running.');
    }

    const controller = new AbortController();
    const config = options.aiConfig;
    const task = aiTaskJournal.begin(ownerId, options.kind ?? 'research', [{ id: sessionId, label: options.title ?? sessionId }], config?.id, undefined,
      { title: options.title, target: options.target ?? { view: 'ai', id: sessionId }, config: config ? taskConfigSnapshot(config, options.kind === 'chat' ? 'repository-chat' : 'workbench') : undefined });
    bindTaskSignal(controller.signal, task);
    task.bind({ stop: () => controller.abort() }); task.item(sessionId, 'running');
    const generation = ++runtimeGeneration;
    runtimeController = controller;
    publishRuntime({ sessionId, ownerId, taskId: task.id, stage: 'starting', running: true, startedAt: Date.now(), readFiles: 0 });

    const stage = (nextStage: string): void => {
      if (
        generation !== runtimeGeneration
        || runtimeController !== controller
        || controller.signal.aborted
        || !runtimeState.running
      ) return;
      publishRuntime({ ...runtimeState, stage: nextStage });
      task.metadata({ phase: nextStage });
    };

    try {
      await action(controller.signal, stage);
      throwIfAborted(controller.signal);
      if (!aiTaskJournal.snapshot().find(record => record.id === task.id)?.items.some(item => item.state === 'failed')) task.item(sessionId, 'complete');
    } catch (error) {
      if (!controller.signal.aborted) { task.item(sessionId, 'failed', error); task.error(error); }
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
      task.finish(controller.signal.aborted ? 'canceled' : undefined);
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

const outputLanguageDirective = (language: string): string => getOutputLanguageDirective(language)
  || (language === 'zh' ? 'Write user-facing text in Simplified Chinese.' : 'Write user-facing text in English.');

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

const resolveSelectedConfig = (state: ReturnType<typeof useAppStore.getState>) => {
  const selectedId = state.repositoryChatSettings.chatConfigId ?? state.activeAIConfig;
  const aiConfig = state.aiConfigs.find((config) => config.id === selectedId);
  if (!isAIConfigAvailable(aiConfig)) throw new Error(workbenchText(state.language, 'unavailableConfig'));
  return aiConfig;
};

const resolveConfiguredAI = () => {
  const state = useAppStore.getState();
  const aiConfig = resolveSelectedConfig(state);
  return { ai: new AIService(forAgyFeature(aiConfig, 'workbench'), state.language), language: state.language, concurrency: agyFeatureConcurrency(aiConfig, 'workbench') };
};

const resolveConfiguredContext = () => {
  const state = useAppStore.getState();
  const aiConfig = resolveSelectedConfig(state);
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
  repositories: (project.selectedRepositoryNames ?? project.repositories.map((repo) => repo.full_name)).slice(0, 20),
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
  messages?: RepositoryChatMessage[];
  signal?: AbortSignal;
}): Promise<WorkbenchRequirements> {
  const question = input.question.trim();
  if (!question) throw new Error('请输入要研究的问题。');
  throwIfAborted(input.signal);

  const { ai, language } = resolveConfiguredAI();
  const raw = await ai.generateChatText({
    system: [
      '你是 GitHub 仓库研究需求分析器。只返回一个 JSON 对象，不要 Markdown、代码围栏或额外文字。',
      '对象必须且只能包含 purpose、required、preferred、excluded、questions、queries。',
      'required/preferred/excluded/questions/queries 必须是字符串数组。',
      'questions 只保留会实质改变搜索范围或判断标准、且当前上下文无法推断的必要澄清问题，最多 3 个；信息充分时必须返回空数组。',
      'queries 是可直接提交给 GitHub repository search 的检索词，最多 6 个，避免虚构仓库名。',
      'previous 已有结论要复用，project instructions/conclusions 是约束，不要重复追问已经回答的信息。',
      'Use recentConversation to retain answered conditions. For broad browsing, use reasonable visible assumptions in preferred rather than asking optional platform, language or domain questions. Ask only if the missing answer materially changes the requested outcome.',
      outputLanguageDirective(language),
      'Keep JSON keys unchanged and GitHub queries optimized for retrieval.',
    ].join('\n'),
    user: JSON.stringify({
      question,
      previous: input.previous,
      project: compactProject(input.project),
      recentConversation: input.messages?.slice(-8).map(message => ({ role: message.role, content: message.content.slice(0, 3_000) })),
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
  overview: candidate.overview && { ...candidate.overview },
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

// Each query contributes its next unseen hit per round, retaining GitHub rank
// within that query. Duplicates do not consume another query's turn.
const fuseQueryCandidates = (queries: WorkbenchCandidate[][]): WorkbenchCandidate[] => {
  const offsets = queries.map(() => 0);
  const seen = new Set<string>();
  const fused: WorkbenchCandidate[] = [];
  let added: boolean;
  do {
    added = false;
    queries.forEach((candidates, index) => {
      while (offsets[index] < candidates.length) {
        const candidate = candidates[offsets[index]++];
        const key = candidate.repository.full_name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        fused.push(candidate);
        added = true;
        break;
      }
    });
  } while (added);
  return fused;
};

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
  language: string,
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
      summary: language === 'zh' ? 'README 不可用，无法完成基于项目说明的验证。' : 'README unavailable; verification could not be completed.',
      limitations: uniqueStrings([...candidate.limitations, `README: ${errorMessage(error)}`]),
      sources: [repositorySource],
    };
  }

  if (!readme.trim()) {
    return {
      ...candidate,
      status: 'insufficient',
      summary: language === 'zh' ? 'README 未返回内容，现有证据不足以完成验证。' : 'README returned no content; evidence is insufficient.',
      limitations: uniqueStrings([...candidate.limitations, language === 'zh' ? 'README 缺失或不可读取，原因未知。' : 'README missing or unreadable; the cause is unknown.']),
      sources: [repositorySource],
    };
  }

  const allowedSources = [repositorySource, readmeSource];
  try {
    const raw = await ai.generateChatText({
      system: [
        '你是 GitHub 仓库验证器。只能依据给出的仓库元数据和 README 判断，不得补充外部事实或虚构仓库。',
        '只返回严格 JSON，不要 Markdown 或额外文字。对象必须且只能包含 relevant、summary、reasons、limitations、sources。',
        'summary is a concise capability summary. Keep JSON keys unchanged.',
        outputLanguageDirective(language),
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
        readme: selectAnalysisContext(readme, 16_000),
      }),
      temperature: 0.1,
      maxTokens: 1_500,
      signal,
    });
    throwIfAborted(signal);
    const assessment = parseStrictJson(raw, assessmentSchema, 'AI repository assessment');
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
      summary: language === 'zh' ? 'AI 验证未能生成可核验的结构化结论。' : 'AI verification did not produce a verifiable structured assessment.',
      limitations: uniqueStrings([...candidate.limitations, errorMessage(error)]),
      sources: [repositorySource, readmeSource],
    };
  }
};

export async function searchWorkbench(input: {
  requirements: WorkbenchRequirements;
  depth: WorkbenchDepth;
  page?: number;
  previous?: WorkbenchSearchBatch;
  overview?: boolean;
  onStage?: (stage: string) => void;
  signal?: AbortSignal;
  onUpdate: (batch: WorkbenchSearchBatch) => Promise<void> | void;
}): Promise<WorkbenchSearchBatch> {
  throwIfAborted(input.signal);
  const state = useAppStore.getState();
  if (!state.githubToken) throw new Error('请先配置 GitHub token。');
  const { ai, language, concurrency } = resolveConfiguredAI();
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
    id: input.previous?.id ?? makeId('workbench-search'),
    createdAt: input.previous?.createdAt ?? new Date().toISOString(),
    requirements: input.requirements,
    candidates: input.previous ? input.previous.candidates.map(cloneCandidate) : [],
    queries: [],
    nextPage: page + 1,
    overviewSummary: input.previous?.overviewSummary,
  };
  const byFullName = new Map(batch.candidates.map(candidate => [candidate.repository.full_name.toLowerCase(), candidate]));
  const previousCandidates = [...batch.candidates];
  const queryCandidates: WorkbenchCandidate[][] = [];
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
    const candidates: WorkbenchCandidate[] = [];

    for (const raw of result.repos) {
      const repository = normalizeSearchRepository(raw);
      const key = repository.full_name.toLowerCase();
      const existing = byFullName.get(key);
      const reason = language === 'zh' ? `GitHub 搜索命中：${query}` : `GitHub search match: ${query}`;
      if (existing) {
        existing.reasons = uniqueStrings([...existing.reasons, reason]);
        candidates.push(existing);
        continue;
      }
      const candidate: WorkbenchCandidate = {
        repository,
        summary: repository.description
          ? `${language === 'zh' ? 'GitHub 描述：' : 'GitHub description: '}${repository.description}`
          : language === 'zh' ? '暂无仓库描述，等待进一步验证。' : 'No repository description; awaiting verification.',
        reasons: [reason],
        limitations: [],
        sources: [repositoryGitHubUrl(repository.full_name)],
        status: 'candidate',
      };
      byFullName.set(key, candidate);
      candidates.push(candidate);
    }
    queryCandidates.push(candidates);
    batch.candidates = mergeWorkbenchCandidates(previousCandidates, fuseQueryCandidates(queryCandidates));
    await emit();
  }

  if (input.overview) {
    input.onStage?.('overview');
    batch.candidates = await summarizeWorkbenchCandidates({
      candidates: batch.candidates, requirements: input.requirements, ai, language, concurrency, signal: input.signal,
      readReadme: (candidate, signal) => {
        const [owner, name] = splitRepositoryName(candidate.repository.full_name);
        return github.getRepositoryReadme(owner, name, signal);
      },
      onUpdate: async (candidates, summary) => { batch.candidates = candidates;
        if (summary) batch.overviewSummary = summary;
        await emit(); },
    });
    return cloneBatch(batch);
  }

  // Failed assessments are retained, but do not consume a successful-result
  // slot. Bound replacement work to at most twice the depth's target count.
  const targets = batch.candidates.slice(0, limits.verifyCount * 2);
  let verifiedCount = 0;
  let verifying = 0;
  let nextTarget = 0;
  let emission = Promise.resolve();
  const emitOrdered = () => { emission = emission.then(() => emit()); return emission; };
  const verifyWorker = async () => {
  while (nextTarget < targets.length) {
    if (verifiedCount + verifying >= limits.verifyCount) break;
    const target = targets[nextTarget++];
    verifying++;
    throwIfAborted(input.signal);
    target.status = 'verifying';
    await emitOrdered();
    const verified = await verifyCandidate(target, input.requirements, ai, github, language, input.signal);
    Object.assign(target, verified);
    if (verified.status === 'verified') verifiedCount += 1;
    verifying--;
    await emitOrdered();
  }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, limits.verifyCount) }, verifyWorker));

  return cloneBatch(batch);
}

export async function overviewWorkbenchBatch(input: {
  batch: WorkbenchSearchBatch; signal?: AbortSignal; onUpdate: (batch: WorkbenchSearchBatch) => Promise<void> | void;
}): Promise<void> {
  const { ai, language, concurrency } = resolveConfiguredAI();
  const state = useAppStore.getState();
  const github = createGitHubApiService(state.githubToken ?? '');
  await summarizeWorkbenchCandidates({ candidates: input.batch.candidates, requirements: input.batch.requirements,
    ai, language, concurrency, signal: input.signal,
    readReadme: (candidate, signal) => {
      const [owner, name] = splitRepositoryName(candidate.repository.full_name);
      return github.getRepositoryReadme(owner, name, signal);
    },
    onUpdate: (candidates, summary) => input.onUpdate({ ...input.batch, candidates,
      overviewSummary: summary || input.batch.overviewSummary }),
  });
}

export async function answerWorkbenchOverview(input: {
  question: string; candidates: WorkbenchCandidate[]; messages: RepositoryChatMessage[];
  signal?: AbortSignal; onChunk?: (content: string) => void;
}): Promise<RepositoryChatTurnResult> {
  if (!input.candidates.length) throw new Error('No projects in this result set.');
  if (input.candidates.length > 120) throw new Error('Select up to 120 projects for this overview question.');
  const { ai, language } = resolveConfiguredAI();
  const content = await ai.generateChatText({
    system: ['Answer questions about the supplied project overview. Use only supplied facts and recent conversation.',
      'Explain, group, filter or compare at overview level. Do not invent installation commands, compatibility or recommendations. State unknowns. If deeper evidence is needed, suggest selecting those projects for research.',
      'Only link exact supplied repository URLs. Respect exclusions, language and requested output format.', outputLanguageDirective(language)].join('\n'),
    user: JSON.stringify({ question: input.question, recentConversation: input.messages.slice(-6).map(message => ({ role: message.role, content: message.content.slice(0, 2_000) })),
      projects: input.candidates.map(item => ({ name: item.repository.full_name, url: repositoryGitHubUrl(item.repository.full_name),
        summary: item.overview?.summary || item.repository.ai_summary || item.summary, category: item.overview?.category,
        kind: item.overview?.kind, basis: item.overview?.basis ?? 'metadata', status: item.overview?.status ?? 'not-reviewed', limitations: item.limitations })),
    }), maxTokens: 2_800, temperature: 0.1, signal: input.signal,
  });
  input.signal?.throwIfAborted();
  input.onChunk?.(content);
  return { content, evidences: [], quality: 'unreviewed' };
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

const MULTI_REPO_BATCH_SIZE: Record<WorkbenchDepth, number> = {
  quick: 2,
  standard: 4,
  deep: 6,
};

const extractUrls = (text: string): string[] => text.match(/https?:\/\/[^\s)\]}>,]+/g) ?? [];

// Resolve citations before combining answers: /README.md in one repository must
// never bind to another repository's README (or to an unpinned branch).
const normalizeResearchCitations = (
  content: string,
  repository: string,
  sourceRefSha: string,
  evidences: ToolEvidence[],
  language: string,
): { content: string; missing: string[] } => {
  const sources = evidences.filter((evidence) => evidence.repoFullName.toLowerCase() === repository.toLowerCase());
  const allowedUrls = new Set(sources.map((evidence) => evidence.url));
  const resolveReference = (raw: string): string | undefined => {
    const reference = raw.trim();
    if (allowedUrls.has(reference)) return reference;
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) return undefined;
    const range = /^(.*?)\s*(?:\s[-\u2013\u2014]\s*|#L)(\d+)(?:-L?(\d+))?$/.exec(reference);
    const rawPath = range?.[1] ?? reference;
    let path: string;
    try {
      path = decodeURIComponent(new URL(rawPath, 'https://repository.invalid/').pathname).replace(/^\/+/, '');
    } catch {
      return undefined;
    }
    const start = range ? Number(range[2]) : undefined;
    const end = range ? Number(range[3] ?? range[2]) : undefined;
    const matches = sources.filter((evidence) => {
      if (evidence.path?.replace(/^\/+/, '') !== path) return false;
      const repositoryUrl = repositoryGitHubUrl(repository);
      const metadataSource = ['releases', 'issues', 'pull'].some((kind) => evidence.url.startsWith(`${repositoryUrl}/${kind}/`));
      if (!metadataSource && (!evidence.url.startsWith(`${repositoryUrl}/blob/${sourceRefSha}/`)
        || (evidence.refSha !== undefined && evidence.refSha !== sourceRefSha))) return false;
      const urlRange = /#L(\d+)(?:-L(\d+))?$/.exec(evidence.url);
      const first = evidence.lineStart ?? (urlRange ? Number(urlRange[1]) : undefined);
      const last = evidence.lineEnd ?? (urlRange ? Number(urlRange[2] ?? urlRange[1]) : first);
      return start === undefined || (end !== undefined && end >= start
        && first !== undefined && last !== undefined && first <= start && end <= last);
    });
    return matches[0]?.url;
  };

  // Inline reference-style links while they still have a repository-local
  // definition table; repeated [source] labels otherwise collide on concatenation.
  const definitions = new Map<string, string>();
  const definitionKey = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const withoutDefinitions = content.replace(/^[ \t]{0,3}\[([^\]\n]+)\]:[ \t]*<?([^\s>]+)>?[^\n]*$/gm, (_whole, label: string, target: string) => {
    definitions.set(definitionKey(label), target);
    return '';
  }).replace(/\[([^\]\n]+)\]\[([^\]\n]*)\]/g, (whole, label: string, id: string) => {
    const target = definitions.get(definitionKey(id || label));
    return target ? `[${label}](${target})` : whole;
  }).replace(/\[([^\]\n]+)\](?![[(])/g, (whole, label: string) => {
    const target = definitions.get(definitionKey(label));
    return target ? `[${label}](${target})` : whole;
  });
  let removed = false;
  const cleaned = withoutDefinitions.split(/\n{2,}/).map((section) => {
    let invalid = false;
    let valid = false;
    const link = (label: string, target: string): string => {
      const url = resolveReference(target);
      if (url) {
        valid = true;
        return `[${label}](${url})`;
      }
      invalid = true;
      return label;
    };
    const normalized = section
      .replace(/!?\[([^\]\n]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g,
        (_whole, label: string, target: string) => link(label, target))
      .replace(/`([^`\n]+)`/g, (whole, token: string) => {
        const citation = /\s[-\u2013\u2014]\s*\d+(?:-\d+)?$|#L\d+(?:-L?\d+)?$/.test(token);
        return citation ? link(token, token) : whole;
      })
      .replace(/https?:\/\/[^\s)\]}>,]+/g, (url) => {
        if (allowedUrls.has(url)) { valid = true; return url; }
        const withoutPunctuation = url.replace(/[.;:!?。，；：！？]+$/, '');
        if (allowedUrls.has(withoutPunctuation)) {
          valid = true;
          return `[${repository}](${withoutPunctuation})${url.slice(withoutPunctuation.length)}`;
        }
        invalid = true;
        return '';
      });
    removed ||= invalid;
    // A bad paragraph must not discard a different, source-backed paragraph.
    return invalid && !valid ? '' : normalized;
  }).filter((section) => section.trim()).join('\n\n');
  return {
    content: cleaned,
    missing: removed ? [workbenchText(language, 'citationsRemoved')] : [],
  };
};

const appendSourceLinks = (content: string, evidences: ToolEvidence[], language: string): string => {
  const links = [...new Map(evidences.filter(evidence => evidence.source !== 'local').map((evidence) => [evidence.url, evidence.repoFullName])).entries()];
  if (links.length === 0) return content.trim();
  return `${content.trim()}\n\n${workbenchText(language, 'sources')}:\n${links.map(([url, name]) => `- [${name}](${url})`).join('\n')}`;
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
  onAnswerEvent?: RepositoryChatTurnInput['onAnswerEvent'];
  onToolEvent?: RepositoryChatTurnInput['onToolEvent'];
  onResearchSource?: (source: import('../types/repositoryChat').ResearchSourceStatus) => void;
  localProject?: AgyLocalProject;
  resumeResearch?: boolean;
}): Promise<RepositoryChatTurnResult> {
  const question = input.question.trim();
  if (!question) throw new Error('请输入问题。');
  if (input.repositories.length === 0) throw new Error('至少选择一个仓库后再提问。');
  throwIfAborted(input.signal);

  const seen = new Set<string>();
  const repositories = input.repositories.filter((repository) => {
    const key = repository.full_name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const context = resolveConfiguredContext();
  if (repositories.length === 1 && !input.localProject) {
    const repository = repositories[0];
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
      aiConfig: forAgyFeature(context.aiConfig, 'workbench'),
      language: context.language,
      maxToolsPerTurn: context.repositoryChatSettings.maxToolsPerTurn,
      agentBudget: context.repositoryChatSettings.agentBudget,
      taskDepth: depthToRepositoryChatDepth(input.depth),
      streaming: context.repositoryChatSettings.streamingMode !== 'off' && Boolean(input.onChunk),
      enableAgentToolLoop: context.repositoryChatSettings.enableAgentToolLoop,
      onAnswerChunk: input.onChunk,
      onAnswerEvent: input.onAnswerEvent,
      onToolEvent: input.onToolEvent,
      signal: input.signal,
    });
  }

  if (input.localProject) {
    const date = new Date().toISOString();
    repositories.push({ id: -1, name: input.localProject.name, full_name: `local/${input.localProject.name}`,
      description: '', html_url: '', owner: { login: 'local', avatar_url: '' }, topics: [],
      stargazers_count: 0, forks_count: 0, forks: 0, language: null, created_at: date, updated_at: date, pushed_at: date });
  }

  const configuredDuration = context.repositoryChatSettings.agentBudget.maxDurationMs;
  const totalDurationMs = input.depth === 'standard'
    ? Math.min(300_000, Math.max(15_000, Number.isFinite(configuredDuration) ? configuredDuration : 90_000))
    : TASK_DEPTH_PRESETS[input.depth].budget.maxDurationMs;
  const deadlineAt = Date.now() + totalDurationMs;
  const researchDurationMs = totalDurationMs * 0.6;
  const researchDeadlineAt = deadlineAt - (totalDurationMs - researchDurationMs);
  const batchSize = MULTI_REPO_BATCH_SIZE[input.depth];
  const depthBudget = input.depth === 'standard'
    ? context.repositoryChatSettings.agentBudget
    : TASK_DEPTH_PRESETS[input.depth].budget;
  const evidences: ToolEvidence[] = [];
  const missing: string[] = [];
  const research: { repository: string; sourceRefSha: string; content: string; missing: string[] }[] = [];
  const failed: string[] = [];
  const researchSources: NonNullable<RepositoryChatTurnResult['researchSources']> = [];
  const ownerId = String(useAppStore.getState().user?.id ?? '');
  const checkpointContext = JSON.stringify({ question, project: compactProject(input.project), language: context.language,
    config: [context.aiConfig.id, context.aiConfig.provider, agyProfileIdentity(context.aiConfig, 'workbench')],
    local: input.localProject?.identity, repositories: repositories.map(item => item.full_name) });
  const checkpoint = input.resumeResearch && ownerId
    ? loadResearchCheckpoint(ownerId, input.session.id, checkpointContext) : [];
  const saved: ResearchCheckpointEntry[] = [...checkpoint];
  const report = (source: NonNullable<RepositoryChatTurnResult['researchSources']>[number]) => {
    researchSources.push(source); input.onResearchSource?.(source);
  };
  let attempted = 0;
  const researchQuestion = (repository: Repository): string => [
    `Extract facts only about ${repository.full_name} from its pinned repository evidence.`,
    'This is one fact-extraction step for a later multi-repository answer, not the final comparison or recommendation.',
    'Use the overall request below only to identify relevant criteria. Report this repository\'s purpose, relevant capabilities, explicit limitations and supporting citations concisely.',
    'Do not compare with, research, or require evidence about other repositories. Their absence is not a missing requirement for this turn.',
    'Report a gap only when a requested fact about this repository is unknown. Do not expand the task to unrequested platforms or features.',
    'Stop once the relevant facts are established; the later synthesis will perform the comparison and deliver the requested answer.',
    'Overall request and project context (reference only):',
    JSON.stringify({ question, project: compactProject(input.project) }),
  ].join('\n\n');

  // Reserve equal shares for remaining repositories regardless of provider,
  // reclaiming unused time after each turn instead of letting the first CLI
  // research consume another repository's share.
  const researchConcurrency = agyFeatureConcurrency(context.aiConfig, 'workbench');
  let activeResearch = 0;
  const researchWorker = async () => {
  while (attempted < repositories.length) {
    throwIfAborted(input.signal);
    const remainingMs = researchDeadlineAt - Date.now();
    if (remainingMs <= 0) break;
    const repository = repositories[attempted];
    const remainingRepositories = repositories.length - attempted;
    const slots = Math.min(remainingRepositories + activeResearch, Math.max(1, Math.floor(remainingMs / 15_000)));
    const repositoryDurationMs = Math.floor(remainingMs / Math.max(1, Math.ceil(slots / researchConcurrency)));
    const repositoryDeadlineAt = Date.now() + repositoryDurationMs;
    attempted += 1;
    activeResearch++;
    try {
      const { result, sourceRefSha, reused, changed } = await withDeadline(async (signal) => {
        if (repository.id === -1 && input.localProject) {
          const result = await researchLocalProject(input.localProject, researchQuestion(repository), context.aiConfig,
            context.language, signal, { session: input.session, messages: input.messages, deadlineAt: repositoryDeadlineAt,
              onToolEvent: input.onToolEvent, evidenceOnly: true });
          return { result, sourceRefSha: input.localProject.identity ?? 'local-snapshot', reused: false, changed: false };
        }
        const runnerSession = await pinWorkbenchSessionToRepository(input.session, repository, context.githubToken, signal);
        throwIfAborted(signal);
        const prior = checkpoint.find(item => item.repository === repository.full_name);
        if (canReuseResearch(prior, runnerSession.sourceRefSha)) {
          return { result: prior.result, sourceRefSha: runnerSession.sourceRefSha, reused: true, changed: false };
        }
        const runnerRemainingMs = repositoryDeadlineAt - Date.now();
        if (runnerRemainingMs <= 0) throw new DOMException('Request deadline exceeded', 'TimeoutError');
        // Non-default taskDepth overrides agentBudget in the runner. Carry the
        // selected depth's limits explicitly; this intermediate turn only collects evidence.
        // Its 15s internal floor is not an admission threshold: the outer
        // deadline caps smaller shares, including SHA lookup and answer time.
        const result = await runRepositoryChatTurn({
          repository,
          session: runnerSession,
          messages: input.messages,
          question: researchQuestion(repository),
          githubToken: context.githubToken,
          aiConfig: forAgyFeature(context.aiConfig, 'workbench'),
          language: context.language,
          maxToolsPerTurn: context.repositoryChatSettings.maxToolsPerTurn,
          agentBudget: { ...depthBudget, maxDurationMs: Math.max(15_000, Math.floor(runnerRemainingMs)) },
          evidenceOnly: true,
          taskDepth: 'default',
          streaming: false,
          enableAgentToolLoop: context.repositoryChatSettings.enableAgentToolLoop,
          onToolEvent: input.onToolEvent,
          signal,
        });
        throwIfAborted(signal);
        return { result, sourceRefSha: runnerSession.sourceRefSha, reused: false, changed: !!prior };
      }, Math.min(repositoryDurationMs, remainingMs), input.signal);
      throwIfAborted(input.signal);
      const normalized = repository.id === -1 ? { content: result.content, missing: [] }
        : normalizeResearchCitations(result.content, repository.full_name, sourceRefSha, result.evidences, context.language);
      const gaps = [...(result.missing ?? []), ...normalized.missing];
      if (!result.evidences.length) {
        gaps.push(workbenchText(context.language, 'noEvidence'));
      }
      evidences.push(...result.evidences);
      missing.push(...gaps.map((gap) => `${repository.full_name}: ${gap}`));
      research.push({ repository: repository.full_name, sourceRefSha, content: normalized.content, missing: gaps });
      report({ repository: repository.full_name, status: reused ? 'reused' : changed ? 'changed' : 'complete',
        version: sourceRefSha, evidenceIds: result.evidences.map(item => item.id) });
      if (ownerId && String(useAppStore.getState().user?.id ?? '') === ownerId) {
        const index = saved.findIndex(item => item.repository === repository.full_name);
        const entry = { repository: repository.full_name, version: sourceRefSha, result, savedAt: Date.now() };
        if (index < 0) saved.push(entry); else saved[index] = entry;
        saveResearchCheckpoint(ownerId, input.session.id, checkpointContext, saved);
      }
    } catch (error) {
      if (input.signal?.aborted) throw abortError();
      failed.push(repository.full_name);
      report({ repository: repository.full_name, status: 'failed', evidenceIds: [] });
      const timedOut = (error instanceof Error || error instanceof DOMException) && error.name === 'TimeoutError';
      missing.push(`${repository.full_name}: ${timedOut ? workbenchText(context.language, 'researchTimeout') : errorMessage(error)}`);
    } finally { activeResearch--; }
  }
  };
  await Promise.all(Array.from({ length: Math.min(repositories.length, researchConcurrency) }, researchWorker));

  throwIfAborted(input.signal);
  const pendingBatches: string[][] = [];
  for (let index = attempted; index < repositories.length; index += batchSize) {
    pendingBatches.push(repositories.slice(index, index + batchSize).map((repository) => repository.full_name));
  }
  repositories.slice(attempted).forEach(repository => report({ repository: repository.full_name, status: 'pending', evidenceIds: [] }));
  pendingBatches.forEach((batch, index) => {
    missing.push(workbenchText(context.language, 'pending', { batch: index + 1, repositories: batch.join(', ') }));
  });
  const coverage = {
    requested: repositories.map((repository) => repository.full_name),
    completed: research.map((result) => result.repository),
    failed,
    pendingBatches,
  };
  const coverageLines = [
    workbenchText(context.language, 'coverage', {
      completed: research.length,
      total: repositories.length,
      repositories: coverage.completed.join(', ') || workbenchText(context.language, 'none'),
    }),
    ...missing,
  ];
  const ai = new AIService(forAgyFeature(context.aiConfig, 'workbench'), context.language);
  const allowedUrls = uniqueStrings(evidences.filter(evidence => evidence.source !== 'local').map((evidence) => evidence.url));
  const conversation = input.messages.slice(-8).map((message) => ({
    role: message.role,
    content: message.content.slice(0, 2_000),
  }));
  // Keep synthesis context bounded while giving every completed repository
  // an equal excerpt allowance, including repositories in later batches.
  const perRepositoryChars = Math.floor(72_000 / Math.max(1, research.length));
  const userPayload = JSON.stringify({
    question,
    requirements: answerRequirements(question, context.language),
    project: compactProject(input.project),
    conversation,
    repositories: coverage.requested,
    coverage,
    missing: uniqueStrings(missing),
    research: research.map((result) => ({
      ...result,
      content: result.content.slice(0, Math.min(8_000, perRepositoryChars)),
    })),
    evidence: evidences.map((evidence) => ({
      repository: evidence.repoFullName,
      source: evidence.url,
      excerpt: evidence.excerpt.slice(0, Math.floor(
        perRepositoryChars / Math.max(1, evidences.filter((item) => item.repoFullName === evidence.repoFullName).length),
      )),
    })),
    allowedUrls,
  });
  const system = [
    'Answer the user question directly, in the requested format, using the per-repository research and evidence.',
    'Preserve the requested deliverable: compare when asked to compare, explain implementation when asked how, and write the requested article or draft when asked.',
    'Ground repository facts in evidence, not unsupported claims in research summaries. Use only exact URLs from allowedUrls as Markdown links.',
    'For local project evidence, cite its project and relative file path as inline code; do not turn local source identifiers into links.',
    'Account for every requested repository using coverage and missing. Briefly identify unresearched or incomplete repositories and pending batches; do not infer that missing evidence means a feature is absent.',
    'Keep evidence gaps proportionate; they should not replace the requested answer with generic cautions or process commentary.',
    outputLanguageDirective(context.language),
    USER_REQUIREMENTS_FIRST,
  ].join('\n');

  let content: string;
  const fallbackContent = (): string => research.map((result) => `### ${result.repository}\n\n${result.content}`).join('\n\n');
  try {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) throw new DOMException('Request deadline exceeded', 'TimeoutError');
    content = await withDeadline(async (signal) => {
      const options = {
        system,
        user: userPayload,
        temperature: 0.2,
        maxTokens: input.depth === 'quick' ? 2_000 : input.depth === 'deep' ? 6_000 : 4_000,
        signal,
      };
      if (input.onChunk && context.repositoryChatSettings.streamingMode !== 'off') {
        try {
          // Only publish the final, source-validated synthesis.
          let preview = '';
          return await ai.generateChatTextStream({ ...options, onChunk: (delta) => {
            if (signal.aborted) return;
            preview += delta;
            input.onAnswerEvent?.({ phase: 'draft', content: preview });
          } });
        } catch (error) {
          throwIfAborted(signal);
          if (!isAIStreamUnsupportedError(error)) throw error;
        }
      }
      throwIfAborted(signal);
      return await ai.generateChatText(options);
    }, remainingMs, input.signal);
  } catch (error) {
    if (input.signal?.aborted) throw abortError();
    if (!(error instanceof Error || error instanceof DOMException) || error.name !== 'TimeoutError') throw error;
    const gap = workbenchText(context.language, 'synthesisTimeout');
    missing.push(gap);
    coverageLines.push(gap);
    content = fallbackContent();
  }

  throwIfAborted(input.signal);
  const unsupportedUrl = extractUrls(content).find((url) => !allowedUrls.includes(url));
  if (unsupportedUrl) throw new Error(`AI answer cited an unsupported source: ${unsupportedUrl}`);
  let quality: RepositoryChatTurnResult['quality'] = 'unreviewed';
  let claims: RepositoryChatTurnResult['claims'] = [];
  let requirementCoverage: RepositoryChatTurnResult['coverage'] = [];
  let comparison: RepositoryChatTurnResult['comparison'];
  if (content.trim() && evidences.length && Date.now() < deadlineAt) {
    input.onAnswerEvent?.({ phase: 'reviewing', content });
    try {
      const raw = await withDeadline(signal => ai.generateChatText({
        system: `${ANSWER_REVIEW_PROMPT}\nUse only the exact allowedUrls for Markdown links.
Additionally include comparison: [{repository,requirement,status:"supported"|"unsupported"|"unknown",evidenceId?,quote?}].
Use the same explicitly requested comparison dimensions for every repository. Supported or unsupported MUST cite a verbatim evidence quote from that repository.
Unsupported requires explicit negative evidence, never an absent mention. Otherwise use unknown. Do not invent unrequested comparison dimensions.
${outputLanguageDirective(context.language)}`,
        user: JSON.stringify({ question, conversation, draft: content, missing, allowedUrls,
          evidence: evidences.map(item => ({ ...item,
            excerpt: item.excerpt.slice(0, Math.floor(72_000 / evidences.length)) })) }),
        temperature: 0, maxTokens: input.depth === 'deep' ? 12_000 : 8_000, signal,
      }), deadlineAt - Date.now(), input.signal);
      throwIfAborted(input.signal);
      const review = parseAnswerQualityReview(raw, evidences);
      if (review && extractUrls(review.answer).every(url => allowedUrls.includes(url))) {
        content = review.answer;
        claims = review.claims;
        requirementCoverage = review.coverage;
        quality = 'model-reviewed';
        comparison = review.comparison?.filter(cell => repositories.some(repo => repo.full_name === cell.repository));
        const answered = new Set(review.coverage.filter(item => item.status === 'answered').map(item => item.requirement));
        missing.splice(0, missing.length, ...uniqueStrings([...missing.filter(item => !answered.has(item)), ...review.missing]));
        coverageLines.splice(1, coverageLines.length, ...missing);
      }
    } catch {
      // Keep the source-validated draft if review fails; never label it reviewed.
      throwIfAborted(input.signal);
    }
  }
  const linkedContent = appendSourceLinks(`${content.trim()}\n\n${coverageLines.join('\n\n')}`, evidences, context.language);
  input.onChunk?.(linkedContent);
  input.onAnswerEvent?.({ phase: 'final', content: linkedContent });
  return { content: linkedContent, evidences, missing: uniqueStrings(missing), quality, claims, coverage: requirementCoverage, researchSources, comparison };
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
