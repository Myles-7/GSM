import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useClassificationStore } from '../store/useClassificationStore';
import { useRepositoryDragStore } from '../store/useRepositoryDragStore';
import { useDialog } from '../hooks/useDialog';
import { assignClassificationRepositories, captureClassificationEdit, performClassificationEdit, repositoryIdsFromDrop, isRepositoryDrop } from '../features/repositories/components/classificationEditActions';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { SubcategoryManagementDialog } from './SubcategoryManagementDialog';
import { subcategoryManagementRequest, type SubcategoryManagementRequest } from './subcategoryManagementRequest';

export function ClassificationSidebarChildren({ categoryId, onCategorySelect }: { categoryId: string; onCategorySelect: (id: string) => void }) {
  const state = useClassificationStore(useShallow(s => ({ groups: s.subcategories, order: s.subcategoryOrder, repositories: s.repositories, navigation: s.classificationNavigation, scheme: s.activeClassificationScheme ?? 'purpose', selected: s.selectedCategory, language: s.language })));
  const dialogs = useDialog();
  const [request, setRequest] = useState<SubcategoryManagementRequest | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const zh = state.language.startsWith('zh');
  const groups = (state.groups ?? []).filter(group => group.parentId === categoryId).sort((a, b) => {
    const rank = (id: string) => state.order?.includes(id) ? state.order.indexOf(id) : Number.MAX_SAFE_INTEGER;
    return rank(a.id) - rank(b.id);
  });
  const expanded = state.navigation?.[state.scheme]?.expanded ?? [];
  if (!groups.length || !expanded.includes(categoryId)) return null;
  return <><div id={`category-children-${categoryId}`} className="ml-7 mt-1 space-y-0.5 border-l pl-2" onDragOver={event => event.stopPropagation()} onDrop={event => event.stopPropagation()}>
    {groups.map(group => <div key={group.id} className={`flex items-start rounded ${dragOver === group.id ? 'bg-success/10 ring-1 ring-success/40' : ''}`}
      onDragOver={event => { event.stopPropagation(); if (!isRepositoryDrop(event.dataTransfer)) return; event.preventDefault(); setDragOver(group.id); }}
      onDragLeave={() => setDragOver(null)}
      onDrop={event => {
        event.preventDefault(); event.stopPropagation(); setDragOver(null); useRepositoryDragStore.getState().endDrag();
        const ids = repositoryIdsFromDrop(event.dataTransfer);
        if (ids.length) void assignClassificationRepositories(ids, { categoryId, subcategoryId: group.id }, dialogs, captureClassificationEdit(state.scheme)).catch(error => dialogs.toast(error.message, 'error'));
      }}>
      <button type="button" title={group.name} className={`flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent ${state.selected === group.id ? 'bg-accent font-medium' : 'text-muted-foreground'}`} aria-pressed={state.selected === group.id} onClick={() => onCategorySelect(group.id)}><span className="min-w-0 flex-1 whitespace-normal break-words line-clamp-2">{group.name}</span><span className="min-w-6 shrink-0 text-right tabular-nums">{state.repositories.filter(repo => repo.subcategory_id === group.id && repo.category_id === categoryId).length}</span></button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-6 shrink-0" aria-label={`${group.name} ${zh ? '操作' : 'actions'}`}><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setRequest(subcategoryManagementRequest('rename', categoryId, group.id))}>{zh ? '重命名' : 'Rename'}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setRequest(subcategoryManagementRequest('move', categoryId, group.id))}>{zh ? '移动到其他一级分类' : 'Move to another parent'}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setRequest(subcategoryManagementRequest('merge', categoryId, group.id))}>{zh ? '合并到其他二级分类' : 'Merge into another subgroup'}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { void performClassificationEdit({ type: 'delete', id: group.id }, dialogs, captureClassificationEdit(state.scheme)).catch(error => dialogs.toast(error.message, 'error')); }}>{zh ? '删除二级分类' : 'Delete subgroup'}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
    </div>)}
  </div>{request && <SubcategoryManagementDialog key={`${request.type}-${request.id ?? request.parentId}`} request={request} onClose={() => setRequest(null)} />}</>;
}
