import type { Category, Repository } from '../../types';
import type { RepositoryOrganization, RepositorySubcategory } from '../../types/repositoryOrganization';
import type { AppStoreState } from '../types';
import { matchesCategory } from '../../utils/categoryUtils';
import { builtinCategoryNameVariants } from '../../constants/categoryI18n';
import { getAllCategories } from './categoryHelpers';
import { defaultCategories } from '../schema';

export function normalizeOrder<T extends string | number>(input: unknown, validIds: T[]): T[] {
  const valid = new Set(validIds);
  return [...new Set([...(Array.isArray(input) ? input.filter((id): id is T => valid.has(id)) : []), ...validIds])];
}

function inspectCustomCategories(input: unknown): { categories: Category[]; ambiguousIds: Set<string>; ambiguousNames: Set<string>; invalid: boolean } {
  const builtinIds = new Set(['all', 'pending', ...defaultCategories.map(category => category.id)]);
  const items = Array.isArray(input) ? input : [];
  const counts = new Map<string, number>();
  let invalid = !Array.isArray(input);
  const categories = items.filter((item): item is Category => {
    if (!item || typeof item.id !== 'string' || !item.id.trim() ||
      typeof item.name !== 'string' || !item.name.trim() ||
      (item.icon !== undefined && typeof item.icon !== 'string') ||
      (item.keywords !== undefined && (!Array.isArray(item.keywords) || !item.keywords.every((keyword: unknown) => typeof keyword === 'string')))) {
      invalid = true;
      return false;
    }
    counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
    return true;
  });
  const ambiguousIds = new Set([...counts].filter(([id, count]) => count > 1 || builtinIds.has(id)).map(([id]) => id));
  const ambiguousNames = new Set(categories.filter(category => ambiguousIds.has(category.id)).map(category => category.name));
  return { categories, ambiguousIds, ambiguousNames, invalid };
}

/** Remote/import snapshots are rejected as a whole before callers mutate state. */
export function validateCustomCategorySnapshot(input: unknown): Category[] {
  const checked = inspectCustomCategories(input);
  if (checked.invalid || checked.ambiguousIds.size) throw new Error('Invalid or ambiguous custom category IDs in organization snapshot');
  return checked.categories;
}

/** Damaged local storage must still load, but ambiguous ownership stays pending. */
export function recoverLocalCategorySnapshot(input: unknown, repositories: Repository[]): { customCategories: Category[]; repositories: Repository[] } {
  const checked = inspectCustomCategories(input ?? []);
  return {
    customCategories: checked.categories.filter(category => !checked.ambiguousIds.has(category.id)),
    repositories: repositories.map(repository => {
      const ambiguous = repository.category_id != null && checked.ambiguousIds.has(repository.category_id) ||
        repository.category_id === undefined && !!repository.custom_category && checked.ambiguousNames.has(repository.custom_category);
      if (!ambiguous) return repository;
      return {
        ...repository, category_id: null, subcategory_id: null,
        category_legacy: repository.category_legacy ?? {
          category_id: repository.category_id, subcategory_id: repository.subcategory_id,
          custom_category: repository.custom_category, category_locked: repository.category_locked,
        },
      };
    }),
  };
}

export function organizationCategories(state: Pick<AppStoreState, 'customCategories' | 'language' | 'defaultCategoryOverrides'>): Category[] {
  // Hidden categories remain valid owners.
  return getAllCategories(state.customCategories, state.language, [], state.defaultCategoryOverrides)
    .filter(category => category.id !== 'all');
}

export function categoryIdsForName(name: string | undefined, categories: Category[]): string[] {
  if (!name) return [];
  return categories.filter(category => category.id === name || category.name === name ||
    (!category.isCustom && builtinCategoryNameVariants(defaultCategories.find(item => item.id === category.id)?.name ?? category.name, category.name).includes(name))).map(category => category.id);
}

