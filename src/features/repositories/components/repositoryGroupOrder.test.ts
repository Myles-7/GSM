import { describe, expect, it } from 'vitest';
import { moveBefore, orderedIds, replaceGroupOrder } from './repositoryGroupOrder';

describe('repository group ordering', () => {
  it('prunes stale ids, deduplicates, and appends newcomers without moving existing items', () => {
    expect(orderedIds([3, 1, 99, 3], [1, 2, 3, 4])).toEqual([3, 1, 2, 4]);
  });
  it('reorders only the group slots without changing other categories', () => {
    expect(replaceGroupOrder([1, 90, 2, 91, 3], moveBefore([1, 2, 3], 3, 1))).toEqual([3, 90, 1, 91, 2]);
  });
  it('ignores invalid and self moves without mutating input', () => {
    const source = [1, 2, 3];
    expect(moveBefore(source, 1, 1)).toEqual(source);
    expect(moveBefore(source, 4, 1)).toEqual(source);
    expect(moveBefore(source, 1, 4)).toEqual(source);
    expect(source).toEqual([1, 2, 3]);
  });
});
