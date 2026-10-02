import type { VectorizeVector } from './vectorSearchService';
import type { RepositoryIdentityMapping } from '../utils/repositoryIdentity';
import { assertRepositoryIdentityName, validateParticipantMappings } from './repositoryIdentityParticipants';
import type { VectorIndexScope } from './vectorIndexIdentity';

export interface RemoteRepositoryIdentityVector {
  id: string;
  namespace: string;
  values: number[];
  metadata: Record<string, unknown>;
}
export interface VectorRepositoryIdentityBackup {
  version: 1;
  workerUrl: string;
  scope: VectorIndexScope;
  mappings: RepositoryIdentityMapping[];
  records: Array<{ id: string; vector: RemoteRepositoryIdentityVector | null }>;
}
export const vectorRepositoryIdentityIds = (mappings: ReadonlyArray<RepositoryIdentityMapping>): string[] =>
  mappings.flatMap(mapping => [String(mapping.oldId), String(mapping.newId)]);

export function equalRepositoryIdentityVectors(
  left: RemoteRepositoryIdentityVector | null, right: RemoteRepositoryIdentityVector | null,
): boolean {
  if (!left || !right) return left === right;
  const metadata = (vector: RemoteRepositoryIdentityVector) =>
    JSON.stringify(Object.entries(vector.metadata).sort(([a], [b]) => a.localeCompare(b)));
  return left.id === right.id && left.namespace === right.namespace
    && JSON.stringify(left.values) === JSON.stringify(right.values) && metadata(left) === metadata(right);
}
export const migratedRepositoryIdentityVector = (
  scope: VectorIndexScope, mapping: RepositoryIdentityMapping, source: RemoteRepositoryIdentityVector,
): RemoteRepositoryIdentityVector => ({
  ...source, id: `${scope.namespace}:${mapping.newId}`,
  metadata: { ...source.metadata, repository_identity_stale: true, repository_identity_old_id: String(mapping.oldId) },
});

export function validateVectorRepositoryIdentityBackup(
  backup: VectorRepositoryIdentityBackup, workerUrl: string, scope: VectorIndexScope,
  mappings: ReadonlyArray<RepositoryIdentityMapping>,
): void {
  validateParticipantMappings(mappings);
  if (!backup || backup.version !== 1 || backup.workerUrl !== workerUrl
    || backup.scope?.namespace !== scope.namespace || backup.scope.identityHash !== scope.identityHash
    || backup.scope.dimensions !== scope.dimensions || JSON.stringify(backup.mappings) !== JSON.stringify(mappings)
    || !Array.isArray(backup.records) || mappings.length > 500) throw new Error('VECTOR_IDENTITY_BACKUP_SCOPE_CONFLICT');
  const ids = new Set(vectorRepositoryIdentityIds(mappings));
  const seen = new Set<string>();
  for (const record of backup.records) {
    if (!record || !ids.has(record.id) || seen.has(record.id) || record.vector === undefined) {
      throw new Error('INVALID_VECTOR_IDENTITY_BACKUP');
    }
    seen.add(record.id);
    const vector = record.vector;
    if (vector) {
      if (vector.id !== `${scope.namespace}:${record.id}` || vector.namespace !== scope.namespace
        || vector.metadata?.identity_hash !== scope.identityHash
        || typeof vector.metadata?.content_hash !== 'string' || !/^[a-f0-9]{64}$/.test(vector.metadata.content_hash)
        || !Array.isArray(vector.values) || vector.values.length !== scope.dimensions || !vector.values.every(Number.isFinite)) {
        throw new Error('VECTOR_IDENTITY_BACKUP_VECTOR_CONFLICT');
      }
      assertRepositoryIdentityName(Number(record.id), vector.metadata.full_name as string, mappings);
    }
  }
  if (seen.size !== ids.size) throw new Error('INCOMPLETE_VECTOR_IDENTITY_BACKUP');
  const records = new Map(backup.records.map(record => [record.id, record.vector]));
  for (const mapping of mappings) {
    if (records.get(String(mapping.oldId)) && records.get(String(mapping.newId))) throw new Error('VECTOR_IDENTITY_COLLISION');
  }
}

/** Only the original, deterministic rekey or interrupted copy states can be restored. */
export function assertRestorableRepositoryIdentitySnapshot(
  backup: VectorRepositoryIdentityBackup,
  records: VectorRepositoryIdentityBackup['records'],
): void {
  const ids = new Set(vectorRepositoryIdentityIds(backup.mappings));
  if (!Array.isArray(records) || records.length !== ids.size
    || new Set(records.map(record => record?.id)).size !== ids.size
    || records.some(record => !record || !ids.has(record.id) || (record.vector !== null
      && (!record.vector || typeof record.vector !== 'object' || Array.isArray(record.vector))))) {
    throw new Error('VECTOR_IDENTITY_RESTORE_SNAPSHOT_CONFLICT');
  }
  const original = new Map(backup.records.map(record => [record.id, record.vector]));
  const current = new Map(records.map(record => [record.id, record.vector]));
  for (const mapping of backup.mappings) {
    const oldId = String(mapping.oldId), newId = String(mapping.newId);
    const source = original.get(oldId)!;
    const target = original.get(newId)!;
    const oldNow = current.get(oldId)!;
    const newNow = current.get(newId)!;
    const originalState = equalRepositoryIdentityVectors(oldNow, source) && equalRepositoryIdentityVectors(newNow, target);
    const rekeyState = source !== null
      && (oldNow === null || equalRepositoryIdentityVectors(oldNow, source))
      && equalRepositoryIdentityVectors(newNow, migratedRepositoryIdentityVector(backup.scope, mapping, source));
    if (!originalState && !rekeyState) throw new Error('VECTOR_IDENTITY_RESTORE_CONFLICT: remote identity changed after backup');
  }
}

export type RepositoryIdentityVectorRecord = Omit<VectorizeVector, 'metadata'> & {
  namespace: string;
  metadata: VectorizeVector['metadata'] & { repository_identity_stale?: boolean };
};

/** Transform an adapter-supplied snapshot, never fetching vectors or regenerating embeddings. */
export function remapVectorRepositoryIdentityRecords(
  namespace: string,
  records: RepositoryIdentityVectorRecord[],
  mappings: ReadonlyArray<RepositoryIdentityMapping>,
): RepositoryIdentityVectorRecord[] {
  if (!namespace.trim()) throw new Error('VECTOR_NAMESPACE_REQUIRED');
  validateParticipantMappings(mappings);
  const ids = new Set<string>();
  let changed = false;
  const result = records.map(record => {
    if (record.namespace !== namespace) throw new Error('VECTOR_NAMESPACE_CONFLICT');
    const prefix = `${namespace}:`;
    const scoped = record.id.startsWith(prefix);
    const localId = scoped ? record.id.slice(prefix.length) : record.id;
    if (!/^[1-9]\d*$/.test(localId) || !Number.isSafeInteger(Number(localId))) {
      throw new Error('INVALID_VECTOR_REPOSITORY_IDENTITY');
    }
    const id = Number(localId);
    assertRepositoryIdentityName(id, record.metadata.full_name, mappings);
    const mapping = mappings.find(item => item.oldId === id);
    const nextId = String(mapping?.newId ?? id);
    if (ids.has(nextId)) throw new Error('VECTOR_IDENTITY_COLLISION');
    ids.add(nextId);
    if (!mapping) return record;
    changed = true;
    return {
      ...record, id: `${scoped ? prefix : ''}${nextId}`,
      metadata: { ...record.metadata, repository_identity_stale: true },
    };
  });
  return changed ? result : records;
}
