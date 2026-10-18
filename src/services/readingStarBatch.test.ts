import { beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { candidateTransaction, candidateFingerprint, readCandidateWorkspace } from '../lib/html-reading/candidates';
import { executeReadingStarBatch, isReadingStarBatchRunning, stopReadingStarBatch, type ReadingStarDependencies } from './readingStarBatch';
import type { Repository } from '../types';
import { readingProjectFingerprint } from '../lib/html-reading/workspace';

let deps: ReadingStarDependencies;
let current: boolean, clock: number;
const repo = (id: number): Repository => ({ id, full_name: `acme/tool${id}`, name: `tool${id}` } as Repository);
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); current = true; clock = Date.parse('2026-10-06T08:00:00Z');
  deps = {
    api: { getRepository: vi.fn(async (_owner, name) => repo(Number(name.replace('tool', '')))), isRepositoryStarred: vi.fn(async () => false), starRepository: vi.fn(async () => {}) },
    isCurrent: () => current, addRepository: vi.fn(async () => {}), sync: vi.fn(async () => {}), now: () => clock,
    wait: vi.fn(async ms => { clock += ms; }),
  };
  await candidateTransaction('42', data => { for (const id of [1, 2, 3]) { data.names[id] = `acme/tool${id}`; data.states[id] = { candidate: true, read: true, interest: 'interested', note: '保留笔记' }; } });
});
const run = (ids = ['1', '2']) => executeReadingStarBatch('42', { ids }, deps);
async function latest() { const data = await readCandidateWorkspace('42'); return { data, batch: Object.values(data.starBatches)[0] }; }

it('rejects a reviewed fingerprint changed before creation without persisting or writing a batch', async () => {
  const expectedFingerprints = { '1': candidateFingerprint((await latest()).data, 1) };
  await candidateTransaction('42', data => { data.states['1'].candidate = false; });
  await candidateTransaction('42', data => { data.states['1'].candidate = true; });
  await expect(executeReadingStarBatch('42', { ids: ['1'], expectedFingerprints }, deps)).rejects.toThrow('候选已变化');
  expect(deps.api.starRepository).not.toHaveBeenCalled();
  expect(Object.values((await latest()).data.starBatches)).toHaveLength(0);
});

