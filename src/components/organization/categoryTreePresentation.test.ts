import { describe, expect, it } from 'vitest';
import type { OrganizationSchemeDraft } from '../../types/aiOrganization';
import { categorySubgroupLabel } from './categoryTreePresentation';

describe('pending merge subgroup labels', () => {
  it('distinguishes same-name identities using original parent names without modifying data', () => {
    const categories = [
      { id: 'ga', name: 'General', icon: 'folder', parentId: 'target', isNew: false },
      { id: 'gb', name: 'General', icon: 'folder', parentId: 'target', isNew: false },
    ];
    const scheme = { categories, structureOperations: [{ kind: 'merge', status: 'pending', targetId: 'target', categoriesBefore: [
      { id: 'a', name: 'Writing', parentId: null }, { id: 'b', name: 'Chat', parentId: null },
      { ...categories[0], parentId: 'a' }, { ...categories[1], parentId: 'b' },
    ] }] } as OrganizationSchemeDraft;
    expect(categorySubgroupLabel(categories[0], scheme)).toBe('General (Writing)');
    expect(categorySubgroupLabel(categories[1], scheme)).toBe('General (Chat)');
    expect(categories.map(cat => cat.name)).toEqual(['General', 'General']);
  });
});
