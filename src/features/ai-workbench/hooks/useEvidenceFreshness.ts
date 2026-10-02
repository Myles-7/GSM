import { useEffect, useState } from 'react';
import { checkEvidenceFreshness, type EvidenceFreshness } from '../../../services/evidenceFreshness';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { getLocalResearchGrant } from '../../../services/localResearchGrants';
import { useAppStore } from '../../../store/useAppStore';
import type { ToolEvidence } from '../../../types/repositoryChat';

export function useEvidenceFreshness(evidence: ToolEvidence[], sessionId: string | null, owner: string, revision?: string) {
  const token = useAppStore(state => state.githubToken);
  const [status, setStatus] = useState<Record<string, EvidenceFreshness>>({});
  const signature = JSON.stringify(evidence.map(item => [item.id, item.refSha, item.contentHash]));
  useEffect(() => {
    const controller = new AbortController();
    setStatus({});
    const grant = sessionId ? getLocalResearchGrant(sessionId, owner) : undefined;
    const api = window.electronAPI?.agy;
    const timer = setTimeout(() => controller.abort(), 20_000);
    const unsubscribe = useAppStore.subscribe((next, previous) => {
      if (next.user?.id !== previous.user?.id || next.githubToken !== previous.githubToken) controller.abort();
    });
    void checkEvidenceFreshness(evidence, {
      head: async (repository, signal) => {
        if (!token) throw Error('No GitHub credentials');
        const [org, repo] = repository.split('/');
        return createGitHubApiService(token).getRepositoryHeadSha(org, repo, 'HEAD', signal);
      },
      local: grant && api ? async (path, signal) => {
        const id = crypto.randomUUID();
        const cancel = () => { void api.cancel(id); };
        signal.addEventListener('abort', cancel, { once: true });
        try {
          const result = await api.readProject(id, grant.id, path);
          signal.throwIfAborted();
          if (!result.ok) throw Error(result.code);
          return result.value.contentHash;
        } finally { signal.removeEventListener('abort', cancel); }
      } : undefined,
    }, controller.signal, (id, value) => setStatus(previous => ({ ...previous, [id]: value })))
      .catch(() => {}).finally(() => clearTimeout(timer));
    return () => { controller.abort(); clearTimeout(timer); unsubscribe(); };
    // Signature represents evidence identity; history refreshes must not repeat network checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, sessionId, owner, token, revision]);
  return status;
}
