import { describe, expect, it } from 'vitest';
import type { Repository } from '../types';
import { classificationChangeStats } from './classificationStats';
describe('classification change summary', () => {
  it('summarizes subdivisions without retaining previous repositories', () => {
    const before = Array.from({ length: 60 }, (_, id) => ({ id, category_id: 'ai', subcategory_id: 'agents', classifications: { technology: { categoryId: 'tech', subcategoryId: 'mcp', locked: false } } } as Repository));
    const after = before.map((repo, index) => ({ ...repo, subcategory_id: index < 20 ? 'coding' : index < 40 ? 'browser' : 'multi' }));
    expect(classificationChangeStats(before, after, 'purpose')).toEqual({ beforeGroups: 1, afterGroups: 3, beforeOversized: 1, afterOversized: 0, changedMemberships: 60 });
    expect(classificationChangeStats(before, after, 'technology')).toEqual({ beforeGroups: 1, afterGroups: 1, beforeOversized: 1, afterOversized: 1, changedMemberships: 0 });
  });
});
