import { webcrypto } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddingConfig, Repository, VectorSearchConfig } from '../types';
import { normalizeVectorSearchConfig } from '../store/schema';
import { EmbeddingClient, VectorSearchService, indexAllRepos } from './vectorSearchService';
import {
  createVectorGeneration, embeddingIdentity, hashVectorContent, requireCompatibleVectorIndex, vectorScope,
} from './vectorIndexIdentity';
import worker from '../../cloudflare-worker/src/index';

const embedding: EmbeddingConfig = {
  id: 'emb', name: 'Embedding', apiType: 'openai-compatible', baseUrl: 'https://embedding.example/embeddings',
  apiKey: 'secret', model: 'model-a', dimensions: 3, isActive: true,
};
const config: VectorSearchConfig = {
  enabled: true, workerUrl: 'https://worker.example', authToken: 'token', embeddingConfigId: 'emb',
  indexMode: 'description', readmeMaxChars: 6000,
};
const repo = {
  id: 1, full_name: 'owner/repository', description: 'original', license: 'MIT', stargazers_count: 5,
  analyzed_at: '2026-01-01T00:00:00.000Z',
} as Repository;
const client = () => ({ embed: vi.fn(async (texts: string[]) => texts.map(() => [1, 2, 3])) }) as unknown as EmbeddingClient;
const vector = (contentHash = 'a'.repeat(64)) => ({
  id: '1', values: [1, 2, 3],
  metadata: { full_name: 'owner/repository', description: '', language: '', stars: 0, tags: [], content_hash: contentHash },
});
type StoredVector = Parameters<Parameters<typeof worker.fetch>[1]['VECTORIZE']['upsert']>[0][number];

