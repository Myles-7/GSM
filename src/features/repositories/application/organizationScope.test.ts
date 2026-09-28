import { describe, expect, it } from 'vitest';
import type { Repository } from '../../../types';
import { organizationScopeRepositories as select } from './organizationScope';

const repositories = [
  { id: 1, category_id: null },
  { id: 2, category_id: 'tools', subcategory_id: null },
  { id: 3, category_id: 'tools', subcategory_id: 'cli' },
  { id: 4, category_id: 'learning', subcategory_id: null },
] as Repository[];
const input = { repositories, selectedIds: [], categoryId: 'all', scope: 'default' as const };
describe('organization scope', () => {
  it('defaults to pending globally, ungrouped in a category, and explicit selection first', () => {
    expect(select(input).map(r => r.id)).toEqual([1]);
    expect(select({ ...input, categoryId: 'tools' }).map(r => r.id)).toEqual([2]);
    expect(select({ ...input, selectedIds: [3] }).map(r => r.id)).toEqual([3]);
  });
  it('never expands selection beyond active filters', () => {
    expect(select({ ...input, repositories: [repositories[1]], selectedIds: [1, 2, 3] }).map(r => r.id)).toEqual([2]);
    expect(select({ ...input, repositories: [repositories[1]], scope: 'all' }).map(r => r.id)).toEqual([2]);
  });
  it('supports an entire named category without including other categories', () => {
    expect(select({ ...input, scope: 'current', categoryId: 'tools' }).map(r => r.id)).toEqual([2, 3]);
    expect(select({ ...input, scope: 'current' })).toEqual([]);
  });
  it('deduplicates identities and retains source order', () => {
    expect(select({ ...input, repositories: [...repositories, repositories[0]], scope: 'all' }).map(r => r.id)).toEqual([1, 2, 3, 4]);
  });
});
