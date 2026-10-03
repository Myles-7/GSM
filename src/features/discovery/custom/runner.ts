import { useAppStore } from '../../../store/useAppStore';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { AIService } from '../../../services/aiService';
import { selectAnalysisContext } from '../../../services/analysisContext';
import type { AIConfig, Repository } from '../../../types';
import { bindTaskSignal, inheritTaskSignal, type TaskHandle } from '../../../services/taskExecution';
import { withDeadline, waitForRequest } from '../../../utils/requestDeadline';
import { taskIssue } from './taskStatus';
import {
  assessResults, buildQuery, effectiveRules, lexicalScore, localDay, passesFilters, rankAssessments,
  type CandidateAssessment, type ChannelDailyEdition, type CustomDiscoveryChannel, type CustomDiscoveryData,
  type CandidatePreview, type TaskProgress, type TaskIssue,
} from './model';
import { acquireLease, loadData, releaseLease, transact } from './storage';
import { getRepositoryDetailReadme } from '../../../services/repositoryDetailReadme';
import { enqueueAnalysis, cancelAnalysis } from './analysis';
import { useCustomDiscovery } from './store';
import { scheduleModel } from './modelScheduler';
import { agyFeatureConcurrency } from '../../../services/agyProfiles';

export function currentAccount(): string | null {
  const state = useAppStore.getState();
  return state.githubToken && state.user ? String(state.user.id) : null;
}
export function activeAI(priority: 'interactive' | 'background' = 'interactive', selected?: AIConfig): AIService {
  const state = useAppStore.getState();
  const config = selected ?? state.aiConfigs.find(c => c.id === state.activeAIConfig);
  if (!isAIConfigAvailable(config)) {
    throw new Error('Please configure an AI service / 请先配置可用的 AI 服务');
  }
  return new AIService(config.provider === 'agy-cli' ? { ...config, agyFeature: 'discovery' as const, agyPriority: priority } : config, state.language, true);
}
export const evidenceText = (repo: Repository, readme: string) => [
  `Repository: ${repo.full_name}`, `Description: ${repo.description || ''}`,
  `Language: ${repo.language || 'Unknown'}`, `Stars: ${repo.stargazers_count}`,
  `Created: ${repo.created_at}`, `Topics: ${(repo.topics || []).join(', ')}`, selectAnalysisContext(readme, 12000),
].join('\n');

interface Session {
  config?: AIConfig;
  account: string;
  token: string;
  signal: AbortSignal;
  budget: { remaining: number };
  cache: CustomDiscoveryData['cache'];
  trending: Promise<Repository[]>;
  progress: (id: string, message: TaskProgress | null) => void;
}
interface Collection { edition: ChannelDailyEdition; cursors: number[]; rejected?: number[] }

