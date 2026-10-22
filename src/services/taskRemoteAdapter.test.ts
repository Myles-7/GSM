import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeSync } from '../home/sync';
import type { HomeTask } from '../home/types';

const mocks = vi.hoisted(() => ({ pending: vi.fn(), recover: vi.fn(), confirm: vi.fn(), storage: { getItem: vi.fn(), setItem: vi.fn() } }));
vi.mock('../home/taskSubmission', () => ({ readPendingTaskRequests: mocks.pending, lookupTaskReceipt: mocks.recover, confirmPolledTaskReceipt: mocks.confirm }));
vi.mock('./taskJournalStorage', () => ({ taskJournalStorage: { read: async () => ({ initialized: true, records: [], hidden: [] }), commit: async () => {} } }));
let dispose: (() => void) | undefined;
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); mocks.pending.mockResolvedValue([]); mocks.recover.mockResolvedValue(null); mocks.confirm.mockResolvedValue(undefined); mocks.storage.getItem.mockResolvedValue(null); mocks.storage.setItem.mockResolvedValue(undefined); });
afterEach(() => { dispose?.(); dispose = undefined; vi.useRealTimers(); });
const remote = (status = 'running'): HomeTask => ({ id: 'original-server-id', requestId: 'original-request', kind: 'summary', status,
  input: { repositories: ['owner/repo'], prompt: 'DO_NOT_EXPORT' }, createdAt: '2026-10-02T08:00:00.000Z', updatedAt: '2026-10-02T08:01:00.000Z' });