it('executes selected candidates only, separates sync, preserves reading fields and persists success', async () => {
  await run(); const { data, batch } = await latest();
  expect(deps.api.starRepository).toHaveBeenCalledTimes(2); expect(deps.sync).toHaveBeenCalledTimes(1);
  expect(batch.status).toBe('completed'); expect(batch.rows.map(row => row.status)).toEqual(['starred', 'starred']);
  expect(data.states['1']).toEqual({ candidate: false, read: true, interest: 'interested', note: '保留笔记' }); expect(data.states['3'].candidate).toBe(true);
  expect(deps.wait).toHaveBeenCalledWith(1000, expect.any(AbortSignal));
});
it('checks already Starred and clears candidate only after local repository update', async () => {
  vi.mocked(deps.api.isRepositoryStarred).mockResolvedValue(true); await run(['1']);
  expect(deps.api.starRepository).not.toHaveBeenCalled(); expect(deps.addRepository).toHaveBeenCalledWith(repo(1));
  expect((await latest()).batch.rows[0].status).toBe('already-starred');
});
it('refuses names that now resolve to a different numeric repository', async () => {
  vi.mocked(deps.api.getRepository).mockResolvedValue(repo(99)); await run(['1']);
  expect(deps.api.starRepository).not.toHaveBeenCalled(); expect((await latest()).batch.rows[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('项目标识已变化') });
});
it('uses verified canonical coordinates after a repository rename', async () => {
  vi.mocked(deps.api.getRepository).mockResolvedValue({ ...repo(1), full_name: 'new-owner/renamed' }); await run(['1']);
  expect(deps.api.starRepository).toHaveBeenCalledWith('new-owner', 'renamed', expect.any(AbortSignal));
});
it('continues past an ordinary failure, retaining the failed candidate', async () => {
  vi.mocked(deps.api.getRepository).mockRejectedValueOnce(Object.assign(Error('missing'), { status: 404 })); await run();
  const { batch, data } = await latest(); expect(batch.rows.map(row => row.status)).toEqual(['failed', 'starred']); expect(data.states['1'].candidate).toBe(true);
});
it('pauses on rate limit and blocks resume until its cooldown', async () => {
  vi.mocked(deps.api.starRepository).mockRejectedValueOnce(Object.assign(Error('rate limit'), { status: 429, retryAfterMs: 5000 })); await run();
  const { batch } = await latest(); expect(batch.status).toBe('paused'); expect(batch.rows[1].status).toBe('queued');
  await expect(executeReadingStarBatch('42', { batchId: batch.id }, deps)).rejects.toThrow('等待');
  clock += 5001; await executeReadingStarBatch('42', { batchId: batch.id }, deps); expect((await latest()).batch.status).toBe('completed');
});
it('pauses on expired token rather than attempting all remaining projects', async () => {
  vi.mocked(deps.api.getRepository).mockRejectedValueOnce(Error('GitHub token expired or invalid')); await run();
  expect((await latest()).batch.rows[1].status).toBe('queued'); expect(deps.api.getRepository).toHaveBeenCalledTimes(1);
});
it('records a lost write response as uncertain and reconciles before retry without another Star', async () => {
  vi.mocked(deps.api.starRepository).mockRejectedValueOnce(TypeError('network lost')); await run(['1']);
  const { batch } = await latest(); expect(batch.rows[0].status).toBe('uncertain');
  vi.mocked(deps.api.isRepositoryStarred).mockResolvedValue(true); await executeReadingStarBatch('42', { batchId: batch.id }, deps);
  expect(deps.api.starRepository).toHaveBeenCalledTimes(1); expect((await latest()).data.states['1'].candidate).toBe(false);
});
it('local persistence failure is recoverable without misreporting the GitHub write', async () => {
  vi.mocked(deps.addRepository).mockRejectedValueOnce(Error('local store unavailable')); await run(['1']);
  const { batch, data } = await latest(); expect(batch.rows[0].status).toBe('local-pending'); expect(data.states['1'].candidate).toBe(true);
  vi.mocked(deps.api.isRepositoryStarred).mockResolvedValue(true); await executeReadingStarBatch('42', { batchId: batch.id }, deps);
  expect(deps.api.starRepository).toHaveBeenCalledTimes(1); expect((await latest()).batch.rows[0].status).toBe('starred');
});
it('does not issue Star after the active account changes during lookup', async () => {
  vi.mocked(deps.api.getRepository).mockImplementation(async () => { current = false; return repo(1); }); await run();
  expect(deps.api.starRepository).not.toHaveBeenCalled(); expect(deps.addRepository).not.toHaveBeenCalled(); expect((await latest()).data.states['1'].candidate).toBe(true);
});
it('keeps original-account uncertainty when account switches while GitHub accepts', async () => {
  vi.mocked(deps.api.starRepository).mockImplementation(async () => { current = false; }); await run(['1']);
  expect(deps.addRepository).not.toHaveBeenCalled(); expect((await latest()).batch.rows[0].status).toBe('local-pending');
  expect((await readCandidateWorkspace('43')).states).toEqual({});
});
it('stops further writes but retains an already accepted response', async () => {
  vi.mocked(deps.api.starRepository).mockImplementation(async () => { stopReadingStarBatch('42'); }); await run();
  expect(deps.api.starRepository).toHaveBeenCalledTimes(1); const { batch } = await latest(); expect(batch.rows[0].status).toBe('starred'); expect(batch.rows[1].status).toBe('queued');
});
it('does not clear a newer candidate reimported during an accepted write', async () => {
  vi.mocked(deps.api.starRepository).mockImplementation(async () => { await candidateTransaction('42', data => { data.candidateSources['1'] = { repoId: 1, operationId: 'new', importId: 'new-import', fileName: 'new.json', snapshotId: 'new', importedAt: '2026-10-06' }; }); });
  await run(['1']); expect((await latest()).data.states['1'].candidate).toBe(true);
});
it('refuses simultaneous duplicate execution and releases its lock on completion', async () => {
  let release!: (value: Repository) => void;
  vi.mocked(deps.api.getRepository).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = run(['1']); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  expect(isReadingStarBatchRunning('42')).toBe(true); await expect(run(['1'])).rejects.toThrow('已有'); release(repo(1)); await pending;
  expect(isReadingStarBatchRunning('42')).toBe(false);
});

