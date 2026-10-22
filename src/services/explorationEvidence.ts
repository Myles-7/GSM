import type { ExplorationEvidence } from '../features/repositories/exploration/types';

export const EXPLORATION_DOCUMENT_CACHE_CHARS = 128_000;
const REQUEST_DOCUMENT_CHARS = 8_000;
const PASSAGE_CHARS = 2_000;

/** Bounded literal passages: citations must never span concatenated documents. */
export function explorationDocumentPassages(sources: ExplorationEvidence[], query: string): ExplorationEvidence[] {
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_.-]*/gu) ?? [])].slice(0, 12);
  const ranked = sources.map(source => ({ source, match: terms.some(term => source.text.toLowerCase().includes(term)) }))
    .sort((a, b) => Number(b.match) - Number(a.match));
  const result: ExplorationEvidence[] = [];
  let remaining = REQUEST_DOCUMENT_CHARS;
  for (const { source } of ranked) {
    if (!remaining) break;
    if (source.text.length <= Math.min(PASSAGE_CHARS, remaining)) {
      result.push(source); remaining -= source.text.length; continue;
    }
    const lower = source.text.toLowerCase();
    const starts: number[] = [];
    for (const term of terms) {
      let offset = 0, matches = 0;
      while (matches++ < 3 && (offset = lower.indexOf(term, offset)) >= 0) {
        const start = Math.max(0, offset - 500);
        if (!starts.some(previous => Math.abs(previous - start) < PASSAGE_CHARS / 2)) starts.push(start);
        offset += term.length;
      }
    }
    if (!starts.some(start => start < PASSAGE_CHARS / 2)) starts.push(0);
    for (const start of starts.slice(0, 4)) {
      if (!remaining) break;
      const text = source.text.slice(start, start + Math.min(PASSAGE_CHARS, remaining));
      result.push({ ...source, id: result.some(row => row.id === source.id) ? `${source.id}:passage:${start}` : source.id, text });
      remaining -= text.length;
    }
  }
  return result;
}
