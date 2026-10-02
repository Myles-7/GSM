import { create } from 'zustand';
import type { AIConfig, Repository } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { analyzeRepositoryDetails } from '../../../services/repositoryDetailAnalysis';
import { getRepositoryDetailReadme } from '../../../services/repositoryDetailReadme';
import { withDeadline, waitForRequest } from '../../../utils/requestDeadline';
import { transact } from './storage';
import { reloadCustomData, useCustomDiscovery } from './store';
import type { CustomDiscoveryChannel, CustomDiscoveryData, DiscoveryAnalysisRecord, TaskIssue } from './model';
import { taskIssue } from './taskStatus';
import { scheduleModel } from './modelScheduler';
import { aiTaskJournal } from '../../../services/aiTaskJournal';
import { agyFeatureConcurrency, forAgyFeature } from '../../../services/agyProfiles';

const selectedConfig = () => {
  const state = useAppStore.getState();
  return state.aiConfigs.find(config => config.id === state.activeAIConfig);
};
// Cache identity only, not a security digest. Never store endpoints or custom prompts in keys.
const fingerprint = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
};
export const analysisKey = (repo: Repository, language: string, config = selectedConfig()) =>
  JSON.stringify([repo.id, repo.pushed_at || repo.updated_at, language, 'detail-prompt-v2',
    config?.id, config?.model, fingerprint(JSON.stringify([config?.apiType || 'openai', config?.baseUrl,
      config?.reasoningEffort, config?.mimoPlan, config?.provider,
      config?.provider === 'agy-cli' ? [config.agyEffort, config.agyFeatureOverrides?.['repository-details']?.model, config.agyFeatureOverrides?.['repository-details']?.effort] : null, config?.useCustomPrompt ? config.customPrompt : null]))]);
export function analyzedRepository(repo: Repository, data: CustomDiscoveryData, language: string, config?: AIConfig): Repository {
  const details = data.analyses?.[analysisKey(repo, language, config)]?.details;
  return details ? {
    ...repo, ai_details: details, ai_summary: details.summary || details.problem || repo.description || '',
    ai_tags: details.tags || [], ai_platforms: details.platforms || [],
    analyzed_at: details.generated_at, analysis_failed: false,
  } : repo;
}
export interface AnalysisItem {
  repo: Repository;
  channelId: string;
  revision: number;
  key: string;
  status: 'queued' | 'waiting' | 'running' | 'done' | 'failed' | 'cancelled';
  issue?: TaskIssue;
  stage?: 'readme' | 'model' | 'validation';
}
export const useCustomAnalysis = create<{
  account: string | null; running: boolean; paused: boolean; items: AnalysisItem[]; issue: TaskIssue | null;
}>(() => ({ account: null, running: false, paused: false, items: [], issue: null }));
interface Work extends AnalysisItem {
  projectStatus?: (status: AnalysisItem['status']) => void;
  account: string; token: string; language: string; configId: string; config: AIConfig; force: boolean; auto: boolean;
}
let queue: Work[] = [];
const active = new Set<{ work: Work; controller: AbortController }>();
let draining = false;
const isIdentity = (work: Work) => {
  const state = useAppStore.getState();
  return String(state.user?.id) === work.account && state.githubToken === work.token;
};
const validChannel = (data: CustomDiscoveryData, work: Work) => {
  const channel = data.channels.find(c => c.id === work.channelId);
  return !!channel && channel.revision === work.revision && !channel.blocked.includes(work.repo.id)
    && (!work.auto || (!channel.paused && channel.autoAnalyze !== false));
};
const updateItem = (work: Work, patch: Partial<AnalysisItem>) => {
  if (patch.status) work.projectStatus?.(patch.status);
  if (useCustomAnalysis.getState().account !== work.account) return;
  useCustomAnalysis.setState(state => ({
    items: state.items.map(item => item.key === work.key && item.channelId === work.channelId ? { ...item, ...patch } : item),
  }));
};
export function claimAnalysis(data: CustomDiscoveryData, work: Pick<Work, 'key' | 'channelId' | 'revision' | 'force'>, owner: string, now = Date.now()) {
  const previous = data.analyses?.[work.key];
  if ((previous?.status === 'running' && (previous.expires || 0) > now) || (previous?.details && !work.force)) return false;
  data.analyses ??= {};
  data.analyses[work.key] = {
    ...previous, status: 'running', issue: undefined, owner, expires: now + 90000,
    channelId: work.channelId, revision: work.revision, updatedAt: now,
  };
  return true;
}
export function commitAnalysis(data: CustomDiscoveryData, key: string, owner: string, patch: Partial<DiscoveryAnalysisRecord>) {
  const entry = data.analyses?.[key];
  if (!entry || entry.owner !== owner || (entry.expires || 0) <= Date.now()) return false;
  Object.assign(entry, patch, { owner: undefined, expires: undefined, updatedAt: Date.now() });
  return true;
}

