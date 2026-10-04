import { platformsFromDetails } from '../../../utils/platformNormalization';
import { create } from 'zustand';
import type { AIConfig, Repository } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { analyzeRepositoryDetails } from '../../../services/repositoryDetailAnalysis';
import { getRepositoryDetailReadme } from '../../../services/repositoryDetailReadme';
import { withDeadline, waitForRequest } from '../../../utils/requestDeadline';
import { transact } from './storage';
import { reloadCustomData, useCustomDiscovery } from './store';
import type { CustomDiscoveryChannel, CustomDiscoveryData, TaskIssue } from './model';
import { taskIssue, issueLabel } from './taskStatus';
import { scheduleModel } from './modelScheduler';
import { aiTaskJournal, taskError } from '../../../services/aiTaskJournal';
import { taskConfigSnapshot, type TaskHandle, bindTaskSignal } from '../../../services/taskExecution';
import { agyFeatureConcurrency, agyFeatureTimeoutSeconds, forAgyFeature } from '../../../services/agyProfiles';
import { discoveryAnalysisIdentity } from './analysisIdentity';
import { beginRepositoryAnalysisWrite } from '../../../services/repositoryAnalysisWrites';
import { applyRepositoryAnalysisAsset, assertRepositoryAnalysisAssetWrite, beginRepositoryAnalysisAssetWrite, canUseLegacyRepositoryAnalysisAssets, claimRepositoryAnalysisTask, commitRepositoryAnalysisTask, findLegacyRepositoryAnalysisAsset, hasRepositoryAnalysisAsset, initializeRepositoryAnalysisAssets, projectRepositoryAnalysisAsset, saveRepositoryAnalysisAsset, type RepositoryAnalysisAssetWriteVersion } from '../../../services/repositoryAnalysisAssets';

const selectedConfig = () => {
  const state = useAppStore.getState();
  return state.aiConfigs.find(config => config.id === state.activeAIConfig);
};
export const analysisKey = (repo: Repository, language: string, config = selectedConfig()) =>
  discoveryAnalysisIdentity(repo, language, config);
export function analyzedRepository(repo: Repository, data: CustomDiscoveryData, language: string, config?: AIConfig): Repository {
  const account = String(useAppStore.getState().user?.id ?? '');
  if (account && hasRepositoryAnalysisAsset(account, repo, language)) return applyRepositoryAnalysisAsset(account, repo, language);
  const scopedLegacy = account && useCustomDiscovery.getState().account === account && canUseLegacyRepositoryAnalysisAssets(account, repo.id);
  const legacy = scopedLegacy && findLegacyRepositoryAnalysisAsset(account, repo, language, data);
  if (legacy) return projectRepositoryAnalysisAsset(repo, legacy);
  // Keep the exact-key fallback for old account-scoped fixtures and older detail schemas.
  const details = scopedLegacy ? data.analyses?.[analysisKey(repo, language, config)]?.details : undefined;
  return details ? {
    ...repo, ai_details: details, ai_summary: details.summary || details.problem || repo.description || '',
    ai_tags: details.tags || [], ai_platforms: platformsFromDetails(details),
    analyzed_at: details.generated_at, analysis_failed: false,
  } : {
    ...repo, ai_details: undefined, ai_summary: undefined, ai_tags: undefined, ai_platforms: undefined,
    analyzed_at: undefined, analysis_failed: false, analysis_error: undefined,
  };
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
  account: string | null; running: boolean; paused: boolean; pausedChannels: Record<string, boolean>; items: AnalysisItem[]; issue: TaskIssue | null; issuesByChannel: Record<string, TaskIssue | null>;
}>(() => ({ account: null, running: false, paused: false, pausedChannels: {}, items: [], issue: null, issuesByChannel: {} }));
export const setAnalysisPaused = (channelId: string, paused: boolean) =>
  useCustomAnalysis.setState(s => ({ pausedChannels: { ...s.pausedChannels, [channelId]: paused } }));
