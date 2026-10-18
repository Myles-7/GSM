import type { Repository } from '../types';
import { createGitHubApiService } from './githubApiFactory';
import { OrganizationBlockedError } from './aiOrganizationReadiness';

export function throwSharedEvidenceError(error: unknown): void {
  const status = (error as { status?: number })?.status;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 429 || status === 403 && /rate limit/i.test(message)) throw new OrganizationBlockedError('GITHUB_RATE_LIMIT', message);
  if (status === 401 || status === 403 && !/accessible by|permission/i.test(message)) throw new OrganizationBlockedError('GITHUB_AUTH_REQUIRED', message);
  if (error instanceof TypeError || (status ?? 0) >= 500 || status === undefined && /network|fetch|timeout|deadline|ECONN/i.test(message)) throw new OrganizationBlockedError('GITHUB_CONNECTION_FAILED', message);
}

export function isOrganizationReadmeSource(url: string, fullName: string): boolean {
  try {
    const source = new URL(url);
    return source.origin === 'https://github.com' && (source.pathname === `/${fullName}` && source.hash.toLowerCase() === '#readme'
      || source.pathname.startsWith(`/${fullName}/blob/`) && /\/readme(?:\.[^/]+)?$/i.test(source.pathname));
  } catch { return false; }
}

/** Only repository-owned documentation is fetched; model output never supplies a URL or path. */
export async function readOrganizationDocumentation(repository: Repository, token: string, signal: AbortSignal) {
  const [owner, name] = repository.full_name.split('/'); const api = createGitHubApiService(token);
  const { defaultBranch: branch } = await api.getRepositoryMeta(owner, name, signal);
  const tree = await api.getRepositoryTree(owner, name, branch, signal);
  const candidates = tree.entries.filter(entry => entry.type === 'blob' && (entry.size ?? 0) < 64000
    && /^(?:docs?\/)?(?:overview|introduction|getting[-_]?started|usage|architecture|index)\.(?:md|mdx|rst|txt)$/i.test(entry.path)).slice(0, 2);
  const documents = [];
  for (const entry of candidates) {
    signal.throwIfAborted();
    const file = await api.getRepositoryFile(owner, name, entry.path, branch, signal);
    documents.push({ content: file.content.slice(0, 6000), url: `https://github.com/${repository.full_name}/blob/${encodeURIComponent(branch)}/${entry.path.split('/').map(encodeURIComponent).join('/')}`, retrievedAt: new Date().toISOString() });
  }
  return documents;
}
