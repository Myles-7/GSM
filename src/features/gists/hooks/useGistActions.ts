import { makeT, useT } from "../../../i18n/useT";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Gist, AIConfig } from '../../../types';
import type { GistCreateInput, GistUpdateInput } from '../../../services/githubApi';
import { useAppStore } from '../../../store/useAppStore';
import { selectGistViewState } from '../../../store/selectors';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { AIService } from '../../../services/aiService';
import { useDialog } from '../../../hooks/useDialog';
import { filterAndSortGists } from '../../../utils/gistUtils';
import { withDeadline } from '../../../utils/requestDeadline';
import { aiTaskJournal } from '../../../services/aiTaskJournal';
import { bindTaskSignal, taskConfigSnapshot, taskForSignal } from '../../../services/taskExecution';

const ANALYSIS_DEADLINE_MS = 120_000;
// Cards and the batch view mount separate instances of this hook.
const analysisOwners = new Map<string, symbol>();
const analysisIdentity = (state: ReturnType<typeof selectGistViewState>) => JSON.stringify([
  state.user?.id, state.user?.login, state.githubToken, state.activeAIConfig,
  state.aiConfigs.find(config => config.id === state.activeAIConfig), state.language,
]);
type AnalysisTask = {
  controller: AbortController;
  isCurrent: () => boolean;
  finish: () => void;
};

export type { GistCreateInput, GistUpdateInput };

// GistCard 单卡分析 patch 字面量提纯（成功/失败两态）。
export const applyGistAnalysisSuccess = (detail: Gist, summary: string, now: string): Gist => ({
  ...detail,
  ai_summary: summary.trim(),
  analyzed_at: now,
  analysis_failed: false,
  analysis_error: undefined,
});

export const applyGistAnalysisFailure = (gist: Gist, error: string, now: string): Gist => ({
  ...gist,
  analyzed_at: now,
  analysis_failed: true,
  analysis_error: error,
});

