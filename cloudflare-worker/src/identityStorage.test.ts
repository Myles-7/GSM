import { webcrypto } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
import { VectorSearchService } from '../../src/services/vectorSearchService';
import type { VectorSearchConfig } from '../../src/types';
import type { VectorIndexGeneration } from '../../src/services/vectorIndexIdentity';

const hash = 'a'.repeat(64);
const scope = { namespace: `g${hash.slice(0, 12)}${'b'.repeat(32)}`, identityHash: hash, dimensions: 3 };
const generation: VectorIndexGeneration = { ...scope, identity: {
  provider: 'openai', endpoint: 'https://embedding.example', model: 'model', dimensions: 3,
  target: 'https://worker.example', mode: 'description', format: 3, readmeMaxChars: 0,
} };
const config = {
  enabled: true, workerUrl: 'https://worker.example', authToken: 'token', activeIndex: generation,
} as VectorSearchConfig;
const oldId = 1700000000000;
const mappings = [{ oldId, newId: 42, fullName: 'owner/repo', evidence: 'Canonical identity confirmed' }];
type Vector = Parameters<Parameters<typeof worker.fetch>[1]['VECTORIZE']['upsert']>[0][number];
const vector = (id = oldId, namespace = scope.namespace): Vector => ({
  id: `${namespace}:${id}`, namespace, values: [1, 2, 3],
  metadata: { full_name: 'owner/repo', content_hash: 'c'.repeat(64), identity_hash: hash, extra: 'preserved' },
});

