import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRepositoryDetailAnalysisJob } from './useRepositoryDetailAnalysisJob';
import type { Repository, AIConfig } from '../../../types';

const mocks = vi.hoisted(() => ({ analyze: vi.fn(), update: vi.fn(), getState: vi.fn(), subscribe: vi.fn(), sync: vi.fn(), clearCache: vi.fn() }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: mocks.getState, subscribe: mocks.subscribe } }));
vi.mock('../../../services/repositoryDetailAnalysis', () => ({ analyzeRepositoryDetails: mocks.analyze }));
vi.mock('../../../services/repositoryDetailReadme', () => ({ clearRepositoryDetailReadmeCache: mocks.clearCache }));
vi.mock('../../../services/autoSync', () => ({ forceSyncToBackend: mocks.sync }));
const repo = { id: 1, full_name: 'owner/repo', ai_details: { version: 1, problem: 'Previous success' } } as Repository;
const createState = () => ({
  user: { id: 1 },
  repositories: [repo, { ...repo, id: 2 }], aiConfigs: [{ id: 'config', model: 'mock', apiKey: 'secret', baseUrl: 'https://example.com' } as AIConfig],
  activeAIConfig: 'config', language: 'en', githubToken: 'mock', updateRepository: mocks.update,
});
let state = createState();
describe('detail analysis job', () => {
  beforeEach(() => { vi.clearAllMocks(); state = createState(); mocks.subscribe.mockReturnValue(vi.fn()); mocks.sync.mockResolvedValue(undefined); mocks.getState.mockImplementation(() => state); mocks.analyze.mockResolvedValue({ version: 1, problem: 'New success' }); });
  it('is opt-in and merges successful results into the latest repository', async () => {
    const { result } = renderHook(useRepositoryDetailAnalysisJob);
    expect(mocks.analyze).not.toHaveBeenCalled();
    state.repositories[0] = { ...repo, custom_description: 'Concurrent edit' };
    await act(() => result.current.run([repo]));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ custom_description: 'Concurrent edit', ai_details: { version: 1, problem: 'New success' } }));
  });
  it('retains old success after failure and offers retry', async () => {
    mocks.analyze.mockRejectedValueOnce(new Error('invalid model result'));
    const { result } = renderHook(useRepositoryDetailAnalysisJob);
    await act(() => result.current.run([repo]));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(result.current.failures).toEqual([repo]);
    await act(() => result.current.run(result.current.failures));
    expect(mocks.update).toHaveBeenCalledOnce();
  });
  it('pauses between repositories, resumes, and deduplicates the queue', async () => {
    let finish!: (value: unknown) => void;
    mocks.analyze.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(useRepositoryDetailAnalysisJob);
    let run!: Promise<void>;
    act(() => { run = result.current.run([repo, repo, state.repositories[1]]); });
    act(() => result.current.pause());
    await act(async () => { finish({ version: 1 }); await Promise.resolve(); });
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(result.current.paused).toBe(true);
    act(() => result.current.resume());
    await act(() => run);
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    expect(result.current.progress).toEqual({ current: 2, total: 2 });
  });
  it('stops in-flight work without saving late results or starting the next repo', async () => {
    let finish!: (value: unknown) => void;
    mocks.analyze.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(useRepositoryDetailAnalysisJob);
    let run!: Promise<void>;
    act(() => { run = result.current.run(state.repositories); });
    act(() => result.current.stop());
    expect(mocks.analyze.mock.calls[0][0].signal.aborted).toBe(true);
    await act(async () => { finish({ version: 1 }); await run; });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.analyze).toHaveBeenCalledOnce();
    await waitFor(() => expect(result.current.running).toBe(false));
  });
  it('does not resurrect repositories removed during analysis', async () => {
    mocks.analyze.mockImplementationOnce(async () => { state.repositories = []; return { version: 1 }; });
    const { result } = renderHook(useRepositoryDetailAnalysisJob);
    await act(() => result.current.run([repo]));
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('aborts on unmount and preserves earlier successful data', async () => {
    let finish!: (value: unknown) => void;
    mocks.analyze.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result, unmount } = renderHook(useRepositoryDetailAnalysisJob);
    let run!: Promise<void>;
    act(() => { run = result.current.run([repo]); });
    unmount();
    expect(mocks.analyze.mock.calls[0][0].signal.aborted).toBe(true);
    await act(async () => { finish({ version: 1 }); await run; });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('shares a single flight across toolbar and panel, including controls and progress', async () => {
    let finish!: (value: unknown) => void;
    mocks.analyze.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = renderHook(useRepositoryDetailAnalysisJob);
    const second = renderHook(useRepositoryDetailAnalysisJob);
    let run!: Promise<void>;
    act(() => { run = first.result.current.run([repo]); });
    expect(second.result.current.running).toBe(true);
    await act(() => second.result.current.run([repo]));
    expect(mocks.analyze).toHaveBeenCalledOnce();
    first.unmount();
    expect(mocks.analyze.mock.calls[0][0].signal.aborted).toBe(false);
    await act(async () => { finish({ version: 1 }); await run; });
    expect(second.result.current.progress.current).toBe(1);
  });
  it('aborts on account switch and never writes a late result into the same repository ID', async () => {
    let finish!: (value: unknown) => void;
    mocks.analyze.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(useRepositoryDetailAnalysisJob);
    let run!: Promise<void>;
    act(() => { run = result.current.run(state.repositories, 1); });
    const previous = state;
    state = { ...createState(), user: { id: 2 } };
    act(() => mocks.subscribe.mock.calls[0][0](state, previous));
    expect(mocks.analyze.mock.calls[0][0].signal.aborted).toBe(true);
    await act(async () => { finish({ version: 1 }); await run; });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.clearCache).toHaveBeenCalledOnce();
    await act(() => result.current.run([repo], 1));
    expect(mocks.analyze).toHaveBeenCalledOnce();
  });
  it('reports sync failure separately while retaining successful local analysis', async () => {
    mocks.sync.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(useRepositoryDetailAnalysisJob);
    await act(() => result.current.run([repo]));
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.sync).toHaveBeenCalledWith({ reportFailures: true });
    expect(result.current.failures).toEqual([]);
    expect(result.current.syncFailed).toBe(true);
  });
  it('snapshots the chosen configuration for the complete batch', async () => {
    const alternate = { ...state.aiConfigs[0], id: 'alternate', model: 'selected-model' };
    state.aiConfigs.push(alternate);
    mocks.analyze.mockImplementationOnce(async () => {
      alternate.model = 'changed-mid-batch';
      return { version: 1 };
    });
    const { result } = renderHook(useRepositoryDetailAnalysisJob);
    await act(() => result.current.run(state.repositories, 1, 'alternate'));
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    expect(mocks.analyze.mock.calls[0][0].aiConfig.model).toBe('selected-model');
    expect(mocks.analyze.mock.calls[1][0].aiConfig.model).toBe('selected-model');
    expect(state.activeAIConfig).toBe('config');
  });
  it('cannot resume an old paused batch after switching away and back to the original account', async () => {
    let finish!: (value: unknown) => void;
    mocks.analyze.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(useRepositoryDetailAnalysisJob);
    let run!: Promise<void>;
    act(() => { run = result.current.run(state.repositories); });
    act(() => result.current.pause());
    const original = state;
    state = { ...createState(), user: { id: 2 } };
    act(() => mocks.subscribe.mock.calls[0][0](state, original));
    const other = state;
    state = original;
    act(() => mocks.subscribe.mock.calls[0][0](state, other));
    act(() => result.current.resume());
    await act(async () => { finish({ version: 1 }); await run; });
    expect(mocks.analyze).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