export const useGistActions = () => {
  const state = useAppStore(useShallow(selectGistViewState));
  const { toast, confirm } = useDialog();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isAnalyzingAll, setIsAnalyzingAll] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const analysisTasks = useRef(new Set<AbortController>());
  const detachedTasks = useRef(new Set<AbortController>());
  const analysisGeneration = useRef(0);
  const mounted = useRef(false);
  const batchTask = useRef<AnalysisTask | null>(null);
  const searchTask = useRef<AnalysisTask | null>(null);
  const backgroundController = useRef<AbortController | null>(null);
  const backgroundCleanup = useRef<(() => void) | null>(null);
  useEffect(() => {
    mounted.current = true;
    const activeControllers = analysisTasks.current;
    const detachedControllers = detachedTasks.current;
    let identity = analysisIdentity(useAppStore.getState());
    const cancel = () => {
      analysisGeneration.current++;
      for (const controller of activeControllers) controller.abort();
      activeControllers.clear();
      batchTask.current = null;
      searchTask.current = null;
      if (mounted.current) { setIsAnalyzingAll(false); setIsSearching(false); }
    };
    // Subscribe synchronously, including account A -> B -> A between renders.
    const unsubscribe = useAppStore.subscribe(next => {
      const nextIdentity = analysisIdentity(next);
      if (nextIdentity === identity) return;
      identity = nextIdentity;
      cancel();
    });
    return () => {
      mounted.current = false;
      if (aiTaskJournal.hasHost() && (backgroundController.current || detachedControllers.size)) {
        for (const controller of activeControllers) if (controller !== backgroundController.current && !detachedControllers.has(controller)) controller.abort();
        backgroundCleanup.current = unsubscribe;
        return;
      }
      unsubscribe();
      cancel();
    };
  }, []);
  const beginAnalysis = useCallback((): AnalysisTask | null => {
    const identity = analysisIdentity(state);
    if (!mounted.current || identity !== analysisIdentity(useAppStore.getState())) return null;
    const generation = analysisGeneration.current;
    const controller = new AbortController();
    analysisTasks.current.add(controller);
    return {
      controller,
      isCurrent: () => (mounted.current || backgroundController.current === controller || detachedTasks.current.has(controller)) && !controller.signal.aborted
        && generation === analysisGeneration.current
        && identity === analysisIdentity(useAppStore.getState()),
      finish: () => {
        analysisTasks.current.delete(controller); detachedTasks.current.delete(controller);
        if (!mounted.current && !analysisTasks.current.size) { backgroundCleanup.current?.(); backgroundCleanup.current = null; }
      },
    };
  }, [state]);
  const analyzeTarget = useCallback(async (
    gist: Gist,
    task: AnalysisTask,
    activeConfig: (typeof state.aiConfigs)[number],
  ): Promise<boolean | null> => {
    if (!task.isCurrent() || analysisOwners.has(gist.id)) return null;
    const owner = Symbol(gist.id);
    analysisOwners.set(gist.id, owner);
    const release = () => {
      if (analysisOwners.get(gist.id) !== owner) return;
      analysisOwners.delete(gist.id);
      useAppStore.getState().setAnalyzingGist(gist.id, false);
    };
    task.controller.signal.addEventListener('abort', release, { once: true });
    const canCommit = () => task.isCurrent() && analysisOwners.get(gist.id) === owner;
    const readCurrentGist = () => {
      const current = useAppStore.getState();
      return current.gists.find(item => item.id === gist.id)
        ?? current.starredGists.find(item => item.id === gist.id)
        ?? current.gistSearchResults.find(item => item.id === gist.id);
    };
    try {
      state.setAnalyzingGist(gist.id, true);
      const summary = await withDeadline(async signal => {
        const api = createGitHubApiService(state.githubToken!);
        const detail = await api.getGistForAnalysis(gist.id, gist, signal);
        signal.throwIfAborted();
        if (!canCommit()) throw new DOMException('Cancelled', 'AbortError');
        const aiService = new AIService(activeConfig, state.language);
        return aiService.analyzeGist(detail, api.getGistContentPreview(detail), signal);
      }, activeConfig.provider === 'agy-cli' ? (activeConfig.agyFeatureOverrides?.['gist-summary']?.timeoutSeconds ?? activeConfig.agyTimeoutSeconds ?? 180) * 2000 + 15000 : ANALYSIS_DEADLINE_MS, task.controller.signal);
      if (!canCommit()) return null;
      // Only analysis fields may change: the fetched/input gist may be deleted or edited.
      const current = readCurrentGist();
      if (!current) return null;
      useAppStore.getState().updateGist(applyGistAnalysisSuccess(current, summary, new Date().toISOString()));
      return true;
    } catch (error) {
      if (!canCommit() || ((error instanceof Error || error instanceof DOMException) && error.name === 'AbortError')) return null;
      taskForSignal(task.controller.signal)?.item(gist.id, 'failed', error);
      const current = readCurrentGist();
      if (!current) return null;
      useAppStore.getState().updateGist(applyGistAnalysisFailure(current, error instanceof Error ? error.message : String(error), new Date().toISOString()));
      return false;
    } finally {
      task.controller.signal.removeEventListener('abort', release);
      release();
    }
  }, [state]);
  // isAnalyzingGist(id) 的渲染值恒等于 store 集合值：原 GistCard 的本地 isAnalyzingLocal
  // 与 setAnalyzingGist 同置同清，渲染上与集合值等价，故本 hook 只操作 store 集合、
  // 不再设本地 flag（勿"修复"回双 flag 写法）。
  const analyzingGistIds = useAppStore((s) => s.analyzingGistIds);
  const isAnalyzingGist = useCallback(
    (gistId: string) => analyzingGistIds.has(gistId),
    [analyzingGistIds],
  );
  const t = useT('gists');

  const refreshGists = useCallback(async () => {
    if (!state.githubToken) {
      toast(t('useGistActions.github-token-not-found-please-login-again'), 'error');
      return;
    }
    setIsRefreshing(true);
    const journal = aiTaskJournal.begin(String(state.user?.id ?? ''), 'refresh', [{ id: 'gists', label: 'Gist' }], undefined, undefined, { title: 'Gist', target: { view: 'gists' } });
    journal.item('gists', 'running');
    try {
      const api = createGitHubApiService(state.githubToken);
      const [mine, starred] = await Promise.all([
        api.getAllGists(state.gists),
        api.getAllStarredGists([...state.gists, ...state.starredGists]),
      ]);
      const starredIds = new Set(starred.map(gist => gist.id));
      state.setGists(mine.map(gist => ({ ...gist, starred: starredIds.has(gist.id) || gist.starred })));
      state.setStarredGists(starred);
      journal.item('gists', 'complete');
      toast(t('useGistActions.gists-synced'), 'success');
    } catch (error) {
      journal.item('gists', 'failed', error);
      toast(error instanceof Error ? error.message : t('useGistActions.failed-to-sync-gists'), 'error');
    } finally {
      journal.finish();
      setIsRefreshing(false);
    }
  }, [state, t, toast]);

  const aiSearch = useCallback(async (
    query: string,
    categoryItems: Gist[],
    onReranked: (ranked: Gist[] | null) => void,
  ) => {
    searchTask.current?.controller.abort();
    searchTask.current = null;
    setIsSearching(false);
    if (!query.trim()) return;
    const activeConfig = state.aiConfigs.find(config => config.id === state.activeAIConfig);
    if (!isAIConfigAvailable(activeConfig)) {
      onReranked(null);
      state.setGistSearchFilters({ query });
      toast(t('useGistActions.search-fallback'), 'warning');
      return;
    }
    const task = beginAnalysis();
    if (!task) return;
    searchTask.current = task;
    if (aiTaskJournal.hasHost()) detachedTasks.current.add(task.controller);
    const journal = aiTaskJournal.begin(String(state.user?.id ?? ''), 'search', [{ id: 'gists', label: 'Gist' }], activeConfig.id, undefined,
      { title: 'Gist', config: taskConfigSnapshot(activeConfig, 'gist-rerank'), target: { view: 'gists' } });
    bindTaskSignal(task.controller.signal, journal); journal.bind({ stop: () => task.controller.abort() }); journal.item('gists', 'running');
    setIsSearching(true);
    try {
      const aiService = new AIService(activeConfig, state.language);
      const ranked = await withDeadline(signal => aiService.searchGistsWithReranking(
        filterAndSortGists(categoryItems, { ...state.gistSearchFilters, query: '' }), query, signal,
      ), activeConfig.provider === 'agy-cli' ? (activeConfig.agyFeatureOverrides?.['gist-rerank']?.timeoutSeconds ?? activeConfig.agyTimeoutSeconds ?? 180) * 2000 : ANALYSIS_DEADLINE_MS, task.controller.signal);
      if (!task.isCurrent()) return;
      onReranked(ranked);
      state.setGistSearchFilters({ query });
      state.setGistSearchResults(ranked);
      journal.item('gists', 'complete');
    } catch (error) {
      if (!task.controller.signal.aborted) journal.item('gists', 'failed', error);
      if (task.isCurrent()) {
        onReranked(null);
        state.setGistSearchFilters({ query });
        toast(t('useGistActions.search-fallback'), 'warning');
      }
    } finally {
      journal.finish(task.controller.signal.aborted ? 'canceled' : undefined);
      task.finish();
      if (searchTask.current === task) {
        searchTask.current = null;
        if (mounted.current) setIsSearching(false);
      }
    }
  }, [state, beginAnalysis, t, toast]);

  const analyzeVisibleGists = useCallback(async (requestedIds?: string[], configId?: string, retry?: { config: AIConfig; parentId: string }) => {
    if (!state.githubToken) {
      toast(t('useGistActions.github-token-not-found-please-login-again'), 'error');
      return;
    }
    const activeConfig = retry?.config ?? state.aiConfigs.find(config => config.id === (configId ?? state.activeAIConfig));
    if (!activeConfig) {
      toast(t('useGistActions.please-configure-ai-service-in-settings-first'), 'error');
      return;
    }
    if (!isAIConfigAvailable(activeConfig)) {
      toast(t('useGistActions.ai-service-configuration-is-incomplete-please-ch'), 'error');
      return;
    }
    const targets = requestedIds
      ? [...new Map([...state.gists, ...state.starredGists].filter(gist => requestedIds.includes(gist.id)).map(gist => [gist.id, gist])).values()]
      : state.gistSearchResults.filter(gist => !gist.analyzed_at || gist.analysis_failed);
    if (targets.length === 0) {
      toast(t('useGistActions.no-gists-need-analysis-in-the-current-list'), 'info');
      return;
    }
    if (batchTask.current) return;
    const task = beginAnalysis();
    if (!task) return;
    batchTask.current = task;
    let success = 0;
    let failed = 0;
    const concurrency = Math.max(1, Math.min(targets.length, Math.floor(activeConfig.concurrency || 1), activeConfig.provider === 'agy-cli' ? activeConfig.agyFeatureOverrides?.['gist-summary']?.concurrency ?? 5 : Infinity));
    let journal: ReturnType<typeof aiTaskJournal.begin> | undefined;
    let paused = false;
    try {
      const confirmed = await withDeadline(
        () => confirm(t('useGistActions.batch-ai-analysis'), t('useGistActions.analyze-v1-gists-continue', { v1: targets.length }), { type: 'warning' }),
        ANALYSIS_DEADLINE_MS, task.controller.signal,
      );
      if (!confirmed || !task.isCurrent()) return;
      if (aiTaskJournal.busy(String(state.user?.id ?? ''), 'gists')) return;
      journal = aiTaskJournal.begin(String(state.user?.id ?? ''), 'gists',
        targets.map(gist => ({ id: gist.id, label: gist.description || gist.id })), activeConfig.id);
      journal.metadata({ config: taskConfigSnapshot(activeConfig, 'gist-summary'), parentId: retry?.parentId, target: { view: 'gists' } });
      bindTaskSignal(task.controller.signal, journal);
      journal.bind({ pause: () => { paused = true; journal?.state('paused'); },
        resume: () => { paused = false; journal?.state('running'); }, stop: () => task.controller.abort() });
      if (aiTaskJournal.hasHost()) backgroundController.current = task.controller;
      setIsAnalyzingAll(true);
      for (let index = 0; index < targets.length; index += concurrency) {
        while (paused && task.isCurrent()) await new Promise(resolve => setTimeout(resolve, 100));
        if (!task.isCurrent()) return;
        await Promise.all(targets.slice(index, index + concurrency).map(async gist => {
          journal?.item(gist.id, 'running');
          const result = await analyzeTarget(gist, task, activeConfig.provider === 'agy-cli' ? { ...activeConfig, agyFeature: 'gist-summary' as const, agyPriority: 'background' as const } : activeConfig);
          if (result !== null) journal?.item(gist.id, result ? 'complete' : 'failed');
          if (result === true) success++;
          if (result === false) failed++;
        }));
      }
      if (task.isCurrent()) {
        toast(t('useGistActions.ai-analysis-done-success-succeeded-failed-failed', { success: success, failed: failed }), failed > 0 ? 'error' : 'success');
      }
    } catch {
      // Confirmation can be cancelled or expire before any work starts.
    } finally {
      journal?.finish(task.controller.signal.aborted ? 'canceled' : undefined);
      if (backgroundController.current === task.controller) backgroundController.current = null;
      task.finish();
      if (batchTask.current === task) {
        batchTask.current = null;
        if (mounted.current) setIsAnalyzingAll(false);
      }
    }
  }, [state, t, toast, confirm, beginAnalysis, analyzeTarget]);

  const fetchGistDetail = useCallback(async (gist: Gist): Promise<Gist | null> => {
    if (!state.githubToken) return null;
    try {
      const detail = await createGitHubApiService(state.githubToken).getGist(gist.id, gist);
      state.updateGist(detail);
      return detail;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/5\d{2}/.test(message)) {
        toast(t('useGistActions.github-gist-api-is-temporarily-unavailable-openi'), 'warning');
        return null;
      }
      toast(t(message ? 'useGistActions.failed-to-load-gist-details' : 'useGistActions.failed-to-load-gist-details-empty', { message }), 'error');
      return null;
    }
  }, [state, t, toast]);

  const submitGist = useCallback(async (input: GistCreateInput | GistUpdateInput, editingGist: Gist | null) => {
    if (!state.githubToken) return;
    const api = createGitHubApiService(state.githubToken);
    try {
      if (editingGist) {
        const updated = await api.updateGist(editingGist.id, input as GistUpdateInput, editingGist);
        state.updateGist({ ...updated, last_edited: new Date().toISOString() });
        toast(t('useGistActions.gist-updated'), 'success');
        return;
      }
      const created = await api.createGist(input as GistCreateInput);
      state.updateGist({ ...created, last_edited: new Date().toISOString() });
      toast(t('useGistActions.gist-created'), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const isPermission = /403|404|forbidden|scope|permission/i.test(message);
      toast(
        t(editingGist ? 'useGistActions.gist-update-failed' : 'useGistActions.gist-create-failed', {
          message: message || t('useGistActions.unknown-error'),
          permissionNote: isPermission ? t('useGistActions.gist-permission-note') : '',
        }),
        'error',
      );
    }
  }, [state, t, toast]);

  // 单卡 AI 分析（原 GistCard.handleAnalyze）：无 forceSync；
  // 重新分析覆盖确认在本 hook 内（View 只保留 stopPropagation 前置）。
  const analyzeOne = useCallback(async (gist: Gist) => {
    if (!state.githubToken) {
      toast(t('useGistActions.github-token-not-found-please-login-again'), 'error');
      return;
    }
    const activeConfig = state.aiConfigs.find(config => config.id === state.activeAIConfig);
    if (!activeConfig) {
      toast(t('useGistActions.please-configure-ai-service-in-settings-first'), 'error');
      return;
    }
    if (!isAIConfigAvailable(activeConfig)) {
      toast(t('useGistActions.ai-service-configuration-is-incomplete-please-ch'), 'error');
      return;
    }

    if (analysisOwners.has(gist.id)) return;
    const task = beginAnalysis();
    if (!task) return;
    let journal: ReturnType<typeof aiTaskJournal.begin> | undefined;
    try {
      if (gist.analyzed_at) {
        const shouldContinue = await withDeadline(
          () => confirm(
            t('useGistActions.re-analyze-confirmation'),
            t('useGistActions.this-gist-has-already-been-analyzed-overwrite-th'),
            { type: 'warning' },
          ),
          ANALYSIS_DEADLINE_MS, task.controller.signal,
        );
        if (!shouldContinue || !task.isCurrent()) return;
      }
      journal = aiTaskJournal.begin(String(state.user?.id ?? ''), 'gists', [{ id: gist.id, label: gist.description || gist.id }], activeConfig.id, undefined,
        { config: taskConfigSnapshot(activeConfig, 'gist-summary'), target: { view: 'gists', id: gist.id } });
      bindTaskSignal(task.controller.signal, journal); journal.bind({ stop: () => task.controller.abort() }); journal.item(gist.id, 'running');
      if (aiTaskJournal.hasHost()) detachedTasks.current.add(task.controller);
      const result = await analyzeTarget(gist, task, activeConfig);
      if (result !== null) journal.item(gist.id, result ? 'complete' : 'failed');
      if (result !== null && task.isCurrent()) {
        toast(t(result ? 'useGistActions.gist-ai-analysis-completed' : 'useGistActions.gist-ai-analysis-failed'), result ? 'success' : 'error');
      }
    } catch {
      // Confirmation can be cancelled or expire before any work starts.
    } finally {
      journal?.finish(task.controller.signal.aborted ? 'canceled' : undefined);
      task.finish();
    }
  }, [state, t, toast, confirm, beginAnalysis, analyzeTarget]);

  const unstarGist = useCallback(async (gist: Gist, onUnstarred?: (gistId: string) => void) => {
    if (!state.githubToken) return;
    const confirmed = await confirm(
      t('useGistActions.unstar-gist'),
      t('useGistActions.are-you-sure-you-want-to-unstar-this-gist'),
      { type: 'warning', confirmText: t('useGistActions.unstar') }
    );
    if (!confirmed) return;

    setIsMutating(true);
    try {
      await createGitHubApiService(state.githubToken).unstarGist(gist.id);
      onUnstarred?.(gist.id);
      state.updateGist({ ...gist, starred: false });
      toast(t('useGistActions.unstarred'), 'success');
    } catch {
      toast(t('useGistActions.failed-to-unstar'), 'error');
    } finally {
      setIsMutating(false);
    }
  }, [state, t, toast, confirm]);

  // 注意：本方法有意遮蔽经由 ...state 展开的同名 store action（签名不同：
  // 接收 Gist 对象并内置确认/报错）。需要原始 store action 的调用方应自行
  // 从 useAppStore 订阅（GistView 的 onDeleted 即如此）。
  const deleteGist = useCallback(async (gist: Gist, onDeleted?: (gistId: string) => void) => {
    if (!state.githubToken || gist.owner?.login !== state.user?.login) return;
    const confirmed = await confirm(
      t('useGistActions.delete-gist'),
      t('useGistActions.are-you-sure-you-want-to-delete-this-gist-this-c'),
      { type: 'danger', confirmText: t('useGistActions.delete') }
    );
    if (!confirmed) return;

    setIsMutating(true);
    try {
      await createGitHubApiService(state.githubToken).deleteGist(gist.id);
      state.deleteGist(gist.id);
      onDeleted?.(gist.id);
      toast(t('useGistActions.gist-deleted'), 'success');
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      const isPermission = /403|404|forbidden|scope|permission/i.test(msg);
      toast(
        t(msg ? 'useGistActions.failed-to-delete-gist' : 'useGistActions.failed-to-delete-gist-empty', {
          message: msg,
          permissionNote: isPermission ? t('useGistActions.gist-permission-note') : '',
        }),
        'error'
      );
    } finally {
      setIsMutating(false);
    }
  }, [state, t, toast, confirm]);

  // 大文件按需拉取（原 GistDetailModal.HighlightedCode effect 的服务调用部分）。
  // 无 token 时抛出的错误文案与原 setRawError 直写逐字一致，由 View catch 落 rawError。
  // Abort/retry/局部缓存归 View：signal 由调用方传入。
  // 依赖只含 token：语言切换不得换引用（否则 View 的拉取 effect 会随 language 变化
  // 重新发起网络请求），无 token 文案在抛错时经 getState() 读取当前语言。
  const fetchGistFileRaw = useCallback(async (rawUrl: string, signal?: AbortSignal): Promise<string> => {
    if (!state.githubToken) {
      const currentLanguage = useAppStore.getState().language;
      throw new Error(makeT(currentLanguage, 'gists')('useGistActions.github-token-not-configured'));
    }
    return createGitHubApiService(state.githubToken).getGistFileRaw(rawUrl, signal);
  }, [state.githubToken]);

  return {
    ...state,
    isRefreshing,
    isSearching,
    isAnalyzingAll,
    isMutating,
    refreshGists,
    aiSearch,
    analyzeVisibleGists,
    fetchGistDetail,
    submitGist,
    analyzeOne,
    unstarGist,
    deleteGist,
    fetchGistFileRaw,
    isAnalyzingGist,
  };
};
import { isAIConfigAvailable } from '../../../utils/aiConfig';
