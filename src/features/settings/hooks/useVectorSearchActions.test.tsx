import { act, renderHook, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository, VectorIndexingState, VectorSearchConfig } from '../../../types';
import { createVectorGeneration } from '../../../services/vectorIndexIdentity';
import { useVectorSearchActions, type VectorIndexDraft } from './useVectorSearchActions';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(), indexAllRepos: vi.fn(), cleanup: vi.fn(), verify: vi.fn(),
  capabilities: vi.fn(), setVectorIndexingState: vi.fn(), setVectorSearchConfig: vi.fn(),
  setVectorSearchStatus: vi.fn(), updateRepositoriesMetadata: vi.fn(),
  embeddingConnection: vi.fn(), workerConnection: vi.fn(),
}));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: mocks.useAppStore }));
vi.mock('../../../services/vectorSearchService', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../services/vectorSearchService')>(),
  EMBEDDING_FORMAT_VERSION: 3,
  EmbeddingClient: class { testConnection = mocks.embeddingConnection; },
  VectorSearchService: class {
    cleanup = mocks.cleanup;
    verifyGeneration = mocks.verify;
    checkCapabilities = mocks.capabilities;
    testConnection = mocks.workerConnection;
  },
  indexAllRepos: mocks.indexAllRepos,
}));
vi.mock('../../../services/githubApiFactory', () => ({ createGitHubApiService: vi.fn() }));

const repository = {
  id: 1, full_name: 'owner/repository', analyzed_at: '2026-08-25T00:00:00.000Z',
  analysis_failed: false, license: 'MIT', vector_indexed_at: '2026-08-26T00:00:00.000Z',
} as Repository;
const draft: VectorIndexDraft = {
  apiType: 'openai', baseUrl: 'https://example.com', apiKey: 'key',
  model: 'embedding-model', dimensions: 3, workerUrl: 'https://worker.example.com',
  authToken: 'worker-token', indexMode: 'description', readmeMaxChars: 6000,
};
const createStoreState = () => ({
  embeddingConfigs: [{ id: 'embedding', name: 'Embedding', ...draft, isActive: true }],
  activeEmbeddingConfig: 'embedding',
  vectorSearchConfig: {
    ...draft, enabled: true, embeddingConfigId: 'embedding', embeddingFormatVersion: 1,
  } as VectorSearchConfig,
  vectorIndexingState: { isIndexing: false, phase: null, phaseDone: 0, phaseTotal: 0, result: null } as VectorIndexingState,
  repositories: [repository], githubToken: null,
  setVectorSearchStatus: mocks.setVectorSearchStatus,
  setVectorIndexingState: mocks.setVectorIndexingState,
  setVectorSearchConfig: mocks.setVectorSearchConfig,
  updateRepositoriesMetadata: mocks.updateRepositoriesMetadata,
});
let storeState = createStoreState();
const success = { indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1], indexedContentHashes: { '1': 'a'.repeat(64) } };

