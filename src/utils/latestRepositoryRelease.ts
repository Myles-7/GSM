import type { Release } from '../types';

// Store release arrays are immutable. Weak keys allow old account snapshots to be collected.
type ReleaseIndex = { groups: Map<number, Release[]>; latest: Map<number, Release> };
const indexes = new WeakMap<readonly Release[], ReleaseIndex>();

export function latestRepositoryRelease(releases: readonly Release[] | undefined, repositoryId: number): Release | undefined {
  if (!releases) return undefined;
  let index = indexes.get(releases);
  if (!index) {
    index = { groups: new Map(), latest: new Map() };
    for (const release of releases) {
      const id = release.repository.id;
      const group = index.groups.get(id);
      if (group) group.push(release);
      else index.groups.set(id, [release]);
    }
    indexes.set(releases, index);
  }
  const cached = index.latest.get(repositoryId);
  if (cached) return cached;
  const candidates = index.groups.get(repositoryId);
  if (!candidates) return undefined;
  let latest = candidates[0];
  if (candidates.length > 1) {
    let newestDate = -Infinity;
    // Parse dates only for repositories actually displayed. Keep source order for ties.
    for (const candidate of candidates) {
      const parsed = Date.parse(candidate.published_at);
      const date = Number.isFinite(parsed) ? parsed : -Infinity;
      if (date > newestDate) { latest = candidate; newestDate = date; }
    }
  }
  index.latest.set(repositoryId, latest);
  return latest;
}
