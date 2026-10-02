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
        return json({ success: true, protocolVersion: 2, dimensions: info.dimensions, vectorCount: info.vectorCount });
      }
      if (request.method !== 'POST' || !['/upsert', '/query', '/verify', '/delete', '/cleanup'].includes(path)) {
        return json({ success: false, error: 'Not Found' }, 404);
      }
      const body = await request.json() as {
        scope?: Scope; vectors?: Vector[]; vector?: number[]; ids?: string[];
        entries?: Array<{ id: string; contentHash: string }>; mutationId?: string;
        topK?: number; threshold?: number;
      };
      const scope = body.scope;
      // No legacy unscoped fallback: older clients must upgrade/rebuild.
      if (!validScope(scope)) return json({ success: false, error: 'Index identity required. Upgrade the client and rebuild the vector index.' }, 409);
      const info = await env.VECTORIZE.describe();
      if (info.dimensions !== scope.dimensions) return json({ success: false, error: 'Index dimensions mismatch' }, 409);

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
