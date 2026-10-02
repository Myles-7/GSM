import type { Repository } from '../types';
import type { WorkbenchProject } from '../types/aiWorkbench';

/** Only complete metadata belongs in the desktop repository model. Names remain durable independently. */
export function projectRepositoryMetadata(value: unknown): Repository | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (!['id', 'stargazers_count', 'forks_count'].every(key => typeof record[key] === 'number')) return null;
  if (!['name', 'full_name', 'html_url', 'created_at', 'updated_at', 'pushed_at'].every(key => typeof record[key] === 'string')) return null;
  const owner = record.owner as { login?: unknown; avatar_url?: unknown } | undefined;
  if (typeof owner?.login !== 'string' || typeof owner.avatar_url !== 'string') return null;
  const result: Repository = { id: Number(record.id), name: String(record.name), full_name: String(record.full_name), html_url: String(record.html_url), description: typeof record.description === 'string' ? record.description : null, language: typeof record.language === 'string' ? record.language : null, stargazers_count: Number(record.stargazers_count), forks_count: Number(record.forks_count), forks: Number(record.forks ?? record.forks_count), created_at: String(record.created_at), updated_at: String(record.updated_at), pushed_at: String(record.pushed_at), owner: { login: owner.login, avatar_url: owner.avatar_url }, topics: Array.isArray(record.topics) ? record.topics.filter((item): item is string => typeof item === 'string') : [] };
  for (const key of ['custom_description', 'custom_tags', 'category_id', 'subcategory_id', 'category_locked', 'category_candidates', 'custom_category', 'ai_summary', 'ai_tags', 'ai_platforms', 'default_branch', 'archived', 'disabled', 'fork', 'is_template', 'open_issues_count'] as const) if (record[key] !== undefined) Object.assign(result, { [key]: record[key] });
  return result;
}
export async function resolveProjectRepositories(project: WorkbenchProject, library: Repository[], resolve: (fullName: string) => Promise<Repository>): Promise<Repository[]> {
  const names = project.selectedRepositoryNames ?? project.repositories.map(repo => repo.full_name);
  const known = new Map([...project.repositories, ...library].map(repo => [repo.full_name, repo]));
  return Promise.all([...new Set(names)].map(name => known.get(name) ?? resolve(name)));
}
