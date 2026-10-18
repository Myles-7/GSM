import { beforeEach, describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createCategorySlice } from '../slices/categorySlice';
import { createClassificationSlice } from '../slices/classificationSlice';
import type { AppStoreState } from '../types';
import { createInitialState } from '../initialState';
import { classificationMembership, classificationProjection, normalizeClassificationSchemes } from './classificationSchemes';
import { incomingOrganizationSnapshot } from './repositoryOrganization';
import type { Repository } from '../../types';
const repo = { id: 1, name: 'tool', full_name: 'fixture/tool', category_id: 'personal', subcategory_id: 'group', category_locked: true, custom_description: 'personal' } as Repository;
const useAppStore = createStore<AppStoreState>((set, get) => ({ ...createInitialState(), ...createCategorySlice(set, get), ...createClassificationSlice(set, get) } as AppStoreState));
describe('independent classification schemes', () => {
  beforeEach(() => useAppStore.setState({ ...createInitialState(), user: { id: 999 } as never, repositories: [repo], searchResults: [repo], customCategories: [{ id: 'personal', name: 'Personal', icon: 'folder', keywords: [], isCustom: true }], subcategories: [{ id: 'group', parentId: 'personal', name: 'Group', icon: 'folder' }] }));
  it('migrates without touching memberships, locks or initializing technology', () => {
    const state = useAppStore.getState();
    const normalized = normalizeClassificationSchemes(state);
    expect(normalized.classificationSchemes.purpose?.customCategories).toEqual(state.customCategories);
    expect(normalized.classificationSchemes.technology?.initialized).toBe(false);
    expect(normalizeClassificationSchemes({ ...state, ...normalized })).toEqual(normalized);
    expect(classificationMembership(state.repositories[0], 'technology').categoryId).toBeNull();
  });
  it('writes technology and its order without changing purpose, metadata or locks', () => {
    const state = useAppStore.getState();
    state.mutateClassification('technology', { action: 'addCustomCategory', args: [{ id: 'tech', name: 'Programming', icon: 'folder', keywords: [], isCustom: true }] });
    state.mutateClassification('technology', { action: 'assignRepositoryCategory', args: [1, 'tech'] });
    const current = useAppStore.getState();
    expect(current.repositories[0].category_id).toBe('personal');
    expect(current.repositories[0].category_locked).toBe(true);
    expect(current.repositories[0].custom_description).toBe('personal');
    expect(classificationProjection(current, 'technology').repositories[0].category_id).toBe('tech');
    expect(current.customCategories).toEqual(state.customCategories);
  });
  it('old imports and metadata updates preserve technology', () => {
    useAppStore.getState().mutateClassification('technology', { action: 'addCustomCategory', args: [{ id: 'tech', name: 'Programming', icon: 'folder', keywords: [], isCustom: true }] });
    useAppStore.getState().mutateClassification('technology', { action: 'assignRepositoryCategory', args: [1, 'tech'] });
    const current = useAppStore.getState();
    const patch = incomingOrganizationSnapshot(current, {}, [repo]);
    expect(patch.repositories?.[0].classifications?.technology?.categoryId).toBe('tech');
    expect({ ...current, ...patch }.classificationSchemes?.technology).toEqual(current.classificationSchemes?.technology);
  });
  it('AI transactions enforce scheme locks and account without changing purpose', () => {
    const state = useAppStore.getState();
    expect(() => state.applyAIOrganization({ schemeId: 'technology', ownerId: 'other', categories: [], assignments: [] })).toThrow('Account');
    state.applyAIOrganization({ schemeId: 'technology', ownerId: '999', categories: [{ id: 'tech', name: 'Tech', parentId: null, icon: 'folder', isNew: true }], assignments: [{ repositoryId: 1, before: { categoryId: null, subcategoryId: null, locked: false }, after: { categoryId: 'tech', subcategoryId: null, locked: false }, overrideLocked: false }] });
    expect(useAppStore.getState().repositories[0].category_id).toBe('personal');
    expect(classificationMembership(useAppStore.getState().repositories[0], 'technology').categoryId).toBe('tech');
  });
  it('remembers navigation and group collapse independently through edits and view switching', () => {
    const state = useAppStore.getState();
    state.setClassificationCollapsedGroups('purpose', ['group']);
    state.setClassificationCollapsedGroups('technology', ['tech-group']);
    state.setClassificationExpanded('technology', ['tech']);
    state.setClassificationLocation('technology', 'pending');
    state.mutateClassification('technology', { action: 'addCustomCategory', args: [{ id: 'tech', name: 'Tech', icon: 'folder', keywords: [] }] });
    expect(useAppStore.getState().classificationNavigation).toEqual({
      purpose: { selected: 'all', expanded: [], collapsedGroups: ['group'] },
      technology: { selected: 'pending', expanded: ['tech'], collapsedGroups: ['tech-group'] },
    });
  });
});