async function collect(channel: CustomDiscoveryChannel, session: Session): Promise<Collection> {
  const { account, token, signal, budget, cache } = session;
  const check = () => {
    signal.throwIfAborted();
    if (currentAccount() !== account || useAppStore.getState().githubToken !== token) throw new DOMException('Session changed', 'AbortError');
  };
  const api = createGitHubApiService(token);
  const candidates = new Map<number, Repository>();
  const relations = new Map<number, 'direct' | 'ecosystem'>();
  const rejected = new Set<number>();
  const issues: TaskIssue[] = [];
  const rules = effectiveRules(channel.plan, channel.ruleOverrides);
  const cursors = [...channel.cursors];
  let searched = 0;
  let filtered = 0;
  let complete = true;
  let assessments: CandidateAssessment[] = [];
  const fallback = (repo: Repository): CandidateAssessment => ({
    repo, verdict: rules.plan.required.length || rules.plan.excluded.length ? 'unknown' : 'match',
    reason: '', evidence: [], method: 'rules', relevance: lexicalScore(repo, rules.plan), preference: 0,
    relation: relations.get(repo.id) ?? 'direct',
  });
  const starred = new Set(useAppStore.getState().repositories.map(r => r.id));
  const add = (repo: Repository) => {
    if (candidates.has(repo.id)) return;
    if (!passesFilters(repo, channel, starred)) { filtered++; return; }
    if (candidates.size < 200) candidates.set(repo.id, repo);
  };
  // Alternate recent and relevance paths; round-robin merge avoids the first branch monopolizing the pool.
  const pages: Repository[][] = [];
  try {
  for (let branch = 0; branch < rules.plan.branches.length; branch++) {
    for (const recent of [false, true]) {
      check();
      if (budget.remaining <= 0) { complete = false; break; }
      budget.remaining--;
      searched++;
      session.progress(channel.id, { phase: 'search', current: searched, total: rules.plan.branches.length * 2 });
      try {
        const page = recent ? 1 : cursors[branch] || 1;
        const result = await api.searchDiscoveryCandidates(buildQuery(channel.plan, branch, recent, new Date(), channel.ruleOverrides), page, recent, signal, rules.sort);
        check();
        pages.push(result.items);
        for (const repo of result.items) {
          const relation = rules.plan.branches[branch].role === 'ecosystem' ? 'ecosystem' : 'direct';
          if (!relations.has(repo.id) || relation === 'direct') relations.set(repo.id, relation);
        }
        if (result.incomplete) { complete = false; }
        if (!recent && !result.incomplete) cursors[branch] = result.hasMore ? page + 1 : 1;
      } catch (error) {
        issues.push({ ...taskIssue(error), source: 'github' });
        complete = false;
        // Stop on upstream errors instead of repeatedly hitting a possibly exhausted search quota.
        break;
      }
      await waitForRequest(2200, signal);
    }
    if (issues.length || budget.remaining <= 0) break;
  }
  for (let i = 0; i < 50; i++) for (const page of pages) if (page[i]) add(page[i]);
  check();
  try {
    for (const repo of await session.trending) {
      if (lexicalScore(repo, rules.plan) > 0) add(repo);
    }
  } catch { /* Trending is supplementary and does not determine search completion. */ }
  check();
  const pool = rankAssessments([...candidates.values()].map(fallback), rules.sort).slice(0, 40).map(a => a.repo);
  assessments = pool.map(repo => ({ ...fallback(repo), screening: channel.ai }));
  const notifyCandidates = () => {
    check();
    useCustomDiscovery.setState(state => ({
      candidates: { ...state.candidates, [channel.id]: { revision: channel.revision, date: localDay(), items: [...assessments] } },
    }));
  };
  notifyCandidates();
  if (channel.autoAnalyze !== false) enqueueAnalysis(channel, pool, { auto: true });
  if (channel.ai && pool.length) {
    try {
      const ai = activeAI('background', session.config);
      const config = session.config;
      let nextOffset = 0, readCount = 0, screenedCount = 0;
      const screenWorker = async () => {
      while (nextOffset < pool.length) {
      const offset = nextOffset; nextOffset += 5;
      const batch: { repo: Repository; text: string }[] = [];
      for (let i = offset; i < Math.min(offset + 5, pool.length); i++) {
        check();
        const repo = pool[i];
        session.progress(channel.id, { phase: 'readme', current: ++readCount, total: pool.length });
        let stored = cache[String(repo.id)];
        if (!stored || stored.pushedAt !== repo.pushed_at || Date.now() - stored.fetchedAt > 7 * 86400000) {
          try {
            const evidence = await withDeadline(s => getRepositoryDetailReadme({
              repository: repo, accountId: Number(account), githubToken: token, signal: s,
            }), 15000, signal);
            check();
            stored = { text: evidence.content.slice(0, 36000), fetchedAt: Date.now(), pushedAt: repo.pushed_at };
            cache[String(repo.id)] = stored;
          } catch (error) {
            issues.push({ ...taskIssue(error), source: 'github' });
            check();
          }
        }
        batch.push({ repo, text: evidenceText(repo, stored?.text || '') });
      }
        check();
        session.progress(channel.id, { phase: 'screen', current: screenedCount, total: pool.length });
        try {
          const response = await scheduleModel(
            () => withDeadline(s => ai.assessDiscoverySubscription(rules.plan, batch.map(c => ({ id: c.repo.id, text: c.text })), s), config?.provider === 'agy-cli' ? (config.agyFeatureOverrides?.discovery?.timeoutSeconds ?? config.agyTimeoutSeconds ?? 180) * 2000 : 60000, signal),
            signal, config?.requestsPerMinute, 1, config?.provider === 'agy-cli',
          );
          check();
          const judged = assessResults(JSON.parse(response.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()), batch, rules.plan)
            .map(a => ({ ...a, relation: relations.get(a.repo.id) ?? 'direct' as const }));
          batch.filter(c => !judged.some(a => a.repo.id === c.repo.id)).forEach(c => rejected.add(c.repo.id));
          assessments = [...assessments.filter(a => !batch.some(c => c.repo.id === a.repo.id)), ...judged];
          cancelAnalysis(channel.id, new Set(batch.filter(c => !judged.some(a => a.repo.id === c.repo.id)).map(c => c.repo.id)));
          notifyCandidates();
        } catch (error) {
          issues.push({ ...taskIssue(error), source: 'ai' });
          check();
        }
        screenedCount += batch.length;
        session.progress(channel.id, { phase: 'screen', current: screenedCount, total: pool.length });
      }
      };
      await Promise.all(Array.from({ length: config ? agyFeatureConcurrency(config, 'discovery') : 1 }, screenWorker));
    } catch (error) {
      issues.push({ ...taskIssue(error), source: 'ai' });
    }
  }
  } catch (error) {
    issues.push(taskIssue(error));
    // Keep completed batches; do not discard results on the overall deadline.
    if (!assessments.length) {
      for (let i = 0; i < 50; i++) for (const page of pages) if (page[i]) add(page[i]);
      assessments = [...candidates.values()].map(fallback);
    }
  }
  const ranked = rankAssessments(assessments.map(a => ({ ...a, screening: undefined })), rules.sort);
  return {
    cursors,
    rejected: [...rejected],
    edition: {
      channelId: channel.id, date: localDay(), revision: channel.revision, instruction: channel.instruction,
      entries: ranked.filter(a => a.verdict === 'match').slice(0, channel.limit),
      pending: ranked.filter(a => a.verdict === 'unknown'),
      errors: [], issues: issues.slice(0, 20), ruleSnapshot: rules, complete: complete && issues.length === 0,
      searched, filtered, generatedAt: new Date().toISOString(),
    },
  };
}