it('retains interrupted batches for manual recovery and activates only the confirmed new batch', async () => {
  await candidateTransaction('42', data => { data.starBatches.old = { id: 'old', accountId: '42', createdAt: '2026-10-05', updatedAt: '2026-10-05', status: 'running', rows: [{ repoId: 3, name: 'acme/tool3', sourceFingerprint: candidateFingerprint(data,3), status: 'queued' }] }; });
  await run(['1']);
  const data = (await latest()).data;
  expect(data.starBatches.old).toMatchObject({ status: 'paused', rows: [{ status: 'queued' }] });
  expect(data.states['3'].candidate).toBe(true);
  expect(deps.api.starRepository).toHaveBeenCalledOnce();
});
it('reports sync failure separately without retrying successful Stars', async () => {
  vi.mocked(deps.sync).mockRejectedValue(Error('sync offline')); await run(['1']);
  const { batch } = await latest(); expect(batch.status).toBe('completed'); expect(batch.syncError).toBe('sync offline');
  await expect(executeReadingStarBatch('42', { batchId: batch.id }, deps)).rejects.toThrow('已完成');
});

it('retains reconciliation through failed reads and renderer interruption after a newer candidate import', async () => {
  vi.mocked(deps.addRepository).mockRejectedValueOnce(Error('disk unavailable')); await run(['1']);
  const { batch } = await latest();
  await candidateTransaction('42', data => { data.candidateSources['1'] = { repoId: 1, operationId: 'new', importId: 'new', fileName: 'new.json', snapshotId: 'new', importedAt: '2026-10-06' }; });
  vi.mocked(deps.api.getRepository).mockRejectedValueOnce(TypeError('lookup offline'));
  await executeReadingStarBatch('42', { batchId: batch.id }, deps);
  expect((await latest()).batch.rows[0]).toMatchObject({ status: 'local-pending', reconcileRequired: true });
  // Simulate termination while the recovery lookup is in flight.
  await candidateTransaction('42', data => { data.starBatches[batch.id].rows[0].status = 'checking'; });
  vi.mocked(deps.api.isRepositoryStarred).mockResolvedValue(true);
  await executeReadingStarBatch('42', { batchId: batch.id }, deps);
  expect(deps.addRepository).toHaveBeenCalledTimes(2); expect(deps.api.starRepository).toHaveBeenCalledTimes(1);
  expect((await latest()).data.states['1'].candidate).toBe(true);
});

it('enforces write spacing across paused batches after a rejected PUT', async () => {
  const timestamps: number[] = [];
  vi.mocked(deps.api.starRepository).mockImplementation(async () => { timestamps.push(clock); throw Object.assign(Error('forbidden'), { status: 403 }); });
  await run(['1']); await run(['2']); expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(1000);
});

it('preserves the accepted-write outcome through repeated local persistence failures', async () => {
  vi.mocked(deps.addRepository).mockRejectedValueOnce(Error('disk unavailable')).mockRejectedValueOnce(Error('disk still unavailable'));
  await run(['1']); const { batch } = await latest(); vi.mocked(deps.api.isRepositoryStarred).mockResolvedValue(true);
  await executeReadingStarBatch('42', { batchId: batch.id }, deps);
  expect((await latest()).batch.rows[0]).toMatchObject({ status: 'local-pending', outcome: 'starred' });
  await executeReadingStarBatch('42', { batchId: batch.id }, deps);
  expect((await latest()).batch.rows[0]).toMatchObject({ status: 'starred', outcome: 'starred' });
  expect(deps.api.starRepository).toHaveBeenCalledTimes(1);
});

