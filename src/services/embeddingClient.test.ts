import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddingConfig } from '../types';
import { EmbeddingClient, VectorSearchService } from './vectorSearchService';

const config: EmbeddingConfig = { id: 'embedding', name: 'Test', model: 'fixture', apiType: 'openai',
  baseUrl: 'https://provider.invalid', apiKey: 'fixture-only', dimensions: 2, isActive: true };

afterEach(() => vi.unstubAllGlobals());

describe('Embedding transport and response validation', () => {
  it.each(['http://provider.invalid', 'http://127.attacker.invalid', 'ftp://provider.invalid', 'https://user:pass@provider.invalid'])('rejects unsafe endpoint %s before sending credentials', async baseUrl => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const result = await new EmbeddingClient({ ...config, baseUrl }).testConnection();
    expect(result.success).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['https://provider.invalid', 'http://localhost:11434', 'http://127.0.0.1:11434', 'http://[::1]:11434'])('accepts secure or local endpoint %s', async baseUrl => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2] }] })));
    vi.stubGlobal('fetch', fetch);
    await expect(new EmbeddingClient({ ...config, baseUrl }).testConnection()).resolves.toMatchObject({ success: true, dimensions: 2 });
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error' }));
  });

  it.each([
    ['openai', { data: [{ index: 0, embedding: [0.1, 0.2] }] }],
    ['openai-compatible', { data: [{ index: 0, embedding: [0.1, 0.2] }] }],
    ['siliconflow', { data: [{ index: 0, embedding: [0.1, 0.2] }] }],
    ['ollama', { embeddings: [[0.1, 0.2]] }],
    ['gemini', { embeddings: [{ values: [0.1, 0.2] }] }],
    ['cohere', { embeddings: [[0.1, 0.2]] }],
  ] satisfies [EmbeddingConfig['apiType'], object][])('blocks redirects for %s', async (apiType, payload) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))); vi.stubGlobal('fetch', fetch);
    await expect(new EmbeddingClient({ ...config, apiType }).embed(['fixture'])).resolves.toEqual([[0.1, 0.2]]);
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error' }));
  });

  it.each([[], [[]], [[null, 1]], [['not-a-number', 1]], [[0.1, 0.2], [0.3, 0.4]]].map(vectors => ({ vectors })))('rejects malformed vectors in a connection probe: $vectors', async ({ vectors }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ embeddings: vectors }))));
    const result = await new EmbeddingClient({ ...config, apiType: 'ollama' }).testConnection();
    expect(result.success).toBe(false);
  });

  it('rejects a batch with inconsistent dimensions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ embeddings: [[1, 2], [3]] }))));
    await expect(new EmbeddingClient({ ...config, apiType: 'ollama' }).embed(['one', 'two'])).rejects.toThrow('embedding');
  });

  it('rejects duplicate OpenAI indexes instead of assigning a vector to the wrong document', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }, { index: 0, embedding: [3, 4] }] }))));
    await expect(new EmbeddingClient(config).embed(['one', 'two'])).rejects.toThrow('embedding');
  });
});

describe('Vector Worker credential transport', () => {
  it.each(['http://worker.invalid', 'http://127.attacker.invalid', 'https://user:pass@worker.invalid'])('rejects unsafe worker %s before sending the token', async workerUrl => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(new VectorSearchService({ workerUrl, authToken: 'fixture-only' }).getStatus()).rejects.toThrow('HTTPS');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not forward the Worker token through redirects', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ vectorCount: 0, dimensions: 2 }))); vi.stubGlobal('fetch', fetch);
    await new VectorSearchService({ workerUrl: 'https://worker.invalid', authToken: 'fixture-only' }).getStatus();
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error' }));
  });
});
