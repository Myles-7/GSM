import type { Repository } from '../types';
import type { ExternalDiscoveryChannelId, ExternalFeedKind } from '../types/externalFeed';
import { withDeadline } from '../utils/requestDeadline';
import { EXTERNAL_FEED_TIMEOUT_MS, MAX_EXTERNAL_RESPONSE_BYTES, normalizeDiscoveryFeedUrl } from './externalFeedConfig';
import { ExternalFeedError } from './externalFeedErrors';
import { parseDiscoveryFeedRepositories, parseDiscoveryRssRepositories } from './externalFeedParsers';

export interface ExternalFeedRepositoryApi {
  getRepositoryDetails(owner: string, repo: string, signal?: AbortSignal): Promise<Repository>;
}

async function readFeed(sourceUrl: string, kind: ExternalFeedKind, signal: AbortSignal): Promise<string[]> {
  const url = normalizeDiscoveryFeedUrl(sourceUrl);
  if (!url) throw new ExternalFeedError('invalid-url');
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json, application/rss+xml, application/atom+xml, application/xml, text/xml' },
      credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal,
    });
  } catch {
    signal.throwIfAborted();
    throw new ExternalFeedError('unreadable');
  }
  // A transport that ignores abort must still release its eventual response.
  if (signal.aborted || !response.ok || response.redirected
    || Number(response.headers.get('content-length')) > MAX_EXTERNAL_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    signal.throwIfAborted();
    throw new ExternalFeedError(Number(response.headers.get('content-length')) > MAX_EXTERNAL_RESPONSE_BYTES ? 'too-large' : 'http');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ExternalFeedError('invalid-format');
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_EXTERNAL_RESPONSE_BYTES) throw new ExternalFeedError('too-large');
      chunks.push(value);
    }
  } catch (error) {
    cancel();
    signal.throwIfAborted();
    throw error instanceof ExternalFeedError ? error : new ExternalFeedError('unreadable');
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new ExternalFeedError('invalid-format'); }
  if (kind === 'rss') return parseDiscoveryRssRepositories(text);
  let payload: unknown;
  try { payload = JSON.parse(text); }
  catch { throw new ExternalFeedError('invalid-format'); }
  return parseDiscoveryFeedRepositories(payload);
}

export function readExternalDiscoveryFeed(url: string, signal?: AbortSignal): Promise<string[]> {
  return withDeadline(inner => readFeed(url, 'json', inner), EXTERNAL_FEED_TIMEOUT_MS, signal);
}

export function readExternalDiscoveryRssFeed(url: string, signal?: AbortSignal): Promise<string[]> {
  return withDeadline(inner => readFeed(url, 'rss', inner), EXTERNAL_FEED_TIMEOUT_MS, signal);
}

export function loadExternalDiscoveryFeed(
  url: string, channelId: ExternalDiscoveryChannelId, api: ExternalFeedRepositoryApi,
  kind: ExternalFeedKind = 'json', signal?: AbortSignal,
) {
  return withDeadline(async inner => {
    const names = await readFeed(url, kind, inner);
    const details: (Repository | null)[] = Array(names.length).fill(null);
    let cursor = 0;
    const worker = async () => {
      while (cursor < names.length) {
        inner.throwIfAborted();
        const index = cursor++;
        const [owner, repo] = names[index].split('/');
        try { details[index] = await api.getRepositoryDetails(owner, repo, inner); }
        catch { inner.throwIfAborted(); }
        inner.throwIfAborted();
      }
    };
    await Promise.all(Array.from({ length: Math.min(5, names.length) }, worker));
    inner.throwIfAborted();
    const repos = details.filter((detail): detail is Repository => !!detail)
      .map((detail, index) => ({ ...detail, rank: index + 1, channel: channelId, platform: 'All' as const }));
    if (names.length && !repos.length) throw new ExternalFeedError('no-details');
    return { repos, hasMore: false, nextPageIndex: 2, totalCount: repos.length };
  }, EXTERNAL_FEED_TIMEOUT_MS, signal);
}
