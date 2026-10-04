import { useState } from 'react';
import { Check, Plus, RotateCcw, Search, Pencil, GitMerge } from 'lucide-react';
import { Button } from './ui/button';
import { useT } from '../i18n/useT';
import { useAppStore } from '../store/useAppStore';
import { organizationCategories } from '../store/helpers/repositoryOrganization';
import { buildStructureChange } from '../services/aiCategoryStructure';
import type { useAIOrganization } from '../hooks/useAIOrganization';
import type { OrganizationStructureOperation } from '../types/aiOrganization';

type Controller = ReturnType<typeof useAIOrganization>;
const field = 'h-8 w-full min-w-0 rounded border border-input bg-background px-2 text-xs';
const icons = ['\u{1F4C1}', '\u{1F4BB}', '\u{1F9E0}', '\u{1F4DA}', '\u{1F527}', '\u{1F4CA}'];
export function CategoryStructurePanel({ controller: c }: { controller: Controller }) {
  const t = useT('repositories');
  const main = useAppStore(s => organizationCategories(s).filter(cat => cat.id !== 'all' && !cat.mergedInto));
  const [kind, setKind] = useState<'create' | 'rename' | 'merge'>('create');
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(icons[0]);
  const [targetId, setTarget] = useState('');
  const [sources, setSources] = useState<string[]>([]);
  const [review, setReview] = useState<{ id: string; updatedAt: string } | null>(null);
  const [enrichIds, setEnrichIds] = useState<number[]>([]);
  const [mobileTab, setMobileTab] = useState('draft');
  const draft = c.proposal?.organization;
  const operations = draft?.structureOperations ?? [];
  const editable = !c.busy && !c.readonly;
  const byId = new Map(c.repositories.map(r => [r.id, r]));
  const label = (id: string | null) => draft?.categories.find(cat => cat.id === id)?.name ?? main.find(cat => cat.id === id)?.name ?? t('aiOrganization.pending');
  const impact = (op: OrganizationStructureOperation) => {
    if (!c.proposal) return { error: '', removed: [], hidden: [] };
    try {
      const result = buildStructureChange(c.proposal, op.id);
      return { error: '', removed: result.expected.customCategories.filter(cat => !result.next.customCategories.some(next => next.id === cat.id)).map(cat => cat.name),
        hidden: result.next.hiddenDefaultCategoryIds.filter(id => !result.expected.hiddenDefaultCategoryIds.includes(id)).map(label) };
    } catch (e) { return { error: e instanceof Error ? e.message : String(e), removed: [], hidden: [] }; }
  };
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 gap-1 border-b p-2 md:hidden">
      {['edit', 'draft'].map(tab => <Button key={tab} size="sm" variant={mobileTab === tab ? 'secondary' : 'ghost'} onClick={() => setMobileTab(tab)}>{t(`aiOrganization.structure.${tab}`)}</Button>)}
    </div>
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className={`${mobileTab === 'edit' ? 'block' : 'hidden'} w-full min-w-0 shrink-0 space-y-3 overflow-x-hidden overflow-y-auto border-r p-4 md:block md:w-64`}>
        <div className="flex gap-1" role="group" aria-label={t('aiOrganization.structure.action')}>
          {(['create', 'rename', 'merge'] as const).map(value => <Button key={value} size="sm" className="h-8 flex-1 px-2" variant={kind === value ? 'secondary' : 'ghost'} disabled={!editable} onClick={() => { setKind(value); setTarget(''); setName(''); setSources([]); }}>
            {value === 'create' ? <Plus className="mr-1 h-3 w-3" /> : value === 'rename' ? <Pencil className="mr-1 h-3 w-3" /> : <GitMerge className="mr-1 h-3 w-3" />}{t(`aiOrganization.structure.${value}`)}</Button>)}
        </div>
        {kind !== 'create' && <label className="block space-y-1 text-xs">{t('aiOrganization.structure.target')}
          <select aria-label={t('aiOrganization.structure.target')} className={field} value={targetId} disabled={!editable} onChange={e => { setTarget(e.target.value); const cat = main.find(cat => cat.id === e.target.value); setName(cat?.name ?? ''); setIcon(cat?.icon ?? icons[0]); setSources(ids => ids.filter(id => id !== e.target.value)); }}>
            <option value="">{t(kind === 'merge' ? 'aiOrganization.structure.newTarget' : 'aiOrganization.structure.choose')}</option>
            {main.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
        </label>}
        <label className="block space-y-1 text-xs">{t('aiOrganization.structure.name')}<input aria-label={t('aiOrganization.structure.name')} className={field} value={name} maxLength={120} disabled={!editable || (kind === 'merge' && !!targetId)} onChange={e => setName(e.target.value)} /></label>
        {(kind !== 'merge' || !targetId) && <div className="flex flex-wrap gap-1" role="group" aria-label={t('aiOrganization.structure.icon')}>
          {icons.map(value => <button key={value} type="button" className={`h-8 w-8 rounded border ${value === icon ? 'border-primary bg-accent' : 'border-transparent'}`} aria-pressed={value === icon} aria-label={value} title={value} disabled={!editable} onClick={() => setIcon(value)}>{value}</button>)}
        </div>}
        {kind === 'merge' && <fieldset className="min-w-0 space-y-2"><legend className="mb-2 text-xs font-medium">{t('aiOrganization.structure.sources')}</legend>
          {main.filter(cat => cat.id !== targetId).map(cat => <label key={cat.id} className="flex items-start gap-2 text-xs"><input type="checkbox" checked={sources.includes(cat.id)} disabled={!editable} onChange={e => setSources(ids => e.target.checked ? [...ids, cat.id] : ids.filter(id => id !== cat.id))} /><span className="break-words">{cat.name}<span className="ml-1 text-muted-foreground">({c.repositories.filter(r => r.category_id === cat.id).length})</span></span></label>)}
        </fieldset>}
        <Button size="sm" className="w-full" disabled={!editable || !name.trim() || (kind === 'rename' && !targetId) || (kind === 'merge' && !sources.length)} onClick={async () => {
          await c.addStructure({ kind, targetId: targetId || null, sourceIds: sources, name, icon }); setMobileTab('draft');
        }}><Plus className="mr-1 h-3 w-3" />{t('aiOrganization.structure.add')}</Button>
        <p className="text-xs leading-5 text-muted-foreground">{t('aiOrganization.structure.fullScope')}</p>
      </aside>
      <section className={`${mobileTab === 'draft' ? 'block' : 'hidden'} min-h-0 min-w-0 flex-1 overflow-y-auto md:block`}>
        {!operations.length && <p className="p-6 text-sm text-muted-foreground">{t('aiOrganization.structure.empty')}</p>}
        {operations.map(op => {
          const entries = draft!.entries.filter(e => op.members.some(m => m.repositoryId === e.repositoryId));
          const unresolved = entries.filter(e => e.disposition === 'insufficient' || (e.disposition === 'move' && !e.selected) || (e.before.locked && e.before.categoryId !== e.categoryId && !e.overrideLocked)).length;
          const checked = review?.id === op.id && review.updatedAt === c.proposal?.updatedAt;
          const preview = checked && op.status === 'pending' ? impact(op) : null;
          return <section key={op.id} className="space-y-3 border-b p-4" data-structure-operation={op.id}>
            <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">{t(`aiOrganization.structure.${op.kind}`)}</span><h3 className="min-w-0 flex-1 break-words text-sm font-semibold">{op.sourceIds.length ? `${op.sourceIds.map(label).join(' + ')} → ` : op.kind === 'rename' ? `${label(op.targetId)} → ` : ''}{op.name}</h3><span className="text-xs">{t(`aiOrganization.status.${op.status}`)}</span></div>
            {op.reason && <p className="text-xs leading-5 text-muted-foreground">{op.reason}</p>}
            {op.status === 'pending' && <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_60px]">
              <input aria-label={t('aiOrganization.structure.operationName')} className={field} defaultValue={op.name} key={`${op.id}:${op.name}`} maxLength={120} disabled={!editable || (op.kind === 'merge' && !draft!.categories.find(cat => cat.id === op.targetId)?.isNew)} onBlur={e => { if (e.target.value.trim() && e.target.value.trim() !== op.name) void c.editStructure(op.id, { name: e.target.value.trim() }); }} />
              <select aria-label={t('aiOrganization.structure.icon')} className={field} value={op.icon} disabled={!editable || (op.kind === 'merge' && !draft!.categories.find(cat => cat.id === op.targetId)?.isNew)} onChange={e => void c.editStructure(op.id, { icon: e.target.value })}>
                {!icons.includes(op.icon) && <option value={op.icon}>{op.icon}</option>}{icons.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>}
            {op.kind === 'merge' && <>
              <p className="text-xs">{t('aiOrganization.structure.impact', { count: op.members.length, locked: op.members.filter(m => m.before.locked && m.before.categoryId !== op.targetId).length, unresolved })}</p>
              <label className="block space-y-1 text-xs">{t('aiOrganization.structure.keywords')}
                <input className={field} aria-label={t('aiOrganization.structure.keywords')} defaultValue={op.keywords.join(', ')} key={`${op.id}:${op.keywords.join(',')}`} disabled={!editable || op.status !== 'pending'} onBlur={e => { const words = [...new Set(e.target.value.split(/[,，]/).map(w => w.trim()).filter(Boolean))]; if (words.join(',') !== op.keywords.join(',')) void c.editStructure(op.id, { keywords: words }); }} />
              </label>
              <div className="divide-y border-y">
                {entries.map(entry => <article key={entry.repositoryId} className="space-y-2 py-3" data-organization-repository={entry.repositoryId}>
                  <div className="flex items-start gap-2"><input type="checkbox" aria-label={t('aiOrganization.selectRepository', { name: byId.get(entry.repositoryId)?.full_name ?? entry.repositoryId })} checked={entry.selected} disabled={!editable || entry.status !== 'pending' || entry.disposition !== 'move' || (entry.before.locked && entry.before.categoryId !== entry.categoryId && !entry.overrideLocked)} onChange={e => void c.editEntry(entry.repositoryId, { selected: e.target.checked })} /><span className="min-w-0 flex-1 break-all text-xs font-medium">{byId.get(entry.repositoryId)?.full_name ?? entry.repositoryId}</span><span className="text-xs text-muted-foreground">{t(`aiOrganization.status.${entry.status === 'pending' ? entry.disposition : entry.status}`)}</span></div>
                  <div className="grid min-w-0 gap-2 text-xs sm:grid-cols-2"><span className="break-words text-muted-foreground">{label(entry.before.categoryId)} / {entry.before.subcategoryId ? label(entry.before.subcategoryId) : t('organization.ungrouped')} → {op.name}</span>
                    <select className={field} aria-label={t('aiOrganization.structure.subcategory', { name: byId.get(entry.repositoryId)?.name ?? entry.repositoryId })} value={entry.categoryId === op.targetId ? entry.subcategoryId ?? '' : '__unresolved'} disabled={!editable || entry.status !== 'pending'} onChange={e => void c.editEntry(entry.repositoryId, { categoryId: op.targetId, subcategoryId: e.target.value || null })}>
                      <option value="__unresolved" disabled>{t('aiOrganization.structure.unresolved')}</option><option value="">{t('organization.ungrouped')}</option>
                      {draft!.categories.filter(cat => cat.parentId === op.targetId).map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                    </select>
                  </div>
                  {entry.reason && <p className="text-xs leading-5 text-muted-foreground">{entry.reason}</p>}
                  {entry.before.locked && entry.before.categoryId !== op.targetId && <label className="flex items-start gap-2 text-xs text-destructive"><input type="checkbox" disabled={!editable || entry.status !== 'pending'} checked={entry.overrideLocked} onChange={e => void c.editEntry(entry.repositoryId, { overrideLocked: e.target.checked })} />{t('aiOrganization.overrideLock')}</label>}
                  {entry.disposition === 'insufficient' && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" className="h-7 text-xs" disabled={!editable} onClick={() => void c.acceptOriginalGroup(entry.repositoryId)}>{t('aiOrganization.structure.acceptOriginal')}</Button><label className="flex items-center gap-1 text-xs"><input type="checkbox" disabled={!editable} checked={enrichIds.includes(entry.repositoryId)} onChange={e => setEnrichIds(ids => e.target.checked ? [...ids, entry.repositoryId] : ids.filter(id => id !== entry.repositoryId))} />{t('aiOrganization.enrichSelection')}</label></div>}
                </article>)}
              </div>
            </>}
            {op.error && <p role="alert" className="break-words text-xs text-destructive">{op.error}</p>}
            {preview && <div className="space-y-2 border-l-2 border-primary pl-3 text-xs">
              <p>{t('aiOrganization.structure.reviewSummary', { count: op.members.length })}</p>
              {preview.removed.length > 0 && <p>{t('aiOrganization.structure.removed', { names: preview.removed.join(', ') })}</p>}
              {preview.hidden.length > 0 && <p>{t('aiOrganization.structure.hidden', { names: preview.hidden.join(', ') })}</p>}
              {preview.error && <p role="alert" className="break-words text-destructive">{preview.error}</p>}
            </div>}
            <div className="flex flex-wrap gap-2">
              {op.status === 'pending' && <><Button size="sm" variant="outline" disabled={!editable} onClick={() => setReview({ id: op.id, updatedAt: c.proposal!.updatedAt })}><Search className="mr-1 h-3 w-3" />{t('aiOrganization.structure.review')}</Button>
                {checked && <Button size="sm" disabled={!editable || !!preview?.error || unresolved > 0} onClick={() => void c.applyStructure(op.id)}><Check className="mr-1 h-3 w-3" />{t(`aiOrganization.structure.confirm.${op.kind}`)}</Button>}
              </>}
              {op.status === 'success' && <Button size="sm" variant="outline" disabled={!editable} onClick={() => void c.restoreStructure(op.id)}><RotateCcw className="mr-1 h-3 w-3" />{t('aiOrganization.structure.restore')}</Button>}
            </div>
          </section>;
        })}
        {enrichIds.length > 0 && <Button size="sm" variant="outline" className="m-4" disabled={!editable || !c.configId} onClick={() => void c.enrich(enrichIds)}>{t('aiOrganization.enrich', { count: enrichIds.length })}</Button>}
        {draft?.entries.some(e => e.status === 'pending' && e.selected && e.disposition === 'move') && <div className="space-y-2 border-t p-4"><p className="text-xs text-muted-foreground">{t('aiOrganization.structure.partialNotice')}</p><Button size="sm" variant="outline" disabled={!editable} onClick={() => void c.migrateSelected()}>{t('aiOrganization.structure.partial')}</Button></div>}
      </section>
    </div>
  </div>;
}
