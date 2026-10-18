import { platformsFromDetails } from '../../../utils/platformNormalization';
import { useEffect, useSyncExternalStore } from 'react';
import { isAIConfigAvailable } from '../../../utils/aiConfig';
import type { Repository, AIConfig } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { analyzeRepositoryDetails } from '../../../services/repositoryDetailAnalysis';
import { forceSyncToBackend } from '../../../services/autoSync';
import { aiTaskJournal } from '../../../services/aiTaskJournal';
import { agyFeatureConcurrency, forAgyFeature } from '../../../services/agyProfiles';
import { beginRepositoryAnalysisWrite } from '../../../services/repositoryAnalysisWrites';
import { bindTaskSignal, bindTaskItemSignal, taskConfigSnapshot, confirmLocalTaskCommit } from '../../../services/taskExecution';
import { assertRepositoryAnalysisAssetWrite, beginRepositoryAnalysisAssetWrite, claimRepositoryAnalysisTaskLease, clearRepositoryAnalysisRuntime,
  finishRepositoryAnalysisTaskLease, renewRepositoryAnalysisTaskLease, repositoryAnalysisTaskKey, saveRepositoryAnalysisAsset } from '../../../services/repositoryAnalysisAssets';
import { waitForRequest } from '../../../utils/requestDeadline';
import { clearDetailResponseCheckpoint } from '../../../services/repositoryDetailCheckpoint';
import { classifyAgyError } from '../../../services/agyErrors';
import { confirmRepositoryDetailRecovery, stageRepositoryDetailRecovery } from '../../../services/repositoryDetailRecovery';
import type { AgyRecoveryRecord } from '../../../types/agy';
import { checkpointDesktopHomeRepository } from '../../../home/desktop';

