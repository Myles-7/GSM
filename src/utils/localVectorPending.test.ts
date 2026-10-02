import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddingConfig, Repository, VectorSearchConfig } from '../types';
import { createVectorGeneration } from '../services/vectorIndexIdentity';
import { countLocalVectorPending, formatLocalVectorPending } from './localVectorPending';

const embedding: EmbeddingConfig = {
  id: 'embedding', name: 'Embedding', apiType: 'ollama', baseUrl: 'http://localhost:11434',
  model: 'model', dimensions: 3, apiKey: '', isActive: true,
};
let config: VectorSearchConfig;
let repository: Repository;

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  config = {
    enabled: true, embeddingConfigId: embedding.id, workerUrl: 'https://worker.example',
    authToken: 'secret', indexMode: 'readme', readmeMaxChars: 6000,
  };
  config.activeIndex = await createVectorGeneration(embedding, config);
  repository = {
    id: 1, analyzed_at: '2026-09-01T00:00:00Z', vector_indexed_at: '2026-09-02T00:00:00Z',
    license: 'MIT', vector_indexed_license: 'MIT',
    vector_indexed_identity: config.activeIndex.identityHash,
    vector_indexed_generation: config.activeIndex.namespace,
    vector_indexed_content_hash: 'a'.repeat(64),
  } as Repository;
});
afterEach(() => vi.unstubAllGlobals());

describe('local vector pending evidence', () => {
  it('does not count current stamps or unanalyzed/failed repositories', () => {
    expect(countLocalVectorPending([repository, { id: 2 } as Repository,
      { ...repository, id: 3, analysis_failed: true }], embedding, config)).toBe(0);
  });

  it.each(['vector_indexed_at', 'vector_indexed_identity', 'vector_indexed_generation', 'vector_indexed_content_hash'] as const)(
    'counts missing %s', (field) => {
      delete repository[field];
      expect(countLocalVectorPending([repository], embedding, config)).toBe(1);
    },
  );

  it.each(['vector_indexed_identity', 'vector_indexed_generation'] as const)('counts mismatched %s', (field) => {
    repository[field] = 'old';
    expect(countLocalVectorPending([repository], embedding, config)).toBe(1);
  });

  it.each(['bad', 'A'.repeat(64), 'a'.repeat(63)])('counts an invalid hash stamp without calculating content: %s', (hash) => {
    repository.vector_indexed_content_hash = hash;
    expect(countLocalVectorPending([repository], embedding, config)).toBe(1);
  });

  it('does not treat secret rotation or equivalent URL normalization as new identity', () => {
    const selected = { ...embedding, apiKey: 'rotated', baseUrl: `${embedding.baseUrl}/` };
    config.authToken = 'rotated';
    config.workerUrl += '/';
    expect(countLocalVectorPending([repository], selected, config)).toBe(0);
  });

  it.each(['last_edited', 'analyzed_at', 'pushed_at', 'updated_at'] as const)('reuses engine timestamp comparison for %s', (field) => {
    repository[field] = '2026-09-03T00:00:00Z';
    expect(countLocalVectorPending([repository], embedding, config)).toBe(1);
  });

  it('reuses normalized license comparison even without timestamp changes', () => {
    repository.license = { spdx_id: 'MIT', name: 'MIT License' } as unknown as string;
    expect(countLocalVectorPending([repository], embedding, config)).toBe(0);
    repository.license = 'Apache-2.0';
    expect(countLocalVectorPending([repository], embedding, config)).toBe(1);
  });

  it.each(['unknown', 'model', 'provider', 'endpoint', 'dimensions', 'mode', 'limit', 'target', 'format', 'selection'])(
    'counts eligible repositories when index compatibility changes: %s', (change) => {
      const selected = { ...embedding };
      if (change === 'unknown') delete config.activeIndex;
      if (change === 'model') selected.model = 'new-model';
      if (change === 'provider') selected.apiType = 'openai';
      if (change === 'endpoint') selected.baseUrl = 'https://other.example';
      if (change === 'dimensions') selected.dimensions = 4;
      if (change === 'mode') config.indexMode = 'description';
      if (change === 'limit') config.readmeMaxChars = 1000;
      if (change === 'target') config.workerUrl = 'https://other.worker';
      if (change === 'format') config.activeIndex!.identity.format = 1;
      if (change === 'selection') selected.id = 'other-config';
      expect(countLocalVectorPending([repository], selected, config)).toBe(1);
    },
  );

  it('counts enabled repositories requiring a rebuild when no embedding is selected', () => {
    expect(countLocalVectorPending([repository], undefined, config)).toBe(1);
  });

  it('hides disabled pending independently of compatibility or repository count', () => {
    config.enabled = false;
    delete config.activeIndex;
    expect(countLocalVectorPending([repository], undefined, config)).toBe(0);
  });

  it('uses the active generation format, not legacy global version metadata', () => {
    config.embeddingFormatVersion = 1;
    expect(countLocalVectorPending([repository], embedding, config)).toBe(0);
  });

  it('never requests content or hashes while counting even in README mode', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const digest = vi.spyOn(crypto.subtle, 'digest');
    expect(countLocalVectorPending([repository], embedding, config)).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(digest).not.toHaveBeenCalled();
    digest.mockRestore();
  });

  it.each([[0, '0'], [99, '99'], [100, '99+'], [1000, '99+']])('caps %s only for presentation', (count, expected) => {
    expect(formatLocalVectorPending(count as number)).toBe(expected);
  });
});
