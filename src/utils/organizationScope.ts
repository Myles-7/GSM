import type { Repository } from '../types';

export type OrganizationScope = 'default' | 'selected' | 'filtered' | 'current' | 'pending' | 'all';

export function organizationScopeRepositories(input: {
  repositories: Repository[];
  selectedIds: number[];
  categoryId: string;
  scope: OrganizationScope;
  allRepositories?: Repository[];
  mode?: import('../types/aiOrganization').OrganizationMode;
}): Repository[] {
  const { repositories, selectedIds, categoryId, scope } = input;
  const selected = new Set(selectedIds);
  const namedCategory = categoryId !== 'all' && categoryId !== 'pending';
  const source = scope === 'all' ? input.allRepositories ?? repositories : repositories;
  const unique = [...new Map(source.map(repository => [repository.id, repository])).values()]
    .filter(repository => input.mode !== 'supplement' || repository.category_id == null || repository.subcategory_id == null);
  if (scope === 'selected' || (scope === 'default' && selected.size)) {
    return unique.filter(repository => selected.has(repository.id));
  }
  if (scope === 'filtered' || (scope === 'default' && input.mode === 'reorganize' && !namedCategory)) return unique;
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
