import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeSearchView } from './CodeSearchView';
import { useAppStore } from '../store/useAppStore';
import { searchGrepApp, type GrepSearchResult } from '../services/grepAppService';
import type { Repository } from '../types';
import { codeItemKey, defaultReadingPreferences, workspaceSessionKey } from '../features/discovery/workspace/model';
import { exportDiscoveryWorkspace, importDiscoveryWorkspace, loadBrowseSession, loadReadingPreferences, saveBrowsePage, saveReadingAnchor, saveReadingPreferences } from '../features/discovery/workspace/storage';
import { defaultCodeSearchSourceState, codeSearchSignature, saveCodeSearchSourceState } from '../services/codeSearchWorkspace';

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
}));

vi.mock('../services/grepAppService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/grepAppService')>();
  return { ...actual, searchGrepApp: vi.fn() };
});

const mockedSearch = vi.mocked(searchGrepApp);
const mockedStore = vi.mocked(useAppStore);
let account: string;
let currentState: ReturnType<typeof useAppStore.getState>;

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
  owner: { login: 'facebook', avatar_url: 'https://example.com/a.png' },
  topics: [],
  ...overrides,
});

const mockResult: GrepSearchResult = {
  total: 2,
  repoFacets: [
    { val: 'facebook/react', count: 1 },
    { val: 'other/repo', count: 1 },
  ],
  pathFacets: [{ val: 'src/', count: 2 }],
  langFacets: [{ val: 'TypeScript', count: 2 }],
  hits: [
    {
      repo: 'facebook/react',
      branch: 'main',
      path: 'src/index.ts',
      language: 'TypeScript',
      totalMatches: '3',
      snippetHtml: '<pre><mark>hello</mark></pre>',
    },
    {
      repo: 'other/repo',
      branch: 'main',
      path: 'a file with spaces.ts',
      language: 'TypeScript',
      totalMatches: '1',
      snippetHtml: '<pre>world</pre>',
    },
  ],
};

function pageResult(start: number, count: number, total = 100): GrepSearchResult {
  return { ...mockResult, total, hits: Array.from({ length: count }, (_, index) => ({
    ...mockResult.hits[0], path: `src/file-${start + index}.ts`,
  })) };
}

async function seedCache(overrides: Partial<ReturnType<typeof defaultCodeSearchSourceState>> = {}, data = mockResult, nextPage = 2, hasMore = false) {
  const source = { ...defaultCodeSearchSourceState(), query: 'hello', ...overrides };
  const signature = codeSearchSignature(source);
  const key = workspaceSessionKey('code-search', signature);
  await saveBrowsePage(account, { key, channelId: 'code-search', signature, items: data.hits.map(hit => ({ ...hit })),
    itemKeys: data.hits.map(codeItemKey), nextPage, hasMore, totalCount: data.total, mode: 'replace' });
  await saveCodeSearchSourceState(account, { ...source, resultSignature: signature,
    facets: { repoFacets: data.repoFacets, pathFacets: data.pathFacets, langFacets: data.langFacets } });
  return key;
}

async function waitReady() {
  await waitFor(() => expect(screen.getByLabelText('代码搜索关键词')).toBeEnabled());
}

