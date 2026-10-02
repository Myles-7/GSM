import { beforeEach, describe, expect, it } from 'vitest';
import { batchStarHistoryKey, normalizeBatchStarHistory, readBatchStarHistory, writeBatchStarHistory } from './batchStarHistoryStorage';

describe('batch Star history storage', () => {
  beforeEach(() => localStorage.clear());
  it('keeps exactly ten newest unique entries without trimming or normalizing their text', () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({ text: `  repo${index}\n中文  `, generatedAt: index + 1 }));
    const normalized = normalizeBatchStarHistory([...entries, { ...entries[11], generatedAt: 99 }]);
    expect(normalized).toHaveLength(10);
    expect(normalized[0]).toEqual({ text: entries[11].text, generatedAt: 99 });
    expect(normalized[9].text).toBe(entries[2].text);
    expect(normalizeBatchStarHistory([{ text: 'a', generatedAt: 1 }, { text: ' a ', generatedAt: 2 }])).toHaveLength(2);
  });
  it('rejects malformed entries and dates but retains exact CRLF input', () => {
    expect(normalizeBatchStarHistory([
      null, {}, { text: '  ', generatedAt: 1 }, { text: 'bad', generatedAt: 1e100 },
      { text: 'bad', generatedAt: NaN }, { text: ' \r\nrepo\r\n ', generatedAt: 1 },
    ])).toEqual([{ text: ' \r\nrepo\r\n ', generatedAt: 1 }]);
    expect(normalizeBatchStarHistory({})).toEqual([]);
  });
  it('isolates accounts and round-trips original text', () => {
    writeBatchStarHistory('1', [{ text: ' \r\n中文 repo ', generatedAt: 1 }]);
    writeBatchStarHistory('2', [{ text: 'other', generatedAt: 2 }]);
    expect(readBatchStarHistory('1')[0].text).toBe(' \r\n中文 repo ');
    expect(readBatchStarHistory('2')[0].text).toBe('other');
    expect(readBatchStarHistory('3')).toEqual([]);
  });
  it('surfaces corrupt JSON so the hook can show a recoverable storage warning', () => {
    localStorage.setItem(batchStarHistoryKey('1'), '{broken');
    expect(() => readBatchStarHistory('1')).toThrow();
  });
});
