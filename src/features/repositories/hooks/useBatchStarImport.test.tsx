import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBatchStarImport } from './useBatchStarImport';
import { GitHubTokenPermissionError } from '../../../services/githubApi';

const mocks = vi.hoisted(() => ({
  token: 'token',
  accountId: 1,
  listeners: new Set<(next: { user: { id: number }; githubToken: string }, previous: { user: { id: number }; githubToken: string }) => void>(),
  addRepository: vi.fn(),
  getRepositoryDetails: vi.fn(),
  isRepositoryStarred: vi.fn(),
  starRepository: vi.fn(),
  forceSyncToBackend: vi.fn(),
}));
const state = () => ({
  githubToken: mocks.token, user: { id: mocks.accountId }, language: 'en',
  addRepository: mocks.addRepository,
});
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign((selector: (value: unknown) => unknown) => selector(state()), {
    getState: () => state(),
    subscribe: (listener: (next: { user: { id: number }; githubToken: string }, previous: { user: { id: number }; githubToken: string }) => void) => {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    },
  }),
}));
vi.mock('../../../services/githubApiFactory', () => ({ createGitHubApiService: () => mocks }));
vi.mock('../../../services/autoSync', () => ({ forceSyncToBackend: mocks.forceSyncToBackend }));

const detail = (owner: string, name: string) => ({
  id: 1, name, full_name: `${owner}/${name}`, description: 'A repository',
  html_url: `https://github.com/${owner}/${name}`, stargazers_count: 10,
  forks_count: 0, forks: 0, language: 'TypeScript', topics: [], license: 'MIT',
  owner: { login: owner, avatar_url: '' },
  created_at: '', updated_at: '', pushed_at: '',
});

