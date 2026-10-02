import { compactUpsertVectors } from './metadata';

// Structural types keep this handler testable without Cloudflare runtime globals.
interface Scope { namespace: string; identityHash: string; dimensions: number }
interface Vector {
  id: string;
  values: number[];
  namespace?: string;
  metadata?: Record<string, unknown>;
}
interface Match { id: string; score: number; metadata?: Record<string, unknown> }
interface Env {
  AUTH_TOKEN: string;
  VECTORIZE: {
    describe(): Promise<{ dimensions: number; vectorCount: number; processedUpToMutation?: string | number }>;
    upsert(vectors: Vector[]): Promise<{ mutationId: string }>;
    query(vector: number[], options: { namespace: string; topK: number; returnMetadata: 'all' }): Promise<{ matches: Match[] }>;
    getByIds(ids: string[]): Promise<Vector[]>;
    deleteByIds(ids: string[]): Promise<unknown>;
  };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: CORS_HEADERS });
}
function validScope(scope: Scope | undefined): scope is Scope {
  return !!scope && typeof scope.identityHash === 'string' && /^[a-f0-9]{64}$/.test(scope.identityHash) &&
    typeof scope.namespace === 'string' &&
    new RegExp(`^g${scope.identityHash.slice(0, 12)}[a-f0-9]{32}$`).test(scope.namespace) &&
    Number.isInteger(scope.dimensions) && scope.dimensions > 0;
}
const validId = (id: unknown): id is string => typeof id === 'string' && /^\d{1,16}$/.test(id);
const validHash = (hash: unknown) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
const scopedId = (scope: Scope, id: string) => `${scope.namespace}:${id}`;
const validVector = (values: unknown, dimensions: number): values is number[] =>
  Array.isArray(values) && values.length === dimensions && values.every((n) => typeof n === 'number' && Number.isFinite(n));

