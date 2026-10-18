import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubApiService } from './githubApi';

afterEach(() => vi.unstubAllGlobals());

describe('GitHubApiService.isRepositoryStarred', () => {
  it.each([[204, true], [404, false]])('maps HTTP %i to %s', async (status, expected) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status, statusText: status === 404 ? 'Not Found' : 'No Content' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new GitHubApiService('test-token').isRepositoryStarred('owner', 'repo')).toBe(expected);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/user/starred/owner/repo');
  });

  it('propagates permission failures instead of treating them as unstarred', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403, statusText: 'Forbidden' })));
    await expect(new GitHubApiService('test-token').isRepositoryStarred('owner', 'repo')).rejects.toThrow('403');
  });

  it('uses the configured backend proxy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new GitHubApiService('test-token');
    api.setBackendUrl('https://backend.example/api');
    await api.isRepositoryStarred('owner', 'repo');
    expect(fetchMock.mock.calls[0][0]).toBe('https://backend.example/api/proxy/github/user/starred/owner/repo');
  });
});

describe('daily reading Star reconciliation writes', () => {
  it('preserves proxy authentication status for pausing the entire batch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 })));
    const api = new GitHubApiService('synthetic'); api.setBackendUrl('https://backend.example/api');
    await expect(api.isRepositoryStarred('owner','repo')).rejects.toMatchObject({ status: 401 });
  });
  it('does not blindly retry a lost write response', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('connection lost'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new GitHubApiService('synthetic').starRepository('owner', 'repo', undefined, { autoRetry: false })).rejects.toThrow('connection lost');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('autoRetry');
  });
  it('returns an ambiguous server failure for caller reconciliation without retransmission', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 502, statusText: 'Bad Gateway' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new GitHubApiService('synthetic').starRepository('owner', 'repo', undefined, { autoRetry: false })).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
