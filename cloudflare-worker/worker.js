// cloudflare-worker/src/metadata.ts
var VECTORIZE_METADATA_SAFE_BYTES = 9500;
var encoder = new TextEncoder();
function utf8ByteLength(value) {
  return encoder.encode(value).byteLength;
}
function jsonByteLength(value) {
  return utf8ByteLength(JSON.stringify(value) ?? "");
}
function truncateUtf8(value, maxBytes) {
  if (maxBytes <= 0) return "";
  if (utf8ByteLength(value) <= maxBytes) return value;
  const codePoints = Array.from(value);
  let low = 0;
  let high = codePoints.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (utf8ByteLength(codePoints.slice(0, middle).join("")) <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return codePoints.slice(0, low).join("");
}
function normalizeMetadata(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const metadata = {
    full_name: typeof source.full_name === "string" ? source.full_name : "",
    description: typeof source.description === "string" ? source.description : "",
    language: typeof source.language === "string" ? source.language : "",
    stars: typeof source.stars === "number" && Number.isFinite(source.stars) ? source.stars : 0,
    tags: Array.isArray(source.tags) ? source.tags.filter((tag) => typeof tag === "string") : []
  };
  if (typeof source.license === "string") metadata.license = source.license;
  return metadata;
}
function truncateTags(tags, maxBytes) {
  if (maxBytes <= 0) return [];
  const result = [];
  for (const tag of tags) {
    const candidate = [...result, tag];
    if (jsonByteLength(candidate) <= maxBytes) {
      result.push(tag);
      continue;
    }
    const codePoints = Array.from(tag);
    let low = 0;
    let high = codePoints.length;
    let best = "";
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const shortened = codePoints.slice(0, middle).join("");
      if (jsonByteLength([...result, shortened]) <= maxBytes) {
        best = shortened;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (best) result.push(best);
    break;
  }
  return result;
}
function compactVectorMetadata(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : null;
  if (source && jsonByteLength(source) <= VECTORIZE_METADATA_SAFE_BYTES) {
    return { ...source };
  }
  const metadata = normalizeMetadata(input);
  if (jsonByteLength(metadata) <= VECTORIZE_METADATA_SAFE_BYTES) {
    return { ...metadata };
  }
  const variableBytes = Math.max(
    utf8ByteLength(metadata.description),
    jsonByteLength(metadata.tags)
  );
  let low = 0;
  let high = variableBytes;
  let best = { ...metadata, description: "", tags: [] };
  while (low <= high) {
    const cap = Math.floor((low + high) / 2);
    const candidate = {
      ...source ?? metadata,
      description: truncateUtf8(metadata.description, cap),
      tags: truncateTags(metadata.tags, cap)
    };
    if (jsonByteLength(candidate) <= VECTORIZE_METADATA_SAFE_BYTES) {
      best = candidate;
      low = cap + 1;
    } else {
      high = cap - 1;
    }
  }
  if (jsonByteLength(best) <= VECTORIZE_METADATA_SAFE_BYTES) return best;
  const fallback = {
    full_name: truncateUtf8(metadata.full_name, 512),
    description: "",
    language: truncateUtf8(metadata.language, 128),
    stars: metadata.stars,
    tags: []
  };
  if (metadata.license) fallback.license = truncateUtf8(metadata.license, 256);
  if (jsonByteLength(fallback) > VECTORIZE_METADATA_SAFE_BYTES) delete fallback.license;
  return fallback;
}
function compactUpsertVectors(vectors) {
  return vectors.map((vector) => {
    if (vector.metadata === void 0) {
      return { ...vector };
    }
    return {
      ...vector,
      metadata: compactVectorMetadata(vector.metadata)
    };
  });
}

// cloudflare-worker/src/index.ts
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
function json(data, status = 200) {
  return Response.json(data, { status, headers: CORS_HEADERS });
}
function validScope(scope) {
  return !!scope && typeof scope.identityHash === "string" && /^[a-f0-9]{64}$/.test(scope.identityHash) && typeof scope.namespace === "string" && new RegExp(`^g${scope.identityHash.slice(0, 12)}[a-f0-9]{32}$`).test(scope.namespace) && Number.isInteger(scope.dimensions) && scope.dimensions > 0;
}
var validId = (id) => typeof id === "string" && /^\d{1,16}$/.test(id);
var validHash = (hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash);
var scopedId = (scope, id) => `${scope.namespace}:${id}`;
var validVector = (values, dimensions) => Array.isArray(values) && values.length === dimensions && values.every((n) => typeof n === "number" && Number.isFinite(n));
var identityIds = (mappings) => mappings.flatMap((mapping) => [String(mapping.oldId), String(mapping.newId)]);
function validIdentityMappings(value) {
  if (!Array.isArray(value) || value.length > 500) return false;
  const old = /* @__PURE__ */ new Set(), next = /* @__PURE__ */ new Set(), names = /* @__PURE__ */ new Set();
  for (const mapping of value) {
    if (!mapping || !Number.isSafeInteger(mapping.oldId) || mapping.oldId < 1e11 || !Number.isSafeInteger(mapping.newId) || mapping.newId <= 0 || mapping.oldId === mapping.newId || typeof mapping.fullName !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(mapping.fullName) || mapping.fullName.length > 512 || typeof mapping.evidence !== "string" || !mapping.evidence.trim() || old.has(mapping.oldId) || next.has(mapping.newId) || names.has(mapping.fullName.toLowerCase())) return false;
    old.add(mapping.oldId);
    next.add(mapping.newId);
    names.add(mapping.fullName.toLowerCase());
  }
  return !value.some((mapping) => old.has(mapping.newId));
}
function sameVector(left, right) {
  if (!left || !right) return left === right;
  const metadata = (vector) => JSON.stringify(Object.entries(vector.metadata ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  return left.id === right.id && left.namespace === right.namespace && JSON.stringify(left.values) === JSON.stringify(right.values) && metadata(left) === metadata(right);
}
function validateIdentityVector(scope, id, vector) {
  if (vector.id !== scopedId(scope, id) || vector.namespace !== scope.namespace || vector.metadata?.identity_hash !== scope.identityHash || !validHash(vector.metadata?.content_hash) || typeof vector.metadata?.full_name !== "string" || !validVector(vector.values, scope.dimensions)) {
    throw new Error("Vector identity scope, content hash or dimensions conflict");
  }
}
async function identitySnapshot(env, scope, ids) {
  const byId = /* @__PURE__ */ new Map();
  const requested = new Set(ids.map((id) => scopedId(scope, id)));
  for (let offset = 0; offset < ids.length; offset += 100) {
    const vectors = await env.VECTORIZE.getByIds(ids.slice(offset, offset + 100).map((id) => scopedId(scope, id)));
    for (const vector of vectors) {
      if (!requested.has(vector.id) || byId.has(vector.id)) throw new Error("Vector snapshot returned an unexpected identity");
      const id = vector.id.slice(scope.namespace.length + 1);
      validateIdentityVector(scope, id, vector);
      byId.set(vector.id, vector);
    }
  }
  return ids.map((id) => ({ id, vector: byId.get(scopedId(scope, id)) ?? null }));
}
function validateIdentityBackup(scope, mappings, backup) {
  if (!backup || backup.version !== 1 || !validScope(backup.scope) || backup.scope.namespace !== scope.namespace || backup.scope.identityHash !== scope.identityHash || backup.scope.dimensions !== scope.dimensions || JSON.stringify(backup.mappings) !== JSON.stringify(mappings) || !Array.isArray(backup.records)) throw new Error("Vector identity backup scope conflict");
  const ids = new Set(identityIds(mappings));
  const records = /* @__PURE__ */ new Map();
  for (const record of backup.records) {
    if (!record || !ids.has(record.id) || records.has(record.id) || record.vector === void 0) {
      throw new Error("Invalid vector identity backup");
    }
    if (record.vector) validateIdentityVector(scope, record.id, record.vector);
    records.set(record.id, record.vector);
  }
  if (records.size !== ids.size) throw new Error("Incomplete vector identity backup");
  for (const mapping of mappings) {
    const source = records.get(String(mapping.oldId));
    const target = records.get(String(mapping.newId));
    for (const vector of [source, target]) {
      if (vector && String(vector.metadata.full_name).toLowerCase() !== mapping.fullName.toLowerCase()) {
        throw new Error("Vector repository name conflict");
      }
    }
    if (source && target) throw new Error("Vector repository identity collision");
  }
  return records;
}
var migratedVector = (scope, mapping, source) => ({
  ...source,
  id: scopedId(scope, String(mapping.newId)),
  namespace: scope.namespace,
  metadata: { ...source.metadata, repository_identity_stale: true, repository_identity_old_id: String(mapping.oldId) }
});
function assertIdentityCurrentState(scope, mappings, original, current) {
  for (const mapping of mappings) {
    const oldId = String(mapping.oldId), newId = String(mapping.newId);
    const oldVector = original.get(oldId);
    const targetVector = original.get(newId);
    const oldNow = current.get(oldId);
    const newNow = current.get(newId);
    const migrated = oldVector ? migratedVector(scope, mapping, oldVector) : targetVector;
    if (!sameVector(oldNow, oldVector) && !(oldVector && oldNow === null)) throw new Error("Vector source changed after backup");
    if (!sameVector(newNow, targetVector) && !sameVector(newNow, migrated)) throw new Error("Vector target conflict after backup");
    if (oldVector && oldNow === null && !sameVector(newNow, migrated)) {
      throw new Error("Vector identity restore conflict: identity disappeared after backup");
    }
  }
}
async function mutateIdentityStorage(env, scope, mappings, backup, restore, phase, mutationId, watermark) {
  const original = validateIdentityBackup(scope, mappings, backup);
  const current = new Map((await identitySnapshot(env, scope, identityIds(mappings))).map((record) => [record.id, record.vector]));
  assertIdentityCurrentState(scope, mappings, original, current);
  const writes = [];
  const deletions = [];
  let changed = 0;
  for (const mapping of mappings) {
    const oldId = String(mapping.oldId), newId = String(mapping.newId);
    const oldVector = original.get(oldId);
    const targetVector = original.get(newId);
    const oldNow = current.get(oldId);
    const newNow = current.get(newId);
    const migrated = oldVector ? migratedVector(scope, mapping, oldVector) : targetVector;
    if (!restore) {
      if (!oldVector) {
        if (oldNow !== null || !sameVector(newNow, targetVector)) throw new Error("Vector source identity changed");
        continue;
      }
      if (oldNow === null) {
        if (!sameVector(newNow, migrated)) throw new Error("Vector identity disappeared after backup");
        continue;
      }
      changed++;
      writes.push(migrated);
      deletions.push(scopedId(scope, oldId));
      if (phase === "delete" && !sameVector(newNow, migrated)) throw new Error("New vector is not confirmed; old vector retained");
    } else {
      if (sameVector(oldNow, oldVector) && sameVector(newNow, targetVector)) continue;
      changed++;
      if (oldVector) writes.push(oldVector);
      if (targetVector) writes.push(targetVector);
      if (!targetVector && newNow) deletions.push(scopedId(scope, newId));
      if (phase === "delete" && (!sameVector(oldNow, oldVector) || targetVector && !sameVector(newNow, targetVector))) {
        throw new Error("Restored vector is not confirmed; migrated vector retained");
      }
    }
  }
  if (!changed) return { success: true, changed: 0, complete: true, entries: [] };
  if (phase === "copy") {
    let acknowledgement = "";
    for (let offset = 0; offset < writes.length; offset += 100) {
      const mutation = await env.VECTORIZE.upsert(writes.slice(offset, offset + 100));
      if (!mutation.mutationId) throw new Error("Vector identity copy did not acknowledge mutation");
      acknowledgement = mutation.mutationId;
    }
    if (!acknowledgement) throw new Error("Vector identity copy requires a visibility acknowledgement");
    return {
      success: true,
      changed,
      mutationId: acknowledgement,
      entries: writes.map((vector) => ({ id: vector.id.slice(scope.namespace.length + 1), contentHash: vector.metadata.content_hash }))
    };
  }
  if (!mutationId || String(watermark) !== mutationId) throw new Error("Vector identity mutation is not confirmed; old vector retained");
  for (let offset = 0; offset < deletions.length; offset += 100) {
    await env.VECTORIZE.deleteByIds(deletions.slice(offset, offset + 100));
  }
  return { success: true, changed, deleted: deletions.length };
}
var index_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
    if (!env.AUTH_TOKEN) return json({ success: false, error: "Server auth not configured" }, 500);
    if (request.headers.get("Authorization") !== `Bearer ${env.AUTH_TOKEN}`) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }
    try {
      const path = new URL(request.url).pathname;
      if (request.method === "GET" && path === "/status") {
        const info2 = await env.VECTORIZE.describe();
        return json({ success: true, protocolVersion: 2, identityStorage: true, identityRestoreCheck: true, dimensions: info2.dimensions, vectorCount: info2.vectorCount });
      }
      if (request.method !== "POST" || !["/upsert", "/query", "/verify", "/delete", "/cleanup", "/identity-snapshot", "/identity-rekey", "/identity-restore", "/identity-restore-check"].includes(path)) {
        return json({ success: false, error: "Not Found" }, 404);
      }
      const body = await request.json();
      const scope = body.scope;
      if (!validScope(scope)) return json({ success: false, error: "Index identity required. Upgrade the client and rebuild the vector index." }, 409);
      const info = await env.VECTORIZE.describe();
      if (info.dimensions !== scope.dimensions) return json({ success: false, error: "Index dimensions mismatch" }, 409);
      if (path === "/identity-snapshot") {
        if (!Array.isArray(body.ids) || body.ids.length > 1e3 || !body.ids.every(validId) || new Set(body.ids).size !== body.ids.length) return json({ success: false, error: "Invalid identity snapshot IDs" }, 400);
        try {
          return json({ success: true, records: await identitySnapshot(env, scope, body.ids) });
        } catch (error) {
          return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 409);
        }
      }
      if (path === "/identity-restore-check") {
        if (!validIdentityMappings(body.mappings)) return json({ success: false, error: "Invalid or ambiguous identity mappings" }, 400);
        try {
          const original = validateIdentityBackup(scope, body.mappings, body.backup);
          const records = await identitySnapshot(env, scope, identityIds(body.mappings));
          assertIdentityCurrentState(scope, body.mappings, original, new Map(records.map((record) => [record.id, record.vector])));
          return json({ success: true, ready: true, records });
        } catch (error) {
          return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 409);
        }
      }
      if (path === "/identity-rekey" || path === "/identity-restore") {
        if (!validIdentityMappings(body.mappings) || !["copy", "delete"].includes(body.phase ?? "")) {
          return json({ success: false, error: "Invalid or ambiguous identity mappings" }, 400);
        }
        try {
          return json(await mutateIdentityStorage(
            env,
            scope,
            body.mappings,
            body.backup,
            path === "/identity-restore",
            body.phase,
            body.mutationId,
            info.processedUpToMutation
          ));
        } catch (error) {
          return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 409);
        }
      }
      if (path === "/upsert") {
        const vectors = body.vectors;
        if (!Array.isArray(vectors) || !vectors.length || vectors.length > 100 || vectors.some((v) => !validId(v.id) || !validVector(v.values, scope.dimensions) || !validHash(v.metadata?.content_hash)) || new Set(vectors.map((v) => v.id)).size !== vectors.length) {
          return json({ success: false, error: "Invalid vector batch, dimensions or content hash" }, 400);
        }
        const compacted = compactUpsertVectors(vectors).map((v, i) => ({
          ...v,
          id: scopedId(scope, v.id),
          namespace: scope.namespace,
          // Restore protocol fields AFTER the oversized-metadata fallback.
          metadata: { ...v.metadata, identity_hash: scope.identityHash, content_hash: vectors[i].metadata.content_hash }
        }));
        const mutation = await env.VECTORIZE.upsert(compacted);
        return json({ success: true, upserted: vectors.length, mutationId: mutation.mutationId });
      }
      if (path === "/query") {
        if (!validVector(body.vector, scope.dimensions)) return json({ success: false, error: "Invalid query dimensions or values" }, 400);
        const topK = Number.isFinite(body.topK) ? Math.min(50, Math.max(1, Math.floor(body.topK))) : 20;
        const threshold = Number.isFinite(body.threshold) ? body.threshold : 0.35;
        const result = await env.VECTORIZE.query(body.vector, {
          namespace: scope.namespace,
          topK,
          returnMetadata: "all"
        });
        const prefix = `${scope.namespace}:`;
        const matches = result.matches.filter((m) => m.id.startsWith(prefix) && validId(m.id.slice(prefix.length)) && m.metadata?.identity_hash === scope.identityHash && Number.isFinite(m.score) && m.score >= threshold).map((m) => ({ ...m, id: m.id.slice(prefix.length) }));
        return json({ success: true, matches });
      }
      if (path === "/verify") {
        const entries = body.entries;
        if (!body.mutationId || !Array.isArray(entries) || !entries.length || entries.length > 100 || entries.some((e) => !validId(e.id) || !validHash(e.contentHash))) {
          return json({ success: false, error: "Invalid verification request" }, 400);
        }
        if (String(info.processedUpToMutation) !== body.mutationId) return json({ success: true, ready: false });
        const vectors = await env.VECTORIZE.getByIds(entries.map((e) => scopedId(scope, e.id)));
        const byId = new Map(vectors.map((v) => [v.id, v]));
        const ready = entries.every((e) => {
          const v = byId.get(scopedId(scope, e.id));
          return v?.namespace === scope.namespace && v.metadata?.identity_hash === scope.identityHash && v.metadata?.content_hash === e.contentHash && validVector(v.values, scope.dimensions);
        });
        return json({ success: true, ready });
      }
      if (path === "/delete") {
        if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100 || !body.ids.every(validId)) {
          return json({ success: false, error: "Invalid repository IDs" }, 400);
        }
        await env.VECTORIZE.deleteByIds(body.ids.map((id) => scopedId(scope, id)));
        return json({ success: true, deleted: body.ids.length });
      }
      return json({ success: false, error: "Automatic cleanup disabled. Retained generations require explicit administration." }, 409);
    } catch (error) {
      return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }
};
export {
  index_default as default
};
