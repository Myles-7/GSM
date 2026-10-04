import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig, Gist } from '../../../types';
import { applyGistAnalysisFailure, applyGistAnalysisSuccess, useGistActions } from './useGistActions';
import { aiTaskJournal } from '../../../services/aiTaskJournal';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  forceSyncToBackend: vi.fn(),
  getGistForAnalysis: vi.fn(),
  getGistContentPreview: vi.fn(),
  unstarGist: vi.fn(),
  deleteGist: vi.fn(),
  getGistFileRaw: vi.fn(),
  analyzeGist: vi.fn(),
  searchGists: vi.fn(),
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: mocks.useAppStore,
}));

vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));

vi.mock('../../../services/autoSync', () => ({
  forceSyncToBackend: mocks.forceSyncToBackend,
}));

vi.mock('../../../services/githubApiFactory', () => ({
  createGitHubApiService: () => ({
    getGistForAnalysis: mocks.getGistForAnalysis,
    getGistContentPreview: mocks.getGistContentPreview,
    unstarGist: mocks.unstarGist,
    deleteGist: mocks.deleteGist,
    getGistFileRaw: mocks.getGistFileRaw,
  }),
}));

vi.mock('../../../services/aiService', () => ({
  AIService: class {
    analyzeGist = mocks.analyzeGist;
    searchGistsWithReranking = mocks.searchGists;
  },
}));

const createStoreState = () => ({
  user: { id: 1, login: 'me', avatar_url: 'https://example.com/me.png' },
  githubToken: 'github-token' as string | null,
  gists: [] as Gist[],
  starredGists: [] as Gist[],
  gistSearchFilters: { query: '' },
  gistSearchResults: [] as Gist[],
  selectedGistCategory: 'all' as const,
  aiConfigs: [{
    id: 'ai-config',
    name: 'Test AI',
    baseUrl: 'https://example.com/v1',
    apiKey: 'ai-key',
    model: 'ai-model',
  }] as AIConfig[],
  activeAIConfig: 'ai-config',
  language: 'zh' as const,
  setGists: vi.fn(),
  setStarredGists: vi.fn(),
  updateGist: vi.fn(),
  deleteGist: vi.fn(),
  setGistSearchFilters: vi.fn(),
  setGistSearchResults: vi.fn(),
  setSelectedGistCategory: vi.fn(),
  setAnalyzingGist: vi.fn((id: string, analyzing: boolean) => {
    if (analyzing) storeState.analyzingGistIds.add(id);
    else storeState.analyzingGistIds.delete(id);
  }),
  analyzingGistIds: new Set<string>(),
});

let storeState = createStoreState();
const mockUseAppStore = vi.mocked(mocks.useAppStore);
mockUseAppStore.mockImplementation((selector?: (state: typeof storeState) => unknown) =>
  selector ? selector(storeState) : storeState);