describe('useBatchStarImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.token = 'token';
    mocks.accountId = 1;
    mocks.getRepositoryDetails.mockImplementation(async (owner, name) => detail(owner, name));
    mocks.isRepositoryStarred.mockResolvedValue(false);
    mocks.starRepository.mockResolvedValue(undefined);
    mocks.forceSyncToBackend.mockResolvedValue(undefined);
  });

  it('extracts seven unique repositories from a video summary without starring on preview', async () => {
    const names = ['hypit-ai/hypit', 'oraen/oraenView', 'Vincentwei1021/anything2explainer',
      'lanxiuyun/Catrace', 'CialloKing/ba-click-fx', 'CialloKing/ba-click-fx-desktop', 'jslxxgyy/EarthQuakeWarning'];
    const text = `本期视频中提到的一些内容： [anything2explainer](https://search.bilibili.com/all?keyword=anything2explainer)\n${
      names.map(name => `项目说明 [https://github.com/${name}](https://github.com/${name})`).join('\n')}`;
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview(text));
    expect(result.current.rows.map(row => row.detail?.full_name)).toEqual(names);
    expect(result.current.duplicateCount).toBe(7);
    expect(result.current.rows.every(row => row.selected)).toBe(true);
    expect(mocks.starRepository).not.toHaveBeenCalled();
  });

  it('keeps already-starred and inaccessible repositories out of the selection', async () => {
    mocks.isRepositoryStarred.mockResolvedValue(true);
    mocks.getRepositoryDetails.mockRejectedValueOnce(new Error('GitHub API error: 404 Not Found'));
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/missing https://github.com/owner/existing'));
    expect(result.current.rows.map(row => row.status)).toEqual(['unavailable', 'already-starred']);
    await act(() => result.current.starSelected());
    expect(mocks.starRepository).not.toHaveBeenCalled();
  });

  it('requires selection for bare names and renamed repositories, and deduplicates canonical names', async () => {
    mocks.getRepositoryDetails.mockImplementation(async (_owner, name) => detail('new-owner', name));
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('old-owner/repo https://github.com/new-owner/repo'));
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0].selected).toBe(false);
    expect(result.current.duplicateCount).toBe(1);
    act(() => result.current.toggleRow(0));
    await act(() => result.current.starSelected());
    expect(mocks.starRepository).toHaveBeenCalledWith('new-owner', 'repo', expect.any(AbortSignal));
  });

  it('records partial success and syncs only successfully starred repositories', async () => {
    mocks.starRepository.mockRejectedValueOnce(new Error('Forbidden'));
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/first https://github.com/owner/second'));
    await act(() => result.current.starSelected());
    expect(result.current.rows.map(row => row.status)).toEqual(['failed', 'starred']);
    expect(mocks.addRepository).toHaveBeenCalledTimes(1);
    expect(mocks.addRepository.mock.calls[0][0].full_name).toBe('owner/second');
    expect(mocks.forceSyncToBackend).toHaveBeenCalledWith({ reportFailures: true });
    expect(mocks.forceSyncToBackend).toHaveBeenCalledTimes(1);
  });

  it('does not report a successful GitHub star as failed when backend sync fails', async () => {
    mocks.forceSyncToBackend.mockRejectedValueOnce(new Error('Offline'));
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/repo'));
    await act(() => result.current.starSelected());
    expect(result.current.rows[0].status).toBe('starred');
    expect(result.current.syncError).toBe('Offline');
  });

  it('rejects empty extraction and oversized batches before network requests', async () => {
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://search.bilibili.com/all'));
    expect(result.current.inputError).toBe('no-repositories');
    await act(() => result.current.preview(Array.from({ length: 51 }, (_, i) => `https://github.com/owner/repo${i}`).join('\n')));
    expect(result.current.inputError).toBe('too-many-repositories');
    expect(mocks.getRepositoryDetails).not.toHaveBeenCalled();
  });

  it('selects and inverts only repositories that can still be starred', async () => {
    mocks.isRepositoryStarred.mockResolvedValueOnce(true);
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/first https://github.com/owner/second'));
    expect(result.current.rows.map(row => row.status)).toEqual(['already-starred', 'ready']);

    act(() => result.current.selectAll());
    expect(result.current.rows.map(row => row.selected)).toEqual([false, true]);
    act(() => result.current.invertSelection());
    expect(result.current.rows.map(row => row.selected)).toEqual([false, false]);
    act(() => result.current.invertSelection());
    expect(result.current.rows.map(row => row.selected)).toEqual([false, true]);
  });

  it('preserves raw descriptions for whole-page translation without adding a translation gate', async () => {
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/repo'));

    expect(result.current.rows[0].detail?.description).toBe('A repository');
    expect(result.current).not.toHaveProperty('toggleTranslations');
    await act(() => result.current.starSelected());
    expect(mocks.starRepository).toHaveBeenCalledWith('owner', 'repo', expect.any(AbortSignal));
  });

  it('preserves same-language descriptions too', async () => {
    mocks.getRepositoryDetails.mockImplementation(async (owner, name) => ({ ...detail(owner, name), description: '中文描述' }));
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/repo'));

    expect(result.current.rows[0].detail?.description).toBe('中文描述');
  });

  it('resets results when the preview is re-run or cleared', async () => {
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/repo'));

    await act(() => result.current.preview('https://github.com/owner/other'));
    expect(result.current.rows[0].detail?.full_name).toBe('owner/other');
    act(() => result.current.clearPreview());
    expect(result.current.rows).toEqual([]);
  });

  const switchAccount = (id: number) => {
    const previous = state();
    mocks.accountId = id;
    mocks.listeners.forEach(listener => listener(state(), previous));
  };

  it('rejects late preview results and old actions after an away-and-back switch without intermediate rendering', async () => {
    let resolve!: (value: ReturnType<typeof detail>) => void;
    mocks.getRepositoryDetails.mockReturnValueOnce(new Promise(value => { resolve = value; }));
    const { result } = renderHook(() => useBatchStarImport());
    const oldPreview = result.current.preview;
    let pending!: Promise<void>;
    act(() => { pending = oldPreview('https://github.com/owner/repo'); });
    act(() => { switchAccount(2); switchAccount(1); });
    await act(async () => { resolve(detail('owner', 'repo')); await pending; });
    expect(result.current.rows).toEqual([]);
    expect(mocks.isRepositoryStarred).not.toHaveBeenCalled();
    await act(() => oldPreview('https://github.com/owner/old'));
    expect(mocks.getRepositoryDetails).toHaveBeenCalledTimes(1);
  });

  it('does not add or sync a late Star result into an account that left and returned', async () => {
    let resolve!: () => void;
    mocks.starRepository.mockReturnValueOnce(new Promise<void>(value => { resolve = value; }));
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/repo'));
    let pending!: Promise<void>;
    act(() => { pending = result.current.starSelected(); });
    act(() => { switchAccount(2); switchAccount(1); });
    await act(async () => { resolve(); await pending; });
    expect(mocks.addRepository).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
    expect(result.current.rows).toEqual([]);
  });

  it('passes the actual GitHub ID and rejects invalid IDs without Star writes', async () => {
    mocks.getRepositoryDetails.mockResolvedValueOnce({ ...detail('owner', 'repo'), id: 987654 });
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/repo'));
    await act(() => result.current.starSelected());
    expect(mocks.addRepository).toHaveBeenCalledWith(expect.objectContaining({ id: 987654 }));
    mocks.getRepositoryDetails.mockResolvedValueOnce({ ...detail('owner', 'invalid'), id: 0 });
    await act(() => result.current.preview('https://github.com/owner/invalid'));
    await act(() => result.current.starSelected());
    expect(result.current.rows[0].status).toBe('unavailable');
    expect(mocks.starRepository).toHaveBeenCalledTimes(1);
  });

  it.each([
    [new GitHubTokenPermissionError(), 'Starring'],
    [Object.assign(new Error('limit'), { status: 403, retryAfterMs: 1000 }), 'rate limited'],
    [new TypeError('Failed to fetch'), 'connection'],
  ])('keeps permission, rate and network errors distinct', async (error, expected) => {
    mocks.getRepositoryDetails.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/repo'));
    expect(result.current.rows[0].error).toContain(expected);
  });
});
