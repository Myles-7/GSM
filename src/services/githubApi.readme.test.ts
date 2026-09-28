import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubApiService } from './githubApi';

afterEach(() => vi.unstubAllGlobals());

describe('GitHubApiService strict README evidence', () => {
  it('returns missing README only on HTTP 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    await expect(new GitHubApiService('token').getRepositoryReadme('owner', 'repo', undefined, { strict: true })).resolves.toBe('');
  });

  it.each([429, 403, 401])('propagates HTTP %s rather than treating it as missing', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));
    await expect(new GitHubApiService('token').getRepositoryReadme('owner', 'repo', undefined, { strict: true })).rejects.toThrow();
  });

  it('preserves the legacy error fallback for callers without strict mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    await expect(new GitHubApiService('token').getRepositoryReadme('owner', 'repo')).resolves.toBe('');
  });

  it('preserves configured backend routing and decodes the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: btoa('# README'), encoding: 'base64' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new GitHubApiService('token');
    api.setBackendUrl('http://localhost:3001');
    api.setBackendAuthToken('backend-secret');
    await expect(api.getRepositoryReadme('owner', 'repo', undefined, { strict: true })).resolves.toBe('# README');
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/proxy/github/repos/owner/repo/readme');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  it('does not request an already aborted strict read', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(new GitHubApiService('token').getRepositoryReadme('owner', 'repo', controller.signal, { strict: true })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
