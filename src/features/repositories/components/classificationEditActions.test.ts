import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AppStoreState } from '../../../store/types';
import { createInitialState } from '../../../store/initialState';
import { createClassificationSlice } from '../../../store/slices/classificationSlice';
import { createCategorySlice } from '../../../store/slices/categorySlice';
import type { Repository } from '../../../types';
import { assignClassificationRepositories, captureClassificationEdit, performClassificationEdit, repositoryIdsFromDrop } from './classificationEditActions';
const mocks = vi.hoisted(() => ({ state: {} as AppStoreState, sync: vi.fn() }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => mocks.state } }));
vi.mock('../hooks/syncClassificationEdit', () => ({ syncClassificationEdit: mocks.sync }));
const dialogs = { confirm: vi.fn(), toast: vi.fn() };
let store: StoreApi<AppStoreState>;
beforeEach(() => {
  vi.clearAllMocks();
  store = createStore<AppStoreState>((set, get) => ({ ...createInitialState(), ...createCategorySlice(set, get), ...createClassificationSlice(set, get) } as AppStoreState));
  store.setState({ user: { id: 9 } as never, customCategories: [{ id: 'a', name: 'A', icon: '📁', keywords: [] }, { id: 'b', name: 'B', icon: '📁', keywords: [] }], subcategories: [{ id: 'g', parentId: 'b', name: 'Child', icon: '📁' }], repositories: [1, 2].map(id => ({ id, category_id: 'a', subcategory_id: null, category_locked: id === 1 } as Repository)) });
  mocks.state = store.getState(); store.subscribe(state => { mocks.state = state; });
  mocks.sync.mockResolvedValue(undefined); dialogs.confirm.mockResolvedValue(true);
});
describe('classification edit consent and delivery', () => {
  it('confirms exact multi target path and lock count, and keeps locks', async () => {
    await assignClassificationRepositories([1, 2], { categoryId: 'b', subcategoryId: 'g' }, dialogs);
    expect(dialogs.confirm.mock.calls[0][1]).toContain('B / Child');
    expect(dialogs.confirm.mock.calls[0][1]).toContain('Locked memberships: 1');
    expect(dialogs.confirm.mock.calls[0][1]).toContain('Affected: 2');
    expect(mocks.state.repositories.every(repo => repo.subcategory_id === 'g')).toBe(true);
    expect(mocks.state.repositories[0].category_locked).toBe(true);
  });
  it('cancellation leaves the entire selection and structure untouched', async () => {
    const before = mocks.state; dialogs.confirm.mockResolvedValue(false);
    expect(await assignClassificationRepositories([1, 2], { categoryId: 'b', subcategoryId: 'g' }, dialogs)).toBe(false);
    expect(mocks.state).toBe(before); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it.each(['membership', 'lock', 'account'] as const)('rejects a stale %s changed during confirmation', async change => {
    const captured = captureClassificationEdit();
    dialogs.confirm.mockImplementation(async () => {
      if (change === 'account') store.setState({ user: { id: 100 } as never });
      else store.setState({ repositories: mocks.state.repositories.map(repo => repo.id === 1 ? { ...repo, ...(change === 'membership' ? { category_id: 'b' } : { category_locked: false }) } : repo) });
      return true;
    });
    await expect(assignClassificationRepositories([1, 2], { categoryId: 'b', subcategoryId: 'g' }, dialogs, captured)).rejects.toThrow('changed');
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('keeps a committed local edit after sync failure', async () => {
    mocks.sync.mockRejectedValue(new Error('offline'));
    expect(await performClassificationEdit({ type: 'rename', id: 'g', name: 'Renamed' }, dialogs)).toBe(true);
    expect(mocks.state.subcategories[0].name).toBe('Renamed');
    expect(dialogs.toast).toHaveBeenCalledWith(expect.stringContaining('Saved locally'), 'error');
  });
  it('accepts multi drag and rejects invalid IDs without falling back to a partial assignment', () => {
    const data = (multi: string, single = '1') => ({ getData: (key: string) => key === 'application/x-gsm-repository-ids' ? multi : single } as DataTransfer);
    expect(repositoryIdsFromDrop(data('[1,2,1]'))).toEqual([1, 2]);
    expect(repositoryIdsFromDrop(data(''))).toEqual([1]);
    expect(repositoryIdsFromDrop(data('[1,"2"]'))).toEqual([]);
  });
});
