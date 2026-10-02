import { describe, expect, it } from 'vitest';
import type { Repository } from '../types';
import {
  inspectRepositoryIdentities,
  isLegacySyntheticRepositoryId,
  isValidRepositoryId,
  preserveUnconfirmedLegacyRepositories,
  remapRepositoryList,
  validateRepositoryIdentityMappings,
  type RepositoryIdentityMapping,
} from './repositoryIdentity';
import { mergeRepositoriesPreservingLocalMetadata } from './repositoryMerge';

const oldId = 1_700_000_000_001;
const newId = 421;
const repository = (id: number, patch: Partial<Repository> = {}): Repository => ({
  id, name: 'sample', full_name: 'owner/sample', description: null,
  html_url: 'https://github.com/owner/sample', stargazers_count: 0, forks_count: 0, forks: 0,
  language: null, topics: [], owner: { login: 'owner', avatar_url: '' },
  created_at: '2026-01-01', updated_at: '2026-01-02', pushed_at: '2026-01-02',
  ...patch,
});
const mapping: RepositoryIdentityMapping = {
  oldId, newId, fullName: 'owner/sample', evidence: 'User confirmed the canonical GitHub repository ID',
};
const details: NonNullable<Repository['ai_details']> = {
  version: 1, generated_at: '2026-01-03', repository_pushed_at: null, model: 'fixture',
  sources: [], problem: null, features: [], scenarios: [], architecture: null,
  quickstart: [], deployment: null, cost: null, maintenance: null,
};

describe('repository identity dry run', () => {
  it('still requires confirmation for a single case-insensitive same-name candidate without mutating either list', () => {
    const local = [repository(oldId, { custom_description: '', category_locked: true })];
    const incoming = [repository(newId, { full_name: 'Owner/Sample' })];
    const before = structuredClone({ local, incoming });

    expect(inspectRepositoryIdentities(local, incoming)).toEqual([{
      oldId, fullName: 'owner/sample', candidates: [newId], reason: 'confirmation-required',
    }]);
    expect({ local, incoming }).toEqual(before);
    const preserved = preserveUnconfirmedLegacyRepositories(incoming, local);
    expect(preserved.map(repo => repo.id)).toEqual([newId, oldId]);
    expect(preserved[0]).toBe(incoming[0]);
    expect(preserved[1]).toBe(local[0]);
  });

  it('does not guess a legacy identity from a rename or transfer', () => {
    const source = repository(oldId, { custom_tags: ['personal'] });
    const renamed = repository(newId, { name: 'renamed', full_name: 'another-owner/renamed' });
    expect(inspectRepositoryIdentities([source], [renamed])).toEqual([{
      oldId, fullName: source.full_name, candidates: [], reason: 'no-candidate',
    }]);
    expect(preserveUnconfirmedLegacyRepositories([renamed], [source])).toEqual([renamed, source]);
  });

  it('retains an unresolved synthetic row when no candidate exists, without treating absence as deletion', () => {
    const legacy = repository(oldId, { custom_description: 'recoverable' });
    const removedReal = repository(newId);
    expect(inspectRepositoryIdentities([legacy, removedReal], [])).toEqual([{
      oldId, fullName: legacy.full_name, candidates: [], reason: 'no-candidate',
    }]);
    expect(preserveUnconfirmedLegacyRepositories([], [legacy, removedReal])).toEqual([legacy]);
  });

  it('tracks a renamed real repository by ID and does not propose a migration', () => {
    const local = repository(newId, { custom_description: '', custom_tags: ['mine'], category_locked: true });
    const renamed = repository(newId, { name: 'renamed', full_name: 'owner/renamed' });
    expect(inspectRepositoryIdentities([local], [renamed])).toEqual([]);
    expect(mergeRepositoriesPreservingLocalMetadata([renamed], [local])).toEqual([{
      ...renamed, custom_description: '', custom_tags: ['mine'], category_locked: true,
    }]);
  });

  it('does not transfer personal metadata when a repository name is reused by another real ID', () => {
    const original = repository(newId, { custom_description: 'belongs to the original', custom_tags: ['private'] });
    const replacement = repository(newId + 1);
    expect(inspectRepositoryIdentities([original], [replacement])).toEqual([]);
    expect(mergeRepositoriesPreservingLocalMetadata([replacement], [original])).toEqual([replacement]);
    expect(replacement).not.toHaveProperty('custom_description');
  });

  it('reports same-name ambiguity instead of choosing the first candidate', () => {
    expect(inspectRepositoryIdentities([repository(oldId)], [
      repository(newId), repository(newId + 1, { full_name: 'OWNER/SAMPLE' }),
    ])).toEqual([{
      oldId, fullName: 'owner/sample', candidates: [newId, newId + 1], reason: 'ambiguous-name',
    }]);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid incoming ID %s before producing candidates', id => {
      expect(() => inspectRepositoryIdentities([repository(oldId)], [repository(id)]))
        .toThrow('INVALID_OR_DUPLICATE_GITHUB_ID');
    },
  );

  it('rejects duplicate incoming IDs even when their names differ', () => {
    expect(() => inspectRepositoryIdentities([repository(oldId)], [
      repository(newId), repository(newId, { full_name: 'owner/other' }),
    ])).toThrow('INVALID_OR_DUPLICATE_GITHUB_ID');
  });
});

