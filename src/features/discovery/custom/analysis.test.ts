import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { emptyData, type CustomDiscoveryData } from './model';
import { makeChannel, makeRepo } from './fixtures.test-support';
const mocks = vi.hoisted(() => ({
  state: { user: { id: 123 }, githubToken: 'test', language: 'zh', aiConfigs: [{ id: 'ai', apiKey: 'key', model: 'test', baseUrl: 'https://ai.test' }], activeAIConfig: 'ai' },
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
import { analysisKey, analyzedRepository, cancelAnalysis, claimAnalysis, commitAnalysis, enqueueAnalysis, invalidateAnalysis, useCustomAnalysis } from './analysis';

const details = {
  version: 1 as const, generated_at: '2026-09-28T12:00:00Z', repository_pushed_at: '2026-09-01',
  model: 'test', sources: [], summary: 'Chinese overview', problem: null, features: [], scenarios: [],
  architecture: null, quickstart: [], deployment: null, cost: null, maintenance: null,
  software_forms: ['cli' as const], platforms: ['Windows'],
};
beforeEach(() => {
  mocks.data = emptyData();
  mocks.data.channels.push(makeChannel());
  mocks.state.user.id = 123; mocks.state.githubToken = 'test';
  mocks.state.aiConfigs[0].model = 'test';
  mocks.analyze.mockReset().mockResolvedValue(details);
  mocks.readme.mockReset().mockResolvedValue({ content: '# README', retrievedAt: '2026-09-28' });
  useCustomDiscovery.setState({ account: '123', data: mocks.data });
  useCustomAnalysis.setState({ account: '123', items: [], paused: false, running: false, issue: null });
});
afterEach(async () => {
  cancelAnalysis();
  await waitFor(() => expect(useCustomAnalysis.getState().running).toBe(false));
});
describe('custom content analysis', () => {
  it('invalidates cache when model, endpoint or prompt identity changes', () => {
    const repo = makeRepo();
    const key = analysisKey(repo, 'zh');
    mocks.state.aiConfigs[0].model = 'other-model';
    expect(analysisKey(repo, 'zh')).not.toBe(key);
    const config = { ...mocks.state.aiConfigs[0], isActive: true, name: 'test' };
    expect(analysisKey(repo, 'zh', { ...config, baseUrl: 'https://other.example' })).not.toBe(analysisKey(repo, 'zh', config));
    expect(key).not.toContain('https://ai.test');
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
    expect(analyzedRepository(repo, mocks.data, 'en').ai_summary).toBeUndefined();
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
    useCustomAnalysis.setState({ paused: true });
    enqueueAnalysis(makeChannel(), [makeRepo(1), makeRepo(2)]);
    const task = aiTaskJournal.snapshot().slice(-1)[0];
    expect(task).toMatchObject({ kind: 'discovery-analysis', channelId: makeChannel().id, state: 'paused' });
    expect(aiTaskJournal.supports(task.id, 'stop')).toBe(true);
    cancelAnalysis(makeChannel().id, new Set([2]));
    expect(useCustomAnalysis.getState().paused).toBe(true);
    expect(mocks.analyze).not.toHaveBeenCalled();
    aiTaskJournal.control(task.id, 'resume');
    await waitFor(() => expect(useCustomAnalysis.getState().running).toBe(false));
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(useCustomAnalysis.getState().items.find(i => i.repo.id === 2)?.status).toBe('cancelled');
    expect(aiTaskJournal.live(task.id)).toBe(false);
    expect(aiTaskJournal.snapshot().find(item => item.id === task.id)).toMatchObject({
      state: 'interrupted', items: [{ state: 'complete' }, { state: 'pending' }],
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
