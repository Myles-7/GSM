import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import { countLocalVectorPending } from '../../../utils/localVectorPending';

export function useLocalVectorPendingCount(): number {
  const { repositories, embeddingConfigs, activeEmbeddingConfig, vectorSearchConfig } = useAppStore(useShallow((state) => ({
    repositories: state.repositories,
    embeddingConfigs: state.embeddingConfigs,
    activeEmbeddingConfig: state.activeEmbeddingConfig,
    vectorSearchConfig: state.vectorSearchConfig,
  })));
  return useMemo(() => vectorSearchConfig
    ? countLocalVectorPending(
      repositories ?? [],
      embeddingConfigs?.find((config) => config.id === activeEmbeddingConfig),
      vectorSearchConfig,
    )
    : 0, [repositories, embeddingConfigs, activeEmbeddingConfig, vectorSearchConfig]);
}
