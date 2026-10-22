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
    expect(screen.getByTitle('多列卡片')).toHaveAttribute('aria-pressed', 'true');

    const layoutControls = screen.getByRole('group', { name: '仓库布局' });
    const toolbar = layoutControls.closest('[data-repository-toolbar]');
    expect(toolbar?.lastElementChild).toContainElement(layoutControls);

    fireEvent.click(screen.getByTitle('单列列表'));

    expect(storeState.setRepositoryViewMode).toHaveBeenCalledWith('list');
    rerender(<RepositoryList repositories={[repository]} selectedCategory="all" />);
    expect(screen.getByTestId('repository-card-1')).toHaveAttribute('data-view-mode', 'list');
    expect(screen.getByTitle('单列列表')).toHaveAttribute('aria-pressed', 'true');
  });
});


describe('RepositoryList floating evidence facets', () => {
  const repos = [
    { ...repository, id: 1, name: 'react-web', ai_details: { technologies: ['React'], platforms: ['web'] } },
    { ...repository, id: 2, name: 'python-web', ai_details: { technologies: ['Python'], platforms: ['web'] } },
    { ...repository, id: 3, name: 'react-desktop', ai_details: { technologies: ['React'], platforms: ['desktop'] } },
  ] as Repository[];
  const openFilters = () => fireEvent.click(screen.getByRole('button', { name: /^特征筛选/ }));
  it('starts closed, keeps base counts after intersection reaches zero, and removes active chips', () => {
    render(<RepositoryList repositories={repos} selectedCategory="all" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    openFilters();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Python 1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'desktop 1' }));
    expect(screen.queryAllByTestId(/repository-card-/)).toHaveLength(0);
    expect(screen.getByRole('checkbox', { name: 'React 2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除 desktop' }));
    expect(screen.getByTestId('repository-card-2')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '清除全部特征' }));
    expect(screen.getAllByTestId(/repository-card-/)).toHaveLength(3);
  });
  it('keeps exploration independent of normal category selection and hides the facet window', () => {
    storeState.repositoryViewMode = 'cluster';
    const view = render(<RepositoryList repositories={repos} selectedCategory="all" />);
    expect(screen.queryByRole('button', { name: /^特征筛选/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('cluster-repositories')).toHaveTextContent('react-web');
    expect(screen.getByTestId('cluster-repositories')).toHaveTextContent('react-desktop');
    view.rerender(<RepositoryList repositories={repos} selectedCategory="pending" />);
    expect(screen.getByTestId('cluster-repositories')).toHaveTextContent('python-web');
    expect(screen.getByTestId('cluster-repositories')).toHaveTextContent('react-web');
  });
  it('clears facets after scheme and account switches, retaining query and closing the account window', () => {
    searchFilters.query = 'saved query';
    const view = render(<RepositoryList repositories={repos} selectedCategory="all" />);
    openFilters();
    fireEvent.click(screen.getByRole('checkbox', { name: 'React 2' }));
    storeState.activeClassificationScheme = 'technology';
    view.rerender(<RepositoryList repositories={repos} selectedCategory="all" />);
    expect(screen.getAllByTestId(/repository-card-/)).toHaveLength(3);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Python 1' }));
    storeState.user = { id: 2 };
    storeState.activeClassificationScheme = 'purpose';
    view.rerender(<RepositoryList repositories={repos} selectedCategory="all" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/repository-card-/)).toHaveLength(3);
    expect(searchFilters.query).toBe('saved query');
  });
  it('limits counts to subgroup and uses scheme-bound breadcrumb navigation without clearing query', () => {
    storeState.subcategories = [{ id: 'react', parentId: 'web', name: 'React group', icon: '' }];
    searchFilters.query = 'existing query';
    render(<RepositoryList repositories={[
      { ...repos[0], category_id: 'web', subcategory_id: 'react' },
      { ...repos[1], category_id: 'web', subcategory_id: 'python' },
    ]} selectedCategory="react" />);
    openFilters();
    expect(screen.getByRole('checkbox', { name: 'React 1' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Python 1' })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('navigation', { name: '分类路径' })).getByRole('button', { name: 'web' }));
    expect(storeState.setClassificationLocation).toHaveBeenCalledWith('purpose', 'web');
    expect(storeState.setClassificationExpanded).toHaveBeenCalledWith('purpose', ['web']);
    expect(searchFilters.query).toBe('existing query');
  });
  it('searches all choices and keeps a missing selected facet removable outside the window', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ ...repository, id: index + 1, ai_details: { technologies: [`stack-${String(index).padStart(2, '0')}`] } })) as Repository[];
    const view = render(<RepositoryList repositories={many} selectedCategory="all" />);
    openFilters();
    expect(screen.getAllByRole('checkbox', { name: /stack-/ })).toHaveLength(20);
    fireEvent.change(screen.getByRole('searchbox', { name: '技术 特征搜索' }), { target: { value: 'stack-19' } });
    expect(screen.getAllByRole('checkbox', { name: /stack-/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox', { name: 'stack-19 1' }));
    view.rerender(<RepositoryList repositories={many.slice(0, 19)} selectedCategory="all" />);
    fireEvent.click(screen.getByRole('button', { name: '关闭特征筛选' }));
    fireEvent.click(screen.getByRole('button', { name: '移除 stack-19' }));
    expect(screen.getAllByTestId(/repository-card-/)).toHaveLength(19);
  });
  it('omits classification reports, manual refinement, and confidence filters', () => {
    render(<RepositoryList repositories={repos} selectedCategory="all" />);
    openFilters();
    expect(screen.queryByText(/分类报告|继续细分|置信度/)).not.toBeInTheDocument();
  });
  it('clears both global and facet filters from the zero-result recovery action', () => {
    render(<RepositoryList repositories={repos} selectedCategory="all" />);
    openFilters();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Python 1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'desktop 1' }));
    expect(screen.queryAllByTestId(/repository-card-/)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '关闭特征筛选' }));
    expect(screen.getByText('没有符合当前筛选条件的项目')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除全部筛选' }));
    expect(storeState.setSearchFilters).toHaveBeenCalled();
    expect(screen.getAllByTestId(/repository-card-/)).toHaveLength(3);
    expect(screen.queryByLabelText('已选特征')).not.toBeInTheDocument();
  });
});
