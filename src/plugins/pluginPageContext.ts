import type { Repository } from '../types';

export function repositoryContext(repository: Repository): Record<string, unknown> {
  const text = (value: unknown) => typeof value === 'string' ? value : null;
  const flag = (value: unknown) => typeof value === 'boolean' ? value : null;
  return {
    id: repository.id,
    name: repository.name,
    full_name: repository.full_name,
    description: text(repository.description),
    html_url: repository.html_url,
    stargazers_count: Number.isFinite(repository.stargazers_count) ? repository.stargazers_count : 0,
    forks_count: Number.isFinite(repository.forks_count) ? repository.forks_count : 0,
    language: text(repository.language),
    created_at: repository.created_at,
    updated_at: repository.updated_at,
    pushed_at: repository.pushed_at,
    owner: { login: repository.owner.login },
    topics: repository.topics?.filter((topic) => typeof topic === 'string').slice(0, 100) ?? [],
    license: text(repository.license),
    archived: flag(repository.archived),
    disabled: flag(repository.disabled),
    fork: flag(repository.fork),
    is_template: flag(repository.is_template),
    open_issues_count: Number.isFinite(repository.open_issues_count) ? repository.open_issues_count : null,
    default_branch: text(repository.default_branch),
    custom_description: text(repository.custom_description),
    ai_summary: text(repository.ai_summary),
  };
}
