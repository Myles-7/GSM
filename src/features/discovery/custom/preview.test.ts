import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../services/githubApiFactory', () => ({ createGitHubApiService: vi.fn() }));
vi.mock('../../../services/aiService', () => ({ AIService: vi.fn() }));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: vi.fn() },
}));
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { useAppStore } from '../../../store/useAppStore';
import { previewChannel } from './runner';
import { makeChannel, makeRepo } from './fixtures.test-support';

const search = vi.fn(), readme = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  search.mockReset(); readme.mockReset();
  vi.mocked(createGitHubApiService).mockReturnValue({ searchDiscoveryCandidates: search, getRepositoryReadme: readme } as never);
  vi.mocked(useAppStore.getState).mockReturnValue({ githubToken: 'test', user: { id: 123 }, repositories: [] } as never);
});
afterEach(() => vi.useRealTimers());
describe('lightweight candidate preview', () => {
  it('caps requests and candidates without README or AI', async () => {
    const channel = makeChannel();
    channel.plan.branches = Array.from({ length: 6 }, (_, i) => ({ terms: [`term${i}`], readme: false }));
    search.mockResolvedValue({ items: Array.from({ length: 50 }, (_, i) => makeRepo(i + 1)), incomplete: false });
    const result = previewChannel(channel, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await result).candidates).toHaveLength(10);
    expect(search).toHaveBeenCalledTimes(3);
    expect(readme).not.toHaveBeenCalled();
  });
  it('keeps partial results at the overall deadline and ignores late responses', async () => {
    let resolve!: (value: unknown) => void;
    search.mockResolvedValueOnce({ items: [makeRepo(1)], incomplete: false })
      .mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const result = previewChannel(makeChannel(), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(30000);
    const preview = await result;
    expect(preview.candidates.map(r => r.id)).toEqual([1]);
    expect(preview.issues).toEqual([{ kind: 'timeout' }]);
    expect(preview.complete).toBe(false);
    resolve({ items: [makeRepo(2)], incomplete: false });
    await Promise.resolve();
    expect(preview.candidates.map(r => r.id)).toEqual([1]);
  });
  it('rejects cancellation and account changes', async () => {
    const controller = new AbortController();
    search.mockImplementation(() => new Promise(() => {}));
    const result = previewChannel(makeChannel(), controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    search.mockImplementation(async () => {
      vi.mocked(useAppStore.getState).mockReturnValue({ githubToken: 'different', user: { id: 123 } } as never);
      return { items: [makeRepo()], incomplete: false };
    });
    await expect(previewChannel(makeChannel(), new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