describe('CodeSearchView', () => {
  beforeEach(() => {
    account = crypto.randomUUID();
    currentState = { repositories: [createRepository({})], language: 'zh', user: { id: account } } as unknown as ReturnType<typeof useAppStore.getState>;
    Object.assign(useAppStore, { getState: () => currentState });
    mockedStore.mockImplementation(
      ((selector: (s: unknown) => unknown) =>
        selector(currentState)) as unknown as typeof useAppStore
    );
    mockedSearch.mockReset().mockResolvedValue(mockResult);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the idle empty state without fetching', async () => {
    render(<CodeSearchView />);
    expect(await screen.findByText('代码搜索')).toBeInTheDocument();
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('does not search for queries shorter than 2 chars', async () => {
    render(<CodeSearchView />);
    await waitFor(() => expect(screen.getByLabelText('代码搜索关键词')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('代码搜索关键词'), { target: { value: 'a' } });
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('debounces input and renders hits with encoded file links', async () => {
    render(<CodeSearchView />);
    await waitFor(() => expect(screen.getByLabelText('代码搜索关键词')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('代码搜索关键词'), { target: { value: 'hello' } });
    expect(mockedSearch).not.toHaveBeenCalled();
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(1));
    expect(mockedSearch).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'hello', mode: 'fuzzy', page: 1 }),
      expect.anything()
    );
    expect(await screen.findByRole('link', { name: 'facebook/react' })).toBeInTheDocument();
    // 路径含空格需做分段编码
    const fileLink = await screen.findByText('a file with spaces.ts');
    expect(fileLink.getAttribute('href')).toContain('a%20file%20with%20spaces.ts');
    // 已收藏仓库打出 Starred 徽章
    expect(screen.getByText('已收藏')).toBeInTheDocument();
  });

  it('starred-only switch filters out non-starred hits', async () => {
    render(<CodeSearchView />);
    await waitFor(() => expect(screen.getByLabelText('代码搜索关键词')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('代码搜索关键词'), { target: { value: 'hello' } });
    await screen.findByRole('link', { name: 'other/repo' });
    fireEvent.click(screen.getByLabelText('只显示我收藏的仓库'));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'other/repo' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'facebook/react' })).toBeInTheDocument();
  });

  it('facet selection re-searches with f.* params', async () => {
    render(<CodeSearchView />);
    await waitFor(() => expect(screen.getByLabelText('代码搜索关键词')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('代码搜索关键词'), { target: { value: 'hello' } });
    await screen.findByRole('link', { name: 'facebook/react' });
    fireEvent.click(screen.getByTitle('TypeScript (2)'));
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(2));
    expect(mockedSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({ langs: ['TypeScript'] }),
      expect.anything()
    );
  });

  it('shows retryable error on rate limit but keeps previous results', async () => {
    render(<CodeSearchView />);
    await waitFor(() => expect(screen.getByLabelText('代码搜索关键词')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('代码搜索关键词'), { target: { value: 'hello' } });
    await screen.findByRole('link', { name: 'facebook/react' });
    const rateLimit = new Error('limited');
    (rateLimit as { status?: number }).status = 429;
    mockedSearch.mockRejectedValueOnce(rateLimit);
    fireEvent.click(screen.getByTitle('TypeScript (2)'));
    await screen.findByText(/限流/);
    // 旧结果保留可见
    expect(screen.getByRole('link', { name: 'facebook/react' })).toBeInTheDocument();
  });

  it('restores query, modes, facets, and cached results without searching on mount or language changes', async () => {
    const key = await seedCache({ mode: 'regexp', caseSensitive: true, langs: ['TypeScript'], repos: ['facebook/react'], paths: ['src/'] });
    const { rerender } = render(<CodeSearchView />);
    await waitReady();
    expect(screen.getByLabelText('代码搜索关键词')).toHaveValue('hello');
    expect(screen.getByRole('radio', { name: '正则 (RE2)' })).toBeChecked();
    expect(screen.getByLabelText('区分大小写')).toBeChecked();
    expect(screen.getByTitle('TypeScript (2)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTitle('facebook/react (1)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTitle('src/ (2)')).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelectorAll('[data-reading-key]')).toHaveLength(2);
    expect(document.querySelector('[data-reading-key]')).toHaveAttribute('data-reading-key', codeItemKey(mockResult.hits[0]));
    currentState = { ...currentState, language: 'en' };
    rerender(<CodeSearchView />);
    await new Promise(resolve => setTimeout(resolve, 520));
    expect(mockedSearch).not.toHaveBeenCalled();
    expect((await loadBrowseSession(account, key))?.session.nextPage).toBe(2);
  });

  it('restores starred filtering and backs up code query metadata with results', async () => {
    await seedCache({ starredOnly: true });
    const backup = await exportDiscoveryWorkspace(account);
    expect(backup.sessions.filter(session => session.channelId === 'code-search')).toHaveLength(2);
    await importDiscoveryWorkspace(account, backup, 'replace');
    render(<CodeSearchView />);
    await waitReady();
    expect(screen.getByLabelText('只显示我收藏的仓库')).toBeChecked();
    expect(screen.getByRole('link', { name: 'facebook/react' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'other/repo' })).not.toBeInTheDocument();
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('restores a reading anchor using stable repo/branch/path identity', async () => {
    const key = await seedCache();
    await saveReadingAnchor(account, { sessionKey: key, itemKey: codeItemKey(mockResult.hits[0]), offset: 120, previousKeys: [], updatedAt: Date.now() });
    const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    render(<CodeSearchView />);
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ top: -120, behavior: 'auto' }));
    expect(mockedSearch).not.toHaveBeenCalled();
    scroll.mockRestore();
  });

  it('continues the source cursor with stable identities and keeps previously read order', async () => {
    const original = pageResult(0, 20, 22);
    const key = await seedCache({}, original, 3, true);
    mockedSearch.mockResolvedValueOnce({ ...original, hits: [{ ...original.hits[0], snippetHtml: '<pre>updated</pre>' },
      ...pageResult(20, 2, 22).hits] });
    render(<CodeSearchView />);
    await waitReady();
    fireEvent.click(screen.getByRole('button', { name: /加载更多/ }));
    await waitFor(() => expect(document.querySelectorAll('[data-reading-key]')).toHaveLength(22));
    expect(mockedSearch).toHaveBeenCalledWith(expect.objectContaining({ q: 'hello', page: 3 }), expect.anything());
    const saved = await loadBrowseSession(account, key);
    expect(saved?.session.nextPage).toBe(4);
    expect(saved?.items.map(hit => hit.path).slice(0, 20)).toEqual(original.hits.map(hit => hit.path));
  });

  it.each([20, 50, 100] as const)('loads %i logical hits over fixed source pages and buffers overflow', async (batchSize) => {
    await saveReadingPreferences(account, 'code-search', { ...defaultReadingPreferences(), batchSize });
    mockedSearch.mockImplementation(async params => pageResult(((params.page ?? 1) - 1) * 30, 30, 150));
    render(<CodeSearchView />);
    await waitReady();
    fireEvent.change(screen.getByLabelText('代码搜索关键词'), { target: { value: 'hello' } });
    fireEvent.keyDown(screen.getByLabelText('代码搜索关键词'), { key: 'Enter' });
    await waitFor(() => expect(document.querySelectorAll('[data-reading-key]')).toHaveLength(batchSize));
    expect(mockedSearch).toHaveBeenCalledTimes(Math.ceil(batchSize / 30));
    const signature = codeSearchSignature({ ...defaultCodeSearchSourceState(), query: 'hello' });
    const cached = await loadBrowseSession(account, workspaceSessionKey('code-search', signature));
    expect(cached?.items).toHaveLength(batchSize);
    expect(cached?.buffer).toHaveLength(Math.ceil(batchSize / 30) * 30 - batchSize);
    expect(cached?.session.nextPage).toBe(Math.ceil(batchSize / 30) + 1);
  });

  it('keeps manual loading by default and enables automatic loading only after an opted-in user scroll', async () => {
    await seedCache({}, pageResult(0, 20, 40), 3, true);
    const { unmount } = render(<CodeSearchView />);
    await waitReady();
    fireEvent.wheel(window, { deltaY: 100 }); fireEvent.scroll(window);
    expect(mockedSearch).not.toHaveBeenCalled();
    unmount();
    await saveReadingPreferences(account, 'code-search', { ...defaultReadingPreferences(), loading: 'auto' });
    render(<CodeSearchView />);
    await waitReady();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(mockedSearch).not.toHaveBeenCalled();
    mockedSearch.mockResolvedValueOnce(pageResult(20, 20, 40));
    fireEvent.wheel(window, { deltaY: 100 }); fireEvent.scroll(window);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(1));
  });

  it('provides reading settings with loading controls and no AI section, without triggering a query', async () => {
    await seedCache();
    render(<CodeSearchView />);
    await waitReady();
    fireEvent.click(screen.getByRole('button', { name: '代码阅读设置' }));
    const sheet = screen.getByRole('dialog', { name: '阅读设置' });
    expect(within(sheet).getByRole('combobox', { name: '加载方式' })).toHaveTextContent('手动加载');
    expect(within(sheet).getByRole('combobox', { name: '每次加载数量' })).toHaveTextContent('20');
    expect(within(sheet).queryByRole('heading', { name: 'AI 分析' })).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('switch', { name: '继续上次阅读' }));
    fireEvent.click(within(sheet).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((await loadReadingPreferences(account, 'code-search')).resumeReading).toBe(false);
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('clears results independently while preserving query and reading preferences on remount', async () => {
    const key = await seedCache({ mode: 'words' });
    const { unmount } = render(<CodeSearchView />);
    await waitReady();
    fireEvent.click(screen.getByRole('button', { name: '代码阅读设置' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '清空列表缓存' }));
    await screen.findByText('列表缓存已清空');
    expect(await loadBrowseSession(account, key)).toBeNull();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
    unmount();
    render(<CodeSearchView />);
    await waitReady();
    expect(screen.getByLabelText('代码搜索关键词')).toHaveValue('hello');
    expect(screen.queryByRole('link', { name: 'facebook/react' })).not.toBeInTheDocument();
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('cancels late replies as soon as the user edits, including clearing below the query minimum', async () => {
    let resolve!: (result: GrepSearchResult) => void;
    mockedSearch.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
    render(<CodeSearchView />);
    await waitReady();
    const input = screen.getByLabelText('代码搜索关键词');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(1));
    const signal = mockedSearch.mock.calls[0][1]?.signal;
    fireEvent.change(input, { target: { value: 'a' } });
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolve(mockResult); });
    expect(screen.queryByRole('link', { name: 'facebook/react' })).not.toBeInTheDocument();
    expect((await exportDiscoveryWorkspace(account)).sessions.filter(session => session.totalCount > 0)).toEqual([]);
  });

  it('retains partial batch results on rate limit and retries from the failed source page', async () => {
    const rateLimit = Object.assign(new Error('limited'), { status: 429 });
    mockedSearch.mockResolvedValueOnce(pageResult(0, 10)).mockRejectedValueOnce(rateLimit);
    render(<CodeSearchView />);
    await waitReady();
    const input = screen.getByLabelText('代码搜索关键词');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText(/限流/);
    expect(document.querySelectorAll('[data-reading-key]')).toHaveLength(10);
    mockedSearch.mockResolvedValueOnce(pageResult(10, 20));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(document.querySelectorAll('[data-reading-key]')).toHaveLength(30));
    expect(mockedSearch).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.anything());
  });

  it('reports workspace write failure without discarding successful search results', async () => {
    render(<CodeSearchView />);
    await waitReady();
    const spy = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('disk unavailable'); });
    try {
      const input = screen.getByLabelText('代码搜索关键词');
      fireEvent.change(input, { target: { value: 'hello' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(await screen.findByRole('link', { name: 'facebook/react' })).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('代码阅读数据未能保存或恢复: disk unavailable');
    } finally { spy.mockRestore(); }
  });

  it('guards late results on an account switch and restores the new account without a query', async () => {
    let resolve!: (result: GrepSearchResult) => void;
    mockedSearch.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
    const oldAccount = account;
    const { rerender } = render(<CodeSearchView />);
    await waitReady();
    fireEvent.change(screen.getByLabelText('代码搜索关键词'), { target: { value: 'hello' } });
    fireEvent.keyDown(screen.getByLabelText('代码搜索关键词'), { key: 'Enter' });
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(1));
    account = crypto.randomUUID();
    currentState = { ...currentState, user: { ...currentState.user!, id: account } as unknown as NonNullable<typeof currentState.user> };
    rerender(<CodeSearchView />);
    await waitReady();
    await act(async () => { resolve(mockResult); });
    expect(screen.getByLabelText('代码搜索关键词')).toHaveValue('');
    expect(screen.queryByRole('link', { name: 'facebook/react' })).not.toBeInTheDocument();
    expect((await exportDiscoveryWorkspace(oldAccount)).sessions.filter(session => session.totalCount > 0)).toEqual([]);
    expect((await exportDiscoveryWorkspace(account)).sessions).toEqual([]);
  });
});
