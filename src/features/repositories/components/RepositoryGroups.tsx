import { useEffect, useMemo, useRef, useState, type ReactNode, type DragEvent } from 'react';
import { Archive, ArrowDown, ArrowUp, BookOpen, ChevronDown, ChevronRight, Code, Folder, GripVertical, MoreHorizontal, Plus, Star, Wrench } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useClassificationStore as useAppStore } from '../../../store/useClassificationStore';
import { useRepositoryDragStore } from '../../../store/useRepositoryDragStore';
import type { Repository } from '../../../types';
import { useT } from '../../../i18n/useT';
import { useDialog } from '../../../hooks/useDialog';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../../components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '../../../components/ui/dropdown-menu';
import { RepositoryGrid } from './RepositoryGrid';
import { moveBefore, orderedIds, replaceGroupOrder } from './repositoryGroupOrder';
import { assignClassificationRepositories, captureClassificationEdit, performClassificationEdit, repositoryIdsFromDrop, type ClassificationEditCapture } from './classificationEditActions';

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
  const dialogs = useDialog();
  const state = useAppStore(useShallow(s => ({
    subcategories: s.subcategories,
    subcategoryOrder: s.subcategoryOrder,
    repositoryOrder: s.repositoryOrder,
    allRepositories: s.repositories,
    reorderGroups: s.reorderSubcategories,
    reorderRepos: s.reorderRepositories,
    scheme: s.activeClassificationScheme ?? 'purpose',
    account: s.user?.id ?? null,
    navigation: s.classificationNavigation,
    setCollapsedGroups: s.setClassificationCollapsedGroups,
  })));
  const groups = useMemo(() => {
    const children = (state.subcategories ?? []).filter(g => g.parentId === categoryId);
    return orderedIds(state.subcategoryOrder ?? [], children.map(g => g.id))
      .map(id => children.find(g => g.id === id)!);
  }, [categoryId, state.subcategories, state.subcategoryOrder]);
  const allCurrent = (state.allRepositories ?? repositories).filter(r => r.category_id === categoryId);
  const collapsed = new Set(state.navigation?.[state.scheme]?.collapsedGroups ?? []);
  const setCollapsed = (change: (previous: Set<string>) => Set<string>) => state.setCollapsedGroups(state.scheme, [...change(collapsed)]);
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState<{ id?: string; name: string; icon: string; capture: ClassificationEditCapture } | null>(null);
  const [editError, setEditError] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const addingCapture = useRef<ClassificationEditCapture | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const headingRefs = useRef(new Map<string, HTMLElement>());
  const canReorder = customSort && !filtered;
  const sections = useMemo(() => [...groups.map(g => ({ ...g, key: g.id })), { id: null, key: `${UNGROUPED}:${categoryId}`, name: t('organization.ungrouped'), icon: '' }], [groups, categoryId, t]);
  const startEditing = (input: { id?: string; name: string; icon: string }) => {
    setEditError(''); setEditing({ ...input, capture: captureClassificationEdit(state.scheme) });
  };
  const startAdding = (id: string) => {
    addingCapture.current = captureClassificationEdit(state.scheme);
    setAddingTo(id); setChosen(new Set()); setQuery(''); setEditError('');
  };
  useEffect(() => { setEditing(null); setAddingTo(null); setEditError(''); }, [state.account, state.scheme, categoryId]);

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
  const moveRepo = async (repository: Repository, target: string | null, before?: number) => {
    const current = groups.some(g => g.id === repository.subcategory_id) ? repository.subcategory_id : null;
    if (current !== target) {
      const captured = captureClassificationEdit(state.scheme);
      if (!await assignClassificationRepositories([repository.id], { categoryId, subcategoryId: target }, dialogs, captured)) return;
      if ((useAppStore.getState().user?.id ?? null) !== captured.expectedAccountId) return;
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
  const moveFromMenu = (repository: Repository, target: string | null, before?: number) => {
    void moveRepo(repository, target, before).catch(error => dialogs.toast(error instanceof Error ? error.message : String(error), 'error'));
  };
  const drop = async (event: DragEvent, target: string | null, before?: number) => {
    setDropTarget(null);
    event.preventDefault();
    event.stopPropagation();
    useRepositoryDragStore.getState().endDrag();
    const group = event.dataTransfer.getData(GROUP_MIME);
    if (group) {
      if (target && groups.some(g => g.id === group)) reorderGroup(group, target);
      return;
    }
    const ids = repositoryIdsFromDrop(event.dataTransfer);
    if (!ids.length || ids.some(id => !allCurrent.some(repository => repository.id === id))) return;
    try {
      if (ids.length === 1) await moveRepo(allCurrent.find(repository => repository.id === ids[0])!, target, before);
      else await assignClassificationRepositories(ids, { categoryId, subcategoryId: target }, dialogs, captureClassificationEdit(state.scheme));
    } catch (error) { dialogs.toast(error instanceof Error ? error.message : String(error), 'error'); }
  };
  const acceptDrag = (event: DragEvent) => {
    if ([...event.dataTransfer.types].some(type => type === REPOSITORY_MIME || type === 'application/x-gsm-repository-ids' || type === GROUP_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  };

  const sectionEntries = useMemo(() => {
    const raw = sections.map((section, index) => {
      const members = repositories.filter(repo => section.id === null
        ? !groups.some(g => g.id === repo.subcategory_id)
        : repo.subcategory_id === section.id);
      return { section, index, members };
    });
    if (filtered && raw.some(entry => entry.members.length > 0)) {
      return raw.filter(entry => entry.members.length > 0);
    }
    return raw;
  }, [sections, repositories, groups, filtered]);

  return (
    <div ref={root} className="min-w-0" onDragEnd={() => setDropTarget(null)}>
      <div className="sticky top-16 z-20 mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-background/95 backdrop-blur-md py-2.5">
        <nav aria-label={t('organization.outline')} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto whitespace-nowrap py-0.5">
          {sectionEntries.map(({ section, members }) => (
            <button type="button" key={section.key} onClick={() => jump(section.key)} aria-current={active === section.key ? 'location' : undefined}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs transition-all ${active === section.key ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'}`}>
              {section.name}{filtered ? ` (${members.length})` : ''}
            </button>
          ))}
        </nav>
        <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs shrink-0" onClick={() => startEditing({ name: '', icon: '📁' })}>
          <Plus className="h-4 w-4" />{t('organization.createGroup')}
        </Button>
      </div>
      {sectionEntries.map(({ section, index, members }) => {
        const ordered = customSort
          ? orderedIds(state.repositoryOrder ?? [], members.map(r => r.id)).map(id => members.find(r => r.id === id)!)
          : members;
        return (
          <section key={section.key} className={`mb-8 min-w-0 transition-colors ${dropTarget === section.key ? 'bg-accent/40 rounded-xl outline outline-2 outline-primary' : ''}`} aria-labelledby={`repository-group-${section.key}`}
            onDragOver={event => { acceptDrag(event); if (event.defaultPrevented) setDropTarget(section.key); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }} onDrop={event => drop(event, section.id)}>
            <div className="mb-4 flex min-w-0 items-center gap-1.5 border-b border-border/50 pb-2.5 pt-1">
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
                className="min-w-0 flex-1 scroll-mt-36 break-words text-sm font-semibold tracking-tight outline-none flex items-center gap-1.5">
                <GroupIcon icon={section.icon} /><span>{section.name}</span> <span className="ml-1 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-normal tabular-nums text-muted-foreground">{members.length}</span>
              </h3>
              {section.id && <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('organization.addExisting')} title={t('organization.addExisting')} onClick={() => startAdding(section.id!)}><Plus className="h-4 w-4" /></Button>}
              {section.id && <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t('organization.groupActions')} title={t('organization.groupActions')}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => startAdding(section.id!)}>{t('organization.addExisting')}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => startEditing({ id: section.id!, name: section.name, icon: section.icon })}>{t('organization.editGroup')}</DropdownMenuItem>
                  <DropdownMenuItem disabled={filtered || index === 0} onSelect={() => reorderGroup(section.id!, groups[index - 1].id)}>{t('organization.moveUp')}</DropdownMenuItem>
                  <DropdownMenuItem disabled={filtered || index >= groups.length - 1} onSelect={() => reorderGroup(groups[index + 1].id, section.id!)}>{t('organization.moveDown')}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void (async () => {
                    try { await performClassificationEdit({ type: 'delete', id: section.id! }, dialogs, captureClassificationEdit(state.scheme)); }
                    catch (error) { dialogs.toast(error instanceof Error ? error.message : String(error), 'error'); }
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
                        {sections.map(destination => <DropdownMenuItem key={destination.key} disabled={destination.id === section.id} onSelect={() => moveFromMenu(repo, destination.id)}>{destination.name}</DropdownMenuItem>)}
                        <DropdownMenuItem disabled={!canReorder || ordered[0]?.id === repo.id}
                          onSelect={() => moveFromMenu(repo, section.id, ordered[ordered.indexOf(repo) - 1]?.id)}>
                          <ArrowUp className="mr-2 h-3.5 w-3.5" />{t('organization.moveUp')}
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={!canReorder || ordered[ordered.length - 1]?.id === repo.id}
                          onSelect={() => { const next = ordered[ordered.indexOf(repo) + 1]; if (next) moveFromMenu(next, section.id, repo.id); }}>
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
          <form className="space-y-4" onSubmit={async event => {
            event.preventDefault();
            if (!editing?.name.trim() || editBusy) return;
            setEditBusy(true); setEditError('');
            try {
              const operation = editing.id ? { type: 'rename' as const, id: editing.id, name: editing.name.trim(), icon: editing.icon }
                : { type: 'create' as const, parentId: categoryId, name: editing.name.trim(), icon: editing.icon };
              if (await performClassificationEdit(operation, dialogs, editing.capture)) setEditing(null);
            } catch (error) { setEditError(error instanceof Error ? error.message : String(error)); }
            finally { setEditBusy(false); }
          }}>
            <label className="block text-sm">{t('organization.groupName')}<input autoFocus required maxLength={80} className="ui-field mt-1 w-full p-2" value={editing?.name ?? ''} onChange={event => setEditing(previous => previous && { ...previous, name: event.target.value })} /></label>
            <fieldset><legend className="mb-2 text-sm">{t('organization.groupIcon')}</legend>
              <div className="flex gap-2">{['folder', 'code', 'book', 'star', 'tool', 'archive'].map(icon => <Button key={icon} type="button" variant="outline" size="icon" title={t(`organization.icon.${icon}`)} aria-label={t(`organization.icon.${icon}`)} aria-pressed={editing?.icon === icon}
                className={editing?.icon === icon ? 'border-primary bg-accent' : ''} onClick={() => setEditing(previous => previous && { ...previous, icon })}><GroupIcon icon={icon} /></Button>)}</div>
            </fieldset>
            {editError && <p role="alert" className="text-xs text-destructive">{editError}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={editBusy} onClick={() => setEditing(null)}>{t('organization.cancel')}</Button><Button type="submit" disabled={editBusy || !editing?.name.trim()}>{t('organization.save')}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={addingTo !== null} onOpenChange={open => { if (!open) setAddingTo(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>{t('organization.addExisting')}</DialogTitle>
          <DialogDescription className="sr-only">{t('organization.currentCategory')}</DialogDescription>
          <input aria-label={t('organization.searchRepositories')} className="ui-field w-full p-2" value={query} onChange={event => setQuery(event.target.value)} />
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {allCurrent.filter(repo => {
              if (repo.subcategory_id === addingTo) return false;
              const q = query.trim().toLowerCase();
              if (!q) return true;
              const summary = (repo.custom_description || repo.ai_summary || repo.description || '').toLowerCase();
              return repo.full_name.toLowerCase().includes(q) || summary.includes(q);
            }).map(repo => {
              const summary = repo.custom_description || repo.ai_summary || repo.description || '';
              const currentGroup = groups.find(g => g.id === repo.subcategory_id);
              return (
                <label key={repo.id} className="flex cursor-pointer items-start gap-2.5 rounded-md border border-transparent p-2 text-sm transition-colors hover:border-border/60 hover:bg-muted/40">
                  <input
                    type="checkbox"
                    aria-label={repo.full_name}
                    className="mt-0.5 shrink-0 accent-primary"
                    checked={chosen.has(repo.id)}
                    onChange={() => setChosen(previous => {
                      const next = new Set(previous);
                      if (next.has(repo.id)) next.delete(repo.id);
                      else next.add(repo.id);
                      return next;
                    })}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="break-all font-medium">{repo.full_name}</span>
                      {currentGroup && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {currentGroup.name}
                        </span>
                      )}
                    </div>
                    {summary && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{summary}</p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
          {editError && <p role="alert" className="text-xs text-destructive">{editError}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" disabled={editBusy} onClick={() => setAddingTo(null)}>{t('organization.cancel')}</Button><Button disabled={editBusy || !chosen.size} onClick={async () => {
            const selected = allCurrent.filter(r => chosen.has(r.id));
            if (!addingTo || !addingCapture.current || !selected.length) return;
            setEditBusy(true); setEditError('');
            try {
              if (!await assignClassificationRepositories(selected.map(repo => repo.id), { categoryId, subcategoryId: addingTo }, dialogs, addingCapture.current)) return;
              if ((useAppStore.getState().user?.id ?? null) !== addingCapture.current.expectedAccountId) return;
              if (canReorder) {
                const global = orderedIds(state.repositoryOrder ?? [], (state.allRepositories ?? repositories).map(r => r.id));
                state.reorderRepos([...global.filter(id => !chosen.has(id)), ...selected.map(r => r.id)]);
              }
              setAddingTo(null);
            } catch (error) { setEditError(error instanceof Error ? error.message : String(error)); }
            finally { setEditBusy(false); }
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
    {repositories.length === 0 && <div className="flex items-center justify-center rounded-lg border border-dashed border-border/60 py-6 text-center text-xs text-muted-foreground">{t('organization.emptyGroup')}</div>}
    {count < repositories.length && <div ref={sentinel} className="py-2"><Button variant="ghost" size="sm" onClick={() => setCount(previous => previous + BATCH)}>{t('organization.loadMore')}</Button></div>}
  </>;
}