interface JobState {
  running: boolean;
  paused: boolean;
  progress: { current: number; total: number };
  failures: Repository[];
  syncFailed: boolean;
  errors: { repository: string; message: string }[];
  stage?: 'readme' | 'model' | 'validation' | 'saving';
  currentRepository?: string;
}
const emptyState = (): JobState => ({
  running: false, paused: false, progress: { current: 0, total: 0 }, failures: [], syncFailed: false, errors: [],
});
let snapshot = emptyState();
const listeners = new Set<() => void>();
const publish = (patch: Partial<JobState>) => {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
let active: { accountId: number; stopped: boolean; accountChanged: boolean; controller: AbortController } | null = null;
let observers = 0;
let unsubscribeAccount: (() => void) | undefined;
let activeJournal: ReturnType<typeof aiTaskJournal.begin> | null = null;

function pause() {
  if (!active || active.stopped) return;
  publish({ paused: true });
  activeJournal?.state('paused');
}
function resume() {
  if (!active || active.stopped) return;
  publish({ paused: false });
  activeJournal?.state('running');
}

function stop(reason: 'user' | 'account_change' | 'unmounted' = 'user') {
  if (!active) return;
  activeJournal?.metadata({ stopReason: reason });
  if (reason === 'user') activeJournal?.state('stopping');
  active.stopped = true;
  active.controller.abort();
  publish({ paused: false });
}

async function run(repositories: Repository[], expectedAccountId?: number, configId?: string, retry?: { config: AIConfig; parentId: string }, localResponse?: string, recoveryRequests?: Record<string, string>) {
  const state = useAppStore.getState();
  const accountId = state.user?.id;
  if (active || !repositories.length || accountId === undefined || (expectedAccountId !== undefined && expectedAccountId !== accountId)) return;
  const selectedConfig = retry?.config ?? state.aiConfigs.find((item) => item.id === (configId ?? state.activeAIConfig))
    ?? (localResponse === undefined ? undefined : { id: 'local-repair', name: 'Local repair', model: 'local-repair', isActive: false, baseUrl: '', apiKey: '' } satisfies AIConfig);
  if (!selectedConfig || (localResponse === undefined && !recoveryRequests && !isAIConfigAvailable(selectedConfig))) return;
  const config = forAgyFeature({ ...selectedConfig }, 'repository-details', 'interactive');
  const job = { accountId, stopped: false, accountChanged: false, controller: new AbortController() };
  active = job;
  const isCurrentAccount = () => useAppStore.getState().user?.id === job.accountId;
  const canContinue = () => active === job && !job.stopped && !job.controller.signal.aborted
    && isCurrentAccount() && useAppStore.getState().githubToken === state.githubToken;
  const queue = [...new Map(repositories.map((repo) => [repo.id, repo])).values()];
  const versions = new Map(queue.map(repo => [repo.id, beginRepositoryAnalysisAssetWrite(String(accountId), repo.id)
    .then(version => ({ version }), error => ({ error }))]));
  const journal = aiTaskJournal.begin(String(accountId), 'details', queue.map(repo => ({ id: String(repo.id), label: repo.full_name })), config.id);
  journal.metadata({ config: taskConfigSnapshot(config), parentId: retry?.parentId, target: { view: 'repositories', id: queue.length === 1 ? String(queue[0].id) : undefined } });
  bindTaskSignal(job.controller.signal, journal);
  activeJournal = journal;
  journal.bind({ pause, resume, stop });
  publish({ ...emptyState(), running: true, progress: { current: 0, total: queue.length } });
  let current = 0;
  let successfulWrites = 0;
  let commitAttempted = false;
  let persistenceFailed = false;
  let configurationUnavailable = false;
  let nextRequestAt = 0;
  const recoveryResults = new Map<number, AgyRecoveryRecord>();
  const savedIds = new Set<number>();
  const acknowledgeSaved = async () => {
    for (const id of savedIds) {
      await confirmRepositoryDetailRecovery(accountId, recoveryResults.get(id));
      recoveryResults.delete(id);
      await clearDetailResponseCheckpoint(accountId, id);
    }
  };
  const requestInterval = config.requestsPerMinute && config.requestsPerMinute > 0 ? 60000 / config.requestsPerMinute : 0;
  try {
    let cursor = 0;
    const worker = async () => {
    while (cursor < queue.length && !configurationUnavailable) {
      while ((snapshot.paused || Date.now() < nextRequestAt) && canContinue() && !configurationUnavailable) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!canContinue() || configurationUnavailable) break;
      const requested = queue[cursor++];
      if (!requested) break;
      // Never send stale UI objects from a different account.
      const repository = useAppStore.getState().repositories.find((item) => item.id === requested.id);
      if (!repository) continue;
      journal.item(String(repository.id), 'running');
      const requestSignal = AbortSignal.any([job.controller.signal]);
      bindTaskItemSignal(requestSignal, journal, String(repository.id));
      nextRequestAt = Date.now() + requestInterval;
      const key = repositoryAnalysisTaskKey(repository, state.language, selectedConfig);
      const owner = crypto.randomUUID();
      let claimed = false;
      let sourceConfig = selectedConfig;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      try {
        const initialWrite = await versions.get(repository.id)!;
        if ('error' in initialWrite) throw initialWrite.error;
        const assetVersion = initialWrite.version;
        await assertRepositoryAnalysisAssetWrite(assetVersion);
        const deadline = Date.now() + 90000;
        while (!claimed && canContinue()) {
          claimed = await claimRepositoryAnalysisTaskLease(String(accountId), key, owner, canContinue);
          if (!claimed) {
            if (Date.now() >= deadline) throw new Error('Analysis lease wait timed out');
            await waitForRequest(1000, job.controller.signal);
          }
        }
        if (!canContinue()) break;
        await assertRepositoryAnalysisAssetWrite(assetVersion);
        if (!canContinue()) break;
        const mergeWrite = beginRepositoryAnalysisWrite(accountId, repository.id, true);
        heartbeat = setInterval(() => {
          void renewRepositoryAnalysisTaskLease(String(accountId), key, owner, canContinue)
            .then(renewed => { if (!renewed) job.controller.abort(); }).catch(() => job.controller.abort());
        }, 20000);
        const details = await analyzeRepositoryDetails({
          repository, accountId, aiConfig: config, githubToken: state.githubToken || '',
          language: state.language, signal: requestSignal,
          localResponse,
          recovery: { assetVersion, requestId: recoveryRequests?.[repository.id], onConfig: value => { sourceConfig = value; }, onResult: record => {
            recoveryResults.set(repository.id, record);
            journal.itemExecution(String(repository.id), { recovery: { requestId: record.requestId, digest: record.resultDigest }, providerOutcome: 'succeeded', commitStatus: 'pending' });
          } },
          onStage: stage => { if (canContinue()) { publish({ stage, currentRepository: repository.full_name }); journal.metadata({ phase: stage }); } },
        });
        if (!canContinue()) break;
        await assertRepositoryAnalysisAssetWrite(assetVersion);
        if (!canContinue()) break;
        journal.commit('pending');
        await stageRepositoryDetailRecovery(accountId, recoveryResults.get(repository.id), {
          ...repository, ai_details: details, ai_summary: details.summary ?? details.problem ?? repository.ai_summary,
          ai_tags: details.tags, ai_platforms: platformsFromDetails(details), analyzed_at: details.generated_at,
          analysis_failed: false, analysis_error: undefined,
        });
        if (!canContinue()) break;
        const committed = await finishRepositoryAnalysisTaskLease(String(accountId), key, owner, 'done', details, canContinue);
        if (!committed) throw new Error('Analysis lease lost before save');
        await saveRepositoryAnalysisAsset(String(accountId), repository, state.language, sourceConfig, details, assetVersion);
        await assertRepositoryAnalysisAssetWrite(assetVersion);
        if (!canContinue()) break;
        const latestState = useAppStore.getState();
        const latest = latestState.repositories.find((item) => item.id === repository.id);
        if (latest && latestState.user?.id === accountId) {
          publish({ stage: 'saving' });
          const proposed = mergeWrite(latest, {
            ...latest, ai_details: details,
            ai_summary: details.summary ?? details.problem ?? latest.ai_summary,
            ai_tags: details.tags,
            ai_platforms: platformsFromDetails(details),
            analyzed_at: details.generated_at || new Date().toISOString(),
            analysis_failed: false, analysis_error: undefined,
          });
          latestState.updateRepository(proposed);
          successfulWrites += 1;
          savedIds.add(repository.id);
          journal.item(String(repository.id), 'complete');
          // Consume per item after durable Store flush. Keeping every result
          // until the whole batch ends would exhaust the reserved recovery quota.
          if (!await confirmLocalTaskCommit(journal, {
            durabilityBarrier: () => checkpointDesktopHomeRepository(String(accountId), repository.id),
            failureCode: 'HOME_CHECKPOINT_FAILED',
          })) throw new Error('LOCAL_PERSISTENCE_FAILED');
          await confirmRepositoryDetailRecovery(accountId, recoveryResults.get(repository.id));
          recoveryResults.delete(repository.id);
          await clearDetailResponseCheckpoint(accountId, repository.id);
        }
      } catch (error) {
        if (!canContinue()) break;
        if (error instanceof DOMException && error.name === 'AbortError') {
          journal.item(String(repository.id), 'canceled');
        } else {
          if (recoveryResults.has(repository.id)) journal.commit('failed', 'LOCAL_RESULT_SAVE_FAILED');
          const message = (error instanceof Error ? error.message : String(error))
            .split(config.apiKey || '\u0000').join('[redacted]')
            .split(state.githubToken || '\u0000').join('[redacted]').slice(0, 500);
          if (['configuration', 'deferred'].includes(classifyAgyError(error))) {
            configurationUnavailable = true;
            journal.metadata({ stopReason: 'config_changed' });
          }
          publish({ failures: [...snapshot.failures, repository], errors: [...snapshot.errors, { repository: repository.full_name, message }] });
          journal.item(String(repository.id), 'failed', message);
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        if (claimed) await finishRepositoryAnalysisTaskLease(String(accountId), key, owner,
          canContinue() ? 'failed' : 'cancelled').catch(() => {});
      }
      current += 1;
      publish({ progress: { current, total: queue.length } });
    }
    };
    await Promise.all(Array.from({ length: Math.min(queue.length, agyFeatureConcurrency(config, 'repository-details')) }, worker));
    // Sync failure does not invalidate a successfully saved local analysis.
    if (successfulWrites && !job.accountChanged && isCurrentAccount()) {
      commitAttempted = true;
      persistenceFailed = !await confirmLocalTaskCommit(journal);
      if (persistenceFailed) return;
      await acknowledgeSaved().catch(error => { persistenceFailed = true; journal.commit('failed', 'RESULT_RECEIPT_FAILED'); journal.error(error); });
      try {
        await forceSyncToBackend({ reportFailures: true });
      } catch {
        if (!job.accountChanged && isCurrentAccount()) publish({ syncFailed: true });
      }
    }
  } finally {
    if (!commitAttempted && successfulWrites && !job.accountChanged && isCurrentAccount()) {
      persistenceFailed = !await confirmLocalTaskCommit(journal);
      if (!persistenceFailed) await acknowledgeSaved().catch(error => { persistenceFailed = true; journal.commit('failed', 'RESULT_RECEIPT_FAILED'); journal.error(error); });
    }
    if (recoveryResults.size) journal.commit('failed', 'LOCAL_RESULT_SAVE_FAILED');
    journal.finish(persistenceFailed ? 'partial' : undefined);
    if (activeJournal === journal) activeJournal = null;
    if (active === job) {
      active = null;
      publish({ running: false, paused: false });
    }
  }
}

export function useRepositoryDetailAnalysisJob(enabled = true) {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  useEffect(() => {
    if (!enabled) return;
    observers += 1;
    if (observers === 1) {
      unsubscribeAccount = useAppStore.subscribe((next, previous) => {
        if (next.user?.id === previous.user?.id && next.githubToken === previous.githubToken) return;
        if (active) active.accountChanged = true;
        stop('account_change');
        clearRepositoryAnalysisRuntime();
        publish({ ...emptyState(), running: !!active });
      });
    }
    return () => {
      observers -= 1;
      if (observers === 0) {
        stop('unmounted');
        unsubscribeAccount?.();
        unsubscribeAccount = undefined;
        publish({ ...emptyState(), running: !!active });
      }
    };
  }, [enabled]);
  return {
    ...state, run, stop: () => stop(),
    repair: (repository: Repository, accountId: number, response: string) => run([repository], accountId, undefined, undefined, response),
    retrySave: (repositories: Repository[], task: import('../../../services/aiTaskJournal').AITaskRecord) => {
      const requests = Object.fromEntries(task.items.filter(item => item.recovery).map(item => [item.id, item.recovery!.requestId]));
      const config = useAppStore.getState().aiConfigs.find(config => config.id === task.configId)
        ?? { id: 'local-recovery', name: 'Local recovery', model: 'local-recovery', isActive: false, baseUrl: '', apiKey: '' };
      return run(repositories.filter(repo => requests[repo.id]), Number(task.owner), config.id, { config, parentId: task.id }, undefined, requests);
    },
    pause, resume,
  };
}