export function publish(data: CustomDiscoveryData, channel: CustomDiscoveryChannel, result: Collection, owner: string, now = Date.now()): boolean {
  if (data.lease?.owner !== owner || data.lease.expires <= now) return false;
  const current = data.channels.find(c => c.id === channel.id);
  if (!current || current.revision !== channel.revision || current.paused) return false;
  const edition = result.edition;
  const previous = data.editions.find(e => e.channelId === channel.id && e.date === edition.date && e.revision === channel.revision);
  const existing = previous?.entries || [];
  const publishedToday = Object.entries(current.recommended)
    .filter(([id, date]) => date === edition.date && current.manualAccepted?.[id] !== edition.date).length;
  const rules = effectiveRules(current.plan, current.ruleOverrides);
  const added = edition.entries.filter(a => {
    const previousDate = current.recommended[String(a.repo.id)];
    return !current.blocked.includes(a.repo.id) && (!previousDate || (!rules.excludeRecommended && previousDate !== edition.date));
  })
    .slice(0, Math.max(0, current.limit - publishedToday));
  for (const a of added) current.recommended[String(a.repo.id)] = edition.date;
  edition.entries = [...existing, ...added];
  edition.pending = [...new Map([...(previous?.pending || []), ...edition.pending].map(a => [a.repo.id, a])).values()].filter(a => {
    const previousDate = current.recommended[String(a.repo.id)];
    return !result.rejected?.includes(a.repo.id) && !current.blocked.includes(a.repo.id)
      && (!previousDate || (!rules.excludeRecommended && previousDate !== edition.date));
  });
  current.cursors = result.cursors;
  current.lastRefresh = edition.generatedAt;
  if (edition.complete) current.lastCompletedDate = edition.date;
  current.retryAt = Math.max(0, ...(edition.issues || []).map(i => i.retryAt || 0));
  data.editions = data.editions.filter(e => !(e.channelId === edition.channelId && e.date === edition.date && e.revision === edition.revision)
    && now - Date.parse(`${e.date}T12:00:00`) < 90 * 86400000);
  data.editions.push(edition);
  return true;
}

