import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { emptyData, type CustomDiscoveryData } from './model';
import { IDBFactory } from 'fake-indexeddb';
import { deleteRepositoryAnalysisAssets, initializeRepositoryAnalysisAssets, hasRepositoryAnalysisAsset, saveRepositoryAnalysisAsset } from '../../../services/repositoryAnalysisAssets';
import { makeChannel, makeRepo } from './fixtures.test-support';
import type { Repository } from '../../../types';
const mocks = vi.hoisted(() => ({
  state: { user: { id: 123 }, githubToken: 'test', language: 'zh', aiConfigs: [{ id: 'ai', apiKey: 'key', model: 'test', baseUrl: 'https://ai.test' }], activeAIConfig: 'ai',
    repositories: [] as Repository[], updateRepository: vi.fn(), discoveryChannels: [{ id: 'trending', enabled: true }] },
  data: {} as CustomDiscoveryData, analyze: vi.fn(), readme: vi.fn(),
}));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => mocks.state } }));
vi.mock('../../../services/repositoryDetailAnalysis', () => ({ analyzeRepositoryDetails: mocks.analyze }));
vi.mock('../../../services/repositoryDetailReadme', () => ({ getRepositoryDetailReadme: mocks.readme }));
vi.mock('./storage', () => ({
  transact: async (_account: string, change: (data: CustomDiscoveryData) => unknown) => change(mocks.data),
  loadData: async () => mocks.data,
}));
import { useCustomDiscovery } from './store';
import { aiTaskJournal } from '../../../services/aiTaskJournal';
import { analysisKey, analyzedRepository, cancelAnalysis, claimAnalysis, commitAnalysis, enqueueAnalysis, invalidateAnalysis, setAnalysisPaused, useCustomAnalysis } from './analysis';