const projectsRequest = async (ids = ['1']) => ({ ids, selectionMode: 'projects' as const, expectedFingerprints: Object.fromEntries(ids.map(id => [id, readingProjectFingerprint(projectsData!, id)])) });
let projectsData: Awaited<ReturnType<typeof readCandidateWorkspace>>;
const runProjects = async (ids = ['1']) => { projectsData = await readCandidateWorkspace('42'); return executeReadingStarBatch('42', await projectsRequest(ids), deps); };
it('direct projects mode Stars explicitly selected noncandidates and only completes after local durability', async () => {
  await candidateTransaction('42', data => { data.states['1'].candidate = false; });
  let release!: () => void;
  vi.mocked(deps.addRepository).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = runProjects(); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const before = await latest(); expect(before.data.processing?.['1'].processed).toBe(false); expect(before.batch.rows[0].status).toBe('local-pending');
  release(); await pending;
  const after = await latest(); expect(after.batch.selectionMode).toBe('projects'); expect(after.data.processing?.['1']).toMatchObject({ processed: true, reason: 'starred' });
  expect(after.data.starObservations?.['1']).toMatchObject({ starred: true, checkedAt: expect.any(String) });
  expect(deps.api.starRepository).toHaveBeenCalledOnce(); expect(after.data.processing?.['2'].processed).toBe(false);
});
it('direct mode requires reviewed fingerprints and rejects stale processing edits without a batch or PUT', async () => {
  await expect(executeReadingStarBatch('42', { ids: ['1'], selectionMode: 'projects' } as never, deps)).rejects.toThrow('重新确认');
  const data = await readCandidateWorkspace('42'); const expectedFingerprints = { '1': readingProjectFingerprint(data, 1) };
  await candidateTransaction('42', data => { data.processing!['1'] = { processed: true, reason: 'manual', updatedAt: 'now' }; });
  await expect(executeReadingStarBatch('42', { ids: ['1'], selectionMode: 'projects', expectedFingerprints }, deps)).rejects.toThrow('已变化');
  expect(deps.api.starRepository).not.toHaveBeenCalled(); expect(Object.values((await latest()).data.starBatches)).toHaveLength(0);
});
it('fresh direct-project note or source import during PUT stays pending after durable save', async () => {
  vi.mocked(deps.api.starRepository).mockImplementation(async () => {
    await candidateTransaction('42', data => { data.states['1'].note = 'fresh import'; data.projectSources!['1'] = { repoId: 1, operationId: 'new', importId: 'new', fileName: 'new.json', snapshotId: 'new', importedAt: '2026-10-06' }; });
  });
  await runProjects(); const { data, batch } = await latest();
  expect(batch.rows[0].status).toBe('starred'); expect(data.states['1'].candidate).toBe(true); expect(data.processing?.['1'].processed).toBe(false);
});
it('new candidate-mode batches retain a candidate when a fresh note arrives during Star', async () => {
  vi.mocked(deps.api.starRepository).mockImplementation(async () => {
    await candidateTransaction('42', data => { data.states['1'].note = 'new phone note'; });
  });
  await run(['1']);
  const { data, batch } = await latest();
  expect(batch.rows[0].status).toBe('starred');
  expect(data.states['1']).toMatchObject({ candidate: true, note: 'new phone note' });
  expect(data.processing?.['1'].processed).toBe(false);
});
it('direct already-starred project with failed local persistence stays pending while known Star remains true', async () => {
  vi.mocked(deps.api.isRepositoryStarred).mockResolvedValue(true); vi.mocked(deps.addRepository).mockRejectedValueOnce(Error('disk failure'));
  await runProjects(); const { data, batch } = await latest();
  expect(deps.api.starRepository).not.toHaveBeenCalled(); expect(data.processing?.['1'].processed).toBe(false); expect(data.starObservations?.['1'].starred).toBe(true); expect(batch.rows[0].status).toBe('local-pending');
});
it('direct project selection changed during lookup cannot issue PUT', async () => {
  vi.mocked(deps.api.getRepository).mockImplementation(async () => { await candidateTransaction('42', data => { data.states['1'].note = 'changed after confirmation'; }); return repo(1); });
  await runProjects(); expect(deps.api.starRepository).not.toHaveBeenCalled(); expect((await latest()).batch.rows[0].status).toBe('skipped');
});
it('stopping direct noncandidate processing during lookup sends no PUT and preserves pending', async () => {
  await candidateTransaction('42', data => { data.states['1'].candidate = false; });
  vi.mocked(deps.api.getRepository).mockImplementation(async () => { stopReadingStarBatch('42'); return repo(1); });
  await runProjects(); expect(deps.api.starRepository).not.toHaveBeenCalled(); expect((await latest()).data.processing?.['1'].processed).toBe(false);
});
