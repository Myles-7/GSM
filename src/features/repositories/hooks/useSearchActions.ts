import { useT } from "../../../i18n/useT";
import { useCallback, useEffect, useMemo, useState, type MutableRefObject, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Category, Repository } from '../../../types';
import { useAppStore, getAllCategories } from '../../../store/useAppStore';
import { AIService, isAbortError } from '../../../services/aiService';
import { EmbeddingClient, VectorSearchService } from '../../../services/vectorSearchService';
import { VectorIndexCompatibilityError } from '../../../services/vectorIndexIdentity';
import { createGitHubApiService, createGitHubListsApiService } from '../../../services/githubApiFactory';
import { forceSyncToBackend } from '../../../services/autoSync';
import { aiTaskJournal } from '../../../services/aiTaskJournal';
import { bindTaskSignal, taskConfigSnapshot } from '../../../services/taskExecution';
import { useDialog } from '../../../hooks/useDialog';
import type { GitHubList } from '../../../services/githubListsApi';
import type { VectorQueryResult } from '../../../services/vectorSearchService';
import { isReservedCategoryName } from '../../../utils/categoryUtils';
import { performBasicTextSearch } from '../../../utils/repoSearch';
import { inspectRepositoryIdentities, preserveUnconfirmedLegacyRepositories } from '../../../utils/repositoryIdentity';
import { submittedRepositoryCandidates } from '../../../utils/submittedRepositorySearch';

const searchIdentity = () => {
  const state = useAppStore.getState();
  return [state.user?.id, state.githubToken, state.activeAIConfig, state.aiConfigs, state.vectorSearchConfig, state.embeddingConfigs, state.language] as const;
};
interface SubmittedSearch {
  query: string;
  providerIds: number[];
  identity: ReturnType<typeof searchIdentity>;
  sortMode: 'relevance' | 'explicit';
}

// ===== 提纯纯函数（来源逐字对应 SearchBar 基线行号） =====

// SearchBar 446-459：轻量关键词加分 + scoreMap 构造。
export const buildSearchPatch = (
  query: string,
  vectorResults: VectorQueryResult[],
): Map<string, number> => {
  const queryLower = query.toLowerCase();
  const boostedResults = vectorResults.map(r => {
    let bonus = 0;
    const name = (r.metadata?.full_name || '').toLowerCase();
    const desc = (r.metadata?.description || '').toLowerCase();
    const tags = (r.metadata?.tags || []).map(tag => tag.toLowerCase());
    if (name.includes(queryLower)) bonus += 0.05;
    if (desc.includes(queryLower)) bonus += 0.03;
    if (tags.some(tag => tag.includes(queryLower))) bonus += 0.02;
    return { ...r, score: r.score + bonus };
  });
  return new Map(boostedResults.map(r => [r.id, r.score]));
};

// SearchBar 725-750：星标同步结果与本地仓库逐字段合并（license `?? null` 回填）。
export const mergeStarredRepositories = (
  newRepos: Repository[],
  storeRepos: Repository[],
): Repository[] => {
  inspectRepositoryIdentities(storeRepos, newRepos);
  const existingRepoMap = new Map(storeRepos.map(repo => [repo.id, repo]));
  return preserveUnconfirmedLegacyRepositories(newRepos.map(newRepo => {
    const existing = existingRepoMap.get(newRepo.id);
    if (existing) {
      return {
        ...existing,
        name: newRepo.name,
        full_name: newRepo.full_name,
        description: newRepo.description,
        html_url: newRepo.html_url,
        stargazers_count: newRepo.stargazers_count,
        forks_count: newRepo.forks_count,
        forks: newRepo.forks,
        language: newRepo.language,
        updated_at: newRepo.updated_at,
        pushed_at: newRepo.pushed_at,
        starred_at: newRepo.starred_at,
        owner: newRepo.owner,
        topics: newRepo.topics,
        // 回填历史仓库缺失的 license 字段（GitHub 源元数据，跟随 newRepo）
        license: newRepo.license ?? null,
        // GitHub 原生状态字段：跟随 newRepo 刷新（归档/停用状态会随上游变化）。
        // 源缺失时保留本地已获得的值，避免把已有 Health 事实退化成「未知」。
        archived: newRepo.archived ?? existing.archived,
        disabled: newRepo.disabled ?? existing.disabled,
        fork: newRepo.fork ?? existing.fork,
        is_template: newRepo.is_template ?? existing.is_template,
        open_issues_count: newRepo.open_issues_count ?? existing.open_issues_count,
        default_branch: newRepo.default_branch ?? existing.default_branch,
      };
    }
    return newRepo;
  }), storeRepos);
};

