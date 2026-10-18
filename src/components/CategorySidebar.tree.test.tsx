import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CategorySidebar } from './CategorySidebar';
import { createInitialState } from '../store/initialState';
import type { AppStoreState } from '../store/types';

const mocks = vi.hoisted(() => ({ state: {} as AppStoreState, expand: vi.fn(), select: vi.fn() }));
vi.mock('../store/useAppStore', () => ({
  useAppStore: Object.assign((selector: (state: AppStoreState) => unknown) => selector(mocks.state), { getState: () => mocks.state }),
  getAllCategories: () => [
    { id: 'all', name: 'All repositories', icon: '', keywords: [] },
    { id: 'science', name: 'Scientific Research', icon: '', keywords: [], isCustom: true },
    { id: 'empty', name: 'Empty Category', icon: '', keywords: [], isCustom: true },
  ],
  sortCategoriesByOrder: (categories: unknown) => categories,
}));
vi.mock('./CategoryEditModal', () => ({ CategoryEditModal: () => null }));
vi.mock('./ClassificationSchemeSwitch', () => ({ ClassificationSchemeSwitch: () => null }));
vi.mock('../hooks/useDialog', () => ({ useDialog: () => ({ confirm: vi.fn(), toast: vi.fn() }) }));
vi.mock('../features/repositories/hooks/useCategorySyncActions', () => ({ useCategorySyncActions: () => ({ forceSyncToBackend: vi.fn() }) }));
vi.mock('../features/settings/hooks/useLocalVectorPendingCount', () => ({ useLocalVectorPendingCount: () => 0 }));
vi.mock('../services/electronProxy', () => ({ isElectron: () => false }));

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  mocks.state = { ...createInitialState(), language: 'en', subcategories: [{ id: 'numeric', parentId: 'science', name: 'Numerical Computing', icon: '' }],
    subcategoryOrder: ['numeric'], selectedCategory: 'all', setClassificationExpanded: mocks.expand } as unknown as AppStoreState;
});
const sidebar = (selected = 'all') => <CategorySidebar repositories={[]} selectedCategory={selected} onCategorySelect={mocks.select} />;

describe('direct two-level category navigation', () => {
  it.each([1440, 390])('opens children directly from a main row at %i px', width => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    const view = render(sidebar());
    expect(screen.queryByText('Numerical Computing')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Scientific Research 0' }));
    expect(mocks.select).toHaveBeenCalledWith('science');
    expect(mocks.expand).toHaveBeenCalledWith('purpose', ['science']);
    mocks.state.classificationNavigation = { purpose: { selected: 'science', expanded: ['science'] } };
    mocks.state.selectedCategory = 'science';
    view.rerender(sidebar('science'));
    expect(screen.getByText('Numerical Computing')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Numerical Computing 0' }));
    expect(mocks.select).toHaveBeenLastCalledWith('numeric');
    expect(screen.queryByText(/Categories \(/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Scientific Research 0' }));
    expect(mocks.expand).toHaveBeenLastCalledWith('purpose', []);
  });
  it('arrow toggles without selecting and empty categories have no arrow', () => {
    render(sidebar());
    fireEvent.click(screen.getByRole('button', { name: 'Expand Scientific Research' }));
    expect(mocks.expand).toHaveBeenCalledWith('purpose', ['science']);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Expand Empty Category' })).toBeNull();
  });
  it('expands the selected child parent', () => {
    mocks.state.selectedCategory = 'numeric';
    render(sidebar('numeric'));
    expect(mocks.expand).toHaveBeenCalledWith('purpose', ['science']);
  });
  it('keeps expansion changes in the active technology scheme', () => {
    mocks.state.activeClassificationScheme = 'technology';
    mocks.state.classificationNavigation = { purpose: { selected: 'all', expanded: ['tools'] }, technology: { selected: 'all', expanded: [] } };
    mocks.state.classificationSchemes = { ...mocks.state.classificationSchemes, technology: { initialized: true, customCategories: [{ id: 'science', name: 'Scientific Research', icon: '', keywords: [], isCustom: true }], hiddenDefaultCategoryIds: [], categoryOrder: [], subcategories: [{ id: 'numeric', parentId: 'science', name: 'Numeric', icon: '' }], subcategoryOrder: [], repositoryOrder: [], defaultCategoryOverrides: {}, categoryListIdMap: {} } };
    render(sidebar());
    fireEvent.click(screen.getByRole('button', { name: 'Expand Scientific Research' }));
    expect(mocks.expand).toHaveBeenCalledWith('technology', ['science']);
    expect(mocks.state.classificationNavigation.purpose?.expanded).toEqual(['tools']);
  });
  it('editing does not select or expand a category, and counts stay visible', () => {
    render(sidebar());
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit category' })[0]);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.expand).not.toHaveBeenCalled();
    const row = screen.getByRole('button', { name: 'Scientific Research 0' });
    expect(row.lastElementChild?.className).not.toContain('group-hover:opacity-0');
  });
});
