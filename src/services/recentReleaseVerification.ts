import type { Release, Repository } from '../types';
import { withDeadline } from '../utils/requestDeadline';

type ReleasePage = { releases: Release[]; hasMore: boolean };
type ReadPage = (repo: Repository, page: number, signal: AbortSignal) => Promise<ReleasePage>;
const cache = new Map<string, Map<number, { fetchedAt: number; pages: ReleasePage[] }>>();
export const isRecentRelease = (release: Release & { draft?: boolean }, prereleases: boolean, now = Date.now()) =>
  release.draft !== true && (prereleases || !release.prerelease) && Number.isFinite(Date.parse(release.published_at))
  && Date.parse(release.published_at) <= now && Date.parse(release.published_at) >= now - 14 * 86400000;

export async function verifyRecentReleases(
  candidates: Repository[], scope: string, readPage: ReadPage,
  options: { prereleases?: boolean; signal?: AbortSignal; onProgress?: (progress: { current: number; total: number; failed: number }) => void } = {},
) {
  const repos = candidates.slice(0, 40);
  const matches = new Map<number, Release>();
  let next = 0, current = 0, failed = 0;
  const byRepo = cache.get(scope) ?? new Map();
  cache.set(scope, byRepo);
  if (cache.size > 4) cache.delete(cache.keys().next().value!);
  await withDeadline(async signal => {
    const worker = async () => {
      while (next < repos.length && !signal.aborted) {
        const repo = repos[next++];
        try {
          const saved = byRepo.get(repo.id);
          const fresh = saved && Date.now() - saved.fetchedAt < 30 * 60000;
          const pages: ReleasePage[] = fresh ? [...saved.pages] : [];
          let resolved = false;
          for (let page = 1; page <= 3; page++) {
            const result = pages[page - 1] ?? await withDeadline(s => readPage(repo, page, s), 15000, signal);
            signal.throwIfAborted();
            pages[page - 1] = result;
            const recent = result.releases.filter(release => isRecentRelease(release, options.prereleases === true))
              .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
            if (recent[0]) { matches.set(repo.id, recent[0]); resolved = true; break; }
            if (!result.hasMore) { resolved = true; break; }
          }
          if (!resolved) failed++;
          byRepo.set(repo.id, { fetchedAt: fresh ? saved.fetchedAt : Date.now(), pages });
          if (byRepo.size > 400) byRepo.delete(byRepo.keys().next().value);
        } catch (error) {
          if (options.signal?.aborted) throw error;
          failed++;
        } finally {
          if (!signal.aborted) { current++; options.onProgress?.({ current, total: repos.length, failed }); }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, repos.length) }, worker));
  }, 120000, options.signal).catch(error => {
    if (options.signal?.aborted) throw error;
    failed += Math.max(0, repos.length - current);
  });
  return { matches, verification: { current, total: repos.length, failed, partial: failed > 0 || current < repos.length } };
}