let activeController: AbortController | null = null;
let activeRun: { id: string; cancelled: Set<string>; revisions: Map<string, number>; channelId?: string; channelController?: AbortController } | null = null;
export const cancelCustomRun = (scope: { channelId?: string; runId?: string } = {}) => {
  if (scope.runId && activeRun?.id !== scope.runId) return;
  if (scope.channelId) {
    activeRun?.cancelled.add(scope.channelId);
    if (activeRun?.channelId === scope.channelId) activeRun.channelController?.abort();
    cancelAnalysis(scope.channelId);
  } else { activeController?.abort(); cancelAnalysis(); }
};

export function invalidateCustomRun(): void {
  if (!activeRun) return;
  const channels = useCustomDiscovery.getState().data.channels;
  for (const [id, revision] of activeRun.revisions) {
    const current = channels.find(channel => channel.id === id);
    if (!current || current.paused || current.revision !== revision) cancelCustomRun({ channelId: id });
  }
}

export async function runChannels(ids: string[], progress: Session['progress'], onUpdated: () => Promise<void>, options: { config?: AIConfig; task?: TaskHandle } = {}): Promise<void> {
  if (activeController) throw new Error('A discovery task is already running / 已有发现任务正在运行');
  const account = currentAccount();
  const token = useAppStore.getState().githubToken;
  if (!account || !token) throw new Error('Please sign in / 请先登录');
  const controller = new AbortController();
  if (options.task) bindTaskSignal(controller.signal, options.task);
  const state = useAppStore.getState();
  const config = options.config ?? state.aiConfigs.find(item => item.id === state.activeAIConfig);
  activeController = controller;
  const owner = crypto.randomUUID();
  activeRun = { id: owner, cancelled: new Set(), revisions: new Map() };
  let leased = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const timeout = setTimeout(() => controller.abort(new DOMException('Task deadline exceeded', 'TimeoutError')), 15 * 60 * 1000);
  try {
    leased = await acquireLease(account, owner);
    if (!leased) throw new Error('Discovery is running in another window / 其他窗口正在运行发现任务');
    heartbeat = setInterval(() => {
      if (currentAccount() !== account || useAppStore.getState().githubToken !== token) controller.abort();
      void acquireLease(account, owner).then(ok => { if (!ok) controller.abort(); }).catch(() => controller.abort());
    }, 30000);
    const data = await loadData(account);
    const loadedTrending = useAppStore.getState().discoveryRepos.trending || [];
    const trending = loadedTrending.length
      ? Promise.resolve(loadedTrending)
      : withDeadline(s => createGitHubApiService(token).getTrendingRepositories('All', 1, 20, 'daily', s).then(result => result.repos), 15000, controller.signal).catch(() => []);
    const session: Session = { account, token, config, signal: controller.signal, budget: { remaining: 60 }, cache: data.cache, trending, progress };
    const channels = data.channels.filter(c => ids.includes(c.id) && !c.paused)
      .sort((a, b) => (a.lastRefresh || '').localeCompare(b.lastRefresh || ''));
    if (activeRun) activeRun.revisions = new Map(channels.map(channel => [channel.id, channel.revision]));
    invalidateCustomRun();
    for (let index = 0; index < channels.length; index++) {
      const channel = channels[index];
      if (activeRun?.cancelled.has(channel.id)) { progress(channel.id, null); continue; }
      controller.signal.throwIfAborted();
      const channelController = new AbortController();
      inheritTaskSignal(controller.signal, channelController.signal);
      const abortChannel = () => channelController.abort(controller.signal.reason);
      controller.signal.addEventListener('abort', abortChannel, { once: true });
      if (activeRun) { activeRun.channelId = channel.id; activeRun.channelController = channelController; }
      if (session.budget.remaining <= 0) break;
      const share = Math.min(12, Math.max(1, Math.floor(session.budget.remaining / (channels.length - index))));
      const localBudget = { remaining: share };
      const result = await collect(channel, { ...session, signal: channelController.signal, budget: localBudget });
      controller.signal.removeEventListener('abort', abortChannel);
      session.budget.remaining -= share - localBudget.remaining;
      if (activeRun?.cancelled.has(channel.id)) { progress(channel.id, null); continue; }
      if (currentAccount() !== account || useAppStore.getState().githubToken !== token) return;
      progress(channel.id, { phase: 'publish', current: 0, total: 1 });
      await transact(account, fresh => {
        if (publish(fresh, channel, result, owner)) {
          fresh.cache = Object.fromEntries(Object.entries(session.cache)
            .filter(([, v]) => Date.now() - v.fetchedAt < 7 * 86400000).slice(-400));
        }
      });
      await onUpdated();
      useCustomDiscovery.setState(state => {
        const candidates = { ...state.candidates };
        delete candidates[channel.id];
        return { candidates };
      });
      progress(channel.id, null);
      if (controller.signal.aborted) break;
    }
  } finally {
    clearTimeout(timeout);
    if (heartbeat) clearInterval(heartbeat);
    activeController = null;
    activeRun = null;
    if (currentAccount() === account && useAppStore.getState().githubToken === token) {
      useCustomDiscovery.setState(state => ({
        candidates: Object.fromEntries(Object.entries(state.candidates).filter(([id]) => !ids.includes(id))),
      }));
    }
    if (leased) await releaseLease(account, owner);
  }
}

