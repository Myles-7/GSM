import type { AppStoreState } from '../types';
import type { ClassificationSchemeId } from '../../types/classification';
import { classificationProjection, commitClassificationProjection } from './classificationSchemes';
import { organizationCategories, organizationSnapshot, normalizeOrder } from './repositoryOrganization';

export interface ClassificationTarget { categoryId: string | null; subcategoryId: string | null }
export type ClassificationEditOperation =
  | { type: 'create'; parentId: string; name: string; icon?: string }
  | { type: 'rename'; id: string; name: string; icon?: string }
  | { type: 'delete'; id: string }
  | { type: 'merge'; id: string; targetId: string }
  | { type: 'move'; id: string; parentId: string }
  | ({ type: 'assign'; repositoryIds: number[] } & ClassificationTarget);
export type ClassificationEditCommand = ClassificationEditOperation & {
  expectedAccountId: number | null;
  expectedToken: string;
  overrideLocks?: boolean;
};

/** Consent belongs to one account and one complete dimension snapshot. */
export function classificationEditToken(state: AppStoreState, schemeId: ClassificationSchemeId): string {
  const view = classificationProjection(state, schemeId);
  return JSON.stringify([state.user?.id ?? null, organizationCategories(view), view.hiddenDefaultCategoryIds, view.categoryOrder, view.subcategories, view.subcategoryOrder,
    view.repositories.map(repo => [repo.id, repo.category_id ?? null, repo.subcategory_id ?? null, !!repo.category_locked])]);
}
const normalizedName = (name: string) => name.trim().normalize('NFKC').toLocaleLowerCase();

