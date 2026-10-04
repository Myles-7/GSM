import type { Repository } from '../types';
import { performBasicTextSearch } from './repoSearch';

/** Current entities only; this lookup and candidate order are entirely rebuildable. */
export function submittedRepositoryCandidates(repositories: Repository[], query: string, providerIds: readonly number[]): Repository[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const byId = new Map(repositories.map(repo => [repo.id, repo]));
  const ids = new Set<number>();
  const result: Repository[] = [];
  const add = (id: number) => { const repo = byId.get(id); if (repo && !ids.has(id)) { ids.add(id); result.push(repo); } };
  for (const repo of repositories) if (repo.full_name.toLowerCase() === normalized) add(repo.id);
  for (const repo of repositories) if (repo.name.toLowerCase() === normalized) add(repo.id);
  for (const id of providerIds) add(id);
  for (const repo of performBasicTextSearch(repositories, query)) add(repo.id);
  return result;
}
