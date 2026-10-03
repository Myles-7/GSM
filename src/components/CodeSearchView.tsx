



import { useT, TranslateFn } from '../i18n/useT';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileCode2, Loader2, RefreshCw, Search, Settings2, Star, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/useAppStore';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Switch } from './ui/switch';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Label } from './ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { DiscoveryReadingSettings } from '../features/discovery/components/DiscoveryReadingSettings';
import { useAutomaticDiscoveryLoading, useChannelReadingPreferences, useReadingAnchor } from '../features/discovery/hooks/useDiscoveryReading';
import { codeItemKey, workspaceSessionKey } from '../features/discovery/workspace/model';
import { clearDiscoveryList } from '../features/discovery/workspace/storage';
import {
  codeSearchSignature, defaultCodeSearchSourceState, fetchCodeSearchBatch, loadCodeSearchWorkspace,
  saveCodeSearchSourceState, type CodeSearchSnapshot, type CodeSearchSourceState,
} from '../services/codeSearchWorkspace';
import type { Repository } from '../types';
import {
  filterStarredHits,
  isGrepRateLimitError,
  sanitizeGrepSnippet,
  type GrepCodeHit,
  type GrepFacetBucket,
  type GrepMatchMode,
} from '../services/grepAppService';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 450;

function toggleInSet(prev: Set<string>, value: string): Set<string> {
  const next = new Set(prev);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** 分面筛选组：渲染带计数的多选 chips，超限可展开。 */
const FacetGroup: React.FC<{
  title: string;
  buckets: GrepFacetBucket[];
  selected: Set<string>;
  onToggle: (val: string) => void;
  t: TranslateFn;
  maxShown?: number;
}> = ({ title, buckets, selected, onToggle, t, maxShown = 8 }) => {
  const [expanded, setExpanded] = useState(false);
  if (buckets.length === 0) return null;
  const shown = expanded ? buckets : buckets.slice(0, maxShown);
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((bucket) => {
          const active = selected.has(bucket.val);
          return (
            <button
              key={bucket.val}
              type="button"
              onClick={() => onToggle(bucket.val)}
              aria-pressed={active}
              title={`${bucket.val} (${bucket.count})`}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <span className="truncate">{bucket.val}</span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px]">{bucket.count}</span>
            </button>
          );
        })}
      </div>
      {buckets.length > maxShown && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-primary hover:underline"
        >
          {expanded ? t('codeSearchView.show-less') : t('codeSearchView.show-all-v1', { v1: buckets.length })}
        </button>
      )}
    </div>
  );
};

