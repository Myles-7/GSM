import { useEffect, useRef } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { AI_CLASSIFICATION_VERSION, enqueueAIClassificationRebuild } from '../../../services/aiClassificationRebuild';

/** Startup recovery is once per account; normal analysis writes own subsequent scheduling. */
export function useAIClassificationBootstrap() {
  const attempted = useRef<string>();
  const owner = useAppStore(state => state.user?.id);
  const hydrated = useAppStore(state => state.hasHydrated);
  const authenticated = useAppStore(state => state.isAuthenticated);
  const repositories = useAppStore(state => state.repositories);
  const generation = useAppStore(state => state.classificationSchemes?.generation);
  useEffect(() => {
    if (!owner || !hydrated || !authenticated || !repositories.length) return;
    const key = `${owner}:${AI_CLASSIFICATION_VERSION}`;
    if (attempted.current === key) return;
    const hasAnalysis = repositories.some(repo => repo.ai_summary || repo.ai_details || repo.ai_tags?.length || repo.ai_platforms?.length);
    if (!hasAnalysis) return;
    attempted.current = key;
    const interrupted = generation?.status === 'running' || generation?.status === 'stale';
    const outdated = generation?.algorithmVersion !== AI_CLASSIFICATION_VERSION;
    if (!generation || generation.status === 'idle' || interrupted || outdated && generation.status !== 'failed') {
      enqueueAIClassificationRebuild(repositories.map(repo => repo.id), { force: interrupted });
    }
  }, [owner, hydrated, authenticated, repositories, generation]);
  useEffect(() => { if (!owner) attempted.current = undefined; }, [owner]);
}