/** Suggestions are evidence only; calculating them never changes membership. */
export function repositoryCategorySuggestions(repository: Repository, categories: Category[]): string[] {
  const evidence = { ...repository, category_id: undefined, category_locked: false, custom_category: undefined };
  return categories.filter(category => matchesCategory(evidence, category, 'effective')).map(category => category.id);
}

export function normalizeRepositoryMembership(
  repository: Repository,
  categories: Category[],
  subcategories: RepositorySubcategory[] = [],
): Repository {
  const validIds = new Set(categories.map(category => category.id));
  const needsMigration = repository.category_id === undefined ||
    (repository.category_id !== null && !validIds.has(repository.category_id));
  const legacySnapshot = repository.category_legacy && typeof repository.category_legacy === 'object' && !Array.isArray(repository.category_legacy)
    ? repository.category_legacy : needsMigration ? {
    custom_category: repository.custom_category,
    category_locked: repository.category_locked,
    category_id: repository.category_id,
    subcategory_id: repository.subcategory_id,
  } : undefined;
  const candidates = repositoryCategorySuggestions(repository, categories);
  let categoryId = repository.category_id;
  if (categoryId === undefined) {
    const locked = repository.category_locked ? categoryIdsForName(repository.custom_category, categories) : [];
    categoryId = repository.custom_category === '' ? null
      : locked.length === 1 ? locked[0]
      : repository.category_locked ? null
      : candidates.length === 1 ? candidates[0] : null;
  } else if (categoryId !== null && !validIds.has(categoryId)) {
    categoryId = null;
  }
  const group = subcategories.find(item => item.id === repository.subcategory_id && item.parentId === categoryId);
  const suggestions = repository.category_id === undefined || !Array.isArray(repository.category_candidates)
    ? candidates : repository.category_candidates;
  return {
    ...repository,
    category_legacy: legacySnapshot,
    category_id: categoryId,
    subcategory_id: group?.id ?? null,
    category_candidates: [...new Set(suggestions.filter(id => typeof id === 'string' && validIds.has(id)))],
    // Keep legacy evidence on pending records; resolved records project the current name.
    custom_category: categoryId === null ? repository.custom_category : categories.find(category => category.id === categoryId)?.name,
  };
}

export function normalizeRepositoryOrganization(
  input: Partial<RepositoryOrganization> & { repositories: Repository[] },
  categories: Category[],
): RepositoryOrganization & { repositories: Repository[] } {
  const parents = new Set(categories.map(category => category.id));
  const seen = new Set<string>();
  const subcategories = (Array.isArray(input.subcategories) ? input.subcategories : []).filter(item => {
    if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id) ||
      !parents.has(item.parentId) || typeof item.name !== 'string' || !item.name.trim() ||
      typeof item.icon !== 'string') return false;
    seen.add(item.id);
    return true;
  }).map(item => ({ id: item.id, parentId: item.parentId, name: item.name.trim(), icon: item.icon }));
  return {
    subcategories,
    subcategoryOrder: normalizeOrder(input.subcategoryOrder, subcategories.map(item => item.id)),
    repositoryOrder: normalizeOrder(input.repositoryOrder, input.repositories.map(repo => repo.id)),
    repositories: input.repositories.map(repo => normalizeRepositoryMembership(repo, categories, subcategories)),
  };
}