export function applyClassificationEdit(state: AppStoreState, schemeId: ClassificationSchemeId, command: ClassificationEditCommand): Partial<AppStoreState> {
  if ((state.user?.id ?? null) !== command.expectedAccountId) throw new Error('Account changed. Please try again. / 账号已切换，请重试。');
  if (classificationEditToken(state, schemeId) !== command.expectedToken) throw new Error('Classification changed. Please review again. / 分类已变化，请重新确认。');
  const view = classificationProjection(state, schemeId);
  const categories = organizationCategories(view);
  const requireParent = (id: string) => {
    if (id === 'all' || id === 'pending' || !categories.some(category => category.id === id)) throw new Error('Invalid parent category / 一级分类不存在');
  };
  let groups = view.subcategories;
  let order = normalizeOrder(view.subcategoryOrder, groups.map(group => group.id));
  let repositories = view.repositories;
  let selected = view.selectedCategory;
  let expanded = state.classificationNavigation?.[schemeId]?.expanded ?? [];
  let collapsedGroups = state.classificationNavigation?.[schemeId]?.collapsedGroups ?? [];
  const ensureName = (parentId: string, name: string, except?: string) => {
    if (!name.trim()) throw new Error('Name is required / 名称不能为空');
    if (name.trim().length > 120) throw new Error('Name must be at most 120 characters / 名称不能超过120字符');
    if (groups.some(group => group.parentId === parentId && group.id !== except && normalizedName(group.name) === normalizedName(name)))
      throw new Error('A group with this name already exists. Rename it or explicitly merge the groups. / 同名二级分类已存在，请改名或明确合并。');
  };
  const changed = new Set<number>();
  const assign = (ids: Set<number>, target: ClassificationTarget) => {
    repositories = repositories.map(repo => {
      if (!ids.has(repo.id) || (repo.category_id ?? null) === target.categoryId && (repo.subcategory_id ?? null) === target.subcategoryId) return repo;
      if (repo.category_locked && !command.overrideLocks) throw new Error('Locked memberships require confirmation / 修改锁定归属需要确认');
      changed.add(repo.id);
      return { ...repo, category_id: target.categoryId, subcategory_id: target.subcategoryId,
        category_locked: target.categoryId === null ? false : repo.category_locked,
        custom_category: categories.find(category => category.id === target.categoryId)?.name ?? '', last_edited: new Date().toISOString() };
    });
  };
  if (command.type === 'assign') {
    if (!command.repositoryIds.length || new Set(command.repositoryIds).size !== command.repositoryIds.length || command.repositoryIds.some(id => !repositories.some(repo => repo.id === id)))
      throw new Error('Invalid repository selection / 仓库选择已失效');
    if (command.categoryId !== null) requireParent(command.categoryId);
    if (command.subcategoryId !== null && !groups.some(group => group.id === command.subcategoryId && group.parentId === command.categoryId)) throw new Error('Invalid subcategory target / 二级分类目标不存在');
    assign(new Set(command.repositoryIds), command);
    if (!changed.size) return state;
  } else if (command.type === 'create') {
    requireParent(command.parentId); ensureName(command.parentId, command.name);
    if (groups.length >= 2000) throw new Error('Subcategory limit reached / 二级分类数量已达上限');
    if (command.icon !== undefined && command.icon.length > 100) throw new Error('Icon must be at most 100 characters / 图标不能超过100字符');
    const id = crypto.randomUUID();
    groups = [...groups, { id, parentId: command.parentId, name: command.name.trim(), icon: command.icon ?? '📁' }];
    order = [...order, id]; expanded = [...new Set([...expanded, command.parentId])];
  } else {
    const source = groups.find(group => group.id === command.id);
    if (!source) throw new Error('Subcategory no longer exists / 二级分类已不存在');
    if (command.type === 'rename') {
      ensureName(source.parentId, command.name, source.id);
      if (command.icon !== undefined && command.icon.length > 100) throw new Error('Icon must be at most 100 characters / 图标不能超过100字符');
      groups = groups.map(group => group.id === source.id ? { ...group, name: command.name.trim(), ...(command.icon !== undefined ? { icon: command.icon } : {}) } : group);
    } else if (command.type === 'move') {
      requireParent(command.parentId); ensureName(command.parentId, source.name, source.id);
      if (command.parentId === source.parentId) throw new Error('Choose a different parent / 请选择其他一级分类');
      assign(new Set(repositories.filter(repo => repo.subcategory_id === source.id && repo.category_id === source.parentId).map(repo => repo.id)), { categoryId: command.parentId, subcategoryId: source.id });
      groups = groups.map(group => group.id === source.id ? { ...group, parentId: command.parentId } : group);
      order = [...order.filter(id => id !== source.id), source.id];
      expanded = [...new Set([...expanded, command.parentId])];
    } else {
      const target = command.type === 'merge' ? groups.find(group => group.id === command.targetId && group.id !== source.id) : undefined;
      if (command.type === 'merge' && !target) throw new Error('Invalid merge target / 合并目标不存在');
      assign(new Set(repositories.filter(repo => repo.subcategory_id === source.id && repo.category_id === source.parentId).map(repo => repo.id)), { categoryId: target?.parentId ?? source.parentId, subcategoryId: target?.id ?? null });
      groups = groups.filter(group => group.id !== source.id); order = order.filter(id => id !== source.id);
      collapsedGroups = collapsedGroups.filter(id => id !== source.id);
      if (selected === source.id) selected = target?.id ?? source.parentId;
      if (target) expanded = [...new Set([...expanded, target.parentId])];
    }
  }
  const patch = commitClassificationProjection(state, schemeId, organizationSnapshot(view, { repositories, subcategories: groups, subcategoryOrder: order, selectedCategory: selected }));
  // Clear evidence for the moved dimension only; metadata and the other dimension survive.
  const clearEvidence = (repo: typeof repositories[number]) => {
    if (!changed.has(repo.id) || !repo.classificationInsights?.[schemeId]) return repo;
    const insights = { ...repo.classificationInsights }; delete insights[schemeId];
    return { ...repo, classificationInsights: insights };
  };
  const projectedById = new Map(repositories.map(repo => [repo.id, repo]));
  const finish = (repo: typeof repositories[number]) => clearEvidence(changed.has(repo.id) ? { ...repo, last_edited: projectedById.get(repo.id)!.last_edited } : repo);
  const generation = state.classificationSchemes?.generation;
  const edited = changed.size > 0 || JSON.stringify(groups) !== JSON.stringify(view.subcategories) || JSON.stringify(order) !== JSON.stringify(view.subcategoryOrder);
  return { ...patch, ...(edited ? { classificationSchemes: { ...(patch.classificationSchemes ?? state.classificationSchemes), generation: {
    status: 'idle' as const, generation: 0, queuedRepositoryIds: [], ...generation,
    repositoryIds: [...new Set([...(generation?.repositoryIds ?? state.repositories.map(repo => repo.id)), ...changed])], syncPending: true,
  } } } : {}), repositories: (patch.repositories ?? state.repositories).map(finish), searchResults: (patch.searchResults ?? state.searchResults).map(finish),
    similarView: patch.similarView ? { ...patch.similarView, similarResults: patch.similarView.similarResults.map(finish), originalSearchResults: patch.similarView.originalSearchResults.map(finish) } : patch.similarView,
    classificationNavigation: { ...state.classificationNavigation, [schemeId]: { ...state.classificationNavigation?.[schemeId], selected, expanded, collapsedGroups } } };
}
