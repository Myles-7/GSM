import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchBar } from './SearchBar';
import { useAppStore } from '../store/useAppStore';
import type { Repository, SearchFilters } from '../types';
import corpus from '../utils/__fixtures__/submittedRepositorySearch.json';
const providers = vi.hoisted(() => ({ query: vi.fn(), embed: vi.fn(), prepare: vi.fn() }));
vi.mock('../services/vectorSearchService', async importOriginal => ({
  ...await importOriginal<typeof import('../services/vectorSearchService')>(),
  EmbeddingClient: class { embed = providers.embed; },
  VectorSearchService: class { query = providers.query; prepareQuery = providers.prepare; },
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
  getAllCategories: vi.fn(() => []),
}));

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({
    toast: vi.fn(),
    confirm: vi.fn(),
  }),
}));

const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
});

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  configurable: true,
});

const defaultSearchFilters: SearchFilters = {
  query: '',
  tags: [],
  languages: [],
  platforms: [],
  licenses: [],
  sortBy: 'stars',
  sortOrder: 'desc',
};

const createRepository = (overrides: Partial<Repository>): Repository => ({
  id: 1,
  name: 'react',
  full_name: 'facebook/react',
  description: null,
  html_url: 'https://github.com/facebook/react',
  stargazers_count: 1000,
  forks_count: 100,
  forks: 100,
  language: 'TypeScript',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  pushed_at: '2024-01-03T00:00:00Z',
  owner: {
    login: 'facebook',
    avatar_url: 'https://example.com/avatar.png',
  },
  topics: [],
  ...overrides,
});

const createStoreState = (overrides: Partial<ReturnType<typeof baseStoreState>> = {}) => ({
  ...baseStoreState(),
  ...overrides,
});

const baseStoreState = () => ({
  searchFilters: { ...defaultSearchFilters },
  repositories: [] as Repository[],
  repositoryOrder: [] as number[],
  releaseSubscriptions: new Set<number>(),
  aiConfigs: [],
  activeAIConfig: null,
  language: 'zh',
  setSearchFilters: vi.fn(),
  setSearchResults: vi.fn(),
  customCategories: [],
  hiddenDefaultCategoryIds: [],
  defaultCategoryOverrides: {},
  vectorSearchConfig: { enabled: false, workerUrl: '', authToken: '', embeddingConfigId: '', indexMode: 'readme' as const, readmeMaxChars: 6000 },
  vectorSearchStatus: { connected: false, vectorCount: 0, dimensions: 0 },
  embeddingConfigs: [],
});

const mockUseAppStore = vi.mocked(useAppStore);
// Track the current mock state so getState() returns the same overrides as the hook.
let currentState = baseStoreState();
(mockUseAppStore as unknown as { getState: () => ReturnType<typeof baseStoreState> }).getState =
  () => currentState;

