import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { AIConfig, Repository } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { analyzeRepositoryDetails } from '../../../services/repositoryDetailAnalysis';
import { useRepositoryDetailAnalysisJob } from './useRepositoryDetailAnalysisJob';

vi.mock('../../../store/useAppStore', async () => {
  const { create } = await import('zustand');
  return { useAppStore: create<{ repositories: Repository[]; user: { id: number } | null; githubToken: string;
    aiConfigs: AIConfig[]; activeAIConfig: string; language: string; updateRepository: (repo: Repository) => void }>(set => ({
    repositories: [], user: null, githubToken: '', aiConfigs: [], activeAIConfig: '', language: 'zh',
    updateRepository: repo => set(state => ({ repositories: state.repositories.map(item => item.id === repo.id ? repo : item) })),
  })) };
});

vi.mock('../../../services/repositoryDetailAnalysis', () => ({ analyzeRepositoryDetails: vi.fn() }));
vi.mock('../../../services/autoSync', () => ({ forceSyncToBackend: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../services/repositoryDetailReadme', () => ({ clearRepositoryDetailReadmeCache: vi.fn() }));
const repos = Array.from({ length: 4 }, (_, i) => ({ id: 700 + i, full_name: `test/repo-${i}`, ai_summary: 'old', custom_description: 'manual' }) as Repository);
const config: AIConfig = { id: 'agy-cli-local', name: 'AGY', provider: 'agy-cli', deviceBound: true, isActive: true,
  model: 'fixture', agyEffort: 'high', agyMode: 'model', concurrency: 5, agyFeatureOverrides: { 'repository-details': { concurrency: 2 } } };
let releases: (() => void)[];
beforeEach(() => {
  vi.clearAllMocks(); releases = [];
  vi.stubGlobal('electronAPI', { agy: {} });
  useAppStore.setState({ user: { id: 7 } as never, githubToken: 'fixture-token', aiConfigs: [config], activeAIConfig: config.id, repositories: repos.map(repo => ({ ...repo })) });
  vi.mocked(analyzeRepositoryDetails).mockImplementation(({ repository }) => new Promise(resolve => releases.push(() => resolve({
    summary: `details ${repository.id}`, tags: ['test'], platforms: [], generated_at: new Date().toISOString(),
  } as never))));
});
afterEach(() => { vi.unstubAllGlobals(); });

it('dispatches two detail tasks, pauses new dispatch, resumes and preserves manual fields', async () => {
  const hook = renderHook(() => useRepositoryDetailAnalysisJob());
  let running!: Promise<void>;
  act(() => { running = hook.result.current.run(repos); });
  await waitFor(() => expect(analyzeRepositoryDetails).toHaveBeenCalledTimes(2));
  act(() => hook.result.current.pause());
  await act(async () => { releases.splice(0).forEach(resolve => resolve()); });
  expect(analyzeRepositoryDetails).toHaveBeenCalledTimes(2);
  expect(hook.result.current.progress.current).toBe(2);
  act(() => hook.result.current.resume());
  await waitFor(() => expect(analyzeRepositoryDetails).toHaveBeenCalledTimes(4));
  await act(async () => { releases.splice(0).forEach(resolve => resolve()); await running; });
  expect(hook.result.current.progress.current).toBe(4);
  expect(useAppStore.getState().repositories.every(repo => repo.ai_summary === `details ${repo.id}` && repo.custom_description === 'manual')).toBe(true);
  hook.unmount();
});

it('stops all active detail requests and refuses late results after account changes', async () => {
  const hook = renderHook(() => useRepositoryDetailAnalysisJob());
  let running!: Promise<void>;
  act(() => { running = hook.result.current.run(repos); });
  await waitFor(() => expect(analyzeRepositoryDetails).toHaveBeenCalledTimes(2));
  act(() => useAppStore.setState({ user: { id: 8 } as never, githubToken: 'other-token' }));
  expect(vi.mocked(analyzeRepositoryDetails).mock.calls.every(([options]) => options.signal?.aborted)).toBe(true);
  await act(async () => { releases.splice(0).forEach(resolve => resolve()); await running; });
  expect(analyzeRepositoryDetails).toHaveBeenCalledTimes(2);
  expect(useAppStore.getState().repositories.every(repo => repo.ai_summary === 'old')).toBe(true);
  hook.unmount();
});
