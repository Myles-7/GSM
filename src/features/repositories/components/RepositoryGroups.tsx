import { useEffect, useMemo, useRef, useState, type ReactNode, type DragEvent } from 'react';
import { Archive, ArrowDown, ArrowUp, BookOpen, ChevronDown, ChevronRight, Code, Folder, GripVertical, MoreHorizontal, Plus, Star, Wrench } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import { useRepositoryDragStore } from '../../../store/useRepositoryDragStore';
import type { Repository } from '../../../types';
import { useT } from '../../../i18n/useT';
import { useDialog } from '../../../hooks/useDialog';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../../components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '../../../components/ui/dropdown-menu';
import { RepositoryGrid } from './RepositoryGrid';
import { moveBefore, orderedIds, replaceGroupOrder } from './repositoryGroupOrder';

const REPOSITORY_MIME = 'application/x-gsm-repository-id';
const GROUP_MIME = 'application/x-gsm-subcategory-id';
const UNGROUPED = '__ungrouped__';
const BATCH = 50;

interface Props {
  categoryId: string;
  repositories: Repository[];
  filtered: boolean;
  customSort: boolean;
  viewMode: 'grid' | 'list';
  renderRepository: (repository: Repository, organizationActions?: ReactNode) => ReactNode;
  filterKey?: string;
}

