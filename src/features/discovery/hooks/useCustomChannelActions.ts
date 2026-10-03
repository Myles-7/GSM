import { useAppStore } from '../../../store/useAppStore';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import type { Repository } from '../../../types';
import { activeAI, currentAccount, previewChannel } from '../custom/runner';
import { parsePlan } from '../custom/model';
import { withDeadline } from '../../../utils/requestDeadline';
import { analyzedRepository } from '../custom/analysis';
import { useCustomDiscovery } from '../custom/store';
import { applyRepositoryAnalysisAsset } from '../../../services/repositoryAnalysisAssets';

async function compile(instruction: string, signal: AbortSignal) {
  const response = await withDeadline(s => activeAI().compileDiscoverySubscription(instruction, s), 60000, signal);
  signal.throwIfAborted();
  return parsePlan(response, instruction);
}
async function star(repo: Repository) {
  const account = currentAccount();
  const state = useAppStore.getState();
  if (!account || !state.githubToken) throw new Error('Please sign in');
  await createGitHubApiService(state.githubToken).starRepository(repo.owner.login, repo.name);
  if (currentAccount() === account && useAppStore.getState().githubToken === state.githubToken) {
    const latest = useAppStore.getState();
    const existing = latest.repositories.find(item => item.id === repo.id);
    const analyzed = existing ? applyRepositoryAnalysisAsset(account, existing, latest.language)
      : analyzedRepository(repo, useCustomDiscovery.getState().data, latest.language);
    if (existing) latest.updateRepository(analyzed);
    else latest.addRepository({ ...analyzed, starred_at: new Date().toISOString() });
  }
}
export function useCustomChannelActions() {
  return { compile, preview: previewChannel, star };
}
