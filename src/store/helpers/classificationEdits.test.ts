import { describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { AppStoreState } from '../types';
import { createInitialState } from '../initialState';
import { createClassificationSlice } from '../slices/classificationSlice';
import { createCategorySlice } from '../slices/categorySlice';
import { classificationProjection } from './classificationSchemes';
import { classificationEditToken, type ClassificationEditOperation } from './classificationEdits';
import type { ClassificationSchemeId } from '../../types/classification';
import type { Repository } from '../../types';

function fixture(schemeId: ClassificationSchemeId) {
  const categories = ['a', 'b'].map(id => ({ id, name: id.toUpperCase(), icon: '📁', keywords: [], isCustom: true }));
  const groups = [{ id: 's', parentId: 'a', name: 'Source', icon: '📁' }, { id: 't', parentId: 'b', name: 'Target', icon: '📁' }];
  const store = createStore<AppStoreState>((set, get) => ({ ...createInitialState(), ...createCategorySlice(set, get), ...createClassificationSlice(set, get) } as AppStoreState));
  const repositories = [1, 2].map(id => ({ id, name: `${id}`, full_name: `fixture/${id}`, custom_description: 'keep', category_id: 'a', subcategory_id: 's', category_locked: id === 1,
    classifications: { technology: { categoryId: 'a', subcategoryId: 's', locked: id === 1 } },
    classificationInsights: { purpose: { confidence: 'high', evidence: ['purpose'], facets: [] }, technology: { confidence: 'high', evidence: ['technology'], facets: [] } },
  } as unknown as Repository));
  store.setState({ user: { id: 5 } as never, repositories, searchResults: repositories, customCategories: categories, subcategories: groups, subcategoryOrder: ['s', 't'],
    selectedCategory: 's', classificationNavigation: { purpose: { selected: 's', expanded: ['a'] }, technology: { selected: 's', expanded: ['a'] } },
    classificationSchemes: { technology: { initialized: true, customCategories: categories, subcategories: groups, subcategoryOrder: ['s', 't'], categoryOrder: ['a', 'b'], repositoryOrder: [1, 2], hiddenDefaultCategoryIds: [], defaultCategoryOverrides: {}, categoryListIdMap: {} } } });
  const execute = (operation: ClassificationEditOperation, overrideLocks = false) => store.getState().applyClassificationEdit(schemeId, { ...operation, expectedAccountId: 5, expectedToken: classificationEditToken(store.getState(), schemeId), overrideLocks });
  const view = () => classificationProjection(store.getState(), schemeId);
  return { store, execute, view };
}

describe.each(['purpose', 'technology'] as const)('%s atomic classification edits', schemeId => {
  it('creates trimmed unique names, validates parent, and keeps rename IDs/order', () => {
    const { execute, view } = fixture(schemeId);
    execute({ type: 'create', parentId: 'a', name: ' New ' });
    const created = view().subcategories.find(group => group.name === 'New')!;
    expect(created.icon).toBe('📁');
    const order = view().subcategoryOrder;
    execute({ type: 'rename', id: created.id, name: ' Renamed ', icon: '✨' });
    expect(view().subcategories.find(group => group.id === created.id)).toMatchObject({ name: 'Renamed', icon: '✨' });
    expect(view().subcategoryOrder).toEqual(order);
    expect(() => execute({ type: 'create', parentId: 'a', name: '  SOURCE ' })).toThrow('already exists');
    expect(() => execute({ type: 'rename', id: created.id, name: ' source ' })).toThrow('already exists');
    expect(() => execute({ type: 'create', parentId: 'all', name: 'bad' })).toThrow('Invalid parent');
    expect(() => execute({ type: 'rename', id: created.id, name: ' ' })).toThrow('required');
    expect(() => execute({ type: 'create', parentId: 'a', name: 'x'.repeat(121) })).toThrow('120');
    expect(() => execute({ type: 'rename', id: created.id, name: 'Valid', icon: 'x'.repeat(101) })).toThrow('100');
  });
  it('deletes only the subgroup, leaves parent membership and selects parent', () => {
    const { execute, view } = fixture(schemeId);
    expect(() => execute({ type: 'delete', id: 's' })).toThrow('confirmation');
    expect(view().subcategories).toHaveLength(2);
    execute({ type: 'delete', id: 's' }, true);
    expect(view().subcategories.map(group => group.id)).toEqual(['t']);
    expect(view().repositories.every(repo => repo.category_id === 'a' && repo.subcategory_id === null)).toBe(true);
    expect(view().selectedCategory).toBe('a');
  });
  it('merges cross-parent groups and keeps destination ID, name, position', () => {
    const { execute, view, store } = fixture(schemeId);
    const other = schemeId === 'purpose' ? 'technology' : 'purpose';
    const otherBefore = classificationProjection(store.getState(), other).repositories.map(repo => [repo.category_id, repo.subcategory_id, repo.category_locked]);
    execute({ type: 'merge', id: 's', targetId: 't' }, true);
    expect(view().subcategories).toEqual([{ id: 't', parentId: 'b', name: 'Target', icon: '📁' }]);
    expect(view().subcategoryOrder).toEqual(['t']);
    expect(view().selectedCategory).toBe('t');
    expect(view().repositories.every(repo => repo.category_id === 'b' && repo.subcategory_id === 't')).toBe(true);
    expect(classificationProjection(store.getState(), other).repositories.map(repo => [repo.category_id, repo.subcategory_id, repo.category_locked])).toEqual(otherBefore);
    expect(store.getState().repositories[0].custom_description).toBe('keep');
    expect(store.getState().repositories[0].classificationInsights?.[schemeId]).toBeUndefined();
    expect(store.getState().repositories[0].classificationInsights?.[other]?.evidence).toEqual([other]);
  });
  it('moves a group and all members, appends its ID and rejects name conflict', () => {
    const { execute, view } = fixture(schemeId);
    execute({ type: 'move', id: 's', parentId: 'b' }, true);
    expect(view().subcategories.find(group => group.id === 's')?.parentId).toBe('b');
    expect(view().subcategoryOrder).toEqual(['t', 's']);
    expect(view().repositories.every(repo => repo.category_id === 'b' && repo.subcategory_id === 's')).toBe(true);
    execute({ type: 'rename', id: 's', name: 'Shared' });
    execute({ type: 'create', parentId: 'a', name: ' shared ' });
    expect(() => execute({ type: 'move', id: 's', parentId: 'a' }, true)).toThrow('explicitly merge');
  });
  it('assigns a batch atomically, rejects unknown IDs/invalid targets and locked changes', () => {
    const { execute, view, store } = fixture(schemeId);
    const before = store.getState();
    expect(() => execute({ type: 'assign', repositoryIds: [2, 99], categoryId: 'b', subcategoryId: 't' })).toThrow('selection');
    expect(store.getState()).toBe(before);
    expect(() => execute({ type: 'assign', repositoryIds: [2], categoryId: 'a', subcategoryId: 't' })).toThrow('target');
    expect(() => execute({ type: 'assign', repositoryIds: [2, 1], categoryId: 'b', subcategoryId: 't' })).toThrow('confirmation');
    expect(store.getState()).toBe(before);
    execute({ type: 'assign', repositoryIds: [1, 2], categoryId: 'b', subcategoryId: 't' }, true);
    expect(view().repositories.every(repo => repo.subcategory_id === 't')).toBe(true);
    expect(view().repositories[0].category_locked).toBe(true);
  });
  it('aborts stale source, membership, lock or account changes while consent is open', () => {
    const { store, execute } = fixture(schemeId);
    const token = classificationEditToken(store.getState(), schemeId);
    const command = { type: 'delete' as const, id: 's', expectedAccountId: 5, expectedToken: token, overrideLocks: true };
    execute({ type: 'rename', id: 's', name: 'Changed' });
    expect(() => store.getState().applyClassificationEdit(schemeId, command)).toThrow('changed');
    const currentToken = classificationEditToken(store.getState(), schemeId);
    execute({ type: 'assign', repositoryIds: [2], categoryId: 'b', subcategoryId: null });
    expect(() => store.getState().applyClassificationEdit(schemeId, { ...command, expectedToken: currentToken })).toThrow('changed');
    store.setState({ user: { id: 7 } as never });
    expect(() => store.getState().applyClassificationEdit(schemeId, command)).toThrow('Account');
  });
  it('adds manually changed repositories to the durable synchronization scope', () => {
    const { store, execute } = fixture(schemeId);
    store.setState({ classificationSchemes: { ...store.getState().classificationSchemes, generation: { status: 'ready', generation: 8, sourceFingerprint: 'keep', queuedRepositoryIds: [], repositoryIds: [1], syncPending: false } } });
    execute({ type: 'assign', repositoryIds: [2], categoryId: 'b', subcategoryId: 't' });
    expect(store.getState().classificationSchemes?.generation).toMatchObject({ repositoryIds: [1, 2], syncPending: true, sourceFingerprint: 'keep', status: 'ready', generation: 8 });
  });
  it('uncategorizes a confirmed locked repository and clears the lock in that dimension only', () => {
    const { store, execute, view } = fixture(schemeId);
    const other = schemeId === 'purpose' ? 'technology' : 'purpose';
    const otherBefore = classificationProjection(store.getState(), other).repositories[0];
    expect(() => execute({ type: 'assign', repositoryIds: [1], categoryId: null, subcategoryId: null })).toThrow('confirmation');
    execute({ type: 'assign', repositoryIds: [1], categoryId: null, subcategoryId: null }, true);
    expect(view().repositories[0]).toMatchObject({ category_id: null, subcategory_id: null, category_locked: false });
    expect(classificationProjection(store.getState(), other).repositories[0].category_locked).toBe(otherBefore.category_locked);
    expect(classificationProjection(store.getState(), other).repositories[0].category_id).toBe(otherBefore.category_id);
  });
});