describe('explicit repository identity mappings', () => {
  it('distinguishes valid numeric IDs from legacy-generator evidence without claiming identity proof', () => {
    expect(isValidRepositoryId(newId)).toBe(true);
    expect(isLegacySyntheticRepositoryId(newId)).toBe(false);
    expect(isLegacySyntheticRepositoryId(oldId)).toBe(true);
    expect(isValidRepositoryId(String(newId))).toBe(false);
    expect(isValidRepositoryId(undefined)).toBe(false);
    expect(isLegacySyntheticRepositoryId(100_000_000_000)).toBe(true);
    expect(isLegacySyntheticRepositoryId(99_999_999_999)).toBe(false);
  });

  it.each([
    { ...mapping, oldId: newId },
    { ...mapping, newId: 0 },
    { ...mapping, newId: oldId },
    { ...mapping, fullName: 'invalid/name/extra' },
    { ...mapping, fullName: 'owner/with space' },
    { ...mapping, evidence: '  ' },
  ])('rejects malformed or unconfirmed mappings: %j', invalid => {
    expect(() => validateRepositoryIdentityMappings([invalid]))
      .toThrow('INVALID_OR_AMBIGUOUS_IDENTITY_MAPPING');
  });

  it('rejects duplicate sources, duplicate targets and chained mappings before changing input', () => {
    for (const mappings of [
      [mapping, { ...mapping, newId: newId + 1 }],
      [mapping, { ...mapping, oldId: oldId + 1 }],
      [{ ...mapping, newId: oldId + 1 }, { ...mapping, oldId: oldId + 1 }],
    ]) {
      const input = [repository(oldId), repository(oldId + 1)];
      const before = structuredClone(input);
      expect(() => remapRepositoryList(input, mappings)).toThrow(/IDENTITY_MAPPING/);
      expect(input).toEqual(before);
    }
  });

  it('refuses a source renamed after confirmation and a target whose name was reused', () => {
    const renamedSource = [repository(oldId, { full_name: 'owner/renamed' })];
    const reusedTarget = [repository(oldId), repository(newId, { full_name: 'other/repository' })];
    expect(() => remapRepositoryList(renamedSource, [mapping])).toThrow('IDENTITY_SOURCE_CHANGED');
    expect(() => remapRepositoryList(reusedTarget, [mapping])).toThrow('IDENTITY_TARGET_COLLISION');
    expect(renamedSource[0].id).toBe(oldId);
    expect(reusedTarget.map(repo => repo.id)).toEqual([oldId, newId]);
  });

  const conflicts: [string, Partial<Repository>, Partial<Repository>][] = [
    ['custom_description', { custom_description: '' }, { custom_description: 'restore deleted text' }],
    ['custom_tags', { custom_tags: [] }, { custom_tags: ['other'] }],
    ['custom_category', { custom_category: '' }, { custom_category: 'Other' }],
    ['category_id', { category_id: null }, { category_id: 'other' }],
    ['subcategory_id', { subcategory_id: null }, { subcategory_id: 'other' }],
    ['category_locked', { category_locked: true }, { category_locked: false }],
    ['category_candidates', { category_candidates: [] }, { category_candidates: ['other'] }],
    ['category_legacy', { category_legacy: { custom_category: '' } }, { category_legacy: { custom_category: 'Other' } }],
    ['ai_summary', { ai_summary: '' }, { ai_summary: 'other analysis' }],
    ['ai_tags', { ai_tags: [] }, { ai_tags: ['other'] }],
    ['ai_platforms', { ai_platforms: [] }, { ai_platforms: ['other'] }],
    ['ai_details', { ai_details: details }, { ai_details: { ...details, features: ['other'] } }],
  ];
  it.each(conflicts)('rejects conflicting %s metadata atomically, including intentional empties', (_field, sourcePatch, targetPatch) => {
    const input = [repository(oldId, sourcePatch), repository(newId, targetPatch)];
    const before = structuredClone(input);
    expect(() => remapRepositoryList(input, [mapping])).toThrow('IDENTITY_METADATA_COLLISION');
    expect(input).toEqual(before);
  });

  it('preserves manual clears, null membership and locks while retaining canonical target identity', () => {
    const source = repository(oldId, {
      custom_description: '', custom_tags: [], custom_category: '', category_locked: true,
      category_id: null, subcategory_id: null, category_candidates: [],
      category_legacy: { custom_category: '', category_locked: true },
      ai_summary: 'retained analysis', ai_details: details,
      vector_indexed_identity: 'old-identity', vector_indexed_generation: 'old-generation',
    });
    const target = repository(newId, {
      full_name: 'Owner/Sample', html_url: 'https://github.com/Owner/Sample',
      owner: { login: 'Owner', avatar_url: 'canonical-avatar' },
    });
    const input = [source, target];
    const before = structuredClone(input);
    const result = remapRepositoryList(input, [mapping]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: newId, full_name: target.full_name, html_url: target.html_url, owner: target.owner,
      custom_description: '', custom_tags: [], custom_category: '', category_locked: true,
      category_id: null, subcategory_id: null, category_candidates: [],
      ai_summary: 'retained analysis', ai_details: details,
    });
    expect(result[0].vector_indexed_identity).toBeUndefined();
    expect(result[0].vector_indexed_generation).toBeUndefined();
    expect(input).toEqual(before);
    expect(remapRepositoryList(result, [mapping])).toEqual(result);
  });

  it('accepts agreeing defined metadata and preserves target-only metadata', () => {
    const source = repository(oldId, { custom_description: '', custom_tags: [] });
    const target = repository(newId, { custom_description: '', custom_tags: [], ai_summary: 'target-only' });
    expect(remapRepositoryList([source, target], [mapping])[0]).toMatchObject({
      id: newId, custom_description: '', custom_tags: [], ai_summary: 'target-only',
    });
  });

  it('does not resurrect an absent source during replay; canonical tombstones are not live Repository rows', () => {
    expect(remapRepositoryList([], [mapping])).toEqual([]);
    const targetOnly = [repository(newId, { custom_description: 'already migrated' })];
    expect(remapRepositoryList(targetOnly, [mapping])).toEqual(targetOnly);
    const unrelated = [repository(newId + 1, { full_name: 'owner/other' })];
    expect(remapRepositoryList(unrelated, [mapping])).toEqual(unrelated);
  });
});
