import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { candidateTransaction, readCandidateWorkspace } from '../../../lib/html-reading/candidates';
import type { Repository } from '../../../types';
const mock = vi.hoisted(() => ({
  state: { isAuthenticated: true, user: { id: 42, login: 'test-user' }, githubToken: 'synthetic', language: 'zh', repositories: [] as Repository[], discoveryRepos: {}, addRepository: vi.fn() },
  api: { getCurrentUser: vi.fn(), getRepository: vi.fn(), isRepositoryStarred: vi.fn(), starRepository: vi.fn() },
  flush: vi.fn(), checkpoint: vi.fn(), sync: vi.fn(), changed: vi.fn(),
}));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: Object.assign((selector: (state: typeof mock.state) => unknown) => selector(mock.state), { getState: () => mock.state }) }));
vi.mock('../../../services/githubApiFactory', () => ({ createGitHubApiService: () => mock.api }));
vi.mock('../../../store/persistence/storage', () => ({ flushAppStorePersistence: mock.flush }));
vi.mock('../../../home/desktop', () => ({ checkpointDesktopHomeRepository: mock.checkpoint }));
vi.mock('../../../services/autoSync', () => ({ forceSyncToBackend: mock.sync }));
vi.mock('../../discovery/custom/storage', () => ({ loadData: vi.fn(async () => ({})) }));
vi.mock('../../../services/repositoryAnalysisAssets', () => ({
  useRepositoryAnalysisAssets: (selector: (value: { assets: object }) => unknown) => selector({ assets: {} }),
  initializeRepositoryAnalysisAssets: vi.fn(async () => {}), applyRepositoryAnalysisAsset: (_account: string, repo: Repository) => repo,
  hasRepositoryAnalysisAsset: () => false, findLegacyRepositoryAnalysisAsset: () => undefined, projectRepositoryAnalysisAsset: (repo: Repository) => repo,
}));
import { useReadingCandidates } from './useReadingCandidates';
const repo = { id: 1, name: 'tool', full_name: 'acme/tool', description: '已有用途', ai_summary: '已有分析', custom_tags: ['保留人工标签'] } as Repository;
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.clearAllMocks();
  mock.state.user = { id: 42, login: 'test-user' }; mock.state.githubToken = 'synthetic'; mock.state.repositories = [];
  mock.state.addRepository.mockImplementation(item => { mock.state.repositories = [...mock.state.repositories, item]; });
  mock.api.getRepository.mockResolvedValue(repo); mock.api.isRepositoryStarred.mockResolvedValue(false); mock.api.starRepository.mockResolvedValue(undefined);
  mock.api.getCurrentUser.mockImplementation(async () => ({ id: mock.state.user.id }));
  mock.flush.mockResolvedValue(undefined); mock.checkpoint.mockResolvedValue(undefined); mock.sync.mockResolvedValue(undefined); mock.changed.mockResolvedValue(undefined);
  for (const account of ['42', '43']) await candidateTransaction(account, data => { data.names['1'] = 'acme/tool'; data.states['1'] = { read: true, note: 'keep', interest: 'interested', candidate: true }; });
});
async function hook() { const value = renderHook(({ account }) => useReadingCandidates(account, mock.changed), { initialProps: { account: '42' } }); await waitFor(() => expect(value.result.current.items).toHaveLength(1)); return value; }

it('waits for durable repository flush before clearing the candidate', async () => {
  let complete!: () => void; mock.flush.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
  const c = await hook(); let pending!: Promise<void>;
  act(() => { pending = c.result.current.start(['1']); }); await waitFor(() => expect(complete).toBeTypeOf('function'));
  expect((await readCandidateWorkspace('42')).states['1'].candidate).toBe(true);
  await act(async () => { complete(); await pending; }); expect((await readCandidateWorkspace('42')).states['1'].candidate).toBe(false);
  expect(mock.checkpoint).toHaveBeenCalledWith('42', 1);
});