interface IdentityMapping { oldId: number; newId: number; fullName: string; evidence: string }
interface IdentityRecord { id: string; vector: Vector | null }
interface IdentityBackup { version: 1; scope: Scope; mappings: IdentityMapping[]; records: IdentityRecord[] }
const identityIds = (mappings: IdentityMapping[]) => mappings.flatMap(mapping => [String(mapping.oldId), String(mapping.newId)]);
function validIdentityMappings(value: unknown): value is IdentityMapping[] {
  if (!Array.isArray(value) || value.length > 500) return false;
  const old = new Set<number>(), next = new Set<number>(), names = new Set<string>();
  for (const mapping of value) {
    if (!mapping || !Number.isSafeInteger(mapping.oldId) || mapping.oldId < 1e11
      || !Number.isSafeInteger(mapping.newId) || mapping.newId <= 0 || mapping.oldId === mapping.newId
      || typeof mapping.fullName !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(mapping.fullName)
      || mapping.fullName.length > 512 || typeof mapping.evidence !== 'string' || !mapping.evidence.trim()
      || old.has(mapping.oldId) || next.has(mapping.newId) || names.has(mapping.fullName.toLowerCase())) return false;
    old.add(mapping.oldId); next.add(mapping.newId); names.add(mapping.fullName.toLowerCase());
  }
  return !value.some(mapping => old.has(mapping.newId));
}
function sameVector(left: Vector | null, right: Vector | null): boolean {
  if (!left || !right) return left === right;
  const metadata = (vector: Vector) => JSON.stringify(Object.entries(vector.metadata ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  return left.id === right.id && left.namespace === right.namespace
    && JSON.stringify(left.values) === JSON.stringify(right.values) && metadata(left) === metadata(right);
}
function validateIdentityVector(scope: Scope, id: string, vector: Vector): void {
  if (vector.id !== scopedId(scope, id) || vector.namespace !== scope.namespace
    || vector.metadata?.identity_hash !== scope.identityHash || !validHash(vector.metadata?.content_hash)
    || typeof vector.metadata?.full_name !== 'string' || !validVector(vector.values, scope.dimensions)) {
    throw new Error('Vector identity scope, content hash or dimensions conflict');
  }
}
async function identitySnapshot(env: Env, scope: Scope, ids: string[]): Promise<IdentityRecord[]> {
  const byId = new Map<string, Vector>();
  const requested = new Set(ids.map(id => scopedId(scope, id)));
  for (let offset = 0; offset < ids.length; offset += 100) {
    const vectors = await env.VECTORIZE.getByIds(ids.slice(offset, offset + 100).map(id => scopedId(scope, id)));
    for (const vector of vectors) {
      if (!requested.has(vector.id) || byId.has(vector.id)) throw new Error('Vector snapshot returned an unexpected identity');
      const id = vector.id.slice(scope.namespace.length + 1);
      validateIdentityVector(scope, id, vector);
      byId.set(vector.id, vector);
    }
  }
  return ids.map(id => ({ id, vector: byId.get(scopedId(scope, id)) ?? null }));
}
function validateIdentityBackup(scope: Scope, mappings: IdentityMapping[], backup: IdentityBackup | undefined): Map<string, Vector | null> {
  if (!backup || backup.version !== 1 || !validScope(backup.scope)
    || backup.scope.namespace !== scope.namespace || backup.scope.identityHash !== scope.identityHash
    || backup.scope.dimensions !== scope.dimensions || JSON.stringify(backup.mappings) !== JSON.stringify(mappings)
    || !Array.isArray(backup.records)) throw new Error('Vector identity backup scope conflict');
  const ids = new Set(identityIds(mappings));
  const records = new Map<string, Vector | null>();
  for (const record of backup.records) {
    if (!record || !ids.has(record.id) || records.has(record.id) || record.vector === undefined) {
      throw new Error('Invalid vector identity backup');
    }
    if (record.vector) validateIdentityVector(scope, record.id, record.vector);
    records.set(record.id, record.vector);
  }
  if (records.size !== ids.size) throw new Error('Incomplete vector identity backup');
  for (const mapping of mappings) {
    const source = records.get(String(mapping.oldId));
    const target = records.get(String(mapping.newId));
    for (const vector of [source, target]) {
      if (vector && String(vector.metadata!.full_name).toLowerCase() !== mapping.fullName.toLowerCase()) {
        throw new Error('Vector repository name conflict');
      }
    }
    if (source && target) throw new Error('Vector repository identity collision');
  }
  return records;
}
const migratedVector = (scope: Scope, mapping: IdentityMapping, source: Vector): Vector => ({
  ...source, id: scopedId(scope, String(mapping.newId)), namespace: scope.namespace,
  metadata: { ...source.metadata, repository_identity_stale: true, repository_identity_old_id: String(mapping.oldId) },
});

function assertIdentityCurrentState(
  scope: Scope, mappings: IdentityMapping[], original: Map<string, Vector | null>, current: Map<string, Vector | null>,
): void {
  for (const mapping of mappings) {
    const oldId = String(mapping.oldId), newId = String(mapping.newId);
    const oldVector = original.get(oldId)!;
    const targetVector = original.get(newId)!;
    const oldNow = current.get(oldId)!;
    const newNow = current.get(newId)!;
    const migrated = oldVector ? migratedVector(scope, mapping, oldVector) : targetVector;
    if (!sameVector(oldNow, oldVector) && !(oldVector && oldNow === null)) throw new Error('Vector source changed after backup');
    if (!sameVector(newNow, targetVector) && !sameVector(newNow, migrated)) throw new Error('Vector target conflict after backup');
    // Both keys absent is not an interrupted copy: a later deletion must not be undone.
    if (oldVector && oldNow === null && !sameVector(newNow, migrated)) {
      throw new Error('Vector identity restore conflict: identity disappeared after backup');
    }
  }
}

async function mutateIdentityStorage(
  env: Env, scope: Scope, mappings: IdentityMapping[], backup: IdentityBackup | undefined,
  restore: boolean, phase: 'copy' | 'delete', mutationId: string | undefined, watermark: string | number | undefined,
): Promise<Record<string, unknown>> {
  const original = validateIdentityBackup(scope, mappings, backup);
  const current = new Map((await identitySnapshot(env, scope, identityIds(mappings))).map(record => [record.id, record.vector]));
  assertIdentityCurrentState(scope, mappings, original, current);
  const writes: Vector[] = [];
  const deletions: string[] = [];
  let changed = 0;
  for (const mapping of mappings) {
    const oldId = String(mapping.oldId), newId = String(mapping.newId);
    const oldVector = original.get(oldId)!;
    const targetVector = original.get(newId)!;
    const oldNow = current.get(oldId)!;
    const newNow = current.get(newId)!;
    const migrated = oldVector ? migratedVector(scope, mapping, oldVector) : targetVector;
    if (!restore) {
      if (!oldVector) {
        if (oldNow !== null || !sameVector(newNow, targetVector)) throw new Error('Vector source identity changed');
        continue;
      }
      if (oldNow === null) {
        if (!sameVector(newNow, migrated)) throw new Error('Vector identity disappeared after backup');
        continue;
      }
      changed++;
      writes.push(migrated!);
      deletions.push(scopedId(scope, oldId));
      if (phase === 'delete' && !sameVector(newNow, migrated)) throw new Error('New vector is not confirmed; old vector retained');
    } else {
      if (sameVector(oldNow, oldVector) && sameVector(newNow, targetVector)) continue;
      changed++;
      if (oldVector) writes.push(oldVector);
      if (targetVector) writes.push(targetVector);
      if (!targetVector && newNow) deletions.push(scopedId(scope, newId));
      if (phase === 'delete' && (!sameVector(oldNow, oldVector) || (targetVector && !sameVector(newNow, targetVector)))) {
        throw new Error('Restored vector is not confirmed; migrated vector retained');
      }
    }
  }
  if (!changed) return { success: true, changed: 0, complete: true, entries: [] };
  if (phase === 'copy') {
    let acknowledgement = '';
    for (let offset = 0; offset < writes.length; offset += 100) {
      const mutation = await env.VECTORIZE.upsert(writes.slice(offset, offset + 100));
      if (!mutation.mutationId) throw new Error('Vector identity copy did not acknowledge mutation');
      acknowledgement = mutation.mutationId;
    }
    if (!acknowledgement) throw new Error('Vector identity copy requires a visibility acknowledgement');
    return {
      success: true, changed, mutationId: acknowledgement,
      entries: writes.map(vector => ({ id: vector.id.slice(scope.namespace.length + 1), contentHash: vector.metadata!.content_hash })),
    };
  }
  if (!mutationId || String(watermark) !== mutationId) throw new Error('Vector identity mutation is not confirmed; old vector retained');
  for (let offset = 0; offset < deletions.length; offset += 100) {
    await env.VECTORIZE.deleteByIds(deletions.slice(offset, offset + 100));
  }
  return { success: true, changed, deleted: deletions.length };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    if (!env.AUTH_TOKEN) return json({ success: false, error: 'Server auth not configured' }, 500);
    if (request.headers.get('Authorization') !== `Bearer ${env.AUTH_TOKEN}`) {
      return json({ success: false, error: 'Unauthorized' }, 401);
    }
    try {
      const path = new URL(request.url).pathname;
      if (request.method === 'GET' && path === '/status') {
        const info = await env.VECTORIZE.describe();
        return json({ success: true, protocolVersion: 2, identityStorage: true, identityRestoreCheck: true, dimensions: info.dimensions, vectorCount: info.vectorCount });
      }
      if (request.method !== 'POST' || !['/upsert', '/query', '/verify', '/delete', '/cleanup', '/identity-snapshot', '/identity-rekey', '/identity-restore', '/identity-restore-check'].includes(path)) {
        return json({ success: false, error: 'Not Found' }, 404);
      }
      const body = await request.json() as {
        scope?: Scope; vectors?: Vector[]; vector?: number[]; ids?: string[];
        entries?: Array<{ id: string; contentHash: string }>; mutationId?: string;
        topK?: number; threshold?: number;
        mappings?: IdentityMapping[]; backup?: IdentityBackup; phase?: 'copy' | 'delete';
      };
      const scope = body.scope;
      // No legacy unscoped fallback: older clients must upgrade/rebuild.
      if (!validScope(scope)) return json({ success: false, error: 'Index identity required. Upgrade the client and rebuild the vector index.' }, 409);
      const info = await env.VECTORIZE.describe();
      if (info.dimensions !== scope.dimensions) return json({ success: false, error: 'Index dimensions mismatch' }, 409);

      if (path === '/identity-snapshot') {
        if (!Array.isArray(body.ids) || body.ids.length > 1000 || !body.ids.every(validId)
          || new Set(body.ids).size !== body.ids.length) return json({ success: false, error: 'Invalid identity snapshot IDs' }, 400);
        try { return json({ success: true, records: await identitySnapshot(env, scope, body.ids) }); }
        catch (error) { return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 409); }
      }
      if (path === '/identity-restore-check') {
        if (!validIdentityMappings(body.mappings)) return json({ success: false, error: 'Invalid or ambiguous identity mappings' }, 400);
        try {
          const original = validateIdentityBackup(scope, body.mappings, body.backup);
          const records = await identitySnapshot(env, scope, identityIds(body.mappings));
          assertIdentityCurrentState(scope, body.mappings, original, new Map(records.map(record => [record.id, record.vector])));
          return json({ success: true, ready: true, records });
        } catch (error) {
          return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 409);
        }
      }
      if (path === '/identity-rekey' || path === '/identity-restore') {
        if (!validIdentityMappings(body.mappings) || !['copy', 'delete'].includes(body.phase ?? '')) {
          return json({ success: false, error: 'Invalid or ambiguous identity mappings' }, 400);
        }
        try {
          return json(await mutateIdentityStorage(env, scope, body.mappings, body.backup,
            path === '/identity-restore', body.phase!, body.mutationId, info.processedUpToMutation));
        } catch (error) {
          return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 409);
        }
      }
      if (path === '/upsert') {
        const vectors = body.vectors;
        if (!Array.isArray(vectors) || !vectors.length || vectors.length > 100 ||
            vectors.some((v) => !validId(v.id) || !validVector(v.values, scope.dimensions) || !validHash(v.metadata?.content_hash)) ||
            new Set(vectors.map((v) => v.id)).size !== vectors.length) {
          return json({ success: false, error: 'Invalid vector batch, dimensions or content hash' }, 400);
        }
        const compacted = compactUpsertVectors(vectors).map((v, i) => ({
          ...v,
          id: scopedId(scope, v.id),
          namespace: scope.namespace,
          // Restore protocol fields AFTER the oversized-metadata fallback.
          metadata: { ...v.metadata, identity_hash: scope.identityHash, content_hash: vectors[i].metadata!.content_hash },
        }));
        const mutation = await env.VECTORIZE.upsert(compacted);
        return json({ success: true, upserted: vectors.length, mutationId: mutation.mutationId });
      }
      if (path === '/query') {
        if (!validVector(body.vector, scope.dimensions)) return json({ success: false, error: 'Invalid query dimensions or values' }, 400);
        const topK = Number.isFinite(body.topK) ? Math.min(50, Math.max(1, Math.floor(body.topK!))) : 20;
        const threshold = Number.isFinite(body.threshold) ? body.threshold! : 0.35;
        const result = await env.VECTORIZE.query(body.vector, {
          namespace: scope.namespace, topK, returnMetadata: 'all',
        });
        const prefix = `${scope.namespace}:`;
        const matches = result.matches
          .filter((m) => m.id.startsWith(prefix) && validId(m.id.slice(prefix.length)) &&
            m.metadata?.identity_hash === scope.identityHash && Number.isFinite(m.score) && m.score >= threshold)
          .map((m) => ({ ...m, id: m.id.slice(prefix.length) }));
        return json({ success: true, matches });
      }
      if (path === '/verify') {
        const entries = body.entries;
        if (!body.mutationId || !Array.isArray(entries) || !entries.length || entries.length > 100 ||
            entries.some((e) => !validId(e.id) || !validHash(e.contentHash))) {
          return json({ success: false, error: 'Invalid verification request' }, 400);
        }
        if (String(info.processedUpToMutation) !== body.mutationId) return json({ success: true, ready: false });
        const vectors = await env.VECTORIZE.getByIds(entries.map((e) => scopedId(scope, e.id)));
        const byId = new Map(vectors.map((v) => [v.id, v]));
        const ready = entries.every((e) => {
          const v = byId.get(scopedId(scope, e.id));
          return v?.namespace === scope.namespace && v.metadata?.identity_hash === scope.identityHash &&
            v.metadata?.content_hash === e.contentHash && validVector(v.values, scope.dimensions);
        });
        return json({ success: true, ready });
      }
      if (path === '/delete') {
        if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100 || !body.ids.every(validId)) {
          return json({ success: false, error: 'Invalid repository IDs' }, 400);
        }
        await env.VECTORIZE.deleteByIds(body.ids.map((id) => scopedId(scope, id)));
        return json({ success: true, deleted: body.ids.length });
      }
      // Similarity sampling cannot safely enumerate an index.
      return json({ success: false, error: 'Automatic cleanup disabled. Retained generations require explicit administration.' }, 409);
    } catch (error) {
      return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },
};
