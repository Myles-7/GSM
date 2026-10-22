import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { CategorySidebar } from './CategorySidebar';
import { createInitialState } from '../store/initialState';
import { createCategorySlice } from '../store/slices/categorySlice';
import { createClassificationSlice } from '../store/slices/classificationSlice';
import type { AppStoreState } from '../store/types';
import { useRepositoryDragStore } from '../store/useRepositoryDragStore';
import type { Repository } from '../types';

const categories = [{ id: 'all', name: '全部分类', icon: '📁', keywords: [] }, { id: 'cat-b', name: '分类B', icon: '📦', keywords: [], isCustom: true }, { id: 'cat-c', name: '分类C', icon: '🧪', keywords: [], isCustom: true }];
const mocks = vi.hoisted(() => ({ state: {} as AppStoreState, sync: vi.fn(), toast: vi.fn(), confirm: vi.fn() }));
vi.mock('../store/useAppStore', () => ({
  useAppStore: Object.assign((selector: (state: AppStoreState) => unknown) => selector(mocks.state), { getState: () => mocks.state }),
  getAllCategories: () => categories,
  sortCategoriesByOrder: (values: unknown) => values,
}));
vi.mock('../hooks/useDialog', () => ({ useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }) }));
vi.mock('../features/repositories/hooks/useCategorySyncActions', () => ({ useCategorySyncActions: () => ({ forceSyncToBackend: mocks.sync }) }));
vi.mock('../features/repositories/hooks/syncClassificationEdit', () => ({ syncClassificationEdit: mocks.sync }));
vi.mock('./CategoryEditModal', () => ({ CategoryEditModal: () => null }));
vi.mock('./ClassificationSchemeSwitch', () => ({ ClassificationSchemeSwitch: () => null }));
vi.mock('../features/settings/hooks/useLocalVectorPendingCount', () => ({ useLocalVectorPendingCount: () => 0 }));

const categorizedRepo = { id: 1, name: 'example-repository', full_name: 'owner/example-repository', custom_category: '分类B', category_locked: true, category_id: 'cat-b', subcategory_id: null, category_candidates: ['cat-b', 'cat-c'] } as Repository;
let store: StoreApi<AppStoreState>;
const renderSidebar = (repositories: Repository[]) => {
  store.setState({ repositories });
  return render(<CategorySidebar repositories={repositories} selectedCategory="cat-b" onCategorySelect={vi.fn()} />);
};
const dropOnCategory = async (categoryName: string, repoId: string) => {
  const dataTransfer = { types: ['application/x-gsm-repository-id'], getData: (type: string) => type === 'application/x-gsm-repository-id' ? repoId : '' };
  await act(async () => { fireEvent.drop(screen.getByText(categoryName), { dataTransfer }); });
};
beforeEach(() => {
  vi.clearAllMocks(); useRepositoryDragStore.getState().endDrag(); mocks.sync.mockReset().mockResolvedValue(undefined); mocks.confirm.mockResolvedValue(true);
  store = createStore<AppStoreState>((set, get) => ({ ...createInitialState(), ...createCategorySlice(set, get), ...createClassificationSlice(set, get) } as AppStoreState));
  store.setState({ user: { id: 17 } as never, language: 'zh', customCategories: categories.filter(category => category.id !== 'all'), hiddenDefaultCategoryIds: [], defaultCategoryOverrides: {}, isSidebarCollapsed: false, setSidebarCollapsed: vi.fn(), setCurrentView: vi.fn() });
  mocks.state = store.getState(); store.subscribe(state => { mocks.state = state; });
});
describe('CategorySidebar drop-to-uncategorize (issue #353 suggestion)', () => {
  it('moves a confirmed locked repository to pending, preserves suggestions, and clears its lock atomically', async () => {
    renderSidebar([categorizedRepo]); useRepositoryDragStore.getState().startDrag();
    await dropOnCategory('全部分类', '1');
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(store.getState().repositories[0]).toMatchObject({ category_id: null, subcategory_id: null, category_locked: false, category_candidates: ['cat-b', 'cat-c'] });
    expect(mocks.sync).toHaveBeenCalledOnce(); expect(useRepositoryDragStore.getState().isDragging).toBe(false);
  });
  it('does not write or sync when the repository is already pending', async () => {
    renderSidebar([{ ...categorizedRepo, category_id: null, custom_category: '', category_locked: false }]); const before = store.getState();
    await dropOnCategory('全部分类', '1');
    expect(store.getState()).toBe(before); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('keeps an unmatched pending record unchanged for later AI classification', async () => {
    renderSidebar([{ ...categorizedRepo, id: 2, category_id: null, custom_category: undefined, category_locked: false }]); const before = store.getState();
    await dropOnCategory('全部分类', '2');
    expect(store.getState()).toBe(before); expect(store.getState().repositories[0].custom_category).toBeUndefined(); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('assigns a single explicit category id after confirming a locked reassignment', async () => {
    renderSidebar([categorizedRepo]); await dropOnCategory('分类C', '1');
    expect(store.getState().repositories[0]).toMatchObject({ category_id: 'cat-c', category_locked: true }); expect(mocks.sync).toHaveBeenCalledOnce();
  });
  it('retains the committed local membership and pending sync marker when delivery fails', async () => {
    mocks.sync.mockRejectedValue(new Error('sync failed')); renderSidebar([categorizedRepo]); await dropOnCategory('全部分类', '1');
    expect(store.getState().repositories[0]).toMatchObject({ category_id: null, category_locked: false });
    expect(store.getState().classificationSchemes?.generation?.syncPending).toBe(true);
    expect(mocks.toast).toHaveBeenCalledWith('已保存在本地，同步失败后可重试。', 'error');
  });
  it('does not write or sync when the lock confirmation is cancelled', async () => {
    mocks.confirm.mockResolvedValue(false); renderSidebar([categorizedRepo]); const before = store.getState(); await dropOnCategory('分类C', '1');
    expect(store.getState()).toBe(before); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('includes a pending classification entry with the pending count', () => {
    renderSidebar([{ ...categorizedRepo, category_id: null }]); expect(screen.getByText('待分类').closest('button')).toHaveTextContent('1');
  });
});
