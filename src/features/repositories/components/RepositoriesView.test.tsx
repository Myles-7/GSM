import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppStoreState } from '../../../store/types';
import type { Repository } from '../../../types';
import { RepositoriesView } from './RepositoriesView';
import { repositoryFixture } from '../exploration/testFixtures';

type ViewState = Pick<AppStoreState, 'repositories' | 'searchResults' | 'repositoryViewMode' | 'selectedCategory' | 'setSelectedCategory' | 'exitSimilarView' | 'searchFilters' | 'similarView'>;
const fixture = vi.hoisted(() => ({ state: {} as ViewState, select: vi.fn(), exit: vi.fn() }));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign((selector: (state: ViewState) => unknown) => selector(fixture.state), { getState: () => fixture.state }),
}));
vi.mock('../../../store/useClassificationStore', () => ({
  useClassificationStore: (selector: (state: ViewState) => unknown) => selector(fixture.state),
}));
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
      repositories: [repositoryFixture(1)], searchResults: [repositoryFixture(2)], repositoryViewMode: 'grid', selectedCategory: 'all',
      setSelectedCategory: fixture.select, exitSimilarView: fixture.exit,
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
});
