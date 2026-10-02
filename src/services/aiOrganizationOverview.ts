import type { Repository } from '../types';

const compact = (text: string | null | undefined, size: number) => text?.slice(0, size);

export const organizationMetadata = (repository: Repository) => ({
  id: repository.id, name: compact(repository.full_name, 160),
  description: compact(repository.description, 400),
  summary: compact(repository.ai_summary || repository.ai_details?.summary, 400),
  topics: repository.topics?.slice(0, 12).map(topic => topic.slice(0, 60)),
  tags: (repository.custom_tags ?? repository.ai_tags)?.slice(0, 12).map(tag => tag.slice(0, 60)),
  personalDescription: compact(repository.custom_description, 240),
  categoryId: repository.category_id, subcategoryId: repository.subcategory_id,
});

// Stratify by current category and language, then spread samples across each stratum.
export function buildOrganizationOverview(repositories: Repository[]) {
  const groups = new Map<string, Repository[]>();
  const topics = new Map<string, number>();
  for (const repo of repositories) {
    const group = JSON.stringify([repo.category_id ?? null, repo.language ?? null]);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(repo);
    for (const topic of new Set((repo.topics ?? []).slice(0, 12))) {
      const key = topic.slice(0, 60);
      topics.set(key, (topics.get(key) || 0) + 1);
    }
  }
  const orderedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const sampled: ReturnType<typeof organizationMetadata>[] = [];
  const seen = new Set<number>();
  let chars = 0;
  const rounds = 80;
  for (let round = 0; round < rounds && sampled.length < 80; round++) {
    for (const [, group] of orderedGroups) {
      const index = Math.floor(round * group.length / Math.min(rounds, group.length));
      const repo = group[index];
      if (!repo || seen.has(repo.id)) continue;
      seen.add(repo.id);
      const entry = organizationMetadata(repo);
      const size = JSON.stringify(entry).length;
      if (chars + size > 48000) continue;
      sampled.push(entry);
      chars += size;
      if (sampled.length === 80) break;
    }
  }
  return {
    totalRepositories: repositories.length,
    sampledRepositories: sampled.length,
    omittedRepositories: repositories.length - sampled.length,
    topicCounts: [...topics].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 100),
    groupCounts: orderedGroups.slice(0, 100).map(([group, members]) => ({ group, count: members.length })),
    omittedGroups: Math.max(0, groups.size - 100),
    repositories: sampled,
  };
}
