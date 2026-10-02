import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import { loadExternalDiscoveryFeed, readExternalDiscoveryFeed, readExternalDiscoveryRssFeed } from './externalDiscoveryFeed';

const url = 'https://example.com/feed';
const json = (repositories = ['owner/repo']) => new Response(JSON.stringify({ repositories }));
const detail = (index = 1) => ({ id: index, full_name: `owner/repo-${index}` }) as Repository;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('external feed transport', () => {
  it('fetches directly without credentials, auth tokens, redirect or referrer', async () => {
    const fetch = vi.fn().mockResolvedValue(json());
    vi.stubGlobal('fetch', fetch);
    expect(await readExternalDiscoveryFeed(url)).toEqual(['owner/repo']);
    expect(fetch).toHaveBeenCalledWith(url, {
      headers: { Accept: 'application/json, application/rss+xml, application/atom+xml, application/xml, text/xml' },
      credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: expect.any(AbortSignal),
    });
  });
  it('rejects a private URL before any request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(readExternalDiscoveryFeed('https://127.0.0.1/feed')).rejects.toMatchObject({ code: 'invalid-url' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reports CORS failures and malformed JSON or UTF-8', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('CORS'))
      .mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response(new Uint8Array([0xff])));
    vi.stubGlobal('fetch', fetch);
    await expect(readExternalDiscoveryFeed(url)).rejects.toMatchObject({ code: 'unreadable' });
    await expect(readExternalDiscoveryFeed(url)).rejects.toMatchObject({ code: 'invalid-format' });
    await expect(readExternalDiscoveryFeed(url)).rejects.toMatchObject({ code: 'invalid-format' });
  });
  it.each(['http', 'redirect', 'length'] as const)('cancels rejected %s response bodies', async mode => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      status: mode === 'http' ? 503 : 200,
      headers: mode === 'length' ? { 'content-length': '128001' } : {},
    });
    if (mode === 'redirect') Object.defineProperty(response, 'redirected', { value: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(readExternalDiscoveryFeed(url)).rejects.toMatchObject({ code: mode === 'length' ? 'too-large' : 'http' });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('accepts exactly 128000 bytes and cancels streamed overflow even without content-length', async () => {
    const body = JSON.stringify({ repositories: ['owner/repo'] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body.padEnd(128000))));
    await expect(readExternalDiscoveryFeed(url)).resolves.toEqual(['owner/repo']);
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(128001)); },
      cancel,
    }))));
    await expect(readExternalDiscoveryFeed(url)).rejects.toMatchObject({ code: 'too-large' });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('times out AND cancels a stalled body even if the transport ignores the signal', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel })));
    vi.stubGlobal('fetch', fetch);
    const pending = readExternalDiscoveryFeed(url);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('propagates caller abort through body reading and starts no work for a pre-aborted caller', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel })));
    vi.stubGlobal('fetch', fetch);
    const pending = readExternalDiscoveryFeed(url, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await Promise.resolve();
    controller.abort();
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
    await expect(readExternalDiscoveryFeed(url, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('cancels an eventual response after headers have timed out', async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    const pending = readExternalDiscoveryFeed(url);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    const cancel = vi.fn();
    resolve(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('reads Atom via the same safe transport', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      '<feed xmlns="http://www.w3.org/2005/Atom"><entry><link href="https://github.com/owner/repo"/></entry></feed>')));
    await expect(readExternalDiscoveryRssFeed(url)).resolves.toEqual(['owner/repo']);
  });
});

describe('external GitHub detail loading', () => {
  it('limits concurrency to five, preserves feed order and ranks successful details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(Array.from({ length: 30 }, (_, i) => `owner/repo-${i}`))));
    let active = 0;
    let max = 0;
    const api = { getRepositoryDetails: vi.fn(async (_owner: string, repo: string, signal?: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      active++;
      max = Math.max(max, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      const index = Number(repo.split('-')[1]);
      if (index === 3) throw new Error('Not found');
      return detail(index);
    }) };
    const result = await loadExternalDiscoveryFeed(url, 'external:test', api);
    expect(max).toBe(5);
    expect(api.getRepositoryDetails).toHaveBeenCalledTimes(30);
    expect(result.repos).toHaveLength(29);
    expect(result.repos[3]).toMatchObject({ id: 4, rank: 4, channel: 'external:test', platform: 'All' });
    expect(result).toMatchObject({ hasMore: false, nextPageIndex: 2, totalCount: 29 });
  });
  it('reports total failure without publishing an empty successful feed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json()));
    await expect(loadExternalDiscoveryFeed(url, 'external:test', { getRepositoryDetails: vi.fn().mockRejectedValue(new Error('Not found')) }))
      .rejects.toMatchObject({ code: 'no-details' });
  });
  it('uses the SAME 15-second deadline for feed and GitHub details', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 10000));
      return json(Array.from({ length: 30 }, (_, i) => `owner/repo-${i}`));
    }));
    const signals: AbortSignal[] = [];
    const api = { getRepositoryDetails: vi.fn((_owner: string, _repo: string, signal?: AbortSignal) => {
      signals.push(signal!);
      return new Promise<Repository>(() => undefined);
    }) };
    const pending = loadExternalDiscoveryFeed(url, 'external:test', api);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(14999);
    expect(api.getRepositoryDetails).toHaveBeenCalledTimes(5);
    expect(signals.every(signal => !signal.aborted)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(api.getRepositoryDetails).toHaveBeenCalledTimes(5);
  });
  it('aborts in-flight detail work and never schedules the next wave', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(Array.from({ length: 30 }, (_, i) => `owner/repo-${i}`))));
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    let complete!: (value: Repository) => void;
    const api = { getRepositoryDetails: vi.fn((_owner: string, _repo: string, signal?: AbortSignal) => {
      signals.push(signal!);
      return new Promise<Repository>(resolve => { complete = resolve; });
    }) };
    const pending = loadExternalDiscoveryFeed(url, 'external:test', api, 'json', controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(api.getRepositoryDetails).toHaveBeenCalledTimes(5));
    controller.abort();
    await assertion;
    complete(detail());
    await Promise.resolve();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(api.getRepositoryDetails).toHaveBeenCalledTimes(5);
  });
});
