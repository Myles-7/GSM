import { useEffect, useState } from 'react';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { splitOwnerAndRepo } from '../../../services/repositoryChatService';
import { useAppStore } from '../../../store/useAppStore';
import type { Repository } from '../../../types';
import type { RepositoryChatSession } from '../../../types/repositoryChat';

export function useArchivedRepositoryChat(session: RepositoryChatSession | null) {
  const ownerId = useAppStore(state => String(state.user?.id ?? ''));
  const token = useAppStore(state => state.githubToken);
  const sessionId = session?.id;
  const repoId = session?.repoId;
  const repoFullName = session?.repoFullName;
  const sourceRefSha = session?.sourceRefSha;
  const eligible = Boolean(ownerId && session?.ownerId === ownerId && token && repoId && repoFullName && sourceRefSha);
  const scope = eligible ? JSON.stringify([ownerId, sessionId, repoId, repoFullName, sourceRefSha]) : '';
  const [verified, setVerified] = useState<{ scope: string; token: string; repository: Repository | null }>();

  useEffect(() => {
    if (!scope || !token || !repoFullName || !sourceRefSha) return;
    const controller = new AbortController();
    const resolve = async () => {
      const [owner, name] = splitOwnerAndRepo(repoFullName);
      const api = createGitHubApiService(token);
      const repository = await api.getRepository(owner, name, controller.signal);
      if (repository.id !== repoId) return null;
      const sha = await api.getRepositoryHeadSha(owner, name, sourceRefSha, controller.signal);
      return sha === sourceRefSha ? repository : null;
    };
    void resolve().catch(() => null).then(repository => {
      if (!controller.signal.aborted) setVerified({ scope, token, repository });
    });
    return () => controller.abort();
  }, [scope, token, repoId, repoFullName, sourceRefSha]);

  const current = scope && verified?.scope === scope && verified.token === token ? verified : undefined;
  return { repository: current?.repository ?? null, checking: Boolean(scope && !current) };
}
