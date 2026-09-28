import { useState } from 'react';
import { Check, FolderTree, Loader2, MessageSquare, Pencil, Plus, RefreshCw, RotateCcw, Send, Square } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Textarea } from '../../../components/ui/textarea';
import { useT } from '../../../i18n/useT';
import type { useAIOrganization } from '../hooks/useAIOrganization';

type Controller = ReturnType<typeof useAIOrganization>;
const selectClass = 'h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-xs';
export function AIOrganizationPanel({ open, onOpenChange, controller: c }: { open: boolean; onOpenChange: (open: boolean) => void; controller: Controller }) {
  const t = useT('repositories');
  const [filter, setFilter] = useState('all');
  const [mobileTab, setMobileTab] = useState('repositories');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [enrichIds, setEnrichIds] = useState<Set<number>>(new Set());
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const draft = c.proposal?.organization;
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
  const visible = entries.filter(e => (filter === 'all' || e.disposition === filter)
    && (!categoryFilter || e.categoryId === categoryFilter || e.subcategoryId === categoryFilter));
  const completed = draft?.batches.filter(b => b.status === 'complete').reduce((n, b) => n + b.repositoryIds.length, 0) ?? 0;
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
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        {!draft ? <select aria-label={t('aiOrganization.scopeLabel')} className={selectClass} value={c.scope} onChange={e => c.setScope(e.target.value as Controller['scope'])} disabled={c.busy}>
          {c.scopeOptions.map(o => <option key={o.value} value={o.value}>{o.label} ({o.count})</option>)}
        </select> : <>
          <select aria-label={t('aiOrganization.version')} className={selectClass} value={c.proposal!.id} onChange={e => c.selectVersion(e.target.value)} disabled={c.busy}>
            {c.versions.map(v => <option key={v.id} value={v.id}>{t('aiOrganization.revision', { count: v.organization!.revision })}</option>)}
          </select>
          <span className="text-xs text-muted-foreground">{completed} / {entries.length}</span>
        </>}
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
      {c.error && <p role="alert" className="shrink-0 break-words border-b px-4 py-2 text-xs text-destructive">{c.error}</p>}
      {c.readonly && <p className="shrink-0 px-4 py-2 text-xs text-muted-foreground">{t('aiOrganization.readonly')}</p>}
      {draft ? <>
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
              {['all', 'move', 'insufficient', 'unchanged'].map(value => <Button key={value} size="sm" variant={filter === value ? 'secondary' : 'ghost'} aria-pressed={filter === value} className="h-7 px-2 text-xs" onClick={() => setFilter(value)}>{t(`aiOrganization.filter.${value}`)}</Button>)}
              {categoryFilter && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCategoryFilter(null)}>{t('aiOrganization.clearFilter')}</Button>}
            </div>
            <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
              {!visible.length && <p className="p-6 text-center text-sm text-muted-foreground">{t('aiOrganization.empty')}</p>}
              {visible.map(entry => <article key={entry.repositoryId} className="space-y-2 px-4 py-3" data-organization-repository={entry.repositoryId}>
                <div className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1 shrink-0" checked={entry.selected} disabled={!editable || entry.disposition !== 'move' || entry.status !== 'pending' || (entry.before.locked && entry.categoryId !== entry.before.categoryId && !entry.overrideLocked)}
                    aria-label={t('aiOrganization.selectRepository', { name: repoMap.get(entry.repositoryId)?.full_name ?? entry.repositoryId })}
                    onChange={e => void c.editEntry(entry.repositoryId, { selected: e.target.checked })} />
                  <span className="min-w-0 flex-1 break-all text-sm font-medium">{repoMap.get(entry.repositoryId)?.full_name ?? entry.repositoryId}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{t(`aiOrganization.status.${entry.status === 'pending' ? entry.disposition : entry.status}`)}</span>
                </div>
                <div className="grid min-w-0 gap-1 pl-5 text-xs sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                  <span className="break-words text-muted-foreground">{targetLabel(entry.before.categoryId, entry.before.subcategoryId)}</span><span aria-hidden="true">→</span>
                  <select className={`${selectClass} w-full`} aria-label={t('aiOrganization.destination', { name: repoMap.get(entry.repositoryId)?.name ?? entry.repositoryId })}
                    disabled={!editable || entry.status !== 'pending'} value={entry.subcategoryId || entry.categoryId || ''}
                    onChange={e => { const target = categories.find(g => g.id === e.target.value); void c.editEntry(entry.repositoryId, { categoryId: target?.parentId ?? target?.id ?? null, subcategoryId: target?.parentId ? target.id : null }); }}>
                    <option value="">{t('aiOrganization.pending')}</option>
                    {categories.map(category => <option key={category.id} value={category.id}>{targetLabel(category.parentId ?? category.id, category.parentId ? category.id : null)}</option>)}
                  </select>
                </div>
                {entry.reason && <p className="break-words pl-5 text-xs leading-5 text-muted-foreground">{entry.reason}</p>}
                {entry.before.locked && entry.categoryId !== entry.before.categoryId && <label className="flex items-start gap-2 pl-5 text-xs text-destructive"><input type="checkbox" checked={entry.overrideLocked} disabled={!editable} onChange={e => void c.editEntry(entry.repositoryId, { overrideLocked: e.target.checked })} />{t('aiOrganization.overrideLock')}</label>}
                {entry.disposition === 'insufficient' && <label className="flex items-center gap-2 pl-5 text-xs"><input type="checkbox" checked={enrichIds.has(entry.repositoryId)} disabled={!editable} onChange={e => setEnrichIds(previous => { const next = new Set(previous); if (e.target.checked) next.add(entry.repositoryId); else next.delete(entry.repositoryId); return next; })} />{t('aiOrganization.enrichSelection')}</label>}
                {entry.error && <p role="alert" className="break-words pl-5 text-xs text-destructive">{entry.error}</p>}
              </article>)}
            </div>
          </section>
        </div>
      </> : <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8">
        <p className="text-sm font-medium">{t('aiOrganization.rangeCount', { count: c.count })}</p>
        <div className="mt-4 divide-y divide-border">{c.scopedRepositories.slice(0, 30).map(r => <div key={r.id} className="py-2 text-xs"><p className="break-all font-medium">{r.full_name}</p><p className="mt-1 line-clamp-2 text-muted-foreground">{r.custom_description || r.ai_summary || r.description}</p></div>)}</div>
        <p className="mt-3 text-xs text-muted-foreground">{t('aiOrganization.confirmBeforeApply')}</p>
      </div>}
      <footer className="shrink-0 space-y-2 border-t border-border bg-background px-4 py-3">
        {draft?.batches.some(b => b.status === 'failed') && <div role="alert" className="max-h-16 overflow-y-auto text-xs text-destructive">{draft.batches.filter(b => b.status === 'failed').map((b, i) => <p key={i}>{b.error}</p>)}</div>}
        {c.proposal?.syncError && <p role="alert" className="text-xs text-destructive">{t('aiOrganization.syncFailed')}</p>}
        {c.busy && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />{t('aiOrganization.working')} {draft ? `${completed} / ${entries.length}` : ''}</p>}
        <Textarea aria-label={t('aiOrganization.instruction')} value={c.instruction} onChange={e => c.setInstruction(e.target.value)} disabled={c.busy || c.readonly} maxLength={10000} className="min-h-[60px] resize-none text-sm" placeholder={t('aiOrganization.placeholder')} />
        {draft && <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={c.replaceManual} disabled={c.busy || c.readonly} onChange={e => c.setReplaceManual(e.target.checked)} />{t('aiOrganization.replaceManual')}</label>}
        <div className="flex flex-wrap items-center gap-2">
          {c.busy ? <Button size="sm" variant="outline" onClick={c.stop}><Square className="mr-1 h-3 w-3" />{t('aiOrganization.stop')}</Button>
            : <Button size="sm" variant={draft ? 'outline' : 'default'} disabled={!c.configId || c.readonly || (!draft && !c.count)} onClick={() => void c.generate()}><Send className="mr-1 h-3 w-3" />{t(draft ? 'aiOrganization.refine' : 'aiOrganization.generate')}</Button>}
          {draft && <>
            {(draft.batches.some(b => b.status !== 'complete') || draft.status === 'interrupted') && <Button size="sm" variant="outline" disabled={!editable} onClick={() => void c.retry()}><RefreshCw className="mr-1 h-3 w-3" />{t('aiOrganization.retry')}</Button>}
            {enrichIds.size > 0 && <Button size="sm" variant="outline" disabled={!editable} onClick={() => void c.enrich([...enrichIds])}>{t('aiOrganization.enrich', { count: enrichIds.size })}</Button>}
            {c.proposal?.syncError && <Button size="sm" variant="outline" disabled={c.busy || c.readonly} onClick={() => void c.retrySync()}>{t('aiOrganization.retrySync')}</Button>}
            <Button size="icon" variant="ghost" className="h-8 w-8" title={t('aiOrganization.continue')} aria-label={t('aiOrganization.continue')} onClick={() => { c.continueInWorkbench(); onOpenChange(false); }}><MessageSquare className="h-4 w-4" /></Button>
            {draft.status === 'applied' && entries.some(e => e.status === 'success') && <Button size="sm" variant="outline" disabled={c.busy || c.readonly} onClick={() => void c.restore()}><RotateCcw className="mr-1 h-3 w-3" />{t('aiOrganization.restore')}</Button>}
            {selected.length > 0 && <Button size="sm" className="ml-auto" disabled={!editable} onClick={() => void c.apply()}><Check className="mr-1 h-3 w-3" />{t('aiOrganization.apply', { count: selected.length })}</Button>}
          </>}
        </div>
      </footer>
    </DialogContent>
  </Dialog>;
}
