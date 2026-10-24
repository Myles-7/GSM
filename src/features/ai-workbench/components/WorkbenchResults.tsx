import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Copy, Download, ExternalLink, FolderPlus, Layers, LayoutGrid, List, Loader2, Plus, Search, SlidersHorizontal, Square, Star, X } from 'lucide-react';
import type { WorkbenchCandidate, WorkbenchSearchBatch } from '../../../types/aiWorkbench';
import type { Repository } from '../../../types';
import type { useAIWorkbench } from '../hooks/useAIWorkbench';
import { useT } from '../../../i18n/useT';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../../components/ui/sheet';
import { safeWriteText } from '../../../utils/clipboardUtils';
import { workbenchOverviewMarkdown } from '../../../services/workbenchOverview';
import { ResearchTimer } from './ResearchStatus';
import { WorkbenchSelect } from './WorkbenchSelect';

type Props = {
  workbench: ReturnType<typeof useAIWorkbench>; candidates: WorkbenchCandidate[];
  tab: 'results' | 'selected'; onTabChange: (tab: 'results' | 'selected') => void;
  batch?: WorkbenchSearchBatch; batchId: string; onBatchChange: (id: string) => void;
  resolveLanguage: (repository: Repository) => string;
  onResearch: (repositories: Repository[]) => void; onAsk: (items: WorkbenchCandidate[]) => void;
};
const publicSource = (raw: string) => {
  try { const url = new URL(raw); return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password ? url.href : undefined; }
  catch { return undefined; }
};

