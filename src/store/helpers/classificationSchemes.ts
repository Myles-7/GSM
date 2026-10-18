import type { AppStoreState } from '../types';
import type { Repository } from '../../types';
import type { ClassificationScheme, ClassificationSchemeId, ClassificationSchemes } from '../../types/classification';
import type { OrganizationMembership } from '../../types/aiOrganization';
import { normalizeRepositoryOrganization, organizationCategories } from './repositoryOrganization';
import { structureSnapshot } from './organizationStructure';

export const emptyClassificationScheme = (): ClassificationScheme => ({
  initialized: false, customCategories: [], defaultCategoryOverrides: {}, hiddenDefaultCategoryIds: [],
  categoryOrder: [], subcategories: [], subcategoryOrder: [], repositoryOrder: [], categoryListIdMap: {},
});
const uninitializedTechnology = emptyClassificationScheme();
const technologyRepositories = new WeakMap<Repository, Repository>();
const technologyLists = new WeakMap<Repository[], Repository[]>();
function projectTechnologyList(repositories: Repository[]): Repository[] {
  let projected = technologyLists.get(repositories);
  if (!projected) { projected = repositories.map(repo => projectClassificationRepository(repo, 'technology')); technologyLists.set(repositories, projected); }
  return projected;
}
export function classificationStructure(state: AppStoreState, id: ClassificationSchemeId): ClassificationScheme {
  return id === 'purpose' ? { ...structureSnapshot(state), initialized: true }
    : state.classificationSchemes?.technology ?? uninitializedTechnology;
}
export function classificationMembership(repository: Repository, id: ClassificationSchemeId): OrganizationMembership {
  return id === 'purpose' ? { categoryId: repository.category_id ?? null, subcategoryId: repository.subcategory_id ?? null, locked: !!repository.category_locked }
    : repository.classifications?.technology ?? { categoryId: null, subcategoryId: null, locked: false };
}
export function projectClassificationRepository(repository: Repository, id: ClassificationSchemeId): Repository {
  if (id === 'purpose') return repository;
  const cached = technologyRepositories.get(repository);
  if (cached) return cached;
  const member = classificationMembership(repository, id);
  const projected = { ...repository, category_id: member.categoryId, subcategory_id: member.subcategoryId, category_locked: member.locked, custom_category: undefined, category_candidates: [] };
  technologyRepositories.set(repository, projected);
  return projected;
}
export function classificationProjection(state: AppStoreState, id: ClassificationSchemeId): AppStoreState {
  if (id === 'purpose') return { ...state, classificationContext: 'purpose' };
  const structure = classificationStructure(state, id);
  return { ...state, ...structure, classificationContext: id, repositories: projectTechnologyList(state.repositories), searchResults: projectTechnologyList(state.searchResults),
    selectedCategory: state.classificationNavigation?.[id]?.selected ?? 'all',
    similarView: state.similarView ? { ...state.similarView, similarResults: projectTechnologyList(state.similarView.similarResults), originalSearchResults: projectTechnologyList(state.similarView.originalSearchResults) } : null };
}
/** Commit a projected category write without changing the other scheme or personal fields. */
export function commitClassificationProjection(state: AppStoreState, id: ClassificationSchemeId, patch: Partial<AppStoreState>): Partial<AppStoreState> {
  const view = classificationProjection(state, id);
  const next = { ...view, ...patch };
  const normalized = normalizeRepositoryOrganization(next, organizationCategories(next));
  if (id === 'purpose') return { ...patch, ...normalized,
    classificationSchemes: { ...state.classificationSchemes, purpose: { ...structureSnapshot({ ...next, ...normalized }), initialized: true } },
    classificationNavigation: { ...state.classificationNavigation, purpose: { ...state.classificationNavigation?.purpose, expanded: state.classificationNavigation?.purpose?.expanded ?? [], selected: next.selectedCategory } },
  };
  const members = new Map(normalized.repositories.map(repo => [repo.id, classificationMembership(repo, 'purpose')]));
  const project = (repo: Repository) => members.has(repo.id) ? { ...repo, classifications: { ...repo.classifications, technology: members.get(repo.id)! } } : repo;
  return {
    classificationSchemes: { ...state.classificationSchemes, technology: { ...structureSnapshot({ ...next, ...normalized }), initialized: true } },
    repositories: state.repositories.map(project), searchResults: state.searchResults.map(project),
    similarView: state.similarView ? { ...state.similarView, similarResults: state.similarView.similarResults.map(project), originalSearchResults: state.similarView.originalSearchResults.map(project) } : null,
    classificationNavigation: { ...state.classificationNavigation, technology: { ...state.classificationNavigation?.technology, expanded: state.classificationNavigation?.technology?.expanded ?? [], selected: next.selectedCategory } },
  };
}
/** Migration is local and idempotent. Missing old fields never clear technology. */
export function normalizeClassificationSchemes(state: AppStoreState): { classificationSchemes: ClassificationSchemes } {
  const technology = classificationStructure(state, 'technology');
  const projection = classificationProjection(state, 'technology');
  const normalized = normalizeRepositoryOrganization(projection, technology.customCategories);
  return { classificationSchemes: { purpose: classificationStructure(state, 'purpose'), technology: { ...technology, subcategories: normalized.subcategories,
    subcategoryOrder: normalized.subcategoryOrder, repositoryOrder: normalized.repositoryOrder } } };
}
export function classificationExport(state: import('../../types').AppState): ClassificationSchemes {
  return { ...state.classificationSchemes, purpose: { ...structureSnapshot(state as AppStoreState), initialized: true } };
}
