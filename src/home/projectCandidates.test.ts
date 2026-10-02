import { describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import type { WorkbenchProject } from '../types/aiWorkbench';
import { projectRepositoryMetadata, resolveProjectRepositories } from './projectCandidates';

const repository = (full_name: string, id: number): Repository => ({ id, full_name, name: full_name.split('/')[1], html_url: `https://github.com/${full_name}`, description: null, language: null, stargazers_count: 2, forks_count: 1, forks: 1, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', pushed_at: '2026-01-01T00:00:00.000Z', owner: { login: full_name.split('/')[0], avatar_url: '' }, topics: [] });
const project = (repositories: Repository[], selectedRepositoryNames?: string[]): WorkbenchProject => ({ id: 'p', ownerId: '1', name: 'Project', instructions: '', conclusions: '', repositories, selectedRepositoryNames, createdAt: '', updatedAt: '' });
describe('cross-device project candidates', () => {
  it('retains offline names and resolves only missing repositories at research time', async () => {
    const saved = repository('a/saved', 1); const library = repository('a/library', 2); const remote = repository('a/remote', 3); const resolve = vi.fn(async () => remote);
    const result = await resolveProjectRepositories(project([saved], ['a/saved', 'a/library', 'a/remote', 'a/remote']), [library], resolve);
    expect(result).toEqual([saved, library, remote]); expect(resolve).toHaveBeenCalledExactlyOnceWith('a/remote');
  });
  it('honors explicitly cleared names and supports legacy projects', async () => {
    const saved = repository('a/saved', 1); const resolve = vi.fn();
    expect(await resolveProjectRepositories(project([saved], []), [], resolve)).toEqual([]);
    expect(await resolveProjectRepositories(project([saved]), [], resolve)).toEqual([saved]); expect(resolve).not.toHaveBeenCalled();
  });
  it('does not put unresolved descriptors or raw API extra fields into repository objects', () => {
    expect(projectRepositoryMetadata({ full_name: 'a/missing', id: 1 })).toBeNull();
    const saved = repository('a/saved', 1);
    expect(projectRepositoryMetadata({ ...saved, permissions: { admin: true }, owner: { ...saved.owner, node_id: 'opaque' } })).toEqual(saved);
  });
});
