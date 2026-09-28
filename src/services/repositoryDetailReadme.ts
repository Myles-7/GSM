import type { Repository } from '../types';
import { backend } from './backendAdapter';
import { shouldBypassBackend } from './routeMode';
import { createGitHubApiService } from './githubApiFactory';

interface ReadmeEvidence {
  content: string;
  retrievedAt: string;
}
interface CacheEntry {
  controller: AbortController;
  promise: Promise<ReadmeEvidence>;
  consumers: number;
  value?: ReadmeEvidence;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_LIMIT = 100;

export function clearRepositoryDetailReadmeCache() {
  for (const entry of cache.values()) entry.controller.abort();
  cache.clear();
}

async function fetchReadme(repository: Repository, token: string, signal: AbortSignal): Promise<ReadmeEvidence> {
  const [owner, name] = repository.full_name.split('/');
  let content: string;
  if (!shouldBypassBackend() && backend.isAvailable) {
    // The backend adapter returns empty only for 404; all other errors propagate.
    content = await backend.getRepositoryReadme(owner, name, signal);
  } else {
    content = await createGitHubApiService(token).getRepositoryReadme(owner, name, signal, { strict: true });
  }
  signal.throwIfAborted();
  return { content, retrievedAt: new Date().toISOString() };
}

export async function getRepositoryDetailReadme(options: {
  repository: Repository;
  accountId: number;
  githubToken: string;
  signal?: AbortSignal;
}): Promise<ReadmeEvidence> {
  const { repository, accountId, githubToken, signal } = options;
  signal?.throwIfAborted();
  // Credentials and routing scope prevent private evidence reuse across accounts/configurations.
  const key = JSON.stringify([accountId, githubToken, backend.backendUrl, shouldBypassBackend(), repository.full_name, repository.pushed_at || repository.updated_at]);
  let entry = cache.get(key);
  if (entry && (entry.controller.signal.aborted || (entry.value && entry.expiresAt <= Date.now()))) {
    cache.delete(key);
    entry = undefined;
  }
  if (!entry) {
    const controller = new AbortController();
    const created: CacheEntry = { controller, consumers: 0, expiresAt: 0, promise: Promise.resolve({ content: '', retrievedAt: '' }) };
    created.promise = fetchReadme(repository, githubToken, controller.signal).then((value) => {
      controller.signal.throwIfAborted();
      created.value = value;
      created.expiresAt = Date.now() + CACHE_TTL;
      return value;
    }).catch((error: unknown) => {
      if (cache.get(key) === created) cache.delete(key);
      throw error;
    });
    cache.set(key, created);
    entry = created;
    // Evict completed entries only; active requests retain cancellation and dedup semantics.
    for (const [oldKey, oldEntry] of cache) {
      if (cache.size <= CACHE_LIMIT) break;
      if (oldEntry.value) cache.delete(oldKey);
    }
  }
  const request = entry;
  request.consumers += 1;
  return new Promise<ReadmeEvidence>((resolve, reject) => {
    let finished = false;
    const finish = (value?: ReadmeEvidence, error?: unknown) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      request.consumers -= 1;
      if (!request.value && request.consumers === 0) {
        request.controller.abort();
        if (cache.get(key) === request) cache.delete(key);
      }
      if (error !== undefined) reject(error);
      else resolve(value!);
    };
    const onAbort = () => finish(undefined, new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
    request.promise.then((value) => finish(value), (error: unknown) => finish(undefined, error));
    if (signal?.aborted) onAbort();
  });
}