interface Work extends AnalysisItem {
  assetWrite: Promise<{ version: RepositoryAnalysisAssetWriteVersion } | { error: unknown }>;
  projectStatus?: (status: AnalysisItem['status'], issue?: TaskIssue, stage?: string) => void;
  journal?: TaskHandle;
  configBaseline?: string;
  failureError?: string;
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
  if (work.channelId.startsWith('builtin:')) {
    const id = work.channelId.slice('builtin:'.length);
    return useAppStore.getState().discoveryChannels.some(c => c.id === id && c.enabled)
      && (!work.auto || data.builtinPreferences?.[id]?.autoAnalyze === true);
  }
  const channel = data.channels.find(c => c.id === work.channelId);
  return !!channel && channel.revision === work.revision && !channel.blocked.includes(work.repo.id)
    && (!work.auto || (!channel.paused && channel.autoAnalyze !== false));
};
const updateItem = (work: Work, patch: Partial<AnalysisItem>) => {
  Object.assign(work, patch);
  if (patch.status || patch.stage) work.projectStatus?.(patch.status ?? work.status, patch.issue, patch.stage);
  if (useCustomAnalysis.getState().account !== work.account) return;
  useCustomAnalysis.setState(state => ({
    items: state.items.map(item => item.key === work.key && item.channelId === work.channelId ? { ...item, ...patch } : item),
  }));
};
export const claimAnalysis = claimRepositoryAnalysisTask;
export const commitAnalysis = commitRepositoryAnalysisTask;

