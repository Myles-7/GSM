import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock('../../src/db/connection.js', () => ({ getDb: getDbMock }));
vi.mock('../../src/services/crypto.js', () => ({ decrypt: (value: string) => value }));
vi.mock('../../src/config.js', () => ({ config: { encryptionKey: 'test-key' } }));
vi.mock('../../src/services/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const provider = await import('../../src/mcp/provider.js');
const { registerMcpTools } = await import('../../src/mcp/tools.js');

const repoRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'alpha',
  full_name: 'acme/alpha',
  description: 'retrieval repository',
  html_url: 'https://github.com/acme/alpha',
  stargazers_count: 100,
  language: 'Rust',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-02-01T00:00:00.000Z',
  pushed_at: '2026-02-02T00:00:00.000Z',
  starred_at: '2026-02-03T00:00:00.000Z',
  owner_login: 'acme',
  owner_avatar_url: '',
  topics: JSON.stringify(['retrieval']),
  ai_summary: 'A retrieval system',
  ai_tags: JSON.stringify(['semantic']),
  ai_platforms: JSON.stringify(['linux']),
  analyzed_at: '2026-02-04T00:00:00.000Z',
  analysis_failed: 0,
  custom_description: null,
  custom_tags: JSON.stringify([]),
  custom_category: 'infrastructure',
  category_locked: 0,
  subscribed_to_releases: 1,
  license: 'MIT',
  ...overrides,
});

const releaseRow = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  tag_name: 'v1.0.0',
  name: 'First release',
  html_url: 'https://github.com/acme/alpha/releases/tag/v1.0.0',
  published_at: '2026-03-01T00:00:00.000Z',
  prerelease: 0,
  draft: 0,
  ...overrides,
});

