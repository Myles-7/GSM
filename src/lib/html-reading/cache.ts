import type { DiscoveryRepo } from '../../types';
import { openReadingDb } from './storage';

export const READING_CACHE_LIMIT = 100 * 1024 * 1024;
export interface ReadingSourceProvenance { channelId: string; sourceSignature: string; fetchedAt: string; retained: boolean }
export interface ReadingDiscoverySource {
  repos: DiscoveryRepo[]; updatedAt: string; warning?: string;
  status: 'cached' | 'updated' | 'partial' | 'empty' | 'unavailable'; fetchedCount?: number;
  fetchedTarget?: number; exhausted?: boolean;
  provenance?: Record<string, ReadingSourceProvenance>;
}
interface CacheRecord { accountId: string; channelId: string; signature: string; source: ReadingDiscoverySource; successfulAt: string | null; accessedAt: number; bytes: number }
const key = (account: string, channel: string, signature: string) => [account, channel, signature];
const cleanText = (value: unknown) => typeof value === 'string' ? value : '';
/** Allowlist public repository metadata: provider objects, account stores and credentials never enter this store. */
export function sanitizeReadingDiscoveryRepo(repo: DiscoveryRepo): DiscoveryRepo {
  const fullName = cleanText(repo.full_name);
  if (!Number.isSafeInteger(repo.id) || repo.id < 1 || !/^[\w.-]+\/[\w.-]+$/.test(fullName)) throw new Error('发现项目标识无效。');
  const cleaned = { id: repo.id, name: fullName.split('/')[1], full_name: fullName, html_url: `https://github.com/${fullName}`,
    description: repo.description == null ? null : cleanText(repo.description), owner: { login: fullName.split('/')[0], avatar_url: '' },
    stargazers_count: Number.isFinite(repo.stargazers_count) ? repo.stargazers_count : 0, forks_count: 0, forks: 0,
    topics: Array.isArray(repo.topics) ? repo.topics.filter(t => typeof t === 'string') : [], language: repo.language == null ? null : cleanText(repo.language),
    created_at: cleanText(repo.created_at), updated_at: cleanText(repo.updated_at), pushed_at: cleanText(repo.pushed_at),
    rank: Number.isFinite(repo.rank) ? repo.rank : 0, channel: repo.channel, platform: repo.platform,
  } as DiscoveryRepo;
  if (repo.recentRelease) {
    const release = repo.recentRelease as typeof repo.recentRelease & { body?: string; draft?: boolean };
    try { const url = new URL(release.html_url); if (url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && !url.search && !url.hash && url.pathname.startsWith(`/${fullName}/releases/tag/`)) {
      cleaned.recentRelease = { tag_name: cleanText(release.tag_name), name: cleanText(release.name), published_at: cleanText(release.published_at), html_url: url.href, prerelease: release.prerelease === true,
        ...(typeof release.body === 'string' ? { body: release.body } : {}), ...(release.draft ? { draft: true } : {}) };
    } } catch { /* Invalid source URLs are excluded. */ }
  }
  return cleaned;
}
export async function loadReadingDiscoveryCache(account: string, channel: string, signature: string, maxAgeDays = 7, validate?: () => void, signal?: AbortSignal) {
  const db = await openReadingDb();
  try { validate?.(); signal?.throwIfAborted(); return await new Promise<{ source: ReadingDiscoverySource; valid: boolean } | null>((resolve, reject) => {
    const tx = db.transaction('discovery-cache', 'readwrite'); let result: { source: ReadingDiscoverySource; valid: boolean } | null = null;
    let failure: unknown;
    const abort = () => { try { validate?.(); } catch (cause) { failure = cause; } failure ??= signal?.reason; try { tx.abort(); } catch { /* Already settled. */ } };
    signal?.addEventListener('abort', abort, { once: true });
    const store = tx.objectStore('discovery-cache'), read = store.get(key(account, channel, signature));
    read.onsuccess = () => { try { validate?.(); signal?.throwIfAborted(); const entry = read.result as CacheRecord | undefined; if (!entry) return;
      const age = Date.now() - Date.parse(entry.successfulAt ?? '');
      result = { source: structuredClone(entry.source), valid: Number.isFinite(age) && age >= 0 && age <= Math.min(7, maxAgeDays) * 86400000 };
      entry.accessedAt = Date.now(); store.put(entry, key(account, channel, signature));
    } catch (cause) { failure = cause; try { tx.abort(); } catch { /* Already aborted. */ } } };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    tx.oncomplete = () => { cleanup(); resolve(result); }; tx.onabort = tx.onerror = () => { cleanup(); reject(failure ?? tx.error); };
    if (signal?.aborted) abort();
  }); } finally { db.close(); }
}
export async function saveReadingDiscoveryCache(account: string, channel: string, signature: string, source: ReadingDiscoverySource, validate?: () => void, signal?: AbortSignal) {
  const db = await openReadingDb();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('discovery-cache', 'readwrite'), store = tx.objectStore('discovery-cache'); let failure: unknown;
    const abort = () => { try { validate?.(); } catch (cause) { failure = cause; } failure ??= signal?.reason; try { tx.abort(); } catch { /* Already settled. */ } };
    signal?.addEventListener('abort', abort, { once: true });
    const read = store.getAll(); read.onsuccess = () => { try {
      validate?.();
      const sanitized: ReadingDiscoverySource = { repos: source.repos.map(sanitizeReadingDiscoveryRepo), updatedAt: cleanText(source.updatedAt), status: source.status,
        fetchedCount: source.fetchedCount, fetchedTarget: source.fetchedTarget, exhausted: source.exhausted, warning: source.warning, provenance: structuredClone(source.provenance ?? {}) };
      const successful = source.status === 'updated' || source.status === 'empty' || source.status === 'cached';
      const previous = (read.result as CacheRecord[]).find(e => e.accountId === account && e.channelId === channel && e.signature === signature);
      const record: CacheRecord = { accountId: account, channelId: channel, signature, source: sanitized, successfulAt: successful ? source.updatedAt : source.status === 'unavailable' ? previous?.successfulAt ?? null : null, accessedAt: Date.now(), bytes: 0 };
      record.bytes = new Blob([JSON.stringify(record)]).size;
      if (record.bytes > READING_CACHE_LIMIT) return;
      const existing = (read.result as CacheRecord[]).filter(e => !(e.accountId === account && e.channelId === channel && e.signature === signature)).sort((a,b) => a.accessedAt - b.accessedAt);
      let bytes = record.bytes + existing.reduce((n,e) => n + e.bytes, 0);
      for (const entry of existing) { if (bytes <= READING_CACHE_LIMIT) break; store.delete(key(entry.accountId, entry.channelId, entry.signature)); bytes -= entry.bytes; }
      store.put(record, key(account, channel, signature));
    } catch (error) { failure = error; tx.abort(); } };
    tx.oncomplete = () => { signal?.removeEventListener('abort', abort); resolve(); }; tx.onabort = tx.onerror = () => { signal?.removeEventListener('abort', abort); reject(failure ?? tx.error); };
    if (signal?.aborted) abort();
  }); } finally { db.close(); }
}