async function drain() {
  if (draining) return;
  draining = true;
  useCustomAnalysis.setState({ running: true });
  try {
    const worker = async () => {
    while (queue.length) {
      if (useCustomAnalysis.getState().paused) { await waitForRequest(100); continue; }
      const work = queue.shift();
      if (!work) break;
      if (!isIdentity(work) || !validChannel(useCustomDiscovery.getState().data, work)) {
        updateItem(work, { status: 'cancelled' }); continue;
      }
      const config = work.config;
      if (!isAIConfigAvailable(config)) {
        updateItem(work, { status: 'failed', issue: { kind: 'auth' } }); continue;
      }
      const controller = new AbortController();
      const activeTask = { work, controller };
      active.add(activeTask);
      const owner = crypto.randomUUID();
      let claimed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const check = () => {
        controller.signal.throwIfAborted();
        if (!isIdentity(work) || !validChannel(useCustomDiscovery.getState().data, work)) throw new DOMException('Stale analysis', 'AbortError');
        const latest = useAppStore.getState().aiConfigs.find(c => c.id === work.configId);
        if (!latest || latest.provider === 'agy-cli' && !latest.isActive || config.provider !== 'agy-cli' && analysisKey(work.repo, work.language, latest) !== work.key) throw new DOMException('Model changed', 'AbortError');
      };
      try {
        check();
        const waitDeadline = Date.now() + 90000;
        while (!claimed) {
          claimed = await transact(work.account, data => validChannel(data, work) && claimAnalysis(data, work, owner));
          check();
          if (claimed) break;
          await reloadCustomData();
          check();
          const existing = useCustomDiscovery.getState().data.analyses?.[work.key];
          if (existing?.status !== 'running' && existing?.details && !work.force) break;
          updateItem(work, { status: 'waiting' });
          if (Date.now() >= waitDeadline) throw new DOMException('Analysis lease wait timed out', 'TimeoutError');
          await waitForRequest(1000, controller.signal);
        }
        if (!claimed) { updateItem(work, { status: 'done' }); continue; }
        heartbeat = setInterval(() => {
          void transact(work.account, data => {
            if (!isIdentity(work) || !validChannel(data, work) || data.analyses?.[work.key]?.owner !== owner) {
              controller.abort(); return;
            }
            data.analyses[work.key].expires = Date.now() + 90000;
          }).catch(() => controller.abort());
        }, 20000);
        updateItem(work, { status: 'running', stage: 'readme' });
        const evidence = await withDeadline(signal => getRepositoryDetailReadme({
          repository: work.repo, accountId: Number(work.account), githubToken: work.token, signal,
        }), 15000, controller.signal);
        check();
        const details = await analyzeRepositoryDetails({
          repository: work.repo, accountId: Number(work.account), githubToken: work.token,
          aiConfig: forAgyFeature(config, 'repository-details', 'background'), language: work.language, signal: controller.signal, readmeEvidence: evidence,
          onStage: stage => { if (!controller.signal.aborted) updateItem(work, { stage }); },
          requestModel: request => scheduleModel(
            () => withDeadline(signal => request(signal), config.provider === 'agy-cli' ? (config.agyFeatureOverrides?.['repository-details']?.timeoutSeconds ?? config.agyTimeoutSeconds ?? 180) * 1000 : 60000, controller.signal),
            controller.signal, config.requestsPerMinute, 0, config.provider === 'agy-cli',
          ),
        });
        check();
        const saved = await transact(work.account, data =>
          isIdentity(work) && !controller.signal.aborted && validChannel(data, work)
            && commitAnalysis(data, work.key, owner, { status: 'done', details, issue: undefined }));
        if (!saved) throw new DOMException('Analysis invalidated', 'AbortError');
        updateItem(work, { status: 'done' });
      } catch (error) {
        const issue = taskIssue(error);
        updateItem(work, { status: issue.kind === 'cancelled' ? 'cancelled' : 'failed', issue });
        if (claimed) await transact(work.account, data => {
          commitAnalysis(data, work.key, owner, { status: issue.kind === 'cancelled' ? 'cancelled' : 'failed', issue });
        }).catch(() => {});
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        active.delete(activeTask);
        if (isIdentity(work)) await reloadCustomData().catch(error =>
          useCustomAnalysis.setState({ issue: taskIssue(error) }));
      }
    }
    };
    const first = queue[0]?.config;
    await Promise.all(Array.from({ length: first ? agyFeatureConcurrency(first, 'repository-details') : 1 }, worker));
  } finally {
    draining = false;
    useCustomAnalysis.setState({ running: false, paused: false });
  }
}
export function enqueueAnalysis(channel: CustomDiscoveryChannel, repos: Repository[], options: { auto?: boolean; force?: boolean; configId?: string } = {}) {
  const state = useAppStore.getState();
  const account = state.user && state.githubToken ? String(state.user.id) : null;
  if (!account) return;
  const config = state.aiConfigs.find(c => c.id === (options.configId || state.activeAIConfig));
  if (!isAIConfigAvailable(config)) {
    useCustomAnalysis.setState({ account, issue: { kind: 'auth' } }); return;
  }
  if (useCustomAnalysis.getState().account !== account) useCustomAnalysis.setState({ account, items: [], paused: false });
  useCustomAnalysis.setState({ issue: null });
  const unique = [...new Map(repos.map(repo => [repo.id, repo])).values()];
  const accepted: Work[] = [];
  for (const repo of options.auto ? unique.slice(0, 10) : unique) {
    const key = analysisKey(repo, state.language, config);
    if ([...active].some(task => task.work.key === key) || queue.some(w => w.key === key)) continue;
    if (!options.force && useCustomDiscovery.getState().data.analyses?.[key]?.details) continue;
    const work: Work = {
      repo, key, channelId: channel.id, revision: channel.revision, account, token: state.githubToken!,
      language: state.language, configId: config.id, config: { ...config }, auto: !!options.auto, force: !!options.force, status: 'queued',
    };
    queue.push(work);
    accepted.push(work);
    useCustomAnalysis.setState(s => ({ items: [...s.items.filter(i => !(i.key === key && i.channelId === channel.id)),
      { repo, key, channelId: channel.id, revision: channel.revision, status: 'queued' }] }));
  }
  if (accepted.length) {
    const journal = aiTaskJournal.begin(account, 'discovery-analysis', accepted.map(work => ({ id: String(work.repo.id), label: work.repo.full_name })), config.id, channel.id);
    const finished = new Set<string>();
    journal.state(useCustomAnalysis.getState().paused ? 'paused' : 'running');
    const off = useCustomAnalysis.subscribe((next, previous) => {
      if (next.paused !== previous.paused) journal.state(next.paused ? 'paused' : 'running');
    });
    journal.bind({ pause: () => useCustomAnalysis.setState({ paused: true }), resume: () => useCustomAnalysis.setState({ paused: false }),
      stop: () => cancelAnalysis(channel.id, new Set(accepted.map(work => work.repo.id))) });
    accepted.forEach(work => { work.projectStatus = status => {
      if (finished.has(work.key)) return;
      journal.item(String(work.repo.id), status === 'done' ? 'complete' : status === 'failed' ? 'failed'
        : status === 'running' || status === 'waiting' ? 'running' : 'pending');
      if (['done', 'failed', 'cancelled'].includes(status)) finished.add(work.key);
      if (finished.size === accepted.length) { off(); journal.finish(); }
    }; });
  }
  void drain().catch(error => useCustomAnalysis.setState({ issue: taskIssue(error), running: false }));
}
export function cancelAnalysis(channelId?: string, repoIds?: Set<number>) {
  const matches = (work: Work) => (!channelId || work.channelId === channelId) && (!repoIds || repoIds.has(work.repo.id));
  for (const work of queue.filter(matches)) updateItem(work, { status: 'cancelled' });
  queue = queue.filter(work => !matches(work));
  for (const task of active) if (matches(task.work)) task.controller.abort();
  if (!queue.length || !channelId) useCustomAnalysis.setState({ paused: false });
}
export function invalidateAnalysis() {
  for (const work of [...queue, ...[...active].map(task => task.work)]) {
    if (!isIdentity(work) || !validChannel(useCustomDiscovery.getState().data, work)) cancelAnalysis(work.channelId, new Set([work.repo.id]));
  }
}
import { isAIConfigAvailable } from '../../../utils/aiConfig';
