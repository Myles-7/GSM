import type { Repository } from '../types';
import { validateRepositoryIdentityMappings, type RepositoryIdentityMapping } from './repositoryIdentity';

export interface RepositoryIdentityParticipantResult { changed: number }

export function validateParticipantMappings(mappings: ReadonlyArray<RepositoryIdentityMapping>): void {
  validateRepositoryIdentityMappings(mappings);
  const names = new Set<string>();
  for (const mapping of mappings) {
    const name = mapping.fullName.toLowerCase();
    if (names.has(name)) throw new Error('AMBIGUOUS_IDENTITY_NAME');
    names.add(name);
  }
}

export function assertRepositoryIdentityName(id: number, name: string, mappings: ReadonlyArray<RepositoryIdentityMapping>): void {
  const mapping = mappings.find(item => item.oldId === id || item.newId === id);
  if (mapping && (typeof name !== 'string' || name.toLowerCase() !== mapping.fullName.toLowerCase())) {
    throw new Error('REPOSITORY_IDENTITY_NAME_CONFLICT');
  }
}

/** Only explicit repository fields are rewritten; counters, text and historical evidence are not. */
export function remapParticipantRepositoryList(repositories: Repository[], mappings: ReadonlyArray<RepositoryIdentityMapping>): Repository[] {
  const ids = new Set<number>();
  let changed = false;
  const result = repositories.map(repo => {
    assertRepositoryIdentityName(repo.id, repo.full_name, mappings);
    const mapping = mappings.find(item => item.oldId === repo.id);
    const id = mapping?.newId ?? repo.id;
    if (ids.has(id)) throw new Error('REPOSITORY_IDENTITY_COLLISION');
    ids.add(id);
    if (!mapping) return repo;
    changed = true;
    return { ...repo, id };
  });
  return changed ? result : repositories;
}

export function remapParticipantRepositoryIds(ids: number[], mappings: ReadonlyArray<RepositoryIdentityMapping>): number[] {
  const result = ids.map(id => mappings.find(item => item.oldId === id)?.newId ?? id);
  return result.some((id, index) => id !== ids[index]) ? [...new Set(result)] : ids;
}
