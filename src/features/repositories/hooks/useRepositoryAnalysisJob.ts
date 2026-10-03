import { useT } from "../../../i18n/useT";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Category, Repository, AIConfig } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';
import { AIAnalysisOptimizer, type AnalysisResult } from '../../../services/aiAnalysisOptimizer';
import { AIService } from '../../../services/aiService';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { forceSyncToBackend } from '../../../services/autoSync';
import { buildCategoryHints, resolveCategoryAssignment } from '../../../utils/categoryUtils';
import { applyAnalysisFailure, applyAnalysisSuccess } from '../application/repositoryPatches';
import { beginRepositoryAnalysisWrite } from '../../../services/repositoryAnalysisWrites';
import { aiTaskJournal } from '../../../services/aiTaskJournal';
import { bindTaskSignal, taskConfigSnapshot } from '../../../services/taskExecution';

export type RepositoryAnalysisScope = 'all' | 'unanalyzed' | 'failed' | 'selected';

interface UseRepositoryAnalysisJobOptions {
  allCategories: Category[];
}

interface RunRepositoryAnalysisOptions {
  repositories: Repository[];
  scope: RepositoryAnalysisScope;
  syncOnComplete: boolean;
  configId?: string;
  retry?: { config: AIConfig; parentId: string };
}

export interface RepositoryAnalysisJob {
  run: (options: RunRepositoryAnalysisOptions) => Promise<boolean>;
  pause: () => void;
  resume: () => void;
  requestStop: () => Promise<boolean>;
  isRunning: boolean;
  isPaused: boolean;
  progress: { current: number; total: number };
}

const createOptimizer = (concurrency?: number, requestsPerMinute?: number, agy = false, onTaskStart?: (repo: Repository) => void) => new AIAnalysisOptimizer({
  onTaskStart,
  initialConcurrency: concurrency || 3,
  maxConcurrency: concurrency || (agy ? 5 : 3),
  minConcurrency: 1,
  targetResponseTime: 5000,
  batchDelayMs: 100,
  maxRetries: 1,
  retryDelayBaseMs: 1000,
  enableAdaptiveConcurrency: !agy,
  rateLimiter: {
    maxConcurrency: 0,
    requestsPerMinute: requestsPerMinute || 0,
  },
});

/**
 * Owns the lifecycle of one RepositoryList batch-analysis job. The hook keeps
 * the optimizer instance in a ref so pause, resume, stop, and unmount cleanup
 * always affect the active job without putting a mutable job in the store.
 */
