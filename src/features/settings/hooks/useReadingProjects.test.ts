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
import { useReadingProjects } from './useReadingProjects';
import { readingProjectFingerprint } from '../../../lib/html-reading/workspace';
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
async function hook() { const value = renderHook(({ account }) => useReadingProjects(account, mock.changed), { initialProps: { account: '42' } }); await waitFor(() => expect(value.result.current.items).toHaveLength(1)); return value; }


const expected = (value: Awaited<ReturnType<typeof hook>>) => Object.fromEntries(value.result.current.items.map(item => [item.id, item.fingerprint]));
it('shows all reading records and uses unknown when the project is absent from saved repositories', async () => {
  await candidateTransaction('42', data => { data.states['1'].candidate = false; data.names['2'] = 'acme/second'; data.states['2'] = { read: false, candidate: false, interest: 'neutral', note: '' }; });
  const c = renderHook(() => useReadingProjects('42', mock.changed));
  await waitFor(() => expect(c.result.current.items).toHaveLength(2));
  expect(c.result.current.items[0].starState).toBe('unknown'); expect(c.result.current.items[0].state.candidate).toBe(false);
});
it('saves notes through exact fingerprints and exposes operation feedback without GitHub calls', async () => {
  const c = await hook(); await act(() => c.result.current.bulk(['1'], { note: 'new note' }, expected(c)));
  expect(c.result.current.items[0].state.note).toBe('new note'); expect(c.result.current.items[0].processed).toBe(false); expect(c.result.current.message).toContain('1'); expect(mock.api.getCurrentUser).not.toHaveBeenCalled();
});
it('stale bulk confirmations cannot alter the selected reading state', async () => {
  const c = await hook(); const prior = expected(c);
  await candidateTransaction('42', data => { data.processing!['1'] = { processed: true, reason: 'manual', updatedAt: 'changed' }; });
  await act(async () => { await expect(c.result.current.bulk(['1'], { read: false }, prior)).rejects.toThrow('项目已变化'); });
  expect(c.result.current.items[0].state.read).toBe(true); expect(c.result.current.error).toContain('项目已变化');
});
it('direct noncandidate Star waits for durable flush before completing and clearing the exact project', async () => {
  await candidateTransaction('42', data => { data.states['1'].candidate = false; });
  let complete!: () => void; mock.flush.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
  const c = await hook(); let pending!: Promise<void>;
  act(() => { pending = c.result.current.start(['1'], expected(c)); }); await waitFor(() => expect(complete).toBeTypeOf('function'));
  expect((await readCandidateWorkspace('42')).processing?.['1'].processed).toBe(false);
  await act(async () => { complete(); await pending; });
  expect(c.result.current.items[0]).toMatchObject({ processed: true, processedReason: 'starred', starState: 'starred' }); expect(mock.checkpoint).toHaveBeenCalledWith('42', 1);
});
it('refuses token identity mismatch before creating any direct Star batch or read-only status query', async () => {
  const c = await hook(); mock.api.getCurrentUser.mockResolvedValue({ id: 99 });
  await act(async () => { await expect(c.result.current.start(['1'], expected(c))).rejects.toThrow('所属账户'); });
  await act(async () => { await expect(c.result.current.refreshStars(['1'])).rejects.toThrow('所属账户'); });
  expect(mock.api.starRepository).not.toHaveBeenCalled(); expect(mock.api.getRepository).not.toHaveBeenCalled(); expect(c.result.current.batches).toHaveLength(0);
});
it('read-only refresh persists true/false, preserves fingerprint, and never writes Star or completes the project', async () => {
  const c = await hook(); const prior = c.result.current.items[0].fingerprint;
  await act(() => c.result.current.refreshStars(['1']));
  expect(c.result.current.items[0]).toMatchObject({ starState: 'unstarred', starCheckedAt: expect.any(String), processed: false, fingerprint: prior });
  mock.api.isRepositoryStarred.mockResolvedValue(true); await act(() => c.result.current.refreshStars(['1']));
  expect(c.result.current.items[0].starState).toBe('starred'); expect(mock.api.starRepository).not.toHaveBeenCalled(); expect(mock.state.addRepository).not.toHaveBeenCalled();
});
it('offline status refresh preserves prior known observations and reports a retryable manual error', async () => {
  await candidateTransaction('42', data => { data.starObservations!['1'] = { starred: true, checkedAt: 'yesterday' }; });
  mock.api.isRepositoryStarred.mockRejectedValueOnce(Error('offline')); const c = await hook();
  await act(async () => { await expect(c.result.current.refreshStars(['1'])).rejects.toThrow('offline'); });
  expect(c.result.current.items[0]).toMatchObject({ starState: 'starred', starCheckedAt: 'yesterday' }); expect(c.result.current.error).toContain('offline'); expect(mock.api.starRepository).not.toHaveBeenCalled();
});
it('numeric identity mismatch retains unknown without requesting a Star status for a different repository', async () => {
  mock.api.getRepository.mockResolvedValue({ ...repo, id: 99 }); const c = await hook();
  await act(async () => { await expect(c.result.current.refreshStars(['1'])).rejects.toThrow('项目标识已变化'); });
  expect(c.result.current.items[0].starState).toBe('unknown'); expect(mock.api.isRepositoryStarred).not.toHaveBeenCalled();
});
it('credential rotation during status lookup cannot save any observation or issue a write', async () => {
  let lookup!: (repo: Repository) => void; mock.api.getRepository.mockImplementationOnce(() => new Promise(resolve => { lookup = resolve; }));
  const c = await hook(); let pending!: Promise<void>;
  act(() => { pending = c.result.current.refreshStars(['1']); }); await waitFor(() => expect(lookup).toBeTypeOf('function'));
  act(() => { mock.state.githubToken = 'rotated'; c.rerender({ account: '42' }); });
  await act(async () => { lookup(repo); await expect(pending).rejects.toThrow('刷新已停止'); });
  expect((await readCandidateWorkspace('42')).starObservations).toEqual({}); expect(mock.api.starRepository).not.toHaveBeenCalled();
});
it('stops enumeration on permission or rate limits and preserves per-item checked successes', async () => {
  await candidateTransaction('42', data => { data.names['2'] = 'acme/second'; data.states['2'] = { read: false, candidate: false, interest: 'neutral', note: '' }; data.names['3'] = 'acme/third'; data.states['3'] = { ...data.states['2'] }; });
  const c = renderHook(() => useReadingProjects('42', mock.changed)); await waitFor(() => expect(c.result.current.items).toHaveLength(3));
  mock.api.getRepository.mockResolvedValueOnce(repo).mockRejectedValueOnce(Object.assign(Error('rate limit'), { status: 429 }));
  await act(async () => { await expect(c.result.current.refreshStars(['1', '2', '3'])).rejects.toThrow('rate limit'); });
  expect(mock.api.getRepository).toHaveBeenCalledTimes(2); expect((await readCandidateWorkspace('42')).starObservations?.['1'].starred).toBe(false); expect(c.result.current.error).toContain('rate limit');
});
it('stop aborts a manual status refresh and no later project is requested', async () => {
  const c = await hook(); let lookup!: (repo: Repository) => void; mock.api.getRepository.mockImplementationOnce(() => new Promise(resolve => { lookup = resolve; }));
  let pending!: Promise<void>; act(() => { pending = c.result.current.refreshStars(['1']); }); await waitFor(() => expect(lookup).toBeTypeOf('function'));
  act(() => c.result.current.stop()); await act(async () => { lookup(repo); await expect(pending).rejects.toThrow('刷新已停止'); });
  expect((await readCandidateWorkspace('42')).starObservations).toEqual({}); expect(c.result.current.busy).toBe(false);
});
it('publishes the persisted latest import and source without retaining a duplicate refresh-only range', async () => {
  await candidateTransaction('42', data => { data.latestImport = { id: 'accepted', ids: ['1'], importedAt: 'today' }; });
  const c = await hook(); expect(c.result.current.lastImportId).toBe('accepted'); expect(c.result.current.lastImportIds).toEqual(['1']);
  await act(() => c.result.current.refresh()); expect(c.result.current.lastImportId).toBe('accepted'); expect(readingProjectFingerprint(await readCandidateWorkspace('42'), '1')).toBe(c.result.current.items[0].fingerprint);
});

it('manual workspace refresh publishes an error while keeping the previous usable records', async () => {
  const c = await hook(); vi.stubGlobal('indexedDB', { open: () => { throw Error('workspace unavailable'); } });
  await act(async () => { await expect(c.result.current.refresh()).rejects.toThrow('workspace unavailable'); });
  expect(c.result.current.error).toContain('workspace unavailable'); expect(c.result.current.items).toHaveLength(1);
});
