import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import { clearRepositoryDetailReadmeCache, getRepositoryDetailReadme } from './repositoryDetailReadme';

vi.mock('./backendAdapter', () => ({ backend: { isAvailable: false } }));
vi.mock('./routeMode', () => ({ shouldBypassBackend: () => true }));
const apiMocks = vi.hoisted(() => ({ readme: vi.fn(), factory: vi.fn() }));
vi.mock('./githubApiFactory', () => ({ createGitHubApiService: apiMocks.factory }));
const fetchMock = vi.fn();
const options = {
  repository: { full_name: 'owner/repo', pushed_at: '2026-09-01' } as Repository,
  accountId: 1, githubToken: 'test-token',
};
beforeEach(() => {
  clearRepositoryDetailReadmeCache();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  apiMocks.factory.mockReset().mockReturnValue({ getRepositoryReadme: apiMocks.readme });
  apiMocks.readme.mockReset().mockResolvedValue('# README');
});
afterEach(() => { clearRepositoryDetailReadmeCache(); vi.unstubAllGlobals(); });
it('deduplicates concurrent requests and reuses evidence with its original retrieval time', async () => {
  const [first, second] = await Promise.all([getRepositoryDetailReadme(options), getRepositoryDetailReadme(options)]);
  expect(apiMocks.readme).toHaveBeenCalledOnce();
  expect(apiMocks.factory).toHaveBeenCalledWith('test-token');
  expect(apiMocks.readme).toHaveBeenCalledWith('owner', 'repo', expect.any(AbortSignal), { strict: true });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(first).toEqual(second);
  expect(await getRepositoryDetailReadme(options)).toEqual(first);
  expect(apiMocks.readme).toHaveBeenCalledOnce();
});
it('isolates cache by account and pushed-at', async () => {
  await getRepositoryDetailReadme(options);
  await getRepositoryDetailReadme({ ...options, accountId: 2 });
  await getRepositoryDetailReadme({ ...options, repository: { ...options.repository, pushed_at: '2026-09-02' } });
  expect(apiMocks.readme).toHaveBeenCalledTimes(3);
});
it('treats only 404 as missing and does not cache transient failures', async () => {
  apiMocks.readme.mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }));
  await expect(getRepositoryDetailReadme(options)).rejects.toMatchObject({ status: 429 });
  apiMocks.readme.mockResolvedValueOnce('');
  expect((await getRepositoryDetailReadme(options)).content).toBe('');
  expect(apiMocks.readme).toHaveBeenCalledTimes(2);
});
it('propagates network failures and retries rather than caching missing evidence', async () => {
  apiMocks.readme.mockRejectedValueOnce(new TypeError('network down'));
  await expect(getRepositoryDetailReadme(options)).rejects.toThrow('network down');
  expect((await getRepositoryDetailReadme(options)).content).toBe('# README');
  expect(apiMocks.readme).toHaveBeenCalledTimes(2);
});
it('one consumer abort does not cancel a shared request required by another', async () => {
  let finish!: (response: string) => void;
  apiMocks.readme.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const controller = new AbortController();
  const first = getRepositoryDetailReadme({ ...options, signal: controller.signal });
  const second = getRepositoryDetailReadme(options);
  controller.abort();
  await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  expect(apiMocks.readme.mock.calls[0][2].aborted).toBe(false);
  finish('shared');
  expect((await second).content).toBe('shared');
});
it('aborts the underlying request when the final consumer leaves', async () => {
  apiMocks.readme.mockImplementationOnce((_owner, _name, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  const controller = new AbortController();
  const request = getRepositoryDetailReadme({ ...options, signal: controller.signal });
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  expect(apiMocks.readme.mock.calls[0][2].aborted).toBe(true);
});