function fakeWorker() {
  const stored = new Map<string, StoredVector>();
  let mutation = '';
  let count = 0;
  const binding = {
    describe: vi.fn(async () => ({ dimensions: 3, vectorCount: stored.size, processedUpToMutation: mutation })),
    upsert: vi.fn(async (vectors: StoredVector[]) => {
      vectors.forEach((v) => stored.set(v.id, v));
      mutation = `mutation-${++count}`;
      return { mutationId: mutation };
    }),
    query: vi.fn(async (_values: number[], options: { namespace: string }) => ({
      matches: [...stored.values()].filter((v) => v.namespace === options.namespace)
        .map((v) => ({ id: v.id, score: 0.9, metadata: v.metadata })),
    })),
    getByIds: vi.fn(async (ids: string[]) => ids.flatMap((id) => stored.has(id) ? [stored.get(id)!] : [])),
    deleteByIds: vi.fn(async () => undefined),
  };
  const env = { AUTH_TOKEN: 'token', VECTORIZE: binding };
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (!String(url).startsWith(config.workerUrl)) throw new Error('Real network calls are forbidden');
    return worker.fetch(new Request(url, init), env);
  });
  vi.stubGlobal('fetch', fetch);
  return { stored, binding, env, fetch };
}

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('vector identity and migration', () => {
  it.each([
    { model: 'model-b' }, { apiType: 'ollama' as const }, { dimensions: 4 },
    { baseUrl: 'https://other.example/embeddings' },
  ])('rejects an incompatible embedding configuration %j even with existing stamps', async (patch) => {
    const activeIndex = await createVectorGeneration(embedding, config);
    await expect(requireCompatibleVectorIndex({ ...embedding, ...patch }, { ...config, activeIndex })).rejects.toThrow('Rebuild');
  });
  it.each([
    { workerUrl: 'https://other.worker' }, { indexMode: 'readme' as const },
  ])('binds the target and content mode %j', async (patch) => {
    const activeIndex = await createVectorGeneration(embedding, config);
    await expect(requireCompatibleVectorIndex(embedding, { ...config, ...patch, activeIndex })).rejects.toThrow('Rebuild');
  });
  it('binds README truncation and format, but excludes secrets and cosmetic config IDs', async () => {
    const readmeConfig = { ...config, indexMode: 'readme' as const };
    const activeIndex = await createVectorGeneration(embedding, readmeConfig);
    await expect(requireCompatibleVectorIndex(embedding, { ...readmeConfig, activeIndex, readmeMaxChars: 4000 })).rejects.toThrow('Rebuild');
    const rotated = { ...embedding, apiKey: 'rotated', id: 'other' };
    const rotatedConfig = { ...readmeConfig, activeIndex, authToken: 'rotated' };
    await expect(requireCompatibleVectorIndex(rotated, rotatedConfig))
      .resolves.toBe(activeIndex);
    expect(JSON.stringify(activeIndex)).not.toContain('secret');
    const stale = { ...activeIndex, identity: { ...activeIndex.identity, format: 2 } };
    await expect(requireCompatibleVectorIndex(embedding, { ...readmeConfig, activeIndex: stale })).rejects.toThrow('Rebuild');
  });
  it('uses SHA-256, canonical URLs and distinct generation namespaces', async () => {
    expect(await hashVectorContent('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const one = await createVectorGeneration(embedding, config);
    const two = await createVectorGeneration(embedding, { ...config, workerUrl: `${config.workerUrl}/` });
    expect(one.identityHash).toBe(two.identityHash);
    expect(one.namespace).not.toBe(two.namespace);
    expect(`${one.namespace}:1234567890123456`.length).toBeLessThanOrEqual(64);
  });
  it('preserves known generations on hydration, never infers one from legacy format/version/count', async () => {
    const activeIndex = await createVectorGeneration(embedding, config);
    expect(normalizeVectorSearchConfig({ ...config, activeIndex }, [embedding]).activeIndex).toEqual(activeIndex);
    expect(normalizeVectorSearchConfig({ ...config, embeddingFormatVersion: 3 }, [embedding]).activeIndex).toBeUndefined();
    expect(normalizeVectorSearchConfig({ ...config, activeIndex: { namespace: 'legacy' } }, [embedding]).activeIndex).toBeUndefined();
    await expect(requireCompatibleVectorIndex(embedding, config)).rejects.toThrow('Rebuild');
  });
  it('rejects corrupted identity hashes and URL-embedded secrets', async () => {
    const activeIndex = await createVectorGeneration(embedding, config);
    const hash = 'b'.repeat(64);
    await expect(requireCompatibleVectorIndex(embedding, { ...config, activeIndex: {
      ...activeIndex, identityHash: hash, namespace: `g${hash.slice(0, 12)}${'c'.repeat(32)}`,
    } })).rejects.toThrow('Rebuild');
    expect(() => embeddingIdentity({ ...embedding, baseUrl: 'https://host/embeddings?key=secret' }, config)).toThrow('credentials');
  });
});

describe('scoped service and real Worker handler (mock Vectorize, no network)', () => {
  it('keeps the generated Dashboard Worker aligned with the CLI handler', async () => {
    const dashboardUrl = pathToFileURL(resolve('cloudflare-worker/worker.js')).href;
    const dashboard = await import(/* @vite-ignore */ dashboardUrl) as { default: typeof worker };
    const fake = fakeWorker();
    const stage = await createVectorGeneration(embedding, config);
    for (const implementation of [worker, dashboard.default]) {
      const response = await implementation.fetch(new Request(`${config.workerUrl}/query`, {
        method: 'POST', headers: { Authorization: 'Bearer token' },
        body: JSON.stringify({ scope: vectorScope(stage), vector: [1, 2, 3] }),
      }), fake.env);
      expect(response.status).toBe(200);
      expect(fake.binding.query).toHaveBeenLastCalledWith([1, 2, 3], expect.objectContaining({ namespace: stage.namespace }));
      const legacy = await implementation.fetch(new Request(`${config.workerUrl}/query`, {
        method: 'POST', headers: { Authorization: 'Bearer token' }, body: JSON.stringify({ vector: [1, 2, 3] }),
      }), fake.env);
      expect(legacy.status).toBe(409);
    }
  });
  it('authenticates before accessing any Vectorize binding', async () => {
    const fake = fakeWorker();
    const response = await worker.fetch(new Request(`${config.workerUrl}/status`), fake.env);
    expect(response.status).toBe(401);
    expect(fake.binding.describe).not.toHaveBeenCalled();
  });
  it('keeps two same-repository generations separate and enforces namespace before topK', async () => {
    const fake = fakeWorker();
    const old = await createVectorGeneration(embedding, config);
    const stage = await createVectorGeneration(embedding, config);
    const oldService = new VectorSearchService({ ...config, activeIndex: old }, embedding, old);
    const stagedService = new VectorSearchService(config, embedding, stage);
    await oldService.upsert([vector()]);
    await stagedService.upsert([vector('b'.repeat(64))]);
    expect(fake.stored.size).toBe(2);
    await stagedService.verifyGeneration([{ id: '1', contentHash: 'b'.repeat(64) }]);
    const matches = await oldService.query([1, 2, 3], { topK: 100 });
    expect(matches.map((m) => m.id)).toEqual(['1']);
    expect(fake.binding.query).toHaveBeenCalledWith([1, 2, 3], { namespace: old.namespace, topK: 50, returnMetadata: 'all' });
    expect(fake.binding.deleteByIds).not.toHaveBeenCalled();
  });
  it('blocks unknown/same-dimensional model switches before any Worker query', async () => {
    const fake = fakeWorker();
    const activeIndex = await createVectorGeneration(embedding, config);
    await expect(new VectorSearchService(config, embedding).query([1, 2, 3])).rejects.toThrow('Rebuild');
    await expect(new VectorSearchService({ ...config, activeIndex }, { ...embedding, model: 'another' }).query([1, 2, 3])).rejects.toThrow('Rebuild');
    expect(fake.fetch).not.toHaveBeenCalled();
  });
  it.each([undefined, 1])('rejects an older Worker protocol %s', async (protocolVersion) => {
    const activeIndex = await createVectorGeneration(embedding, config);
    const fetch = vi.fn(async () => Response.json({ dimensions: 3, protocolVersion, vectorCount: 1 }));
    vi.stubGlobal('fetch', fetch);
    await expect(new VectorSearchService({ ...config, activeIndex }, embedding).prepareQuery()).rejects.toThrow('Update');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('rejects dimensions and malformed vector responses before uploading/querying', async () => {
    const fake = fakeWorker();
    const generation = await createVectorGeneration(embedding, config);
    const service = new VectorSearchService({ ...config, activeIndex: generation }, embedding, generation);
    await expect(service.upsert([{ ...vector(), values: [1] }])).rejects.toThrow('dimensions');
    await expect(service.upsert([{ ...vector(), values: [1, NaN, 3] }])).rejects.toThrow('dimensions');
    await expect(service.query([1])).rejects.toThrow('dimensions');
    expect(fake.binding.upsert).not.toHaveBeenCalled();
    expect(fake.binding.query).not.toHaveBeenCalled();
    fake.binding.describe.mockResolvedValue({ dimensions: 4, vectorCount: 0, processedUpToMutation: '' });
    await expect(new VectorSearchService(config).checkCapabilities(3)).rejects.toThrow('dimensions');
  });
  it('never acknowledges a missing mutation ID as a completed upload', async () => {
    const fake = fakeWorker();
    const stage = await createVectorGeneration(embedding, config);
    fake.binding.upsert.mockResolvedValue({ mutationId: '' });
    await expect(new VectorSearchService(config, embedding, stage).upsert([vector()])).rejects.toThrow('acknowledge');
  });
  it('times out without promoting on a missing/advanced visibility watermark', async () => {
    vi.useFakeTimers();
    const fake = fakeWorker();
    const stage = await createVectorGeneration(embedding, config);
    const service = new VectorSearchService(config, embedding, stage);
    await service.upsert([vector()]);
    fake.binding.describe.mockResolvedValue({ dimensions: 3, vectorCount: 1, processedUpToMutation: 'another-writer' });
    const assertion = expect(service.verifyGeneration([{ id: '1', contentHash: 'a'.repeat(64) }])).rejects.toThrow('Previous generation retained');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fake.binding.deleteByIds).not.toHaveBeenCalled();
  });
  it('aborts the visibility wait and leaves stored vectors intact', async () => {
    const fake = fakeWorker();
    const stage = await createVectorGeneration(embedding, config);
    const service = new VectorSearchService(config, embedding, stage);
    await service.upsert([vector()]);
    fake.binding.describe.mockResolvedValue({ dimensions: 3, vectorCount: 0, processedUpToMutation: '' });
    const controller = new AbortController();
    const assertion = expect(service.verifyGeneration([{ id: '1', contentHash: 'a'.repeat(64) }], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    expect(fake.stored.size).toBe(1);
  });
  it.each(['/query', '/upsert', '/delete', '/cleanup'])('rejects legacy unscoped %s requests without touching vectors', async (path) => {
    const fake = fakeWorker();
    const response = await worker.fetch(new Request(`${config.workerUrl}${path}`, {
      method: 'POST', headers: { Authorization: 'Bearer token' }, body: JSON.stringify({ vector: [1, 2, 3], ids: ['1'], keepIds: [] }),
    }), fake.env);
    expect(response.status).toBe(409);
    expect(fake.binding.query).not.toHaveBeenCalled();
    expect(fake.binding.deleteByIds).not.toHaveBeenCalled();
  });
  it('scopes explicit deletion, disables cleanup and validates ID injection', async () => {
    const fake = fakeWorker();
    const generation = await createVectorGeneration(embedding, config);
    const service = new VectorSearchService(config, embedding, generation);
    await service.delete(['1']);
    expect(fake.binding.deleteByIds).toHaveBeenCalledWith([`${generation.namespace}:1`]);
    await expect(service.delete(['another-generation:1'])).rejects.toThrow('400');
    await expect(service.cleanup([])).rejects.toThrow('cleanup disabled');
    expect(fake.binding.deleteByIds).toHaveBeenCalledOnce();
  });
  it('does not let caller-supplied namespaces/identity metadata override the enforced scope', async () => {
    const fake = fakeWorker();
    const stage = await createVectorGeneration(embedding, config);
    const input = { ...vector(), namespace: 'foreign', metadata: { ...vector().metadata, identity_hash: 'forged', description: 'x'.repeat(20000) } };
    const response = await worker.fetch(new Request(`${config.workerUrl}/upsert`, {
      method: 'POST', headers: { Authorization: 'Bearer token' },
      body: JSON.stringify({ scope: vectorScope(stage), vectors: [input] }),
    }), fake.env);
    expect(response.status).toBe(200);
    expect(fake.stored.get(`${stage.namespace}:1`)).toMatchObject({
      namespace: stage.namespace, metadata: { identity_hash: stage.identityHash, content_hash: 'a'.repeat(64) },
    });
  });
  it('filters mismatched metadata and IDs even if a binding returns contaminated results', async () => {
    const fake = fakeWorker();
    const stage = await createVectorGeneration(embedding, config);
    fake.binding.query.mockResolvedValue({ matches: [
      { id: `${stage.namespace}:1`, score: 0.9, metadata: { identity_hash: 'wrong' } },
      { id: 'foreign:2', score: 0.99, metadata: { identity_hash: stage.identityHash } },
    ] });
    expect(await new VectorSearchService({ ...config, activeIndex: stage }, embedding).query([1, 2, 3])).toEqual([]);
  });
  it('rejects incomplete or wrong-content verification even after mutation processing', async () => {
    const fake = fakeWorker();
    const stage = await createVectorGeneration(embedding, config);
    const service = new VectorSearchService(config, embedding, stage);
    await service.upsert([vector()]);
    const response = await fake.fetch(`${config.workerUrl}/verify`, {
      method: 'POST', headers: { Authorization: 'Bearer token' }, body: JSON.stringify({
        scope: vectorScope(stage), mutationId: 'mutation-1', entries: [{ id: '1', contentHash: 'b'.repeat(64) }],
      }),
    });
    expect(await response.json()).toMatchObject({ ready: false });
  });
});

describe('generation-aware content hashing', () => {
  it('skips only matching identity/generation/content and detects edits without timestamp changes', async () => {
    fakeWorker();
    const generation = await createVectorGeneration(embedding, config);
    const service = new VectorSearchService(config, embedding, generation);
    const embed = client();
    const first = await indexAllRepos([repo], embed, service, { generation, indexMode: 'description' });
    const stamped = {
      ...repo, vector_indexed_at: '2026-09-01T00:00:00.000Z', vector_indexed_license: 'MIT',
      vector_indexed_identity: generation.identityHash, vector_indexed_generation: generation.namespace,
      vector_indexed_content_hash: first.indexedContentHashes['1'],
    };
    const options = { generation, indexMode: 'description' as const, incremental: true };
    expect((await indexAllRepos([stamped], embed, service, options)).indexed).toBe(0);
    expect((await indexAllRepos([{ ...stamped, description: 'changed without timestamps' }], embed, service, options)).indexed).toBe(1);
    expect((await indexAllRepos([{ ...stamped, vector_indexed_generation: 'other' }], embed, service, options)).indexed).toBe(1);
    expect((await indexAllRepos([{ ...stamped, vector_indexed_identity: undefined }], embed, service, options)).indexed).toBe(1);
  });
  it('hashes README content and re-fetches it for compatible incremental runs', async () => {
    fakeWorker();
    const readmeConfig = { ...config, indexMode: 'readme' as const };
    const generation = await createVectorGeneration(embedding, readmeConfig);
    const service = new VectorSearchService(readmeConfig, embedding, generation);
    const readmeFetcher = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new');
    const first = await indexAllRepos([repo], client(), service, { generation, readmeFetcher });
    const stamped = { ...repo, vector_indexed_at: '2026-09-01', vector_indexed_license: 'MIT',
      vector_indexed_identity: generation.identityHash, vector_indexed_generation: generation.namespace,
      vector_indexed_content_hash: first.indexedContentHashes['1'] };
    const second = await indexAllRepos([stamped], client(), service, { generation, readmeFetcher, incremental: true });
    expect(second.indexed).toBe(1);
    expect(second.indexedContentHashes['1']).not.toBe(first.indexedContentHashes['1']);
  });
  it('treats README failures as incomplete stages, never a successful description-mode fallback', async () => {
    const fake = fakeWorker();
    const generation = await createVectorGeneration(embedding, { ...config, indexMode: 'readme' });
    const service = new VectorSearchService(config, embedding, generation);
    const embed = client();
    await expect(indexAllRepos([repo], embed, service, { generation })).rejects.toThrow('README source');
    const result = await indexAllRepos([repo], embed, service, { generation, readmeFetcher: vi.fn().mockRejectedValue(new Error('offline')) });
    expect(result.errors).toBe(1);
    expect(embed.embed).not.toHaveBeenCalled();
    expect(fake.binding.upsert).not.toHaveBeenCalled();
  });
  it.each([[], [1], [1, NaN, 3], [1, Infinity, 3]].map((values) => ({ values })))('counts malformed embeddings as errors without upload: $values', async ({ values }) => {
    const fake = fakeWorker();
    const generation = await createVectorGeneration(embedding, config);
    const embed = { embed: vi.fn(async () => [values]) } as unknown as EmbeddingClient;
    const result = await indexAllRepos([repo], embed, new VectorSearchService(config, embedding, generation), { generation, indexMode: 'description' });
    expect(result.errors).toBe(1);
    expect(result.indexedRepoIds).toEqual([]);
    expect(fake.binding.upsert).not.toHaveBeenCalled();
  });
});
