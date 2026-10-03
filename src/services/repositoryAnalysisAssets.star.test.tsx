import { act, renderHook, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryRepo, Repository } from '../types';
import type { RepositoryDetailsAnalysis } from '../types/repositoryDetails';
import { useAppStore } from '../store/useAppStore';
import { initializeRepositoryAnalysisAssets, saveRepositoryAnalysisAsset } from './repositoryAnalysisAssets';
import { useDiscoveryRepoActions } from '../features/discovery/hooks/useDiscoveryRepoActions';
import { useCustomChannelActions } from '../features/discovery/hooks/useCustomChannelActions';
import { useCustomDiscovery } from '../features/discovery/custom/store';
import { emptyData } from '../features/discovery/custom/model';

const mocks = vi.hoisted(() => ({ star: vi.fn(), sync: vi.fn(), toast: vi.fn() }));
vi.mock('../store/useAppStore', async () => {
  const { create } = await import('zustand');
  return { getAllCategories: () => [], useAppStore: create((set) => ({ user: { id: 1 }, githubToken: 'token', language: 'zh',
    aiConfigs: [], activeAIConfig: '', customCategories: [], repositories: [] as Repository[], discoveryRepos: {},
    updateDiscoveryRepo: vi.fn(), deleteRepository: vi.fn(),
    addRepository: vi.fn((repo: Repository) => set((state: { repositories: Repository[] }) => ({ repositories: [...state.repositories, repo] }))),
    updateRepository: vi.fn((repo: Repository) => set((state: { repositories: Repository[] }) => ({ repositories: state.repositories.map(item => item.id === repo.id ? repo : item) }))),
  })) };
});
vi.mock('./githubApiFactory', () => ({ createGitHubApiService: () => ({ starRepository: mocks.star }) }));
vi.mock('./autoSync', () => ({ forceSyncToBackend: mocks.sync }));
vi.mock('../hooks/useDialog', () => ({ useDialog: () => ({ toast: mocks.toast }) }));
vi.mock('../features/discovery/custom/runner', () => ({ currentAccount: () => String(useAppStore.getState().user?.id), activeAI: vi.fn(), previewChannel: vi.fn() }));
const repo = { id: 7, name: 'tool', full_name: 'owner/tool', owner: { login: 'owner', avatar_url: '' },
  description: 'Original', pushed_at: '2026-09-01T00:00:00Z', channel: 'trending', rank: 2 } as DiscoveryRepo;
const details: RepositoryDetailsAnalysis = { version: 1, generated_at: '2026-10-01T00:00:00Z', repository_pushed_at: repo.pushed_at,
  model: 'test', summary: 'Latest asset', tags: ['tool'], platforms: ['Linux'], problem: null, features: [], scenarios: [],
  architecture: null, quickstart: [], deployment: null, cost: null, maintenance: null, sources: [] };
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.clearAllMocks();
  mocks.sync.mockResolvedValue(undefined);
  useAppStore.setState({ user: { id: 1 } as never, githubToken: 'token', repositories: [] });
  useCustomDiscovery.setState({ account: '1', data: emptyData() });
  await initializeRepositoryAnalysisAssets('1', []);
});
afterEach(() => vi.unstubAllGlobals());

describe('Star saves the latest shared analysis', () => {
  it.each(['builtin', 'custom'] as const)('%s looks up assets after the remote Star resolves', async kind => {
    let resolve!: () => void;
    mocks.star.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
    const hook = renderHook(() => kind === 'builtin' ? useDiscoveryRepoActions({ repo }) : useCustomChannelActions());
    const onStar = vi.fn();
    let pending!: Promise<void>;
    act(() => { pending = kind === 'builtin' ? (hook.result.current as ReturnType<typeof useDiscoveryRepoActions>).star(onStar)
      : (hook.result.current as ReturnType<typeof useCustomChannelActions>).star(repo); });
    await waitFor(() => expect(mocks.star).toHaveBeenCalledOnce());
    await saveRepositoryAnalysisAsset('1', repo, 'en', undefined, details);
    await act(async () => { resolve(); await pending; });
    expect(useAppStore.getState().repositories[0]).toMatchObject({ ai_details: details, ai_summary: 'Latest asset', description: 'Original' });
    const add = vi.mocked(useAppStore.getState().addRepository);
    expect(mocks.star.mock.invocationCallOrder[0]).toBeLessThan(add.mock.invocationCallOrder[0]);
    if (kind === 'builtin') {
      expect(onStar).toHaveBeenCalledOnce();
      expect(add.mock.invocationCallOrder[0]).toBeLessThan(onStar.mock.invocationCallOrder[0]);
      expect(onStar.mock.invocationCallOrder[0]).toBeLessThan(mocks.sync.mock.invocationCallOrder[0]);
    }
    hook.unmount();
  });
  it.each(['builtin', 'custom'] as const)('%s preserves manual edits when a repository is saved during the Star request', async kind => {
    let resolve!: () => void;
    mocks.star.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
    const hook = renderHook(() => kind === 'builtin' ? useDiscoveryRepoActions({ repo }) : useCustomChannelActions());
    let pending!: Promise<void>;
    act(() => { pending = kind === 'builtin' ? (hook.result.current as ReturnType<typeof useDiscoveryRepoActions>).star()
      : (hook.result.current as ReturnType<typeof useCustomChannelActions>).star(repo); });
    await waitFor(() => expect(mocks.star).toHaveBeenCalledOnce());
    act(() => useAppStore.setState({ repositories: [{ ...repo, starred_at: 'already saved', custom_description: 'Personal', custom_category: 'Manual' }] }));
    await saveRepositoryAnalysisAsset('1', repo, 'zh', undefined, details);
    await act(async () => { resolve(); await pending; });
    expect(useAppStore.getState().repositories).toHaveLength(1);
    expect(useAppStore.getState().repositories[0]).toMatchObject({ ai_summary: 'Latest asset', custom_description: 'Personal', custom_category: 'Manual', starred_at: 'already saved' });
    expect(useAppStore.getState().addRepository).not.toHaveBeenCalled();
    hook.unmount();
  });
});