export function WorkbenchResults({ workbench: w, candidates, tab, onTabChange, batch, batchId, onBatchChange, resolveLanguage, onResearch, onAsk }: Props) {
  const t = useT('chat');
  const [category, setCategory] = useState('all');
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const [starFilter, setStarFilter] = useState('all');
  const [sort, setSort] = useState('original');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<string | null>(null);
  const [pendingStars, setPendingStars] = useState<Set<number>>(new Set());
  const [libraryQuery, setLibraryQuery] = useState('');
  const [layout, setLayout] = useState<'list' | 'grid'>(() => {
    try { return localStorage.getItem('gsm:overview-layout') === 'grid' ? 'grid' : 'list'; } catch { return 'list'; }
  });
  const busy = w.task.running;
  const grouping = busy && w.task.stage === 'overview' && tab === 'results' && category === 'all';
  const readonly = Boolean(w.active?.archived || w.active?.deletedAt);
  const starred = new Set(w.repositories.map(item => item.id));
  useEffect(() => { setSelected(new Set()); setCategory('all'); setDetail(null); }, [w.activeId, batchId, tab]);
  const categoryName = (item: WorkbenchCandidate) => item.overview?.category || t('overview.pending');
  const groups = useMemo(() => {
    const result = new Map<string, { count: number; description: string }>();
    candidates.forEach(item => {
      const name = item.overview?.category || t('overview.pending');
      const previous = result.get(name);
      result.set(name, { count: (previous?.count ?? 0) + 1, description: previous?.description || item.overview?.categoryDescription || '' });
    });
    return result;
  }, [candidates, t]);
  const visible = candidates.filter(item => {
    const r = item.repository;
    return (category === 'all' || categoryName(item) === category)
      && (kind === 'all' || item.overview?.kind === kind)
      && (starFilter === 'all' || (starFilter === 'starred') === starred.has(r.id))
      && `${r.full_name} ${item.overview?.summary || item.summary} ${item.overview?.category || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  });
  if (sort === 'stars') visible.sort((a, b) => b.repository.stargazers_count - a.repository.stargazers_count);
  if (sort === 'name') visible.sort((a, b) => a.repository.full_name.localeCompare(b.repository.full_name));
  const selection = candidates.filter(item => selected.has(item.repository.full_name.toLowerCase()));
  const hiddenSelectionCount = selection.filter(item => !visible.includes(item)).length;
  const filters = [
    ...(query ? [{ key: 'query', label: `${t('overview.search')}: ${query}`, clear: () => setQuery('') }] : []),
    ...(category !== 'all' ? [{ key: 'category', label: category, clear: () => setCategory('all') }] : []),
    ...(kind !== 'all' ? [{ key: 'kind', label: t(`overview.${kind}`), clear: () => setKind('all') }] : []),
    ...(starFilter !== 'all' ? [{ key: 'star', label: t(`workbench.${starFilter}`), clear: () => setStarFilter('all') }] : []),
    ...(sort !== 'original' ? [{ key: 'sort', label: `${t('overview.sort')}: ${t(`overview.${sort}`)}`, clear: () => setSort('original') }] : []),
  ];
  const clearFilters = () => { setQuery(''); setCategory('all'); setKind('all'); setStarFilter('all'); setSort('original'); };
  const activeDetail = candidates.find(item => item.repository.full_name === detail);
  const ready = candidates.filter(item => item.overview && item.overview.status !== 'failed').length;
  const toggle = (name: string) => setSelected(previous => {
    const next = new Set(previous), key = name.toLowerCase();
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const exportItems = selection.length ? selection : visible;
  const exportMarkdown = () => workbenchOverviewMarkdown(exportItems, batch?.requirements.purpose || t('overview.view'));
  const selectAll = visible.length > 0 && visible.every(item => selected.has(item.repository.full_name.toLowerCase()));
  const remove = async (repository: Repository) => {
    const sid = w.activeId ?? (await w.createSession()).id;
    await w.patchData(sid, { selectedRepositories: w.data.selectedRepositories.filter(item => item.id !== repository.id) });
  };

  return <section className="overview-container flex h-full min-h-0 min-w-0 flex-col" aria-label={t('overview.view')} data-testid="workbench-results">
    <div className="shrink-0 border-b border-border px-4 py-3 sm:px-5">
      {busy && <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2 text-xs" role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        <span className="min-w-0 flex-1">{w.task.stage === 'overview' ? t('overview.stage') : t(`workbench.stage-${w.task.stage}`, { defaultValue: w.task.stage })}</span>
        <ResearchTimer task={w.task} />
        <Button size="icon" variant="ghost" className="h-6 w-6" title={t('workbench.stop')} aria-label={t('workbench.stop')} onClick={w.stop}><Square className="h-3 w-3" /></Button>
      </div>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4" role="tablist" aria-label={t('workbench.repositories')}>
          {(['results', 'selected'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={tab === value}
            className={`border-b-2 pb-1 text-xs ${tab === value ? 'border-primary font-semibold' : 'border-transparent text-muted-foreground'}`}
            onClick={() => onTabChange(value)}>{t(value === 'selected' ? 'workbench.researchContext' : 'workbench.results')}</button>)}
        </div>
        <div className="flex items-center gap-1">
          {(['list', 'grid'] as const).map(value => <Button key={value} size="icon" variant={layout === value ? 'secondary' : 'ghost'} className="h-8 w-8" title={t(`overview.${value}Layout`)} aria-label={t(`overview.${value}Layout`)} aria-pressed={layout === value} onClick={() => {
            setLayout(value); try { localStorage.setItem('gsm:overview-layout', value); } catch { /* Optional preference. */ }
          }}>{value === 'list' ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}</Button>)}
          <Button size="icon" variant="ghost" className="h-8 w-8" title={t('overview.copy')} aria-label={t('overview.copy')} disabled={!exportItems.length}
            onClick={() => void w.guard(async () => { const result = await safeWriteText(exportMarkdown()); if (!result.success) throw new Error(result.error); })}><Copy className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" title={t('overview.export')} aria-label={t('overview.export')} disabled={!exportItems.length} onClick={() => {
            const url = URL.createObjectURL(new Blob([exportMarkdown()], { type: 'text/markdown' }));
            const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'project-overview.md'; anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1_000);
          }}><Download className="h-4 w-4" /></Button>
        </div>
      </div>
      {tab === 'results' && w.data.searchBatches.length > 0 && <WorkbenchSelect
        className="mt-2 w-full"
        ariaLabel={t('workbench.searchRound')}
        value={batchId === 'all' ? 'all' : batch?.id ?? w.data.searchBatches[0]?.id ?? 'all'}
        onValueChange={onBatchChange}
        items={[
          { value: 'all', label: t('overview.allRounds') },
          ...w.data.searchBatches.map((item, i) => ({ value: item.id, label: `${i + 1}. ${item.requirements.purpose}` })),
        ]}
      />}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-5" data-testid="overview-scroll">
      <div className="mx-auto w-full max-w-[1100px] space-y-3">
        <header>
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><Layers className="h-3.5 w-3.5" />{t('overview.sessionOnly')}<span className="ml-auto" role="status">{t('overview.progress', { ready, total: candidates.length })}</span></div>
          <h2 className="break-words text-lg font-semibold leading-7">{tab === 'selected' ? t('overview.selectedScope') : batchId === 'all' ? t('overview.allRounds') : batch?.requirements.purpose || t('overview.title')}</h2>
          {batchId !== 'all' && batch?.overviewSummary && <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{batch.overviewSummary}</p>}
        </header>
        {candidates.length > 0 && <>
          <nav aria-label={t('overview.allCategories')} className="flex flex-nowrap gap-x-1 gap-y-2 overflow-x-auto border-y border-border py-2 sm:flex-wrap">
            {[['all', candidates.length], ...[...groups].map(([name, data]) => [name, data.count])] .map(([name, count]) => <button type="button" key={name}
              aria-pressed={category === name} className={`flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-xs ${category === name ? 'bg-accent font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
              onClick={() => setCategory(String(name))}>{name === 'all' ? t('overview.allCategories') : name}<span className="text-[11px] text-muted-foreground">{count}</span></button>)}
          </nav>
          {category !== 'all' && groups.get(category)?.description && <p className="text-xs text-muted-foreground">{groups.get(category)?.description}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-[1_1_180px]"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input className="h-8 pl-8 text-xs" aria-label={t('overview.search')} placeholder={t('overview.search')} value={query} onChange={event => setQuery(event.target.value)} /></div>
            <Popover>
              <PopoverTrigger asChild><Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5 px-2 text-xs" aria-label={t('overview.filtersCount', { count: filters.length })}>
                <SlidersHorizontal className="h-3.5 w-3.5" />{t('overview.filters')}{filters.length > 0 && <span className="rounded bg-accent px-1.5 text-[11px]">{filters.length}</span>}
              </Button></PopoverTrigger>
              <PopoverContent align="end" aria-label={t('overview.filters')} className="w-72 max-w-[calc(100vw-2rem)] space-y-3 p-3">
                <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{t('overview.filters')}</h3><Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!filters.length} onClick={clearFilters}>{t('overview.clearFilters')}</Button></div>
                <div className="space-y-1"><p className="text-xs text-muted-foreground">{t('overview.allTypes')}</p><WorkbenchSelect
                  value={kind} ariaLabel={t('overview.allTypes')} onValueChange={setKind} className="w-full"
                  items={['all', 'tool', 'library', 'resource', 'other'].map((value) => ({ value, label: t(`overview.${value === 'all' ? 'allTypes' : value}`) }))}
                /></div>
                <div className="space-y-1"><p className="text-xs text-muted-foreground">{t('overview.starStatus')}</p><WorkbenchSelect
                  value={starFilter} ariaLabel={t('overview.starStatus')} onValueChange={setStarFilter} className="w-full"
                  items={['all', 'starred', 'unstarred'].map((value) => ({ value, label: t(`workbench.${value}`) }))}
                /></div>
                <div className="space-y-1"><p className="text-xs text-muted-foreground">{t('overview.sort')}</p><WorkbenchSelect
                  value={sort} ariaLabel={t('overview.sort')} onValueChange={setSort} className="w-full"
                  items={['original', 'stars', 'name'].map((value) => ({ value, label: t(`overview.${value}`) }))}
                /></div>
              </PopoverContent>
            </Popover>
          </div>
          {filters.length > 0 && <div className="flex flex-wrap items-center gap-1.5" aria-label={t('overview.appliedFilters')}>
            {filters.map(filter => <Button key={filter.key} size="sm" variant="secondary" className="h-auto max-w-full gap-1 py-1 pl-2 pr-1.5 text-xs" aria-label={t('overview.removeFilter', { filter: filter.label })} onClick={filter.clear}><span className="min-w-0 truncate">{filter.label}</span><X className="h-3 w-3 shrink-0" /></Button>)}
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={clearFilters}>{t('overview.clearFilters')}</Button>
          </div>}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <label className="flex items-center gap-2"><input type="checkbox" checked={selectAll} disabled={!visible.length} onChange={() => setSelected(previous => {
              const next = new Set(previous); visible.forEach(item => { if (selectAll) next.delete(item.repository.full_name.toLowerCase()); else next.add(item.repository.full_name.toLowerCase()); }); return next;
            })} />{t('overview.selectVisible')}</label>
            <span>{t('overview.count', { count: visible.length })}</span>
          </div>
        </>}
        {!candidates.length ? <div className="py-16 text-center"><Layers className="mx-auto mb-4 h-8 w-8 text-muted-foreground/60" /><h3 className="text-sm font-medium">{t('overview.empty')}</h3><p className="mt-2 text-xs text-muted-foreground">{t('overview.emptyHint')}</p></div>
          : !visible.length ? <div className="py-8 text-center text-sm text-muted-foreground">{t('overview.noMatches')}<Button size="sm" variant="ghost" onClick={clearFilters}>{t('overview.clearFilters')}</Button></div>
          : (grouping ? [t('overview.allCategories')] : [...new Set(visible.map(categoryName))]).map(group => <section key={group} className="space-y-3" aria-label={group}>
            <h3 className="flex items-baseline gap-2 text-sm font-semibold">{group}<span className="text-xs font-normal text-muted-foreground">{visible.filter(item => grouping || categoryName(item) === group).length}</span></h3>
            <div className={layout === 'list' ? 'space-y-2' : 'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]'}>
              {visible.filter(item => grouping || categoryName(item) === group).map(item => {
                const r = item.repository, inContext = w.data.selectedRepositories.some(repo => repo.id === r.id);
                const status = item.overview?.status ?? 'pending';
                return <article key={r.full_name} className={`min-w-0 rounded-md border bg-card p-3 ${layout === 'list' ? 'overview-compact' : 'flex flex-col p-3.5'} ${selected.has(r.full_name.toLowerCase()) ? 'border-primary/60 ring-1 ring-primary/15' : 'border-border'}`} data-testid="overview-card">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <img src={r.owner.avatar_url} alt="" className="h-8 w-8 shrink-0 rounded-md" loading="lazy" />
                    <div className="min-w-0 flex-1"><a href={`https://github.com/${r.full_name}`} target="_blank" rel="noreferrer" className="block break-words text-sm font-semibold leading-5 hover:underline">{r.name || r.full_name.split('/').pop()}</a><p className="truncate text-[11px] text-muted-foreground" title={r.full_name}>{r.owner.login}</p></div>
                    <input type="checkbox" className="mt-1 shrink-0" aria-label={t('overview.select', { name: r.full_name })} checked={selected.has(r.full_name.toLowerCase())} onChange={() => toggle(r.full_name)} />
                  </div>
                  <p className={`overview-summary break-words text-xs leading-5 ${layout === 'list' ? 'mt-2 line-clamp-2' : 'mt-3 min-h-[3.75rem] line-clamp-3'}`}>{item.overview?.summary || item.summary || t('workbench.unknown')}</p>
                  <div className="overview-status mt-2 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    {item.overview && <span className="font-medium text-foreground/75">{t(`overview.${item.overview.kind}`)}</span>}
                    <span className={status === 'failed' || status === 'insufficient' ? 'text-amber-700 dark:text-amber-400' : ''}>{t(`overview.${status}`)}</span>
                    {inContext && <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><Check className="h-3 w-3" />{t('overview.inResearchContext')}</span>}
                  </div>
                  <div className="overview-metadata mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-1"><Star className="h-3 w-3" />{r.stargazers_count.toLocaleString()}</span><span>{resolveLanguage(r)}</span></div>
                  <div className="overview-actions mt-2 flex flex-wrap items-center gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" title={t('workbench.star')} aria-label={t('workbench.star')} disabled={starred.has(r.id) || pendingStars.has(r.id)} onClick={() => {
                      setPendingStars(previous => new Set(previous).add(r.id));
                      void w.guard(async () => { try { await w.star(r); } finally { setPendingStars(previous => { const next = new Set(previous); next.delete(r.id); return next; }); } });
                    }}><Star className={`h-3.5 w-3.5 ${starred.has(r.id) ? 'fill-current text-amber-500' : ''}`} /></Button>
                    <Button size="sm" variant="ghost" className={`h-7 px-1.5 text-xs ${inContext ? 'text-emerald-700 dark:text-emerald-400' : ''}`} disabled={readonly}
                      aria-label={inContext ? t('workbench.removeContext') : t('overview.addResearchContext')} title={inContext ? t('workbench.removeContext') : t('overview.addResearchContext')}
                      onClick={() => void w.guard(() => inContext ? remove(r) : w.addRepository(r))}>{inContext ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}{t(inContext ? 'overview.inResearchContext' : 'overview.addResearchContext')}</Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title={t('workbench.addToProject')} aria-label={t('workbench.addToProject')} disabled={!w.project || readonly} onClick={() => void w.guard(() => w.addRepository(r, true))}><FolderPlus className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="ml-auto h-7 px-1.5 text-xs" aria-label={`${t('overview.details')}: ${r.full_name}`} onClick={() => setDetail(r.full_name)}>{t('overview.details')}<ChevronRight className="h-3.5 w-3.5" /></Button>
                    {tab === 'selected' && <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('workbench.removeContext')} disabled={readonly} onClick={() => void w.guard(() => remove(r))}><X className="h-3 w-3" /></Button>}
                  </div>
                </article>;
              })}
            </div>
          </section>)}
        <div className="flex flex-wrap gap-2">
          {tab === 'results' && batch && batchId !== 'all' && <Button size="sm" variant="outline" disabled={busy || readonly} onClick={() => void w.guard(() => w.search(batch.requirements, batch.nextPage, batch.id))}>{t('workbench.moreResults')}</Button>}
          {tab === 'results' && candidates.some(item => !item.overview || item.overview.status === 'failed') && <Button size="sm" variant="ghost" disabled={busy || readonly} onClick={() => void w.guard(async () => {
            const targets = batchId === 'all' ? w.data.searchBatches : batch ? [batch] : [];
            for (const target of targets) if (target.candidates.some(item => !item.overview || item.overview.status === 'failed')) await w.retryOverview(target.id);
          })}>{t(candidates.some(item => item.overview?.status === 'failed') ? 'overview.retryFailed' : 'overview.retry')}</Button>}
          {tab === 'selected' && (
            <details className="w-full rounded-lg border border-border/70 bg-muted/20 p-2.5 text-xs">
              <summary className="cursor-pointer font-medium py-1">{t('workbench.addSelected')}</summary>
              <div className="mt-2 space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    className="h-7 pl-8 text-xs"
                    value={libraryQuery}
                    onChange={event => setLibraryQuery(event.target.value)}
                    placeholder={t('overview.search')}
                    aria-label={t('workbench.addSelected')}
                  />
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-border/40">
                  {w.repositories
                    .filter(r => !w.data.selectedRepositories.some(sel => sel.id === r.id))
                    .filter(r => !libraryQuery.trim() || `${r.full_name} ${r.description || ''} ${r.ai_summary || ''}`.toLowerCase().includes(libraryQuery.trim().toLowerCase()))
                    .slice(0, 50)
                    .map(r => (
                      <button
                        key={r.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-1.5 py-1.5 text-left hover:bg-muted/60 rounded transition-colors"
                        onClick={() => void w.guard(() => w.addRepository(r))}
                      >
                        <span className="truncate font-medium">{r.full_name}</span>
                        <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    ))}
                </div>
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
    <footer className="shrink-0 border-t border-border bg-background px-4 py-3 text-xs">
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0 flex-1 text-muted-foreground"><p>{t('overview.checkedCount', { count: selection.length })}</p><p className="mt-0.5 text-[11px]">{t('overview.savedContextCount', { count: w.data.selectedRepositories.length })}{hiddenSelectionCount > 0 && <> · {t('overview.hiddenChecked', { count: hiddenSelectionCount })}</>}</p></div>
        {selection.length > 0 && <Button size="icon" variant="ghost" className="h-7 w-7" title={t('overview.clear')} aria-label={t('overview.clear')} onClick={() => setSelected(new Set())}><X className="h-3.5 w-3.5" /></Button>}
        <div className="flex w-full flex-wrap gap-2">
          <Button size="sm" variant="outline" className="h-auto min-h-8 flex-[1_1_160px] whitespace-normal px-2 py-1.5 text-xs" disabled={!selection.length || readonly} onClick={() => void w.guard(() => w.addRepositories(selection.map(item => item.repository)))}><Plus className="h-3.5 w-3.5 shrink-0" />{t('overview.addResearchContextCount', { count: selection.length })}</Button>
          <Button size="sm" variant="outline" className="h-auto min-h-8 flex-[1_1_120px] whitespace-normal px-2 py-1.5 text-xs" disabled={!selection.length || selection.length > 120 || busy || readonly} onClick={() => onAsk(selection)}>{t('overview.askCheckedCount', { count: selection.length })}</Button>
          <Button size="sm" className="h-auto min-h-8 flex-[1_1_120px] whitespace-normal px-2 py-1.5 text-xs" disabled={!selection.length || busy || readonly} onClick={() => onResearch(selection.map(item => item.repository))}>{t('overview.researchCheckedCount', { count: selection.length })}</Button>
        </div>
      </div>
      {selection.length > 120 && <p role="status" className="mx-auto mt-2 max-w-[1100px] text-muted-foreground">{t('overview.scopeLimit', { count: selection.length })}</p>}
    </footer>
    <Sheet open={Boolean(activeDetail)} onOpenChange={open => { if (!open) setDetail(null); }}><SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
      <SheetHeader><SheetTitle className="break-words">{activeDetail?.repository.full_name}</SheetTitle><SheetDescription>{activeDetail?.overview ? t(`overview.${activeDetail.overview.basis}`) : t('overview.metadata')}</SheetDescription></SheetHeader>
      {activeDetail && <div className="space-y-5 text-sm leading-6">
        <p className="break-words">{activeDetail.overview?.summary || activeDetail.summary}</p>
        <p className="text-xs text-muted-foreground">{activeDetail.repository.license || t('workbench.unknown')} · {activeDetail.repository.pushed_at?.slice(0, 10) || t('workbench.unknown')}</p>
        {activeDetail.reasons.length > 0 && <section><h3 className="mb-2 text-xs font-semibold text-muted-foreground">{t('overview.reasons')}</h3><ul className="space-y-2">{activeDetail.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></section>}
        {activeDetail.limitations.length > 0 && <section><h3 className="mb-2 text-xs font-semibold text-muted-foreground">{t('overview.limitations')}</h3><ul className="space-y-2">{activeDetail.limitations.map(reason => <li key={reason}>{reason}</li>)}</ul></section>}
        <section><h3 className="mb-2 text-xs font-semibold text-muted-foreground">{t('overview.sources')}</h3>{activeDetail.sources.map(url => publicSource(url) && <a key={url} href={publicSource(url)} target="_blank" rel="noreferrer" className="mb-2 block break-all text-xs text-primary underline">{url}</a>)}</section>
        <a href={`https://github.com/${activeDetail.repository.full_name}#readme`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary">README<ExternalLink className="h-3.5 w-3.5" /></a>
      </div>}
    </SheetContent></Sheet>
  </section>;
}
