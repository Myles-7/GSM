import type { Category, DiscoveryRepo, Release, Repository } from '../../src/types';
import type { RepositorySubcategory } from '../../src/types/repositoryOrganization';
import type { CustomDiscoveryData, CustomDiscoveryChannel } from '../../src/features/discovery/custom/model';

export const ACCOUNT = 990001;
export const WORKSPACE = 'gsm-diagnostic-offline';
export const STAMP = '2026-10-03T00:00:00.000Z';
export function makeFixture(count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 5000) throw new Error('Invalid fixture size');
  const categories: Category[] = ['a', 'b'].map(id => ({ id: `diag:${id}`, name: `诊断分类 ${id}`, icon: 'folder', keywords: [], isCustom: true }));
  const groups: RepositorySubcategory[] = Array.from({ length: 5 }, (_, i) => ({ id: `diag:g${i}`, parentId: categories[0].id, name: `诊断分组 ${i}`, icon: 'folder' }));
  const repositories: Repository[] = Array.from({ length: count }, (_, i) => ({
    id: 800000 + i, name: `fixture-${i.toString().padStart(5, '0')}`, full_name: `anonymous-${i % 7}/fixture-${i.toString().padStart(5, '0')}`,
    description: ('匿名仓库：本地工具、文档与开发库。 Deterministic offline repository fixture. ').repeat(1 + i % 3),
    html_url: `https://example.invalid/repository/${i}`, owner: { login: `anonymous-${i % 7}`, avatar_url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/%3E' },
    stargazers_count: count - i, forks_count: i % 20, forks: i % 20, topics: ['fixture', 'offline', `topic-${i % 5}`],
    language: ['TypeScript', 'Python', 'Rust'][i % 3], created_at: STAMP, updated_at: STAMP, pushed_at: STAMP,
    category_id: i % 5 === 4 ? categories[1].id : categories[0].id,
    subcategory_id: i % 5 === 4 || i % 11 === 0 ? null : groups[Math.floor(i / 5) % groups.length].id,
    custom_tags: ['anonymous'], category_locked: true,
  }));
  const releases: Release[] = repositories.flatMap(repo => [0, 1].map(j => ({ id: repo.id * 10 + j, tag_name: `v1.${j}`, name: `Fixture ${j}`, body: 'Offline release',
    published_at: `2026-10-0${j + 1}T00:00:00.000Z`, html_url: `https://example.invalid/release/${repo.id}/${j}`, assets: [],
    repository: { id: repo.id, name: repo.name, full_name: repo.full_name } })));
  const discovery: DiscoveryRepo[] = repositories.map((repo, i) => ({ ...repo, channel: 'trending', rank: i + 1, platform: 'All', starsToday: i % 30 }));
  const channel: CustomDiscoveryChannel = { id: 'custom:diagnostic', name: '匿名诊断频道', instruction: 'Offline fixture', revision: 1, enabled: true, paused: true,
    ai: false, autoAnalyze: false, limit: count, hour: 9, cursors: [], blocked: [], read: [], recommended: {},
    plan: { version: 1, required: [], preferred: [], excluded: [], branches: [], filters: { language: null, minStars: null, maxStars: null, createdWithinDays: null }, filterSources: { language: null, minStars: null, maxStars: null, createdWithinDays: null }, conflicts: [] } };
  const data: CustomDiscoveryData = { cache: {}, channels: [channel, { ...channel, id: 'custom:other', name: '匿名对照频道' }],
    editions: [0, 1].map(j => ({ channelId: channel.id, date: `2026-10-0${j + 2}`, revision: 1, instruction: channel.instruction,
      entries: repositories.map(repo => ({ repo, verdict: 'match', reason: '匿名离线结果', evidence: ['Synthetic metadata'], method: 'rules', relevance: 3, preference: 0 })),
      pending: [], errors: [], complete: true, searched: count, filtered: 0, generatedAt: `2026-10-0${j + 2}T00:00:00.000Z` })),
    builtinPreferences: { trending: { autoAnalyze: false }, 'most-popular': { autoAnalyze: false } } };
  return { count, repositories, discovery, releases, categories, groups, data };
}
export type Fixture = ReturnType<typeof makeFixture>;
