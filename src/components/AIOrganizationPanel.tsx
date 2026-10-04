import { useState } from 'react';
import { AlertCircle, Check, FolderTree, Loader2, MessageSquare, Pencil, Plus, RefreshCw, RotateCcw, Send, Square } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { useAppStore } from '../store/useAppStore';
import { useT } from '../i18n/useT';
import type { useAIOrganization } from '../hooks/useAIOrganization';
import { CategoryStructurePanel } from './CategoryStructurePanel';

type Controller = ReturnType<typeof useAIOrganization>;
const selectClass = 'h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-xs';

const PROMPT_PRESETS = [
  {
    id: 'domain',
    labelZh: '🏷️ 领域与形态',
    labelEn: '🏷️ Domain & Form',
    promptZh: '请按项目所属应用领域与工程形态（如：前端基础设施、后端服务、开发工具、学习文档、参考案例）进行系统分类，并细化二级目录。',
    promptEn: 'Categorize repositories by application domain and project form (e.g., Frontend Infrastructure, Backend Services, Developer Tools, Documentation, Showcase/Demos) with detailed subcategories.',
  },
  {
    id: 'techstack',
    labelZh: '💻 技术栈与编程语言',
    labelEn: '💻 Tech Stack & Language',
    promptZh: '请以主要编程语言与底层技术栈（如：TypeScript/React、Python/AI、Go/云原生、Rust/系统工具）为核心维度组织并分类仓库。',
    promptEn: 'Organize and classify repositories primarily by core programming language and technology stack (e.g., TypeScript/React, Python/AI, Go/Cloud Native, Rust/Systems).',
  },
];

