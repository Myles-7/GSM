import { useMemo } from 'react';
import type { Repository } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { applyRepositoryAnalysisAsset, useRepositoryAnalysisAssets } from '../../../services/repositoryAnalysisAssets';

/** Read-only UI projection that includes the durable per-language analysis asset. */
export function useRepositoryAnalysisPresentation(repositories: Repository[]): Repository[] {
  const accountId = useAppStore(state => state.user?.id);
  const language = useAppStore(state => state.language);
  const assets = useRepositoryAnalysisAssets(state => state.assets);

  return useMemo(() => {
    void assets; // The asset store is the invalidation signal for this read-only projection.
    if (accountId == null) return repositories;
    const account = String(accountId);
    return repositories.map(repository => applyRepositoryAnalysisAsset(account, repository, language));
  }, [accountId, assets, language, repositories]);
}
