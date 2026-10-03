import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeSync } from '../home/sync';
import type { HomeTask } from '../home/types';

const mocks = vi.hoisted(() => ({ pending: vi.fn(), recover: vi.fn(), storage: { getItem: vi.fn(), setItem: vi.fn() } }));
vi.mock('../home/taskSubmission', () => ({ readPendingTaskRequest: mocks.pending, recoverPendingTaskRequest: mocks.recover }));
vi.mock('./indexedDbStorage', () => ({ indexedDBStorage: mocks.storage }));
let dispose: (() => void) | undefined;
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); mocks.pending.mockResolvedValue(null); mocks.recover.mockResolvedValue(null); mocks.storage.getItem.mockResolvedValue(null); mocks.storage.setItem.mockResolvedValue(undefined); });
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
  it('uses server ids and only exposes real controls, never raw input', async () => {
    const f = await fixture(); dispose = f.watchRemoteTasks(() => f.sync, '7'); await vi.advanceTimersByTimeAsync(0);
    const task = f.journal.snapshot()[0]; expect(task).toMatchObject({ id: 'server:workspace:original-server-id', remoteId: 'original-server-id', state: 'running' });
    expect(JSON.stringify(task)).not.toContain('DO_NOT_EXPORT'); expect(f.journal.supports(task.id, 'pause')).toBe(false);
    f.api.request.mockResolvedValueOnce(remote('cancelled')); f.journal.control(task.id, 'stop'); await vi.advanceTimersByTimeAsync(0);
    expect(f.api.request).toHaveBeenLastCalledWith('/tasks/original-server-id/cancel', f.sync.identity, expect.any(AbortSignal));
    expect(f.journal.snapshot()[0].state).toBe('canceled');
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
    const f = await fixture(); mocks.pending.mockResolvedValue({ requestId: 'pending-id', kind: 'research' });
    f.api.request.mockResolvedValueOnce({ tasks: [] }); dispose = f.watchRemoteTasks(() => f.sync, '7'); await vi.advanceTimersByTimeAsync(0);
    expect(f.journal.snapshot()[0]).toMatchObject({ state: 'unconfirmed', target: { view: 'settings', tab: 'backend' } });
    f.api.request.mockResolvedValueOnce({ tasks: [{ ...remote(), requestId: 'pending-id' }] }); await vi.advanceTimersByTimeAsync(5000);
    expect(f.journal.snapshot()[0].state).toBe('complete');
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
    mocks.pending.mockResolvedValue(null);
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.journal.snapshot().find(task => task.id.startsWith('submission-invalid:'))?.state).toBe('complete');
  });

  it('recovers a pending submission only on explicit action and associates the original receipt', async () => {
    const f = await fixture(); mocks.pending.mockResolvedValue({ requestId: 'original-request', kind: 'summary' });
    mocks.recover.mockResolvedValue(remote()); f.api.request.mockResolvedValue({ tasks: [] });
    dispose = f.watchRemoteTasks(() => f.sync, '7'); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.recover).not.toHaveBeenCalled();
    const id = f.journal.snapshot()[0].id;
    f.journal.control(id, 'resume'); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.recover).toHaveBeenCalledExactlyOnceWith(f.sync);
    expect(f.journal.snapshot().find(task => task.id === id)?.state).toBe('complete');
    expect(f.journal.snapshot()).toEqual(expect.arrayContaining([expect.objectContaining({ remoteId: 'original-server-id' })]));
    expect(f.api.request.mock.calls.every(args => args[0].startsWith('/tasks?'))).toBe(true);
  });
});