function configureDb(options: {
  repos?: Record<string, unknown>[];
  releases?: Record<string, unknown>[];
  vectorEnabled?: boolean;
} = {}) {
  const repos = options.repos ?? [repoRow()];
  const releases = options.releases ?? [];
  const vectorConfig = {
    id: 'default',
    enabled: options.vectorEnabled === false ? 0 : 1,
    worker_url: 'https://worker.example',
    auth_token_encrypted: 'worker-token',
    embedding_config_id: 'embedding-1',
  };
  const embeddingConfig = {
    api_type: 'ollama',
    model: 'bge-m3',
    api_key_encrypted: '',
    base_url: 'http://127.0.0.1:11434',
    dimensions: 2,
  };

  getDbMock.mockReturnValue({
    prepare(sql: string) {
      return {
        all: () => {
          if (sql.includes('FROM repositories')) return repos;
          return [];
        },
        get: (value?: unknown) => {
          if (sql.includes('FROM vector_search_configs')) return vectorConfig;
          if (sql.includes('FROM embedding_configs')) return embeddingConfig;
          if (sql.includes('FROM releases')) {
            return releases.find((release) => Number(release.repo_id) === Number(value));
          }
          if (sql.includes('WHERE id = ?')) {
            return repos.find((repo) => Number(repo.id) === Number(value));
          }
          if (sql.includes('WHERE full_name = ?')) {
            return repos.find(
              (repo) => String(repo.full_name).toLowerCase() === String(value).toLowerCase()
            );
          }
          return undefined;
        },
      };
    },
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Prior vector regressions intentionally exercise the opt-in legacy path.
const legacyFetchMock = () => vi.fn()
  .mockResolvedValueOnce(jsonResponse({ dimensions: 2, vectorCount: 1 }));

describe('MCP provider discovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('GSM_MCP_LEGACY_VECTOR_WORKER_URL', 'https://worker.example');
    configureDb();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does not advertise or call vector tools without synced identity or an intentional legacy opt-in', async () => {
    vi.stubEnv('GSM_MCP_LEGACY_VECTOR_WORKER_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(provider.getVectorAvailability()).toMatchObject({
      available: false, reason: 'vector_index_identity_not_synced',
    });
    const registrations = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    registerMcpTools({
      registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
        registrations.set(name, handler);
      },
    } as never);
    expect(registrations.size).toBe(8);
    expect(registrations.has('gsm_vector_search')).toBe(false);
    expect(registrations.has('gsm_find_similar_repos')).toBe(false);
    const status = await registrations.get('gsm_status')!({}) as { content: Array<{ text: string }> };
    expect(JSON.parse(status.content[0].text)).toMatchObject({
      vector: { available: false, reason: 'vector_index_identity_not_synced' },
    });
    expect(JSON.parse(status.content[0].text).toolsNote).toContain('identity is not synced');
    expect(await provider.vectorSearch('test')).toEqual({ available: false, reason: 'vector_index_identity_not_synced' });
    expect(await provider.findSimilarRepositories('acme/alpha')).toEqual({ available: false, reason: 'vector_index_identity_not_synced' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not inherit the legacy opt-in when the configured Worker target changes', async () => {
    vi.stubEnv('GSM_MCP_LEGACY_VECTOR_WORKER_URL', 'https://different-worker.example');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(provider.getVectorAvailability().available).toBe(false);
    expect(await provider.vectorSearch('test')).toMatchObject({ reason: 'vector_index_identity_not_synced' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([2, 3])('rejects protocol %s on an opted-in legacy URL before embedding/query', async (protocolVersion) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ protocolVersion, dimensions: 2, vectorCount: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await provider.vectorSearch('test')).toEqual({ available: false, reason: 'vector_index_identity_not_synced' });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('https://worker.example/status', expect.objectContaining({
      headers: { Authorization: 'Bearer worker-token' },
    }));
  });

  it.each([null, {}, { success: false }, { dimensions: 0, vectorCount: 1 }])('fails closed on an invalid legacy status: %j', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(status));
    vi.stubGlobal('fetch', fetchMock);
    expect(await provider.vectorSearch('test')).toEqual({ available: false, reason: 'worker_status_failed' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects a legacy dimension mismatch before embedding/query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ dimensions: 3, vectorCount: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await provider.vectorSearch('test')).toEqual({ available: false, reason: 'vector_dimensions_mismatch' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('returns bounded batch entries in order and preserves duplicates', () => {
    const result = provider.getRepositories(['acme/alpha', 'missing/repo', 'acme/alpha']);
    expect(result.notFound).toEqual(['missing/repo']);
    expect(result.items.map((item) => item.input)).toEqual([
      'acme/alpha',
      'missing/repo',
      'acme/alpha',
    ]);
    expect(result.items[1]).toMatchObject({ status: 'not_found', repository: null });
    expect(result.foundCount).toBe(2);
    expect(result.notFoundCount).toBe(1);
    expect(() => provider.getRepositories(Array.from({ length: 51 }, () => 'acme/alpha'))).toThrow(
      'A maximum of 50 repositories may be requested'
    );
  });

  it('reads the latest release from the local cache only', () => {
    configureDb({ releases: [releaseRow({ repo_id: 1 })] });
    const result = provider.getRepoEvidence('acme/alpha');
    expect(result).not.toHaveProperty('error');
    expect(result.evidence.latest_release).toMatchObject({ id: 10, tag_name: 'v1.0.0' });
  });

  it('uses the requested topK unchanged when vector filters are absent', async () => {
    const fetchMock = legacyFetchMock()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockResolvedValueOnce(jsonResponse({
        matches: [{ id: '1', score: 0.9 }],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.vectorSearch('retrieval', { topK: 2, threshold: 0.4 });
    expect(result).toMatchObject({ available: true, matches: [{ id: 1, score: 0.9 }] });
    expect(result).not.toHaveProperty('filtering');
    expect(result).toMatchObject({ indexCompatibility: 'legacy_unverified', warning: expect.stringContaining('unverified') });
    const workerBody = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(workerBody.topK).toBe(2);
    expect(workerBody.threshold).toBe(0.4);
  });

  it('retrieves at most 50 candidates before applying local vector filters', async () => {
    configureDb({
      repos: [
        repoRow({ id: 1, name: 'rust-one', full_name: 'acme/rust-one', language: 'Rust' }),
        repoRow({ id: 2, name: 'python-one', full_name: 'acme/python-one', language: 'Python' }),
      ],
    });
    const fetchMock = legacyFetchMock()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockResolvedValueOnce(jsonResponse({
        matches: [
          { id: '1', score: 0.9 },
          { id: '2', score: 0.8 },
        ],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.vectorSearch('retrieval', {
      topK: 1,
      languages: ['Rust'],
    });
    expect(result).toMatchObject({
      available: true,
      matches: [{ id: 1, score: 0.9 }],
      filtering: {
        mode: 'local_candidate_set',
        candidateLimit: 50,
        exactCorpusFilteredTopK: false,
      },
    });
    expect((result as { filtering: { candidateCount: number; filteredCount: number } }).filtering).toMatchObject({
      candidateCount: 2,
      filteredCount: 1,
    });
    const workerBody = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(workerBody.topK).toBe(50);
  });

  it('excludes the source and deterministically deduplicates similar matches', async () => {
    configureDb({
      repos: [
        repoRow({ id: 1, name: 'source', full_name: 'acme/source' }),
        repoRow({ id: 2, name: 'zeta', full_name: 'acme/zeta' }),
        repoRow({ id: 3, name: 'alpha', full_name: 'acme/alpha-two' }),
      ],
    });
    const fetchMock = legacyFetchMock()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockResolvedValueOnce(jsonResponse({
        matches: [
          { id: '1', score: 1.0 },
          { id: '2', score: 0.8 },
          { id: '2', score: 0.8 },
          { id: '3', score: 0.8 },
        ],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.findSimilarRepositories('acme/source', { topK: 2, threshold: 0.2 });
    expect(result).toMatchObject({ available: true, sourceExcluded: true });
    expect(result.matches.map((match) => match.full_name)).toEqual(['acme/alpha-two', 'acme/zeta']);
    expect(result.matches.some((match) => match.id === 1)).toBe(false);
    const workerBody = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(workerBody.topK).toBe(10);
  });

  it('maps worker connection failures to worker_query_failed instead of throwing', async () => {
    const fetchMock = legacyFetchMock()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.vectorSearch('retrieval', {});
    expect(result).toMatchObject({ available: false });
    expect((result as { reason: string }).reason).toBe('worker_query_failed');
  });

  it('maps a worker timeout abort to worker_query_failed instead of throwing', async () => {
    const fetchMock = legacyFetchMock()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockImplementationOnce((_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('This operation was aborted', 'AbortError'))
          );
        })
      );
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    try {
      const pending = provider.vectorSearch('retrieval', {});
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await pending;
      expect(result).toMatchObject({ available: false });
      expect((result as { reason: string }).reason).toBe('worker_query_failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps a non-JSON worker response to worker_query_failed instead of throwing', async () => {
    const fetchMock = legacyFetchMock()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockResolvedValueOnce(new Response('<html>gateway error</html>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.vectorSearch('retrieval', {});
    expect(result).toMatchObject({ available: false });
    expect((result as { reason: string }).reason).toBe('worker_query_failed');
  });

  it('returns the declared unavailable result from findSimilarRepositories when the worker fails', async () => {
    const fetchMock = legacyFetchMock()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.findSimilarRepositories('acme/alpha', { topK: 3 });
    expect(result).toMatchObject({ available: false });
    expect((result as { reason: string }).reason).toBe('worker_query_failed');
  });

  it('rejects a JSON null worker payload instead of throwing or returning empty matches', async () => {
    const fetchMock = legacyFetchMock()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockResolvedValueOnce(new Response('null', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.vectorSearch('retrieval', {});
    expect(result).toEqual({ available: false, reason: 'worker_query_failed' });
  });

  it('rejects a non-array matches field instead of silently returning empty matches', async () => {
    const fetchMock = legacyFetchMock()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockResolvedValueOnce(jsonResponse({ matches: 'not-an-array' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.vectorSearch('retrieval', {});
    expect(result).toEqual({ available: false, reason: 'worker_query_failed' });
  });
});