it('rejects removal of a newer source atomically and preserves every selected candidate', async () => {
  const c = await hook(); const expected = { '1': c.result.current.items[0].candidateFingerprint };
  await candidateTransaction('42', data => { data.states['1'].candidate = false; });
  await candidateTransaction('42', data => { data.states['1'].candidate = true; });
  await act(async () => { await expect(c.result.current.dismiss(['1'], expected)).rejects.toThrow('候选已变化'); });
  expect((await readCandidateWorkspace('42')).states['1'].candidate).toBe(true);
  expect(mock.api.starRepository).not.toHaveBeenCalled();
});
it('retries durability for an existing in-memory repo left by failed flush', async () => {
  mock.flush.mockRejectedValueOnce(Error('disk unavailable')); const c = await hook();
  await act(() => c.result.current.start(['1'])); expect(c.result.current.batches[0].rows[0].status).toBe('local-pending');
  expect(mock.state.repositories).toHaveLength(1); expect((await readCandidateWorkspace('42')).states['1'].candidate).toBe(true);
  mock.api.isRepositoryStarred.mockResolvedValue(true);
  await act(() => c.result.current.resume(c.result.current.batches[0].id));
  expect(mock.flush).toHaveBeenCalledTimes(2); expect(mock.state.addRepository).toHaveBeenCalledTimes(1); expect(mock.api.starRepository).toHaveBeenCalledTimes(1);
  expect((await readCandidateWorkspace('42')).states['1'].candidate).toBe(false);
});
it('account rerender releases old busy state without changing the new account', async () => {
  let lookup!: (repo: Repository) => void; mock.api.getRepository.mockImplementationOnce(() => new Promise(resolve => { lookup = resolve; }));
  const c = await hook(); let pending!: Promise<void>; act(() => { pending = c.result.current.start(['1']); }); await waitFor(() => expect(lookup).toBeTypeOf('function'));
  act(() => { mock.state.user = { id: 43, login: 'other-user' }; c.rerender({ account: '43' }); });
  await act(async () => { lookup(repo); await pending; }); await waitFor(() => expect(c.result.current.busy).toBe(false));
  expect(mock.api.starRepository).not.toHaveBeenCalled(); expect((await readCandidateWorkspace('43')).states['1'].candidate).toBe(true);
  await act(() => c.result.current.start(['1'])); expect(mock.api.starRepository).toHaveBeenCalledOnce();
});
it('bulk removal only clears candidate flags and preserves all reading fields', async () => {
  const c = await hook(); await act(() => c.result.current.dismiss(['1']));
  expect((await readCandidateWorkspace('42')).states['1']).toEqual({ candidate: false, read: true, note: 'keep', interest: 'interested' }); expect(mock.api.starRepository).not.toHaveBeenCalled();
});

it('rejects a token owned by a different account before creating any batch or Star request', async () => {
  const c = await hook(); mock.api.getCurrentUser.mockResolvedValue({ id: 99 });
  await act(async () => { await expect(c.result.current.start(['1'])).rejects.toThrow('所属账户'); });
  expect(mock.api.starRepository).not.toHaveBeenCalled();
  expect(c.result.current.batches).toHaveLength(0);
  expect((await readCandidateWorkspace('42')).states['1'].candidate).toBe(true);
});

it('pauses after credentials rotate during lookup without writing or clearing the candidate', async () => {
  let lookup!: (repo: Repository) => void; mock.api.getRepository.mockImplementationOnce(() => new Promise(resolve => { lookup = resolve; }));
  const c = await hook(); let pending!: Promise<void>; act(() => { pending = c.result.current.start(['1']); }); await waitFor(() => expect(lookup).toBeTypeOf('function'));
  act(() => { mock.state.githubToken = 'rotated-synthetic'; c.rerender({ account: '42' }); });
  await act(async () => { lookup(repo); await pending; });
  expect(mock.api.starRepository).not.toHaveBeenCalled();
  expect((await readCandidateWorkspace('42')).states['1'].candidate).toBe(true);
  expect(c.result.current.batches[0].status).toBe('paused');
});
it('keeps existing manual fields and reports remote sync failure separately', async () => {
  mock.state.repositories = [repo]; mock.sync.mockRejectedValueOnce(Error('backend offline')); const c = await hook();
  await act(() => c.result.current.start(['1'])); expect(mock.state.repositories[0].custom_tags).toEqual(['保留人工标签']); expect(mock.state.addRepository).not.toHaveBeenCalled();
  expect(c.result.current.batches[0]).toMatchObject({ status: 'completed', syncError: 'backend offline' });
  mock.sync.mockResolvedValue(undefined); await act(() => c.result.current.retrySync(c.result.current.batches[0].id)); expect(c.result.current.batches[0].syncError).toBeUndefined();
});