describe('vector generation publication', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubGlobal('crypto', webcrypto);
    storeState = createStoreState();
    storeState.vectorSearchConfig.activeIndex = await createVectorGeneration(draft, draft);
    mocks.useAppStore.mockImplementation((selector?: (state: typeof storeState) => unknown) => selector ? selector(storeState) : storeState);
    Object.assign(mocks.useAppStore, { getState: () => storeState });
    mocks.setVectorIndexingState.mockImplementation((patch) => Object.assign(storeState.vectorIndexingState, patch));
    mocks.setVectorSearchConfig.mockImplementation((patch) => {
      storeState.vectorSearchConfig = { ...storeState.vectorSearchConfig, ...patch };
    });
    mocks.capabilities.mockResolvedValue(undefined);
    mocks.verify.mockResolvedValue(undefined);
    mocks.indexAllRepos.mockResolvedValue(success);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps old identity and stamps until the complete stage is verified, then switches', async () => {
    const oldIndex = storeState.vectorSearchConfig.activeIndex;
    let complete!: () => void;
    mocks.verify.mockImplementation(() => new Promise<void>((resolve) => { complete = resolve; }));
    const { result } = renderHook(() => useVectorSearchActions());
    let indexing!: Promise<void>;
    act(() => { indexing = result.current.rebuildIndex(draft); });
    await waitFor(() => expect(mocks.verify).toHaveBeenCalledOnce());
    expect(mocks.setVectorSearchConfig).not.toHaveBeenCalled();
    expect(mocks.updateRepositoriesMetadata).not.toHaveBeenCalled();
    expect(storeState.vectorSearchConfig.activeIndex).toBe(oldIndex);
    const stage = mocks.indexAllRepos.mock.calls[0][3].generation;
    expect(stage.namespace).not.toBe(oldIndex!.namespace);
    await act(async () => { complete(); await indexing; });
    expect(storeState.vectorSearchConfig.activeIndex).toBe(stage);
    expect(mocks.updateRepositoriesMetadata).toHaveBeenCalledWith([{
      id: 1, patch: expect.objectContaining({
        vector_indexed_generation: stage.namespace, vector_indexed_identity: stage.identityHash,
        vector_indexed_content_hash: success.indexedContentHashes['1'],
      }),
    }]);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it.each(['partial', 'throw', 'verification', 'incomplete', 'capabilities'])('retains old generation and all stamps on %s failure', async (failure) => {
    const oldIndex = storeState.vectorSearchConfig.activeIndex;
    if (failure === 'partial') mocks.indexAllRepos.mockResolvedValue({ ...success, errors: 1 });
    if (failure === 'throw') mocks.indexAllRepos.mockRejectedValue(new Error('Embedding failed'));
    if (failure === 'verification') mocks.verify.mockRejectedValue(new Error('Writes not visible'));
    if (failure === 'incomplete') mocks.indexAllRepos.mockResolvedValue({ ...success, indexedRepoIds: [], indexed: 0 });
    if (failure === 'capabilities') mocks.capabilities.mockRejectedValue(new Error('Update Worker'));
    const { result } = renderHook(() => useVectorSearchActions());
    await act(async () => { await result.current.rebuildIndex(draft); });
    expect(storeState.vectorSearchConfig.activeIndex).toBe(oldIndex);
    expect(mocks.setVectorSearchConfig).not.toHaveBeenCalled();
    expect(mocks.updateRepositoriesMetadata).not.toHaveBeenCalled();
    expect(mocks.setVectorSearchStatus).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(storeState.vectorIndexingState.result?.errors).toBeGreaterThan(0);
  });

  it('publishes a clean migration without pulling excluded legacy vectors into the new generation', async () => {
    delete storeState.vectorSearchConfig.activeIndex;
    storeState.repositories = [repository, { ...repository, id: 2, analyzed_at: undefined, analysis_failed: true }];
    mocks.indexAllRepos.mockResolvedValue({ ...success, skipped: 1 });
    const { result } = renderHook(() => useVectorSearchActions());
    await act(async () => { await result.current.rebuildIndex(draft); });
    expect(storeState.vectorSearchConfig.activeIndex).toBeDefined();
    expect(storeState.vectorSearchConfig.embeddingFormatVersion).toBe(3);
    expect(mocks.updateRepositoriesMetadata).toHaveBeenCalledWith([expect.objectContaining({ id: 1 })]);
    expect(mocks.setVectorSearchStatus).toHaveBeenCalledWith(expect.objectContaining({ vectorCount: 1 }));
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'model', 'target', 'mode'])('rejects incompatible incremental indexing: %s', async (change) => {
    if (change === 'unknown') delete storeState.vectorSearchConfig.activeIndex;
    const changed = { ...draft };
    if (change === 'model') changed.model = 'another-model';
    if (change === 'target') changed.workerUrl = 'https://other.worker';
    if (change === 'mode') changed.indexMode = 'readme';
    Object.assign(storeState.embeddingConfigs[0], changed);
    Object.assign(storeState.vectorSearchConfig, changed);
    const { result } = renderHook(() => useVectorSearchActions());
    await act(async () => { await result.current.incrementalIndex(changed); });
    expect(mocks.indexAllRepos).not.toHaveBeenCalled();
    expect(storeState.vectorIndexingState.result?.error).toContain('Rebuild');
    expect(mocks.setVectorSearchConfig).not.toHaveBeenCalled();
  });

  it('uses the active generation only for a compatible incremental refresh', async () => {
    const active = storeState.vectorSearchConfig.activeIndex;
    const { result } = renderHook(() => useVectorSearchActions());
    await act(async () => { await result.current.incrementalIndex(draft); });
    expect(mocks.indexAllRepos.mock.calls[0][3]).toMatchObject({ generation: active, incremental: true });
    expect(storeState.vectorSearchConfig.activeIndex).toBe(active);
  });

  it('keeps the candidate scan independent of locally known pending and the enabled badge', () => {
    const active = storeState.vectorSearchConfig.activeIndex!;
    storeState.repositories = [{
      ...repository, vector_indexed_license: 'MIT',
      vector_indexed_identity: active.identityHash, vector_indexed_generation: active.namespace,
      vector_indexed_content_hash: 'a'.repeat(64),
    }];
    const { result, rerender } = renderHook(() => useVectorSearchActions());
    expect(result.current.incrementalTargetCount).toBe(1);
    expect(result.current.unindexedRepoCount).toBe(0);
    storeState.repositories = [{ ...storeState.repositories[0], license: 'Apache-2.0' }];
    rerender();
    expect(result.current.incrementalTargetCount).toBe(1);
    expect(result.current.unindexedRepoCount).toBe(1);
    storeState.vectorSearchConfig = { ...storeState.vectorSearchConfig, enabled: false };
    rerender();
    expect(result.current.incrementalTargetCount).toBe(1);
    expect(result.current.unindexedRepoCount).toBe(0);
    expect(mocks.indexAllRepos).not.toHaveBeenCalled();
    expect(mocks.capabilities).not.toHaveBeenCalled();
  });

  it('cancels while waiting for verification without publishing or clearing', async () => {
    mocks.verify.mockImplementation((_entries, signal: AbortSignal) => new Promise<void>((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const { result } = renderHook(() => useVectorSearchActions());
    let indexing!: Promise<void>;
    act(() => { indexing = result.current.rebuildIndex(draft); });
    await waitFor(() => expect(mocks.verify).toHaveBeenCalledOnce());
    act(() => result.current.abortIndexing());
    await act(async () => { await indexing; });
    expect(storeState.vectorIndexingState.result).toBeNull();
    expect(mocks.setVectorSearchConfig).not.toHaveBeenCalled();
    expect(mocks.updateRepositoriesMetadata).not.toHaveBeenCalled();
  });

  it.each(['settings', 'repositories'])('does not publish a stage after %s change in flight', async (change) => {
    mocks.verify.mockImplementation(async () => {
      if (change === 'settings') storeState.vectorSearchConfig = { ...storeState.vectorSearchConfig, workerUrl: 'https://other.worker' };
      else storeState.repositories = [];
    });
    const { result } = renderHook(() => useVectorSearchActions());
    await act(async () => { await result.current.rebuildIndex(draft); });
    expect(mocks.setVectorSearchConfig).not.toHaveBeenCalled();
    expect(mocks.updateRepositoriesMetadata).not.toHaveBeenCalled();
    expect(storeState.vectorIndexingState.result?.error).toContain('changed during');
  });

  it('rejects unsaved drafts before any embedding or Worker request', async () => {
    const { result } = renderHook(() => useVectorSearchActions());
    await act(async () => { await result.current.rebuildIndex({ ...draft, model: 'unsaved' }); });
    expect(mocks.capabilities).not.toHaveBeenCalled();
    expect(mocks.indexAllRepos).not.toHaveBeenCalled();
    expect(storeState.vectorIndexingState.result?.error).toContain('Save');
  });

  it('prevents double starts and concurrent hook instances', async () => {
    let complete!: () => void;
    mocks.verify.mockImplementation(() => new Promise<void>((resolve) => { complete = resolve; }));
    const first = renderHook(() => useVectorSearchActions());
    const second = renderHook(() => useVectorSearchActions());
    let indexing!: Promise<void>;
    act(() => { indexing = first.result.current.rebuildIndex(draft); });
    await act(async () => {
      await first.result.current.rebuildIndex(draft);
      await second.result.current.rebuildIndex(draft);
    });
    await waitFor(() => expect(mocks.verify).toHaveBeenCalledOnce());
    await act(async () => { complete(); await indexing; });
    expect(mocks.indexAllRepos).toHaveBeenCalledOnce();
  });

  it.each(['embedding', 'worker'] as const)('cancels %s tests without overwriting the last successful result, even if the provider ignores abort', async kind => {
    const connection = kind === 'embedding' ? mocks.embeddingConnection : mocks.workerConnection;
    const previous = { success: true, dimensions: 3, vectorCount: 7 };
    connection.mockResolvedValueOnce(previous);
    const { result } = renderHook(() => useVectorSearchActions());
    const run = () => kind === 'embedding' ? result.current.testEmbedding(draft) : result.current.testWorker(draft);
    const getResult = () => kind === 'embedding' ? result.current.embeddingTestResult : result.current.workerTestResult;
    await act(async () => { await run(); });
    expect(getResult()).toEqual(previous);
    let finish!: (value: typeof previous) => void;
    let signal!: AbortSignal;
    connection.mockImplementation((requestSignal: AbortSignal) => { signal = requestSignal; return new Promise(resolve => { finish = resolve; }); });
    let pending!: Promise<void>;
    act(() => { pending = run(); });
    await waitFor(() => expect(connection).toHaveBeenCalledTimes(2));
    await act(async () => { await run(); });
    expect(connection).toHaveBeenCalledTimes(2);
    act(() => kind === 'embedding' ? result.current.cancelEmbeddingTest() : result.current.cancelWorkerTest());
    await act(async () => { await pending; });
    expect(signal.aborted).toBe(true);
    expect(getResult()).toEqual(previous);
    expect(kind === 'embedding' ? result.current.testingEmbedding : result.current.testingWorker).toBe(false);
    await act(async () => { finish({ ...previous, success: false }); });
    expect(getResult()).toEqual(previous);
  });
});