/** 单条代码命中卡片：消毒后的 snippet 经 innerHTML 渲染，链接均指向 GitHub。 */
const HitCard: React.FC<{ hit: GrepCodeHit; isStarred: boolean; t: TranslateFn }> = ({
  hit,
  isStarred,
  t,
}) => {
  const repo = hit.repo.trim();
  const branch = hit.branch.trim() || 'main';
  // 路径按段编码，避免空格 / # / ? 等字符破坏链接
  const encodedPath = hit.path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const fileUrl =
    repo && hit.path ? `https://github.com/${repo}/blob/${branch}/${encodedPath}` : `https://github.com/${repo}`;
  const snippet = useMemo(() => sanitizeGrepSnippet(hit.snippetHtml), [hit.snippetHtml]);
  if (!repo) return null;
  return (
    <article data-reading-key={codeItemKey(hit)} className="rounded-lg border border-border/60 bg-card p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <a
          href={`https://github.com/${hit.repo}`}
          target="_blank"
          rel="noreferrer"
          className="truncate text-sm font-semibold text-primary hover:underline"
        >
          {hit.repo}
        </a>
        {isStarred && (
          <Badge variant="secondary" className="gap-1">
            <Star className="h-3 w-3" />
            {t('codeSearchView.starred')}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">{hit.branch}</span>
        {hit.language && <Badge variant="outline">{hit.language}</Badge>}
        {hit.totalMatches && (
          <span className="text-xs text-muted-foreground">
            {hit.totalMatches} {t('codeSearchView.matches')}
          </span>
        )}
      </div>
      <a
        href={fileUrl}
        target="_blank"
        rel="noreferrer"
        className="mb-2 block truncate text-xs text-muted-foreground hover:text-primary hover:underline"
        title={hit.path}
      >
        {hit.path}
      </a>
      {snippet ? (
        <div
          className="grep-snippet overflow-x-auto rounded-lg border border-border/50 bg-muted/40 p-2 text-xs leading-relaxed [&_mark]:rounded [&_mark]:bg-yellow-200 [&_mark]:px-0.5 dark:[&_mark]:bg-yellow-500/40"
          dangerouslySetInnerHTML={{ __html: snippet }}
        />
      ) : (
        <p className="text-xs text-muted-foreground">{t('codeSearchView.no-snippet-preview')}</p>
      )}
      <div className="mt-2 flex justify-end">
        <a
          href={fileUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {t('codeSearchView.view-file-on-github')}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </article>
  );
};

/** 代码高级搜索视图：实时防抖查询 + 匹配模式 + 分面筛选 + 收藏过滤 + 分页。 */
export const CodeSearchView: React.FC = () => {
  const { repositories, account } = useAppStore(
    useShallow((state) => ({ repositories: state.repositories, account: state.user?.id == null ? '' : String(state.user.id) }))
  );
  return <CodeSearchContent key={account} account={account} repositories={repositories} />;
};

const CodeSearchContent: React.FC<{ account: string; repositories: Repository[] }> = ({ account, repositories }) => {
  const t = useT('app');
  const language = useAppStore((state) => state.language);
  const l = (zh: string, en: string) => language.startsWith('zh') ? zh : en;
  const tRef = useRef(t);
  tRef.current = t;
  const [source, setSource] = useState(defaultCodeSearchSourceState);
  const sourceRef = useRef(source);
  const [snapshot, setSnapshot] = useState<CodeSearchSnapshot | null>(null);
  const snapshotRef = useRef(snapshot);
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspaceIssue, setWorkspaceIssue] = useState<{ kind: 'restore' | 'metadata' | 'results'; detail: string } | null>(null);
  const [editVersion, setEditVersion] = useState(0);
  const [metadataVersion, setMetadataVersion] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const aliveRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAppendRef = useRef(false);
  const readingPreferences = useChannelReadingPreferences(account, 'code-search', { autoAnalyze: false });
  const { preferences } = readingPreferences;
  const { query, mode, caseSensitive, starredOnly } = source;
  const selectedLangs = useMemo(() => new Set(source.langs), [source.langs]);
  const selectedRepos = useMemo(() => new Set(source.repos), [source.repos]);
  const selectedPaths = useMemo(() => new Set(source.paths), [source.paths]);
  const result = snapshot?.result ?? null;
  const signature = codeSearchSignature(source);
  const sessionKey = snapshot?.key ?? workspaceSessionKey('code-search', signature);
  const reading = useReadingAnchor(account, sessionKey, rootRef, preferences.resumeReading, ready && readingPreferences.ready && !!snapshot);
  const isCurrentAccount = useCallback(() => aliveRef.current && !!account && String(useAppStore.getState().user?.id ?? '') === account, [account]);
  const detail = (cause: unknown) => cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';

  const cancelRequest = useCallback(() => {
    abortRef.current?.abort();
    requestIdRef.current++;
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  useEffect(() => {
    let active = true;
    aliveRef.current = true;
    if (!account) { setReady(true); return () => { aliveRef.current = false; cancelRequest(); }; }
    void loadCodeSearchWorkspace(account).then(saved => {
      if (!active || !isCurrentAccount()) return;
      sourceRef.current = saved.source; setSource(saved.source);
      snapshotRef.current = saved.snapshot; setSnapshot(saved.snapshot);
      setReady(true);
    }).catch(cause => {
      if (!active || !isCurrentAccount()) return;
      setWorkspaceIssue({ kind: 'restore', detail: detail(cause) }); setReady(true);
    });
    return () => { active = false; aliveRef.current = false; cancelRequest(); };
  }, [account, cancelRequest, isCurrentAccount]);

  useEffect(() => {
    if (!metadataVersion || !isCurrentAccount()) return;
    let active = true;
    void saveCodeSearchSourceState(account, sourceRef.current).then(() => {
      if (active && isCurrentAccount()) setWorkspaceIssue(issue => issue?.kind === 'metadata' ? null : issue);
    }).catch(cause => {
      if (active && isCurrentAccount()) setWorkspaceIssue({ kind: 'metadata', detail: detail(cause) });
    });
    return () => { active = false; };
  }, [account, metadataVersion, isCurrentAccount]);

  const editSource = (patch: Partial<CodeSearchSourceState>) => {
    const next = { ...sourceRef.current, ...patch };
    if (codeSearchSignature(next) !== codeSearchSignature(sourceRef.current)) {
      cancelRequest();
      setError(null); setLoadingMore(false);
      setLoading(next.query.trim().length >= MIN_QUERY_LENGTH);
      if (next.query.trim().length < MIN_QUERY_LENGTH) {
        next.resultSignature = null;
        snapshotRef.current = null; setSnapshot(null);
      }
      setEditVersion(version => version + 1);
    }
    sourceRef.current = next; setSource(next);
    setMetadataVersion(version => version + 1);
  };

  const starredSet = useMemo(() => {
    const set = new Set<string>();
    for (const repo of repositories) {
      if (repo?.full_name) set.add(repo.full_name.toLowerCase());
    }
    return set;
  }, [repositories]);

  const runSearch = useCallback(
    async (append: boolean) => {
      if (!ready || !readingPreferences.ready || !isCurrentAccount()) return;
      const currentSource = sourceRef.current;
      if (currentSource.query.trim().length < MIN_QUERY_LENGTH) return;
      cancelRequest();
      const controller = new AbortController();
      abortRef.current = controller;
      const requestId = (requestIdRef.current += 1);
      const currentSignature = codeSearchSignature(currentSource);
      const isCurrent = () => isCurrentAccount() && requestIdRef.current === requestId
        && codeSearchSignature(sourceRef.current) === currentSignature && !controller.signal.aborted;
      const previous = snapshotRef.current?.signature === currentSignature ? snapshotRef.current : null;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const outcome = await fetchCodeSearchBatch(account, currentSource, previous, preferences.batchSize,
          append ? 'append' : previous ? 'stable' : 'replace', { signal: controller.signal, isCurrent });
        if (!isCurrent()) return;
        if (outcome.snapshot) {
          snapshotRef.current = outcome.snapshot; setSnapshot(outcome.snapshot);
          const { repoFacets, pathFacets, langFacets } = outcome.snapshot.result;
          const next = { ...sourceRef.current, resultSignature: outcome.snapshot.signature, facets: { repoFacets, pathFacets, langFacets } };
          sourceRef.current = next; setSource(next); setMetadataVersion(version => version + 1);
        }
        if (outcome.persistenceError) setWorkspaceIssue({ kind: 'results', detail: detail(outcome.persistenceError) });
        else setWorkspaceIssue(issue => issue?.kind === 'results' || issue?.kind === 'restore' ? null : issue);
        if (outcome.error) {
          retryAppendRef.current = append || outcome.fetchedPages > 0;
          setError(isGrepRateLimitError(outcome.error) ? tRef.current('codeSearchView.rate-limited')
            : detail(outcome.error) || tRef.current('codeSearchView.search-failed'));
        }
      } catch (cause) {
        if (!isCurrent()) return;
        retryAppendRef.current = append;
        setError(detail(cause) || tRef.current('codeSearchView.search-failed'));
      } finally {
        if (isCurrent()) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [account, cancelRequest, isCurrentAccount, preferences.batchSize, readingPreferences.ready, ready]
  );
  const runSearchRef = useRef(runSearch); runSearchRef.current = runSearch;

  // Hydration never increments editVersion, so restoring a query cannot fetch it.
  useEffect(() => {
    if (!editVersion || !ready || !readingPreferences.ready || sourceRef.current.query.trim().length < MIN_QUERY_LENGTH) return;
    debounceRef.current = setTimeout(() => { void runSearchRef.current(false); }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [editVersion, ready, readingPreferences.ready]);

  const visibleHits = useMemo(() => {
    if (!result) return [];
    if (!starredOnly) return result.hits;
    return filterStarredHits(result.hits, starredSet);
  }, [result, starredOnly, starredSet]);

  const hasMore = !!snapshot && (snapshot.hasMore || snapshot.buffer.length > 0);
  const matchesSource = snapshot?.signature === signature;
  const loadMore = useCallback(() => { void runSearch(true); }, [runSearch]);
  useAutomaticDiscoveryLoading(rootRef, ready && readingPreferences.ready && preferences.loading === 'auto' && matchesSource,
    loading || loadingMore, hasMore, !!error || !!workspaceIssue, loadMore, `${account}:${sessionKey}`);
  const hasActiveFilters =
    selectedLangs.size > 0 || selectedRepos.size > 0 || selectedPaths.size > 0 || starredOnly;
  const clearFilters = () => editSource({ langs: [], repos: [], paths: [], starredOnly: false });

  return (
    <div ref={rootRef} className="space-y-4" data-testid="code-search-root">
      {/* 搜索框 */}
      <div className="ui-toolbar space-y-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              aria-label={t('codeSearchView.code-search-keywords')}
              value={query}
              disabled={!ready || !account}
              onChange={(e) => editSource({ query: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  void runSearch(false);
                }
                if (e.key === 'Escape') editSource({ query: '' });
              }}
              placeholder={t('codeSearchView.type-to-search-code-live-min-2-chars')}
              className="ui-field h-auto w-full py-2.5 pl-10 pr-9"
            />
            {query && (
              <button
                type="button"
                onClick={() => editSource({ query: '' })}
                disabled={!ready || !account}
                aria-label={t('codeSearchView.clear')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button
            onClick={() => {
              if (debounceRef.current) clearTimeout(debounceRef.current);
              void runSearch(false);
            }}
            disabled={!ready || !readingPreferences.ready || !account || query.trim().length < MIN_QUERY_LENGTH || loading || loadingMore}
            className="shrink-0 gap-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {t('codeSearchView.search')}
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="outline" size="icon" className="size-10" disabled={!ready || !readingPreferences.ready || !account} aria-label={l('代码阅读设置', 'Code reading settings')} onClick={() => setSettingsOpen(true)}><Settings2 aria-hidden="true" /></Button>
              </TooltipTrigger>
              <TooltipContent>{l('代码阅读设置', 'Code reading settings')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* 匹配模式 */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <RadioGroup
            value={mode}
            onValueChange={(v) => editSource({ mode: v as GrepMatchMode })}
            disabled={!ready || !account}
            className="flex flex-wrap items-center gap-4"
            aria-label={t('codeSearchView.match-mode')}
          >
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="fuzzy" id="grep-mode-fuzzy" />
              <Label htmlFor="grep-mode-fuzzy" className="cursor-pointer text-sm font-normal">
                {t('codeSearchView.fuzzy')}
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="words" id="grep-mode-words" />
              <Label htmlFor="grep-mode-words" className="cursor-pointer text-sm font-normal">
                {t('codeSearchView.whole-word')}
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="regexp" id="grep-mode-regexp" />
              <Label htmlFor="grep-mode-regexp" className="cursor-pointer text-sm font-normal">
                {t('codeSearchView.regexp-re2')}
              </Label>
            </div>
          </RadioGroup>
          <div className="flex items-center gap-2">
            <Switch id="grep-case" checked={caseSensitive} disabled={!ready || !account} onCheckedChange={(caseSensitive) => editSource({ caseSensitive })} />
            <Label htmlFor="grep-case" className="cursor-pointer text-sm font-normal">
              {t('codeSearchView.match-case')}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="grep-starred" checked={starredOnly} disabled={!ready || !account} onCheckedChange={(starredOnly) => editSource({ starredOnly })} />
            <Label htmlFor="grep-starred" className="flex cursor-pointer items-center gap-1 text-sm font-normal">
              <Star className="h-3.5 w-3.5" />
              {t('codeSearchView.starred-only')}
            </Label>
          </div>
        </div>

        {/* 动态过滤器 */}
        {result && (result.repoFacets.length > 0 || result.langFacets.length > 0 || result.pathFacets.length > 0) && (
          <div className="space-y-3 border-t border-border/60 pt-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {t('codeSearchView.filters')}
                {hasActiveFilters && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {t('codeSearchView.selections-re-search-automatically')}
                  </span>
                )}
              </p>
              {hasActiveFilters && (
                <button type="button" onClick={clearFilters} className="text-xs text-primary hover:underline">
                  {t('codeSearchView.clear-filters')}
                </button>
              )}
            </div>
            <FacetGroup
              title={t('codeSearchView.repository')}
              buckets={result.repoFacets}
              selected={selectedRepos}
              onToggle={(v) => editSource({ repos: [...toggleInSet(selectedRepos, v)] })}
              t={t}
            />
            <FacetGroup
              title={t('codeSearchView.language')}
              buckets={result.langFacets}
              selected={selectedLangs}
              onToggle={(v) => editSource({ langs: [...toggleInSet(selectedLangs, v)] })}
              t={t}
            />
            <FacetGroup
              title={t('codeSearchView.path')}
              buckets={result.pathFacets}
              selected={selectedPaths}
              onToggle={(v) => editSource({ paths: [...toggleInSet(selectedPaths, v)] })}
              t={t}
            />
          </div>
        )}
      </div>

      {!ready && <p role="status" className="text-sm text-muted-foreground">{l('正在恢复代码搜索…', 'Restoring code search…')}</p>}
      {(workspaceIssue || reading.issue || readingPreferences.issue) && <div role="alert" className="flex flex-wrap items-center gap-3 border-y py-3 text-sm text-destructive">
        <span className="min-w-0 break-words">{l('代码阅读数据未能保存或恢复', 'Could not save or restore code reading data')}{workspaceIssue?.detail ? `: ${workspaceIssue.detail}` : ''}</span>
        <Button type="button" variant="outline" size="sm" disabled={loading || loadingMore} onClick={() => { setMetadataVersion(version => version + 1); if (workspaceIssue?.kind !== 'metadata') void runSearch(false); }}>{t('codeSearchView.retry')}</Button>
      </div>}

      {/* 状态区 */}
      {loading && !result && (
        <div className="flex flex-col items-center justify-center gap-3 py-14">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t('codeSearchView.searching-code')}</p>
        </div>
      )}
      {error && (
        <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 py-8 text-center">
          <p className="max-w-md text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" disabled={loading || loadingMore} onClick={() => void runSearch(retryAppendRef.current)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
            {t('codeSearchView.retry')}
          </Button>
        </div>
      )}
      {ready && !loading && !error && !result && (
        <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
          <Search className="h-8 w-8 text-muted-foreground/50" />
          <p className="font-medium text-muted-foreground">{t('codeSearchView.code-search')}</p>
        </div>
      )}
      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              {t('codeSearchView.total')} <strong className="text-foreground">{starredOnly ? visibleHits.length : result.total}</strong>{' '}
              {t('codeSearchView.results')}
              {starredOnly && (
                <span className="ml-1">
                  {t('codeSearchView.starred-filter-v1-total', { v1: result.total })}
                </span>
              )}
              {loading && <span className="ml-2">{t('codeSearchView.searching')}</span>}
            </span>
          </div>
          {visibleHits.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 py-12 text-center">
              <Star className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {starredOnly
                  ? t('codeSearchView.no-hits-in-starred-repos-try-turning-off-starred')
                  : t('codeSearchView.no-matches-try-another-keyword-or-looser-filters')}
              </p>
              {starredOnly && (
                <Button variant="outline" size="sm" onClick={() => editSource({ starredOnly: false })}>
                  {t('codeSearchView.turn-off-starred-only')}
                </Button>
              )}
            </div>
          ) : (
            visibleHits.map((hit) => (
              <HitCard
                key={codeItemKey(hit)}
                hit={hit}
                isStarred={starredSet.has(hit.repo.toLowerCase())}
                t={t}
              />
            ))
          )}
          {loadingMore && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('codeSearchView.loading-more')}
            </div>
          )}
          {!loadingMore && hasMore && (visibleHits.length > 0 || starredOnly) && (
            <div className="flex justify-center pt-1">
              <Button
                variant="outline"
                onClick={loadMore}
                disabled={loading || !matchesSource}
                className="gap-2"
              >
                {t('codeSearchView.load-more-v1-v2', { v1: result.hits.length, v2: result.total })}
              </Button>
            </div>
          )}
        </div>
      )}
      <DiscoveryReadingSettings
        channelName={t('codeSearchView.code-search')}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        preferences={preferences}
        supportsAnalysis={false}
        onSave={async (value) => {
          if (!isCurrentAccount()) throw new Error(l('账号已切换', 'Account changed'));
          await readingPreferences.save({ ...value, autoAnalyze: false });
        }}
        onResetReading={reading.reset}
        onClearList={async () => {
          cancelRequest();
          await clearDiscoveryList(account, sessionKey);
          if (!isCurrentAccount()) return;
          snapshotRef.current = null; setSnapshot(null); setError(null); setLoading(false); setLoadingMore(false);
          const next = { ...sourceRef.current, resultSignature: null };
          sourceRef.current = next; setSource(next);
          await saveCodeSearchSourceState(account, next);
        }}
        onDeleteAnalysis={async () => { throw new Error(l('代码搜索不支持 AI 分析', 'Code search does not support AI analysis')); }}
      />
    </div>
  );
};

CodeSearchView.displayName = 'CodeSearchView';
