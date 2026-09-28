import { useEffect, useSyncExternalStore } from 'react';
import type { Repository } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { analyzeRepositoryDetails } from '../../../services/repositoryDetailAnalysis';
import { clearRepositoryDetailReadmeCache } from '../../../services/repositoryDetailReadme';
import { forceSyncToBackend } from '../../../services/autoSync';

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

function stop() {
  if (!active) return;
  active.stopped = true;
  active.controller.abort();
  publish({ paused: false });
}

async function run(repositories: Repository[], expectedAccountId?: number, configId?: string) {
  const state = useAppStore.getState();
  const accountId = state.user?.id;
  if (active || !repositories.length || accountId === undefined || (expectedAccountId !== undefined && expectedAccountId !== accountId)) return;
  const selectedConfig = state.aiConfigs.find((item) => item.id === (configId ?? state.activeAIConfig));
  if (!selectedConfig?.model || !selectedConfig.apiKey || !selectedConfig.baseUrl || selectedConfig.apiKeyStatus === 'decrypt_failed') return;
  const config = { ...selectedConfig };
  const job = { accountId, stopped: false, accountChanged: false, controller: new AbortController() };
  active = job;
  const isCurrentAccount = () => useAppStore.getState().user?.id === job.accountId;
  const canContinue = () => active === job && !job.stopped && isCurrentAccount();
  const queue = [...new Map(repositories.map((repo) => [repo.id, repo])).values()];
  publish({ ...emptyState(), running: true, progress: { current: 0, total: queue.length } });
  let current = 0;
  let successfulWrites = 0;
  let nextRequestAt = 0;
  const requestInterval = config.requestsPerMinute && config.requestsPerMinute > 0 ? 60000 / config.requestsPerMinute : 0;
  try {
    for (const requested of queue) {
      while ((snapshot.paused || Date.now() < nextRequestAt) && canContinue()) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!canContinue()) break;
      // Never send stale UI objects from a different account.
      const repository = useAppStore.getState().repositories.find((item) => item.id === requested.id);
      if (!repository) continue;
      nextRequestAt = Date.now() + requestInterval;
      try {
        const details = await analyzeRepositoryDetails({
          repository, accountId, aiConfig: config, githubToken: state.githubToken || '',
          language: state.language, signal: job.controller.signal,
          onStage: stage => { if (canContinue()) publish({ stage, currentRepository: repository.full_name }); },
        });
        if (!canContinue()) break;
        const latestState = useAppStore.getState();
        const latest = latestState.repositories.find((item) => item.id === repository.id);
        if (latest && latestState.user?.id === accountId) {
          publish({ stage: 'saving' });
          latestState.updateRepository({
            ...latest, ai_details: details,
            ai_summary: details.summary ?? details.problem ?? latest.ai_summary,
            ai_tags: details.tags?.length ? details.tags : latest.ai_tags,
            ai_platforms: details.platforms?.length ? details.platforms : latest.ai_platforms,
            analyzed_at: details.generated_at || new Date().toISOString(),
            analysis_failed: false, analysis_error: undefined,
          });
          successfulWrites += 1;
        }
      } catch (error) {
        if (!canContinue()) break;
        const message = (error instanceof Error ? error.message : String(error))
          .split(config.apiKey).join('[redacted]')
          .split(state.githubToken || '\u0000').join('[redacted]').slice(0, 500);
        publish({ failures: [...snapshot.failures, repository], errors: [...snapshot.errors, { repository: repository.full_name, message }] });
      }
      current += 1;
      publish({ progress: { current, total: queue.length } });
    }
    // Sync failure does not invalidate a successfully saved local analysis.
    if (successfulWrites && !job.accountChanged && isCurrentAccount()) {
      try {
        await forceSyncToBackend({ reportFailures: true });
      } catch {
        if (!job.accountChanged && isCurrentAccount()) publish({ syncFailed: true });
      }
    }
  } finally {
    if (active === job) {
      active = null;
      publish({ running: false, paused: false });
    }
  }
}

export function useRepositoryDetailAnalysisJob() {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  useEffect(() => {
    observers += 1;
    if (observers === 1) {
      unsubscribeAccount = useAppStore.subscribe((next, previous) => {
        if (next.user?.id === previous.user?.id) return;
        if (active) active.accountChanged = true;
        stop();
        clearRepositoryDetailReadmeCache();
        publish({ ...emptyState(), running: !!active });
      });
    }
    return () => {
      observers -= 1;
      if (observers === 0) {
        stop();
        unsubscribeAccount?.();
        unsubscribeAccount = undefined;
        publish({ ...emptyState(), running: !!active });
      }
    };
  }, []);
  return {
    ...state, run, stop,
    pause: () => { if (active && !active.stopped) publish({ paused: true }); },
    resume: () => publish({ paused: false }),
  };
}