export async function previewChannel(channel: CustomDiscoveryChannel, signal: AbortSignal, onProgress?: (progress: TaskProgress) => void): Promise<CandidatePreview> {
  const account = currentAccount();
  const token = useAppStore.getState().githubToken;
  if (!account || !token) throw new Error('Please sign in / 请先登录');
  const candidates = new Map<number, Repository>();
  const issues: TaskIssue[] = [];
  let searched = 0;
  let complete = true;
  const rules = effectiveRules(channel.plan, channel.ruleOverrides);
  const api = createGitHubApiService(token);
  const starred = new Set(useAppStore.getState().repositories.map(r => r.id));
  try {
    await withDeadline(async deadlineSignal => {
      const count = Math.min(3, rules.plan.branches.length);
      for (let branch = 0; branch < count; branch++) {
        deadlineSignal.throwIfAborted();
        onProgress?.({ phase: 'search', current: branch + 1, total: count });
        searched++;
        const result = await api.searchDiscoveryCandidates(buildQuery(channel.plan, branch, false, new Date(), channel.ruleOverrides), 1, false, deadlineSignal, rules.sort);
        deadlineSignal.throwIfAborted();
        if (currentAccount() !== account || useAppStore.getState().githubToken !== token) throw new DOMException('Session changed', 'AbortError');
        for (const repo of result.items) if (passesFilters(repo, channel, starred)) candidates.set(repo.id, repo);
        if (result.incomplete) complete = false;
        if (branch + 1 < count) await waitForRequest(2200, deadlineSignal);
      }
    }, 30000, signal);
  } catch (error) {
    if (signal.aborted || taskIssue(error).kind === 'cancelled') throw error;
    issues.push(taskIssue(error));
    complete = false;
  }
  const ranked = rankAssessments([...candidates.values()].map(repo => ({
    repo, verdict: 'unknown' as const, method: 'rules' as const, evidence: [], reason: '',
    relevance: lexicalScore(repo, rules.plan), preference: 0,
  })), rules.sort);
  return { candidates: ranked.slice(0, 10).map(a => a.repo), searched, issues, complete };
}
import { isAIConfigAvailable } from '../../../utils/aiConfig';