function fakeWorker(implementation: typeof worker) {
  const stored = new Map<string, Vector>();
  let mutation = '';
  let count = 0;
  const binding = {
    describe: vi.fn(async () => ({ dimensions: 3, vectorCount: stored.size, processedUpToMutation: mutation })),
    upsert: vi.fn(async (vectors: Vector[]) => {
      for (const item of vectors) stored.set(item.id, structuredClone(item));
      mutation = `mutation-${++count}`;
      return { mutationId: mutation };
    }),
    query: vi.fn(async () => ({ matches: [] })),
    getByIds: vi.fn(async (ids: string[]) => ids.flatMap(id => stored.has(id) ? [structuredClone(stored.get(id)!)] : [])),
    deleteByIds: vi.fn(async (ids: string[]) => { ids.forEach(id => stored.delete(id)); return { mutationId: `delete-${++count}` }; }),
  };
  const env = { AUTH_TOKEN: 'token', VECTORIZE: binding };
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (!String(url).startsWith(config.workerUrl)) throw new Error('Live network forbidden');
    return implementation.fetch(new Request(url, init), env);
  });
  vi.stubGlobal('fetch', fetch);
  const service = new VectorSearchService(config, undefined, generation);
  return { stored, binding, env, fetch, service };
}
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe.each(['source', 'dashboard'] as const)('remote vector identity storage participant (%s)', artifact => {
  let implementation: typeof worker;
  beforeEach(async () => {
    implementation = artifact === 'source' ? worker
      : (await import(/* @vite-ignore */ pathToFileURL(resolve('cloudflare-worker/worker.js')).href) as { default: typeof worker }).default;
  });

  it('backs up absent targets, migrates with visibility before deletion, and restores exactly', async () => {
    const fake = fakeWorker(implementation);
    const original = vector();
    fake.stored.set(original.id, original);
    const foreign = vector(oldId, `g${hash.slice(0, 12)}${'d'.repeat(32)}`);
    fake.stored.set(foreign.id, foreign);
    const backup = JSON.parse(JSON.stringify(await fake.service.backupRepositoryIdentities(mappings)));
    expect(backup.records).toEqual([{ id: String(oldId), vector: original }, { id: '42', vector: null }]);
    expect(JSON.stringify(backup)).not.toContain('token');
    expect(fake.binding.upsert).not.toHaveBeenCalled();
    await expect(fake.service.rekeyRepositoryIdentities(mappings, backup)).resolves.toEqual({ changed: 1 });
    expect(fake.stored.has(original.id)).toBe(false);
    expect(fake.stored.get(`${scope.namespace}:42`)).toEqual({
      ...original, id: `${scope.namespace}:42`,
      metadata: { ...original.metadata, repository_identity_stale: true, repository_identity_old_id: String(oldId) },
    });
    expect(fake.stored.get(foreign.id)).toEqual(foreign);
    expect(fake.binding.query).not.toHaveBeenCalled();
    const writes = fake.binding.upsert.mock.calls.length;
    await expect(new VectorSearchService(config, undefined, generation).rekeyRepositoryIdentities(mappings, backup)).resolves.toEqual({ changed: 0 });
    expect(fake.binding.upsert).toHaveBeenCalledTimes(writes);
    await fake.service.restoreRepositoryIdentities(backup);
    expect(fake.stored.get(original.id)).toEqual(original);
    expect(fake.stored.has(`${scope.namespace}:42`)).toBe(false);
    const restoredWrites = fake.binding.upsert.mock.calls.length;
    await fake.service.restoreRepositoryIdentities(backup);
    expect(fake.binding.upsert).toHaveBeenCalledTimes(restoredWrites);
  });

  it('rejects canonical collisions and modified sources before mutation', async () => {
    const fake = fakeWorker(implementation);
    fake.stored.set(vector().id, vector());
    fake.stored.set(vector(42).id, vector(42));
    await expect(fake.service.backupRepositoryIdentities(mappings)).rejects.toThrow(/collision/i);
    expect(fake.binding.upsert).not.toHaveBeenCalled();
    fake.stored.delete(vector(42).id);
    const backup = await fake.service.backupRepositoryIdentities(mappings);
    fake.stored.set(vector().id, { ...vector(), values: [4, 5, 6] });
    await expect(fake.service.rekeyRepositoryIdentities(mappings, backup)).rejects.toThrow(/changed|conflict/i);
    expect(fake.binding.upsert).not.toHaveBeenCalled();
  });

  it('blocks older workers and wrong active generation before mutation', async () => {
    const fake = fakeWorker(implementation);
    const foreignGeneration = { ...generation, namespace: `g${hash.slice(0, 12)}${'e'.repeat(32)}` };
    await expect(new VectorSearchService(config, undefined, foreignGeneration).backupRepositoryIdentities(mappings)).rejects.toThrow(/generation/i);
    expect(fake.fetch).not.toHaveBeenCalled();
    const oldWorker = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(`${config.workerUrl}/status`);
      return Response.json({ success: true, protocolVersion: 2, dimensions: 3 });
    });
    vi.stubGlobal('fetch', oldWorker);
    await expect(fake.service.backupRepositoryIdentities(mappings)).rejects.toThrow(/identity storage|update/i);
    expect(oldWorker).toHaveBeenCalledOnce();
    expect(oldWorker.mock.calls[0][0]).toBe(`${config.workerUrl}/status`);
    expect(fake.binding.upsert).not.toHaveBeenCalled();
  });

  it('keeps the old vector when visibility fails, and can resume after an unacknowledged copy', async () => {
    vi.useFakeTimers();
    const fake = fakeWorker(implementation);
    fake.stored.set(vector().id, vector());
    const backup = await fake.service.backupRepositoryIdentities(mappings);
    const describe = fake.binding.describe.getMockImplementation()!;
    fake.binding.describe.mockImplementation(async () => ({ ...(await describe()), processedUpToMutation: 'not-visible' }));
    const rejected = expect(fake.service.rekeyRepositoryIdentities(mappings, backup)).rejects.toThrow(/retained|confirmed/i);
    await vi.runAllTimersAsync();
    await rejected;
    expect(fake.stored.has(vector().id)).toBe(true);
    expect(fake.binding.deleteByIds).not.toHaveBeenCalled();
    fake.binding.describe.mockImplementation(describe);
    vi.useRealTimers();
    await expect(new VectorSearchService(config, undefined, generation).rekeyRepositoryIdentities(mappings, backup)).resolves.toEqual({ changed: 1 });
    expect(fake.stored.has(vector().id)).toBe(false);
  });

  it('rejects forged scope, malformed mappings and mismatched backup without changing data', async () => {
    const fake = fakeWorker(implementation);
    fake.stored.set(vector().id, vector());
    const backup = await fake.service.backupRepositoryIdentities(mappings);
    await expect(fake.service.rekeyRepositoryIdentities(mappings, { ...backup, workerUrl: 'https://other.example' })).rejects.toThrow(/backup|scope/i);
    const request = (path: string, body: unknown) => fake.fetch(`${config.workerUrl}${path}`, {
      method: 'POST', headers: { Authorization: 'Bearer token' }, body: JSON.stringify(body),
    });
    expect((await request('/identity-snapshot', { scope, ids: ['foreign:42'] })).status).toBe(400);
    expect((await request('/identity-rekey', { scope, mappings: [{ ...mappings[0], evidence: '' }], backup, phase: 'copy' })).status).toBe(400);
    expect((await request('/identity-rekey', { scope, mappings, backup, phase: 'delete' })).status).toBe(409);
    expect(fake.binding.upsert).not.toHaveBeenCalled();
    expect(fake.binding.deleteByIds).not.toHaveBeenCalled();
  });

  it('does not issue storage requests for an empty mapping', async () => {
    const fake = fakeWorker(implementation);
    const backup = await fake.service.backupRepositoryIdentities([]);
    await expect(fake.service.rekeyRepositoryIdentities([], backup)).resolves.toEqual({ changed: 0 });
    await fake.service.restoreRepositoryIdentities(backup);
    expect(fake.fetch).not.toHaveBeenCalled();
  });

  it('resumes when the deletion reached storage but the acknowledgement was lost', async () => {
    const fake = fakeWorker(implementation);
    fake.stored.set(vector().id, vector());
    const backup = await fake.service.backupRepositoryIdentities(mappings);
    const fetch = fake.fetch.getMockImplementation()!;
    fake.fetch.mockImplementation(async (url, init) => {
      const response = await fetch(url, init);
      if (String(url).endsWith('/identity-rekey') && JSON.parse(String(init?.body)).phase === 'delete') {
        throw new Error('Acknowledgement lost after deletion');
      }
      return response;
    });
    await expect(fake.service.rekeyRepositoryIdentities(mappings, backup)).rejects.toThrow(/Acknowledgement lost/);
    expect(fake.stored.has(vector().id)).toBe(false);
    const writes = fake.binding.upsert.mock.calls.length;
    fake.fetch.mockImplementation(fetch);
    await expect(new VectorSearchService(config, undefined, generation).rekeyRepositoryIdentities(mappings, backup)).resolves.toEqual({ changed: 0 });
    expect(fake.binding.upsert).toHaveBeenCalledTimes(writes);
    await fake.service.restoreRepositoryIdentities(backup);
    expect(fake.stored.get(vector().id)).toEqual(vector());
  });

  it('refuses to delete the source if target contents changed after the copy', async () => {
    const fake = fakeWorker(implementation);
    fake.stored.set(vector().id, vector());
    const backup = await fake.service.backupRepositoryIdentities(mappings);
    const fetch = fake.fetch.getMockImplementation()!;
    fake.fetch.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/identity-rekey') && JSON.parse(String(init?.body)).phase === 'delete') {
        const target = fake.stored.get(`${scope.namespace}:42`)!;
        fake.stored.set(target.id, { ...target, values: [9, 8, 7] });
      }
      return fetch(url, init);
    });
    await expect(fake.service.rekeyRepositoryIdentities(mappings, backup)).rejects.toThrow(/target conflict/i);
    expect(fake.binding.deleteByIds).not.toHaveBeenCalled();
    expect(fake.stored.get(vector().id)).toEqual(vector());
  });

  it('rejects missing hashes, wrong names and wrong-scoped binding results before writing', async () => {
    const fake = fakeWorker(implementation);
    fake.stored.set(vector().id, { ...vector(), metadata: { ...vector().metadata, content_hash: undefined } });
    await expect(fake.service.backupRepositoryIdentities(mappings)).rejects.toThrow(/content hash/i);
    fake.stored.set(vector().id, { ...vector(), metadata: { ...vector().metadata, full_name: 'other/repo' } });
    await expect(fake.service.backupRepositoryIdentities(mappings)).rejects.toThrow(/identity|name/i);
    fake.binding.getByIds.mockResolvedValue([{ ...vector(), namespace: 'foreign' }]);
    await expect(fake.service.backupRepositoryIdentities(mappings)).rejects.toThrow(/scope/i);
    expect(fake.binding.upsert).not.toHaveBeenCalled();
  });

  it('blocks rekey and restore against an old Worker even when a durable backup already exists', async () => {
    const fake = fakeWorker(implementation);
    fake.stored.set(vector().id, vector());
    const backup = await fake.service.backupRepositoryIdentities(mappings);
    const oldWorker = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(`${config.workerUrl}/status`);
      return Response.json({ success: true, protocolVersion: 2, dimensions: 3 });
    });
    vi.stubGlobal('fetch', oldWorker);
    await expect(fake.service.rekeyRepositoryIdentities(mappings, backup)).rejects.toThrow(/migration blocked/i);
    await expect(fake.service.restoreRepositoryIdentities(backup)).rejects.toThrow(/migration blocked/i);
    expect(oldWorker).toHaveBeenCalledTimes(2);
    expect(oldWorker.mock.calls.every(call => call[0] === `${config.workerUrl}/status`)).toBe(true);
    expect(fake.binding.upsert).not.toHaveBeenCalled();
    expect(fake.binding.deleteByIds).not.toHaveBeenCalled();
    expect(fake.stored.get(vector().id)).toEqual(vector());
  });

  it('rejects unauthenticated and invalid snapshot scope before storage access', async () => {
    const fake = fakeWorker(implementation);
    const unauthorized = await implementation.fetch(new Request(`${config.workerUrl}/identity-snapshot`, {
      method: 'POST', body: JSON.stringify({ scope, ids: [String(oldId)] }),
    }), fake.env);
    expect(unauthorized.status).toBe(401);
    expect(fake.binding.describe).not.toHaveBeenCalled();
    const invalid = await fake.fetch(`${config.workerUrl}/identity-snapshot`, {
      method: 'POST', headers: { Authorization: 'Bearer token' },
      body: JSON.stringify({ scope: { ...scope, identityHash: 'foreign' }, ids: [String(oldId)] }),
    });
    expect(invalid.status).toBe(409);
    expect(fake.binding.getByIds).not.toHaveBeenCalled();
    expect(fake.binding.upsert).not.toHaveBeenCalled();
    expect(fake.binding.deleteByIds).not.toHaveBeenCalled();
  });

  it('rejects a durable backup from another namespace before even requesting Worker status', async () => {
    const fake = fakeWorker(implementation);
    fake.stored.set(vector().id, vector());
    const backup = await fake.service.backupRepositoryIdentities(mappings);
    fake.fetch.mockClear();
    const foreign = { ...backup, scope: { ...backup.scope, namespace: `g${hash.slice(0, 12)}${'e'.repeat(32)}` } };
    await expect(fake.service.rekeyRepositoryIdentities(mappings, foreign)).rejects.toThrow(/scope/i);
    await expect(fake.service.restoreRepositoryIdentities(foreign)).rejects.toThrow(/scope/i);
    expect(fake.fetch).not.toHaveBeenCalled();
    expect(fake.binding.upsert).not.toHaveBeenCalled();
    expect(fake.binding.deleteByIds).not.toHaveBeenCalled();
  });

  it('does not resurrect an identity deleted after migration completed', async () => {
    const fake = fakeWorker(implementation);
    fake.stored.set(vector().id, vector());
    const backup = await fake.service.backupRepositoryIdentities(mappings);
    await fake.service.rekeyRepositoryIdentities(mappings, backup);
    fake.stored.delete(`${scope.namespace}:42`);
    fake.binding.upsert.mockClear();
    fake.binding.deleteByIds.mockClear();
    await expect(fake.service.restoreRepositoryIdentities(backup)).rejects.toThrow(/conflict|changed|disappeared/i);
    expect(fake.binding.upsert).not.toHaveBeenCalled();
    expect(fake.binding.deleteByIds).not.toHaveBeenCalled();
    expect(fake.stored.size).toBe(0);
  });

  it('preflights every repository before restoring any and preserves post-migration writes', async () => {
    const fake = fakeWorker(implementation);
    const second = { oldId: oldId + 1, newId: 43, fullName: 'owner/second', evidence: 'Canonical confirmation' };
    const batch = [...mappings, second];
    const secondVector = { ...vector(second.oldId), metadata: { ...vector().metadata, full_name: second.fullName } };
    fake.stored.set(vector().id, vector());
    fake.stored.set(secondVector.id, secondVector);
    const backup = await fake.service.backupRepositoryIdentities(batch);
    await fake.service.rekeyRepositoryIdentities(batch, backup);
    const target = fake.stored.get(`${scope.namespace}:43`)!;
    const latest = { ...target, values: [6, 7, 8], metadata: { ...target.metadata, content_hash: 'f'.repeat(64) } };
    fake.stored.set(latest.id, latest);
    fake.binding.upsert.mockClear();
    fake.binding.deleteByIds.mockClear();
    await expect(fake.service.checkRestoreRepositoryIdentities(backup)).rejects.toThrow(/conflict|changed/i);
    await expect(fake.service.restoreRepositoryIdentities(backup)).rejects.toThrow(/conflict|changed/i);
    const response = await fake.fetch(`${config.workerUrl}/identity-restore`, {
      method: 'POST', headers: { Authorization: 'Bearer token' },
      body: JSON.stringify({ scope, mappings: batch, backup, phase: 'copy' }),
    });
    expect(response.status).toBe(409);
    expect(fake.binding.upsert).not.toHaveBeenCalled();
    expect(fake.binding.deleteByIds).not.toHaveBeenCalled();
    expect(fake.stored.get(latest.id)).toEqual(latest);
    expect(fake.stored.has(vector().id)).toBe(false);
  });

  it('permits read-only preflight of original and interrupted restore states without touching newer generations', async () => {
    const fake = fakeWorker(implementation);
    fake.stored.set(vector().id, vector());
    const backup = await fake.service.backupRepositoryIdentities(mappings);
    await fake.service.checkRestoreRepositoryIdentities(backup);
    expect(fake.binding.upsert).not.toHaveBeenCalled();
    await fake.service.rekeyRepositoryIdentities(mappings, backup);
    const foreign = vector(42, `g${hash.slice(0, 12)}${'d'.repeat(32)}`);
    fake.stored.set(foreign.id, foreign);
    const fetch = fake.fetch.getMockImplementation()!;
    fake.fetch.mockImplementation(async (url, init) => {
      const response = await fetch(url, init);
      if (String(url).endsWith('/identity-restore') && JSON.parse(String(init?.body)).phase === 'copy') {
        throw new Error('Lost restore copy acknowledgement');
      }
      return response;
    });
    await expect(fake.service.restoreRepositoryIdentities(backup)).rejects.toThrow(/Lost restore copy/);
    expect(fake.stored.get(vector().id)).toEqual(vector());
    expect(fake.stored.has(`${scope.namespace}:42`)).toBe(true);
    fake.fetch.mockImplementation(fetch);
    fake.binding.upsert.mockClear();
    fake.binding.deleteByIds.mockClear();
    const restarted = new VectorSearchService(config, undefined, generation);
    await restarted.checkRestoreRepositoryIdentities(backup);
    expect(fake.binding.upsert).not.toHaveBeenCalled();
    expect(fake.binding.deleteByIds).not.toHaveBeenCalled();
    await restarted.restoreRepositoryIdentities(backup);
    expect(fake.stored.get(vector().id)).toEqual(vector());
    expect(fake.stored.has(`${scope.namespace}:42`)).toBe(false);
    expect(fake.stored.get(foreign.id)).toEqual(foreign);
  });

  it('rechecks remote contents after client preflight and before the actual restore write', async () => {
    const fake = fakeWorker(implementation);
    fake.stored.set(vector().id, vector());
    const backup = await fake.service.backupRepositoryIdentities(mappings);
    await fake.service.rekeyRepositoryIdentities(mappings, backup);
    const fetch = fake.fetch.getMockImplementation()!;
    let latest: Vector;
    fake.fetch.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/identity-restore') && JSON.parse(String(init?.body)).phase === 'copy') {
        const target = fake.stored.get(`${scope.namespace}:42`)!;
        latest = { ...target, values: [8, 8, 8] };
        fake.stored.set(latest.id, latest);
      }
      return fetch(url, init);
    });
    fake.binding.upsert.mockClear();
    fake.binding.deleteByIds.mockClear();
    await expect(fake.service.restoreRepositoryIdentities(backup)).rejects.toThrow(/conflict|changed/i);
    expect(fake.binding.upsert).not.toHaveBeenCalled();
    expect(fake.binding.deleteByIds).not.toHaveBeenCalled();
    expect(fake.stored.get(`${scope.namespace}:42`)).toEqual(latest!);
  });

  it('blocks workers with identity storage but no restore preflight before migration starts', async () => {
    const fake = fakeWorker(implementation);
    const oldWorker = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(`${config.workerUrl}/status`);
      return Response.json({ success: true, protocolVersion: 2, dimensions: 3, identityStorage: true });
    });
    vi.stubGlobal('fetch', oldWorker);
    await expect(fake.service.backupRepositoryIdentities(mappings)).rejects.toThrow(/restore|update/i);
    expect(oldWorker).toHaveBeenCalledOnce();
    expect(oldWorker.mock.calls[0][0]).toBe(`${config.workerUrl}/status`);
    expect(fake.binding.upsert).not.toHaveBeenCalled();
    expect(fake.binding.deleteByIds).not.toHaveBeenCalled();
  });

  it('rejects changed client-side snapshot contents even when the Worker claims ready', async () => {
    const fake = fakeWorker(implementation);
    fake.stored.set(vector().id, vector());
    const backup = await fake.service.backupRepositoryIdentities(mappings);
    const fetch = fake.fetch.getMockImplementation()!;
    fake.fetch.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/identity-restore-check')) {
        return Response.json({ success: true, ready: true, records: backup.records.map(record =>
          record.vector ? { ...record, vector: { ...record.vector, values: [9, 9, 9] } } : record) });
      }
      return fetch(url, init);
    });
    await expect(fake.service.checkRestoreRepositoryIdentities(backup)).rejects.toThrow(/RESTORE_CONFLICT/);
    await expect(fake.service.restoreRepositoryIdentities(backup)).rejects.toThrow(/RESTORE_CONFLICT/);
    expect(fake.binding.upsert).not.toHaveBeenCalled();
    expect(fake.binding.deleteByIds).not.toHaveBeenCalled();
    expect(fake.stored.get(vector().id)).toEqual(vector());
  });
});
