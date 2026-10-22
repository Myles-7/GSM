import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClassificationSidebarChildren } from './ClassificationSidebarChildren';
import { BulkCategorizeModal } from './BulkCategorizeModal';
import { createInitialState } from '../store/initialState';
import type { AppStoreState } from '../store/types';
const mocks = vi.hoisted(() => ({ state: {} as AppStoreState, assign: vi.fn(), perform: vi.fn(), capture: vi.fn() }));
vi.mock('../store/useClassificationStore', () => ({
  useClassificationStore: Object.assign((selector: (state: AppStoreState) => unknown) => selector(mocks.state), { getState: () => mocks.state }),
  getAllCategories: () => [{ id: 'all', name: 'All', icon: '', keywords: [] }, { id: 'a', name: 'Parent', icon: '📁', keywords: [] }],
}));
vi.mock('../hooks/useDialog', () => ({ useDialog: () => ({ confirm: vi.fn(), toast: vi.fn() }) }));
vi.mock('../features/repositories/components/classificationEditActions', () => ({
  assignClassificationRepositories: mocks.assign, performClassificationEdit: mocks.perform, captureClassificationEdit: mocks.capture,
  repositoryIdsFromDrop: (transfer: DataTransfer) => JSON.parse(transfer.getData('application/x-gsm-repository-ids')),
  isRepositoryDrop: (transfer: DataTransfer) => transfer.types.includes('application/x-gsm-repository-ids'),
}));
vi.mock('./SubcategoryManagementDialog', () => ({ SubcategoryManagementDialog: ({ request }: { request: { type: string } }) => <div role="dialog">{request.type}</div> }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.assign.mockResolvedValue(true); mocks.perform.mockResolvedValue(true); mocks.capture.mockReturnValue({ schemeId: 'purpose', expectedAccountId: 1, expectedToken: 'token' });
  mocks.state = { ...createInitialState(), language: 'en', subcategories: [{ id: 'g', parentId: 'a', name: 'Child', icon: '📁' }], subcategoryOrder: ['g'], classificationNavigation: { purpose: { selected: 'all', expanded: ['a'] } } } as AppStoreState;
});
describe('subcategory controls', () => {
  it('offers rename, move, merge and delete without navigating', async () => {
    const select = vi.fn(); render(<ClassificationSidebarChildren categoryId="a" onCategorySelect={select} />);
    await userEvent.click(screen.getByRole('button', { name: 'Child actions' }));
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Move to another parent' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Merge into another subgroup' })).toBeVisible();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete subgroup' }));
    expect(mocks.perform).toHaveBeenCalledWith({ type: 'delete', id: 'g' }, expect.any(Object), expect.objectContaining({ schemeId: 'purpose' }));
    expect(select).not.toHaveBeenCalled();
  });
  it('opens the rename dialog and accepts a batch drop only once at the child', async () => {
    const parentDrop = vi.fn(); render(<div onDrop={parentDrop}><ClassificationSidebarChildren categoryId="a" onCategorySelect={vi.fn()} /></div>);
    const transfer = { types: ['application/x-gsm-repository-ids'], getData: () => '[1,2]' };
    fireEvent.dragOver(screen.getByRole('button', { name: 'Child 0' }), { dataTransfer: transfer });
    fireEvent.drop(screen.getByRole('button', { name: 'Child 0' }), { dataTransfer: transfer });
    expect(parentDrop).not.toHaveBeenCalled();
    expect(mocks.assign).toHaveBeenCalledWith([1, 2], { categoryId: 'a', subcategoryId: 'g' }, expect.any(Object), expect.any(Object));
    await userEvent.click(screen.getByRole('button', { name: 'Child actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('rename');
  });
  it('supports touch batch targeting children, and keeps the modal if consent is cancelled', async () => {
    const assign = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true); const close = vi.fn(); const legacy = vi.fn();
    render(<BulkCategorizeModal isOpen onClose={close} repositories={[]} onCategorize={legacy} onAssignTarget={assign} />);
    await userEvent.click(screen.getByRole('button', { name: 'Parent / Child' }));
    await userEvent.click(screen.getByRole('button', { name: /Confirm|确认分类/ }));
    expect(assign).toHaveBeenCalledWith({ categoryId: 'a', subcategoryId: 'g' }); expect(close).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Confirm|确认分类/ }));
    expect(close).toHaveBeenCalledOnce(); expect(legacy).not.toHaveBeenCalled();
  });
});
