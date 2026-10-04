import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { defaultSettings, type ReadingSettings } from '../lib/html-reading/model';
const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown>, custom: {} as unknown,
  popular: vi.fn(), trending: vi.fn(), topic: vi.fn(), search: vi.fn(), saved: vi.fn(), hot: vi.fn() }));
vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => mocks.state }, getAllCategories: () => [] }));
vi.mock('../features/discovery/custom/storage', () => ({ loadData: async () => mocks.custom }));
vi.mock('../features/discovery/workspace/storage', () => ({ loadBrowseSession: mocks.saved }));
vi.mock('./githubApiFactory', () => ({ createGitHubApiService: () => ({ getMostPopular: mocks.popular, getTrendingRepositories: mocks.trending,
  getTopicRepositories: mocks.topic, searchRepositories: mocks.search, getHotReleaseRepositories: mocks.hot }) }));
const repo = { id: 7, full_name: 'acme/project', owner: { login: 'acme' }, topics: [], description: '真实取数夹具', stargazers_count: 200, pushed_at: '2026-10-01', channel: 'most-popular' };
const settings = (patch: Partial<ReadingSettings> = {}): ReadingSettings => ({ ...defaultSettings, repositories: false, channelIds: ['most-popular'], perChannel: 1, ...patch });
beforeEach(() => {
  vi.resetModules(); vi.stubGlobal('indexedDB', new IDBFactory());
  for (const fn of [mocks.popular, mocks.trending, mocks.topic, mocks.search, mocks.saved, mocks.hot]) fn.mockReset();
  mocks.saved.mockResolvedValue(null);
  mocks.custom = { channels: [], editions: [], analyses: {} };
  mocks.state = { user: { id: 42 }, isAuthenticated: true, githubToken: 'synthetic', repositories: [], discoveryRepos: {}, discoveryLastRefresh: {},
    discoveryPlatform: 'all', discoverySearchQuery: '', discoveryLanguage: '', discoverySortBy: 'stars', discoverySortOrder: 'desc', discoverySelectedTopic: null,
    trendingTimeRange: 'daily', customCategories: [], releases: [], language: 'zh', setDiscoveryRepos: vi.fn(), setDiscoveryLastRefresh: vi.fn() };
});
async function generator() { return (await import('./htmlReading')).generatePreparedReadingSnapshot; }
describe('HTML prepares discovery independently from opening desktop channels', () => {
  it('reuses the durable source after a module restart and does not register previews', async () => {
    mocks.popular.mockResolvedValue({ repos: [repo], hasMore: false });
    await (await generator())(settings(), 'preview');
    const { loadReadingData } = await import('../lib/html-reading/storage');
    expect((await loadReadingData('42')).snapshots).toEqual({});
    vi.resetModules();
    const output = await (await generator())(settings({ fontSize: '20' }), 'preview');
    expect(output.snapshot.sections[0].entries).toEqual([{ repoId: 7 }]); expect(mocks.popular).toHaveBeenCalledTimes(1);
  });
  it('clears prior results on confirmed empty refresh and never revives desktop fallback', async () => {
    mocks.state.discoveryRepos = { 'most-popular': [repo] }; mocks.state.discoveryLastRefresh = { 'most-popular': new Date().toISOString() };
    mocks.saved.mockResolvedValue({items:[repo],buffer:[],session:{refreshedAt:new Date().toISOString()}});
    mocks.popular.mockResolvedValue({ repos: [], hasMore: false });
    const generate = await generator(); await generate(settings(), 'preview', undefined, true);
    const output = await generate(settings(), 'export');
    expect(output.snapshot.sections[0]).toMatchObject({ sourceStatus: 'empty', entries: [] }); expect(mocks.popular).toHaveBeenCalledTimes(1);
  });
  it('allows empty preview/export but rejects empty send with a nonretryable noContent error', async () => {
    mocks.popular.mockResolvedValue({ repos: [], hasMore: false }); const generate = await generator();
    await expect(generate(settings(), 'preview')).resolves.toHaveProperty('html');
    await expect(generate(settings(), 'export')).resolves.toHaveProperty('html');
    await expect(generate(settings({ refreshBeforeSend: false }), 'send')).rejects.toMatchObject({ code: 'noContent', retryable: false });
  });
  it('aborts a pending network call and ignores providers that finish late', async () => {
    let finish!: (result: unknown) => void; let transport: AbortSignal | undefined;
    mocks.popular.mockImplementation((_platform,_page,_count,signal) => { transport = signal; return new Promise(resolve => { finish = resolve; }); });
    const controller = new AbortController(); const generate = await generator();
    const work = generate(settings(), 'export', undefined, false, { signal: controller.signal });
    await vi.waitFor(() => expect(transport).toBeDefined()); controller.abort();
    await expect(work).rejects.toMatchObject({ code: 'cancelled', retryable: false }); expect(transport?.aborted).toBe(true);
    finish({ repos: [repo], hasMore: false }); await Promise.resolve();
    const { loadReadingData } = await import('../lib/html-reading/storage'); expect((await loadReadingData('42')).snapshots).toEqual({});
  });
  it('refuses unknown-age and expired source fallback after refresh fails', async () => {
    mocks.state.discoveryRepos = { 'most-popular': [repo] }; mocks.popular.mockRejectedValue(Error('offline'));
    const output = await (await generator())(settings(), 'preview'); expect(output.snapshot.sections[0]).toMatchObject({ sourceStatus: 'unavailable', entries: [] });
  });
  it.each(['preview', 'export', 'send'] as const)('fills an unopened channel for %s without changing the desktop list', async mode => {
    mocks.popular.mockResolvedValue({ repos: [repo], hasMore: false }); const progress = vi.fn();
    const output = await (await generator())(settings({ refreshBeforeSend: false }), mode, progress);
    expect(output.snapshot.sections[0]).toMatchObject({ sourceStatus: 'updated', fetchedCount: 1, entries: [{ repoId: 7 }] });
    expect(output.snapshot.items!['7'].description).toBe(repo.description);
    expect(mocks.state.discoveryRepos).toEqual({}); expect(mocks.state.setDiscoveryRepos).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledWith(expect.stringContaining('正在准备最受欢迎'));
  });
  it('hydrates the matching account/source desktop workspace while offline', async () => {
    mocks.saved.mockResolvedValue({ items: [repo], buffer: [], session: { refreshedAt: '2026-10-04T00:00:00Z' } });
    const output = await (await generator())(settings(), 'export');
    expect(output.snapshot.sections[0]).toMatchObject({ sourceStatus: 'cached', entries: [{ repoId: 7 }], updatedAt: '2026-10-04T00:00:00Z' });
    expect(mocks.saved).toHaveBeenCalledWith('42', expect.stringContaining('most-popular'));
    expect(mocks.popular).not.toHaveBeenCalled();
  });
  it('keeps already loaded channels and fetches only the missing selected channel', async () => {
    mocks.state.discoveryRepos = { 'most-popular': [repo] }; mocks.state.discoveryLastRefresh = { 'most-popular': new Date().toISOString() }; mocks.trending.mockResolvedValue({ repos: [{ ...repo, id: 8 }], hasMore: false });
    mocks.saved.mockResolvedValueOnce({items:[repo],buffer:[],session:{refreshedAt:new Date().toISOString()}});
    const output = await (await generator())(settings({ channelIds: ['most-popular', 'trending'] }), 'preview');
    expect(output.snapshot.sections.map(s => s.entries![0].repoId)).toEqual([7, 8]); expect(mocks.popular).not.toHaveBeenCalled();
  });
  it('retains cached content after explicit refresh failure and attaches the cause to that channel', async () => {
    mocks.state.discoveryRepos = { 'most-popular': [repo] }; mocks.state.discoveryLastRefresh = { 'most-popular': '2026-10-03T00:00:00Z' };
    mocks.saved.mockResolvedValue({items:[repo],buffer:[],session:{refreshedAt:'2026-10-03T00:00:00Z'}});
    mocks.popular.mockRejectedValue(Error('TOKEN=never serialize'));
    const output = await (await generator())(settings(), 'preview', undefined, true);
    expect(output.snapshot.sections[0]).toMatchObject({ sourceStatus: 'unavailable', entries: [{ repoId: 7 }], updatedAt: '2026-10-03T00:00:00Z' });
    expect(output.snapshot.sections[0].warning).toContain('失败'); expect(output.html).not.toContain('never serialize');
    expect(mocks.state.setDiscoveryRepos).not.toHaveBeenCalled();
  });
  it('distinguishes confirmed empty results from unloaded/error, avoiding repeated requests during styling previews', async () => {
    mocks.popular.mockResolvedValue({ repos: [], hasMore: false }); const generate = await generator();
    const first = await generate(settings(), 'preview'); const second = await generate(settings({ fontSize: '20' }), 'preview');
    expect(first.snapshot.sections[0]).toMatchObject({ sourceStatus: 'empty', entries: [] });
    expect(first.snapshot.sections[0].warning).toContain('已查询上游'); expect(first.snapshot.sections[0].warning).not.toContain('尚无');
    expect(second.snapshot.sections[0].sourceStatus).toBe('empty'); expect(mocks.popular).toHaveBeenCalledTimes(1);
  });
  it('uses the latest export as fallback after a forced refresh fails without touching the desktop cache', async () => {
    mocks.popular.mockResolvedValueOnce({ repos: [repo], hasMore: false }).mockRejectedValueOnce(Error('offline'));
    const generate = await generator(); await generate(settings(), 'export');
    const second = await generate(settings(), 'preview', undefined, true);
    expect(second.snapshot.sections[0]).toMatchObject({ sourceStatus: 'unavailable', entries: [{ repoId: 7 }] });
    expect(second.snapshot.sections[0].warning).toContain('失败'); expect(mocks.state.discoveryRepos).toEqual({});
  });
  it('keeps an explicit successful update for subsequent ordinary previews over an older desktop cache', async () => {
    mocks.state.discoveryRepos = { 'most-popular': [repo] }; mocks.state.discoveryLastRefresh = { 'most-popular': '2026-10-01T00:00:00Z' };
    mocks.saved.mockResolvedValue({items:[repo],buffer:[],session:{refreshedAt:'2026-10-01T00:00:00Z'}});
    mocks.popular.mockResolvedValue({ repos: [{ ...repo, id: 8 }], hasMore: false });
    const generate = await generator(); await generate(settings(), 'preview', undefined, true);
    const second = await generate(settings(), 'preview');
    expect(second.snapshot.sections[0].entries).toEqual([{ repoId: 8 }]); expect(mocks.popular).toHaveBeenCalledTimes(1);
  });
  it('reports missing credentials without clearing loaded content or blocking repositories', async () => {
    mocks.state.githubToken = ''; mocks.state.repositories = [repo];
    const output = await (await generator())(settings({ repositories: true }), 'export');
    expect(output.snapshot.sections[0].entries).toEqual([{ repoId: 7 }]);
    expect(output.snapshot.sections[1].warning).toContain('缺少 GitHub 凭据'); expect(mocks.popular).not.toHaveBeenCalled();
  });
  it('does not invent search terms or charge AI for a custom channel with no edition', async () => {
    mocks.custom = { channels: [{ id: 'custom:test', name: '研究' }], editions: [], analyses: {} };
    const output = await (await generator())(settings({ channelIds: ['search', 'custom:test'] }), 'export');
    expect(output.snapshot.sections[0].warning).toContain('设置搜索词'); expect(output.snapshot.sections[1].warning).toContain('没有已生成期刊');
    expect(mocks.search).not.toHaveBeenCalled(); expect(mocks.popular).not.toHaveBeenCalled();
  });
  it('matches desktop topic fallback instead of exporting a blank default topic channel', async () => {
    mocks.trending.mockResolvedValue({ repos: [repo], hasMore: false });
    const output = await (await generator())(settings({ channelIds: ['topic'] }), 'export');
    expect(output.snapshot.sections[0].entries).toEqual([{ repoId: 7 }]);
    expect(mocks.trending).toHaveBeenCalledWith('all', 1, 1, 'weekly', expect.any(AbortSignal)); expect(mocks.topic).not.toHaveBeenCalled();
  });
  it('does not reuse another source signature when topic/search conditions change', async () => {
    mocks.state.discoverySelectedTopic = 'react'; mocks.topic.mockResolvedValue({ repos: [repo], hasMore: false });
    const generate = await generator(); await generate(settings({ channelIds: ['topic'] }), 'preview');
    mocks.state = { ...mocks.state, discoverySelectedTopic: 'python' }; await generate(settings({ channelIds: ['topic'] }), 'preview');
    expect(mocks.topic).toHaveBeenCalledTimes(2); expect(mocks.topic).toHaveBeenLastCalledWith('python', 'all', 1, 1, expect.any(AbortSignal));
  });
  it('never assigns the current source signature to an unproven in-memory list', async () => {
    mocks.state.discoveryRepos={topic:[repo]};mocks.state.discoveryLastRefresh={topic:new Date().toISOString()};mocks.state.discoverySelectedTopic='python';
    mocks.topic.mockResolvedValue({repos:[{...repo,id:8}],hasMore:false});
    const output=await (await generator())(settings({channelIds:['topic']}),'preview');
    expect(output.snapshot.sections[0].entries).toEqual([{repoId:8}]);expect(mocks.topic).toHaveBeenCalledWith('python','all',1,1,expect.any(AbortSignal));
  });
  it('rejects account changes before registering a snapshot or writing discovery lists', async () => {
    mocks.popular.mockImplementation(async () => { mocks.state = { ...mocks.state, user: { id: 43 } }; return { repos: [repo], hasMore: false }; });
    await expect((await generator())(settings(), 'export')).rejects.toThrow('账户已变更');
    expect(mocks.state.setDiscoveryRepos).not.toHaveBeenCalled();
    const { loadReadingData } = await import('../lib/html-reading/storage'); expect((await loadReadingData('42')).snapshots).toEqual({});
  });
  it('keeps usable first pages when a later page fails, with a channel-specific incomplete status', async () => {
    mocks.popular.mockResolvedValueOnce({ repos: [repo], hasMore: true, nextPageIndex: 2 }).mockRejectedValueOnce(Error('network'));
    const output = await (await generator())(settings({ perChannel: 60 }), 'export');
    expect(output.snapshot.sections[0]).toMatchObject({ sourceStatus: 'partial', fetchedCount: 1, entries: [{ repoId: 7 }] });
    expect(output.snapshot.sections[0].warning).toContain('目标 60，本次取得 1');
  });
  it('reports reading filters rather than mislabelling a fetched channel as unloaded', async () => {
    const { readingTransaction } = await import('../lib/html-reading/storage');
    await readingTransaction('42', data => { data.states['7'] = { read: true, interest: 'neutral', note: '', candidate: false }; });
    mocks.popular.mockResolvedValue({ repos: [repo], hasMore: false });
    const output = await (await generator())(settings({ unreadOnly: true }), 'export');
    expect(output.snapshot.sections[0].entries).toEqual([]); expect(output.snapshot.sections[0].warning).toContain('导出条件');
    expect(output.snapshot.sections[0].warning).not.toContain('尚无');
  });
});
