import { useAppStore } from '../../../store/useAppStore';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import type { Repository } from '../../../types';
import { activeAI, currentAccount, previewChannel } from '../custom/runner';
import { parsePlan } from '../custom/model';
import { withDeadline } from '../../../utils/requestDeadline';

async function compile(instruction: string, signal: AbortSignal) {
  const response = await withDeadline(s => activeAI().compileDiscoverySubscription(instruction, s), 60000, signal);
  signal.throwIfAborted();
  return parsePlan(response, instruction);
}
async function star(repo: Repository) {
  const account = currentAccount();
  const state = useAppStore.getState();
  if (!state.githubToken) throw new Error('Please sign in');
  await createGitHubApiService(state.githubToken).starRepository(repo.owner.login, repo.name);
  if (currentAccount() === account) useAppStore.getState().addRepository({ ...repo, starred_at: new Date().toISOString() });
}
export function useCustomChannelActions() {
  return { compile, preview: previewChannel, star };
}