export const useRepositoryAnalysisJob = ({
  allCategories,
}: UseRepositoryAnalysisJobOptions): RepositoryAnalysisJob => {
  const {
    githubToken,
    aiConfigs,
    activeAIConfig,
    language,
    updateRepository,
    setLoading,
    setAnalysisProgress,
  } = useAppStore(useShallow((state) => ({
    githubToken: state.githubToken,
    aiConfigs: state.aiConfigs,
    activeAIConfig: state.activeAIConfig,
    language: state.language,
    updateRepository: state.updateRepository,
    setLoading: state.setLoading,
    setAnalysisProgress: state.setAnalysisProgress,
  })));

  const { toast, confirm } = useDialog();
  const optimizerRef = useRef<AIAnalysisOptimizer | null>(null);
  const isRunningRef = useRef(false);
  const isPausedRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const mountedRef = useRef(true);
  const journalRef = useRef<ReturnType<typeof aiTaskJournal.begin> | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const t = useT('repositories');

  const resetVisibleState = useCallback(() => {
    setLoading(false);
    setAnalysisProgress({ current: 0, total: 0 });
    if (mountedRef.current) {
      setIsRunning(false);
      isPausedRef.current = false;
      setIsPaused(false);
      setProgress({ current: 0, total: 0 });
    }
  }, [setAnalysisProgress, setLoading]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Active work is controlled by the app-wide task panel after navigation.
      if (!journalRef.current) {
        optimizerRef.current?.abort();
        optimizerRef.current = null;
        isRunningRef.current = false;
        setLoading(false);
        setAnalysisProgress({ current: 0, total: 0 });
      }
    };
  }, [setAnalysisProgress, setLoading]);

  const pause = useCallback(() => {
    const optimizer = optimizerRef.current;
    if (!isRunningRef.current || !optimizer || isPausedRef.current) return;
    optimizer.pause();
    journalRef.current?.state('paused');
    isPausedRef.current = true;
    if (mountedRef.current) setIsPaused(true);
    console.log('Analysis paused');
  }, []);

  const resume = useCallback(() => {
    const optimizer = optimizerRef.current;
    if (!isRunningRef.current || !optimizer || !isPausedRef.current) return;
    optimizer.resume();
    journalRef.current?.state('running');
    isPausedRef.current = false;
    if (mountedRef.current) setIsPaused(false);
    console.log('Analysis resumed');
  }, []);

  const requestStop = useCallback(async () => {
    if (!isRunningRef.current) return false;

    const confirmed = await confirm(
      t('useRepositoryAnalysisJob.stop-ai-analysis'),
      t('useRepositoryAnalysisJob.are-you-sure-you-want-to-stop-ai-analysis-analyz'),
      { type: 'warning' },
    );
    if (!confirmed || !isRunningRef.current) return false;

    stopRequestedRef.current = true;
    optimizerRef.current?.abort();
    isPausedRef.current = false;
    if (mountedRef.current) {
      setIsPaused(false);
    }
    console.log('Stop requested by user');
    return true;
  }, [confirm, t]);

  const run = useCallback(async ({
    repositories,
    scope,
    syncOnComplete,
    configId,
    retry,
  }: RunRepositoryAnalysisOptions) => {
    if (isRunningRef.current) return false;

    if (!githubToken) {
      toast(t('useRepositoryAnalysisJob.github-token-not-found-please-login-again'), 'error');
      return false;
    }

    const activeConfig = retry?.config ?? aiConfigs.find((config) => config.id === (configId ?? activeAIConfig));
    if (!activeConfig) {
      toast(t('useRepositoryAnalysisJob.please-configure-ai-service-in-settings-first'), 'error');
      return false;
    }

    if (scope !== 'selected' && (activeConfig.apiKeyStatus === 'decrypt_failed' || activeConfig.apiKeyStatus === 'empty')) {
      toast(t('useRepositoryAnalysisJob.the-ai-service-api-key-could-not-be-decrypted-or'), 'error');
      return false;
    }

    if (scope !== 'selected' && !isAIConfigAvailable(activeConfig)) {
      toast(t('useRepositoryAnalysisJob.ai-service-configuration-is-incomplete-please-ch'), 'error');
      return false;
    }

    if (repositories.length === 0) {
      const message = scope === 'failed'
        ? t('useRepositoryAnalysisJob.no-failed-repositories-to-re-analyze')
        : scope === 'unanalyzed'
          ? t('useRepositoryAnalysisJob.all-repositories-have-been-analyzed')
          : t('useRepositoryAnalysisJob.no-repositories-to-analyze');
      toast(message, 'info');
      return false;
    }

    const actionText = scope === 'failed'
      ? (t('useRepositoryAnalysisJob.failed'))
      : scope === 'unanalyzed'
        ? (t('useRepositoryAnalysisJob.unanalyzed'))
        : (t('useRepositoryAnalysisJob.all'));
    const confirmationAccount = useAppStore.getState();
    const confirmationMessage = scope === 'selected'
      ? (t('useRepositoryAnalysisJob.will-analyze-v1-repositories-with-ai-this-may-ta', { v1: repositories.length }))
      : (t('useRepositoryAnalysisJob.will-analyze-v1-actiontext-repositories-with-ai', { v1: repositories.length, actionText: actionText }));

    const confirmed = await confirm(
      t('useRepositoryAnalysisJob.ai-analysis-confirmation'),
      confirmationMessage,
      { type: 'warning' },
    );
    if (!confirmed) return false;
    const afterConfirmation = useAppStore.getState();
    if (afterConfirmation.user?.id !== confirmationAccount.user?.id
      || afterConfirmation.githubToken !== confirmationAccount.githubToken) return false;
    if (aiTaskJournal.busy(String(useAppStore.getState().user?.id ?? ''), 'summary')) return false;

    const optimizer = createOptimizer(activeConfig.provider === 'agy-cli' ? Math.min(activeConfig.concurrency ?? 5, activeConfig.agyFeatureOverrides?.['repository-summary']?.concurrency ?? 5) : activeConfig.concurrency, activeConfig.requestsPerMinute, activeConfig.provider === 'agy-cli', repo => journalRef.current?.item(String(repo.id), 'running'));
    const startState = useAppStore.getState();
    const writes = new Map(repositories.map(repo => [repo.id, beginRepositoryAnalysisWrite(startState.user?.id ?? 0, repo.id)]));
    let invalidated = false;
    const currentAccount = () => {
      const current = useAppStore.getState();
      return !invalidated && current.user?.id === startState.user?.id && current.githubToken === startState.githubToken;
    };
    const journal = startState.user ? aiTaskJournal.begin(String(startState.user.id), 'summary',
      repositories.map(repo => ({ id: String(repo.id), label: repo.full_name })), activeConfig.id) : null;
    journalRef.current = journal;
    if (journal && optimizer.signal) bindTaskSignal(optimizer.signal, journal);
    journal?.metadata({ config: taskConfigSnapshot(activeConfig, 'repository-summary'), parentId: retry?.parentId, target: { view: 'repositories' } });
    journal?.bind({ pause, resume, stop: () => { stopRequestedRef.current = true; optimizer.abort(); } });
    const unsubscribe = useAppStore.subscribe?.((next, previous) => {
      if (next.user?.id !== previous.user?.id || next.githubToken !== previous.githubToken) {
        invalidated = true;
        optimizer.abort();
      }
    });
    optimizerRef.current = optimizer;
    stopRequestedRef.current = false;
    isPausedRef.current = false;
    isRunningRef.current = true;
    setLoading(true);
    setAnalysisProgress({ current: 0, total: repositories.length });
    if (mountedRef.current) {
      setIsRunning(true);
      setIsPaused(false);
      setProgress({ current: 0, total: repositories.length });
    }

    let successCount = 0;
    let failedCount = 0;

    try {
      const githubApi = createGitHubApiService(githubToken);
      const aiService = new AIService(activeConfig.provider === 'agy-cli' ? { ...activeConfig, agyFeature: 'repository-summary' as const, agyPriority: repositories.length === 1 ? 'interactive' as const : 'background' as const } : activeConfig, language);
      const categoryNames = allCategories.filter((category) => category.id !== 'all').map((category) => category.name);
      const aiCategoryHints = buildCategoryHints(allCategories);
      const onResult = (result: AnalysisResult) => {
        if ((!mountedRef.current && !journal) || optimizerRef.current !== optimizer || !currentAccount()) return;
        journal?.item(String(result.repo.id), result.success ? 'complete' : 'failed', result.success ? undefined : result.error);
        const latest = useAppStore.getState().repositories.find(repo => repo.id === result.repo.id);
        if (!latest) return;
        const merge = writes.get(result.repo.id)!;

        if (result.success) {
          const resolvedCategory = resolveCategoryAssignment(
            { ...result.repo, ai_summary: result.summary },
            result.tags || [],
            allCategories,
          );
          const wasCategoryLocked = !!result.repo.category_locked;
          updateRepository(merge(latest, applyAnalysisSuccess(latest, {
            summary: result.summary,
            tags: result.tags,
            platforms: result.platforms,
            category: resolvedCategory,
            categoryLocked: wasCategoryLocked,
            analyzedAt: new Date().toISOString(),
          })));
          successCount += 1;
          return;
        }

        updateRepository(merge(latest, applyAnalysisFailure(latest, {
          analyzedAt: new Date().toISOString(),
          error: result.error?.message || undefined,
        })));
        failedCount += 1;
      };

      await optimizer.analyzeRepositoriesPipelined(
        repositories,
        githubApi,
        aiService,
        categoryNames,
        aiCategoryHints,
        (current, total, currentConcurrency) => {
          if ((!mountedRef.current && !journal) || optimizerRef.current !== optimizer || !currentAccount()) return;
          setAnalysisProgress({ current, total });
          if (mountedRef.current) setProgress({ current, total });
          console.log(`AI Analysis Progress: ${current}/${total}, Concurrency: ${currentConcurrency}`);
        },
        onResult,
      );

      const stats = optimizer.getStats();
      console.log('AI Analysis Stats:', stats);
      if (syncOnComplete && currentAccount()) {
        await forceSyncToBackend();
      }

      if (scope === 'selected') {
        toast(
          t('useRepositoryAnalysisJob.successfully-analyzed-successcount-repositories', { successCount: successCount, failedCount: failedCount, v3: stats.averageResponseTime }),
          failedCount > 0 ? 'error' : 'success',
        );
      } else {
        toast(
          stopRequestedRef.current
            ? (t('useRepositoryAnalysisJob.ai-analysis-stopped-success-successcount-failed', { successCount: successCount, failedCount: failedCount }))
            : (t('useRepositoryAnalysisJob.ai-analysis-completed-success-successcount-faile', { successCount: successCount, failedCount: failedCount, v3: stats.averageResponseTime })),
          'success',
        );
      }
      return true;
    } catch (error) {
      console.error(scope === 'selected' ? 'Bulk AI analysis failed:' : 'AI analysis failed:', error);
      toast(
        scope === 'selected'
          ? (t('useRepositoryAnalysisJob.bulk-ai-analysis-failed'))
          : (t('useRepositoryAnalysisJob.ai-analysis-failed-please-check-ai-configuration')),
        'error',
      );
      return false;
    } finally {
      unsubscribe?.();
      journal?.finish();
      journalRef.current = null;
      if (optimizerRef.current === optimizer) {
        optimizerRef.current = null;
        isRunningRef.current = false;
        stopRequestedRef.current = false;
        resetVisibleState();
      }
    }
  }, [aiConfigs, activeAIConfig, allCategories, confirm, githubToken, language, resetVisibleState, setAnalysisProgress, setLoading, t, toast, updateRepository, pause, resume]);

  return useMemo(() => ({
    run,
    pause,
    resume,
    requestStop,
    isRunning,
    isPaused,
    progress,
  }), [isPaused, isRunning, pause, progress, requestStop, resume, run]);
};
import { isAIConfigAvailable } from '../../../utils/aiConfig';
