import type { DiscoveryRepo, PaginatedDiscoveryRepositories } from '../../../types';
import { withDeadline } from '../../../utils/requestDeadline';
import { discoveryItemKey, mergeStableItems, type DiscoveryRankingStage } from './model';
import { clearRankingStage, loadBrowseSession, loadRankingProjects, loadRankingStage, saveBrowsePage, saveRankingStage } from './storage';

const records = (repos: DiscoveryRepo[]) => repos as unknown as Record<string, unknown>[];
export async function refreshPopularReading(options: {
  account: string; key: string; signature: string; reorder: boolean; batchSize: number;
  signal: AbortSignal; isCurrent: () => boolean;
  fetchPage: (page: number, signal: AbortSignal) => Promise<PaginatedDiscoveryRepositories>;
  progress: (current: number, total: number) => void;
}) {
  const { account, key, signature, signal } = options;
  const checkCurrent = () => { signal.throwIfAborted(); if (!options.isCurrent()) throw new DOMException('Stale reading refresh', 'AbortError'); };
  let storageIssue: unknown;
  const previous = await loadBrowseSession(account, key).catch(error => { storageIssue = error; return null; });
  const savedStage = storageIssue ? undefined : await loadRankingStage(account, key);
  checkCurrent();
  const mode = options.reorder ? 'reorder' : 'refresh';
  const usable = savedStage && savedStage.mode === mode && savedStage.baseVersion === (previous?.session.version || 0);
  let stage: DiscoveryRankingStage = usable ? savedStage : {
    key, channelId: 'most-popular', signature, mode, baseVersion: previous?.session.version || 0,
    targetCount: Math.max(options.batchSize, previous?.session.itemKeys.length || 0), nextPage: 1, projectKeys: [], hasMore: true, totalCount: 0,
  };
  const collected = new Map((usable ? await loadRankingProjects(account, stage) as unknown as DiscoveryRepo[] : [])
    .map(repo => [discoveryItemKey(repo), repo]));
  let issue: unknown;
  const deadline = Date.now() + 60000;
  for (let requests = 0; requests < 5 && Date.now() < deadline; requests++) {
    signal.throwIfAborted(); if (!options.isCurrent()) throw new DOMException('Stale reading refresh', 'AbortError');
    try {
      const result = await withDeadline(s => options.fetchPage(stage.nextPage, s), Math.min(15000, deadline - Date.now()), signal);
      signal.throwIfAborted(); if (!options.isCurrent()) throw new DOMException('Stale reading refresh', 'AbortError');
      for (const repo of result.repos) collected.set(discoveryItemKey(repo), repo);
      stage = { ...stage, projectKeys: [...collected.keys()], nextPage: result.nextPageIndex, hasMore: result.hasMore, totalCount: result.totalCount || 0 };
      if (!storageIssue) {
        try { await saveRankingStage(account, stage, records(result.repos), () => !signal.aborted && options.isCurrent()); }
        catch (error) {
          checkCurrent();
          if (error instanceof Error && error.message === 'DISCOVERY_WORKSPACE_STALE_WRITE') throw error;
          storageIssue = error;
        }
      }
      checkCurrent();
      options.progress(Math.min(collected.size, stage.targetCount), stage.targetCount);
      if (!stage.hasMore || collected.size >= stage.targetCount) break;
    } catch (error) { if (signal.aborted || !options.isCurrent()) throw error; issue = error; break; }
  }
  const complete = !issue && (!stage.hasMore || collected.size >= stage.targetCount);
  const repos = [...collected.values()];
  checkCurrent();
  if (options.reorder && !complete) return { saved: previous, complete, issue, stage, storageIssue };
  const fallback = () => ({ repos: options.reorder ? repos : mergeStableItems(previous?.items as unknown as DiscoveryRepo[] || [], repos, discoveryItemKey),
    nextPage: !options.reorder && previous ? previous.session.nextPage : stage.nextPage,
    hasMore: !options.reorder && previous ? previous.session.hasMore : stage.hasMore, totalCount: stage.totalCount });
  if (storageIssue) return { saved: null, complete, issue, stage, storageIssue, unsaved: fallback() };
  if (repos.length || complete) {
    try {
      const saved = await saveBrowsePage(account, { key, channelId: 'most-popular', signature,
      items: records(repos), itemKeys: repos.map(discoveryItemKey), nextPage: stage.nextPage,
      hasMore: stage.hasMore, totalCount: stage.totalCount, expectedVersion: stage.baseVersion,
      mode: options.reorder ? 'replace' : 'stable', preserveCursor: !options.reorder && !!previous,
      exposeCount: options.reorder ? stage.targetCount : undefined, isCurrent: () => !signal.aborted && options.isCurrent() });
      if (complete) await clearRankingStage(account, key, stage.baseVersion);
      else await saveRankingStage(account, { ...stage, baseVersion: saved.version }, []);
    } catch (error) {
      checkCurrent();
      if (error instanceof Error && error.message === 'DISCOVERY_WORKSPACE_STALE_WRITE') throw error;
      return { saved: previous, complete, issue, stage, storageIssue: error, unsaved: fallback() };
    }
  }
  return { saved: await loadBrowseSession(account, key), complete, issue, stage };
}
