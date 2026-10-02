import type { Repository } from '../types';

export type OrganizationScope = 'default' | 'selected' | 'current' | 'pending' | 'all';

export function organizationScopeRepositories(input: {
  repositories: Repository[];
  selectedIds: number[];
  categoryId: string;
  scope: OrganizationScope;
}): Repository[] {
  const { repositories, selectedIds, categoryId, scope } = input;
  const selected = new Set(selectedIds);
  const namedCategory = categoryId !== 'all' && categoryId !== 'pending';
  const unique = [...new Map(repositories.map(repository => [repository.id, repository])).values()];
  if (scope === 'selected' || (scope === 'default' && selected.size)) {
    return unique.filter(repository => selected.has(repository.id));
  }
  if (scope === 'pending' || (scope === 'default' && !namedCategory)) {
    return unique.filter(repository => repository.category_id == null);
  }
  if (scope === 'current' || scope === 'default') {
    if (!namedCategory) return [];
    return unique.filter(repository => repository.category_id === categoryId
      && (scope !== 'default' || repository.subcategory_id == null));
  }
  return unique;
}
