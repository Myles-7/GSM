import { beforeEach, describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { Category, Repository } from '../../types';
import type { AppStoreState } from '../types';
import { createInitialState } from '../initialState';
import { createCategorySlice } from '../slices/categorySlice';
import { createRepositorySlice } from '../slices/repositorySlice';
import { normalizePersistedState } from '../normalizers/persistedState';
import { incomingOrganizationSnapshot, normalizeRepositoryMembership, normalizeRepositoryOrganization } from './repositoryOrganization';
import { matchesCategory } from '../../utils/categoryUtils';
import { mergeRepositoriesPreservingLocalMetadata } from '../../utils/repositoryMerge';
import { sortRepositories } from '../../utils/repoSearch';
import { applyAnalysisSuccess } from '../../features/repositories/application/repositoryPatches';
import { applyAccountWorkspace, captureAccountWorkspace } from './accountWorkspace';

const categories: Category[] = [
  { id: 'one', name: 'First', icon: 'folder', keywords: ['alpha'], isCustom: true },
  { id: 'two', name: 'Second', icon: 'folder', keywords: ['beta'], isCustom: true },
];
const repo = (patch: Partial<Repository> = {}): Repository => ({
  id: 1, name: 'sample', full_name: 'owner/sample', description: null,
  html_url: 'https://github.com/owner/sample', stargazers_count: 0, forks: 0, forks_count: 0,
  language: null, topics: [], owner: { login: 'owner', avatar_url: '' },
  created_at: '', updated_at: '', pushed_at: '', ...patch,
});
const group = { id: 'group', parentId: 'one', name: 'Group', icon: 'folder' };
const createHarness = () => createStore<AppStoreState>((set, get) => ({
  ...createInitialState(), ...createCategorySlice(set, get), ...createRepositorySlice(set, get),
  customCategories: categories,
}) as AppStoreState);

describe('repository organization migration', () => {
  it('migrates unique matches, preserves locked matches and retains ambiguous evidence', () => {
    expect(normalizeRepositoryMembership(repo({ ai_tags: ['alpha'] }), categories).category_id).toBe('one');
    const locked = normalizeRepositoryMembership(repo({ category_locked: true, custom_category: 'Second', ai_tags: ['alpha'] }), categories);
    expect(locked).toMatchObject({ category_id: 'two', category_locked: true, custom_category: 'Second' });
    const ambiguous = normalizeRepositoryMembership(repo({ ai_tags: ['alpha', 'beta'], custom_category: 'legacy' }), categories);
    expect(ambiguous).toMatchObject({ category_id: null, category_candidates: ['one', 'two'], custom_category: 'legacy' });
    expect(ambiguous.category_legacy).toMatchObject({ custom_category: 'legacy' });
    expect(normalizeRepositoryMembership(ambiguous, categories)).toEqual(ambiguous);
  });

  it('keeps invalid locked names pending without silently unlocking or discarding suggestions', () => {
    expect(normalizeRepositoryMembership(repo({ category_locked: true, custom_category: 'deleted', ai_tags: ['alpha'] }), categories))
      .toMatchObject({ category_id: null, category_locked: true, category_candidates: ['one'], category_legacy: { custom_category: 'deleted', category_locked: true } });
    expect(normalizeRepositoryMembership(repo(), categories).category_id).toBeNull();
    expect(normalizeRepositoryMembership(repo({ category_id: 'deleted', ai_tags: ['alpha'] }), categories).category_id).toBeNull();
  });

  it('does not resolve duplicate names to the first category', () => {
    const duplicates = categories.map(category => ({ ...category, name: 'Duplicate' }));
    expect(normalizeRepositoryMembership(repo({ category_locked: true, custom_category: 'Duplicate' }), duplicates).category_id).toBeNull();
  });

  it('keeps empty legacy categories pending with ambiguous suggestions and their original evidence', () => {
    const migrated = normalizeRepositoryMembership(repo({ custom_category: '', category_locked: false, ai_tags: ['alpha', 'beta'] }), categories);
    expect(migrated).toMatchObject({
      category_id: null, category_candidates: ['one', 'two'],
      category_legacy: { custom_category: '', category_locked: false },
    });
    expect(normalizeRepositoryMembership(migrated, categories)).toEqual(migrated);
  });

  it('tolerates malformed backup candidate and legacy fields', () => {
    for (const value of [null, {}, 1, 'one', [null, 'one', 'one', 'missing']]) {
      const normalized = normalizeRepositoryMembership(repo({
        category_id: null, ai_tags: ['alpha'],
        category_candidates: value as unknown as string[],
        category_legacy: 'invalid' as unknown as Repository['category_legacy'],
      }), categories);
      expect(normalized.category_candidates).toEqual(['one']);
      expect(normalized.category_legacy).toBeUndefined();
    }
  });

  it('makes ID membership authoritative over tag and name matches', () => {
    const assigned = repo({ category_id: 'one', custom_category: 'Second', ai_tags: ['beta'] });
    expect(matchesCategory(assigned, categories[0])).toBe(true);
    expect(matchesCategory(assigned, categories[1])).toBe(false);
    expect(normalizeRepositoryMembership(assigned, categories).category_id).toBe('one');
    expect(normalizeRepositoryMembership(repo({ category_id: null, ai_tags: ['alpha'] }), categories).category_id).toBeNull();
  });

  it('normalizes orphan and duplicate groups, invalid memberships and orders idempotently', () => {
    const normalized = normalizeRepositoryOrganization({
      repositories: [repo({ category_id: 'two', subcategory_id: 'group' }), repo({ id: 2, category_id: 'one', subcategory_id: 'group' })],
      subcategories: [group, group, { ...group, id: 'bad', parentId: 'missing' }],
      subcategoryOrder: ['bad', 'group', 'group'],
      repositoryOrder: [2, 2, 999],
    }, categories);
    expect(normalized.subcategories).toEqual([group]);
    expect(normalized.subcategoryOrder).toEqual(['group']);
    expect(normalized.repositoryOrder).toEqual([2, 1]);
    expect(normalized.repositories.map(item => item.subcategory_id)).toEqual([null, 'group']);
    expect(normalizeRepositoryOrganization(normalized, categories)).toEqual(normalized);
  });
});

describe('repository organization actions and snapshots', () => {
  let store: ReturnType<typeof createHarness>;
  beforeEach(() => { store = createHarness(); });

  it.each(['all', 'pending', 'devtools'])('does not create a custom category with reserved ID %s', (id) => {
    const before = store.getState();
    store.getState().addCustomCategory({ ...categories[0], id });
    expect(store.getState()).toBe(before);
  });

  it('generates group IDs and restricts moves to the assigned parent', () => {
    store.getState().setRepositories([repo({ category_id: 'one' })]);
    store.getState().addSubcategory({ parentId: 'one', name: ' New ', icon: 'folder' });
    store.getState().addSubcategory({ parentId: 'two', name: 'Other', icon: 'folder' });
    const groups = store.getState().subcategories;
    expect(groups[0].id).not.toBe(groups[1].id);
    store.getState().moveRepositoryToSubcategory(1, groups[1].id);
    expect(store.getState().repositories[0].subcategory_id).toBeNull();
    store.getState().moveRepositoryToSubcategory(1, groups[0].id);
    expect(store.getState().repositories[0].subcategory_id).toBe(groups[0].id);
    store.getState().deleteSubcategory(groups[0].id);
    expect(store.getState().repositories[0]).toMatchObject({ category_id: 'one', subcategory_id: null });
  });

  it('requires explicit approval for locked moves and preserves lock state', () => {
    store.getState().setRepositories([repo({ category_id: 'one', category_locked: true })]);
    store.getState().assignRepositoryCategory(1, 'two');
    expect(store.getState().repositories[0].category_id).toBe('one');
    const update = { ...store.getState().repositories[0], category_id: 'two', last_edited: 'new' };
    store.getState().updateRepository(update);
    expect(store.getState().repositories[0].category_id).toBe('one');
    store.getState().updateRepository(update, { overrideCategoryLock: true });
    expect(store.getState().repositories[0]).toMatchObject({ category_id: 'two', category_locked: true });
  });

  it('clears groups on parent changes and moves deleted-category members to pending', () => {
    store.setState({ subcategories: [group] });
    store.getState().setRepositories([repo({ category_id: 'one', subcategory_id: 'group' })]);
    store.getState().assignRepositoryCategory(1, 'two');
    expect(store.getState().repositories[0].subcategory_id).toBeNull();
    store.getState().deleteCustomCategory('two');
    expect(store.getState().repositories[0].category_id).toBeNull();
    store.getState().deleteCustomCategory('one');
    expect(store.getState().subcategories).toEqual([]);
  });

  it('updates compatibility projections on rename by stable ID, including search copies', () => {
    store.getState().setRepositories([repo({ category_id: 'one' })]);
    store.getState().updateCustomCategory('one', { name: 'Renamed', id: 'do-not-change' });
    expect(store.getState().repositories[0]).toMatchObject({ category_id: 'one', custom_category: 'Renamed' });
    expect(store.getState().searchResults[0]).toEqual(store.getState().repositories[0]);
  });

  it('does not move hidden default-category members', () => {
    store.getState().setRepositories([repo({ category_id: 'devtools' })]);
    store.getState().hideDefaultCategory('devtools');
    expect(store.getState().repositories[0].category_id).toBe('devtools');
  });

  it('keeps current assignments when late analysis uses a stale snapshot', () => {
    store.getState().setRepositories([repo({ category_id: 'one' })]);
    const stale = store.getState().repositories[0];
    store.getState().assignRepositoryCategory(1, 'two');
    store.getState().updateRepository(applyAnalysisSuccess(stale, {
      summary: 'new summary', tags: ['alpha'], platforms: [], category: 'First', categoryLocked: false, analyzedAt: '2026-09-28',
    }));
    expect(store.getState().repositories[0]).toMatchObject({ category_id: 'two', ai_summary: 'new summary' });
    store.getState().updateRepositoriesMetadata([{ id: 1, patch: { custom_tags: ['alpha'] } }]);
    expect(store.getState().repositories[0].category_id).toBe('two');
  });

  it('refreshes suggestions independently of stored membership on direct AI summary and tag updates', () => {
    store.getState().setRepositories([repo({ category_id: 'one', category_candidates: ['one'] })]);
    store.getState().updateRepository({ ...store.getState().repositories[0], ai_summary: 'beta' });
    expect(store.getState().repositories[0]).toMatchObject({ category_id: 'one', category_candidates: ['two'] });
    store.getState().updateRepositoriesMetadata([{ id: 1, patch: { ai_tags: ['alpha', 'beta'] } }]);
    expect(store.getState().repositories[0]).toMatchObject({ category_id: 'one', category_candidates: ['one', 'two'] });
  });

  it('uses authoritative assignments when updating stale search and similar-view copies', () => {
    const current = repo({ category_id: 'two' });
    const stale = repo({ category_id: 'one' });
    store.setState({ repositories: [current], searchResults: [stale], similarView: {
      active: true, anchorRepoFullName: current.full_name, anchorRepoName: current.name,
      similarResults: [stale], originalSearchResults: [stale], originalSearchFilters: store.getState().searchFilters,
    } });
    store.getState().updateRepositoriesMetadata([{ id: 1, patch: { ai_summary: 'alpha' } }]);
    expect(store.getState().searchResults[0].category_id).toBe('two');
    expect(store.getState().similarView?.similarResults[0].category_id).toBe('two');
    expect(store.getState().similarView?.originalSearchResults[0].category_id).toBe('two');
  });

  it('projects custom global order without changing stored rule sorting', () => {
    store.getState().setRepositories([repo(), repo({ id: 2 }), repo({ id: 3 })]);
    store.getState().reorderRepositories([3, 1, 3, 999]);
    expect(store.getState().repositoryOrder).toEqual([3, 1, 2]);
    expect(sortRepositories(store.getState().repositories.filter(item => item.id !== 1), 'custom', 'desc', store.getState().repositoryOrder).map(item => item.id)).toEqual([3, 2]);
    const persisted = normalizePersistedState({ searchFilters: { sortBy: 'name', sortOrder: 'asc' } }, store.getState());
    expect(persisted.searchFilters?.sortBy).toBe('name');
    expect(createInitialState().searchFilters.sortBy).toBe('custom');
  });

  it.each([undefined, { sortBy: 'stars' as const, sortOrder: 'desc' as const }])(
    'seeds missing persisted order from migration-time descending stars (%s)', (searchFilters) => {
      const repositories = [repo({ id: 2, stargazers_count: 5 }), repo({ id: 1, stargazers_count: 100 })];
      const normalized = normalizePersistedState({ repositories, searchFilters }, store.getState());
      expect(normalized.repositoryOrder).toEqual([1, 2]);
      expect(normalized.repositories?.map(item => item.id)).toEqual([2, 1]);
      expect(normalized.searchFilters).toMatchObject({ sortBy: 'stars', sortOrder: 'desc' });
    },
  );

  it('retains existing persisted order even when the saved sort projects differently', () => {
    const normalized = normalizePersistedState({
      repositories: [repo({ id: 2, stargazers_count: 5 }), repo({ id: 1, stargazers_count: 100 })],
      repositoryOrder: [2, 1],
      searchFilters: { sortBy: 'stars', sortOrder: 'desc' },
    }, store.getState());
    expect(normalized.repositoryOrder).toEqual([2, 1]);
    expect(normalized.searchFilters).toMatchObject({ sortBy: 'stars', sortOrder: 'desc' });
  });

  it('seeds from a saved ascending sort and leaves new-user received order natural', () => {
    const repositories = [repo({ id: 2, name: 'Zulu' }), repo({ id: 1, name: 'Alpha' })];
    const normalized = normalizePersistedState({
      repositories, searchFilters: { sortBy: 'name', sortOrder: 'asc' },
    }, store.getState());
    expect(normalized.repositoryOrder).toEqual([1, 2]);
    expect(normalized.searchFilters).toMatchObject({ sortBy: 'name', sortOrder: 'asc' });
    store.getState().setRepositories(repositories);
    expect(store.getState().repositoryOrder).toEqual([2, 1]);
    expect(store.getState().searchFilters.sortBy).toBe('custom');
  });

  it('restores repositories and replacement category/group definitions atomically', () => {
    store.getState().setRepositories([repo({ category_id: 'one', category_locked: true })]);
    let notifications = 0;
    store.subscribe(() => { notifications++; });
    const backupRepo = repo({ category_id: 'restored', subcategory_id: 'restored-group', category_locked: true });
    store.setState(state => incomingOrganizationSnapshot(state, {
      customCategories: [{ ...categories[0], id: 'restored' }],
      subcategories: [{ ...group, id: 'restored-group', parentId: 'restored' }],
      repositoryOrder: [1],
    }, [backupRepo]));
    expect(notifications).toBe(1);
    expect(store.getState().repositories[0]).toMatchObject(backupRepo);
    expect(store.getState().searchResults).toBe(store.getState().repositories);
  });

  it('preserves assignments and details when old backends omit fields', () => {
    const details = { summary: 'kept' } as unknown as Repository['ai_details'];
    const local = repo({ category_id: 'one', subcategory_id: 'group', ai_details: details });
    store.setState({ subcategories: [group], repositories: [local] });
    const merged = mergeRepositoriesPreservingLocalMetadata([repo()], [local]);
    expect(merged[0]).toMatchObject({ category_id: 'one', subcategory_id: 'group', ai_details: details });
    store.setState(state => incomingOrganizationSnapshot(state, {}, [repo()]));
    expect(store.getState().repositories[0]).toMatchObject({ category_id: 'one', subcategory_id: 'group', ai_details: details });
    const restored = applyAccountWorkspace(captureAccountWorkspace(store.getState()));
    expect(restored.subcategories).toEqual([group]);
    expect(restored.repositories[0].subcategory_id).toBe('group');
  });

  it.each([undefined, false])('preserves lock ownership when a legacy snapshot omits category_id (incoming lock %s)', (category_locked) => {
    store.setState({ repositories: [repo({ category_id: 'one', category_locked: true })] });
    store.setState(state => incomingOrganizationSnapshot(state, {}, [repo({ category_locked })]));
    expect(store.getState().repositories[0]).toMatchObject({ category_id: 'one', category_locked: true });
    store.setState(state => incomingOrganizationSnapshot(state, {}, [repo({ category_id: 'one', category_locked: false })]));
    expect(store.getState().repositories[0].category_locked).toBe(false);
  });

  it.each([
    { customCategories: [categories[0], { ...categories[1], id: 'one' }] },
    { customCategories: [{ ...categories[0], id: 'devtools' }] },
    { customCategories: [{ ...categories[0], id: 'pending' }] },
    { customCategories: [{ ...categories[0], id: 'all' }] },
  ])('rejects ambiguous imported category IDs without any store write', ({ customCategories }) => {
    const before = store.getState();
    let notifications = 0;
    store.subscribe(() => { notifications++; });
    expect(() => store.setState(state => incomingOrganizationSnapshot(state, {
      customCategories, repositoryOrder: [99], subcategories: [group],
    }, [repo({ id: 99 })]))).toThrow('ambiguous custom category IDs');
    expect(store.getState()).toBe(before);
    expect(notifications).toBe(0);
  });

  it.each(['one', 'devtools', 'pending', 'all'])('hydrates colliding category %s as pending, retaining original evidence and lock', (id) => {
    const customCategories = id === 'one' ? [categories[0], { ...categories[1], id }] : [{ ...categories[0], id }];
    const original = repo({ category_id: id, subcategory_id: 'group', custom_category: 'Original', category_locked: true });
    const hydrated = normalizePersistedState({ customCategories, repositories: [original], subcategories: [{ ...group, parentId: id }] }, store.getState());
    expect(hydrated.customCategories).toEqual([]);
    expect(hydrated.repositories?.[0]).toMatchObject({
      category_id: null, subcategory_id: null, category_locked: true,
      category_legacy: { category_id: id, subcategory_id: 'group', custom_category: 'Original', category_locked: true },
    });
    expect(hydrated.subcategories).toEqual(id === 'devtools' ? [{ ...group, parentId: id }] : []);
    const rehydrated = normalizePersistedState({
      customCategories: hydrated.customCategories, repositories: hydrated.repositories, subcategories: hydrated.subcategories,
    }, store.getState());
    expect(rehydrated.repositories).toEqual(hydrated.repositories);
  });

  it('restores category and group atomically through the verified undo option', () => {
    store.setState({ subcategories: [group], repositories: [repo({ category_id: 'two', subcategory_id: null })] });
    const seen: Repository[] = [];
    store.subscribe(state => { seen.push(state.repositories[0]); });
    store.getState().updateRepository({ ...store.getState().repositories[0], category_id: 'one', subcategory_id: 'group' }, { restoreSubcategory: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ category_id: 'one', subcategory_id: 'group' });
  });
});