(mockUseAppStore as unknown as { getState: () => typeof storeState }).getState = () => storeState;
const storeListeners = new Set<(state: typeof storeState) => void>();
Object.assign(mockUseAppStore, {
  subscribe: (listener: (state: typeof storeState) => void) => {
    storeListeners.add(listener);
    return () => storeListeners.delete(listener);
  },
});
const notifyStore = () => {
  for (const listener of storeListeners) listener(storeState);
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const gist: Gist = {
  id: 'gist-1',
  description: 'A gist',
  public: true,
  html_url: 'https://gist.github.com/me/gist-1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  comments: 0,
  owner: { login: 'me', avatar_url: 'https://example.com/me.png' },
  files: {
    'a.ts': { filename: 'a.ts', type: 'text/plain', language: 'TypeScript', size: 10, content: 'const a = 1;' },
  },
};

const gistDetail: Gist = {
  ...gist,
  files: {
    'a.ts': { filename: 'a.ts', type: 'text/plain', language: 'TypeScript', size: 20, content: 'const a = 1; // full' },
  },
};

describe('useGistActions card actions', () => {
  it('cancels superseded search and rejects late results from the old query', async () => {
    const old = deferred<Gist[]>();
    mocks.searchGists.mockReturnValueOnce(old.promise).mockResolvedValueOnce([gist]);
    const hook = renderHook(useGistActions);
    const onReranked = vi.fn();
    let first!: Promise<void>;
    await act(async () => { first = hook.result.current.aiSearch('old query', [gist], onReranked); });
    const oldSignal = mocks.searchGists.mock.calls[0][2] as AbortSignal;
    await act(async () => { await hook.result.current.aiSearch('new query', [gist], onReranked); });
    expect(oldSignal.aborted).toBe(true);
    await act(async () => { old.resolve([]); await first; });
    expect(storeState.setGistSearchResults).toHaveBeenCalledTimes(1);
    expect(storeState.setGistSearchResults).toHaveBeenLastCalledWith([gist]);
    expect(storeState.setGistSearchFilters).toHaveBeenLastCalledWith({ query: 'new query' });
    expect(onReranked).toHaveBeenCalledTimes(1);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
    storeState.gists = [gist];
  });

  describe('analyzeOne', () => {
    it('validates token, config presence and completeness in order before analyzing', async () => {
      storeState.githubToken = null;
      const { result, rerender } = renderHook(() => useGistActions());
      await act(async () => { await result.current.analyzeOne(gist); });
      expect(mocks.toast).toHaveBeenCalledTimes(1);
      expect(mocks.toast).toHaveBeenCalledWith('GitHub token 未找到，请重新登录。', 'error');

      storeState.githubToken = 'github-token';
      storeState.aiConfigs = [];
      rerender();
      await act(async () => { await result.current.analyzeOne(gist); });
      expect(mocks.toast).toHaveBeenLastCalledWith('请先在设置中配置AI服务。', 'error');

      storeState.aiConfigs = [{ id: 'ai-config', name: 'Broken', baseUrl: '', apiKey: '', model: '', isActive: true }];
      rerender();
      await act(async () => { await result.current.analyzeOne(gist); });
      expect(mocks.toast).toHaveBeenLastCalledWith('AI服务配置不完整，请检查设置。', 'error');
      expect(mocks.getGistForAnalysis).not.toHaveBeenCalled();
    });

    it('asks for confirmation when the gist was analyzed before and aborts on cancel', async () => {
      storeState.gists = [];
      const analyzedGist = { ...gist, analyzed_at: '2026-01-03T00:00:00.000Z' };
      mocks.confirm.mockResolvedValue(false);
      const { result } = renderHook(() => useGistActions());
      await act(async () => { await result.current.analyzeOne(analyzedGist); });
      expect(mocks.confirm).toHaveBeenCalledWith(
        '重新分析确认',
        '此 gist 已经分析过，是否覆盖现有摘要？',
        { type: 'warning' },
      );
      expect(mocks.getGistForAnalysis).not.toHaveBeenCalled();
      expect(storeState.setAnalyzingGist).not.toHaveBeenCalled();
    });

    it('analyzes fetched detail but patches only analysis fields on the current record', async () => {
      mocks.getGistForAnalysis.mockResolvedValue(gistDetail);
      mocks.getGistContentPreview.mockReturnValue('preview');
      mocks.analyzeGist.mockResolvedValue('  summary text  ');
      const { result } = renderHook(() => useGistActions());
      await act(async () => { await result.current.analyzeOne(gist); });

      expect(mocks.confirm).not.toHaveBeenCalled();
      const signal = mocks.getGistForAnalysis.mock.calls[0][2] as AbortSignal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(mocks.analyzeGist).toHaveBeenCalledWith(gistDetail, 'preview', signal);
      expect(storeState.setAnalyzingGist).toHaveBeenCalledWith('gist-1', true);
      expect(storeState.setAnalyzingGist).toHaveBeenLastCalledWith('gist-1', false);
      expect(storeState.updateGist).toHaveBeenCalledTimes(1);
      const patch = storeState.updateGist.mock.calls[0][0] as Gist;
      expect(patch.ai_summary).toBe('summary text');
      expect(patch.analyzed_at).toEqual(expect.any(String));
      expect(patch.analysis_failed).toBe(false);
      expect(patch.analysis_error).toBeUndefined();
      expect(patch.files).toBe(gist.files);
      expect(mocks.toast).toHaveBeenCalledWith('Gist AI分析完成', 'success');
      expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
    });

    it('patches failure fields and toasts on analysis error', async () => {
      mocks.getGistForAnalysis.mockRejectedValue(new Error('boom'));
      const { result } = renderHook(() => useGistActions());
      await act(async () => { await result.current.analyzeOne(gist); });

      expect(storeState.updateGist).toHaveBeenCalledTimes(1);
      const patch = storeState.updateGist.mock.calls[0][0] as Gist;
      expect(patch.analyzed_at).toEqual(expect.any(String));
      expect(patch.analysis_failed).toBe(true);
      expect(patch.analysis_error).toBe('boom');
      expect(mocks.toast).toHaveBeenCalledWith('Gist AI分析失败', 'error');
      expect(storeState.setAnalyzingGist).toHaveBeenLastCalledWith('gist-1', false);
    });
  });

  describe('analysis lifecycle', () => {
    beforeEach(() => {
      mocks.getGistForAnalysis.mockReset().mockResolvedValue(gistDetail);
      mocks.analyzeGist.mockReset().mockResolvedValue('summary');
      mocks.confirm.mockReset().mockResolvedValue(true);
      storeState.gistSearchResults = [gist, { ...gist, id: 'gist-2' }];
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    for (const mode of ['single', 'batch'] as const) {
      const start = (actions: ReturnType<typeof useGistActions>) => mode === 'single'
        ? actions.analyzeOne(gist) : actions.analyzeVisibleGists();

      for (const outcome of ['success', 'failure'] as const) {
        it(`${mode}: skips ${outcome} writes when the gist was deleted while AI was pending`, async () => {
          const pending = deferred<string>();
          storeState.gistSearchResults = [gist];
          mocks.analyzeGist.mockReturnValue(pending.promise);
          const { result } = renderHook(() => useGistActions());
          let work!: Promise<void>;
          await act(async () => { work = start(result.current); });
          act(() => {
            storeState.gists = [];
            storeState.starredGists = [];
            storeState.gistSearchResults = [];
            notifyStore();
          });
          await act(async () => {
            if (outcome === 'success') pending.resolve('late summary');
            else pending.reject(new Error('late failure'));
            await work;
          });
          expect(storeState.updateGist).not.toHaveBeenCalled();
          expect(storeState.gists).toEqual([]);
          expect(storeState.analyzingGistIds.size).toBe(0);
          if (mode === 'single') expect(mocks.toast).not.toHaveBeenCalled();
        });

        it.each(['gists', 'starredGists', 'gistSearchResults'] as const)(
          `${mode}: preserves newer edits in %s on ${outcome}`,
          async collection => {
            const pending = deferred<string>();
            storeState.gists = collection === 'gists' ? [gist] : [];
            storeState.starredGists = collection === 'starredGists' ? [gist] : [];
            storeState.gistSearchResults = [gist];
            mocks.analyzeGist.mockReturnValue(pending.promise);
            const { result } = renderHook(() => useGistActions());
            let work!: Promise<void>;
            await act(async () => { work = start(result.current); });
            const edited: Gist = {
              ...gist,
              description: 'Newer description',
              starred: true,
              comments: 7,
              last_edited: '2026-09-29T00:00:00.000Z',
              ai_summary: 'Current saved summary',
              files: {
                'new.ts': { filename: 'new.ts', type: 'text/plain', language: 'TypeScript', size: 9, content: 'new edit' },
              },
            };
            act(() => { storeState[collection] = [edited]; notifyStore(); });
            await act(async () => {
              if (outcome === 'success') pending.resolve('  new analysis  ');
              else pending.reject(new Error('analysis failure'));
              await work;
            });
            expect(storeState.updateGist).toHaveBeenCalledTimes(1);
            expect(storeState.updateGist).toHaveBeenCalledWith({
              ...edited,
              analyzed_at: expect.any(String),
              ...(outcome === 'success'
                ? { ai_summary: 'new analysis', analysis_failed: false, analysis_error: undefined }
                : { analysis_failed: true, analysis_error: 'analysis failure' }),
            });
            expect(storeState.analyzingGistIds.size).toBe(0);
          },
        );
      }

      it.each(['account', 'token', 'config', 'active-config', 'logout', 'unmount'] as const)(
        `${mode}: aborts on %s and ignores late success without starting queued work`,
        async change => {
          const pending = deferred<string>();
          mocks.analyzeGist.mockReturnValue(pending.promise);
          const hook = renderHook(() => useGistActions());
          let work!: Promise<void>;
          await act(async () => { work = start(hook.result.current); });
          const signal = mocks.analyzeGist.mock.calls[0][2] as AbortSignal;
          expect(signal.aborted).toBe(false);
          act(() => {
            if (change === 'unmount') hook.unmount();
            else {
              if (change === 'account') storeState.user = { ...storeState.user, id: 2, login: 'other' };
              if (change === 'token') storeState.githubToken = 'new-token';
              if (change === 'config') storeState.aiConfigs = [{ ...storeState.aiConfigs[0], model: 'new-model' }];
              if (change === 'active-config') storeState.activeAIConfig = 'other-config';
              if (change === 'logout') storeState.githubToken = null;
              notifyStore();
            }
          });
          expect(signal.aborted).toBe(true);
          await act(async () => { await work; });
          expect(storeState.analyzingGistIds.size).toBe(0);
          if (change !== 'unmount') expect(hook.result.current.isAnalyzingAll).toBe(false);
          await act(async () => { pending.resolve('stale summary'); });
          expect(storeState.updateGist).not.toHaveBeenCalled();
          expect(mocks.toast).not.toHaveBeenCalled();
          expect(mocks.getGistForAnalysis).toHaveBeenCalledTimes(1);
        },
      );

      it(`${mode}: ignores a late failure after account A -> B -> A without a render`, async () => {
        const pending = deferred<string>();
        mocks.analyzeGist.mockReturnValue(pending.promise);
        const { result } = renderHook(() => useGistActions());
        let work!: Promise<void>;
        await act(async () => { work = start(result.current); });
        act(() => {
          storeState.githubToken = 'other-token';
          notifyStore();
          storeState.githubToken = 'github-token';
          notifyStore();
        });
        await act(async () => {
          pending.reject(new Error('late failure'));
          await work;
        });
        expect(storeState.updateGist).not.toHaveBeenCalled();
        expect(mocks.toast).not.toHaveBeenCalled();
      });

      it(`${mode}: rejects a stale confirmation before fetching`, async () => {
        const confirmation = deferred<boolean>();
        mocks.confirm.mockReturnValue(confirmation.promise);
        const { result } = renderHook(() => useGistActions());
        let work!: Promise<void>;
        await act(async () => {
          work = mode === 'single'
            ? result.current.analyzeOne({ ...gist, analyzed_at: '2026-01-03' })
            : result.current.analyzeVisibleGists();
        });
        act(() => {
          storeState.aiConfigs = [{ ...storeState.aiConfigs[0], model: 'changed' }];
          notifyStore();
        });
        await act(async () => {
          await work;
          confirmation.resolve(true);
        });
        expect(mocks.getGistForAnalysis).not.toHaveBeenCalled();
        expect(storeState.setAnalyzingGist).not.toHaveBeenCalled();
        expect(mocks.toast).not.toHaveBeenCalled();
      });

      it(`${mode}: aborts a hung read at the deadline and never starts AI on its late result`, async () => {
        vi.useFakeTimers();
        const read = deferred<Gist>();
        storeState.gistSearchResults = [gist];
        mocks.getGistForAnalysis.mockReturnValue(read.promise);
        const { result } = renderHook(() => useGistActions());
        let work!: Promise<void>;
        await act(async () => { work = start(result.current); });
        const signal = mocks.getGistForAnalysis.mock.calls[0][2] as AbortSignal;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(120_000);
          await work;
        });
        expect(signal.aborted).toBe(true);
        expect(storeState.updateGist).toHaveBeenCalledTimes(1);
        expect(storeState.updateGist).toHaveBeenCalledWith(expect.objectContaining({
          analysis_failed: true, analysis_error: expect.stringContaining('Request deadline exceeded'),
        }));
        expect(storeState.analyzingGistIds.size).toBe(0);
        expect(result.current.isAnalyzingAll).toBe(false);
        await act(async () => { read.resolve(gistDetail); });
        expect(mocks.analyzeGist).not.toHaveBeenCalled();
        expect(storeState.updateGist).toHaveBeenCalledTimes(1);
        await vi.runOnlyPendingTimersAsync(); // jsdom dispatches task-journal storage events asynchronously.
        expect(vi.getTimerCount()).toBe(0);
      });

      it(`${mode}: stops after a cancelled GitHub read even when the read ignores abort`, async () => {
        const read = deferred<Gist>();
        mocks.getGistForAnalysis.mockReturnValue(read.promise);
        const { result } = renderHook(() => useGistActions());
        let work!: Promise<void>;
        await act(async () => { work = start(result.current); });
        const signal = mocks.getGistForAnalysis.mock.calls[0][2] as AbortSignal;
        act(() => { storeState.githubToken = null; notifyStore(); });
        await act(async () => { await work; read.resolve(gistDetail); });
        expect(signal.aborted).toBe(true);
        expect(mocks.analyzeGist).not.toHaveBeenCalled();
        expect(storeState.updateGist).not.toHaveBeenCalled();
        expect(mocks.toast).not.toHaveBeenCalled();
      });

      it(`${mode}: bounds a hung AI provider and ignores its late success`, async () => {
        vi.useFakeTimers();
        const pending = deferred<string>();
        storeState.gistSearchResults = [gist];
        mocks.analyzeGist.mockReturnValue(pending.promise);
        const { result } = renderHook(() => useGistActions());
        let work!: Promise<void>;
        await act(async () => { work = start(result.current); });
        const signal = mocks.analyzeGist.mock.calls[0][2] as AbortSignal;
        await act(async () => { await vi.advanceTimersByTimeAsync(120_000); await work; });
        expect(signal.aborted).toBe(true);
        expect(storeState.updateGist).toHaveBeenCalledTimes(1);
        expect(storeState.updateGist).toHaveBeenCalledWith(expect.objectContaining({ analysis_failed: true }));
        expect(storeState.analyzingGistIds.size).toBe(0);
        await act(async () => { pending.resolve('too late'); });
        expect(storeState.updateGist).toHaveBeenCalledTimes(1);
        await vi.runOnlyPendingTimersAsync();
        expect(vi.getTimerCount()).toBe(0);
      });
    }

    it.each(['complete', 'account-change'] as const)('keeps hosted analysis after unmount but respects %s', async outcome => {
      const pending = deferred<string>();
      storeState.gistSearchResults = [gist];
      mocks.analyzeGist.mockReturnValue(pending.promise);
      const detachHost = aiTaskJournal.attachHost();
      const hook = renderHook(() => useGistActions());
      let work!: Promise<void>;
      try {
        await act(async () => { work = hook.result.current.analyzeVisibleGists(); });
        const signal = mocks.analyzeGist.mock.calls[0][2] as AbortSignal;
        act(() => hook.unmount());
        expect(signal.aborted).toBe(false);
        if (outcome === 'account-change') {
          act(() => { storeState.user = { ...storeState.user, id: 2, login: 'other' }; notifyStore(); });
          expect(signal.aborted).toBe(true);
        }
        await act(async () => { pending.resolve('background summary'); await work; });
        if (outcome === 'complete') expect(storeState.updateGist).toHaveBeenCalledWith(expect.objectContaining({ ai_summary: 'background summary' }));
        else expect(storeState.updateGist).not.toHaveBeenCalled();
        expect(storeState.analyzingGistIds.size).toBe(0);
        expect(storeListeners.size).toBe(0);
      } finally {
        pending.resolve('cleanup');
        if (work) await act(async () => { await work; });
        hook.unmount();
        detachHost();
      }
    });

    it('cancels all concurrent batch items without launching the next wave', async () => {
      const pending = deferred<string>();
      mocks.analyzeGist.mockReturnValue(pending.promise);
      storeState.aiConfigs = [{ ...storeState.aiConfigs[0], concurrency: 2 }];
      storeState.gistSearchResults.push({ ...gist, id: 'gist-3' });
      const { result, unmount } = renderHook(() => useGistActions());
      let work!: Promise<void>;
      await act(async () => { work = result.current.analyzeVisibleGists(); });
      expect(mocks.analyzeGist).toHaveBeenCalledTimes(2);
      act(() => unmount());
      await act(async () => { await work; pending.reject(new Error('late')); });
      for (const call of mocks.analyzeGist.mock.calls) expect((call[2] as AbortSignal).aborted).toBe(true);
      expect(mocks.getGistForAnalysis).toHaveBeenCalledTimes(2);
      expect(storeState.updateGist).not.toHaveBeenCalled();
      expect(mocks.toast).not.toHaveBeenCalled();
      expect(storeState.analyzingGistIds.size).toBe(0);
    });

    it('does not let old cleanup clear a new task marker across hook instances', async () => {
      const oldResult = deferred<string>();
      const newResult = deferred<string>();
      mocks.analyzeGist.mockReturnValueOnce(oldResult.promise).mockReturnValueOnce(newResult.promise);
      const first = renderHook(() => useGistActions());
      const second = renderHook(() => useGistActions());
      let oldWork!: Promise<void>;
      let newWork!: Promise<void>;
      await act(async () => { oldWork = first.result.current.analyzeOne(gist); });
      act(() => {
        storeState.githubToken = 'new-token';
        notifyStore();
      });
      second.rerender();
      await act(async () => { newWork = second.result.current.analyzeOne(gist); });
      await act(async () => { await oldWork; oldResult.reject(new Error('late failure')); });
      expect(storeState.analyzingGistIds.has(gist.id)).toBe(true);
      expect(storeState.setAnalyzingGist).toHaveBeenLastCalledWith(gist.id, true);
      expect(storeState.updateGist).not.toHaveBeenCalled();
      await act(async () => { newResult.resolve('new summary'); await newWork; });
      expect(storeState.updateGist).toHaveBeenCalledTimes(1);
      expect(storeState.updateGist).toHaveBeenCalledWith(expect.objectContaining({ ai_summary: 'new summary' }));
      expect(storeState.analyzingGistIds.size).toBe(0);
    });

    it('retains a new batch busy flag when an older batch unwinds', async () => {
      const pending = deferred<string>();
      mocks.analyzeGist.mockReturnValue(pending.promise);
      const hook = renderHook(() => useGistActions());
      let oldWork!: Promise<void>;
      let newWork!: Promise<void>;
      await act(async () => { oldWork = hook.result.current.analyzeVisibleGists(); });
      act(() => { storeState.githubToken = 'new-token'; notifyStore(); });
      hook.rerender();
      await act(async () => { newWork = hook.result.current.analyzeVisibleGists(); await oldWork; });
      expect(hook.result.current.isAnalyzingAll).toBe(true);
      expect(storeState.analyzingGistIds.has(gist.id)).toBe(true);
      act(() => hook.unmount());
      await act(async () => { await newWork; pending.resolve('late'); });
      expect(storeState.updateGist).not.toHaveBeenCalled();
    });

    it('keeps unrelated store changes live and reports ordinary batch success/failure', async () => {
      const pending = deferred<string>();
      mocks.analyzeGist.mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error('boom'));
      const { result } = renderHook(() => useGistActions());
      let work!: Promise<void>;
      await act(async () => { work = result.current.analyzeVisibleGists(); });
      act(() => { storeState.gistSearchFilters = { query: 'changed' }; notifyStore(); });
      expect((mocks.analyzeGist.mock.calls[0][2] as AbortSignal).aborted).toBe(false);
      await act(async () => { pending.resolve('ok'); await work; });
      expect(storeState.updateGist).toHaveBeenCalledTimes(2);
      expect(storeState.updateGist).toHaveBeenLastCalledWith(expect.objectContaining({
        id: 'gist-2', analysis_failed: true, analysis_error: 'boom',
      }));
      expect(mocks.toast).toHaveBeenCalledTimes(1);
      expect(mocks.toast).toHaveBeenLastCalledWith(expect.any(String), 'error');
      expect(result.current.isAnalyzingAll).toBe(false);
    });
  });

  describe('unstarGist', () => {
    it('aborts silently without token and when confirm is declined', async () => {
      storeState.githubToken = null;
      const { result, rerender } = renderHook(() => useGistActions());
      await act(async () => { await result.current.unstarGist(gist, vi.fn()); });
      expect(mocks.confirm).not.toHaveBeenCalled();
      expect(mocks.unstarGist).not.toHaveBeenCalled();

      storeState.githubToken = 'github-token';
      rerender();
      mocks.confirm.mockResolvedValue(false);
      await act(async () => { await result.current.unstarGist(gist, vi.fn()); });
      expect(mocks.confirm).toHaveBeenCalledTimes(1);
      expect(mocks.unstarGist).not.toHaveBeenCalled();
    });

    it('calls onUnstarred before the store update and toasts success', async () => {
      mocks.confirm.mockResolvedValue(true);
      const onUnstarred = vi.fn();
      const { result } = renderHook(() => useGistActions());
      await act(async () => { await result.current.unstarGist(gist, onUnstarred); });

      expect(mocks.unstarGist).toHaveBeenCalledWith('gist-1');
      const onUnstarredOrder = onUnstarred.mock.invocationCallOrder[0];
      const updateOrder = storeState.updateGist.mock.invocationCallOrder[0];
      expect(onUnstarredOrder).toBeLessThan(updateOrder);
      expect(storeState.updateGist).toHaveBeenCalledWith({ ...gist, starred: false });
      expect(mocks.toast).toHaveBeenCalledWith('已取消收藏', 'success');
    });

    it('toasts failure without store update when the api call rejects', async () => {
      mocks.confirm.mockResolvedValue(true);
      mocks.unstarGist.mockRejectedValue(new Error('network'));
      const onUnstarred = vi.fn();
      const { result } = renderHook(() => useGistActions());
      await act(async () => { await result.current.unstarGist(gist, onUnstarred); });

      expect(onUnstarred).not.toHaveBeenCalled();
      expect(storeState.updateGist).not.toHaveBeenCalled();
      expect(mocks.toast).toHaveBeenCalledWith('取消收藏失败', 'error');
    });
  });

  describe('deleteGist', () => {
    it('skips silently without token or when the gist is not owned by the user', async () => {
      storeState.githubToken = null;
      const { result, rerender } = renderHook(() => useGistActions());
      await act(async () => { await result.current.deleteGist(gist, vi.fn()); });
      expect(mocks.deleteGist).not.toHaveBeenCalled();

      storeState.githubToken = 'github-token';
      rerender();
      const foreignGist = { ...gist, owner: { login: 'someone-else', avatar_url: '' } };
      await act(async () => { await result.current.deleteGist(foreignGist, vi.fn()); });
      expect(mocks.confirm).not.toHaveBeenCalled();
      expect(mocks.deleteGist).not.toHaveBeenCalled();
    });

    it('aborts when confirm is declined', async () => {
      mocks.confirm.mockResolvedValue(false);
      const { result } = renderHook(() => useGistActions());
      await act(async () => { await result.current.deleteGist(gist, vi.fn()); });
      expect(mocks.confirm).toHaveBeenCalledWith(
        '删除 Gist',
        '确定要删除这个 gist 吗？此操作不可撤销。',
        { type: 'danger', confirmText: '删除' },
      );
      expect(mocks.deleteGist).not.toHaveBeenCalled();
    });

    it('removes the store record, then calls onDeleted, then toasts success', async () => {
      mocks.confirm.mockResolvedValue(true);
      const onDeleted = vi.fn();
      const { result } = renderHook(() => useGistActions());
      await act(async () => { await result.current.deleteGist(gist, onDeleted); });

      expect(mocks.deleteGist).toHaveBeenCalledWith('gist-1');
      const storeDeleteOrder = storeState.deleteGist.mock.invocationCallOrder[0];
      const onDeletedOrder = onDeleted.mock.invocationCallOrder[0];
      expect(storeDeleteOrder).toBeLessThan(onDeletedOrder);
      expect(mocks.toast).toHaveBeenCalledWith('Gist 已删除', 'success');
    });

    it('maps permission errors into the scoped hint toast', async () => {
      mocks.confirm.mockResolvedValue(true);
      mocks.deleteGist.mockRejectedValue(new Error('403 forbidden'));
      const { result } = renderHook(() => useGistActions());
      await act(async () => { await result.current.deleteGist(gist, vi.fn()); });

      expect(mocks.toast).toHaveBeenCalledWith(
        '删除 Gist 失败：403 forbidden（请确认 token 已勾选 gist 权限，并在设置中重新输入 token 登录）',
        'error',
      );
    });
  });

  describe('fetchGistFileRaw', () => {
    it('throws the verbatim no-token message', async () => {
      storeState.githubToken = null;
      const { result } = renderHook(() => useGistActions());
      await expect(result.current.fetchGistFileRaw('https://raw.example/x')).rejects.toThrow(
        '未配置 GitHub token，无法加载文件内容',
      );
      expect(mocks.getGistFileRaw).not.toHaveBeenCalled();
    });

    it('passes the raw url and signal through to the api service', async () => {
      mocks.getGistFileRaw.mockResolvedValue('file body');
      const { result } = renderHook(() => useGistActions());
      const controller = new AbortController();
      await act(async () => {
        await expect(result.current.fetchGistFileRaw('https://raw.example/x', controller.signal)).resolves.toBe('file body');
      });
      expect(mocks.getGistFileRaw).toHaveBeenCalledWith('https://raw.example/x', controller.signal);
    });
  });

  describe('isAnalyzingGist', () => {
    it('reflects the store analyzing set', () => {
      storeState.analyzingGistIds = new Set(['gist-1']);
      const { result } = renderHook(() => useGistActions());
      expect(result.current.isAnalyzingGist('gist-1')).toBe(true);
      expect(result.current.isAnalyzingGist('gist-2')).toBe(false);
    });
  });
});

describe('gist analysis patch helpers', () => {
  it('applyGistAnalysisSuccess trims the summary and resets failure state on the detail', () => {
    const patched = applyGistAnalysisSuccess(gistDetail, '  trimmed  ', '2026-09-05T00:00:00.000Z');
    expect(patched).toEqual({
      ...gistDetail,
      ai_summary: 'trimmed',
      analyzed_at: '2026-09-05T00:00:00.000Z',
      analysis_failed: false,
      analysis_error: undefined,
    });
  });

  it('applyGistAnalysisFailure marks failure on the original gist', () => {
    const patched = applyGistAnalysisFailure(gist, 'boom', '2026-09-05T00:00:00.000Z');
    expect(patched).toEqual({
      ...gist,
      analyzed_at: '2026-09-05T00:00:00.000Z',
      analysis_failed: true,
      analysis_error: 'boom',
    });
  });
});
