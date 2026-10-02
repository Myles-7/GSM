import { useCallback, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { EmbeddingApiType } from '../../../types';
import {
  EMBEDDING_FORMAT_VERSION,
  EmbeddingClient,
  indexAllRepos,
  VectorSearchService,
} from '../../../services/vectorSearchService';
import { createVectorGeneration, embeddingIdentity, hasCompatibleVectorIndex, requireCompatibleVectorIndex } from '../../../services/vectorIndexIdentity';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { useAppStore } from '../../../store/useAppStore';
import { normalizeLicense } from '../../../utils/licenseFilter';
import { countLocalVectorPending } from '../../../utils/localVectorPending';

export interface EmbeddingDraft {
  apiType: EmbeddingApiType;
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
}

export interface VectorWorkerDraft {
  workerUrl: string;
  authToken: string;
}

export interface VectorIndexDraft extends EmbeddingDraft, VectorWorkerDraft {
  indexMode: 'description' | 'readme';
  readmeMaxChars: number;
}

export interface VectorSearchActions {
  testingEmbedding: boolean;
  embeddingTestResult: { success: boolean; dimensions: number; error?: string } | null;
  testingWorker: boolean;
  workerTestResult: { success: boolean; vectorCount: number; dimensions: number; error?: string } | null;
  incrementalTargetCount: number;
  unindexedRepoCount: number;
  testEmbedding: (draft: EmbeddingDraft) => Promise<void>;
  testWorker: (draft: VectorWorkerDraft) => Promise<void>;
  rebuildIndex: (draft: VectorIndexDraft) => Promise<void>;
  incrementalIndex: (draft: VectorIndexDraft) => Promise<void>;
  abortIndexing: () => void;
}

/**
 * Publishes verified generations and their repository stamps together after
 * indexing, leaving the prior generation untouched during a full rebuild.
 */
export const useVectorSearchActions = (): VectorSearchActions => {
  const state = useAppStore(useShallow((store) => ({
    embeddingConfigs: store.embeddingConfigs,
    activeEmbeddingConfig: store.activeEmbeddingConfig,
    vectorSearchConfig: store.vectorSearchConfig,
    repositories: store.repositories,
    githubToken: store.githubToken,
    setVectorSearchStatus: store.setVectorSearchStatus,
    setVectorIndexingState: store.setVectorIndexingState,
    setVectorSearchConfig: store.setVectorSearchConfig,
    updateRepositoriesMetadata: store.updateRepositoriesMetadata,
  })));
  const [testingEmbedding, setTestingEmbedding] = useState(false);
  const [embeddingTestResult, setEmbeddingTestResult] = useState<{ success: boolean; dimensions: number; error?: string } | null>(null);
  const [testingWorker, setTestingWorker] = useState(false);
  const [workerTestResult, setWorkerTestResult] = useState<{ success: boolean; vectorCount: number; dimensions: number; error?: string } | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const activeConfig = useMemo(
    () => state.embeddingConfigs.find((config) => config.id === state.activeEmbeddingConfig),
    [state.activeEmbeddingConfig, state.embeddingConfigs],
  );

  const incrementalTargetCount = useMemo(() => {
    // Hash comparison requires reading the content, including README. These are
    // candidates to inspect, not a promise to embed every candidate.
    if (!activeConfig || !hasCompatibleVectorIndex(activeConfig, state.vectorSearchConfig)) return 0;
    return state.repositories.filter((repository) => repository.analyzed_at && !repository.analysis_failed).length;
  }, [activeConfig, state.repositories, state.vectorSearchConfig]);
  const unindexedRepoCount = useMemo(
    () => countLocalVectorPending(state.repositories, activeConfig, state.vectorSearchConfig),
    [activeConfig, state.repositories, state.vectorSearchConfig],
  );

  const testEmbedding = useCallback(async (draft: EmbeddingDraft) => {
    setTestingEmbedding(true);
    setEmbeddingTestResult(null);
    try {
      const result = await new EmbeddingClient({ id: 'test', name: 'test', ...draft, isActive: true }).testConnection();
      setEmbeddingTestResult(result);
    } catch (reason) {
      setEmbeddingTestResult({ success: false, dimensions: 0, error: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setTestingEmbedding(false);
    }
  }, []);

  const testWorker = useCallback(async (draft: VectorWorkerDraft) => {
    setTestingWorker(true);
    setWorkerTestResult(null);
    try {
      const result = await new VectorSearchService(draft).testConnection();
      setWorkerTestResult(result);
      if (result.success) {
        state.setVectorSearchStatus({ connected: true, vectorCount: result.vectorCount, dimensions: result.dimensions });
      }
    } catch (reason) {
      setWorkerTestResult({ success: false, vectorCount: 0, dimensions: 0, error: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setTestingWorker(false);
    }
  }, [state]);

  const runIndex = useCallback(async (draft: VectorIndexDraft, incremental: boolean) => {
    const initial = useAppStore.getState();
    if (abortController.current || initial.vectorIndexingState?.isIndexing) return;
    const controller = new AbortController();
    abortController.current = controller;
    state.setVectorIndexingState({ isIndexing: true, phase: null, phaseDone: 0, phaseTotal: 0, result: null });
    const repositories = initial.repositories;
    const indexable = repositories.filter((repository) => repository.analyzed_at && !repository.analysis_failed);
    try {
      const embedding = initial.embeddingConfigs.find((config) => config.id === initial.vectorSearchConfig.embeddingConfigId);
      if (!embedding || embedding.id !== initial.activeEmbeddingConfig ||
          JSON.stringify(embeddingIdentity(embedding, initial.vectorSearchConfig)) !== JSON.stringify(embeddingIdentity(draft, draft)) ||
          embedding.apiKey !== draft.apiKey || initial.vectorSearchConfig.authToken !== draft.authToken) {
        throw new Error('Save the embedding and index settings before indexing.');
      }
      const snapshot = (current: typeof initial) => JSON.stringify({
        embedding: current.embeddingConfigs.find((config) => config.id === embedding.id),
        config: current.vectorSearchConfig, active: current.activeEmbeddingConfig,
        githubToken: current.githubToken, user: current.user?.id,
      });
      const originalSnapshot = snapshot(initial);
      const check = () => {
        controller.signal.throwIfAborted();
        if (snapshot(useAppStore.getState()) !== originalSnapshot || useAppStore.getState().repositories !== repositories) {
          throw new Error('Index settings or repositories changed during indexing. Previous generation retained; retry.');
        }
      };
      const generation = incremental
        ? await requireCompatibleVectorIndex(embedding, initial.vectorSearchConfig)
        : await createVectorGeneration(embedding, initial.vectorSearchConfig);
      check();
      const embeddingClient = new EmbeddingClient(embedding);
      const vectorService = new VectorSearchService(initial.vectorSearchConfig, embedding, generation);
      await vectorService.checkCapabilities(embedding.dimensions, controller.signal);
      check();
      const githubApi = initial.githubToken ? createGitHubApiService(initial.githubToken) : null;
      const readmeFetcher = githubApi
        ? (owner: string, repository: string, signal?: AbortSignal) => githubApi.getRepositoryReadme(owner, repository, signal, { strict: true })
        : undefined;
      const now = new Date().toISOString();
      const licenseById = new Map(repositories.map((repository) => [repository.id, repository.license ?? null]));
      const result = await indexAllRepos(repositories, embeddingClient, vectorService, {
        onProgress: (progress) => state.setVectorIndexingState({ phase: progress.phase, phaseDone: progress.done, phaseTotal: progress.total }),
        signal: controller.signal,
        readmeFetcher,
        indexMode: draft.indexMode,
        readmeMaxChars: draft.readmeMaxChars,
        incremental,
        generation,
      });
      check();
      if (result.errors > 0) {
        state.setVectorIndexingState({
          isIndexing: false, phase: null,
          result: { ...result, error: `${result.error || 'Indexing failed.'} Previous generation retained; no generation switch.` },
        });
        return;
      }
      if (!incremental && result.indexedRepoIds.length !== indexable.length) {
        throw new Error('Incomplete staged generation. Previous generation retained.');
      }
      await vectorService.verifyGeneration(result.indexedRepoIds.map((id) => ({
        id: String(id), contentHash: result.indexedContentHashes[String(id)],
      })), controller.signal);
      check();
      // Publish only after every staged write is query-visible. Never clear old
      // stamps or delete old vectors, even when a stage fails or is cancelled.
      state.setVectorSearchConfig({ activeIndex: generation, embeddingFormatVersion: EMBEDDING_FORMAT_VERSION });
      state.updateRepositoriesMetadata(result.indexedRepoIds.map((id) => ({
        id, patch: {
          vector_indexed_at: now,
          vector_indexed_license: normalizeLicense(licenseById.get(id) ?? null),
          vector_indexed_identity: generation.identityHash,
          vector_indexed_generation: generation.namespace,
          vector_indexed_content_hash: result.indexedContentHashes[String(id)],
        },
      })));
      state.setVectorIndexingState({ result, isIndexing: false, phase: null });
      state.setVectorSearchStatus({
        connected: true,
        vectorCount: incremental ? new Set([
          ...repositories.filter((repo) => repo.vector_indexed_generation === generation.namespace).map((repo) => repo.id),
          ...result.indexedRepoIds,
        ]).size : result.indexed,
        dimensions: draft.dimensions,
        lastSyncAt: new Date().toISOString(),
      });
    } catch (reason) {
      const isCancelled = controller.signal.aborted
        || (reason instanceof Error && (reason.name === 'AbortError' || reason.message === 'Aborted'));
      if (isCancelled) {
        state.setVectorIndexingState({ isIndexing: false, phase: null, result: null });
      } else {
        state.setVectorIndexingState({
          isIndexing: false,
          phase: null,
          result: { indexed: 0, skipped: repositories.length - indexable.length, errors: Math.max(1, indexable.length), error: reason instanceof Error ? reason.message : String(reason) },
        });
      }
    } finally {
      abortController.current = null;
    }
  }, [state]);

  const rebuildIndex = useCallback((draft: VectorIndexDraft) => runIndex(draft, false), [runIndex]);
  const incrementalIndex = useCallback((draft: VectorIndexDraft) => runIndex(draft, true), [runIndex]);
  const abortIndexing = useCallback(() => abortController.current?.abort(), []);

  return {
    testingEmbedding, embeddingTestResult, testingWorker, workerTestResult,
    incrementalTargetCount, unindexedRepoCount, testEmbedding, testWorker, rebuildIndex, incrementalIndex, abortIndexing,
  };
};