export function RepositoryGroups({ categoryId, repositories, filtered, customSort, viewMode, renderRepository, filterKey = '' }: Props) {
  const t = useT('repositories');
  const { confirm } = useDialog();
  const state = useAppStore(useShallow(s => ({
    subcategories: s.subcategories,
    subcategoryOrder: s.subcategoryOrder,
    repositoryOrder: s.repositoryOrder,
    allRepositories: s.repositories,
    add: s.addSubcategory,
    update: s.updateSubcategory,
    remove: s.deleteSubcategory,
    move: s.moveRepositoryToSubcategory,
    reorderGroups: s.reorderSubcategories,
    reorderRepos: s.reorderRepositories,
  })));
  const groups = useMemo(() => {
    const children = (state.subcategories ?? []).filter(g => g.parentId === categoryId);
    return orderedIds(state.subcategoryOrder ?? [], children.map(g => g.id))
      .map(id => children.find(g => g.id === id)!);
  }, [categoryId, state.subcategories, state.subcategoryOrder]);
  const allCurrent = (state.allRepositories ?? repositories).filter(r => r.category_id === categoryId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState<{ id?: string; name: string; icon: string } | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const headingRefs = useRef(new Map<string, HTMLElement>());
  const canReorder = customSort && !filtered;
  const sections = [...groups.map(g => ({ ...g, key: g.id })), { id: null, key: UNGROUPED, name: t('organization.ungrouped'), icon: '' }];

  useEffect(() => {
    const updateActive = () => {
      const headings = [...headingRefs.current.entries()].sort(([, left], [, right]) =>
        left.getBoundingClientRect().top - right.getBoundingClientRect().top);
      const above = headings.filter(([, node]) => node.getBoundingClientRect().top <= 150);
      setActive((above[above.length - 1] ?? headings[0])?.[0] ?? '');
    };
    updateActive();
    window.addEventListener('scroll', updateActive, { passive: true });
    window.addEventListener('resize', updateActive);
    const observer = new ResizeObserver(updateActive);
    if (root.current) observer.observe(root.current);
    return () => {
      window.removeEventListener('scroll', updateActive);
      window.removeEventListener('resize', updateActive);
      observer.disconnect();
    };
  }, [groups]);

  const jump = (key: string) => {
    setCollapsed(previous => { const next = new Set(previous); next.delete(key); return next; });
    requestAnimationFrame(() => {
      headingRefs.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      headingRefs.current.get(key)?.focus({ preventScroll: true });
    });
  };
  const reorderGroup = (source: string, target: string) => {
    if (filtered) return;
    const all = state.subcategories ?? [];
    const global = orderedIds(state.subcategoryOrder ?? [], all.map(g => g.id));
    state.reorderGroups(replaceGroupOrder(global, moveBefore(groups.map(g => g.id), source, target)));
  };
  const moveRepo = (repository: Repository, target: string | null, before?: number) => {
    const current = groups.some(g => g.id === repository.subcategory_id) ? repository.subcategory_id : null;
    if (current !== target) {
      state.move(repository.id, target);
      // Cross-group moves append only in custom mode. Rule sorts never mutate saved order.
      if (canReorder) {
        const global = orderedIds(state.repositoryOrder ?? [], (state.allRepositories ?? repositories).map(r => r.id));
        const without = global.filter(id => id !== repository.id);
        if (before !== undefined && without.includes(before)) without.splice(without.indexOf(before), 0, repository.id);
        else without.push(repository.id);
        state.reorderRepos(without);
      }
    } else if (canReorder && before !== undefined && before !== repository.id) {
      const global = orderedIds(state.repositoryOrder ?? [], (state.allRepositories ?? repositories).map(r => r.id));
      const members = global.filter(id => repositories.some(r => r.id === id &&
        (groups.some(g => g.id === r.subcategory_id) ? r.subcategory_id : null) === target));
      state.reorderRepos(replaceGroupOrder(global, moveBefore(members, repository.id, before)));
    }
  };
  const drop = (event: DragEvent, target: string | null, before?: number) => {
    setDropTarget(null);
    event.preventDefault();
    event.stopPropagation();
    useRepositoryDragStore.getState().endDrag();
    const group = event.dataTransfer.getData(GROUP_MIME);
    if (group) {
      if (target && groups.some(g => g.id === group)) reorderGroup(group, target);
      return;
    }
    const raw = event.dataTransfer.getData(REPOSITORY_MIME);
    if (!raw) return;
    const repository = allCurrent.find(r => String(r.id) === raw);
    if (repository) moveRepo(repository, target, before);
  };
  const acceptDrag = (event: DragEvent) => {
    if ([...event.dataTransfer.types].some(type => type === REPOSITORY_MIME || type === GROUP_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  };

  return (
    <div ref={root} className="min-w-0" onDragEnd={() => setDropTarget(null)}>
      <div className="sticky top-16 z-10 mb-3 flex flex-wrap items-center gap-2 border-b border-border bg-background py-2">
        <nav aria-label={t('organization.outline')} className="flex min-w-0 flex-1 gap-3 overflow-x-auto whitespace-nowrap py-1">
          {sections.map(section => (
            <button type="button" key={section.key} onClick={() => jump(section.key)} aria-current={active === section.key ? 'location' : undefined}
              className={`shrink-0 text-left text-xs hover:text-foreground ${active === section.key ? 'font-semibold text-foreground underline underline-offset-4' : 'text-muted-foreground'}`}>
              {section.name}
            </button>
          ))}
        </nav>
        <Button variant="ghost" size="sm" onClick={() => setEditing({ name: '', icon: 'folder' })}>
          <Plus className="h-4 w-4" />{t('organization.createGroup')}
        </Button>
      </div>
      {sections.map((section, index) => {
        const members = repositories.filter(repo => section.id === null
          ? !groups.some(g => g.id === repo.subcategory_id)
          : repo.subcategory_id === section.id);
        const ordered = customSort
          ? orderedIds(state.repositoryOrder ?? [], members.map(r => r.id)).map(id => members.find(r => r.id === id)!)
          : members;
        return (
          <section key={section.key} className={`mb-6 min-w-0 transition-colors ${dropTarget === section.key ? 'bg-accent/40 outline outline-2 outline-primary' : ''}`} aria-labelledby={`repository-group-${section.key}`}
            onDragOver={event => { acceptDrag(event); if (event.defaultPrevented) setDropTarget(section.key); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }} onDrop={event => drop(event, section.id)}>
            <div className="mb-3 flex min-w-0 items-center gap-1 border-b border-border py-2">
              {section.id && <button type="button" draggable={!filtered} disabled={filtered} title={t('organization.reorderGroup')} aria-label={t('organization.reorderGroup')}
                className="shrink-0 cursor-grab p-1 text-muted-foreground disabled:opacity-30"
                onDragStart={event => { event.dataTransfer.setData(GROUP_MIME, section.id!); event.dataTransfer.effectAllowed = 'move'; }}
                onKeyDown={event => {
                  if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                  event.preventDefault();
                  if (event.key === 'ArrowUp' && index > 0) reorderGroup(section.id!, groups[index - 1].id);
                  if (event.key === 'ArrowDown' && index < groups.length - 1) reorderGroup(groups[index + 1].id, section.id!);
                }}><GripVertical className="h-4 w-4" /></button>}
              <button type="button" className="p-1" aria-label={collapsed.has(section.key) ? t('organization.expand') : t('organization.collapse')}
                aria-expanded={!collapsed.has(section.key)} onClick={() => setCollapsed(previous => {
                  const next = new Set(previous); if (next.has(section.key)) next.delete(section.key); else next.add(section.key); return next;
                })}>{collapsed.has(section.key) ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
              <h3 id={`repository-group-${section.key}`} tabIndex={-1} ref={node => { if (node) headingRefs.current.set(section.key, node); else headingRefs.current.delete(section.key); }}
                className="min-w-0 flex-1 scroll-mt-36 break-words text-sm font-semibold outline-none">
                <GroupIcon icon={section.icon} />{section.name} <span className="ml-2 font-normal tabular-nums text-muted-foreground">{members.length}</span>
              </h3>
              {section.id && <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('organization.addExisting')} title={t('organization.addExisting')} onClick={() => { setAddingTo(section.id); setChosen(new Set()); setQuery(''); }}><Plus className="h-4 w-4" /></Button>}
              {section.id && <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t('organization.groupActions')} title={t('organization.groupActions')}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => { setAddingTo(section.id); setChosen(new Set()); setQuery(''); }}>{t('organization.addExisting')}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setEditing({ id: section.id!, name: section.name, icon: section.icon })}>{t('organization.editGroup')}</DropdownMenuItem>
                  <DropdownMenuItem disabled={filtered || index === 0} onSelect={() => reorderGroup(section.id!, groups[index - 1].id)}>{t('organization.moveUp')}</DropdownMenuItem>
                  <DropdownMenuItem disabled={filtered || index >= groups.length - 1} onSelect={() => reorderGroup(groups[index + 1].id, section.id!)}>{t('organization.moveDown')}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void (async () => {
                    if (await confirm(t('organization.deleteGroup'), t('organization.deleteGroupConfirm'), { type: 'danger' })) state.remove(section.id!);
                  })()}>{t('organization.deleteGroup')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>}
            </div>
            <GroupBatch repositories={ordered} collapsed={collapsed.has(section.key)} viewMode={viewMode} resetKey={filterKey}
              renderRepository={repo => (
                <div key={repo.id} className="flex h-full min-w-0 flex-col" onDragOver={acceptDrag} onDrop={event => drop(event, section.id, repo.id)}>
                  <div className="flex min-w-0 flex-1 flex-col [&>.repository-card]:flex-1">{renderRepository(repo,
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>{t('organization.moveRepository')}</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {sections.map(destination => <DropdownMenuItem key={destination.key} disabled={destination.id === section.id} onSelect={() => moveRepo(repo, destination.id)}>{destination.name}</DropdownMenuItem>)}
                        <DropdownMenuItem disabled={!canReorder || ordered[0]?.id === repo.id}
                          onSelect={() => moveRepo(repo, section.id, ordered[ordered.indexOf(repo) - 1]?.id)}>
                          <ArrowUp className="mr-2 h-3.5 w-3.5" />{t('organization.moveUp')}
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={!canReorder || ordered[ordered.length - 1]?.id === repo.id}
                          onSelect={() => { const next = ordered[ordered.indexOf(repo) + 1]; if (next) moveRepo(next, section.id, repo.id); }}>
                          <ArrowDown className="mr-2 h-3.5 w-3.5" />{t('organization.moveDown')}
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}</div>
                </div>
              )} />
          </section>
        );
      })}
      <Dialog open={editing !== null} onOpenChange={open => { if (!open) setEditing(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle>{t(editing?.id ? 'organization.editGroup' : 'organization.createGroup')}</DialogTitle>
          <DialogDescription className="sr-only">{t('organization.groupName')}</DialogDescription>
          <form className="space-y-4" onSubmit={event => {
            event.preventDefault();
            if (!editing?.name.trim()) return;
            if (editing.id) state.update(editing.id, { name: editing.name.trim(), icon: editing.icon });
            else state.add({ parentId: categoryId, name: editing.name.trim(), icon: editing.icon });
            setEditing(null);
          }}>
            <label className="block text-sm">{t('organization.groupName')}<input autoFocus required maxLength={80} className="ui-field mt-1 w-full p-2" value={editing?.name ?? ''} onChange={event => setEditing(previous => previous && { ...previous, name: event.target.value })} /></label>
            <fieldset><legend className="mb-2 text-sm">{t('organization.groupIcon')}</legend>
              <div className="flex gap-2">{['folder', 'code', 'book', 'star', 'tool', 'archive'].map(icon => <Button key={icon} type="button" variant="outline" size="icon" title={t(`organization.icon.${icon}`)} aria-label={t(`organization.icon.${icon}`)} aria-pressed={editing?.icon === icon}
                className={editing?.icon === icon ? 'border-primary bg-accent' : ''} onClick={() => setEditing(previous => previous && { ...previous, icon })}><GroupIcon icon={icon} /></Button>)}</div>
            </fieldset>
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setEditing(null)}>{t('organization.cancel')}</Button><Button type="submit" disabled={!editing?.name.trim()}>{t('organization.save')}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={addingTo !== null} onOpenChange={open => { if (!open) setAddingTo(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>{t('organization.addExisting')}</DialogTitle>
          <DialogDescription className="sr-only">{t('organization.currentCategory')}</DialogDescription>
          <input aria-label={t('organization.searchRepositories')} className="ui-field w-full p-2" value={query} onChange={event => setQuery(event.target.value)} />
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {allCurrent.filter(repo => repo.subcategory_id !== addingTo && repo.full_name.toLowerCase().includes(query.toLowerCase())).map(repo => (
              <label key={repo.id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={chosen.has(repo.id)} onChange={() => setChosen(previous => { const next = new Set(previous); if (next.has(repo.id)) next.delete(repo.id); else next.add(repo.id); return next; })} /><span className="break-all">{repo.full_name}</span></label>
            ))}
          </div>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setAddingTo(null)}>{t('organization.cancel')}</Button><Button disabled={!chosen.size} onClick={() => {
            const selected = allCurrent.filter(r => chosen.has(r.id));
            selected.forEach(r => state.move(r.id, addingTo));
            if (canReorder) {
              const global = orderedIds(state.repositoryOrder ?? [], (state.allRepositories ?? repositories).map(r => r.id));
              state.reorderRepos([...global.filter(id => !chosen.has(id)), ...selected.map(r => r.id)]);
            }
            setAddingTo(null);
          }}>{t('organization.addSelected', { count: chosen.size })}</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GroupIcon({ icon }: { icon: string }) {
  const Icon = ({ folder: Folder, code: Code, book: BookOpen, star: Star, tool: Wrench, archive: Archive } as const)[icon as 'folder'];
  return Icon ? <Icon className="mr-1 inline h-4 w-4 shrink-0" aria-hidden="true" /> : icon ? <span className="mr-1">{icon}</span> : null;
}

function GroupBatch({ repositories, collapsed, viewMode, renderRepository, resetKey }: {
  repositories: Repository[]; collapsed: boolean; viewMode: 'grid' | 'list'; renderRepository: (repo: Repository) => ReactNode; resetKey: string;
}) {
  const t = useT('repositories');
  const [count, setCount] = useState(BATCH);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => setCount(BATCH), [resetKey]);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || collapsed || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setCount(previous => Math.min(previous + BATCH, repositories.length));
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [collapsed, count, repositories.length]);
  if (collapsed) return null;
  return <>
    <RepositoryGrid viewMode={viewMode}>{repositories.slice(0, count).map(renderRepository)}</RepositoryGrid>
    {repositories.length === 0 && <p className="py-3 text-xs text-muted-foreground">{t('organization.emptyGroup')}</p>}
    {count < repositories.length && <div ref={sentinel} className="py-2"><Button variant="ghost" size="sm" onClick={() => setCount(previous => previous + BATCH)}>{t('organization.loadMore')}</Button></div>}
  </>;
}
