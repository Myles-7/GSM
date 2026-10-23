import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppStoreState } from '../../../store/types';
import type { Repository } from '../../../types';
import { RepositoriesView } from './RepositoriesView';
import { repositoryFixture } from '../exploration/testFixtures';

type ViewState = Pick<AppStoreState, 'language' | 'repositories' | 'searchResults' | 'repositoryViewMode' | 'setRepositoryViewMode' | 'selectedCategory' | 'setSelectedCategory' | 'exitSimilarView' | 'searchFilters' | 'similarView'>;
const fixture = vi.hoisted(() => ({ state: {} as ViewState, select: vi.fn(), exit: vi.fn(), listeners: new Set<() => void>() }));
vi.mock('../../../store/useAppStore', async () => {
  const { useSyncExternalStore } = await import('react');
  return { useAppStore: Object.assign((selector: (state: ViewState) => unknown) => useSyncExternalStore(listener => { fixture.listeners.add(listener); return () => fixture.listeners.delete(listener); }, () => selector(fixture.state)), { getState: () => fixture.state }) };
});
vi.mock('../../../store/useClassificationStore', async () => {
  const { useSyncExternalStore } = await import('react');
  return { useClassificationStore: (selector: (state: ViewState) => unknown) => useSyncExternalStore(listener => { fixture.listeners.add(listener); return () => fixture.listeners.delete(listener); }, () => selector(fixture.state)) };
});
vi.mock('../../../components/CategorySidebar', () => ({
  CategorySidebar: ({ onCategorySelect }: { onCategorySelect: (category: string) => void }) => <button onClick={() => onCategorySelect('category')}>Select category</button>,
}));
vi.mock('../../../components/SearchBar', () => ({ SearchBar: () => <input aria-label="Search" /> }));
vi.mock('../../../components/RepositoryList', () => ({
  RepositoryList: ({ repositories, selectedCategory }: { repositories: Repository[]; selectedCategory: string }) =>
    <output aria-label="Repository results">{selectedCategory}:{repositories.map(repository => repository.id).join(',')}</output>,
}));

describe('repository view navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.state = {
      language: 'zh', repositories: [repositoryFixture(1)], searchResults: [repositoryFixture(2)], repositoryViewMode: 'grid', selectedCategory: 'all',
      setSelectedCategory: fixture.select, exitSimilarView: fixture.exit,
      setRepositoryViewMode: mode => { fixture.state = { ...fixture.state, repositoryViewMode: mode }; fixture.listeners.forEach(listener => listener()); },
      searchFilters: { query: '', languages: [], tags: [], platforms: [], licenses: [], sortBy: 'stars', sortOrder: 'desc' },
      similarView: { active: true, similarResults: [repositoryFixture(3)], anchorRepoFullName: 'owner/project-1', anchorRepoName: 'project-1', originalSearchResults: [],
        originalSearchFilters: { query: '', languages: [], tags: [], platforms: [], licenses: [], sortBy: 'stars', sortOrder: 'desc' } },
    };
  });

  it('exits similarity before changing categories', () => {
    render(<RepositoriesView />);
    expect(screen.getByLabelText('Repository results')).toHaveTextContent('all:3');
    fireEvent.click(screen.getByRole('button', { name: 'Select category' }));
    expect(fixture.exit).toHaveBeenCalledOnce();
    expect(fixture.select).toHaveBeenCalledWith('category');
    expect(fixture.exit.mock.invocationCallOrder[0]).toBeLessThan(fixture.select.mock.invocationCallOrder[0]);
  });

  it('shows search results immediately when similarity is still being cleared', () => {
    fixture.state.searchFilters.query = 'repository';
    render(<RepositoriesView />);
    expect(screen.getByLabelText('Repository results')).toHaveTextContent('all:2');
    expect(fixture.exit).toHaveBeenCalledOnce();
  });

  it('uses the canonical library for exploration and hides list-only controls', () => {
    fixture.state.repositoryViewMode = 'cluster';
    render(<RepositoriesView />);
    expect(screen.getByLabelText('Repository results')).toHaveTextContent('all:1');
    expect(screen.queryByRole('button', { name: 'Select category' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Search' })).not.toBeInTheDocument();
  });
  it('keeps one switcher in the same position and preserves card filters across map transitions', () => {
    fixture.state.searchFilters.query = 'saved search';
    const view = render(<RepositoriesView />);
    const controls = screen.getByRole('group', { name: '仓库布局' });
    fireEvent.click(screen.getByRole('button', { name: '项目地图' }));
    view.rerender(<RepositoriesView />);
    expect(screen.getByRole('group', { name: '仓库布局' })).toBe(controls);
    expect(screen.getByRole('button', { name: '项目地图' })).toHaveAttribute('aria-pressed', 'true');
    expect(fixture.state.searchFilters.query).toBe('saved search');
    fireEvent.click(screen.getByRole('button', { name: '单列列表' }));
    view.rerender(<RepositoriesView />);
    expect(screen.getByRole('button', { name: '单列列表' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: '仓库布局' })).toBe(controls);
  });
});
