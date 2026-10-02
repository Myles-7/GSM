import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubApiService } from './githubApi';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const response = (remaining = 29, resource = 'search') => new Response(JSON.stringify({ items: [], total_count: 0 }), {
  headers: { 'X-RateLimit-Remaining': String(remaining), 'X-RateLimit-Resource': resource,
    'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600) },
});

describe('discovery request cancellation and quotas', () => {
  it('does not wait when search has fewer than 100 requests remaining', async () => {
    const fetcher = vi.fn().mockImplementation(async () => response());
    vi.stubGlobal('fetch', fetcher);
    const api = new GitHubApiService('test');
    await api.searchDiscoveryCandidates('codex', 1, false);
    await api.searchDiscoveryCandidates('codex', 2, false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('keeps exhausted search quotas separate from core and surfaces cooldown', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(0)).mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    const api = new GitHubApiService('test');
    await api.searchDiscoveryCandidates('codex', 1, false);
    await expect(api.searchDiscoveryCandidates('codex', 2, false)).rejects.toMatchObject({ status: 429 });
    await api.getCurrentUser();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('honors Retry-After without blocking the dialog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '60' } })));
    await expect(new GitHubApiService('test').searchDiscoveryCandidates('codex', 1, false))
      .rejects.toMatchObject({ status: 429, retryAfterMs: 60000 });
  });
  it.each([false, true])('aborts a never-returning request (proxy=%s)', async proxy => {
    vi.useFakeTimers();
    let transportSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, options) => {
      transportSignal = options.signal;
      return new Promise(() => {});
    }));
    const api = new GitHubApiService('test');
    if (proxy) api.setBackendUrl('https://proxy.test');
    const result = api.searchDiscoveryCandidates('codex', 1, false);
    const assertion = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(transportSignal?.aborted).toBe(true);
  });
  it('propagates cancellation during network retry backoff', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const result = new GitHubApiService('test').searchDiscoveryCandidates('codex', 1, false, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