export function AIOrganizationPanel({ open, onOpenChange, controller: c }: { open: boolean; onOpenChange: (open: boolean) => void; controller: Controller }) {
  const t = useT('repositories');
  const language = useAppStore(s => s.language);
  const isZh = language === 'zh' || language === 'zh-TW';
  const [filter, setFilter] = useState('all');
  const [mobileTab, setMobileTab] = useState('repositories');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [enrichIds, setEnrichIds] = useState<Set<number>>(new Set());
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [grouped, setGrouped] = useState(true);
  const [bulkTarget, setBulkTarget] = useState('');
  const [bulkGroup, setBulkGroup] = useState('');
  const [bulkScope, setBulkScope] = useState('selected');
  const draft = c.proposal?.organization;
  const structure = c.purpose === 'structure';
  const editable = !!draft && ['ready', 'interrupted'].includes(draft.status) && !c.readonly && !c.busy;
  const entries = draft?.entries ?? [];
  const categories = draft?.categories ?? [];
  const repoMap = new Map(c.repositories.map(r => [r.id, r]));
  const targetLabel = (categoryId: string | null, subcategoryId: string | null) => {
    const main = categories.find(g => g.id === categoryId)?.name ?? t('aiOrganization.pending');
    const sub = categories.find(g => g.id === subcategoryId)?.name;
    return sub ? `${main} / ${sub}` : main;
  };
  const selected = entries.filter(e => e.selected && e.disposition === 'move' && e.status === 'pending');
  const visible = entries.filter(e => (filter === 'all' || e.disposition === filter || e.status === filter)
    && (!categoryFilter || e.categoryId === categoryFilter || e.subcategoryId === categoryFilter));
  if (grouped) visible.sort((a, b) => targetLabel(a.categoryId, a.subcategoryId).localeCompare(targetLabel(b.categoryId, b.subcategoryId)));
  const bulkIds = visible.filter(e => e.status === 'pending' && (bulkScope === 'visible' || e.selected)).map(e => e.repositoryId);
  const selectable = visible.filter(entry => entry.disposition === 'move' && entry.status === 'pending'
    && (!entry.before.locked || entry.categoryId === entry.before.categoryId || entry.overrideLocked));

  const batches = draft?.batches ?? [];
  const completedBatches = batches.filter(b => b.status === 'complete');
  const completedRepoIds = new Set(completedBatches.flatMap(b => b.repositoryIds));
  const completedCount = completedBatches.reduce((n, b) => n + b.repositoryIds.length, 0);
  const totalEntries = entries.length;
  const overallPercent = totalEntries > 0 ? Math.round((completedCount / totalEntries) * 100) : 0;
  const failedBatches = batches
    .map((b, i) => ({ batch: b, index: i }))
    .filter(({ batch }) => batch.status === 'failed');
  const pendingBatchIndex = batches.findIndex(b => b.status === 'pending');
  const readyToApply = entries.filter(e => e.selected && e.disposition === 'move' && e.status === 'pending' && completedRepoIds.has(e.repositoryId));
  const isGenerating = draft?.status === 'generating';

  const involved = new Set(entries.flatMap(e => [e.categoryId, e.subcategoryId, e.before.categoryId, e.before.subcategoryId]));
  const categoryButtons = (parentId: string | null) => categories.filter(g => g.parentId === parentId && (showAllCategories || g.isNew || involved.has(g.id)))
    .sort((a, b) => Number(b.isNew) - Number(a.isNew)).map(category => {
    const count = entries.filter(e => category.parentId ? e.subcategoryId === category.id : e.categoryId === category.id).length;
    return <div key={category.id} className={parentId ? 'ml-4 border-l border-border pl-2' : 'mt-2'}>
      <div className="flex min-w-0 items-center gap-1">
        <button type="button" onClick={() => setCategoryFilter(categoryFilter === category.id ? null : category.id)}
          aria-pressed={categoryFilter === category.id} className={`flex min-w-0 flex-1 items-start gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent ${categoryFilter === category.id ? 'bg-accent' : ''}`}>
          {category.isNew && <Plus className="mt-0.5 h-3 w-3 shrink-0" aria-label={t('aiOrganization.newCategory')} />}
          <span className="min-w-0 flex-1 break-words">{category.name}</span><span className="shrink-0 text-muted-foreground">{count}</span>
        </button>
        {category.isNew && editable && <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={t('aiOrganization.rename', { name: category.name })} title={t('aiOrganization.rename', { name: category.name })} onClick={() => setRenaming(renaming === category.id ? null : category.id)}><Pencil className="h-3 w-3" /></Button>}
      </div>
      {!parentId && <p className="px-2 text-[10px] text-muted-foreground">{t('aiOrganization.flow', { incoming: entries.filter(e => e.categoryId === category.id && e.before.categoryId !== category.id).length, outgoing: entries.filter(e => e.before.categoryId === category.id && e.categoryId !== category.id).length })}</p>}
      {category.isNew && editable && renaming === category.id && <input key={`${category.id}:${category.name}`} autoFocus aria-label={t('aiOrganization.rename', { name: category.name })}
        defaultValue={category.name} maxLength={120} className="mb-1 ml-2 w-[calc(100%-1rem)] min-w-0 rounded border border-input bg-background px-2 py-1 text-xs"
        onBlur={e => { setRenaming(null); if (e.target.value.trim() && e.target.value.trim() !== category.name) void c.renameCategory(category.id, e.target.value); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null); }} />}
      {!parentId && categoryButtons(category.id)}
    </div>;
  });
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[90dvh] max-h-[900px] w-[calc(100%-1rem)] max-w-[1100px] flex-col gap-0 overflow-hidden p-0 sm:w-[calc(100%-3rem)]">
      <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-12">
        <DialogTitle className="flex items-center gap-2 text-base"><FolderTree className="h-4 w-4" />{t('aiOrganization.title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('aiOrganization.description')}</DialogDescription>
      </DialogHeader>
      <div className="flex shrink-0 gap-1 border-b px-4 py-2" role="group" aria-label={t('aiOrganization.purposeLabel')}>
        {(['repositories', 'structure'] as const).map(value => <Button key={value} size="sm" variant={(c.purpose ?? 'repositories') === value ? 'secondary' : 'ghost'} aria-pressed={(c.purpose ?? 'repositories') === value} disabled={c.busy} onClick={() => c.setPurpose(value)}>{t(`aiOrganization.purpose.${value}`)}</Button>)}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        {!structure && <select aria-label={t('aiOrganization.modeLabel')} className={selectClass} value={c.mode ?? 'supplement'} onChange={e => c.setMode(e.target.value as Controller['mode'])} disabled={c.busy || !!draft}>
          {['supplement', 'reorganize'].map(value => <option key={value} value={value}>{t(`aiOrganization.mode.${value}`)}</option>)}
        </select>}
        {!draft && !structure ? <select aria-label={t('aiOrganization.scopeLabel')} className={selectClass} value={c.scope} onChange={e => c.setScope(e.target.value as Controller['scope'])} disabled={c.busy}>
          {c.scopeOptions.map(o => <option key={o.value} value={o.value}>{o.label} ({o.count})</option>)}
        </select> : draft ? <>
          <select aria-label={t('aiOrganization.version')} className={selectClass} value={c.proposal!.id} onChange={e => c.selectVersion(e.target.value)} disabled={c.busy}>
            {c.versions.map(v => <option key={v.id} value={v.id}>{t('aiOrganization.revision', { count: v.organization!.revision })}</option>)}
          </select>
          <span className="text-xs text-muted-foreground">{completedCount} / {entries.length}</span>
        </> : null}
        <select aria-label={t('aiOrganization.model')} className={`${selectClass} max-w-[220px]`} value={c.configId} onChange={e => c.setConfigId(e.target.value)} disabled={c.busy || c.readonly}>
          <option value="" disabled>{t('aiOrganization.model')}</option>
          {c.aiConfigs.map(config => <option key={config.id} value={config.id}>{config.name} · {config.model}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">{t('aiOrganization.maxGroups')}
          <input type="number" min={1} max={20} value={c.maxNewSubcategories} disabled={c.busy || c.readonly} className={`${selectClass} w-14`}
            onChange={e => c.setMaxNewSubcategories(Math.max(1, Math.min(20, Number(e.target.value) || 6)))} />
        </label>
        {draft && <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" title={t('aiOrganization.newTask')} aria-label={t('aiOrganization.newTask')} disabled={c.busy} onClick={c.newDraft}><Plus className="h-4 w-4" /></Button>}
      </div>
      {/* Dual-Track Progress Visualization */}
      {draft && !structure && (
        <div className="shrink-0 border-b border-border bg-muted/20 px-4 py-2.5 space-y-2">
          {/* Track 1: Overall Progress Bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground flex items-center gap-1.5">
                <span>{isZh ? '全量仓库进度' : 'Overall Progress'}</span> {/* i18n-allow-literal */}
                {c.busy && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
              </span>
              <span className="text-muted-foreground font-mono text-[11px]">
                {isZh ? `已就绪 ${completedCount} / ${totalEntries} (${overallPercent}%)` : `Ready ${completedCount} / ${totalEntries} (${overallPercent}%)`} {/* i18n-allow-literal */}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all duration-300 ease-out rounded-full"
                style={{ width: `${overallPercent}%` }}
              />
            </div>
          </div>

          {/* Track 2: Current Executing and/or Failed Batch Cards */}
          {batches.length > 0 && (
            <div className="text-xs space-y-1.5">
              {c.busy && pendingBatchIndex >= 0 && (
                <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-foreground">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                  <span className="font-medium">
                    {isZh
                      ? `批次 ${pendingBatchIndex + 1} / ${batches.length} · 处理中 (${batches[pendingBatchIndex].repositoryIds.length} 项)`
                      : `Batch ${pendingBatchIndex + 1} / ${batches.length} · Processing (${batches[pendingBatchIndex].repositoryIds.length} items)`} {/* i18n-allow-literal */}
                  </span>
                </div>
              )}
              {failedBatches.map(({ batch, index }) => (
                <div key={index} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-destructive">
                  <div className="flex min-w-0 items-center gap-2">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium">
                      {isZh
                        ? `批次 ${index + 1} / ${batches.length} · 失败 (${batch.repositoryIds.length} 项)`
                        : `Batch ${index + 1} / ${batches.length} · Failed (${batch.repositoryIds.length} items)`} {/* i18n-allow-literal */}
                    </span>
                    {batch.error && (
                      <span className="truncate max-w-[280px] text-destructive/80 text-[11px]">
                        ({batch.error})
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs border-destructive/40 text-destructive hover:bg-destructive/20"
                    disabled={c.busy || c.readonly}
                    onClick={() => void c.retryBatch(index)}
                  >
                    <RefreshCw className="mr-1 h-3 w-3" />
                    {isZh ? `重试批次 ${index + 1}` : `Retry Batch ${index + 1}`} {/* i18n-allow-literal */}
                  </Button>
                </div>
              ))}
              {!c.busy && failedBatches.length === 0 && completedBatches.length === batches.length && (
                <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-medium">
                    {isZh
                      ? `全部批次已就绪 (共 ${batches.length} 批 · ${totalEntries} 个仓库)`
                      : `All batches ready (${batches.length} batches · ${totalEntries} repos)`} {/* i18n-allow-literal */}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {c.error && <p role="alert" className="shrink-0 break-words border-b px-4 py-2 text-xs text-destructive">{c.error}</p>}
      {c.readonly && <p className="shrink-0 px-4 py-2 text-xs text-muted-foreground">{t('aiOrganization.readonly')}</p>}
      {structure ? <CategoryStructurePanel controller={c} /> : draft ? <>
        <div className="flex shrink-0 gap-1 border-b p-2 md:hidden" role="group" aria-label={t('aiOrganization.view')}>
          {['categories', 'repositories'].map(tab => <Button key={tab} size="sm" variant={mobileTab === tab ? 'secondary' : 'ghost'} aria-pressed={mobileTab === tab} onClick={() => setMobileTab(tab)}>{t(`aiOrganization.${tab}`)}</Button>)}
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className={`${mobileTab === 'categories' ? 'block' : 'hidden'} w-full shrink-0 overflow-y-auto border-r border-border p-3 md:block md:w-64`}>
            <button type="button" onClick={() => setCategoryFilter(null)} className="px-2 text-xs font-semibold">{t('aiOrganization.categories')} ({entries.length})</button>
            {categoryButtons(null)}
            <Button variant="ghost" size="sm" className="mt-3 h-7 text-xs" onClick={() => setShowAllCategories(!showAllCategories)}>{t(showAllCategories ? 'aiOrganization.onlyInvolved' : 'aiOrganization.showAllCategories')}</Button>
          </aside>
          <section className={`${mobileTab === 'repositories' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1 flex-col md:flex`}>
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border p-2">
              {['all', 'move', 'insufficient', 'unchanged', 'conflict'].map(value => <Button key={value} size="sm" variant={filter === value ? 'secondary' : 'ghost'} aria-pressed={filter === value} className="h-7 px-2 text-xs" onClick={() => setFilter(value)}>{t(value === 'conflict' ? 'aiOrganization.status.conflict' : `aiOrganization.filter.${value}`)}</Button>)}
              <label className="ml-2 flex items-center gap-1 text-xs">
                <input type="checkbox" disabled={!editable || !selectable.length} checked={selectable.length > 0
                  && selectable.every(entry => entry.selected)}
                  onChange={event => void c.selectEntries(visible.map(entry => entry.repositoryId), event.target.checked)} />
                {t('organization.selectAll')}
              </label>
              {categoryFilter && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCategoryFilter(null)}>{t('aiOrganization.clearFilter')}</Button>}
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setGrouped(!grouped)}>{t(grouped ? 'aiOrganization.flatView' : 'aiOrganization.groupedView')}</Button>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-2">
              <select aria-label={t('aiOrganization.bulkScope')} className={selectClass} value={bulkScope} onChange={e => setBulkScope(e.target.value)}><option value="selected">{t('aiOrganization.bulkSelected')}</option><option value="visible">{t('aiOrganization.bulkVisible')}</option></select>
              <select aria-label={t('aiOrganization.mainTarget')} className={`${selectClass} max-w-[170px]`} value={bulkTarget} onChange={e => { setBulkTarget(e.target.value); setBulkGroup(''); }} disabled={!editable}>
                <option value="">{t('aiOrganization.pending')}</option>{categories.filter(cat => !cat.parentId).map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
              </select>
              <select aria-label={t('aiOrganization.subTarget')} className={`${selectClass} max-w-[150px]`} value={bulkGroup} onChange={e => setBulkGroup(e.target.value)} disabled={!editable || !bulkTarget}>
                <option value="">{t('organization.ungrouped')}</option>{categories.filter(cat => cat.parentId === bulkTarget).map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
              </select>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!editable || !bulkIds.length} onClick={() => void c.bulkEdit(bulkIds, bulkTarget || null, bulkGroup || null)}>{t('aiOrganization.bulkMove', { count: bulkIds.length })}</Button>
              {(['keep', 'subdivide', 'reconsider'] as const).map(action => <Button key={action} size="sm" variant="ghost" className="h-7 text-xs" disabled={!editable || !bulkIds.length} onClick={() => void c.bulkEdit(bulkIds, null, null, action)}>{t(`aiOrganization.quick.${action}`)}</Button>)}
            </div>
            <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
              {!visible.length && <p className="p-6 text-center text-sm text-muted-foreground">{t('aiOrganization.empty')}</p>}
              {visible.map((entry, index) => {
                const isReady = completedRepoIds.has(entry.repositoryId);
                const isSuccess = entry.status === 'success';
                return (
                  <article
                    key={entry.repositoryId}
                    className={`space-y-2 px-4 py-3 transition-colors ${isReady && !isSuccess ? 'bg-primary/[0.02] border-l-2 border-l-primary/60' : ''}`}
                    data-organization-repository={entry.repositoryId}
                  >
                    {grouped && (index === 0 || visible[index - 1].categoryId !== entry.categoryId || visible[index - 1].subcategoryId !== entry.subcategoryId) && <h3 className="border-b pb-2 text-xs font-semibold">{targetLabel(entry.categoryId, entry.subcategoryId)}</h3>}
                    <div className="flex items-start gap-2">
                      <input type="checkbox" className="mt-1 shrink-0" checked={entry.selected} disabled={!editable || entry.disposition !== 'move' || entry.status !== 'pending' || (entry.before.locked && entry.categoryId !== entry.before.categoryId && !entry.overrideLocked)}
                        aria-label={t('aiOrganization.selectRepository', { name: repoMap.get(entry.repositoryId)?.full_name ?? entry.repositoryId })}
                        onChange={e => void c.editEntry(entry.repositoryId, { selected: e.target.checked })} />
                      <span className="min-w-0 flex-1 break-all text-sm font-medium">{repoMap.get(entry.repositoryId)?.full_name ?? entry.repositoryId}</span>
                      {isSuccess ? (
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10">
                          <Check className="h-2.5 w-2.5 mr-0.5" />
                          {isZh ? '已应用' : 'Applied'} {/* i18n-allow-literal */}
                        </Badge>
                      ) : isReady && entry.status === 'pending' ? (
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-primary border-primary/40 bg-primary/10">
                          {isZh ? '已就绪' : 'Ready'} {/* i18n-allow-literal */}
                        </Badge>
                      ) : null}
                      <span className="shrink-0 text-xs text-muted-foreground">{t(`aiOrganization.status.${entry.status === 'pending' ? entry.disposition : entry.status}`)}</span>
                    </div>
                    <div className="grid min-w-0 gap-1 pl-5 text-xs sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                      <span className="break-words text-muted-foreground">{targetLabel(entry.before.categoryId, entry.before.subcategoryId)}</span><span aria-hidden="true">→</span>
                      <div className="grid min-w-0 gap-1 sm:grid-cols-2"><select className={`${selectClass} w-full`} aria-label={t('aiOrganization.destination', { name: repoMap.get(entry.repositoryId)?.name ?? entry.repositoryId })}
                        disabled={!editable || entry.status !== 'pending' || (draft.mode === 'supplement' && !!entry.before.categoryId)} value={entry.categoryId || ''}
                        onChange={e => void c.editEntry(entry.repositoryId, { categoryId: e.target.value || null, subcategoryId: null })}>
                        <option value="">{t('aiOrganization.pending')}</option>
                        {categories.filter(category => !category.parentId).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                      </select><select className={`${selectClass} w-full`} aria-label={t('aiOrganization.subDestination', { name: repoMap.get(entry.repositoryId)?.name ?? entry.repositoryId })} value={entry.subcategoryId || ''} disabled={!editable || entry.status !== 'pending' || !entry.categoryId} onChange={e => void c.editEntry(entry.repositoryId, { subcategoryId: e.target.value || null })}>
                        <option value="">{t('organization.ungrouped')}</option>{categories.filter(category => category.parentId === entry.categoryId).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                      </select></div>
                    </div>
                    {entry.reason && <p className="break-words pl-5 text-xs leading-5 text-muted-foreground">{entry.reason}</p>}
                    {entry.before.locked && entry.categoryId !== entry.before.categoryId && <label className="flex items-start gap-2 pl-5 text-xs text-destructive"><input type="checkbox" checked={entry.overrideLocked} disabled={!editable} onChange={e => void c.editEntry(entry.repositoryId, { overrideLocked: e.target.checked })} />{t('aiOrganization.overrideLock')}</label>}
                    {entry.disposition === 'insufficient' && <label className="flex items-center gap-2 pl-5 text-xs"><input type="checkbox" checked={enrichIds.has(entry.repositoryId)} disabled={!editable} onChange={e => setEnrichIds(previous => { const next = new Set(previous); if (e.target.checked) next.add(entry.repositoryId); else next.delete(entry.repositoryId); return next; })} />{t('aiOrganization.enrichSelection')}</label>}
                    {entry.error && <p role="alert" className="break-words pl-5 text-xs text-destructive">{entry.error}</p>}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </> : <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8">
        <p className="text-sm font-medium">{t('aiOrganization.rangeCount', { count: c.count })}</p>
        {c.rangeSummary && <p className="mt-2 text-xs text-muted-foreground">{t('aiOrganization.rangeSummary', { assigned: c.rangeSummary.assigned, locked: c.rangeSummary.locked })}{c.rangeSummary.fullLibrary && ` · ${t('aiOrganization.crossFilters')}`}</p>}
        <div className="mt-4 divide-y divide-border">{c.scopedRepositories.slice(0, 30).map(r => <div key={r.id} className="py-2 text-xs"><p className="break-all font-medium">{r.full_name}</p><p className="mt-1 line-clamp-2 text-muted-foreground">{r.custom_description || r.ai_summary || r.description}</p></div>)}</div>
        <p className="mt-3 text-xs text-muted-foreground">{t('aiOrganization.confirmBeforeApply')}</p>
      </div>}
      <footer className="shrink-0 space-y-2 border-t border-border bg-background px-4 py-3">
        {draft?.batches.some(b => b.status === 'failed') && <div role="alert" className="max-h-16 overflow-y-auto text-xs text-destructive">{draft.batches.filter(b => b.status === 'failed').map((b, i) => <p key={i}>{b.error}</p>)}</div>}
        {c.proposal?.syncError && <p role="alert" className="text-xs text-destructive">{t('aiOrganization.syncFailed')}</p>}
        {c.busy && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />{t('aiOrganization.working')} {draft ? `${completedCount} / ${entries.length}` : ''}</p>}
        
        {/* Prompt Presets Chips */}
        {!structure && <div className="flex flex-wrap items-center gap-1.5 pb-1">
          <span className="text-[11px] font-medium text-muted-foreground mr-1">
            {isZh ? '快捷预设:' : 'Presets:'} {/* i18n-allow-literal */}
          </span>
          {PROMPT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={c.busy || c.readonly}
              onClick={() => c.setInstruction(isZh ? preset.promptZh : preset.promptEn)}
              className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground transition-all duration-150 hover:border-primary/40 hover:bg-muted/80 hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-50"
            >
              {isZh ? preset.labelZh : preset.labelEn} {/* i18n-allow-literal */}
            </button>
          ))}
        </div>}

        <Textarea aria-label={t('aiOrganization.instruction')} value={c.instruction} onChange={e => c.setInstruction(e.target.value)} disabled={c.busy || c.readonly} maxLength={10000} className="min-h-[60px] resize-none text-sm" placeholder={t('aiOrganization.placeholder')} />
        {draft && <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={c.replaceManual} disabled={c.busy || c.readonly} onChange={e => c.setReplaceManual(e.target.checked)} />{t('aiOrganization.replaceManual')}</label>}
        <div className="flex flex-wrap items-center gap-2">
          {c.busy ? <Button size="sm" variant="outline" onClick={c.stop}><Square className="mr-1 h-3 w-3" />{t('aiOrganization.stop')}</Button>
            : <Button size="sm" variant={draft ? 'outline' : 'default'} disabled={!c.configId || c.readonly || (!draft && !c.count && !structure)} onClick={() => void c.generate()}><Send className="mr-1 h-3 w-3" />{t(structure ? 'aiOrganization.structure.generate' : draft ? 'aiOrganization.refine' : 'aiOrganization.generate')}</Button>}
          {draft && <>
            {(draft.batches.some(b => b.status !== 'complete') || draft.status === 'interrupted') && <Button size="sm" variant="outline" disabled={c.busy || c.readonly} onClick={() => void c.retry()}><RefreshCw className="mr-1 h-3 w-3" />{t('aiOrganization.retry')}</Button>}
            {enrichIds.size > 0 && <Button size="sm" variant="outline" disabled={!editable} onClick={() => void c.enrich([...enrichIds])}>{t('aiOrganization.enrich', { count: enrichIds.size })}</Button>}
            {c.proposal?.syncError && <Button size="sm" variant="outline" disabled={c.busy || c.readonly} onClick={() => void c.retrySync()}>{t('aiOrganization.retrySync')}</Button>}
            <Button size="icon" variant="ghost" className="h-8 w-8" title={t('aiOrganization.continue')} aria-label={t('aiOrganization.continue')} onClick={() => { c.continueInWorkbench(); onOpenChange(false); }}><MessageSquare className="h-4 w-4" /></Button>
            {!structure && draft.status === 'applied' && entries.some(e => e.status === 'success') && <Button size="sm" variant="outline" disabled={c.busy || c.readonly} onClick={() => void c.restore()}><RotateCcw className="mr-1 h-3 w-3" />{t('aiOrganization.restore')}</Button>}

            {/* Staged Apply Button: stream ready batches during background execution */}
            {!structure && isGenerating && readyToApply.length > 0 && (
              <Button
                size="sm"
                className="ml-auto bg-primary text-primary-foreground shadow-xs animate-in fade-in"
                disabled={c.readonly || c.saving}
                onClick={() => void c.apply(readyToApply.map(e => e.repositoryId))}
              >
                {c.saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
                {isZh ? `应用当前已就绪的 ${readyToApply.length} 项变更` : `Apply ${readyToApply.length} Ready Changes`} {/* i18n-allow-literal */}
              </Button>
            )}

            {/* Standard Apply: when generation completes */}
            {!structure && !isGenerating && selected.length > 0 && (
              <Button
                size="sm"
                className="ml-auto"
                disabled={!editable || c.saving}
                onClick={() => void c.apply()}
              >
                {c.saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
                {t('aiOrganization.apply', { count: selected.length })}
              </Button>
            )}
          </>}
        </div>
      </footer>
    </DialogContent>
  </Dialog>;
}
