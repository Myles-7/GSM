export interface BatchStarHistoryEntry {
  text: string;
  generatedAt: number;
}

export const batchStarHistoryKey = (accountId: string) =>
  `github-stars-manager-batch-star-history-v1:${accountId}`;

/** Whitespace and Unicode are part of the original input's identity. */
export function normalizeBatchStarHistory(value: unknown): BatchStarHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((entry): entry is BatchStarHistoryEntry =>
    Boolean(entry && typeof entry.text === 'string' && entry.text.trim()
      && typeof entry.generatedAt === 'number' && Number.isFinite(entry.generatedAt)
      && !Number.isNaN(new Date(entry.generatedAt).getTime()))
  ).sort((a, b) => b.generatedAt - a.generatedAt).filter(entry => {
    if (seen.has(entry.text)) return false;
    seen.add(entry.text);
    return true;
  }).slice(0, 10).map(({ text, generatedAt }) => ({ text, generatedAt }));
}

export function readBatchStarHistory(accountId: string): BatchStarHistoryEntry[] {
  const raw = localStorage.getItem(batchStarHistoryKey(accountId));
  return normalizeBatchStarHistory(raw ? JSON.parse(raw) : []);
}

export function writeBatchStarHistory(accountId: string, entries: BatchStarHistoryEntry[]): void {
  localStorage.setItem(batchStarHistoryKey(accountId), JSON.stringify(normalizeBatchStarHistory(entries)));
}
