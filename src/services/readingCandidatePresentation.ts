import { loadData } from '../features/discovery/custom/storage';
import { applyRepositoryAnalysisAsset, findLegacyRepositoryAnalysisAsset, hasRepositoryAnalysisAsset, initializeRepositoryAnalysisAssets, projectRepositoryAnalysisAsset } from './repositoryAnalysisAssets';
import type { Repository } from '../types';

/** Shared read projection; applies the same account/deletion rules as desktop analysis. */
export async function loadReadingCandidatePresentation(account: string, saved: Repository[], discovered: Repository[], language: string): Promise<Record<string, Repository>> {
  const legacy = await loadData(account);
  await initializeRepositoryAnalysisAssets(account, saved, legacy);
  const canonical = new Map(saved.map(repo => [repo.id, repo]));
  const projected: Record<string, Repository> = {};
  for (const raw of [...discovered, ...saved]) {
    const base = canonical.get(raw.id) ?? { ...raw, ai_details: undefined, ai_summary: undefined, ai_tags: undefined };
    let repo = applyRepositoryAnalysisAsset(account, base, language);
    if (!hasRepositoryAnalysisAsset(account, base, language)) {
      const asset = findLegacyRepositoryAnalysisAsset(account, base, language, legacy);
      if (asset) repo = projectRepositoryAnalysisAsset(base, asset);
    }
    projected[raw.id] = repo;
  }
  return projected;
}
