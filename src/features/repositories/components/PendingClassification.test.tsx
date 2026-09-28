import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import type { Repository } from '../../../types';
import { PendingClassification } from './PendingClassification';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), onAssigned: vi.fn(), onSelect: vi.fn() }));
vi.mock('../../../hooks/useDialog', () => ({ useDialog: () => ({ confirm: mocks.confirm }) }));
vi.mock('../../../i18n/useT', () => ({ useT: () => (key: string) => key }));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn(),
  getAllCategories: () => [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
  ],
}));
const pending = {
  id: 1, name: 'pending', full_name: 'owner/pending', category_id: null,
  category_candidates: ['a', 'b'], custom_category: 'Legacy suggestion', category_locked: true,
} as Repository;
const state = {
  repositories: [pending],
  assignRepositoryCategory: vi.fn(),
  updateRepository: vi.fn(),
};
const categories = [
  { id: 'all', name: 'All', icon: '', keywords: [] },
  { id: 'a', name: 'Alpha', icon: '', keywords: [] },
  { id: 'b', name: 'Beta', icon: '', keywords: [] },
];
const renderPending = (selectedIds = new Set([1]), repositories = [pending]) =>
  render(<PendingClassification repositories={repositories} categories={categories} selectedIds={selectedIds} onSelect={mocks.onSelect}
    onSelectAll={vi.fn()} onAssigned={mocks.onAssigned} renderRepository={repo => <div>{repo.name}</div>} viewMode="grid" />);
beforeEach(() => {
  vi.clearAllMocks();
  state.repositories = [pending];
  mocks.confirm.mockResolvedValue(true);
  state.updateRepository.mockImplementation((repo: Repository) => {
    state.repositories = state.repositories.map(item => item.id === repo.id ? repo : item);
  });
  state.assignRepositoryCategory.mockImplementation((id: number, category_id: string) => {
    state.repositories = state.repositories.map(item => item.id === id ? { ...item, category_id, subcategory_id: null } : item);
  });
  Object.assign(useAppStore, { getState: () => state });
});

describe('PendingClassification', () => {
  it('requires an explicit category choice, preserves legacy suggestions and restores a confirmed lock', async () => {
    const user = userEvent.setup();
    renderPending();
    expect(screen.getByRole('button', { name: 'organization.assignSelected' })).toBeDisabled();
    expect(screen.getByText('organization.suggestions: Alpha, Beta')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox'), 'b');
    await user.click(screen.getByRole('button', { name: 'organization.assignSelected' }));
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(state.updateRepository).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 1, category_id: 'b' }), { overrideCategoryLock: true });
    expect(state.repositories[0]).toMatchObject({
      category_id: 'b', category_locked: true, category_candidates: ['a', 'b'], custom_category: 'Beta',
    });
  });

  it('does not write anything when confirmation is cancelled', async () => {
    const user = userEvent.setup();
    mocks.confirm.mockResolvedValue(false);
    renderPending();
    await user.selectOptions(screen.getByRole('combobox'), 'a');
    await user.click(screen.getByRole('button', { name: 'organization.assignSelected' }));
    expect(state.assignRepositoryCategory).not.toHaveBeenCalled();
    expect(state.updateRepository).not.toHaveBeenCalled();
    expect(mocks.onAssigned).not.toHaveBeenCalled();
  });

  it('includes selected repositories beyond the visible batch in an explicit bulk assignment', async () => {
    const user = userEvent.setup();
    const repositories = Array.from({ length: 60 }, (_, index) => ({ ...pending, id: index + 1, name: `repo-${index + 1}`, category_locked: false }));
    state.repositories = repositories;
    renderPending(new Set(repositories.map(repo => repo.id)), repositories);
    expect(screen.getAllByRole('checkbox')).toHaveLength(50);
    await user.selectOptions(screen.getByRole('combobox'), 'a');
    await user.click(screen.getByRole('button', { name: 'organization.assignSelected' }));
    expect(state.updateRepository).toHaveBeenCalledTimes(60);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('makes selection explicit and disables assignment for an empty selection', () => {
    renderPending(new Set());
    fireEvent.click(screen.getByRole('checkbox'));
    expect(mocks.onSelect).toHaveBeenCalledWith(1);
    expect(screen.getByRole('button', { name: 'organization.assignSelected' })).toBeDisabled();
  });
});
