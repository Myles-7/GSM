import type { ToolEvidence } from '../types/repositoryChat';

export type EvidenceFreshness = 'current' | 'changed' | 'unknown' | 'rebind';
export interface FreshnessReader {
  head(repository: string, signal: AbortSignal): Promise<string>;
  local?(path: string, signal: AbortSignal): Promise<string>;
}

/** Version checks are independent of the evidence snapshot: never rewrite old facts. */
export async function checkEvidenceFreshness(evidence: ToolEvidence[], reader: FreshnessReader,
  signal: AbortSignal, update: (id: string, status: EvidenceFreshness) => void): Promise<void> {
  const heads = new Map<string, Promise<string>>();
  const hashes = new Map<string, Promise<string>>();
  for (const item of evidence) {
    signal.throwIfAborted();
    let status: EvidenceFreshness = 'unknown';
    try {
      if (item.source === 'local') {
        if (!reader.local) status = 'rebind';
        else if (item.path && item.contentHash) {
          if (!hashes.has(item.path)) hashes.set(item.path, reader.local(item.path, signal));
          status = await hashes.get(item.path) === item.contentHash ? 'current' : 'changed';
        }
      } else if (item.source === 'github' && item.path && item.refSha && !item.url.includes('@meta/')) {
        if (!heads.has(item.repoFullName)) heads.set(item.repoFullName, reader.head(item.repoFullName, signal));
        status = await heads.get(item.repoFullName) === item.refSha ? 'current' : 'changed';
      }
    } catch { signal.throwIfAborted(); }
    signal.throwIfAborted();
    update(item.id, status);
  }
}
