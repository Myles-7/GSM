import type { RepositoryChatTurnResult } from './repositoryChatService';

export interface ResearchCheckpointEntry {
  repository: string;
  version: string;
  savedAt: number;
  result: RepositoryChatTurnResult;
}
interface Checkpoint { context: string; entries: ResearchCheckpointEntry[]; }
const keyFor = (owner: string, session: string) => `gsm:research-checkpoint:${encodeURIComponent(owner)}:${encodeURIComponent(session)}`;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

/** Device-only research checkpoints. No credentials, executable paths or grants. */
export function loadResearchCheckpoint(owner: string, session: string, context: string): ResearchCheckpointEntry[] {
  try {
    const record = JSON.parse(localStorage.getItem(keyFor(owner, session)) ?? 'null') as Checkpoint | null;
    if (record?.context !== context || !Array.isArray(record.entries)) return [];
    return record.entries.filter(entry => typeof entry.repository === 'string' && typeof entry.version === 'string'
      && Number.isFinite(entry.savedAt) && Date.now() - entry.savedAt < MAX_AGE
      && typeof entry.result?.content === 'string' && Array.isArray(entry.result.evidences)
      && entry.result.evidences.every(item => typeof item.id === 'string' && typeof item.excerpt === 'string'
        && typeof item.url === 'string' && typeof item.repoFullName === 'string'));
  } catch { return []; }
}

export function saveResearchCheckpoint(owner: string, session: string, context: string, entries: ResearchCheckpointEntry[]): boolean {
  try {
    const text = JSON.stringify({ context, entries: entries.slice(-50) });
    if (text.length > 2_000_000) return false;
    localStorage.setItem(keyFor(owner, session), text);
    return true;
  } catch { return false; }
}

export function canReuseResearch(entry: ResearchCheckpointEntry | undefined, version: string): entry is ResearchCheckpointEntry {
  return !!entry && entry.version === version && entry.result.evidences.length > 0
    && entry.result.evidences.every(item => item.source === 'github' && !!item.path && item.refSha === version)
    && !entry.result.evidences.some(item => /(?:release|issue)-|@meta\//i.test(item.path ?? ''));
}