const details = {
  version: 1 as const, generated_at: '2026-09-28T12:00:00Z', repository_pushed_at: '2026-09-01',
  model: 'test', sources: [], summary: 'Chinese overview', problem: null, features: [], scenarios: [],
  architecture: null, quickstart: [], deployment: null, cost: null, maintenance: null,
  software_forms: ['cli' as const], platforms: ['Windows'], tags: [], deployment_modes: [],
};
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  mocks.data = emptyData();
  mocks.data.channels.push(makeChannel());
  mocks.state.user.id = 123; mocks.state.githubToken = 'test';
  mocks.state.aiConfigs[0].model = 'test';
  mocks.state.repositories = [];
  mocks.state.updateRepository.mockReset().mockImplementation((repo: Repository) => {
    mocks.state.repositories = mocks.state.repositories.map(item => item.id === repo.id ? repo : item);
  });
  mocks.analyze.mockReset().mockResolvedValue(details);
  mocks.readme.mockReset().mockResolvedValue({ content: '# README', retrievedAt: '2026-09-28' });
  useCustomDiscovery.setState({ account: '123', data: mocks.data });
  useCustomAnalysis.setState({ account: '123', items: [], paused: false, running: false, issue: null, pausedChannels: {}, issuesByChannel: {} });
  await initializeRepositoryAnalysisAssets('123', []);
});
afterEach(async () => {
  cancelAnalysis();
  await waitFor(() => expect(useCustomAnalysis.getState().running).toBe(false));
  vi.unstubAllGlobals();
});
describe('custom content analysis', () => {
  it('uses explicitly edited HTTP retry model without treating it as an in-flight configuration change', async () => {
    enqueueAnalysis(makeChannel(), [makeRepo()], { force: true, retry: {
      config: { ...mocks.state.aiConfigs[0], name: 'Retry', model: 'replacement-model', isActive: true }, parentId: 'original-failure',
    } });
    await waitFor(() => expect(useCustomAnalysis.getState().running).toBe(false));
    expect(mocks.analyze).toHaveBeenCalledOnce();
    expect(mocks.analyze.mock.calls[0][0].aiConfig.model).toBe('replacement-model');
    expect(useCustomAnalysis.getState().items[0].status).toBe('done');
  });

  it('retains the real error and last stage in the task journal instead of an auth-only JSON label', async () => {
    mocks.analyze.mockImplementationOnce(async options => {
      options.onStage('model');
      throw new Error('No content received from AI service');
    });
    enqueueAnalysis(makeChannel(), [makeRepo()], { force: true });
    await waitFor(() => expect(useCustomAnalysis.getState().running).toBe(false));
    const task = aiTaskJournal.snapshot().filter(task => task.kind === 'discovery-analysis').slice(-1)[0];
    expect(task.items[0].error).toContain('No content received');
    expect(task.items[0].error).not.toContain('"kind":"auth"');
    expect(task.phase).toBe('model');
    expect(task.items[0].phase).toBe('model');
  });
  it('cancels active and queued projects on deletion and rejects a late model result', async () => {
    let resolve!: (value: typeof details) => void;
    mocks.analyze.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const repo = makeRepo();
    enqueueAnalysis(makeChannel(), [repo, makeRepo(2)]);
    await waitFor(() => expect(mocks.analyze).toHaveBeenCalledOnce());
    await deleteRepositoryAnalysisAssets('123', [1, 2]);
    expect(mocks.analyze.mock.calls[0][0].signal.aborted).toBe(true);
    resolve(details);
    await waitFor(() => expect(useCustomAnalysis.getState().running).toBe(false));
    expect(mocks.analyze).toHaveBeenCalledOnce();
    expect(hasRepositoryAnalysisAsset('123', repo, 'zh')).toBe(false);
    expect(useCustomAnalysis.getState().items.every(item => item.status === 'cancelled')).toBe(true);
    expect(analyzedRepository(repo, mocks.data, 'zh').ai_details).toBeUndefined();
  });
  it.each([0, 2, 30])('clamps a custom automatic limit of %s to 1-10', async limit => {
    mocks.data.channels[0].autoAnalysisLimit = limit;
    enqueueAnalysis(makeChannel(), Array.from({ length: 20 }, (_, index) => makeRepo(index + 1)), { auto: true });
    await waitFor(() => expect(useCustomAnalysis.getState().running).toBe(false));
    expect(mocks.analyze).toHaveBeenCalledTimes(Math.min(10, Math.max(1, limit)));
  });
  it('reads builtin automatic limits and skips stale shared assets before applying the limit', async () => {
    const repo = makeRepo();
    await saveRepositoryAnalysisAsset('123', repo, 'en', mocks.state.aiConfigs[0] as never, details);
    mocks.state.aiConfigs[0].model = 'new';
    mocks.data.builtinPreferences = { trending: { autoAnalyze: true, autoAnalysisLimit: 2 } };
    enqueueAnalysis({ id: 'builtin:trending', revision: 1 }, [repo, makeRepo(2), makeRepo(3), makeRepo(4)], { auto: true, force: true });
    await waitFor(() => expect(useCustomAnalysis.getState().running).toBe(false));
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    expect(mocks.analyze.mock.calls.map(([options]) => options.repository.id)).toEqual([2, 3]);
    expect(hasRepositoryAnalysisAsset('123', repo, 'zh')).toBe(true);
  });
  it('updates an already-starred repository after async discovery success while retaining concurrent personal edits', async () => {
    let resolve!: (value: typeof details) => void;
    mocks.analyze.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const repo = makeRepo();
    enqueueAnalysis(makeChannel(), [repo]);
    await waitFor(() => expect(mocks.analyze).toHaveBeenCalledOnce());
    mocks.state.repositories = [{ ...repo, description: 'Original', custom_description: 'Personal', custom_category: 'Manual' }];
    resolve(details);
    await waitFor(() => expect(useCustomAnalysis.getState().running).toBe(false));
    expect(mocks.state.repositories[0]).toMatchObject({ ai_summary: details.summary, ai_details: details,
      description: 'Original', custom_description: 'Personal', custom_category: 'Manual' });
  });
  it('runs another channel while the first channel is paused, and cancels only the requested channel', async () => {
    const first = makeChannel(), second = { ...makeChannel(), id: 'custom:second' as const };
    mocks.data.channels.push(second);
    setAnalysisPaused(first.id, true);
    enqueueAnalysis(first, [makeRepo(1)]); enqueueAnalysis(second, [makeRepo(2)]);
    await waitFor(() => expect(useCustomAnalysis.getState().items.find(item => item.channelId === second.id)?.status).toBe('done'));
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    cancelAnalysis(first.id);
    expect(useCustomAnalysis.getState().items.find(item => item.channelId === first.id)?.status).toBe('cancelled');
    expect(useCustomAnalysis.getState().items.find(item => item.channelId === second.id)?.status).toBe('done');
  });
  it('invalidates cache when model, endpoint or prompt identity changes', () => {
    const repo = makeRepo();
    const key = analysisKey(repo, 'zh');
    mocks.state.aiConfigs[0].model = 'other-model';
    expect(analysisKey(repo, 'zh')).not.toBe(key);
    const config = { ...mocks.state.aiConfigs[0], isActive: true, name: 'test' };
    expect(analysisKey(repo, 'zh', { ...config, baseUrl: 'https://other.example' })).not.toBe(analysisKey(repo, 'zh', config));
    expect(key).not.toContain('https://ai.test');
  });

  it('falls back to account-scoped other-language successes and rejects unscoped list snapshots', () => {
    const repo = { ...makeRepo(), ai_summary: 'Old account summary', ai_details: details, analyzed_at: details.generated_at };
    mocks.data.analyses = { [analysisKey(repo, 'zh')]: { status: 'done', details, channelId: makeChannel().id, revision: 1, updatedAt: Date.now() } };
    expect(analyzedRepository(repo, mocks.data, 'zh').ai_summary).toBe(details.summary);
    expect(analyzedRepository(repo, mocks.data, 'en').ai_summary).toBe(details.summary);
    expect(analyzedRepository(repo, emptyData(), 'zh').ai_details).toBeUndefined();
    expect(analyzedRepository(repo, emptyData(), 'zh').description).toBe(repo.description);
  });

  it('waits for a competing live lease instead of claiming completion, and can cancel the wait', async () => {
    const channel = makeChannel(), repo = makeRepo();
    claimAnalysis(mocks.data, { key: analysisKey(repo, 'zh'), channelId: channel.id, revision: channel.revision, force: false }, 'other');
    enqueueAnalysis(channel, [repo]);
    await waitFor(() => expect(useCustomAnalysis.getState().items[0]?.status).toBe('waiting'));
    expect(mocks.analyze).not.toHaveBeenCalled();
    cancelAnalysis();
    await waitFor(() => expect(useCustomAnalysis.getState().running).toBe(false));
    expect(useCustomAnalysis.getState().items[0].status).toBe('cancelled');
  });

  it('does not commit analysis under an outdated model identity', async () => {
    let resolve!: (value: typeof details) => void;
    mocks.analyze.mockImplementation(() => new Promise(r => { resolve = r; }));
    const key = analysisKey(makeRepo(), 'zh');
    enqueueAnalysis(makeChannel(), [makeRepo()]);
    await waitFor(() => expect(mocks.analyze).toHaveBeenCalledOnce());
    mocks.state.aiConfigs[0].model = 'different';
    resolve(details);
    await waitFor(() => expect(useCustomAnalysis.getState().running).toBe(false));
    expect(mocks.data.analyses?.[key].details).toBeUndefined();
    expect(useCustomAnalysis.getState().items[0].status).toBe('cancelled');
  });
  it('caps automatic work at ten unique projects and does not expose credentials in UI state', async () => {
    enqueueAnalysis(makeChannel(), Array.from({ length: 40 }, (_, i) => makeRepo(i + 1)), { auto: true });
    await waitFor(() => expect(useCustomAnalysis.getState().running).toBe(false));
    expect(mocks.analyze).toHaveBeenCalledTimes(10);
    expect(Object.keys(mocks.data.analyses || {})).toHaveLength(10);
    expect(useCustomAnalysis.getState().items[0]).not.toHaveProperty('token');
    expect(mocks.data.channels[0].recommended).toEqual({});
    expect(mocks.data.editions).toEqual([]);
  });
  it('reuses successful analysis across channels and keeps old content on a failed reanalysis', async () => {
    const channel = makeChannel(), repo = makeRepo();
    enqueueAnalysis(channel, [repo]);
    await waitFor(() => expect(useCustomAnalysis.getState().running).toBe(false));
    const second = { ...makeChannel(), id: 'custom:second' as const };
    mocks.data.channels.push(second);
    enqueueAnalysis(second, [repo]);
    await waitFor(() => expect(useCustomAnalysis.getState().running).toBe(false));
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(analyzedRepository(repo, mocks.data, 'zh').ai_summary).toBe('Chinese overview');
    expect(analyzedRepository(repo, mocks.data, 'en').ai_summary).toBe(details.summary);
    mocks.analyze.mockRejectedValueOnce(new DOMException('Deadline', 'TimeoutError'));
    enqueueAnalysis(channel, [repo], { force: true });
    await waitFor(() => expect(useCustomAnalysis.getState().running).toBe(false));
    expect(mocks.data.analyses?.[analysisKey(repo, 'zh')].status).toBe('failed');
    expect(analyzedRepository(repo, mocks.data, 'zh').ai_details).toEqual(details);
  });
  it('does not publish late work after account or revision changes', async () => {
    let resolve!: (value: typeof details) => void;
    mocks.analyze.mockImplementation(() => new Promise(r => { resolve = r; }));
    enqueueAnalysis(makeChannel(), [makeRepo()]);
    await waitFor(() => expect(mocks.analyze).toHaveBeenCalled());
    mocks.state.user.id = 456;
    invalidateAnalysis();
    resolve(details);
    await waitFor(() => expect(useCustomAnalysis.getState().running).toBe(false));
    expect(mocks.data.analyses?.[analysisKey(makeRepo(), 'zh')].details).toBeUndefined();
  });
  it('cancels queued excluded candidates and supports pause/resume', async () => {
    setAnalysisPaused(makeChannel().id, true);
    enqueueAnalysis(makeChannel(), [makeRepo(1), makeRepo(2)]);
    const task = aiTaskJournal.snapshot().slice(-1)[0];
    expect(task).toMatchObject({ kind: 'discovery-analysis', channelId: makeChannel().id, state: 'paused' });
    expect(aiTaskJournal.supports(task.id, 'stop')).toBe(true);
    cancelAnalysis(makeChannel().id, new Set([2]));
    expect(useCustomAnalysis.getState().pausedChannels[makeChannel().id]).toBe(true);
    expect(mocks.analyze).not.toHaveBeenCalled();
    aiTaskJournal.control(task.id, 'resume');
    await waitFor(() => expect(useCustomAnalysis.getState().running).toBe(false));
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(useCustomAnalysis.getState().items.find(i => i.repo.id === 2)?.status).toBe('cancelled');
    expect(aiTaskJournal.live(task.id)).toBe(false);
    expect(aiTaskJournal.snapshot().find(item => item.id === task.id)).toMatchObject({
      state: 'partial', items: [{ state: 'complete' }, { state: 'canceled' }],
    });
  });
  it('rejects competing leases, stale owners, and expired commits', () => {
    const work = { key: 'key', channelId: 'custom:test', revision: 1, force: false };
    expect(claimAnalysis(mocks.data, work, 'a')).toBe(true);
    expect(claimAnalysis(mocks.data, work, 'b')).toBe(false);
    expect(commitAnalysis(mocks.data, 'key', 'b', { status: 'done', details })).toBe(false);
    mocks.data.analyses!.key.expires = Date.now() - 1;
    expect(commitAnalysis(mocks.data, 'key', 'a', { status: 'done', details })).toBe(false);
    expect(claimAnalysis(mocks.data, work, 'b')).toBe(true);
    expect(commitAnalysis(mocks.data, 'key', 'b', { status: 'done', details })).toBe(true);
  });
});
