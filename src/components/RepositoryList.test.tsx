import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryList } from './RepositoryList';
import { useAppStore } from '../store/useAppStore';
import type { Repository } from '../types';
import type { ClassificationSchemes } from '../types/classification';

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
  getAllCategories: vi.fn(() => []),
}));

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({ toast: vi.fn(), confirm: vi.fn() }),
}));

vi.mock('./RepositoryCard', () => ({
  RepositoryCard: ({ repository, viewMode, onViewDetails }: { repository: Repository; viewMode: string; onViewDetails?: (repo: Repository) => void }) => (
    <button data-testid={`repository-card-${repository.id}`} data-view-mode={viewMode} onClick={() => onViewDetails?.(repository)}>{repository.name}</button>
  ),
}));
vi.mock('./RepositoryDetailsPanel', () => ({
  RepositoryDetailsPanel: ({ repository, onPrevious, onNext, onClose }: {
    repository: Repository; onPrevious?: () => void; onNext?: () => void; onClose: () => void;
  }) => <aside data-testid="details">
    <span>{repository.name}</span>
    <button disabled={!onPrevious} onClick={onPrevious}>Previous detail</button>
    <button disabled={!onNext} onClick={onNext}>Next detail</button>
    <button onClick={onClose}>Close detail</button>
  </aside>,
}));

vi.mock('../features/repositories/exploration/ExplorationExplorer', () => ({ ExplorationExplorer: ({ repositories }: { repositories: Repository[] }) => <div data-testid="cluster-repositories">{repositories.map(repo => repo.name).join(',')}</div> }));

vi.mock('./SimilarViewBanner', () => ({ SimilarViewBanner: () => null }));
vi.mock('./BulkActionToolbar', () => ({ BulkActionToolbar: () => null }));
vi.mock('./BulkCategorizeModal', () => ({ BulkCategorizeModal: () => null }));
vi.mock('./BulkRestoreModal', () => ({ BulkRestoreModal: () => null }));

const repository: Repository = {
  id: 1,
  name: 'repository-one',
  full_name: 'owner/repository-one',
  description: 'Repository description',
  html_url: 'https://github.com/owner/repository-one',
  stargazers_count: 42,
  forks_count: 0,
  forks: 0,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: [],
};

const searchFilters = {
  query: '',
  tags: [],
  languages: [],
  platforms: [],
  licenses: [],
  sortBy: 'stars' as const,
  sortOrder: 'desc' as const,
};

const storeState = {
  user: { id: 1 },
  setClassificationLocation: vi.fn(),
  setClassificationExpanded: vi.fn(),
  categoryOrder: [], subcategories: [] as { id: string; parentId: string; name: string; icon: string }[], subcategoryOrder: [],
  activeClassificationScheme: 'purpose' as 'purpose' | 'technology',
  classificationSchemes: {} as ClassificationSchemes,
  repositories: [repository],
  searchResults: [],
  githubToken: null,
  aiConfigs: [],
  activeAIConfig: null,
  isLoading: false,
  setLoading: vi.fn(),
  updateRepository: vi.fn(),
  deleteRepository: vi.fn(),
  language: 'zh' as const,
  customCategories: [],
  hiddenDefaultCategoryIds: [],
  defaultCategoryOverrides: {},
  categoryMatchMode: 'effective' as const,
  analysisProgress: { current: 0, total: 0 },
  setAnalysisProgress: vi.fn(),
  searchFilters,
  setSearchFilters: vi.fn(),
  toggleReleaseSubscription: vi.fn(),
  batchUnsubscribeReleases: vi.fn(),
  releaseSubscriptions: new Set<number>(),
  similarView: null,
  resetSimilarView: vi.fn(),
  repositoryViewMode: 'grid' as 'grid' | 'list' | 'cluster',
  setRepositoryViewMode: vi.fn((mode: 'grid' | 'list') => {
    storeState.repositoryViewMode = mode;
  }),
};

const mockUseAppStore = vi.mocked(useAppStore);

beforeEach(() => {
  vi.clearAllMocks();
  storeState.repositoryViewMode = 'grid';
  storeState.similarView = null;
  storeState.subcategories = [];
  storeState.repositories = [repository];
  storeState.activeClassificationScheme = 'purpose';
  storeState.classificationSchemes = {};
  storeState.user = { id: 1 };
  localStorage.clear();
  searchFilters.query = '';
  Object.assign(searchFilters, { sortBy: 'stars', sortOrder: 'desc' });
  mockUseAppStore.mockImplementation(((selector?: (state: unknown) => unknown) => (selector ? selector(storeState) : storeState)) as unknown as typeof useAppStore);
  Object.assign(mockUseAppStore, {
    getState: () => storeState,
    subscribe: vi.fn(() => () => {}),
  });
});

