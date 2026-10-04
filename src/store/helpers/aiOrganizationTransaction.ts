import type { AppStoreState } from '../types';
import type { OrganizationMembership, OrganizationTransaction } from '../../types/aiOrganization';
import type { Repository } from '../../types';
import { organizationCategories, organizationSnapshot } from './repositoryOrganization';
import { stableStructure, structureSnapshot } from './organizationStructure';

export const membershipOf = (repository: Repository): OrganizationMembership => ({
  categoryId: repository.category_id ?? null, subcategoryId: repository.subcategory_id ?? null, locked: Boolean(repository.category_locked),
});
export const sameMembership = (a: OrganizationMembership, b: OrganizationMembership) =>
  a.categoryId === b.categoryId && a.subcategoryId === b.subcategoryId && a.locked === b.locked;

export function organizationTransaction(state: AppStoreState, input: OrganizationTransaction): Partial<AppStoreState> {
  if (String(state.user?.id ?? '') !== input.ownerId) throw new Error('Account changed');
  if (input.structureChange) {
    const change = input.structureChange;
    if (stableStructure(structureSnapshot(state)) !== stableStructure(change.expected)) throw new Error('Category structure changed before apply');
    const memberIds = new Set(change.members.map(m => m.repositoryId));
    const affected = new Set(change.affectedCategoryIds);
    if (state.repositories.some(r => affected.has(r.category_id ?? '') && !memberIds.has(r.id))) throw new Error('Category membership changed before apply');
    for (const member of change.members) {
      const repo = state.repositories.find(r => r.id === member.repositoryId);
      if (!repo || !sameMembership(membershipOf(repo), member.before)) throw new Error('Repository changed before apply');
    }
    const byId = new Map(input.assignments.map(a => [a.repositoryId, a]));
    if (byId.size !== input.assignments.length) throw new Error('Duplicate repository assignment');
    for (const a of byId.values()) {
      const repo = state.repositories.find(r => r.id === a.repositoryId);
      if (!repo || !sameMembership(membershipOf(repo), a.before) || a.after.locked !== a.before.locked) throw new Error('Repository changed before apply');
      if (a.before.locked && a.before.categoryId !== a.after.categoryId && !a.overrideLocked) throw new Error('Locked category requires explicit confirmation');
    }
    const categories = organizationCategories({ ...state, ...change.next });
    const names = new Set<string>();
    for (const category of categories.filter(c => !c.mergedInto)) {
      const name = category.name.trim().toLocaleLowerCase();
      if (!name || names.has(name)) throw new Error('Duplicate category name');
      names.add(name);
    }
    const groupNames = new Set<string>();
    for (const group of change.next.subcategories) {
      const name = `${group.parentId}:${group.name.trim().toLocaleLowerCase()}`;
      if (groupNames.has(name)) throw new Error('Duplicate subgroup name');
      groupNames.add(name);
    }
    for (const a of byId.values()) {
      if (a.after.categoryId && !categories.some(c => c.id === a.after.categoryId && !c.mergedInto)) throw new Error('Invalid target category');
      if (a.after.subcategoryId && !change.next.subcategories.some(c => c.id === a.after.subcategoryId && c.parentId === a.after.categoryId)) throw new Error('Invalid target subgroup');
    }
    return organizationSnapshot(state, { ...change.next, repositories: state.repositories.map(repo => {
      const a = byId.get(repo.id);
      return a ? { ...repo, category_id: a.after.categoryId, subcategory_id: a.after.subcategoryId, last_edited: new Date().toISOString() } : repo;
    }) });
  }
  const main = organizationCategories(state);
  const existing = new Set([...main.map(c => c.id), ...state.subcategories.map(c => c.id), 'all', 'pending']);
  const additions = input.categories;
  for (const c of additions) {
    if (!c.isNew || existing.has(c.id) || !c.name.trim()) throw new Error('Category identity changed');
    existing.add(c.id);
  }
  const customCategories = [...state.customCategories, ...additions.filter(c => !c.parentId).map(c => ({ id: c.id, name: c.name, icon: c.icon, keywords: [], isCustom: true }))];
  const subcategories = [...state.subcategories, ...additions.filter(c => c.parentId).map(c => ({ id: c.id, name: c.name, icon: c.icon, parentId: c.parentId! }))];
  const mainIds = new Set([...main.map(c => c.id), ...additions.filter(c => !c.parentId).map(c => c.id)]);
  if (subcategories.some(c => !mainIds.has(c.parentId))) throw new Error('Invalid category parent');
  const assignments = new Map(input.assignments.map(a => [a.repositoryId, a]));
  if (assignments.size !== input.assignments.length) throw new Error('Duplicate repository assignment');
  for (const assignment of assignments.values()) {
    const repo = state.repositories.find(r => r.id === assignment.repositoryId);
    if (!repo || !sameMembership(membershipOf(repo), assignment.before)) throw new Error('Repository changed before apply');
    if (assignment.after.locked !== assignment.before.locked) throw new Error('Cannot change lock state');
    if (assignment.before.locked && assignment.before.categoryId !== assignment.after.categoryId && !assignment.overrideLocked) throw new Error('Locked category requires explicit confirmation');
    if (assignment.after.categoryId && !mainIds.has(assignment.after.categoryId)) throw new Error('Target category disappeared');
    if (assignment.after.subcategoryId && !subcategories.some(c => c.id === assignment.after.subcategoryId && c.parentId === assignment.after.categoryId)) throw new Error('Target subgroup disappeared');
  }
  const repositories = state.repositories.map(repo => {
    const assignment = assignments.get(repo.id);
    return assignment ? { ...repo, category_id: assignment.after.categoryId, subcategory_id: assignment.after.subcategoryId, last_edited: new Date().toISOString() } : repo;
  });
  const removed = new Set<string>();
  for (const c of [...(input.removeCategories ?? [])].sort((a, b) => Number(Boolean(b.parentId)) - Number(Boolean(a.parentId)))) {
    const current = c.parentId ? subcategories.find(g => g.id === c.id) : customCategories.find(g => g.id === c.id);
    if (!current || current.name !== c.name || current.icon !== c.icon) continue;
    if (c.parentId && (!('parentId' in current) || current.parentId !== c.parentId)) continue;
    if (!c.parentId && 'keywords' in current && current.keywords.length) continue;
    if (!c.parentId && 'isHidden' in current && current.isHidden) continue;
    if (repositories.some(r => r.category_id === c.id || r.subcategory_id === c.id)) continue;
    if (!c.parentId && subcategories.some(g => g.parentId === c.id && !removed.has(g.id))) continue;
    removed.add(c.id);
  }
  return organizationSnapshot(state, { repositories, customCategories: customCategories.filter(c => !removed.has(c.id)), subcategories: subcategories.filter(c => !removed.has(c.id)) });
}
