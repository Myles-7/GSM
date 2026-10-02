import { useEffect, useRef, useState } from 'react';
import { createGitHubApiService } from '../services/githubApiFactory';
import { useAppStore } from '../store/useAppStore';
import type { Repository } from '../types';

export function usePluginPageReadme(repository: Repository) {
  const [account, setAccount] = useState(() => {
    const state = useAppStore.getState();
    return { githubToken: state.githubToken, ownerId: state.user?.id, epoch: 0 };
  });
  const { githubToken, ownerId, epoch } = account;
  const epochRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const key = `${epoch}:${ownerId}:${githubToken}:${repository.id}:${repository.full_name}`;
  const [result, setResult] = useState<{ key: string; readme: string | null } | null>(null);

  useEffect(() => useAppStore.subscribe((next, previous) => {
    if (next.user?.id === previous.user?.id && next.githubToken === previous.githubToken) return;
    epochRef.current++;
    controllerRef.current?.abort();
    setResult(null);
    setAccount({ githubToken: next.githubToken, ownerId: next.user?.id, epoch: epochRef.current });
  }), []);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestEpoch = epochRef.current;
    try {
      const api = createGitHubApiService(githubToken ?? '');
      void api.getRepositoryReadme(repository.owner.login, repository.name, controller.signal)
        .then((readme) => {
          if (!disposed && requestEpoch === epochRef.current) setResult({ key, readme });
        }).catch(() => {
          if (!disposed && requestEpoch === epochRef.current) setResult({ key, readme: null });
        });
    } catch { /* Metadata remains usable without a README. */ }
    return () => { disposed = true; controller.abort(); };
  }, [githubToken, key, repository.name, repository.owner.login]);

  return { readme: result?.key === key ? result.readme : null };
}
