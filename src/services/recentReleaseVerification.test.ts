import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Release } from '../types';
import { makeRepo } from '../features/discovery/custom/fixtures.test-support';
import { isRecentRelease, verifyRecentReleases } from './recentReleaseVerification';
const release = (patch: Partial<Release> & { draft?: boolean } = {}): Release => ({
  id: 1, tag_name: 'v1.0', name: 'v1.0', html_url: 'https://github.com/test/repo/releases/tag/v1.0', body: '',
  published_at: new Date().toISOString(), prerelease: false, repository: { id: 1, name: 'repo', full_name: 'test/repo' }, assets: [], ...patch,
});
afterEach(() => vi.useRealTimers());
describe('real release verification', () => {
  it('requires recent public stable publication, not recent commits', async () => {
    const read = vi.fn().mockResolvedValueOnce({ releases: [], hasMore: false }).mockResolvedValueOnce({ releases: [release()], hasMore: false });
    const result = await verifyRecentReleases([makeRepo(1), makeRepo(2)], 'stable-test', read);
    expect([...result.matches.keys()]).toEqual([2]);
    expect(isRecentRelease(release({ draft: true }), false)).toBe(false);
    expect(isRecentRelease(release({ published_at: '2000-01-01' }), false)).toBe(false);
    expect(isRecentRelease(release({ published_at: new Date(Date.now() + 86400000).toISOString() }), false)).toBe(false);
  });
  it('reuses cache but re-evaluates the prerelease switch and account identity', async () => {
    const read = vi.fn().mockResolvedValue({ releases: [release({ prerelease: true })], hasMore: false });
    expect((await verifyRecentReleases([makeRepo()], 'pre-test', read)).matches.size).toBe(0);
    expect((await verifyRecentReleases([makeRepo()], 'pre-test', read, { prereleases: true })).matches.size).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
    await verifyRecentReleases([makeRepo()], 'another-account', read);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('caps candidates at forty, concurrency at three, and returns partial on failures', async () => {
    let active = 0, maximum = 0;
    const read = vi.fn(async (repo) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      if (repo.id === 1) throw new TypeError('offline');
      return { releases: [release()], hasMore: false };
    });
    const result = await verifyRecentReleases(Array.from({ length: 50 }, (_, i) => makeRepo(i + 1)), 'budget-test', read);
    expect(read).toHaveBeenCalledTimes(40); expect(maximum).toBe(3);
    expect(result.verification).toEqual({ current: 40, total: 40, failed: 1, partial: true });
  });
  it('aborts never-returning requests at fifteen seconds', async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const pending = verifyRecentReleases([makeRepo()], 'deadline-test', async (_repo, _page, s) => { signal = s; return new Promise(() => {}); });
    await vi.advanceTimersByTimeAsync(15001);
    const result = await pending;
    expect(signal.aborted).toBe(true); expect(result.verification.partial).toBe(true);
  });
  it('propagates explicit cancellation and never publishes a late response', async () => {
    const controller = new AbortController();
    let resolve!: (value: { releases: Release[]; hasMore: boolean }) => void;
    const pending = verifyRecentReleases([makeRepo()], 'cancel-test', () => new Promise(r => { resolve = r; }), { signal: controller.signal });
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    resolve({ releases: [release()], hasMore: false });
  });
});