// SearchBar 774-799：构造"list 名(小写) → 本地分类"映射并为云端 list 规划缺失的自定义分类。
// makeCategoryId 由 hook 注入（原实现内联 `custom-sync-${Date.now()}-${idx}`），保持可测性。
export const planListCategories = (
  lists: GitHubList[],
  localCategories: Category[],
  makeCategoryId: (idx: number) => string,
): { toCreate: Category[]; categoryByLowerName: Map<string, string> } => {
  // 值使用本地分类的原始名称（保留其大小写），而非 list 名：
  // 锁定分类的筛选用精确相等比较，若直接存 GitHub 侧的大小写，
  // 仓库会从分类结果中消失（如 list 名为 "web apps" 而分类为 "Web Apps"）。
  const categoryByLowerName = new Map(
    localCategories
      .filter(c => c.id !== 'all' && !isReservedCategoryName(c.name))
      .map(c => [c.name.toLowerCase(), c.name])
  );
  const toCreate: Category[] = [];
  lists.forEach((list, idx) => {
    const lower = list.name.toLowerCase();
    if (isReservedCategoryName(list.name) || categoryByLowerName.has(lower)) return;
    toCreate.push({
      id: makeCategoryId(idx),
      name: list.name,
      icon: ' 📋',
      isCustom: true,
      keywords: [],
    });
    // 纳入本次运行使用的映射，使后续 listMatchesCategory 命中、可设分类并加锁
    categoryByLowerName.set(lower, list.name);
  });
  return { toCreate, categoryByLowerName };
};

// Lists contribute suggestions and tags; established membership and locks remain local decisions.
export const applyListsToRepositories = (
  repositories: Repository[],
  lists: GitHubList[],
  categoryByLowerName: Map<string, string>,
  categories: Category[] = [],
): { repositories: Repository[]; appliedTagsCount: Record<string, number> } => {
  const listRepoMap = new Map(repositories.map(repo => [repo.full_name.toLowerCase(), repo]));
  const appliedTagsCount: Record<string, number> = {};

  // Existing locked legacy records must be migrated from their original classification.
  const preExistingLocked = new Set(
    repositories
      .filter(r => r.category_locked)
      .map(r => r.full_name.toLowerCase())
  );

  for (const list of lists) {
    let appliedCount = 0;
    for (const fullName of list.items) {
      const key = fullName.toLowerCase();
      const repo = listRepoMap.get(key);
      if (!repo) continue;

      const customTags = repo.custom_tags ? [...repo.custom_tags] : [];
      if (!customTags.includes(list.name)) {
        customTags.push(list.name);
      }

      // 预存在锁定：不覆盖其分类与锁定，仅追加 list 名为标签，让云端
      // list 关系仍能反映到本地（修复 #273）。
      if (preExistingLocked.has(key) || repo.category_id !== undefined) {
        // 仅当标签确有变化才写回，避免无谓的 last_edited 抖动
        if (customTags.length !== (repo.custom_tags?.length ?? 0)) {
          listRepoMap.set(key, { ...repo, custom_tags: customTags });
        }
        appliedCount++;
        continue;
      }

      listRepoMap.set(key, { ...repo, custom_tags: customTags });
      appliedCount++;
    }
    if (appliedCount > 0) {
      appliedTagsCount[list.name] = appliedCount;
    }
  }

  return {
    repositories: repositories.map(repo => {
      const updated = listRepoMap.get(repo.full_name.toLowerCase()) || repo;
      if (repo.category_id !== undefined || repo.category_locked || categories.length === 0) return updated;
      const names = lists.filter(list => list.items.some(name => name.toLowerCase() === repo.full_name.toLowerCase()))
        .map(list => categoryByLowerName.get(list.name.toLowerCase()));
      const candidates = [...new Set(categories.filter(category => names.includes(category.name)).map(category => category.id))];
      if (!names.length) return updated;
      return {
        ...updated, category_id: candidates.length === 1 ? candidates[0] : null,
        subcategory_id: null, category_candidates: candidates,
        category_legacy: repo.category_legacy ?? { custom_category: repo.custom_category, category_locked: repo.category_locked },
        custom_category: candidates.length === 1 ? categories.find(category => category.id === candidates[0])?.name : repo.custom_category,
      };
    }),
    appliedTagsCount,
  };
};

