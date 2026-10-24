import { useT } from "../i18n/useT";
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { Bot, FolderTree, SearchX, X } from 'lucide-react';
import { useAIOrganization } from '../hooks/useAIOrganization';
import { AIOrganizationPanel } from './AIOrganizationPanel';
import { RepositoryCard } from './RepositoryCard';
import { SimilarViewBanner } from './SimilarViewBanner';
import { GlobalChatHistorySheet } from './GlobalChatHistorySheet';
import { BulkActionToolbar } from './BulkActionToolbar';
import { BulkCategorizeModal } from './BulkCategorizeModal';
import { BulkRestoreModal, RestoreConfig } from './BulkRestoreModal';
import { ErrorBoundary } from './ErrorBoundary';

import { Repository } from '../types';
import { useClassificationStore as useAppStore, getAllCategories } from '../store/useClassificationStore';
import { repositoryChatStorage } from '../services/repositoryChatStorage';
import { matchesCategory } from '../utils/categoryUtils';
import { sortRepositories } from '../utils/repoSearch';
import { useRepositoryDetailAnalysisJob } from '../features/repositories/hooks/useRepositoryDetailAnalysisJob';
import { useBulkRepositoryActions } from '../features/repositories/hooks/useBulkRepositoryActions';
import { useDialog } from '../hooks/useDialog';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem } from './ui/dropdown-menu';
import { RepositoryGroups } from '../features/repositories/components/RepositoryGroups';
import { RepositoryGrid } from '../features/repositories/components/RepositoryGrid';
import { PendingClassification } from '../features/repositories/components/PendingClassification';
import { RepositoryToolbarPortal } from '../features/repositories/components/RepositoryToolbarPortal';
import { orderedIds } from '../features/repositories/components/repositoryGroupOrder';
import { assignClassificationRepositories, captureClassificationEdit, type ClassificationEditCapture } from '../features/repositories/components/classificationEditActions';
import type { ClassificationTarget } from '../store/helpers/classificationEdits';
import { RepositoryDetailAnalysisAction } from './RepositoryDetailAnalysisAction';
import { useRepositoryAnalysisPresentation } from '../features/repositories/hooks/useRepositoryAnalysisPresentation';
import { ExplorationExplorer } from '../features/repositories/exploration/ExplorationExplorer';
import { matchesFacetSelection, type FacetSelection } from '../utils/classificationFacets';
import { latestRepositoryRelease } from '../utils/latestRepositoryRelease';
import { usePluginActions } from '../plugins/hooks/usePluginActions';

const LazyRepositoryDetailsPanel = React.lazy(() =>
  import('./RepositoryDetailsPanel').then(module => ({ default: module.RepositoryDetailsPanel }))
);

const LazyRepositoryChatSheet = React.lazy(() =>
  import('./RepositoryChatSheet').then((module) => ({ default: module.default }))
);

interface RepositoryListProps {
  repositories: Repository[];
  selectedCategory: string;
}

