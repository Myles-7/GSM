import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { useRepositoryDragStore } from '../../../store/useRepositoryDragStore';
import { RepositoryGroups } from './RepositoryGroups';

const mocks = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('../../../hooks/useDialog', () => ({ useDialog: () => ({ confirm: mocks.confirm }) }));
vi.mock('../../../i18n/useT', () => ({ useT: () => (key: string) => key }));
const repo = (id: number, group: string | null = 'a', categoryId = 'main') => ({
  id, name: `repo-${id}`, full_name: `owner/repo-${id}`, category_id: categoryId, subcategory_id: group,
}) as Repository;
const state = {
  subcategories: [
    { id: 'a', parentId: 'main', name: 'Alpha', icon: 'folder' },
    { id: 'b', parentId: 'main', name: 'Beta', icon: 'book' },
    { id: 'other', parentId: 'elsewhere', name: 'Elsewhere', icon: 'code' },
  ],
  subcategoryOrder: ['other', 'b', 'a'],
  repositoryOrder: [3, 2, 1, 4],
  repositories: [repo(1), repo(2), repo(3, 'b'), repo(4, null), repo(5, 'other', 'elsewhere')],
  addSubcategory: vi.fn(), updateSubcategory: vi.fn(), deleteSubcategory: vi.fn(),
  moveRepositoryToSubcategory: vi.fn(), reorderSubcategories: vi.fn(), reorderRepositories: vi.fn(),
};
const renderGroups = (props: Partial<React.ComponentProps<typeof RepositoryGroups>> = {}) =>
  render(<RepositoryGroups categoryId="main" repositories={state.repositories.filter(r => r.category_id === 'main')} filtered={false}
    customSort viewMode="grid" renderRepository={r => <div data-testid={`repo-${r.id}`}>{r.name}</div>} {...props} />);
const section = (name: string) => screen.getByRole('heading', { name: new RegExp(name) }).closest('section')!;
const transfer = (id: string, type = 'application/x-gsm-repository-id') => ({
  types: [type], getData: (requested: string) => requested === type ? id : '', setData: vi.fn(), effectAllowed: 'move',
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirm.mockResolvedValue(true);
  vi.mocked(useAppStore).mockImplementation(((selector: (s: typeof state) => unknown) => selector(state)) as typeof useAppStore);
});

