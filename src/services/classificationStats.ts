import type { Repository } from '../types';
import type { ClassificationChangeStats, ClassificationSchemeId } from '../types/classification';
const group = (repo: Repository, scheme: ClassificationSchemeId) => scheme === 'purpose' ? `${repo.category_id ?? ''}/${repo.subcategory_id ?? ''}` : `${repo.classifications?.technology?.categoryId ?? ''}/${repo.classifications?.technology?.subcategoryId ?? ''}`;
export function classificationChangeStats(before: Repository[], after: Repository[], scheme: ClassificationSchemeId): ClassificationChangeStats {
  const counts = (repos: Repository[]) => {
    const result = new Map<string, number>();
    for (const repo of repos) { const id = group(repo, scheme); if (id !== '/') result.set(id, (result.get(id) ?? 0) + 1); }
    return result;
  };
  const previous = counts(before); const current = counts(after);
  const old = new Map(before.map(repo => [repo.id, group(repo, scheme)]));
  return { beforeGroups: previous.size, afterGroups: current.size, beforeOversized: [...previous.values()].filter(count => count > 25).length,
    afterOversized: [...current.values()].filter(count => count > 25).length, changedMemberships: after.filter(repo => old.get(repo.id) !== group(repo, scheme)).length };
}
