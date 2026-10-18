import type { AppStoreState } from '../store/types';
import type { OrganizationSchemeDraft, OrganizationTransaction } from '../types/aiOrganization';
import { classificationMembership } from '../store/helpers/classificationSchemes';
import { organizationTransaction } from '../store/helpers/aiOrganizationTransaction';
import { structureSnapshot } from '../store/helpers/organizationStructure';

export function emptyReplacedCategories(scheme: OrganizationSchemeDraft, acceptedIds?: Set<number>): string[] {
  if (!scheme.ready || !scheme.proposedCategoryIds?.length) return [];
  const proposed = new Set(scheme.proposedCategoryIds);
  const scopedOriginal = new Set(scheme.entries.flatMap(entry => [entry.before.categoryId, entry.before.subcategoryId]));
  const members = scheme.members ?? scheme.entries.map(entry => ({ repositoryId: entry.repositoryId, before: entry.before }));
  const after = (member: typeof members[number]) => {
    const entry = scheme.entries.find(row => row.repositoryId === member.repositoryId);
    return entry && (acceptedIds ? acceptedIds.has(entry.repositoryId) : entry.selected && entry.disposition === 'move' && entry.status === 'pending' && (!entry.before.locked || entry.categoryId === entry.before.categoryId || entry.overrideLocked))
      ? { categoryId: entry.categoryId, subcategoryId: entry.subcategoryId } : member.before;
  };
  return scheme.categories.filter(category => !category.isNew && !proposed.has(category.id)
    && (scheme.scopeIsFullLibrary || scopedOriginal.has(category.id) || category.parentId && scopedOriginal.has(category.parentId))
    && !members.some(member => { const target = after(member); return target.categoryId === category.id || target.subcategoryId === category.id; }))
    .filter(category => category.parentId || !scheme.categories.some(child => child.parentId === category.id && proposed.has(child.id)))
    .map(category => category.id);
}

/** Empty sources are retired only after an explicit, fully covered confirmation. */
export function withDualStructureRetirement(view: AppStoreState, scheme: OrganizationSchemeDraft, input: OrganizationTransaction): OrganizationTransaction {
  const retire = new Set(scheme.retireCategoryIds ?? []);
  if (!retire.size) return input;
  const proposed = new Set(scheme.proposedCategoryIds ?? []);
  if ([...retire].some(id => proposed.has(id) || !scheme.categories.some(c => c.id === id && !c.isNew))) throw new Error('Only replaced existing categories may be retired');
  const affected = new Set([...retire, ...view.subcategories.filter(c => retire.has(c.id)).map(c => c.parentId)]);
  const frozen = scheme.members ?? scheme.entries.map(e => ({ repositoryId: e.repositoryId, before: e.before }));
  const members = frozen.filter(row => affected.has(row.before.categoryId ?? ''));
  for (const row of members) {
    const entry = scheme.entries.find(e => e.repositoryId === row.repositoryId);
    if (!entry || entry.disposition === 'insufficient' || entry.error) throw new Error('Complete restructuring requires resolving all affected repositories, including outside this scope');
    if (entry.disposition === 'move' && !input.assignments.some(a => a.repositoryId === row.repositoryId)) throw new Error('Complete restructuring requires selecting every affected move and authorizing locked moves');
  }
  const patch = organizationTransaction(view, { ...input, schemeId: undefined });
  const next = { ...view, ...patch };
  for (const id of retire) if (next.repositories.some(repo => repo.category_id === id || repo.subcategory_id === id)) throw new Error('Retained repositories still reference this category');
  const snapshot = structureSnapshot(next);
  snapshot.customCategories = snapshot.customCategories.filter(c => !retire.has(c.id));
  snapshot.subcategories = snapshot.subcategories.filter(c => !retire.has(c.id) && !retire.has(c.parentId));
  for (const id of retire) {
    if (scheme.categories.find(c => c.id === id)?.parentId || view.customCategories.some(c => c.id === id)) continue;
    const targets = [...new Set(members.filter(m => m.before.categoryId === id).flatMap(m => {
      const assignment = input.assignments.find(a => a.repositoryId === m.repositoryId);
      return assignment?.after.categoryId ? [assignment.after.categoryId] : [];
    }))];
    snapshot.defaultCategoryOverrides[id] = { ...snapshot.defaultCategoryOverrides[id], retired: true, retirementTargets: targets,
      ...(targets.length === 1 ? { mergedInto: targets[0] } : {}) };
    snapshot.hiddenDefaultCategoryIds = [...new Set([...snapshot.hiddenDefaultCategoryIds, id])];
  }
  snapshot.categoryOrder = snapshot.categoryOrder.filter(id => !retire.has(id));
  snapshot.subcategoryOrder = snapshot.subcategoryOrder.filter(id => snapshot.subcategories.some(c => c.id === id));
  // Preserve remote List references; retirement never renames or deletes GitHub Lists.
  return { ...input, categories: [], structureChange: { expected: structureSnapshot(view), next: snapshot,
    members, affectedCategoryIds: [...affected] } };
}

export function dualStructureAffectedMembers(state: AppStoreState, schemeId: 'purpose' | 'technology', scheme: OrganizationSchemeDraft) {
  const affected = new Set((scheme.retireCategoryIds ?? []).flatMap(id => {
    const category = scheme.categories.find(c => c.id === id);
    return [category?.parentId ?? id];
  }));
  return state.repositories.filter(repo => affected.has(classificationMembership(repo, schemeId).categoryId ?? ''));
}