// ===== Hook =====

export interface SearchActions {
  isSearching: boolean;
  searchPhase: string | null;
  searchReport: { query: string; mode: 'ai' | 'vector' | 'keyword'; total: number; count: number; fallback?: string } | null;
  // 旧调用兼容 refs；SearchBar 的候选与排序以 submitted session 为准。
  vectorScoreMapRef: MutableRefObject<{ query: string; scores: Map<string, number> } | null>;
  skipNextTextSearchRef: MutableRefObject<boolean>;
  submittedRevision: number;
  relevanceSearch: boolean;
  applySubmittedSearch: (query: string, applyFilters: (repos: Repository[]) => Repository[]) => Repository[] | null;
  clearSubmittedSearch: () => void;
  setExplicitSearchSort: () => void;
  aiSearch: (query: string, applyFilters: (repos: Repository[]) => Repository[]) => Promise<void>;
  keywordSearch: (
    query: string,
    applyFilters: (repos: Repository[]) => Repository[],
    options?: { signal?: AbortSignal },
  ) => Promise<void>;
  syncStars: (mode?: 'auto' | 'stars-only' | 'stars-and-lists') => Promise<void>;
}

export const useSearchActions = (): SearchActions => {
  const {
    repositories,
    aiConfigs,
    activeAIConfig,
    language,
    setSearchFilters,
    setSearchResults,
    githubToken,
    setRepositories,
    setLastSync,
    setSyncingStars,
    syncMode,
    user,
    addCustomCategory,
    customCategories,
    defaultCategoryOverrides,
    vectorSearchConfig,
    embeddingConfigs,
  } = useAppStore(useShallow((state) => ({
    repositories: state.repositories,
    aiConfigs: state.aiConfigs,
    activeAIConfig: state.activeAIConfig,
    language: state.language,
    setSearchFilters: state.setSearchFilters,
    setSearchResults: state.setSearchResults,
    githubToken: state.githubToken,
    setRepositories: state.setRepositories,
    setLastSync: state.setLastSync,
    setSyncingStars: state.setSyncingStars,
    syncMode: state.syncMode,
    user: state.user,
    addCustomCategory: state.addCustomCategory,
    customCategories: state.customCategories,
    defaultCategoryOverrides: state.defaultCategoryOverrides,
    vectorSearchConfig: state.vectorSearchConfig,
    embeddingConfigs: state.embeddingConfigs,
  })));

  const { toast } = useDialog();
  const [isSearching, setIsSearching] = useState(false);
  const [searchPhase, setSearchPhase] = useState<string | null>(null);
  const vectorScoreMapRef = useRef<{ query: string; scores: Map<string, number> } | null>(null);
  const skipNextTextSearchRef = useRef(false);
  // 当前在途 AI 搜索的控制器：新搜索启动时中止旧请求（超代语义）
  const aiSearchAbortRef = useRef<AbortController | null>(null);
  const submittedRef = useRef<SubmittedSearch | null>(null);
  const sortModeRef = useRef<SubmittedSearch['sortMode']>('relevance');
  const [submittedRevision, setSubmittedRevision] = useState(0);
  const clearSubmittedSearch = useCallback(() => {
    aiSearchAbortRef.current?.abort();
    vectorScoreMapRef.current = null;
    skipNextTextSearchRef.current = false;
    if (submittedRef.current) { submittedRef.current = null; setSubmittedRevision(value => value + 1); }
  }, []);
  const setExplicitSearchSort = useCallback(() => {
    sortModeRef.current = 'explicit';
    if (submittedRef.current?.sortMode === 'relevance') {
      submittedRef.current.sortMode = 'explicit'; setSubmittedRevision(value => value + 1);
    }
  }, []);
  const applySubmittedSearch = useCallback((query: string, applyFilters: (repos: Repository[]) => Repository[]): Repository[] | null => {
    const session = submittedRef.current;
    const currentIdentity = searchIdentity();
    if (!session || !query.trim() || query !== session.query || !session.identity.every((value, index) => value === currentIdentity[index])) return null;
    const candidates = submittedRepositoryCandidates(useAppStore.getState().repositories, query, session.providerIds);
    const filtered = applyFilters(candidates);
    if (session.sortMode === 'relevance') {
      const rank = new Map(candidates.map((repo, index) => [repo.id, index]));
      filtered.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    }
    return filtered;
  }, []);
  const commitSubmittedSearch = useCallback((query: string, provider: Repository[], applyFilters: (repos: Repository[]) => Repository[]) => {
    submittedRef.current = { query, providerIds: [...new Set(provider.map(repo => repo.id))], identity: searchIdentity(), sortMode: sortModeRef.current };
    const results = applySubmittedSearch(query, applyFilters)!;
    setSubmittedRevision(value => value + 1);
    return results;
  }, [applySubmittedSearch]);
  useEffect(() => {
    clearSubmittedSearch();
    setIsSearching(false);
    setSearchPhase(null);
    return () => {
      aiSearchAbortRef.current?.abort();
      aiSearchAbortRef.current = null;
    };
  }, [githubToken, user?.id, activeAIConfig, aiConfigs, vectorSearchConfig, embeddingConfigs, language, clearSubmittedSearch]);
  const t = useT('repositories');
  const [searchReport, setSearchReport] = useState<SearchActions['searchReport']>(null);
  useEffect(() => { setSearchReport(null); }, [githubToken, user?.id, activeAIConfig, aiConfigs, vectorSearchConfig, embeddingConfigs, language]);

  const keywordSearch = useCallback(async (
    query: string,
    applyFilters: (repos: Repository[]) => Repository[],
    options?: { signal?: AbortSignal },
  ): Promise<void> => {
    if (!options?.signal) sortModeRef.current = 'relevance';
    const activeConfig = aiConfigs.find(config => config.id === activeAIConfig);
    const initial = { ...useAppStore.getState() };
    const check = () => {
      options?.signal?.throwIfAborted();
      const current = useAppStore.getState();
      if (current.user?.id !== initial.user?.id || current.githubToken !== initial.githubToken
          || current.activeAIConfig !== initial.activeAIConfig || current.aiConfigs !== initial.aiConfigs
          || current.vectorSearchConfig !== initial.vectorSearchConfig || current.embeddingConfigs !== initial.embeddingConfigs
          || current.language !== initial.language) throw new DOMException('Stale search', 'AbortError');
    };
    check();

    let filtered = repositories;
    let aiOrdered = false;
    let fallback: string | undefined;
    if (activeConfig) {
      try {
        // 无向量降级链：查询扩展+意图复述 → 词法候选召回 → LLM 精选排序
        setSearchPhase(t('useSearchActions.ai-semantic-analysis'));
        const aiService = new AIService(activeConfig, language);
        const aiResults = await aiService.searchRepositoriesWithSelection(repositories, query, {
          signal: options?.signal,
          onPhase: (phase) => {
            check();
            setSearchPhase(phase === 'selecting'
              ? t('useSearchActions.ai-selecting-relevant-repositories')
              : t('useSearchActions.ai-semantic-analysis'));
          },
          onFallback: (reason) => {
            check();
            // 端点抖动/配置问题时用户看到的不能只是"空结果"：明确告知已降级
            if (reason === 'ai_failed' || reason === 'unparseable') {
              fallback = t('useSearchActions.ai-request-failed-fell-back-to-local-lexical-sea');
              toast(t('useSearchActions.ai-request-failed-fell-back-to-local-lexical-sea'), 'warning');
            }
          },
        });
        check();
        console.log('✅ AI selection search completed, results:', aiResults.length);
        filtered = aiResults;
        aiOrdered = true;
      } catch (error) {
        check();
        // 取消不是失败：向上传播交给 aiSearch 静默结束，不产出兜底结果
        if (isAbortError(error)) throw error;
        console.warn('❌ AI search failed, falling back to basic search:', error);
        toast(t('useSearchActions.ai-request-failed-fell-back-to-local-lexical-sea'), 'warning');
        filtered = performBasicTextSearch(repositories, query);
        fallback = t('useSearchActions.ai-request-failed-fell-back-to-local-lexical-sea');
      }
    } else {
      console.log('⚠️ No AI config found, using basic text search');
      // Basic text search if no AI config
      filtered = performBasicTextSearch(repositories, query);
    }

    // Apply other filters and update results
    check();
    const finalFiltered = commitSubmittedSearch(query, filtered, applyFilters);
    check();
    if (aiOrdered) {
      // 顺序与候选由 submitted session 保存；此 ref 仅保留旧调用兼容。
      skipNextTextSearchRef.current = true;
    }
    setSearchResults(finalFiltered);
    setSearchReport(previous => ({ query, mode: activeConfig && !fallback ? 'ai' : 'keyword',
      total: repositories.length, count: finalFiltered.length, fallback: fallback ?? (previous?.query === query ? previous.fallback : undefined) }));

    // Update search filters to mark that AI search was performed
    setSearchFilters({ query });
  }, [repositories, aiConfigs, activeAIConfig, language, setSearchResults, setSearchFilters, toast, t, commitSubmittedSearch]);

  const aiSearch = useCallback(async (
    query: string,
    applyFilters: (repos: Repository[]) => Repository[],
  ): Promise<void> => {
    if (!query.trim()) { clearSubmittedSearch(); setIsSearching(false); setSearchPhase(null); setSearchReport(null); return; }

    // 新搜索接管：中止上一次仍在途的 AI 请求（搜索进行中按 Enter 可再次触发），
    // 防止过期结果落盘覆盖新结果。被取代的搜索在 finally 里不复位搜索状态。
    aiSearchAbortRef.current?.abort();
    submittedRef.current = null;
    sortModeRef.current = 'relevance';
    const controller = new AbortController();
    aiSearchAbortRef.current = controller;
    const initial = { ...useAppStore.getState() };
    const searchConfig = initial.aiConfigs.find(item => item.id === initial.activeAIConfig);
    const task = aiTaskJournal.begin(String(initial.user?.id ?? ''), 'search', [{ id: 'search', label: initial.language.startsWith('zh') ? '仓库搜索' : 'Repository search' }], searchConfig?.id,
      undefined, { config: searchConfig ? taskConfigSnapshot(searchConfig, 'repository-rerank') : undefined, target: { view: 'repositories' } });
    bindTaskSignal(controller.signal, task); task.bind({ stop: () => controller.abort() }); task.item('search', 'running');
    const check = () => {
      controller.signal.throwIfAborted();
      const current = useAppStore.getState();
      if (aiSearchAbortRef.current !== controller || current.user?.id !== initial.user?.id
          || current.githubToken !== initial.githubToken || current.activeAIConfig !== initial.activeAIConfig
          || current.aiConfigs !== initial.aiConfigs
          || current.vectorSearchConfig !== initial.vectorSearchConfig
          || current.embeddingConfigs !== initial.embeddingConfigs || current.language !== initial.language) {
        controller.abort();
        throw new DOMException('Stale search', 'AbortError');
      }
    };

    setIsSearching(true);
    setSearchPhase(null);
    setSearchReport(null);
    vectorScoreMapRef.current = null;

    try {
      // ====== 向量搜索分支 ======
      // 保持原时机：非响应式 getState() 读取（原文件如此，不改成响应式 selector）
      const vsConfig = useAppStore.getState().vectorSearchConfig;
      const embConfigs = useAppStore.getState().embeddingConfigs;
      const activeEmbConfig = embConfigs.find(c => c.id === vsConfig?.embeddingConfigId);

      if (vsConfig?.enabled && vsConfig?.workerUrl && activeEmbConfig) {
        try {
          const embeddingClient = new EmbeddingClient(activeEmbConfig);
          const vectorService = new VectorSearchService(vsConfig, activeEmbConfig);
          await vectorService.prepareQuery(controller.signal);
          check();

          // 1. HyDE 查询预处理：用 LLM 生成理想仓库描述再嵌入（可选，5 秒超时降级）
          let embeddingQuery = query;
          const hydeConfig = aiConfigs.find(config => config.id === activeAIConfig);
          if (vsConfig.enableHyDE !== false && hydeConfig) {
            const hydeAbort = new AbortController();
            const abortHyde = () => hydeAbort.abort();
            controller.signal.addEventListener('abort', abortHyde, { once: true });
            let hydeTimer: ReturnType<typeof setTimeout> | null = null;
            try {
              setSearchPhase(t('useSearchActions.ai-analyzing-query'));
              const hydeService = new AIService(hydeConfig, language);
              embeddingQuery = await Promise.race([
                hydeService.generateHyDEQuery(query, hydeAbort.signal).catch(() => query),
                new Promise<string>((resolve) => {
                  hydeTimer = setTimeout(() => {
                    hydeAbort.abort();
                    resolve(query);
                  }, 5000);
                }),
              ]);
              check();
            } catch (hydeError) {
              console.warn('HyDE failed, using raw query:', hydeError);
              embeddingQuery = query;
            } finally {
              if (hydeTimer) clearTimeout(hydeTimer);
              controller.signal.removeEventListener('abort', abortHyde);
            }
          }

          // 2. 前端调用 Embedding API 生成查询向量
          check();
          setSearchPhase(t('useSearchActions.generating-query-vector'));
          const queryVectors = await embeddingClient.embed([embeddingQuery], 'query', controller.signal);
          check();
          if (queryVectors && queryVectors.length > 0) {
            // 2. 前端将查询向量发送到 Worker
            setSearchPhase(t('useSearchActions.searching-vector-index'));
            const vectorResults = await vectorService.query(queryVectors[0], {
              topK: vsConfig.searchTopK ?? 30,
              threshold: vsConfig.searchThreshold ?? 0.35,
            }, controller.signal);
            check();

            if (vectorResults.length > 0) {
              // 3. 轻量关键词加分：精确匹配的字段给予分数微调
              const scoreMap = buildSearchPatch(query, vectorResults);

              // 4. 从本地仓库数据中取出匹配结果，按相似度排序
              const scoredRepos = repositories
                .filter(repo => scoreMap.has(String(repo.id)))
                .map(repo => ({
                  repo,
                  score: scoreMap.get(String(repo.id)) || 0,
                }))
                .sort((a, b) => b.score - a.score)
                .map(item => item.repo);

              if (scoredRepos.length > 0) {
                // 4. AI 语义重排序：用 LLM 对向量搜索结果做真正的语义排序
                let reranked = scoredRepos;
                let rerankSucceeded = false;
                const rerankConfig = aiConfigs.find(config => config.id === activeAIConfig);
                if (rerankConfig && vsConfig.enableReranking !== false) {
                  try {
                    setSearchPhase(t('useSearchActions.ai-semantic-reranking'));
                    const rerankService = new AIService(rerankConfig, language);
                    reranked = await rerankService.searchRepositoriesWithSemanticReranking(scoredRepos, query, controller.signal);
                    check();
                    rerankSucceeded = true;
                    console.log('🤖 AI semantically reranked results:', reranked.length);
                  } catch (rerankError) {
                    check();
                    console.warn('AI semantic reranking failed, using vector order:', rerankError);
                  }
                }

                // 保存 LLM 重排序顺序，applyFilters 可能按 UI 排序覆盖它
                const finalFiltered = commitSubmittedSearch(query, [...reranked, ...scoredRepos], applyFilters);
                check();
                console.log('🎯 Vector search results:', finalFiltered.length);
                vectorScoreMapRef.current = { query, scores: scoreMap };
                skipNextTextSearchRef.current = true;
                setSearchResults(finalFiltered);
                setSearchReport({ query, mode: 'vector', total: reranked.length, count: finalFiltered.length,
                  fallback: rerankConfig && vsConfig.enableReranking !== false && !rerankSucceeded
                    ? 'rerank-unavailable' : undefined });
                setSearchFilters({ query });
                return;
              }
            }
          }
          // 向量搜索无结果 → 继续走关键词搜索
          console.log('⚠️ Vector search returned no results, falling back to keyword search');
        } catch (vectorError) {
          check();
          if (isAbortError(vectorError)) throw vectorError;
          if (vectorError instanceof VectorIndexCompatibilityError) toast(vectorError.message, 'error');
          setSearchReport({ query, mode: 'keyword', total: repositories.length, count: 0,
            fallback: vectorError instanceof VectorIndexCompatibilityError ? vectorError.message : 'vector-unavailable' });
          console.warn('❌ Vector search failed, falling back to keyword search:', vectorError);
        }
      }
      // ====== 向量搜索分支结束 ======

      check();
      await keywordSearch(query, applyFilters, { signal: controller.signal });
    } catch (error) {
      // 取消不是失败：静默结束当前搜索（不产出结果），不当作可恢复的 AI 失败
      if (!isAbortError(error)) task.item('search', 'failed', error);
      if (isAbortError(error)) {
        console.log('🚫 AI search cancelled');
        return;
      }
      console.error('💥 Search failed:', error);
    } finally {
      // 仅当本次搜索仍是"当前搜索"时才复位状态：被新搜索取代的旧搜索
      if (!controller.signal.aborted && !aiTaskJournal.snapshot().find(record => record.id === task.id)?.items.some(item => item.state === 'failed')) task.item('search', 'complete');
      task.finish(controller.signal.aborted ? 'canceled' : undefined);
      // 不把新搜索的 isSearching/searchPhase 状态清掉
      if (aiSearchAbortRef.current === controller) {
        aiSearchAbortRef.current = null;
        setIsSearching(false);
        setSearchPhase(null);
      }
    }
  }, [repositories, aiConfigs, activeAIConfig, language, setSearchResults, setSearchFilters, keywordSearch, t, toast, commitSubmittedSearch, clearSubmittedSearch]);

  const syncStars = useCallback(async (mode: 'auto' | 'stars-only' | 'stars-and-lists' = 'auto') => {
    if (!githubToken) {
      toast(t('useSearchActions.github-token-not-found-please-login-again'), 'error');
      return;
    }

    setSyncingStars(true);
    const task = aiTaskJournal.begin(String(user?.id ?? ''), 'refresh', [{ id: 'stars', label: 'GitHub Stars' }], undefined, undefined, { title: 'GitHub Stars', target: { view: 'repositories' } });
    task.item('stars', 'running');
    try {
      const githubApi = createGitHubApiService(githubToken);
      const newRepositories = await githubApi.getAllStarredRepositories();
      if (useAppStore.getState().user?.id !== user?.id || useAppStore.getState().githubToken !== githubToken) return;

      const storeRepos = useAppStore.getState().repositories;
      const mergedRepositories = mergeStarredRepositories(newRepositories, storeRepos);

      // 解析本次同步范围：
      // - 'auto'：跟随持久化配置 syncMode
      // - 'stars-only'：强制仅星标（忽略 syncMode，供下拉菜单显式选择）
      // - 'stars-and-lists'：强制星标及 list（供下拉菜单显式选择）
      const syncLists = mode === 'stars-and-lists' || (mode === 'auto' && syncMode === 'stars-and-lists');
      let finalRepositories = mergedRepositories;

      if (syncLists) {
        const appliedTagsCount: Record<string, number> = {};
        try {
          const listsApi = createGitHubListsApiService(githubToken);
          const login = user?.login;
          if (!login) {
            throw new Error(t('useSearchActions.failed-to-get-github-username-please-login-again'));
          }
          const lists = await listsApi.getUserLists(login);

          // allCategories 与 View 的 useMemo 同源同值（getAllCategories 四参口径）
          const allCategories = getAllCategories(customCategories, language, [], defaultCategoryOverrides);
          // 为云端存在、但本地无同名分类的 list 自动创建自定义分类。
          // 修复"GitHub list 有很多新分类但本地从没拉到过"——原逻辑只贴 custom_tags
          // 标签，不建分类，导致左侧分类树永远只有历史分类。
          // 用每 list 递增的下标做 id 后缀，避免同一毫秒内多个 list 撞 id。
          const { toCreate, categoryByLowerName } = planListCategories(
            lists,
            allCategories,
            (idx) => `custom-sync-${Date.now()}-${idx}`,
          );
          toCreate.forEach((category) => addCustomCategory(category));
          const createdCategoriesCount = toCreate.length;

          const { repositories: listAppliedRepositories, appliedTagsCount: counts } =
            applyListsToRepositories(finalRepositories, lists, categoryByLowerName, [...allCategories, ...toCreate]);
          finalRepositories = listAppliedRepositories;
          Object.assign(appliedTagsCount, counts);

          if (Object.keys(appliedTagsCount).length > 0) {
            const appliedTotal = Object.values(appliedTagsCount).reduce((a, b) => a + b, 0);
            const listSummary = Object.entries(appliedTagsCount)
              .map(([name, count]) => `${name}(${count})`)
              .join('、');
            const createdHint = createdCategoriesCount > 0
              ? t('useSearchActions.list-sync-new-categories', { count: createdCategoriesCount })
              : '';
            toast(t('useSearchActions.synced-v1-lists-applied-to-appliedtotal-unlocked', { v1: lists.length, appliedTotal: appliedTotal, listSummary: listSummary, createdHint: createdHint }), 'info');
          } else if (createdCategoriesCount > 0) {
            // 命中数为 0，但本次新建了分类（云端 list 与本地无交集但仍有其名分类）
            toast(t('useSearchActions.list-sync-complete', { lists: lists.length, newCount: createdCategoriesCount }), 'info');
          }
        } catch (listError) {
          task.error(listError);
          console.error('List sync failed:', listError);
          toast(t('useSearchActions.list-sync-failed-starred-repositories-were-synce'), 'error');
          // 不中断：星标同步结果仍然生效
        }
      }

      const existingRepoIds = new Set(storeRepos.map(repo => repo.id));
      const newRepoCount = newRepositories.filter(repo => !existingRepoIds.has(repo.id)).length;

      setRepositories(finalRepositories);
      await forceSyncToBackend();

      setLastSync(new Date().toISOString());
      task.item('stars', 'complete');

      if (newRepoCount > 0) {
        toast(t('useSearchActions.sync-completed-found-newrepocount-new-repositori', { newRepoCount: newRepoCount }), 'success');
      } else {
        toast(t('useSearchActions.sync-completed-all-repositories-are-up-to-date'), 'info');
      }

    } catch (error) {
      task.item('stars', 'failed', error);
      console.error('Sync failed:', error);
      if (error instanceof Error && error.message.includes('token')) {
        toast(t('useSearchActions.github-token-has-expired-or-is-invalid-please-lo'), 'error');
      } else {
        toast(t('useSearchActions.sync-failed-please-check-your-network-connection'), 'error');
      }
    } finally {
      task.finish(aiTaskJournal.snapshot().find(record => record.id === task.id)?.error ? 'partial' : undefined);
      setSyncingStars(false);
    }
  }, [githubToken, setSyncingStars, syncMode, user, t, toast, addCustomCategory, customCategories, language, defaultCategoryOverrides, setRepositories, setLastSync]);

  return useMemo(() => ({
    isSearching,
    searchPhase,
    searchReport,
    vectorScoreMapRef,
    skipNextTextSearchRef,
    submittedRevision,
    relevanceSearch: submittedRef.current?.sortMode === 'relevance',
    applySubmittedSearch,
    clearSubmittedSearch,
    setExplicitSearchSort,
    aiSearch,
    keywordSearch,
    syncStars,
  }), [isSearching, searchPhase, searchReport, aiSearch, keywordSearch, syncStars, submittedRevision, applySubmittedSearch, clearSubmittedSearch, setExplicitSearchSort]);
};
