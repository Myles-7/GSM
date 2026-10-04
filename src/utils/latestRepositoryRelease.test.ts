import { describe, expect, it, vi } from 'vitest';
import type { Release } from '../types';
import { latestRepositoryRelease } from './latestRepositoryRelease';

const release = (id: number, repositoryId: number, date: string): Release => ({
  id, repository: { id: repositoryId, name: 'repo', full_name: 'owner/repo' },
  published_at: date, tag_name: `v${id}`, name: '', body: '', html_url: '', assets: [],
});

describe('latest release lookup', () => {
  it('selects the latest release per repository without mutating source order', () => {
    const older = release(1, 10, '2026-09-01');
    const newest = release(2, 10, '2026-10-01');
    const other = release(3, 20, '2026-10-02');
    const input = Object.freeze([older, other, newest]);
    expect(latestRepositoryRelease(input, 10)).toBe(newest);
    expect(latestRepositoryRelease(input, 20)).toBe(other);
    expect(latestRepositoryRelease(input, 99)).toBeUndefined();
    expect(input).toEqual([older, other, newest]);
  });
  it('keeps the first tie and lets valid dates supersede invalid dates', () => {
    const invalid = release(1, 10, 'unknown');
    const valid = release(2, 10, '2026-10-01');
    expect(latestRepositoryRelease([invalid, valid, release(3, 10, '2026-10-01')], 10)).toBe(valid);
    expect(latestRepositoryRelease([invalid], 10)).toBe(invalid);
    expect(latestRepositoryRelease(undefined, 10)).toBeUndefined();
  });
  it('indexes an array once for all visible cards and preserves unchanged result references', () => {
    const input = Array.from({ length: 200 }, (_, i) => release(i, i % 50, '2026-10-01'));
    const parse = vi.spyOn(Date, 'parse');
    try {
      for (let i = 0; i < 50; i++) latestRepositoryRelease(input, i);
      expect(parse).toHaveBeenCalledTimes(200);
      const before = latestRepositoryRelease(input, 1);
      const added = release(201, 2, '2026-10-03');
      const updated = [...input, added];
      expect(latestRepositoryRelease(updated, 1)).toBe(before);
      expect(latestRepositoryRelease(updated, 2)).toBe(added);
      expect(latestRepositoryRelease([], 1)).toBeUndefined();
    } finally { parse.mockRestore(); }
  });
  it('parses only requested repository dates and caches repeated lookups', () => {
    const input = [release(1, 10, '2026-10-01'), release(2, 10, '2026-10-02'),
      release(3, 20, '2026-10-01'), release(4, 20, '2026-10-02')];
    const parse = vi.spyOn(Date, 'parse');
    try {
      expect(latestRepositoryRelease(input, 10)).toBe(input[1]);
      expect(parse).toHaveBeenCalledTimes(2);
      expect(latestRepositoryRelease(input, 10)).toBe(input[1]);
      expect(latestRepositoryRelease(input, 99)).toBeUndefined();
      expect(parse).toHaveBeenCalledTimes(2);
      expect(latestRepositoryRelease(input, 20)).toBe(input[3]);
      expect(parse).toHaveBeenCalledTimes(4);
    } finally { parse.mockRestore(); }
  });
});