describe('SearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    currentState = baseStoreState();
  });

  it('retains the submitted union after facet effects and honors explicit and custom sort controls', async () => {
    currentState.repositories = corpus.repositories.map(repo => ({ ...repo, forks: repo.forks_count }));
    currentState.repositoryOrder = [102, 101, 103];
    Object.assign(currentState.vectorSearchConfig, { enabled: true, workerUrl: 'https://worker.invalid', embeddingConfigId: 'mock', enableHyDE: false, enableReranking: false });
    currentState.embeddingConfigs = [{ id: 'mock' }] as never;
    currentState.setSearchFilters.mockImplementation((patch: Partial<SearchFilters>) => { currentState.searchFilters = { ...currentState.searchFilters, ...patch }; });
    providers.prepare.mockResolvedValue(undefined); providers.embed.mockResolvedValue([[0.1]]); providers.query.mockResolvedValue([{ id: '103', score: 0.95 }]);
    mockUseAppStore.mockImplementation(((selector?: (state: unknown) => unknown) => selector ? selector(currentState) : currentState) as unknown as typeof useAppStore);
    const { rerender } = render(<SearchBar />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ui-kit' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    const ids = () => currentState.setSearchResults.mock.lastCall?.[0].map((repo: Repository) => repo.id);
    await waitFor(() => expect(ids()).toEqual([101, 102, 103]));
    currentState.searchFilters = { ...currentState.searchFilters, languages: ['TypeScript'] }; rerender(<SearchBar />);
    expect(ids()).toEqual([101, 103]);
    currentState.searchFilters = { ...currentState.searchFilters, languages: [] }; rerender(<SearchBar />);
    expect(ids()).toEqual([101, 102, 103]);
    fireEvent.click(screen.getByRole('button', { name: '按降序排列' })); rerender(<SearchBar />);
    expect(ids()).toEqual([101, 102, 103]); // explicit ascending stars
    currentState.searchFilters = { ...currentState.searchFilters, sortBy: 'custom' }; rerender(<SearchBar />);
    expect(ids()).toEqual([102, 101, 103]);
    expect(providers.query).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } }); rerender(<SearchBar />);
    expect(currentState.searchFilters.query).toBe(''); expect(ids()).toHaveLength(corpus.repositories.length);
  });

  it('clears the committed query when the search input is manually emptied', () => {
    const setSearchFilters = vi.fn();
    currentState = createStoreState({
      searchFilters: {
        ...defaultSearchFilters,
        query: 'react',
      },
      setSearchFilters,
    });
    mockUseAppStore.mockImplementation(((selector?: (state: unknown) => unknown) => (selector ? selector(currentState) : currentState)) as unknown as typeof useAppStore);

    render(<SearchBar />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });

    expect(setSearchFilters).toHaveBeenCalledWith({ query: '' });
  });

  it('keeps the committed query empty when sorting after manual clearing', () => {
    const storeState = createStoreState({
      searchFilters: {
        ...defaultSearchFilters,
        query: 'react',
        sortOrder: 'desc',
      },
    });

    const setSearchFilters = vi.fn((filters: Partial<SearchFilters>) => {
      storeState.searchFilters = {
        ...storeState.searchFilters,
        ...filters,
      };
    });
    storeState.setSearchFilters = setSearchFilters;

    currentState = storeState;
    mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (selector ? selector(storeState) : storeState)) as unknown as typeof useAppStore);

    const { rerender } = render(<SearchBar />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });

    expect(storeState.searchFilters.query).toBe('');

    rerender(<SearchBar />);
    // 排序方向按钮已从文本字形换成图标，按可访问名称定位
    fireEvent.click(screen.getByRole('button', { name: '按降序排列' }));

    expect(storeState.searchFilters).toMatchObject({
      query: '',
      sortOrder: 'asc',
    });
    expect(setSearchFilters).toHaveBeenCalledWith({ query: '' });
    expect(setSearchFilters).toHaveBeenCalledWith({ sortOrder: 'asc' });
  });

  it('pauses real-time search for IME preedit text and resumes after composition ends', () => {
    vi.useFakeTimers();
    const setSearchResults = vi.fn();
    currentState = createStoreState({
      repositories: [
        createRepository({ id: 1, name: 'nested-rain', full_name: 'owner/nested-rain' }),
        createRepository({ id: 2, name: 'vector-search', full_name: 'owner/vector-search' }),
      ],
      setSearchResults,
    });
    mockUseAppStore.mockImplementation(((selector?: (state: unknown) => unknown) => (selector ? selector(currentState) : currentState)) as unknown as typeof useAppStore);

    try {
      render(<SearchBar />);
      const input = screen.getByRole('textbox');

      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: 'rain' } });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(setSearchResults).not.toHaveBeenCalledWith([
        expect.objectContaining({ name: 'nested-rain' }),
      ]);

      fireEvent.compositionEnd(input);

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(setSearchResults).toHaveBeenLastCalledWith([
        expect.objectContaining({ name: 'nested-rain' }),
      ]);
      expect(currentState.setSearchFilters).toHaveBeenCalledWith({ query: 'rain' });
      expect(input).toHaveValue('rain');
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets stale real-time results when the input becomes whitespace-only', () => {
    vi.useFakeTimers();
    const repositories = [
      createRepository({ id: 1, name: 'nested-rain', full_name: 'owner/nested-rain' }),
      createRepository({ id: 2, name: 'vector-search', full_name: 'owner/vector-search' }),
    ];
    const setSearchResults = vi.fn();
    currentState = createStoreState({
      repositories,
      setSearchResults,
    });
    mockUseAppStore.mockImplementation(((selector?: (state: unknown) => unknown) => (selector ? selector(currentState) : currentState)) as unknown as typeof useAppStore);

    try {
      render(<SearchBar />);
      const input = screen.getByRole('textbox');

      fireEvent.change(input, { target: { value: 'rain' } });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(setSearchResults).toHaveBeenLastCalledWith([
        expect.objectContaining({ name: 'nested-rain' }),
      ]);

      fireEvent.change(input, { target: { value: '   ' } });

      expect(setSearchResults).toHaveBeenLastCalledWith(repositories);
    } finally {
      vi.useRealTimers();
    }
  });

  it('selects a search history item before the blur delay hides the dropdown', () => {
    vi.useFakeTimers();
    const setSearchFilters = vi.fn();
    const setSearchResults = vi.fn();
    const repositories = [createRepository({ id: 1, name: 'react', full_name: 'facebook/react' })];
    localStorage.setItem('github-stars-search-history', JSON.stringify(['react']));
    currentState = createStoreState({ repositories, setSearchFilters, setSearchResults });
    mockUseAppStore.mockImplementation(((selector?: (state: unknown) => unknown) => (selector ? selector(currentState) : currentState)) as unknown as typeof useAppStore);

    try {
      render(<SearchBar />);
      const input = screen.getByRole('textbox');
      fireEvent.focus(input);
      const historyItem = screen.getByRole('button', { name: 'react' });
      setSearchResults.mockClear();

      fireEvent.blur(input);
      fireEvent.click(historyItem);

      expect(input).toHaveValue('react');
      expect(setSearchFilters).toHaveBeenCalledWith({ query: 'react' });
      expect(setSearchResults).toHaveBeenCalledWith(expect.any(Array));
    } finally {
      vi.useRealTimers();
    }
  });

  it('selects a suggestion and keeps real-time search enabled', () => {
    vi.useFakeTimers();
    const repositories = [createRepository({ id: 1, language: 'TypeScript' })];
    currentState = createStoreState({ repositories });
    mockUseAppStore.mockImplementation(((selector?: (state: unknown) => unknown) => (selector ? selector(currentState) : currentState)) as unknown as typeof useAppStore);

    try {
      render(<SearchBar />);
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'type' } });
      const suggestionItem = screen.getByRole('button', { name: 'TypeScript' });

      fireEvent.blur(input);
      fireEvent.click(suggestionItem);

      expect(input).toHaveValue('TypeScript');
      act(() => { vi.advanceTimersByTime(300); });
      expect(currentState.setSearchResults).toHaveBeenCalledWith(expect.any(Array));
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-runs search when a health filter chip is toggled', () => {
    const archived = createRepository({
      id: 1,
      name: 'archived-repo',
      full_name: 'owner/archived-repo',
      archived: true,
    });
    const active = createRepository({
      id: 2,
      name: 'active-repo',
      full_name: 'owner/active-repo',
      archived: false,
    });
    const storeState = createStoreState({
      repositories: [archived, active],
      searchFilters: { ...defaultSearchFilters },
    });
    const setSearchResults = vi.fn();
    const setSearchFilters = vi.fn((filters: Partial<SearchFilters>) => {
      storeState.searchFilters = { ...storeState.searchFilters, ...filters };
    });
    storeState.setSearchResults = setSearchResults;
    storeState.setSearchFilters = setSearchFilters;
    currentState = storeState;
    mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (selector ? selector(storeState) : storeState)) as unknown as typeof useAppStore);

    const { rerender } = render(<SearchBar />);
    fireEvent.click(screen.getByRole('button', { name: /过滤器/ }));
    setSearchResults.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '已归档' }));
    expect(setSearchFilters).toHaveBeenCalledWith({ healthArchived: true });

    rerender(<SearchBar />);
    expect(setSearchResults).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'archived-repo' }),
    ]);
  });

  it('dispatches the global history open event from the compact more menu', async () => {
    const user = userEvent.setup();
    currentState = createStoreState({});
    mockUseAppStore.mockImplementation(((selector?: (state: unknown) => unknown) => (selector ? selector(currentState) : currentState)) as unknown as typeof useAppStore);
    const dispatchSpy = vi.fn();
    window.addEventListener('gsm:open-global-chat-history', dispatchSpy);

    try {
      render(<SearchBar />);
      await user.click(screen.getByRole('button', { name: /更多操作|organization.moreActions/ }));
      await user.click(screen.getByRole('menuitem', { name: '问答历史' }));
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('gsm:open-global-chat-history', dispatchSpy);
    }
  });

  it('disables direction in custom order and clearing filters preserves that order', () => {
    const setSearchFilters = vi.fn();
    currentState = createStoreState({
      searchFilters: { ...defaultSearchFilters, sortBy: 'custom', languages: ['Python'] },
      setSearchFilters,
    });
    mockUseAppStore.mockImplementation(((selector?: (state: unknown) => unknown) => (selector ? selector(currentState) : currentState)) as unknown as typeof useAppStore);
    render(<SearchBar />);
    expect(screen.getByRole('button', { name: '按降序排列' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '清除全部' }));
    const reset = setSearchFilters.mock.calls[setSearchFilters.mock.calls.length - 1]?.[0];
    expect(reset).not.toHaveProperty('sortBy');
    expect(reset).not.toHaveProperty('sortOrder');
    expect(reset.languages).toEqual([]);
    expect(document.getElementById('repository-toolbar-actions')).not.toBeNull();
  });
});
