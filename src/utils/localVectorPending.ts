import type { EmbeddingConfig, Repository, VectorSearchConfig } from '../types';
import { hasCompatibleVectorIndex } from '../services/vectorIndexIdentity';
import { needsReindex } from '../services/vectorSearchService';

/**
 * Local evidence only, not an exact prediction of writes. README/hash changes
 * are discovered by the existing engine when the user starts indexing.
 */
export function countLocalVectorPending(
  repositories: readonly Repository[],
  embedding: EmbeddingConfig | undefined,
  config: VectorSearchConfig,
): number {
  if (!config.enabled) return 0;
  const compatible = !!embedding && embedding.id === config.embeddingConfigId
    && hasCompatibleVectorIndex(embedding, config);
  const generation = compatible ? config.activeIndex : undefined;
  return repositories.filter((repository) => {
    if (!repository.analyzed_at || repository.analysis_failed) return false;
    return !generation
      || repository.vector_indexed_identity !== generation.identityHash
      || repository.vector_indexed_generation !== generation.namespace
      || !/^[a-f0-9]{64}$/.test(repository.vector_indexed_content_hash ?? '')
      || needsReindex(repository, false);
  }).length;
}

export function formatLocalVectorPending(count: number): string {
  return count > 99 ? '99+' : String(count);
}