async function drain() {
  if (draining) return;
  draining = true;
  useCustomAnalysis.setState({ running: true });
  try {
    const initialization = new Map<string, Promise<void>>();
    const worker = async () => {
    while (queue.length) {
      const pauses = useCustomAnalysis.getState();
      const index = queue.findIndex(work => !pauses.paused && !pauses.pausedChannels[work.channelId]);
      if (index < 0) { await waitForRequest(100); continue; }
      const [work] = queue.splice(index, 1);
      if (!work) break;
      if (!isIdentity(work) || !validChannel(useCustomDiscovery.getState().data, work)) {
        updateItem(work, { status: 'cancelled' }); continue;
      }
      const config = work.config;
      if (!isAIConfigAvailable(config)) {
        updateItem(work, { status: 'failed', issue: { kind: 'auth' } }); continue;
      }
      const controller = new AbortController();
      if (work.journal) bindTaskSignal(controller.signal, work.journal);
      const activeTask = { work, controller };
      active.add(activeTask);
      const owner = crypto.randomUUID();
      let claimed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let source: TaskIssue['source'] = 'storage';
      const check = () => {
        controller.signal.throwIfAborted();
        if (!isIdentity(work) || !validChannel(useCustomDiscovery.getState().data, work)) throw new DOMException('Stale analysis', 'AbortError');
        const latest = useAppStore.getState().aiConfigs.find(c => c.id === work.configId);
        if (!latest || latest.provider === 'agy-cli' && !latest.isActive || config.provider !== 'agy-cli' && analysisKey(work.repo, work.language, latest) !== work.configBaseline) throw new DOMException('Model changed', 'AbortError');
      };
      try {
        check();
        if (!initialization.has(work.account)) initialization.set(work.account, initializeRepositoryAnalysisAssets(
          work.account, useAppStore.getState().repositories ?? [], useCustomDiscovery.getState().data));
        await initialization.get(work.account);
        check();
        if (!work.force && hasRepositoryAnalysisAsset(work.account, work.repo, work.language)) {
          updateItem(work, { status: 'done' }); continue;
        }
        const initialWrite = await work.assetWrite;
        if ('error' in initialWrite) throw initialWrite.error;
        const assetVersion = initialWrite.version;
        await assertRepositoryAnalysisAssetWrite(assetVersion);
        check();
        const claim = { ...work, force: work.force || !canUseLegacyRepositoryAnalysisAssets(work.account, work.repo.id) };
        const waitDeadline = Date.now() + 90000;
        while (!claimed) {
          claimed = await transact(work.account, data => validChannel(data, work) && claimAnalysis(data, claim, owner));
          check();
          if (claimed) break;
          await reloadCustomData();
          check();
          const existing = useCustomDiscovery.getState().data.analyses?.[work.key];
          if (existing?.status !== 'running' && existing?.details && !claim.force) break;
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
        const mergeWrite = beginRepositoryAnalysisWrite(Number(work.account), work.repo.id, true);
        source = 'github';
        const evidence = await withDeadline(signal => getRepositoryDetailReadme({
          repository: work.repo, accountId: Number(work.account), githubToken: work.token, signal,
        }), 15000, controller.signal);
        check();
        source = 'ai';
        const details = await analyzeRepositoryDetails({
          repository: work.repo, accountId: Number(work.account), githubToken: work.token,
          aiConfig: forAgyFeature(config, 'repository-details', 'background'), language: work.language, signal: controller.signal, readmeEvidence: evidence,
          onStage: stage => { if (!controller.signal.aborted) updateItem(work, { stage }); },
          requestModel: request => scheduleModel(
            () => withDeadline(signal => request(signal), agyFeatureTimeoutSeconds(config, 'repository-details') * 1000, controller.signal),
            controller.signal, config.requestsPerMinute, 0, config.provider === 'agy-cli',
          ),
        });
        check();
        source = 'storage';
        await assertRepositoryAnalysisAssetWrite(assetVersion);
        check();
        const saved = await transact(work.account, data =>
          isIdentity(work) && !controller.signal.aborted && validChannel(data, work)
            && commitAnalysis(data, work.key, owner, { status: 'done', details, issue: undefined }));
        if (!saved) throw new DOMException('Analysis invalidated', 'AbortError');
        await saveRepositoryAnalysisAsset(work.account, work.repo, work.language, config, details, assetVersion);
        await assertRepositoryAnalysisAssetWrite(assetVersion);
        check();
        const latestState = useAppStore.getState();
        const starred = latestState.repositories?.find(repo => repo.id === work.repo.id);
        if (starred) latestState.updateRepository(mergeWrite(starred,
          applyRepositoryAnalysisAsset(work.account, starred, work.language)));
        updateItem(work, { status: 'done' });
      } catch (error) {
        const issue = taskIssue(error, source);
        work.failureError = `${issueLabel(issue, work.language.startsWith('zh'))} ${taskError(error)}`;
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
export function enqueueAnalysis(channel: Pick<CustomDiscoveryChannel, 'revision' | 'autoAnalysisLimit'> & { id: string }, repos: Repository[], options: { auto?: boolean; autoLimit?: number; force?: boolean; configId?: string; retry?: { config: AIConfig; parentId: string } } = {}) {
  const state = useAppStore.getState();
  const account = state.user && state.githubToken ? String(state.user.id) : null;
  if (!account) return;
  const config = options.retry?.config ?? state.aiConfigs.find(c => c.id === (options.configId || state.activeAIConfig));
  if (!isAIConfigAvailable(config)) {
    useCustomAnalysis.setState(s => ({ account, issue: { kind: 'auth', source: 'ai' }, issuesByChannel: { ...s.issuesByChannel, [channel.id]: { kind: 'auth', source: 'ai' } } })); return;
  }
  if (useCustomAnalysis.getState().account !== account) useCustomAnalysis.setState({ account, items: [], paused: false, pausedChannels: {} });
  useCustomAnalysis.setState(s => ({ issue: null, issuesByChannel: { ...s.issuesByChannel, [channel.id]: null } }));
  const unique = [...new Map(repos.map(repo => [repo.id, repo])).values()];
  const data = useCustomDiscovery.getState().data;
  const customChannel = data.channels.find(item => item.id === channel.id);
  const configuredLimit = options.autoLimit ?? customChannel?.autoAnalysisLimit ?? channel.autoAnalysisLimit
    ?? data.builtinPreferences?.[channel.id.replace(/^builtin:/, '')]?.autoAnalysisLimit ?? 10;
  const autoLimit = Number.isFinite(configuredLimit) ? Math.min(10, Math.max(1, Math.floor(configuredLimit))) : 10;
  const force = !!options.force && !options.auto;
  const accepted: Work[] = [];
  const candidates = force ? unique : unique.filter(repo =>
    !hasRepositoryAnalysisAsset(account, repo, state.language) && !analyzedRepository(repo, data, state.language, config).ai_details);
  for (const repo of options.auto ? candidates.slice(0, autoLimit) : candidates) {
    const key = analysisKey(repo, state.language, config);
    if ([...active].some(task => task.work.key === key) || queue.some(w => w.key === key)) continue;
    if (!force && (hasRepositoryAnalysisAsset(account, repo, state.language)
      || analyzedRepository(repo, useCustomDiscovery.getState().data, state.language, config).ai_details)) continue;
    const work: Work = {
      assetWrite: beginRepositoryAnalysisAssetWrite(account, repo.id).then(version => ({ version }), error => ({ error })),
      repo, key, channelId: channel.id, revision: channel.revision, account, token: state.githubToken!,
      language: state.language, configId: config.id, config: { ...config },
      configBaseline: analysisKey(repo, state.language, state.aiConfigs.find(item => item.id === config.id)),
      auto: !!options.auto, force, status: 'queued',
    };
    queue.push(work);
    accepted.push(work);
    useCustomAnalysis.setState(s => ({ items: [...s.items.filter(i => !(i.key === key && i.channelId === channel.id)),
      { repo, key, channelId: channel.id, revision: channel.revision, status: 'queued' }] }));
  }
  if (accepted.length) {
    const journal = aiTaskJournal.begin(account, 'discovery-analysis', accepted.map(work => ({ id: String(work.repo.id), label: work.repo.full_name })), config.id, channel.id);
    journal.metadata({ title: useCustomDiscovery.getState().data.channels.find(item => item.id === channel.id)?.name ?? channel.id,
      trigger: options.auto ? 'automatic' : 'manual', parentId: options.retry?.parentId, config: taskConfigSnapshot(config, 'repository-details'), target: { view: 'subscription', id: channel.id } });
    const finished = new Set<string>();
    journal.state(useCustomAnalysis.getState().pausedChannels[channel.id] ? 'paused' : 'running');
    const off = useCustomAnalysis.subscribe((next, previous) => {
      if (next.pausedChannels[channel.id] !== previous.pausedChannels[channel.id]) journal.state(next.pausedChannels[channel.id] ? 'paused' : 'running');
    });
    journal.bind({ pause: () => setAnalysisPaused(channel.id, true), resume: () => setAnalysisPaused(channel.id, false),
      stop: () => cancelAnalysis(channel.id, new Set(accepted.map(work => work.repo.id))) });
    accepted.forEach(work => { work.journal = journal; work.projectStatus = (status, issue, stage) => {
      if (finished.has(work.key)) return;
      journal.item(String(work.repo.id), status === 'done' ? 'complete' : status === 'failed' ? 'failed'
        : status === 'cancelled' ? 'canceled' : status === 'running' || status === 'waiting' ? 'running' : 'pending',
        issue ? work.failureError ?? issueLabel(issue, work.language.startsWith('zh')) : undefined, stage ?? work.stage);
      if (stage) journal.metadata({ phase: stage });
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
  if (!queue.length || (!channelId && !repoIds)) useCustomAnalysis.setState({ paused: false });
  if (channelId && !repoIds) setAnalysisPaused(channelId, false);
  else if (!channelId && !repoIds) useCustomAnalysis.setState({ pausedChannels: {} });
}
export function invalidateAnalysis() {
  for (const work of [...queue, ...[...active].map(task => task.work)]) {
    if (!isIdentity(work) || !validChannel(useCustomDiscovery.getState().data, work)) cancelAnalysis(work.channelId, new Set([work.repo.id]));
  }
}
import { isAIConfigAvailable } from '../../../utils/aiConfig';
if (typeof window !== 'undefined') window.addEventListener('gsm:repository-analysis-tasks-cancel', event => {
  const detail = (event as CustomEvent<{ account?: string; repositoryIds?: number[] }>).detail;
  if (!detail.account || useCustomAnalysis.getState().account === detail.account) cancelAnalysis(undefined,
    detail.repositoryIds ? new Set(detail.repositoryIds) : undefined);
});
