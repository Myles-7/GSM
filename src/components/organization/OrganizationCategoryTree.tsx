import { useState } from 'react';
import { BookOpen, Brain, ChevronDown, ChevronRight, Code2, Folder, GitMerge, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Wrench } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { useT } from '../../i18n/useT';
import type { OrganizationController } from '../DualOrganizationWizard';
import type { OrganizationCategory } from '../../types/aiOrganization';
import type { CategoryTreeEdit } from '../../services/aiOrganizationTree';
import { categorySubgroupLabel } from './categoryTreePresentation';

type Editor = { kind: 'create' | 'rename' | 'merge'; id?: string; parentId?: string | null };
const icons = [{ id: 'folder', Icon: Folder }, { id: 'code', Icon: Code2 }, { id: 'brain', Icon: Brain }, { id: 'book', Icon: BookOpen }, { id: 'wrench', Icon: Wrench }];
export function OrganizationCategoryTree({ controller: c, categories, selectedId, onSelect, count, editable = true }: {
  controller: OrganizationController; categories: OrganizationCategory[]; selectedId: string | null; onSelect: (id: string | null) => void;
  count: (id: string | null) => number; editable?: boolean;
}) {
  const t = useT('repositories'); const [query, setQuery] = useState(''); const [collapsed, setCollapsed] = useState(new Set<string>());
  const [editor, setEditor] = useState<Editor | null>(null); const [name, setName] = useState(''); const [icon, setIcon] = useState('folder');
  const [target, setTarget] = useState(''); const [sources, setSources] = useState<string[]>([]);
  const scheme = c.proposal?.organization?.dual?.schemes[c.reviewScheme]; const operations = scheme?.structureOperations ?? [];
  const mainOrder = scheme?.before.categoryOrder ?? categories.filter(cat => !cat.parentId).map(cat => cat.id);
  const priority = (id: string) => mainOrder.includes(id) ? mainOrder.indexOf(id) : mainOrder.length + (operations.some(op => ['pending', 'conflict'].includes(op.status) && [op.targetId, ...op.sourceIds].includes(id)) ? 0 : count(id) ? 1 : 2);
  const ordered = [...categories].sort((a, b) => priority(a.parentId ?? a.id) - priority(b.parentId ?? b.id));
  const unused = new Set(ordered.filter(cat => !cat.parentId && !count(cat.id) && !operations.some(op => [op.targetId, ...op.sourceIds].includes(cat.id))).map(cat => cat.id));
  const available = editable && !c.busy && !c.readonly; const disabled = !available;
  const openEditor = (next: Editor) => {
    const cat = categories.find(cat => cat.id === next.id); setEditor(next); setName(next.kind === 'rename' ? cat?.name ?? '' : ''); setIcon(cat?.icon ?? 'folder'); setTarget(''); setSources(next.kind === 'merge' && next.id ? [next.id] : []);
  };
  const save = async () => {
    if (!editor) return;
    const edit: CategoryTreeEdit = editor.kind === 'merge' ? { kind: 'merge', sourceIds: sources, targetId: target || undefined, name, icon }
      : { kind: editor.kind, targetId: editor.id, parentId: editor.parentId, name, icon };
    if (await c.editTree(c.reviewScheme, edit)) setEditor(null);
  };
  const form = <div className="space-y-3 border-y py-3" data-category-tree-editor>
    <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{t(`categoryTree.${editor?.kind ?? 'create'}`)}</span><Button variant="ghost" size="sm" className="h-6 px-1 text-xs" onClick={() => setEditor(null)}>{t('organizationUx.cancel')}</Button></div>
    {editor?.kind === 'merge' && <><label className="block space-y-1 text-xs"><span>{t('aiOrganization.structure.target')}</span><select className="h-8 w-full min-w-0 rounded-md border bg-background px-2" value={target} onChange={e => { setTarget(e.target.value); setSources(old => old.filter(id => id !== e.target.value)); }}><option value="">{t('aiOrganization.structure.newTarget')}</option>{categories.filter(cat => !cat.parentId).map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></label><div className="max-h-40 space-y-2 overflow-y-auto"><p className="text-xs text-muted-foreground">{t('aiOrganization.structure.sources')}</p>{categories.filter(cat => !cat.parentId && cat.id !== target).map(cat => <label key={cat.id} className="flex items-start gap-2 text-xs"><input type="checkbox" checked={sources.includes(cat.id)} onChange={e => setSources(old => e.target.checked ? [...old, cat.id] : old.filter(id => id !== cat.id))} /><span className="min-w-0 flex-1 break-words">{cat.name}</span><span className="text-muted-foreground">{count(cat.id)}</span></label>)}</div></>}
    {!(editor?.kind === 'merge' && target) && <><label className="block space-y-1 text-xs"><span>{t('aiOrganization.structure.name')}</span><Input autoFocus value={name} maxLength={120} className="h-8 text-sm" onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && name.trim()) { e.preventDefault(); void save(); } }} /></label><details className="text-xs"><summary className="cursor-pointer text-muted-foreground">{t('aiOrganization.structure.icon')}</summary><div className="mt-2 flex gap-1">{icons.map(({ id, Icon }) => <Button key={id} type="button" variant={id === icon ? 'secondary' : 'ghost'} size="icon" className="h-7 w-7" aria-label={t(`categoryTree.icons.${id}`)} title={t(`categoryTree.icons.${id}`)} aria-pressed={id === icon} onClick={() => setIcon(id)}><Icon className="h-4 w-4" /></Button>)}</div></details></>}
    {editor?.kind === 'merge' && <p className="text-xs leading-5 text-muted-foreground">{t('categoryTree.mergeMapping')}</p>}
    <Button size="sm" className="h-8 w-full text-xs" disabled={disabled || (!target && !name.trim()) || editor?.kind === 'merge' && !sources.length} onClick={() => void save()}>{t('categoryTree.addDraft')}</Button>
  </div>;
  const matches = (cat: OrganizationCategory) => !query || cat.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) || categories.some(child => child.parentId === cat.id && child.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const tree = (parentId: string | null, onlyUnused = false): React.ReactNode => ordered.filter(cat => cat.parentId === parentId && matches(cat) && (parentId || query || unused.has(cat.id) === onlyUnused)).map(cat => {
    const op = operations.find(op => ['pending', 'conflict'].includes(op.status) && (op.targetId === cat.id || op.sourceIds.includes(cat.id)));
    const source = op?.kind === 'merge' && op.sourceIds.includes(cat.id); const children = categories.some(child => child.parentId === cat.id);
    return <div key={cat.id} className={parentId ? 'ml-3 border-l pl-2' : 'mt-1'} data-tree-category={cat.id}>
      <div className="flex min-w-0 items-center gap-0.5">{!parentId && <Button size="icon" variant="ghost" className={`h-6 w-6 shrink-0 ${children ? '' : 'invisible'}`} aria-label={t(collapsed.has(cat.id) ? 'dualOrganization.expand' : 'dualOrganization.collapse', { name: cat.name })} aria-expanded={!collapsed.has(cat.id)} onClick={() => setCollapsed(old => { const next = new Set(old); if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id); return next; })}>{collapsed.has(cat.id) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</Button>}
        <button type="button" aria-pressed={selectedId === cat.id} onClick={() => onSelect(selectedId === cat.id ? null : cat.id)} className={`flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent ${selectedId === cat.id ? 'bg-accent font-medium' : parentId || source ? 'text-muted-foreground' : 'font-medium'}`}><Folder className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 break-words">{categorySubgroupLabel(cat, scheme)}{op && <span className="ml-1.5 inline-block text-[10px] font-normal text-primary">{t(source ? 'categoryTree.mergeSource' : op.kind === 'create' && parentId ? 'categoryTree.createChild' : `categoryTree.${op.kind}`)}</span>}</span><span className="shrink-0 text-xs font-normal text-muted-foreground">{count(cat.id)}</span></button>
        {available && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('categoryTree.actions', { name: cat.name })} title={t('categoryTree.actions', { name: cat.name })}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onSelect={() => openEditor({ kind: 'rename', id: cat.id })}><Pencil className="mr-2 h-3.5 w-3.5" />{t('categoryTree.rename')}</DropdownMenuItem>{!parentId && <><DropdownMenuItem onSelect={() => openEditor({ kind: 'create', parentId: cat.id })}><Plus className="mr-2 h-3.5 w-3.5" />{t('categoryTree.createChild')}</DropdownMenuItem><DropdownMenuItem onSelect={() => openEditor({ kind: 'merge', id: cat.id })}><GitMerge className="mr-2 h-3.5 w-3.5" />{t('categoryTree.merge')}</DropdownMenuItem></>}{op && <DropdownMenuItem onSelect={() => void c.editTree(c.reviewScheme, { kind: 'withdraw', operationId: op.id })}><RotateCcw className="mr-2 h-3.5 w-3.5" />{t('categoryTree.withdraw')}</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>}
      </div>
      {editor?.id === cat.id && form}{editor?.kind === 'create' && editor.parentId === cat.id && <div className="ml-6">{form}</div>}
      {!parentId && (!collapsed.has(cat.id) || query) && tree(cat.id)}
    </div>;
  });
  return <>
    <div className="flex items-center gap-2 px-1"><h2 className="min-w-0 flex-1 text-sm font-semibold">{t('organizationUx.categoryPreview')}</h2>{available && <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={t('categoryTree.create')} title={t('categoryTree.create')} onClick={() => openEditor({ kind: 'create' })}><Plus className="h-4 w-4" /></Button>}</div>
    <p className="mt-1 px-1 text-xs text-muted-foreground">{t('organizationUx.treeCount', { main: categories.filter(cat => !cat.parentId).length, sub: categories.filter(cat => cat.parentId).length })}</p>
    <div className="relative my-3"><Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input className="h-8 pl-8 text-xs" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('categoryTree.search')} aria-label={t('categoryTree.search')} /></div>
    {editor?.kind === 'create' && !editor.parentId && form}
    <button type="button" aria-pressed={!selectedId} className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-accent ${!selectedId ? 'bg-accent font-medium' : ''}`} onClick={() => onSelect(null)}>{t(scheme ? 'dualOrganization.all' : 'categoryTree.allRepositories')}<span className="text-xs font-normal text-muted-foreground">{count(null)}</span></button>
    {tree(null)}{!query && !!unused.size && <details className="mt-3 border-t pt-3"><summary className="cursor-pointer text-xs text-muted-foreground">{t('categoryTree.unused', { count: unused.size })}</summary>{tree(null, true)}</details>}{!categories.length && <p className="px-1 py-6 text-xs leading-5 text-muted-foreground">{t('categoryTree.empty')}</p>}
  </>;
}