async function fixture() {
  const api = { request: vi.fn().mockResolvedValue({ tasks: [remote()] }) };
  const sync = { identity: { workspaceId: 'workspace', githubUserId: 7 }, api } as unknown as HomeSync;
  const { watchRemoteTasks, projectRemoteTask } = await import('./taskRemoteAdapter');
  const { aiTaskJournal } = await import('./aiTaskJournal');
  return { api, sync, watchRemoteTasks, projectRemoteTask, journal: aiTaskJournal };
}
describe('authoritative remote task projection', () => {
  it('routes persistent dispatch pause and continuation separately from failure recovery', async () => {
    const f=await fixture();
    const capable={...remote(),input:{repositories:['owner/one','owner/two']},capabilities:{pause:true,cancel:true,resume:'unsupported' as const}};
    f.api.request.mockResolvedValue({tasks:[capable]});dispose=f.watchRemoteTasks(()=>f.sync,'7');await vi.advanceTimersByTimeAsync(0);
    const id=f.journal.snapshot()[0].id;expect(f.journal.supports(id,'pause')).toBe(true);
    f.api.request.mockResolvedValueOnce({...capable,pauseRequested:true});f.journal.control(id,'pause');await vi.advanceTimersByTimeAsync(0);
    expect(f.api.request).toHaveBeenLastCalledWith('/tasks/original-server-id/pause',f.sync.identity,expect.any(AbortSignal));expect(f.journal.snapshot()[0].state).toBe('pausing');
    f.api.request.mockResolvedValue({tasks:[{...capable,status:'paused',pauseRequested:true}]});await vi.advanceTimersByTimeAsync(5000);
    expect(f.journal.snapshot()[0].state).toBe('paused');expect(f.journal.supports(id,'resume')).toBe(true);expect(f.journal.supports(id,'stop')).toBe(true);
    f.api.request.mockResolvedValueOnce({...capable,status:'queued',pauseRequested:false});f.journal.control(id,'resume');await vi.advanceTimersByTimeAsync(0);
    expect(f.api.request).toHaveBeenLastCalledWith('/tasks/original-server-id/continue',f.sync.identity,expect.any(AbortSignal));expect(f.api.request.mock.calls.some(([url])=>url.endsWith('/resume'))).toBe(false);
  });
  it('preserves existing repository request and recovery references when refreshing server state',async()=>{
    const f=await fixture();const original=f.projectRemoteTask(f.sync,remote());
    f.journal.patch(original.id,{items:[{...original.items[0],requestId:'provider-request',recovery:{requestId:'recovery'},validationStatus:'passed'}]});
    const projected=f.projectRemoteTask(f.sync,{...remote('completed'),result:{content:'actual',data:{summary:'actual'}}});
    expect(projected.items[0]).toMatchObject({requestId:'provider-request',recovery:{requestId:'recovery'},validationStatus:'passed',state:'complete'});expect(projected.units).toEqual({items:'repositories',repositories:1});
  });
  it('requires conflict review before rebasing a commit and never calls resume', async () => {
    const f = await fixture();
    const conflict = { ...remote('completed'), commitStatus: 'conflict' as const, providerOutcome: 'succeeded' as const };
    f.api.request.mockImplementation(async (url: string) => url.includes('/commit-preview?')
      ? { targets: [{ repositoryId: '1', repository: 'owner/repo', currentVersion: 3, expectedVersion: 1, fields: ['ai_summary'] }] }
      : url.endsWith('/commit') ? { ...conflict, commitStatus: 'saved' } : { tasks: [conflict] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      dispose = f.watchRemoteTasks(() => f.sync, '7'); await vi.advanceTimersByTimeAsync(0);
      const id = f.journal.snapshot()[0].id; f.journal.control(id, 'commit'); await vi.advanceTimersByTimeAsync(0);
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('v1 → v3'));
      expect(f.api.request.mock.calls.some(([url]) => url.endsWith('/commit'))).toBe(false);
      confirm.mockReturnValue(true); f.journal.control(id, 'commit'); await vi.advanceTimersByTimeAsync(0);
      expect(f.api.request).toHaveBeenLastCalledWith('/tasks/original-server-id/commit', { ...f.sync.identity, expectedVersions: { '1': 3 } }, expect.any(AbortSignal));
      expect(f.journal.snapshot()[0].commitStatus).toBe('saved');
      expect(f.api.request.mock.calls.some(([url]) => url.endsWith('/resume'))).toBe(false);
    } finally { confirm.mockRestore(); }
  });
  it('continues bounded cursor scans on the next poll and only reconciles a complete watermark', async () => {
    const f = await fixture();
    f.projectRemoteTask(f.sync, { ...remote(), id: 'ghost' });
    f.api.request.mockImplementation(async (url: string) => {
      if (url.startsWith('/tasks/ghost?')) return { ...remote(), id: 'ghost' };
      const cursor = new URL(url, 'https://fixture.invalid').searchParams.get('cursor');
      const page = cursor ? Number(cursor) : 0;
      return { tasks: [{ ...remote('completed'), id: `page-${page}` }], nextCursor: page < 6 ? String(page + 1) : undefined,
        reconcile: { watermark: 'fixed', asOf: '2026-10-17T00:00:00.000Z', complete: page === 6, deletedIds: [] } };
    });
    dispose = f.watchRemoteTasks(() => f.sync, '7'); await vi.advanceTimersByTimeAsync(0);
    expect(f.journal.snapshot().find(task => task.remoteId === 'ghost')?.state).toBe('running');
    expect(f.api.request.mock.calls.filter(([url]) => url.startsWith('/tasks?'))).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.api.request.mock.calls.filter(([url]) => url.startsWith('/tasks?'))).toHaveLength(7);
    expect(f.journal.snapshot().filter(task => task.remoteId?.startsWith('page-'))).toHaveLength(7);
    expect(f.journal.snapshot().find(task => task.remoteId === 'ghost')).toMatchObject({ state: 'interrupted', failureCode: 'REMOTE_TASK_RECONCILED' });
  });
  it('rejects a changed watermark without reconciling old live tasks', async () => {
    const f = await fixture(); f.projectRemoteTask(f.sync, { ...remote(), id: 'old' });
    f.api.request.mockResolvedValueOnce({ tasks: [], nextCursor: 'next', reconcile: { watermark: 'a' } })
      .mockResolvedValueOnce({ tasks: [], reconcile: { watermark: 'b', complete: true } });
    dispose = f.watchRemoteTasks(() => f.sync, '7'); await vi.advanceTimersByTimeAsync(0);
    expect(f.journal.snapshot()[0]).toMatchObject({ state: 'running', connectionError: 'TASK_RECONCILE_WATERMARK_CHANGED' });
  });
  it('keeps receipt unconfirmed and recoverable when durable cleanup fails', async () => {
    const f = await fixture(); mocks.pending.mockResolvedValue([{ requestId: 'original-request', kind: 'summary' }]);
    mocks.confirm.mockRejectedValue(Error('receipt cleanup failed'));
    dispose = f.watchRemoteTasks(() => f.sync, '7'); await vi.advanceTimersByTimeAsync(0);
    expect(f.journal.snapshot().find(task => task.id.startsWith('submission:'))).toMatchObject({ state: 'unconfirmed', error: 'receipt cleanup failed' });
    expect(f.journal.snapshot().find(task => task.remoteId === 'original-server-id')?.state).toBe('running');
    expect(f.journal.supports('submission:workspace:original-request', 'resume')).toBe(true);
    mocks.confirm.mockResolvedValue(undefined); await vi.advanceTimersByTimeAsync(5000);
    expect(f.journal.snapshot().find(task => task.id.startsWith('submission:'))?.state).toBe('complete');
    expect(f.journal.supports('submission:workspace:original-request', 'resume')).toBe(false);
  });
  it('uses server ids and only exposes real controls, never raw input', async () => {
    const f = await fixture(); dispose = f.watchRemoteTasks(() => f.sync, '7'); await vi.advanceTimersByTimeAsync(0);
    const task = f.journal.snapshot()[0]; expect(task).toMatchObject({ id: 'server:workspace:original-server-id', remoteId: 'original-server-id', state: 'running' });
    expect(JSON.stringify(task)).not.toContain('DO_NOT_EXPORT'); expect(f.journal.supports(task.id, 'pause')).toBe(false);
    f.api.request.mockResolvedValueOnce(remote('cancelled')); f.journal.control(task.id, 'stop'); await vi.advanceTimersByTimeAsync(0);
    expect(f.api.request).toHaveBeenLastCalledWith('/tasks/original-server-id/cancel', f.sync.identity, expect.any(AbortSignal));
    expect(f.journal.snapshot()[0].state).toBe('canceled');
  });
  it('exposes server resume for cancelled tasks when the server says resume is supported', async () => {
    const f = await fixture();
    const cancelled = { ...remote('cancelled'), capabilities: { pause: false, cancel: false, resume: 'safe' as const } };
    f.api.request.mockResolvedValueOnce({ tasks: [cancelled] });
    dispose = f.watchRemoteTasks(() => f.sync, '7'); await vi.advanceTimersByTimeAsync(0);
    const task = f.journal.snapshot().find(item => item.remoteId === cancelled.id)!;
    expect(task.state).toBe('canceled');
    expect(f.journal.supports(task.id, 'resume')).toBe(true);
    f.api.request.mockResolvedValueOnce({ ...cancelled, status: 'queued' });
    f.journal.control(task.id, 'resume'); await vi.advanceTimersByTimeAsync(0);
    expect(f.api.request).toHaveBeenLastCalledWith('/tasks/original-server-id/resume', f.sync.identity, expect.any(AbortSignal));
  });
  it('projects durable completed batch siblings instead of showing the whole interrupted batch pending', async () => {
    const f = await fixture();
    const task = f.projectRemoteTask(f.sync, {
      ...remote('interrupted'),
      input: { repositories: ['owner/one', 'owner/two', 'owner/three'] },
      result: { batch: [{ repository: 'owner/one', status: 'applied' }], pendingRepository: 'owner/two' },
    });
    expect(task.items).toEqual([
      expect.objectContaining({ id: 'owner/one', state: 'complete' }),
      expect.objectContaining({ id: 'owner/two', state: 'failed' }),
      expect.objectContaining({ id: 'owner/three', state: 'pending' }),
    ]);
  });
  it('shows stale receipt on polling failure and never resubmits', async () => {
    const f = await fixture(); dispose = f.watchRemoteTasks(() => f.sync, '7'); await vi.advanceTimersByTimeAsync(0);
    f.api.request.mockRejectedValueOnce(new Error('offline')); await vi.advanceTimersByTimeAsync(5000);
    expect(f.journal.snapshot()[0]).toMatchObject({ state: 'running', connectionError: 'offline' });
    expect(f.journal.supports(f.journal.snapshot()[0].id, 'stop')).toBe(false);
    expect(f.api.request.mock.calls.every(args => args[0].startsWith('/tasks?'))).toBe(true);
    await vi.advanceTimersByTimeAsync(5000); expect(f.journal.snapshot()[0].connectionError).toBeUndefined();
  });
  it('preserves uncertain cancellation without automatic replay', async () => {
    const f = await fixture(); dispose = f.watchRemoteTasks(() => f.sync, '7'); await vi.advanceTimersByTimeAsync(0);
    f.api.request.mockRejectedValueOnce(new Error('lost reply')); f.journal.control(f.journal.snapshot()[0].id, 'stop'); await vi.advanceTimersByTimeAsync(0);
    expect(f.journal.snapshot()[0].state).toBe('unconfirmed');
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.api.request.mock.calls.filter(args => args[0].endsWith('/cancel'))).toHaveLength(1);
  });
  it('shows pending submissions and resolves them by original request id', async () => {
    const f = await fixture(); mocks.pending.mockResolvedValue([{ requestId: 'pending-id', kind: 'research' }]);
    f.api.request.mockResolvedValueOnce({ tasks: [] }); dispose = f.watchRemoteTasks(() => f.sync, '7'); await vi.advanceTimersByTimeAsync(0);
    expect(f.journal.snapshot()[0]).toMatchObject({ state: 'unconfirmed', target: { view: 'settings', tab: 'backend' } });
    f.api.request.mockResolvedValueOnce({ tasks: [{ ...remote(), requestId: 'pending-id' }] }); await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.confirm).toHaveBeenCalled(); expect(f.journal.snapshot()[0].state).toBe('complete');
  });
  it('ignores late replies after owner switch and respects deleted server tombstones', async () => {
    const f = await fixture(); let live: HomeSync | null = f.sync;
    let finish!: (value: unknown) => void; f.api.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    dispose = f.watchRemoteTasks(() => live, '7'); await vi.advanceTimersByTimeAsync(0); live = null;
    finish({ tasks: [remote()] }); await vi.advanceTimersByTimeAsync(0); expect(f.journal.snapshot()).toHaveLength(0);
    const task = f.projectRemoteTask(f.sync, remote('completed')); f.journal.remove([task.id]);
    f.projectRemoteTask(f.sync, remote('completed')); expect(f.journal.snapshot()).toHaveLength(0);
  });

  it('keeps polling actual server tasks when pending metadata is invalid', async () => {
    const f = await fixture(); mocks.pending.mockRejectedValue(new Error('Invalid pending submission'));
    dispose = f.watchRemoteTasks(() => f.sync, '7'); await vi.advanceTimersByTimeAsync(0);
    expect(f.journal.snapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: 'unconfirmed', error: 'Invalid pending submission' }),
      expect.objectContaining({ remoteId: 'original-server-id', state: 'running' }),
    ]));
    expect(mocks.recover).not.toHaveBeenCalled();
    mocks.pending.mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.journal.snapshot().find(task => task.id.startsWith('submission-invalid:'))?.state).toBe('complete');
  });

  it('recovers a pending submission only on explicit action and associates the original receipt', async () => {
    const f = await fixture(); mocks.pending.mockResolvedValue([{ requestId: 'original-request', kind: 'summary' }]);
    mocks.recover.mockResolvedValue(remote()); f.api.request.mockResolvedValue({ tasks: [] });
    dispose = f.watchRemoteTasks(() => f.sync, '7'); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.recover).not.toHaveBeenCalled();
    const id = f.journal.snapshot()[0].id;
    f.journal.control(id, 'resume'); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.recover).toHaveBeenCalledExactlyOnceWith(f.sync, { requestId: 'original-request', kind: 'summary' });
    expect(f.journal.snapshot().find(task => task.id === id)?.state).toBe('complete');
    expect(f.journal.snapshot()).toEqual(expect.arrayContaining([expect.objectContaining({ remoteId: 'original-server-id' })]));
    expect(f.api.request.mock.calls.every(args => args[0].startsWith('/tasks?'))).toBe(true);
  });
});