export const RepositoryList: React.FC<RepositoryListProps> = ({
  repositories,
  selectedCategory
}) => {
  const presentedRepositories = useRepositoryAnalysisPresentation(repositories);
  const {
    language,
    customCategories,
    hiddenDefaultCategoryIds,
    defaultCategoryOverrides,
    classificationContext,
    categoryMatchMode,
    searchFilters,
    setSearchFilters,
    similarView,
    resetSimilarView,
    repositoryViewMode,
    repositoryOrder,
    subcategories,
    subcategoryOrder,
    activeClassificationScheme,
    accountId,
    classificationNavigation,
    setClassificationLocation,
    setClassificationExpanded,
    releases,
  } = useAppStore(useShallow((state) => ({
    language: state.language,
    customCategories: state.customCategories,
    hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
    defaultCategoryOverrides: state.defaultCategoryOverrides,
    classificationContext: state.classificationContext,
    categoryMatchMode: state.categoryMatchMode,
    searchFilters: state.searchFilters,
    setSearchFilters: state.setSearchFilters,
    similarView: state.similarView,
    resetSimilarView: state.resetSimilarView,
    repositoryViewMode: state.repositoryViewMode,
    setRepositoryViewMode: state.setRepositoryViewMode,
    repositoryOrder: state.repositoryOrder,
    subcategories: state.subcategories,
    subcategoryOrder: state.subcategoryOrder,
    activeClassificationScheme: state.activeClassificationScheme ?? 'purpose',
    accountId: String(state.user?.id ?? 'anonymous'),
    classificationNavigation: state.classificationNavigation,
    setClassificationLocation: state.setClassificationLocation,
    setClassificationExpanded: state.setClassificationExpanded,
    releases: state.releases,
  })));
  const cardPluginActions = usePluginActions('repository-card');

  // 空状态的"清除全部筛选"出口：同步重置全局筛选条件与顶部 SearchBar 搜索词
  const clearAllFilters = useCallback(() => {
    setFacetFilters({});
    window.dispatchEvent(new CustomEvent('gsm:clear-search-query'));
    setSearchFilters({
      query: '',
      tags: [],
      languages: [],
      platforms: [],
      licenses: [],
      minStars: undefined,
      maxStars: undefined,
      isAnalyzed: undefined,
      isSubscribed: undefined,
      isEdited: undefined,
      isCategoryLocked: undefined,
      analysisFailed: undefined,
      healthArchived: undefined,
      healthRecentActivity: undefined,
      healthHasLicense: undefined,
    });
  }, [setSearchFilters]);

  const hasActiveNonQueryFilters = useMemo(() => {
    // 契约测试的极简 store 只提供 query 字段；其余字段缺省时视为无筛选。
    if (!searchFilters) return false;
    return (searchFilters.languages?.length ?? 0) > 0 ||
      (searchFilters.tags?.length ?? 0) > 0 ||
      (searchFilters.platforms?.length ?? 0) > 0 ||
      (searchFilters.licenses?.length ?? 0) > 0 ||
      searchFilters.minStars !== undefined ||
      searchFilters.maxStars !== undefined ||
      searchFilters.isAnalyzed !== undefined ||
      searchFilters.isSubscribed !== undefined ||
      searchFilters.isEdited !== undefined ||
      searchFilters.isCategoryLocked !== undefined ||
      searchFilters.analysisFailed !== undefined ||
      searchFilters.healthArchived !== undefined ||
      searchFilters.healthRecentActivity !== undefined ||
      searchFilters.healthHasLicense !== undefined;
  }, [searchFilters]);


  const { toast, confirm } = useDialog();

  const [showAISummary, setShowAISummary] = useState(true);
  const [disableCardAnimations, setDisableCardAnimations] = useState(false);
  const previousCategoryRef = useRef(selectedCategory);
  const savedScrollYRef = useRef<number | null>(null);
  const restoreScrollFrameRef = useRef<number | null>(null);
  

  // 批量选择状态
  const [selectedRepoIds, setSelectedRepoIds] = useState<Set<number>>(new Set());
  const [showBulkToolbar, setShowBulkToolbar] = useState(false);
  const [showCategorizeModal, setShowCategorizeModal] = useState(false);
  const bulkClassificationRef = useRef<{ capture: ClassificationEditCapture; ids: number[] } | null>(null);
  useEffect(() => {
    bulkClassificationRef.current = null;
    setShowCategorizeModal(false); setShowBulkToolbar(false); setSelectedRepoIds(new Set());
  }, [accountId]);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [facetFilters, setFacetFilters] = useState<FacetSelection>({});
  const hasActiveFacetFilters = Object.values(facetFilters).some(values => values?.length);
  useEffect(() => { setFacetFilters({}); }, [selectedCategory, activeClassificationScheme, accountId]);
  useEffect(() => {
    const clearFacets = () => setFacetFilters({});
    window.addEventListener('gsm:clear-facet-filters', clearFacets);
    return () => window.removeEventListener('gsm:clear-facet-filters', clearFacets);
  }, []);
  const [isUltraWideScreen, setIsUltraWideScreen] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 1600px)').matches
      : false
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 1600px)');
    const update = (e: MediaQueryListEvent) => setIsUltraWideScreen(e.matches);
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  const [isExitingSelection, setIsExitingSelection] = useState(false);
  const selectionExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeChatRepository, setActiveChatRepository] = useState<Repository | null>(null);
  const [activeDetailRepository, setActiveDetailRepository] = useState<Repository | null>(null);
  const [detailsPinned, setDetailsPinned] = useState(false);
  const activeChatTriggerRef = useRef<HTMLElement | null>(null);
  // 全局问答历史（S4 入口）：抽屉 + 从历史进入单仓会话的目标会话。
  const [globalHistoryOpen, setGlobalHistoryOpen] = useState(false);
  const [globalChatSessionId, setGlobalChatSessionId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const openTarget = async () => {
      try {
        const target = JSON.parse(sessionStorage.getItem('gsm:pending-task-target') ?? 'null') as { view?: string; id?: string; owner?: string; kind?: string } | null;
        if (target?.view !== 'repositories' || !target.id || target.owner !== String(useAppStore.getState().user?.id ?? '')) return;
        sessionStorage.removeItem('gsm:pending-task-target');
        if (target.kind === 'chat') {
          const session = await repositoryChatStorage.getSession(target.id);
          if (!alive || !session || session.ownerId !== target.owner) return;
          const repository = repositories.find(item => item.id === session.repoId);
          if (repository) { setGlobalChatSessionId(session.id); setActiveChatRepository(repository); }
        } else {
          const repository = repositories.find(item => String(item.id) === target.id || item.full_name === target.id);
          if (repository) setActiveDetailRepository(repository);
        }
      } catch { sessionStorage.removeItem('gsm:pending-task-target'); }
    };
    const consume = () => { void openTarget(); };
    consume(); window.addEventListener('gsm:task-navigate', consume);
    return () => { alive = false; window.removeEventListener('gsm:task-navigate', consume); };
  }, [repositories]);

  const allCategories = useMemo(
    () => getAllCategories(customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides, classificationContext),
    [customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides, classificationContext]
  );
  const analysisJob = useRepositoryDetailAnalysisJob();
  const [analysisRequest, setAnalysisRequest] = useState<{ repositories: Repository[]; accountId?: number }>();
  const requestAnalysis = useCallback((repository: Repository) => {
    setShowAISummary(true);
    setAnalysisRequest({ repositories: [repository], accountId: useAppStore.getState().user?.id });
  }, []);
  const bulkActions = useBulkRepositoryActions({ allCategories });
  const isLoading = analysisJob.running;

  useEffect(() => {
    try {
      const pending = JSON.parse(sessionStorage.getItem('gsm:repository-chat-return') || 'null') as { repoId?: unknown } | null;
      if (typeof pending?.repoId !== 'number') return;
      const targetRepository = presentedRepositories.find((repository) => repository.id === pending.repoId);
      if (targetRepository) setActiveChatRepository(targetRepository);
    } catch {
      sessionStorage.removeItem('gsm:repository-chat-return');
    }
  }, [presentedRepositories]);

  const categoryRepositories = useMemo(() => selectedCategory === 'pending'
      ? presentedRepositories.filter(repo => repo.category_id == null)
      : selectedCategory === 'all' || similarView?.active
      ? presentedRepositories
      : (() => {
        const subgroup = (subcategories ?? []).find(group => group.id === selectedCategory);
        if (subgroup) return presentedRepositories.filter(repo => repo.subcategory_id === subgroup.id && repo.category_id === subgroup.parentId);
        const selectedCategoryObj = allCategories.find(cat => cat.id === selectedCategory);
        return selectedCategoryObj
          ? presentedRepositories.filter(repo => matchesCategory(repo, selectedCategoryObj, categoryMatchMode))
          : [];
      })(), [presentedRepositories, selectedCategory, allCategories, categoryMatchMode, similarView?.active, subcategories]);
  const filteredRepositories = useMemo(() => {
    const facetRepositories = categoryRepositories.filter(repository => matchesFacetSelection(repository, facetFilters, activeClassificationScheme));
    // Similar results arrive pre-ranked by the vector worker's cosine score.
    // Do not let the normal list preference (stars/updated/name) overwrite that
    // relevance ordering after the card action has entered similar-view mode.
    if (similarView?.active) return facetRepositories;
    if (searchFilters.sortBy === 'custom') {
      const byId = new Map(facetRepositories.map(repo => [repo.id, repo]));
      return orderedIds(repositoryOrder ?? [], [...byId.keys()]).map(id => byId.get(id)!);
    }
    return sortRepositories(facetRepositories, searchFilters.sortBy, searchFilters.sortOrder);
  }, [categoryRepositories, searchFilters.sortBy, searchFilters.sortOrder, similarView?.active, repositoryOrder, facetFilters, activeClassificationScheme]);
  const grouped = selectedCategory !== 'all' && selectedCategory !== 'pending' &&
    !similarView?.active &&
    allCategories.some(category => category.id === selectedCategory);

  // 根据当前筛选的仓库中是否有AI分析内容来动态设置默认显示模式
  const hasAnalyzedRepos = useMemo(() => 
    filteredRepositories.some(repo => repo.analyzed_at && !repo.analysis_failed),
    [filteredRepositories]
  );
  
  // 当切换分类时，如果目标分类没有AI分析的仓库，自动切换到原始描述
  // 注意：不要在搜索/过滤过程中触发，否则会误关用户的显示偏好
  const prevHasAnalyzedRef = useRef(hasAnalyzedRepos);
  const prevCategoryRefForAI = useRef(selectedCategory);
  useEffect(() => {
    const categoryChanged = prevCategoryRefForAI.current !== selectedCategory;
    prevCategoryRefForAI.current = selectedCategory;
    prevHasAnalyzedRef.current = hasAnalyzedRepos;

    if (categoryChanged && !hasAnalyzedRepos && showAISummary) {
      setShowAISummary(false);
    }
  }, [hasAnalyzedRepos, selectedCategory, showAISummary]);

  // Infinite scroll (瀑布流按需加载)
  const LOAD_BATCH = 50;
  const [visibleCount, setVisibleCount] = useState(LOAD_BATCH);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const visibleRepositories = filteredRepositories.slice(0, visibleCount);

  // 派生选中的仓库数组，统一用于计数与传递
  const selectedRepositories = useMemo(() =>
    filteredRepositories.filter(repo => selectedRepoIds.has(repo.id)),
    [filteredRepositories, selectedRepoIds]
  );
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const organization = useAIOrganization({ filteredRepositories, selectedRepositoryIds: [...selectedRepoIds], categoryId: selectedCategory });
  useEffect(() => {
    const openAgent = () => {
      const raw = sessionStorage.getItem('gsm:pending-agent-organization');
      if (!raw) return;
      try {
        const target = JSON.parse(raw) as { ownerId: string };
        if (target.ownerId === String(useAppStore.getState().user?.id ?? '')) setOrganizationOpen(true);
      } catch { /* Invalid navigation targets do not open a dialog. */ }
    };
    openAgent(); window.addEventListener('gsm:agent-organization-open', openAgent);
    return () => window.removeEventListener('gsm:agent-organization-open', openAgent);
  }, []);

  // 使用 useMemo 缓存统计计数，避免每次渲染重新计算
  const repositoryStats = useMemo(() => {
    let unanalyzedCount = 0;
    let analyzedCount = 0;
    let failedCount = 0;

    for (const repo of filteredRepositories) {
      if (repo.analysis_failed) {
        failedCount++;
      } else if (repo.analyzed_at) {
        analyzedCount++;
      } else {
        unanalyzedCount++;
      }
    }

    return { unanalyzedCount, analyzedCount, failedCount };
  }, [filteredRepositories]);

  const filterResetKey = useMemo(() => ({
    selectedCategory,
    query: searchFilters.query,
    languages: searchFilters.languages,
    tags: searchFilters.tags,
    platforms: searchFilters.platforms,
    licenses: searchFilters.licenses,
    sortBy: searchFilters.sortBy,
    sortOrder: searchFilters.sortOrder,
    minStars: searchFilters.minStars,
    maxStars: searchFilters.maxStars,
    isAnalyzed: searchFilters.isAnalyzed,
    isSubscribed: searchFilters.isSubscribed,
    isEdited: searchFilters.isEdited,
    isCategoryLocked: searchFilters.isCategoryLocked,
    analysisFailed: searchFilters.analysisFailed,
    healthArchived: searchFilters.healthArchived,
    healthRecentActivity: searchFilters.healthRecentActivity,
    healthHasLicense: searchFilters.healthHasLicense,
  }), [
    selectedCategory,
    searchFilters.query,
    searchFilters.languages,
    searchFilters.tags,
    searchFilters.platforms,
    searchFilters.licenses,
    searchFilters.sortBy,
    searchFilters.sortOrder,
    searchFilters.minStars,
    searchFilters.maxStars,
    searchFilters.isAnalyzed,
    searchFilters.isSubscribed,
    searchFilters.isEdited,
    searchFilters.isCategoryLocked,
    searchFilters.analysisFailed,
    searchFilters.healthArchived,
    searchFilters.healthRecentActivity,
    searchFilters.healthHasLicense,
  ]);

  // Reset visible count only when filter context changes.
  useEffect(() => {
    setVisibleCount(LOAD_BATCH);
  }, [filterResetKey, facetFilters]);

  useEffect(() => {
    if (previousCategoryRef.current !== selectedCategory) {
      window.scrollTo({ top: 0, behavior: 'auto' });
      previousCategoryRef.current = selectedCategory;
    }
  }, [selectedCategory]);

  // Clamp visible count when result set becomes smaller, but do not collapse
  // back to the initial batch during backend sync refreshes.
  useEffect(() => {
    setVisibleCount((count) => {
      if (filteredRepositories.length === 0) return LOAD_BATCH;
      return Math.min(count, filteredRepositories.length);
    });
  }, [filteredRepositories.length]);

  // IntersectionObserver to load more on demand
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          setVisibleCount((count) => {
            if (count >= filteredRepositories.length) return count;
            return Math.min(count + LOAD_BATCH, filteredRepositories.length);
          });
        }
      },
      { root: null, rootMargin: '200px', threshold: 0 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [filteredRepositories.length, grouped]);

  useEffect(() => {
    const handleSyncVisualState = (event: Event) => {
      const customEvent = event as CustomEvent<{ isSyncing?: boolean }>;
      const isSyncing = !!customEvent.detail?.isSyncing;
      setDisableCardAnimations(isSyncing);

      if (isSyncing) {
        savedScrollYRef.current = window.scrollY;
        if (restoreScrollFrameRef.current !== null) {
          cancelAnimationFrame(restoreScrollFrameRef.current);
          restoreScrollFrameRef.current = null;
        }
        return;
      }

      const targetScrollY = savedScrollYRef.current;
      if (targetScrollY === null) return;

      restoreScrollFrameRef.current = window.requestAnimationFrame(() => {
        restoreScrollFrameRef.current = window.requestAnimationFrame(() => {
          window.scrollTo({ top: targetScrollY, behavior: 'auto' });
          restoreScrollFrameRef.current = null;
          savedScrollYRef.current = null;
        });
      });
    };

    window.addEventListener('gsm:repository-sync-visual-state', handleSyncVisualState as EventListener);
    return () => {
      if (restoreScrollFrameRef.current !== null) {
        cancelAnimationFrame(restoreScrollFrameRef.current);
      }
      window.removeEventListener('gsm:repository-sync-visual-state', handleSyncVisualState as EventListener);
    };
  }, []);

  const t = useT('repositories');

  const handleAIAnalyze = (analyzeUnanalyzedOnly: boolean = false, analyzeFailedOnly: boolean = false) => {
    const targetRepositories = analyzeFailedOnly
      ? filteredRepositories.filter((repository) => repository.analysis_failed)
      : analyzeUnanalyzedOnly
        ? filteredRepositories.filter((repository) => !repository.analyzed_at)
        : filteredRepositories;

    setShowAISummary(true);
    setAnalysisRequest({ repositories: targetRepositories, accountId: useAppStore.getState().user?.id });
  };


  // 批量操作处理函数
  // 使用 useCallback 优化事件处理函数
  const handleSelectRepo = useCallback((id: number) => {
    setSelectedRepoIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
    // 使用 requestAnimationFrame 延迟显示工具栏，避免布局抖动
    requestAnimationFrame(() => {
      setSelectedRepoIds(current => {
        setShowBulkToolbar(current.size > 0);
        return current;
      });
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const allIds = new Set(filteredRepositories.map(repo => repo.id));
    setSelectedRepoIds(allIds);
    setShowBulkToolbar(true);
  }, [filteredRepositories]);

  const handleDeselectAll = useCallback(() => {
    setIsExitingSelection(true);
    if (selectionExitTimerRef.current !== null) clearTimeout(selectionExitTimerRef.current);
    selectionExitTimerRef.current = setTimeout(() => {
      selectionExitTimerRef.current = null;
      setSelectedRepoIds(new Set());
      setShowBulkToolbar(false);
      requestAnimationFrame(() => {
        setIsExitingSelection(false);
      });
    }, 250);
  }, []);

  useEffect(() => () => {
    if (selectionExitTimerRef.current !== null) clearTimeout(selectionExitTimerRef.current);
  }, []);

  // 处理单击空白处 - 触发回到顶部按钮跳跃动画
  const handleClick = useCallback((e: React.MouseEvent) => {
    // 检查点击的是否是空白区域（不是卡片或其他元素）
    if (showBulkToolbar && e.target === e.currentTarget) {
      // 触发自定义事件，让回到顶部按钮跳跃两下
      window.dispatchEvent(new CustomEvent('gsm:back-to-top-bounce'));
    }
  }, [showBulkToolbar]);

  // 处理双击空白处退出多选模式
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    // 检查点击的是否是空白区域（不是卡片或其他元素）
    if (showBulkToolbar && e.target === e.currentTarget) {
      handleDeselectAll();
    }
  }, [showBulkToolbar, handleDeselectAll]);

  const handleAskRepository = useCallback((repository: Repository) => {
    const trigger = document.activeElement;
    activeChatTriggerRef.current = trigger instanceof HTMLElement ? trigger : null;
    setGlobalChatSessionId(null);
    setActiveChatRepository(repository);
  }, []);

  // S4 全局入口（SearchBar「问答历史」按钮）经窗口事件打开历史抽屉。
  useEffect(() => {
    const handleOpenGlobalHistory = () => setGlobalHistoryOpen(true);
    window.addEventListener('gsm:open-global-chat-history', handleOpenGlobalHistory);
    return () => window.removeEventListener('gsm:open-global-chat-history', handleOpenGlobalHistory);
  }, []);

  const handleSelectGlobalSession = useCallback((repository: Repository, sessionId: string) => {
    const trigger = document.activeElement;
    activeChatTriggerRef.current = trigger instanceof HTMLElement ? trigger : null;
    setGlobalChatSessionId(sessionId);
    setActiveChatRepository(repository);
    setGlobalHistoryOpen(false);
  }, []);

  const handleCloseChat = useCallback(() => {
    setActiveChatRepository(null);
    setGlobalChatSessionId(null);
  }, []);

  const handleBackToGlobalHistory = useCallback(() => {
    setActiveChatRepository(null);
    setGlobalChatSessionId(null);
    setGlobalHistoryOpen(true);
  }, []);

  const handleBulkAction = async (action: string, selectedRepositories: Repository[]) => {
    try {
      let completed = false;
      switch (action) {
        case 'unstar':
          completed = await bulkActions.unstar(selectedRepositories);
          break;
        case 'categorize':
          bulkClassificationRef.current = { capture: captureClassificationEdit(activeClassificationScheme), ids: selectedRepositories.map(repository => repository.id) };
          setShowCategorizeModal(true);
          return;
        case 'restore':
          setShowRestoreModal(true);
          return;
        case 'ai-summary':
          setShowAISummary(true);
          setAnalysisRequest({ repositories: selectedRepositories, accountId: useAppStore.getState().user?.id });
          return;
        case 'subscribe':
          completed = await bulkActions.subscribe(selectedRepositories);
          break;
        case 'unsubscribe':
          completed = await bulkActions.unsubscribe(selectedRepositories);
          break;
        case 'lock-category':
          completed = await bulkActions.lockCategory(selectedRepositories);
          break;
        case 'unlock-category':
          completed = await bulkActions.unlockCategory(selectedRepositories);
          break;
        default:
          toast(t('repositoryList.unknown-action'), 'error');
          completed = true;
      }

      if (completed) {
        handleDeselectAll();
      }
    } catch (error) {
      console.error('Bulk action failed:', error);
      toast(t('repositoryList.bulk-action-failed'), 'error');
    }
  };

  const handleBulkAssign = async (target: ClassificationTarget) => {
    const pending = bulkClassificationRef.current;
    if (!pending) return false;
    const completed = await assignClassificationRepositories(pending.ids, target, { confirm, toast }, pending.capture);
    if (completed && (useAppStore.getState().user?.id ?? null) === pending.capture.expectedAccountId) handleDeselectAll();
    return completed;
  };
  const handleBulkCategorize = async (categoryName: string) => {
    const category = allCategories.find(item => item.name === categoryName && item.id !== 'all');
    if (!category) return;
    await handleBulkAssign({ categoryId: category.id, subcategoryId: null });
  };

  const handleBulkRestore = async (config: RestoreConfig) => {
    const selectedRepositories = repositories.filter((repository) => selectedRepoIds.has(repository.id));
    if (await bulkActions.restore(selectedRepositories, config)) {
      handleDeselectAll();
    }
  };

  const chatPortal = activeChatRepository && createPortal(
    <ErrorBoundary>
      <React.Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 text-sm text-muted-foreground" role="status">{t('repositoryList.opening-repository-chat')}</div>}>
        <LazyRepositoryChatSheet
          isOpen
          repository={activeChatRepository}
          initialSessionId={globalChatSessionId}
          onBack={globalChatSessionId ? handleBackToGlobalHistory : undefined}
          onClose={handleCloseChat}
          onCloseAutoFocus={() => activeChatTriggerRef.current?.focus()}
        />
      </React.Suspense>
    </ErrorBoundary>,
    document.body,
  );

  const globalHistorySheet = (
    <GlobalChatHistorySheet
      isOpen={globalHistoryOpen}
      onClose={() => setGlobalHistoryOpen(false)}
      repositories={repositories}
      onSelectSession={handleSelectGlobalSession}
    />
  );

  const zh = String(language).startsWith('zh');
  const selectedSubgroup = (subcategories ?? []).find(group => group.id === selectedCategory);
  const parentCategory = allCategories.find(category => category.id === (selectedSubgroup?.parentId ?? selectedCategory));
  const navigateCategory = (categoryId: string) => {
    setClassificationLocation?.(activeClassificationScheme, categoryId);
    if (categoryId !== 'all' && categoryId !== 'pending') {
      const expanded = classificationNavigation?.[activeClassificationScheme]?.expanded ?? [];
      setClassificationExpanded?.(activeClassificationScheme, [...new Set([...expanded, categoryId])]);
    }
  };
  const schemeLabel = activeClassificationScheme === 'technology' ? (zh ? '技术' : 'Technology') : (zh ? '用途' : 'Purpose');
  const categoryLabel = parentCategory?.name ?? selectedSubgroup?.parentId ?? (selectedCategory === 'pending' ? (zh ? '待分类' : 'Pending') : selectedCategory);
  const breadcrumb = <nav aria-label={zh ? '分类路径' : 'Classification path'} className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
    {selectedCategory === 'all' ? <span aria-current="page" className="font-medium">{schemeLabel}</span> : <button type="button" className="rounded px-1 py-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => navigateCategory('all')}>{schemeLabel}</button>}
    {selectedCategory !== 'all' && <><span aria-hidden="true" className="text-muted-foreground">/</span>{selectedSubgroup ? <button type="button" className="rounded px-1 py-1 hover:bg-muted" onClick={() => navigateCategory(parentCategory?.id ?? selectedSubgroup.parentId)}>{categoryLabel}</button> : <span aria-current="page" className="break-words font-medium">{categoryLabel}</span>}</>}
    {selectedSubgroup && <><span aria-hidden="true" className="text-muted-foreground">/</span><span aria-current="page" className="break-words font-medium">{selectedSubgroup.name}</span></>}
  </nav>;
  const facetControls = (
    <div className="space-y-2" data-repository-facet-controls>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {breadcrumb}
          <span role="status" className="text-xs tabular-nums text-muted-foreground">
            {filteredRepositories.length} / {categoryRepositories.length} {zh ? '个仓库' : 'repositories'}
          </span>
        </div>
      </div>
    </div>
  );
  const hasActiveQueryOrFilters = hasActiveNonQueryFilters || hasActiveFacetFilters || Boolean(searchFilters?.query?.trim());

  const renderContents = () => {
  if (repositoryViewMode === 'cluster') {
    return <div className="space-y-4">
      <ExplorationExplorer key={accountId} repositories={repositories} onOpenRepository={setActiveDetailRepository} />
      {activeDetailRepository && <React.Suspense fallback={null}><LazyRepositoryDetailsPanel repository={repositories.find(repo => repo.id === activeDetailRepository.id) ?? activeDetailRepository} defaultDocked={isUltraWideScreen} onClose={() => { setActiveDetailRepository(null); setDetailsPinned(false); }} onAskRepository={handleAskRepository} onPinnedChange={setDetailsPinned} /></React.Suspense>}
      {chatPortal}
      {globalHistorySheet}
    </div>;
  }

  if (filteredRepositories.length === 0 && (!grouped || hasActiveQueryOrFilters)) {
    const selectedCategoryObj = allCategories.find(cat => cat.id === selectedCategory);
    const categoryName = selectedCategoryObj?.name || selectedCategory;

    return (
      <>
        <RepositoryToolbarPortal><Button variant="ghost" size="sm" onClick={() => setOrganizationOpen(true)}><FolderTree className="mr-1 h-4 w-4" />{t('aiOrganization.title')}</Button></RepositoryToolbarPortal>
        <AIOrganizationPanel open={organizationOpen} onOpenChange={setOrganizationOpen} controller={organization} />
          <div className="ui-empty-state flex flex-col items-center px-6 py-14 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <SearchX className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="font-medium text-foreground">
          {hasActiveFacetFilters ? (zh ? '没有符合当前筛选条件的项目' : 'No repositories match the current filters') : searchFilters?.query ? (
            t('repositoryList.no-repositories-found-for-v1', { v1: searchFilters.query })
          ) : selectedCategory === 'all'
            ? (t('repositoryList.no-repositories-found'))
            : (t('repositoryList.no-repositories-found-in-categoryname', { categoryName: categoryName })
              )
          }
        </p>
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground dark:text-muted-foreground">
          {hasActiveFacetFilters ? (zh ? '移除部分条件或清除筛选，查看当前分类中的项目。' : 'Remove conditions or clear filters to see repositories in this category.') : searchFilters?.query ? (
            t('repositoryList.try-different-keywords-use-ai-search-for-semanti')
          ) : selectedCategory === 'all'
            ? (t('repositoryList.click-sync-to-load-your-starred-repositories'))
            : (t('repositoryList.switch-to-another-category-or-sync-to-load-more')
              )
          }
        </p>
        {hasActiveQueryOrFilters && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clearAllFilters}
            className="mt-5"
          >
            <X className="w-4 h-4" />
            {t('repositoryList.clear-all-filters')}
          </Button>
        )}
        </div>
        {chatPortal}
        {globalHistorySheet}
      </>
    );
  }

  const { unanalyzedCount, failedCount } = repositoryStats;
  const currentGroups = (subcategories ?? []).filter(group => group.parentId === selectedCategory);
  const groupIds = orderedIds(subcategoryOrder ?? [], currentGroups.map(group => group.id));
  const detailRepositories = grouped
    ? [...filteredRepositories].sort((left, right) => {
      const leftIndex = groupIds.indexOf(left.subcategory_id ?? '');
      const rightIndex = groupIds.indexOf(right.subcategory_id ?? '');
      return (leftIndex < 0 ? groupIds.length : leftIndex) - (rightIndex < 0 ? groupIds.length : rightIndex);
    })
    : filteredRepositories;
  const activeDetailIndex = detailRepositories.findIndex(repo => repo.id === activeDetailRepository?.id);

  const renderRepository = (repo: Repository, organizationActions?: React.ReactNode) => (
    <div key={repo.id} data-detail-repository={repo.id}
      onDragStartCapture={event => {
        event.dataTransfer.setData('application/x-gsm-repository-ids', JSON.stringify(selectedRepoIds.has(repo.id) ? [...selectedRepoIds] : [repo.id]));
      }}
      className={`flex h-full min-w-0 flex-1 flex-col rounded-md [&>.repository-card]:flex-1 ${activeDetailRepository?.id === repo.id ? 'outline outline-2 outline-offset-2 outline-primary' : ''}`}>
    <RepositoryCard
      repository={repo}
      showAISummary={showAISummary}
      searchQuery={searchFilters.query}
      isSelected={selectedRepoIds.has(repo.id)}
      onSelect={handleSelectRepo}
      selectionMode={showBulkToolbar}
      isExitingSelection={isExitingSelection}
      allCategories={allCategories}
      viewMode={repositoryViewMode === 'list' ? 'list' : 'grid'}
      onAskRepository={handleAskRepository}
      onViewDetails={setActiveDetailRepository}
      onAnalyzeRepository={requestAnalysis}
      organizationActions={organizationActions}
      latestRelease={latestRepositoryRelease(releases, repo.id) ?? null}
      pluginActions={cardPluginActions.actions}
    />
    </div>
  );

  return (
    <div className="space-y-5">


      {/* Similar repositories view banner */}
      {similarView?.active && (
        <SimilarViewBanner
          anchorRepoName={similarView.anchorRepoName}
          onReset={resetSimilarView}
          language={language}
        />
      )}

      {/* Controls Bar */}
      <RepositoryToolbarPortal>
      <div className="flex shrink-0 items-center justify-end gap-1" data-repository-toolbar>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => setOrganizationOpen(true)} title={t('aiOrganization.title')}>
            <FolderTree className="h-4 w-4" />{t('aiOrganization.title')}
          </Button>

          {/* AI Analysis Select */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('repositoryList.ai-analysis-actions')}
                title={t('repositoryList.ai-analysis-actions')}
                className="h-8 w-8"
              >
                <Bot className="h-4 w-4 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem disabled={isLoading} onSelect={() => void handleAIAnalyze(false)}>
                {t('repositoryList.analyze-all-v1', { v1: filteredRepositories.length })}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={isLoading || unanalyzedCount === 0} onSelect={() => void handleAIAnalyze(true)}>
                {t('repositoryList.analyze-unanalyzed-unanalyzedcount', { unanalyzedCount: unanalyzedCount })}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={isLoading || failedCount === 0} onSelect={() => void handleAIAnalyze(false, true)}>
                {t('repositoryList.re-analyze-failed-failedcount', { failedCount: failedCount })}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={showAISummary ? 'ai' : 'original'} onValueChange={value => setShowAISummary(value === 'ai')}>
                <DropdownMenuRadioItem value="ai" disabled={!hasAnalyzedRepos}>{t('repositoryList.ai-analysis-2')}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="original">{t('repositoryList.original')}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <RepositoryDetailAnalysisAction hideTrigger request={analysisRequest} job={analysisJob} repositories={selectedRepositories.length ? selectedRepositories : filteredRepositories} />

          {/* Progress Bar and Controls - 移动端优化 */}

        </div>

        {/* Statistics and view mode: the layout switch remains at the toolbar's far right. */}
      </div>
      </RepositoryToolbarPortal>
      <AIOrganizationPanel open={organizationOpen} onOpenChange={setOrganizationOpen} controller={organization} />

      {/* Repository Grid with consistent card widths */}
      <div className="flex min-w-0 items-start gap-4 [&>aside]:sticky [&>aside]:top-20" data-details-pinned={detailsPinned || undefined}>
      <div
        className="min-w-0 flex-1"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {grouped ? <RepositoryGroups key={selectedCategory} categoryId={selectedCategory}
          repositories={filteredRepositories} filtered={hasActiveQueryOrFilters} customSort={searchFilters.sortBy === 'custom'}
          filterKey={JSON.stringify(filterResetKey)} viewMode={repositoryViewMode === 'list' ? 'list' : 'grid'} renderRepository={renderRepository} />
          : selectedCategory === 'pending' ? <PendingClassification repositories={filteredRepositories} visibleCount={visibleCount} categories={allCategories}
            selectedIds={selectedRepoIds} onSelect={handleSelectRepo} onSelectAll={handleSelectAll} onAssigned={handleDeselectAll}
            onOpenRepository={setActiveDetailRepository} />
            : <RepositoryGrid viewMode={repositoryViewMode === 'list' ? 'list' : 'grid'}>{visibleRepositories.map(repo => renderRepository(repo))}</RepositoryGrid>}
      </div>
      {activeDetailRepository &&
        <React.Suspense fallback={null}>
          <LazyRepositoryDetailsPanel repository={repositories.find(repo => repo.id === activeDetailRepository.id) ?? activeDetailRepository}
            defaultDocked={isUltraWideScreen}
            onClose={() => { setActiveDetailRepository(null); setDetailsPinned(false); }}
            onAskRepository={handleAskRepository} onPinnedChange={setDetailsPinned}
            onPrevious={activeDetailIndex > 0 ? () => setActiveDetailRepository(detailRepositories[activeDetailIndex - 1]) : undefined}
            onNext={activeDetailIndex >= 0 && activeDetailIndex < detailRepositories.length - 1 ? () => setActiveDetailRepository(detailRepositories[activeDetailIndex + 1]) : undefined} />
        </React.Suspense>
      }
      </div>

      {/* Sentinel for on-demand loading */}
      {!grouped && visibleCount < filteredRepositories.length && (
        <div ref={sentinelRef} className="h-8" />
      )}

      {/* Bulk Action Toolbar */}
      {showBulkToolbar && (
        <BulkActionToolbar
          selectedCount={selectedRepoIds.size}
          repositories={selectedRepositories}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
          onBulkAction={handleBulkAction}
          onClose={() => {
            setIsExitingSelection(true);
            setTimeout(() => {
              setShowBulkToolbar(false);
              setSelectedRepoIds(new Set());
              requestAnimationFrame(() => {
                setIsExitingSelection(false);
              });
            }, 250);
          }}
        />
      )}

      {/* Bulk Categorize Modal */}
      <BulkCategorizeModal
        isOpen={showCategorizeModal}
        onClose={() => setShowCategorizeModal(false)}
        repositories={selectedRepositories}
        onCategorize={handleBulkCategorize}
        onAssignTarget={handleBulkAssign}
      />

      <BulkRestoreModal
        isOpen={showRestoreModal}
        onClose={() => setShowRestoreModal(false)}
        repositories={selectedRepositories}
        onRestore={handleBulkRestore}
      />

      {chatPortal}
      {globalHistorySheet}
    </div>
  );
  };
  return <div className={`space-y-5 ${disableCardAnimations ? 'repository-list-syncing' : ''}`}>{repositoryViewMode !== 'cluster' && facetControls}{renderContents()}</div>;
};
