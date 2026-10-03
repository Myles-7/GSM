import { useT } from "../../../i18n/useT";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { DiscoveryChannelId, DiscoveryRepo, PaginatedDiscoveryRepositories } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { selectDiscoveryViewState } from '../../../store/selectors';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { syncWeeklyChannel } from '../../../services/weeklyIssuesService';
import { syncXTweetChannel } from '../../../services/xTweetService';
import { syncTelegramChannel } from '../../../services/telegramService';
import { AIService } from '../../../services/aiService';
import { forAgyFeature, agyFeatureConcurrency } from '../../../services/agyProfiles';
import { AIAnalysisOptimizer } from '../../../services/aiAnalysisOptimizer';
import { discoveryAnalysisStorage } from '../../../services/discoveryAnalysisStorage';
import { buildCategoryHints, resolveCategoryAssignment } from '../../../utils/categoryUtils';
import { getAllCategories } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';
import { useAuthSessionGeneration } from '../../../hooks/useAuthSessionGeneration';
import { isExternalDiscoveryChannelId } from '../../../services/externalFeedConfig';
import { useExternalFeedLoading } from './useExternalFeedLoading';
import { useCustomDiscovery } from '../custom/store';
import { analyzedRepository, enqueueAnalysis } from '../custom/analysis';
import { taskIssue } from '../custom/taskStatus';
import type { TaskIssue } from '../custom/model';
import { discoveryItemKey, mergeStableItems, workspaceSessionKey } from '../workspace/model';
import { discoverySourceSignature } from '../workspace/source';
import { loadBrowseSession, loadReadingPreferences, saveBrowsePage } from '../workspace/storage';
import { refreshPopularReading } from '../workspace/popularReading';
import { withDeadline } from '../../../utils/requestDeadline';
import { aiTaskJournal } from '../../../services/aiTaskJournal';
import { bindTaskSignal } from '../../../services/taskExecution';
export interface ChannelLoadState {
  status: 'idle' | 'loading' | 'ready' | 'partial' | 'error' | 'cancelled';
  issue?: TaskIssue;
  verification?: { current: number; total: number; failed: number; partial?: boolean };
  readingProgress?: { current: number; total: number; reorder: boolean };
  unsaved?: boolean;
}

const getChannelRequestSignature = (state: ReturnType<typeof selectDiscoveryViewState>, channelId: DiscoveryChannelId) => {
  const common = [state.githubToken, state.discoveryPlatform];
  switch (channelId) {
    case 'trending': return JSON.stringify([...common, state.trendingTimeRange]);
    case 'topic': return JSON.stringify([...common, state.discoverySelectedTopic]);
    case 'search': return JSON.stringify([...common, state.discoverySearchQuery, state.discoveryLanguage, state.discoverySortBy, state.discoverySortOrder]);
    // 周刊过滤为客户端行为，但签名纳入 weeklyOnlyCollected 以便切换过滤器时重跑入口重建切片
    case 'weekly': return JSON.stringify([...common, state.weeklyOnlyCollected]);
    // 关注列表/鉴权变化会改变抓取范围，纳入签名作废旧请求
    // （修订号区分"不同 Cookie 之间的切换"，布尔值做不到）
    case 'x-tweet': return JSON.stringify([...common, state.xTweetFollows, state.xTweetAuth !== null, state.xTweetAuthRevision]);
    case 'telegram': return JSON.stringify([...common, state.telegramFollows]);
    case 'hot-release': return JSON.stringify([...common, useCustomDiscovery.getState().data.builtinPreferences?.['hot-release']?.prereleases === true]);
    default: return JSON.stringify(common);
  }
};

/**
 * Owns network-backed Discovery loading and AI analysis. UI scrolling and view
 * composition remain in DiscoveryView, while stale topic response protection
 * and all service construction stay in this feature boundary.
 */