/** Incoming old clients must not erase assignments; explicit edits may change them. */
export function normalizeRepositoryUpdate(incoming: Repository, previous: Repository | undefined, state: AppStoreState, explicit = false, overrideCategoryLock = false, restoreSubcategory = false): Repository {
  const categories = organizationCategories(state);
  const repo = { ...incoming };
  if (repo.ai_details === undefined && previous?.ai_details !== undefined) repo.ai_details = previous.ai_details;
  for (const key of ['category_id', 'subcategory_id', 'category_candidates', 'category_legacy'] as const) {
    if (incoming[key] === undefined && previous?.[key] !== undefined) {
      Object.assign(repo, { [key]: previous[key] });
    }
  }
  if (!explicit && previous?.category_id !== undefined && incoming.category_id === undefined) {
    repo.category_locked = previous.category_locked;
  }
  if (explicit && previous && incoming.custom_category !== previous.custom_category &&
    incoming.category_id === undefined && incoming.last_edited !== previous.last_edited) {
    const matches = categoryIdsForName(incoming.custom_category, categories);
    repo.category_id = matches.length === 1 ? matches[0] : null;
  }
  if (previous?.category_id !== undefined && incoming.analyzed_at && incoming.analyzed_at !== previous.analyzed_at) {
    // An asynchronous analysis may have started before a manual move.
    repo.category_id = previous.category_id;
    repo.subcategory_id = previous.subcategory_id;
    repo.custom_category = previous.custom_category;
    repo.category_locked = previous.category_locked;
  }
  if (!overrideCategoryLock && previous?.category_locked && repo.category_id !== previous.category_id && incoming.category_locked !== false) {
    repo.category_id = previous.category_id;
    repo.custom_category = previous.custom_category;
  }
  if (previous && repo.category_id !== previous.category_id && !restoreSubcategory) repo.subcategory_id = null;
  if (previous && (incoming.ai_summary !== previous.ai_summary || incoming.ai_tags !== previous.ai_tags ||
    incoming.custom_tags !== previous.custom_tags || incoming.topics !== previous.topics)) {
    repo.category_candidates = repositoryCategorySuggestions(repo, categories);
  }
  return normalizeRepositoryMembership(repo, categories, state.subcategories);
}

export function incomingOrganizationSnapshot(state: AppStoreState, input: Record<string, unknown>, repositories?: Repository[]): Partial<AppStoreState> {
  if ('customCategories' in input) validateCustomCategorySnapshot(input.customCategories);
  const patch: Partial<AppStoreState> = {};
  for (const key of ['customCategories', 'hiddenDefaultCategoryIds', 'categoryOrder', 'subcategories', 'subcategoryOrder', 'repositoryOrder'] as const) {
    if (Array.isArray(input[key])) Object.assign(patch, { [key]: input[key] });
  }
  if (input.defaultCategoryOverrides && typeof input.defaultCategoryOverrides === 'object' && !Array.isArray(input.defaultCategoryOverrides)) {
    patch.defaultCategoryOverrides = input.defaultCategoryOverrides as AppStoreState['defaultCategoryOverrides'];
  }
  if (repositories) {
    const existing = new Map(state.repositories.map(repo => [repo.id, repo]));
    // Normalize only after installing the complete category/group snapshot.
    patch.repositories = repositories.map(repo => {
      const previous = existing.get(repo.id);
      const next = { ...repo };
      for (const key of ['category_id', 'subcategory_id', 'category_candidates', 'category_legacy', 'ai_details'] as const) {
        if (repo[key] === undefined && previous?.[key] !== undefined) Object.assign(next, { [key]: previous[key] });
      }
      if (repo.category_id === undefined && previous?.category_id !== undefined) {
        next.category_locked = previous.category_locked;
      }
      return next;
    });
  }
  const normalized = organizationSnapshot(state, patch);
  if (repositories) normalized.searchResults = normalized.repositories;
  return normalized;
}

/** Apply an organization snapshot in one store update, including visible copies. */
export function organizationSnapshot(state: AppStoreState, patch: Partial<AppStoreState>): Partial<AppStoreState> {
  const next = { ...state, ...patch };
  const organization = normalizeRepositoryOrganization(next, organizationCategories(next));
  const byId = new Map(organization.repositories.map(repo => [repo.id, repo]));
  return {
    ...patch,
    ...organization,
    searchResults: state.searchResults.map(repo => byId.get(repo.id) ?? repo),
    similarView: state.similarView ? {
      ...state.similarView,
      similarResults: state.similarView.similarResults.map(repo => byId.get(repo.id) ?? repo),
      originalSearchResults: state.similarView.originalSearchResults.map(repo => byId.get(repo.id) ?? repo),
    } : null,
  };
}
