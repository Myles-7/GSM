import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubApiService, GitHubTokenPermissionError } from './githubApi';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('GitHub token permission classification', () => {
  it.each([false, true])('classifies resource-not-accessible 403 without retrying (proxy=%s)', async proxy => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: 'Resource not accessible by personal access token',
    }), { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    const api = new GitHubApiService('fixture-token');
    if (proxy) api.setBackendUrl('https://backend.example/api');
    await expect(api.starRepository('owner', 'repo')).rejects.toBeInstanceOf(GitHubTokenPermissionError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['Resource not accessible by personal access token', { 'X-RateLimit-Remaining': '0' }],
    ['Resource not accessible by personal access token', { 'Retry-After': '60' }],
    ['You have exceeded a secondary rate limit.', {}],
  ])('keeps rate limiting distinct even with a permission-like body', async (message, headers) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message }), { status: 403, headers })));
    const error = await new GitHubApiService('fixture-token').starRepository('owner', 'repo').catch(error => error);
    expect(error).not.toBeInstanceOf(GitHubTokenPermissionError);
    expect(error).toMatchObject({ status: 403, retryAfterMs: expect.any(Number) });
  });
  it('preserves generic forbidden and malformed-body failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{not JSON', { status: 403, statusText: 'Forbidden' })));
    await expect(new GitHubApiService('fixture-token').starRepository('owner', 'repo')).rejects.toThrow('GitHub API error: 403 Forbidden');
  });
  it('preserves network failure and forwards caller cancellation', async () => {
    const controller = new AbortController();
    const failure = new TypeError('offline');
    const fetcher = vi.fn((_url, options) => { expect(options.signal).toBe(controller.signal); controller.abort(); return Promise.reject(failure); });
    vi.stubGlobal('fetch', fetcher);
    await expect(new GitHubApiService('fixture-token').starRepository('owner', 'repo', controller.signal)).rejects.toBe(failure);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