describe('RepositoryGroups', () => {
  it('keeps every heading mounted, puts ungrouped last, and honors group and repository orders', () => {
    renderGroups();
    expect(screen.getAllByRole('heading').map(node => node.textContent)).toEqual(['Beta 1', 'Alpha 2', 'organization.ungrouped 1']);
    expect(within(section('Alpha')).getAllByTestId(/repo-/).map(node => node.textContent)).toEqual(['repo-2', 'repo-1']);
    fireEvent.click(within(section('Alpha')).getByRole('button', { name: 'organization.collapse' }));
    expect(screen.queryByTestId('repo-1')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alpha 2' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Alpha' }));
    expect(screen.getByTestId('repo-1')).toBeInTheDocument();
  });

  it('mounts 50 repositories per group, independently loads more, and retains empty headings', () => {
    renderGroups({ repositories: Array.from({ length: 120 }, (_, index) => repo(index + 1)) });
    expect(screen.getAllByTestId(/repo-/)).toHaveLength(50);
    expect(screen.getByRole('heading', { name: 'Beta 0' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'organization.loadMore' }));
    expect(screen.getAllByTestId(/repo-/)).toHaveLength(100);
  });

  it('only reassigns cross-group drops under rule sort and does not mutate custom order', () => {
    renderGroups({ customSort: false });
    useRepositoryDragStore.getState().startDrag();
    fireEvent.drop(section('Beta'), { dataTransfer: transfer('1') });
    expect(state.moveRepositoryToSubcategory).toHaveBeenCalledWith(1, 'b');
    expect(state.reorderRepositories).not.toHaveBeenCalled();
    expect(useRepositoryDragStore.getState().isDragging).toBe(false);
    fireEvent.drop(screen.getByTestId('repo-2'), { dataTransfer: transfer('1') });
    expect(state.reorderRepositories).not.toHaveBeenCalled();
  });

  it('disables within-group reorder when filtered but permits cross-group assignment', async () => {
    const user = userEvent.setup();
    renderGroups({ filtered: true });
    await user.click(screen.getByRole('button', { name: 'organization.moveRepository: repo-1' }));
    expect(screen.getByRole('menuitem', { name: 'organization.moveUp' })).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Escape}');
    fireEvent.drop(screen.getByTestId('repo-2'), { dataTransfer: transfer('1') });
    expect(state.reorderRepositories).not.toHaveBeenCalled();
    fireEvent.drop(section('Beta'), { dataTransfer: transfer('1') });
    expect(state.moveRepositoryToSubcategory).toHaveBeenCalledWith(1, 'b');
    expect(state.reorderRepositories).not.toHaveBeenCalled();
  });

  it('reorders custom repositories and groups only on an explicit completed action', () => {
    renderGroups();
    fireEvent.dragStart(screen.getAllByRole('button', { name: 'organization.reorderGroup' })[1], { dataTransfer: transfer('') });
    fireEvent.dragEnd(screen.getAllByRole('button', { name: 'organization.reorderGroup' })[1]);
    expect(state.reorderSubcategories).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getAllByRole('button', { name: 'organization.reorderGroup' })[1], { key: 'ArrowUp', altKey: true });
    expect(state.reorderSubcategories).toHaveBeenCalledWith(['other', 'a', 'b']);
    fireEvent.drop(screen.getByTestId('repo-2'), { dataTransfer: transfer('1') });
    expect(state.reorderRepositories).toHaveBeenCalledWith([3, 1, 2, 4, 5]);
  });

  it('ignores repositories outside the current main category', () => {
    renderGroups();
    fireEvent.drop(section('Beta'), { dataTransfer: transfer('5') });
    expect(state.moveRepositoryToSubcategory).not.toHaveBeenCalled();
  });

  it('creates a named group with an icon and writes nothing on cancel', async () => {
    const user = userEvent.setup();
    renderGroups();
    await user.click(screen.getByRole('button', { name: 'organization.createGroup' }));
    await user.type(screen.getByLabelText('organization.groupName'), 'New group');
    await user.click(screen.getByRole('button', { name: 'organization.icon.code' }));
    await user.click(screen.getByRole('button', { name: 'organization.cancel' }));
    expect(state.addSubcategory).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'organization.createGroup' }));
    await user.type(screen.getByLabelText('organization.groupName'), ' New group ');
    await user.click(screen.getByRole('button', { name: 'organization.icon.book' }));
    await user.click(screen.getByRole('button', { name: 'organization.save' }));
    expect(state.addSubcategory).toHaveBeenCalledWith({ parentId: 'main', name: 'New group', icon: 'book' });
  });

  it('requires confirmation to delete a group', async () => {
    const user = userEvent.setup();
    mocks.confirm.mockResolvedValue(false);
    renderGroups();
    await user.click(within(section('Alpha')).getByRole('button', { name: 'organization.groupActions' }));
    await user.click(screen.getByRole('menuitem', { name: 'organization.deleteGroup' }));
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(state.deleteSubcategory).not.toHaveBeenCalled();
    mocks.confirm.mockResolvedValue(true);
    await user.click(within(section('Alpha')).getByRole('button', { name: 'organization.groupActions' }));
    await user.click(screen.getByRole('menuitem', { name: 'organization.deleteGroup' }));
    expect(state.deleteSubcategory).toHaveBeenCalledWith('a');
  });

  it('adds only explicitly selected existing repositories in the current category', async () => {
    const user = userEvent.setup();
    renderGroups();
    await user.click(within(section('Beta')).getByRole('button', { name: 'organization.groupActions' }));
    await user.click(screen.getByRole('menuitem', { name: 'organization.addExisting' }));
    expect(screen.queryByRole('checkbox', { name: 'owner/repo-5' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'owner/repo-3' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'owner/repo-1' }));
    expect(state.moveRepositoryToSubcategory).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'organization.addSelected' }));
    expect(state.moveRepositoryToSubcategory).toHaveBeenCalledWith(1, 'b');
    expect(state.reorderRepositories).toHaveBeenCalledWith([3, 2, 4, 5, 1]);
  });
});
