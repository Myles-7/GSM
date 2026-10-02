import type { Repository } from '../types';

export interface RepositoryIdentityMapping {
  oldId: number;
  newId: number;
  fullName: string;
  evidence: string;
}
export interface RepositoryIdentityCandidate {
  oldId: number;
  fullName: string;
  candidates: number[];
  reason: 'confirmation-required' | 'ambiguous-name' | 'no-candidate';
}
export const isValidRepositoryId = (id: unknown): id is number =>
  typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
// This is evidence of the previous timestamp generator, not proof of GitHub identity.
export const isLegacySyntheticRepositoryId = (id: unknown): id is number =>
  isValidRepositoryId(id) && id >= 100_000_000_000;
const nameKey = (name: string) => name.toLowerCase();
const personalFields = [
  'custom_description', 'custom_tags', 'custom_category', 'category_id', 'subcategory_id',
  'category_locked', 'category_candidates', 'category_legacy', 'ai_summary', 'ai_tags',
  'ai_platforms', 'ai_details',
] as const;

export function inspectRepositoryIdentities(local: Repository[], incoming: Repository[]): RepositoryIdentityCandidate[] {
  const ids = new Set<number>();
  for (const repo of incoming) {
    if (!isValidRepositoryId(repo.id) || ids.has(repo.id)) throw new Error('INVALID_OR_DUPLICATE_GITHUB_ID');
    ids.add(repo.id);
  }
  return local.filter(repo => isLegacySyntheticRepositoryId(repo.id) && !ids.has(repo.id)).map(repo => {
    const candidates = incoming.filter(item => nameKey(item.full_name) === nameKey(repo.full_name)).map(item => item.id);
    return { oldId: repo.id, fullName: repo.full_name, candidates,
      reason: candidates.length === 1 ? 'confirmation-required' : candidates.length > 1 ? 'ambiguous-name' : 'no-candidate' };
  });
}

export function validateRepositoryIdentityMappings(mappings: readonly RepositoryIdentityMapping[]): void {
  const old = new Set<number>(), targets = new Set<number>();
  for (const mapping of mappings) {
    if (!isLegacySyntheticRepositoryId(mapping.oldId) || !isValidRepositoryId(mapping.newId) || isLegacySyntheticRepositoryId(mapping.newId)
      || mapping.oldId === mapping.newId || old.has(mapping.oldId) || targets.has(mapping.newId)
      || typeof mapping.fullName !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(mapping.fullName)
      || typeof mapping.evidence !== 'string' || !mapping.evidence.trim() || mapping.evidence.length > 2000) {
      throw new Error('INVALID_OR_AMBIGUOUS_IDENTITY_MAPPING');
    }
    old.add(mapping.oldId); targets.add(mapping.newId);
  }
  if (mappings.some(mapping => old.has(mapping.newId))) throw new Error('CHAINED_IDENTITY_MAPPING');
}

/** Never infer a rekey from a name. Unresolved timestamp records remain recoverable. */
export function preserveUnconfirmedLegacyRepositories(incoming: Repository[], local: Repository[]): Repository[] {
  const ids = new Set(incoming.map(repo => repo.id));
  return [...incoming, ...local.filter(repo => isLegacySyntheticRepositoryId(repo.id) && !ids.has(repo.id))];
}

export function remapRepositoryList(repositories: Repository[], mappings: readonly RepositoryIdentityMapping[]): Repository[] {
  validateRepositoryIdentityMappings(mappings);
  const result = repositories.slice();
  for (const mapping of mappings) {
    const source = result.find(repo => repo.id === mapping.oldId);
    if (!source) continue; // A participant already completed before the journal acknowledgement.
    if (nameKey(source.full_name) !== nameKey(mapping.fullName)) throw new Error('IDENTITY_SOURCE_CHANGED');
    const target = result.find(repo => repo.id === mapping.newId);
    if (target && nameKey(target.full_name) !== nameKey(mapping.fullName)) throw new Error('IDENTITY_TARGET_COLLISION');
    if (target && personalFields.some(field => source[field] !== undefined && target[field] !== undefined
      && JSON.stringify(source[field]) !== JSON.stringify(target[field]))) throw new Error('IDENTITY_METADATA_COLLISION');
    // The source carries intentional empty values and locks; identity metadata follows GitHub.
    const merged = { ...target, ...source, id: mapping.newId,
      ...(target ? { name: target.name, full_name: target.full_name, html_url: target.html_url, owner: target.owner } : {}),
      vector_indexed_identity: undefined, vector_indexed_generation: undefined };
    result.splice(result.indexOf(source), 1);
    if (target) result.splice(result.indexOf(target), 1);
    result.push(merged);
  }
  return result;
}
