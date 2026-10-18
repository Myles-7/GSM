import { useShallow } from 'zustand/react/shallow';
import { useClassificationStore } from '../store/useClassificationStore';
export function ClassificationSidebarChildren({ categoryId, onCategorySelect }: { categoryId: string; onCategorySelect: (id: string) => void }) {
  const state = useClassificationStore(useShallow(s => ({ groups: s.subcategories, order: s.subcategoryOrder, repositories: s.repositories, navigation: s.classificationNavigation, scheme: s.activeClassificationScheme ?? 'purpose', selected: s.selectedCategory })));
  const groups = (state.groups ?? []).filter(group => group.parentId === categoryId).sort((a, b) => {
    const rank = (id: string) => state.order?.includes(id) ? state.order.indexOf(id) : Number.MAX_SAFE_INTEGER;
    return rank(a.id) - rank(b.id);
  });
  if (!groups.length) return null;
  const expanded = state.navigation?.[state.scheme]?.expanded ?? [];
  if (!expanded.includes(categoryId)) return null;
  return <div id={`category-children-${categoryId}`} className="ml-7 mt-1 space-y-0.5 border-l pl-2" onDragOver={event => event.stopPropagation()} onDrop={event => event.stopPropagation()}>
    {groups.map(group => <button key={group.id} type="button" title={group.name} className={`flex min-h-8 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent ${state.selected === group.id ? 'bg-accent font-medium' : 'text-muted-foreground'}`} aria-pressed={state.selected === group.id} onClick={() => onCategorySelect(group.id)}><span className="min-w-0 flex-1 truncate">{group.name}</span><span className="min-w-6 shrink-0 text-right tabular-nums">{state.repositories.filter(repo => repo.subcategory_id === group.id && repo.category_id === categoryId).length}</span></button>)}
  </div>;
}