export const useDiscoveryActions = () => {
  const state = useAppStore(useShallow(selectDiscoveryViewState));
  const { toast } = useDialog();
  const { setAnalysisProgress } = state;
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [channelLoadStates, setChannelLoadStates] = useState<Record<string, ChannelLoadState>>({});
  const requestControllers = useRef<Record<string, AbortController>>({});
  const refreshExternalFeed = useExternalFeedLoading();
  const optimizerRef = useRef<AIAnalysisOptimizer | null>(null);
  const channelRequestVersionRef = useRef<Partial<Record<DiscoveryChannelId, number>>>({});
  const channelLoadingVersionRef = useRef<Record<string, number>>({});
  const latestStateRef = useRef(state);
  const authSessionIdentity = useAppStore(current => `${current.githubToken ?? ''}\u0000${current.user?.id ?? ''}\u0000${current.user?.login ?? ''}`);
  const { captureSession, isCurrentSession } = useAuthSessionGeneration(authSessionIdentity);
  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);
  useEffect(() => {
    const controllers = requestControllers.current;
    setIsAnalyzing(false);
    setChannelLoadStates({});
    setAnalysisProgress({ current: 0, total: 0 });
    // 账号切换后旧会话的周刊/推文/频道同步进度不再属于当前页面，直接清空
    useAppStore.getState().setWeeklySyncStatus(null);
    useAppStore.getState().setXTweetSyncStatus(null);
    useAppStore.getState().setTelegramSyncStatus(null);
    return () => {
      Object.values(controllers).forEach(controller => controller.abort());
      optimizerRef.current?.abort();
      optimizerRef.current = null;
    };
  }, [authSessionIdentity, setAnalysisProgress]);
  const t = useT('discovery');
  const tRef = useRef(t);
  useEffect(() => {
    // 提交完成后同步引用，避免渲染期副作用
    tRef.current = t;
  }, [t]);

  const refreshChannel = useCallback(async (channelId: DiscoveryChannelId, page = 1, append = false, options?: { reorder?: boolean }) => {
    if (isExternalDiscoveryChannelId(channelId)) {
      const token = useAppStore.getState().githubToken;
      if (!token) {
        toast(tRef.current('useDiscoveryActions.github-token-not-found-please-login-again'), 'error');
        return;
      }
      await refreshExternalFeed(channelId, createGitHubApiService(token));
      const current = useAppStore.getState();
      if (current.user && current.githubToken === token) {
        const signature = discoverySourceSignature(current, channelId);
        try {
          await saveBrowsePage(String(current.user.id), { key: workspaceSessionKey(channelId, signature), channelId, signature,
            items: current.discoveryRepos[channelId] as unknown as Record<string, unknown>[], itemKeys: current.discoveryRepos[channelId].map(discoveryItemKey),
            nextPage: 1, hasMore: false, totalCount: current.discoveryTotalCount[channelId] || 0, mode: 'replace' });
        } catch { setChannelLoadStates(before => ({ ...before, [channelId]: { status: 'ready', unsaved: true } })); }
      }
      return;
    }
    if (append && useAppStore.getState().discoveryIsLoadingMore[channelId]) return;
    const currentState = latestStateRef.current;
    if (!currentState.githubToken) {
      toast(tRef.current('useDiscoveryActions.github-token-not-found-please-login-again'), 'error');
      return;
    }
    requestControllers.current[channelId]?.abort();
    const requestController = new AbortController();
    requestControllers.current[channelId] = requestController;
    const requestVersion = (channelRequestVersionRef.current[channelId] ?? 0) + 1;
    channelRequestVersionRef.current[channelId] = requestVersion;
    const loadingKey = `${channelId}:${append ? 'append' : 'initial'}`;
    channelLoadingVersionRef.current[loadingKey] = requestVersion;
    const requestSession = captureSession();
    const requestSignature = getChannelRequestSignature(currentState, channelId);
    const isCurrentRequest = () => channelRequestVersionRef.current[channelId] === requestVersion
      && isCurrentSession(requestSession)
      && getChannelRequestSignature(useAppStore.getState(), channelId) === requestSignature;
    const ownsLoading = () => channelLoadingVersionRef.current[loadingKey] === requestVersion;
    const journal = aiTaskJournal.begin(String(useAppStore.getState().user?.id ?? ''), 'refresh', [{ id: channelId, label: channelId }], undefined, channelId,
      { title: channelId, phase: 'reading', target: { view: 'subscription', id: `builtin:${channelId}` } });
    bindTaskSignal(requestController.signal, journal); journal.item(channelId, 'running'); journal.bind({ stop: () => requestController.abort() });
    let taskFailed = false;

    setChannelLoadStates(before => ({ ...before, [channelId]: { status: 'loading' } }));
    let source: TaskIssue['source'] = 'github';
    if (append) {
      currentState.setDiscoveryLoadingMore(channelId, true);
      currentState.setDiscoveryLoadMoreError(channelId, null);
    } else {
      currentState.setDiscoveryLoading(channelId, true);
      currentState.setDiscoveryLoadMoreError(channelId, null);
    }
    try {
      const api = createGitHubApiService(currentState.githubToken);
      const account = String(useAppStore.getState().user?.id || '');
      const signature = discoverySourceSignature(useAppStore.getState(), channelId, useCustomDiscovery.getState().data.builtinPreferences?.['hot-release']?.prereleases === true);
      const key = workspaceSessionKey(channelId, signature);
      const preferences = await loadReadingPreferences(account, channelId).catch(() => ({ batchSize: 20 as const }));
      const cached = await loadBrowseSession(account, key).catch(() => null);
      if (!isCurrentRequest() || requestController.signal.aborted) return;
      const applySaved = (saved: NonNullable<Awaited<ReturnType<typeof loadBrowseSession>>>) => {
        currentState.setDiscoveryRepos(channelId, saved.items as unknown as DiscoveryRepo[]);
        currentState.setDiscoveryHasMore(channelId, saved.session.hasMore || saved.session.bufferKeys.length > 0);
        currentState.setDiscoveryNextPage(channelId, saved.session.nextPage);
        currentState.setDiscoveryTotalCount(channelId, saved.session.totalCount);
        if (saved.session.refreshedAt) currentState.setDiscoveryLastRefresh(channelId, saved.session.refreshedAt);
      };
      if (channelId === 'most-popular' && !append) {
        const outcome = await refreshPopularReading({ account, key, signature, reorder: options?.reorder === true,
          batchSize: preferences.batchSize, signal: requestController.signal, isCurrent: isCurrentRequest,
          fetchPage: (cursor, signal) => api.getMostPopular(currentState.discoveryPlatform, cursor, 20, signal),
          progress: (current, total) => { if (isCurrentRequest()) setChannelLoadStates(before => ({ ...before, [channelId]: {
            status: 'loading', readingProgress: { current, total, reorder: options?.reorder === true },
          } })); },
        });
        if (!outcome.complete) { taskFailed = true; journal.item(channelId, 'failed', outcome.issue ?? 'Repository collection incomplete / 项目收集未完成'); }
        if (!isCurrentRequest() || requestController.signal.aborted) return;
        if (outcome.saved) applySaved(outcome.saved);
        if (outcome.unsaved) {
          const memory = options?.reorder ? outcome.unsaved.repos : mergeStableItems(currentState.discoveryRepos[channelId] || [], outcome.unsaved.repos, discoveryItemKey);
          currentState.setDiscoveryRepos(channelId, memory);
          currentState.setDiscoveryNextPage(channelId, outcome.unsaved.nextPage);
          currentState.setDiscoveryHasMore(channelId, outcome.unsaved.hasMore);
          currentState.setDiscoveryTotalCount(channelId, outcome.unsaved.totalCount);
          currentState.setDiscoveryLastRefresh(channelId, new Date().toISOString());
        }
        if (outcome.complete && options?.reorder) requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('gsm:discovery-restore-anchor', { detail: { account, sessionKey: key } })));
        setChannelLoadStates(before => ({ ...before, [channelId]: { status: outcome.complete ? 'ready' : 'partial',
          issue: outcome.storageIssue ? taskIssue(outcome.storageIssue, 'storage') : outcome.issue ? taskIssue(outcome.issue, 'github') : undefined,
          unsaved: !!outcome.storageIssue,
          readingProgress: { current: Math.min(outcome.stage.projectKeys.length, outcome.stage.targetCount), total: outcome.stage.targetCount, reorder: options?.reorder === true },
        } }));
        if (outcome.complete && outcome.saved && useCustomDiscovery.getState().data.builtinPreferences?.[channelId]?.autoAnalyze) {
          enqueueAnalysis({ id: `builtin:${channelId}`, revision: 1 }, outcome.saved.items as unknown as DiscoveryRepo[], { auto: true });
        }
        return;
      }
      if (append && cached && (cached.buffer.length >= preferences.batchSize || !cached.session.hasMore)) {
        await saveBrowsePage(account, { key, channelId, signature, items: [], nextPage: cached.session.nextPage,
          hasMore: cached.session.hasMore, totalCount: cached.session.totalCount, mode: 'append', exposeCount: preferences.batchSize,
          isCurrent: () => isCurrentRequest() && !requestController.signal.aborted });
        const saved = await loadBrowseSession(account, key);
        if (saved && isCurrentRequest()) applySaved(saved);
        setChannelLoadStates(before => ({ ...before, [channelId]: { status: 'ready' } }));
        return;
      }
      const fetchPage = async (page: number, signal: AbortSignal) => {
      let result: PaginatedDiscoveryRepositories;
      switch (channelId) {
        case 'trending':
          result = await api.getTrendingRepositories(currentState.discoveryPlatform, page, 20, currentState.trendingTimeRange, signal);
          break;
        case 'hot-release':
          result = await api.getHotReleaseRepositories(currentState.discoveryPlatform, page, 20, {
            prereleases: useCustomDiscovery.getState().data.builtinPreferences?.['hot-release']?.prereleases === true,
            signal, onProgress: verification => {
              if (isCurrentRequest() && !requestController.signal.aborted) setChannelLoadStates(before => ({
                ...before, [channelId]: { status: 'loading', verification },
              }));
            },
          });
          break;
        case 'most-popular':
          result = await api.getMostPopular(currentState.discoveryPlatform, page, 20, signal);
          break;
        case 'topic':
          result = currentState.discoverySelectedTopic
            ? await api.getTopicRepositories(currentState.discoverySelectedTopic, currentState.discoveryPlatform, page, 20, signal)
            : await api.getTrendingRepositories(currentState.discoveryPlatform, page, 20, 'weekly', signal);
          break;
        case 'search':
          result = currentState.discoverySearchQuery.trim()
            ? await api.searchRepositories(currentState.discoverySearchQuery, currentState.discoveryPlatform, currentState.discoveryLanguage, currentState.discoverySortBy, currentState.discoverySortOrder, page, 20, signal)
            : { repos: [], hasMore: false, nextPageIndex: page + 1, totalCount: 0 };
          break;
        case 'weekly':
          // 新请求开始即清掉旧状态：缓存命中时 syncWeeklyChannel 不会回调 onStatus，
          // 不清会残留上一轮的进度文案
          useAppStore.getState().setWeeklySyncStatus(null);
          result = await syncWeeklyChannel(
            api,
            page,
            currentState.weeklyOnlyCollected,
            // 只有当前请求有权写进度，避免切换账号/过滤器后旧任务覆盖新页面的状态
            (status) => {
              if (isCurrentRequest()) {
                useAppStore.getState().setWeeklySyncStatus(status);
              }
            },
          );
          break;
        case 'x-tweet':
          useAppStore.getState().setXTweetSyncStatus(null);
          result = await syncXTweetChannel(
            api,
            page,
            currentState.xTweetFollows,
            (status) => {
              if (isCurrentRequest()) {
                useAppStore.getState().setXTweetSyncStatus(status);
              }
            },
            undefined,
            currentState.xTweetAuth,
          );
          break;
        case 'telegram':
          useAppStore.getState().setTelegramSyncStatus(null);
          result = await syncTelegramChannel(
            api,
            page,
            currentState.telegramFollows,
            (status) => {
              if (isCurrentRequest()) {
                useAppStore.getState().setTelegramSyncStatus(status);
              }
            },
          );
          break;
        default:
          result = { repos: [], hasMore: false, nextPageIndex: page + 1, totalCount: 0 };
      }
      return result;
      };
      const oldIds = new Set(cached?.session.itemKeys || []);
      const deadline = Date.now() + 60000;
      let cursor = page;
      let result: PaginatedDiscoveryRepositories = { repos: [], hasMore: true, nextPageIndex: cursor, totalCount: 0 };
      let partialIssue: unknown;
      for (let requests = 0; requests < 5 && Date.now() < deadline; requests++) {
        let next: PaginatedDiscoveryRepositories;
        try { next = await withDeadline(signal => fetchPage(cursor, signal), Math.min(15000, deadline - Date.now()), requestController.signal); }
        catch (error) {
          if (!result.repos.length || requestController.signal.aborted || !isCurrentRequest()) throw error;
          partialIssue = error; break;
        }
        if (!isCurrentRequest() || requestController.signal.aborted) return;
        const combined = mergeStableItems(result.repos, next.repos, discoveryItemKey);
        result = { ...next, repos: combined };
        cursor = next.nextPageIndex;
        const received = append ? combined.filter(r => !oldIds.has(discoveryItemKey(r))).length + (cached?.buffer.length || 0) : combined.length;
        if (!next.hasMore || received >= preferences.batchSize) break;
      }
      if (!isCurrentRequest()) return;
      const current = useAppStore.getState();
      source = 'storage';
      const scoped = useCustomDiscovery.getState();
      const active = current.aiConfigs.find(c => c.id === current.activeAIConfig);
      const cacheData = scoped.account === String(current.user?.id) ? scoped.data : { channels: [], editions: [], cache: {} };
      // Legacy repo-ID-only summaries have no trustworthy account/model/language identity.
      const mergedRepos = result.repos.map(repo => ({ ...repo, ...analyzedRepository(repo, cacheData, current.language, active) }));
      setChannelLoadStates(before => ({ ...before, [channelId]: { status: partialIssue || result.verification?.partial ? 'partial' : 'ready', verification: result.verification,
        issue: partialIssue ? taskIssue(partialIssue, 'github') : undefined } }));
      if (partialIssue) { taskFailed = true; journal.item(channelId, 'failed', partialIssue); if (append) currentState.setDiscoveryLoadMoreError(channelId, tRef.current('useDiscoveryActions.failed-to-load-more-please-retry')); }
      if (result.verification?.partial) { taskFailed = true; journal.item(channelId, 'failed', 'Release verification incomplete / Release 验证未完成'); }
      // x-tweet/telegram 每页返回累积前缀切片（服务按页整体重建窗口），加载
      // 更多时用替换语义写入，否则加深拉取新增的卡片落进已消费窗口内永远补不到
      const replacesOnAppend = channelId === 'x-tweet' || channelId === 'telegram';
      try {
        await saveBrowsePage(account, { key, channelId, signature, items: mergedRepos as unknown as Record<string, unknown>[],
          itemKeys: mergedRepos.map(discoveryItemKey), nextPage: result.nextPageIndex, hasMore: result.hasMore,
          totalCount: result.totalCount || 0, mode: append && !replacesOnAppend ? 'append' : 'replace',
          expectedVersion: append ? undefined : cached?.session.version || 0,
          exposeCount: replacesOnAppend && append ? (cached?.session.itemKeys.length || 0) + preferences.batchSize : preferences.batchSize,
          isCurrent: () => isCurrentRequest() && !requestController.signal.aborted });
        const saved = await loadBrowseSession(account, key);
        if (!isCurrentRequest()) return;
        if (saved) applySaved(saved);
      } catch (error) {
        if (!isCurrentRequest() || requestController.signal.aborted) return;
        taskFailed = true; journal.item(channelId, 'failed', error, 'committing');
        if (append && !replacesOnAppend) currentState.setDiscoveryRepos(channelId, mergeStableItems(current.discoveryRepos[channelId] || [], mergedRepos, discoveryItemKey));
        else currentState.setDiscoveryRepos(channelId, mergedRepos);
        currentState.setDiscoveryHasMore(channelId, result.hasMore);
        currentState.setDiscoveryNextPage(channelId, result.nextPageIndex);
        currentState.setDiscoveryTotalCount(channelId, result.totalCount || 0);
        currentState.setDiscoveryLastRefresh(channelId, new Date().toISOString());
        setChannelLoadStates(before => ({ ...before, [channelId]: { status: 'ready', unsaved: true, issue: taskIssue(error, 'storage') } }));
      }
      if (!append && scoped.account === String(current.user?.id) && scoped.data.builtinPreferences?.[channelId]?.autoAnalyze) {
        enqueueAnalysis({ id: `builtin:${channelId}`, revision: 1 }, mergedRepos, { auto: true });
      }
    } catch (error) {
      if (!isCurrentRequest()) return;
      taskFailed = true; if (!requestController.signal.aborted) journal.item(channelId, 'failed', error);
      const issue = { ...taskIssue(error), source };
      setChannelLoadStates(before => ({ ...before, [channelId]: { status: issue.kind === 'cancelled' ? 'cancelled' : 'error', issue } }));
      console.error(`Failed to refresh channel ${channelId}:`, error);
      if (append) {
        currentState.setDiscoveryLoadMoreError(channelId, tRef.current('useDiscoveryActions.failed-to-load-more-please-retry'));
      } else {
        currentState.setDiscoveryLoadMoreError(channelId, issue.kind === 'cancelled' ? null : tRef.current('useDiscoveryActions.failed-to-fetch-data-please-check-your-network-c'));
        const errorMsg = error instanceof Error ? error.message : '';
        if (channelId === 'x-tweet') {
          toast(errorMsg ? `${tRef.current('useDiscoveryActions.failed-to-fetch-x-tweets')}: ${errorMsg}` : tRef.current('useDiscoveryActions.failed-to-fetch-x-tweets-please-check-your-netwo'), 'error');
        } else if (channelId === 'telegram') {
          toast(errorMsg ? `${tRef.current('useDiscoveryActions.failed-to-fetch-telegram-messages')}: ${errorMsg}` : tRef.current('useDiscoveryActions.failed-to-fetch-telegram-messages-please-check-y'), 'error');
        } else {
          toast(errorMsg || tRef.current('useDiscoveryActions.failed-to-fetch-data-please-check-your-network-c'), 'error');
        }
      }
    } finally {
      if (!taskFailed && isCurrentRequest() && !requestController.signal.aborted) journal.item(channelId, 'complete');
      journal.finish(requestController.signal.aborted || !isCurrentRequest() ? 'canceled' : undefined);
      if (channelId === 'weekly' && isCurrentRequest()) {
        useAppStore.getState().setWeeklySyncStatus(null);
      }
      if (channelId === 'x-tweet' && isCurrentRequest()) {
        useAppStore.getState().setXTweetSyncStatus(null);
      }
      if (channelId === 'telegram' && isCurrentRequest()) {
        useAppStore.getState().setTelegramSyncStatus(null);
      }
      if (ownsLoading()) {
        if (append) currentState.setDiscoveryLoadingMore(channelId, false);
        else currentState.setDiscoveryLoading(channelId, false);
      }
    }
  }, [captureSession, isCurrentSession, refreshExternalFeed, toast]);

  const handleAnalyzePage = useCallback(async () => {
    const analysisState = latestStateRef.current;
    if (!analysisState.githubToken) return;
    const activeConfig = analysisState.aiConfigs.find(config => config.id === analysisState.activeAIConfig);
    if (!activeConfig) {
      toast(t('useDiscoveryActions.please-configure-ai-service-in-settings-first'), 'error');
      return;
    }
    if (!isAIConfigAvailable(activeConfig)) {
      toast(t('useDiscoveryActions.ai-service-configuration-is-incomplete-please-ch'), 'error');
      return;
    }
    const pageRepos = analysisState.discoveryRepos[analysisState.selectedDiscoveryChannel] || [];
    const unanalyzed = pageRepos.filter(repo => !repo.analyzed_at || repo.analysis_failed);
    if (unanalyzed.length === 0) {
      toast(t('useDiscoveryActions.all-loaded-projects-have-been-analyzed'), 'info');
      return;
    }

    const analysisSession = captureSession();
    setIsAnalyzing(true);
    const current = useAppStore.getState();
    const categories = getAllCategories(current.customCategories, current.language, current.hiddenDefaultCategoryIds, current.defaultCategoryOverrides);
    const categoryNames = [
      ...current.customCategories.map(category => category.name),
      ...(analysisState.language === 'zh'
        ? ['全部分类', 'Web应用', '移动应用', '桌面应用', '数据库', 'AI/机器学习', '开发工具', '安全工具', '游戏', '设计工具', '效率工具', '教育学习', '社交网络', '数据分析']
        : ['All', 'Web Apps', 'Mobile Apps', 'Desktop Apps', 'Database', 'AI/ML', 'Dev Tools', 'Security Tools', 'Games', 'Design Tools', 'Productivity', 'Education', 'Social Networks', 'Data Analysis']),
    ];
    const optimizer = new AIAnalysisOptimizer({
      initialConcurrency: activeConfig.provider === 'agy-cli' ? agyFeatureConcurrency(activeConfig, 'repository-summary') : activeConfig.concurrency || 3,
      maxConcurrency: activeConfig.provider === 'agy-cli' ? agyFeatureConcurrency(activeConfig, 'repository-summary') : activeConfig.concurrency || 3,
      ...(activeConfig.provider === 'agy-cli' ? { maxConcurrency: agyFeatureConcurrency(activeConfig, 'repository-summary'), enableAdaptiveConcurrency: false } : {}),
      rateLimiter: { maxConcurrency: 0, requestsPerMinute: activeConfig.requestsPerMinute || 0 },
    });
    optimizerRef.current = optimizer;
    analysisState.setAnalysisProgress({ current: 0, total: unanalyzed.length });
    try {
      const api = createGitHubApiService(analysisState.githubToken);
      const service = new AIService(forAgyFeature(activeConfig, 'repository-summary', 'background'), analysisState.language);
      const readmeCache = await optimizer.prefetchReadmes(unanalyzed, api);
      if (optimizer.isAborted() || !isCurrentSession(analysisSession)) return;
      const results = await optimizer.analyzeRepositories(
        unanalyzed,
        readmeCache,
        service,
        categoryNames,
        buildCategoryHints(current.customCategories),
        (progressCurrent, total) => {
          if (!optimizer.isAborted() && isCurrentSession(analysisSession)) {
            analysisState.setAnalysisProgress({ current: progressCurrent, total });
          }
        },
        result => {
          if (optimizer.isAborted() || !isCurrentSession(analysisSession) || !result.repo) return;
          const analyzedAt = new Date().toISOString();
          if (result.success) {
            const updatedRepo: DiscoveryRepo = {
              ...result.repo,
              rank: 0,
              channel: analysisState.selectedDiscoveryChannel,
              platform: analysisState.discoveryPlatform,
              ai_summary: result.summary,
              ai_tags: result.tags,
              ai_platforms: result.platforms,
              custom_category: resolveCategoryAssignment({ ...result.repo, ai_summary: result.summary }, result.tags || [], categories),
              category_locked: !!result.repo.category_locked,
              analyzed_at: analyzedAt,
              analysis_failed: false,
              analysis_error: undefined,
            };
            analysisState.updateDiscoveryRepo(updatedRepo);
            void discoveryAnalysisStorage.saveAnalysis(updatedRepo.id, { ai_summary: result.summary, ai_tags: result.tags, ai_platforms: result.platforms, analyzed_at: analyzedAt, analysis_failed: false, analysis_error: undefined });
          } else {
            const failedRepo: DiscoveryRepo = { ...result.repo, rank: 0, channel: analysisState.selectedDiscoveryChannel, platform: analysisState.discoveryPlatform, analyzed_at: analyzedAt, analysis_failed: true, analysis_error: result.error?.message || undefined };
            analysisState.updateDiscoveryRepo(failedRepo);
            void discoveryAnalysisStorage.saveAnalysis(failedRepo.id, { analyzed_at: analyzedAt, analysis_failed: true, analysis_error: failedRepo.analysis_error });
          }
        },
      );
      if (optimizer.isAborted() || !isCurrentSession(analysisSession)) return;
      const successCount = results.filter(result => result.success).length;
      const failCount = results.length - successCount;
      toast(t(failCount > 0 ? 'useDiscoveryActions.ai-analysis-complete-with-failures' : 'useDiscoveryActions.ai-analysis-complete', { successCount: successCount, failCount: failCount }), successCount === 0 ? 'error' : failCount > 0 ? 'info' : 'success');
    } catch (error) {
      if (optimizer.isAborted() || !isCurrentSession(analysisSession)) return;
      console.error('AI analysis error:', error);
      toast(t('useDiscoveryActions.ai-analysis-failed-please-check-your-ai-configur'), 'error');
    } finally {
      if (optimizerRef.current === optimizer) optimizerRef.current = null;
      if (isCurrentSession(analysisSession)) {
        setIsAnalyzing(false);
        analysisState.setAnalysisProgress({ current: 0, total: 0 });
      }
    }
  }, [captureSession, isCurrentSession, t, toast]);

  const handleAbortAnalysis = useCallback(() => {
    optimizerRef.current?.abort();
  }, []);

  const cancelChannel = useCallback((channelId: DiscoveryChannelId) => requestControllers.current[channelId]?.abort(), []);
  return { ...state, channelLoadStates, t, isAnalyzing, refreshChannel, cancelChannel, handleAnalyzePage, handleAbortAnalysis };
};
import { isAIConfigAvailable } from '../../../utils/aiConfig';
