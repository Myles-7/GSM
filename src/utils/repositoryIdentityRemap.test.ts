import { describe, expect, it } from 'vitest';
import type { Repository } from '../types';
import {
  assertRepositoryIdentityName, remapParticipantRepositoryIds, remapParticipantRepositoryList, validateParticipantMappings,
} from './repositoryIdentityRemap';

const oldId = 1_700_000_000_001;
const mappings = [{ oldId, newId: 42, fullName: 'owner/repo', evidence: 'User confirmed GitHub metadata' }];
const repository = (id = oldId, full_name = 'owner/repo') => ({ id, full_name, name: 'repo',
  stargazers_count: oldId, custom_description: String(oldId), category_locked: true } as Repository);

describe('pure participant identity remapping', () => {
  it('rejects invalid mappings and ambiguous case-insensitive names', () => {
    expect(() => validateParticipantMappings(mappings)).not.toThrow();
    expect(() => validateParticipantMappings([{ ...mappings[0], evidence: '' }])).toThrow('INVALID');
    expect(() => validateParticipantMappings([...mappings, { ...mappings[0], oldId: oldId + 1, newId: 43,
      fullName: 'OWNER/REPO' }])).toThrow('AMBIGUOUS_IDENTITY_NAME');
  });

  it('checks both legacy and canonical IDs against the confirmed repository name', () => {
    for (const id of [oldId, 42]) {
      expect(() => assertRepositoryIdentityName(id, 'Owner/Repo', mappings)).not.toThrow();
      expect(() => assertRepositoryIdentityName(id, 'other/repo', mappings)).toThrow('NAME_CONFLICT');
    }
    expect(() => assertRepositoryIdentityName(43, 'other/repo', mappings)).not.toThrow();
  });

  it('rewrites only identity fields without mutating counters, descriptions or input records', () => {
    const source = [repository(), repository(43, 'other/repo')];
    const before = structuredClone(source);
    const result = remapParticipantRepositoryList(source, mappings);
    expect(result[0]).toEqual({ ...source[0], id: 42 });
    expect(result[0]).toMatchObject({ stargazers_count: oldId, custom_description: String(oldId), category_locked: true });
    expect(result[1]).toBe(source[1]);
    expect(source).toEqual(before);
  });

  it('rejects target collisions and name conflicts without changing the original records', () => {
    const source = [repository(), repository(42)];
    expect(() => remapParticipantRepositoryList(source, mappings)).toThrow('COLLISION');
    expect(source[0].id).toBe(oldId);
    expect(() => remapParticipantRepositoryList([repository(oldId, 'other/repo')], mappings)).toThrow('NAME_CONFLICT');
  });

  it('keeps no-op references and deduplicates remapped identity lists', () => {
    const source = [repository(42)];
    expect(remapParticipantRepositoryList(source, mappings)).toBe(source);
    const untouched = [42, 43];
    expect(remapParticipantRepositoryIds(untouched, mappings)).toBe(untouched);
    const ids = [oldId, 42, 43, oldId];
    expect(remapParticipantRepositoryIds(ids, mappings)).toEqual([42, 43]);
    expect(ids).toEqual([oldId, 42, 43, oldId]);
  });
});