describe('RepositoryList view mode controls', () => {
  it('includes a repository id in the category drop drag payload', () => {
    render(<RepositoryList repositories={[repository]} selectedCategory="all" />);
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByTestId('repository-card-1'), { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith('application/x-gsm-repository-ids', JSON.stringify([1]));
  });

  it('opens details, navigates in visible order, and highlights only the active repository', async () => {
    const second = { ...repository, id: 2, name: 'second', stargazers_count: 1 };
    const { container } = render(<RepositoryList repositories={[second, repository]} selectedCategory="all" />);
    fireEvent.click(screen.getByTestId('repository-card-1'));
    expect(await screen.findByTestId('details')).toHaveTextContent('repository-one');
    expect(screen.getByRole('button', { name: 'Previous detail' })).toBeDisabled();
    expect(container.querySelector('[data-detail-repository="1"]')).toHaveClass('outline-primary');
    fireEvent.click(screen.getByRole('button', { name: 'Next detail' }));
    expect(screen.getByTestId('details')).toHaveTextContent('second');
    expect(container.querySelector('[data-detail-repository="2"]')).toHaveClass('outline-primary');
    expect(container.querySelector('[data-detail-repository="1"]')).not.toHaveClass('outline-primary');
    fireEvent.click(screen.getByRole('button', { name: 'Close detail' }));
    expect(screen.queryByTestId('details')).not.toBeInTheDocument();
  });

  it('sorts the raw default repository list by stars before rendering cards', () => {
    const lowerStarRepository = { ...repository, id: 2, name: 'lower-star', full_name: 'owner/lower-star', stargazers_count: 1 };
    const higherStarRepository = { ...repository, id: 3, name: 'higher-star', full_name: 'owner/higher-star', stargazers_count: 999 };

    render(<RepositoryList repositories={[lowerStarRepository, higherStarRepository, repository]} selectedCategory="all" />);

    expect(screen.getAllByTestId(/repository-card-/).map((card) => card.textContent)).toEqual([
      'higher-star',
      'repository-one',
      'lower-star',
    ]);
  });

  it('preserves the card vector-result order in similar view instead of applying the normal star sort', () => {
    const lowScoreLowStarRepository = { ...repository, id: 2, name: 'first-by-vector-score', full_name: 'owner/first-by-vector-score', stargazers_count: 1 };
    const highScoreHighStarRepository = { ...repository, id: 3, name: 'second-by-vector-score', full_name: 'owner/second-by-vector-score', stargazers_count: 999 };
    storeState.similarView = {
      active: true,
      anchorRepoFullName: repository.full_name,
      anchorRepoName: repository.name,
      similarResults: [lowScoreLowStarRepository, highScoreHighStarRepository, repository],
      originalSearchResults: [],
      originalSearchFilters: searchFilters,
    } as never;

    render(<RepositoryList repositories={[lowScoreLowStarRepository, highScoreHighStarRepository, repository]} selectedCategory="all" />);

    expect(screen.getAllByTestId(/repository-card-/).map((card) => card.textContent)).toEqual([
      'first-by-vector-score',
      'second-by-vector-score',
      'repository-one',
    ]);
  });

  it('keeps the established grid as default and switches cards to the compact list mode', () => {
    const { rerender } = render(<RepositoryList repositories={[repository]} selectedCategory="all" />);

    const card = screen.getByTestId('repository-card-1');
    expect(card).toHaveAttribute('data-view-mode', 'grid');
    // The persistent workspace owns the single layout switcher.
    expect(screen.queryByRole('group', { name: '仓库布局' })).not.toBeInTheDocument();
    storeState.setRepositoryViewMode('list');
    rerender(<RepositoryList repositories={[repository]} selectedCategory="all" />);
    expect(screen.getByTestId('repository-card-1')).toHaveAttribute('data-view-mode', 'list');
  });
});


describe('RepositoryList breadcrumb, filter recovery, and grouped search', () => {
  const repos = [
    { ...repository, id: 1, name: 'react-web', ai_details: { technologies: ['React'], platforms: ['web'] } },
    { ...repository, id: 2, name: 'python-web', ai_details: { technologies: ['Python'], platforms: ['web'] } },
    { ...repository, id: 3, name: 'react-desktop', ai_details: { technologies: ['React'], platforms: ['desktop'] } },
  ] as Repository[];

  it('keeps exploration independent of normal category selection and hides the breadcrumb bar', () => {
    storeState.repositoryViewMode = 'cluster';
    const view = render(<RepositoryList repositories={repos} selectedCategory="all" />);
    expect(screen.queryByRole('navigation', { name: '分类路径' })).not.toBeInTheDocument();
    expect(screen.getByTestId('cluster-repositories')).toHaveTextContent('react-web');
    expect(screen.getByTestId('cluster-repositories')).toHaveTextContent('react-desktop');
    view.rerender(<RepositoryList repositories={repos} selectedCategory="pending" />);
    expect(screen.getByTestId('cluster-repositories')).toHaveTextContent('python-web');
    expect(screen.getByTestId('cluster-repositories')).toHaveTextContent('react-web');
  });

  it('limits counts to subgroup and uses scheme-bound breadcrumb navigation without clearing query', () => {
    storeState.subcategories = [{ id: 'react', parentId: 'web', name: 'React group', icon: '' }];
    searchFilters.query = 'existing query';
    render(<RepositoryList repositories={[
      { ...repos[0], category_id: 'web', subcategory_id: 'react' },
      { ...repos[1], category_id: 'web', subcategory_id: 'python' },
    ]} selectedCategory="react" />);
    expect(screen.getByRole('status')).toHaveTextContent('1 / 1 个仓库');
    fireEvent.click(within(screen.getByRole('navigation', { name: '分类路径' })).getByRole('button', { name: 'web' }));
    expect(storeState.setClassificationLocation).toHaveBeenCalledWith('purpose', 'web');
    expect(storeState.setClassificationExpanded).toHaveBeenCalledWith('purpose', ['web']);
    expect(searchFilters.query).toBe('existing query');
  });

  it('clears both search query and global filters from the zero-result recovery action', () => {
    searchFilters.query = 'no-match-keyword';
    const clearSpy = vi.fn();
    window.addEventListener('gsm:clear-search-query', clearSpy);
    render(<RepositoryList repositories={[]} selectedCategory="all" />);
    fireEvent.click(screen.getByRole('button', { name: '清除全部筛选' }));
    expect(storeState.setSearchFilters).toHaveBeenCalledWith(expect.objectContaining({ query: '' }));
    expect(clearSpy).toHaveBeenCalledOnce();
    window.removeEventListener('gsm:clear-search-query', clearSpy);
  });
});
