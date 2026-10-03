import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn() }));
vi.mock('./indexedDbStorage', () => ({ indexedDBStorage: storage }));

async function journal() { return (await import('./aiTaskJournal')).aiTaskJournal; }
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear();
  storage.getItem.mockResolvedValue(null); storage.setItem.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('task journal persistence and lifecycle', () => {
  it('keeps stable order and persists more than twenty active tasks', async () => {
    const api = await journal();
    const handles = Array.from({ length: 31 }, (_, index) => api.begin('owner', 'summary', [{ id: String(index), label: `repo-${index}` }]));
    handles[0].item('0', 'running'); handles[10].progress(2, 4);
    expect(api.snapshot().map(task => task.id)).toEqual(handles.map(task => task.id));
    await api.flush('owner');
    const data = JSON.parse(storage.setItem.mock.calls[storage.setItem.mock.calls.length - 1][1]);
    expect(data).toHaveLength(31);
  });

  it('migrates unfinished legacy records without inventing metadata or auto-executing', async () => {
    localStorage.setItem('gsm:ai-task-journal:owner', JSON.stringify([{ id: 'legacy', owner: 'owner', kind: 'summary', state: 'running', updatedAt: new Date().toISOString(), items: [{ id: '1', label: 'repo', state: 'running' }] }]));
    const api = await journal(); await api.load('owner');
    expect(api.snapshot()[0]).toMatchObject({ state: 'interrupted', items: [{ state: 'pending' }] });
    expect(api.snapshot()[0].startedAt).toBeUndefined(); expect(api.live('legacy')).toBe(false);
  });

  it('derives partial and failed outcomes and ignores late updates', async () => {
    const api = await journal();
    const task = api.begin('owner', 'summary', [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    task.item('a', 'complete'); task.item('b', 'failed', new Error('Rate limit')); task.finish();
    expect(api.snapshot()[0]).toMatchObject({ state: 'partial', items: [{ state: 'complete' }, { state: 'failed', error: 'Rate limit' }] });
    task.item('b', 'complete'); task.finish('complete');
    expect(api.snapshot()[0].state).toBe('partial');
  });

  it('prefers IndexedDB to stale legacy duplicates and cleans migrated storage', async () => {
    const record = { id: 'legacy', owner: 'owner', kind: 'summary', state: 'failed', updatedAt: new Date().toISOString(), items: [] };
    localStorage.setItem('gsm:ai-task-journal:owner', JSON.stringify([record]));
    storage.getItem.mockImplementation(async (key: string) => key.endsWith(':hidden') ? null : JSON.stringify([{ ...record, state: 'complete' }]));
    const api = await journal(); await api.load('owner');
    expect(api.snapshot()[0].state).toBe('complete');
    expect(localStorage.getItem('gsm:ai-task-journal:owner')).toBeNull();
  });

  it('retains legacy logs if migration cannot persist', async () => {
    localStorage.setItem('gsm:ai-task-journal:owner', JSON.stringify([]));
    storage.setItem.mockRejectedValue(new Error('disk'));
    const api = await journal(); await api.load('owner');
    expect(localStorage.getItem('gsm:ai-task-journal:owner')).not.toBeNull();
  });

  it('displays mixed explicit failures as partial without changing running states', async () => {
    const { taskDisplayState } = await import('./aiTaskJournal');
    const record = { id: 'a', owner: 'owner', kind: 'summary' as const, state: 'failed' as const, updatedAt: new Date().toISOString(), items: [{ id: 'a', label: 'A', state: 'complete' as const }, { id: 'b', label: 'B', state: 'failed' as const }] };
    expect(taskDisplayState(record)).toBe('partial');
    expect(taskDisplayState({ ...record, state: 'running' })).toBe('running');
  });

  it('pauses only after in-flight items finish and disallows controls during commit', async () => {
    const api = await journal(); const stop = vi.fn(), pause = vi.fn();
    const task = api.begin('owner', 'summary', [{ id: 'a', label: 'A' }]); task.bind({ stop, pause }); task.item('a', 'running');
    api.control(task.id, 'pause'); task.state('paused');
    expect(api.snapshot()[0].state).toBe('pausing'); task.item('a', 'complete');
    expect(api.snapshot()[0].state).toBe('paused'); task.state('committing'); api.control(task.id, 'stop'); expect(stop).not.toHaveBeenCalled();
  });

  it('never removes live records and preserves completed results on stop', async () => {
    const api = await journal(); const task = api.begin('owner', 'summary', [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    task.bind({ stop: vi.fn() }); task.item('a', 'complete'); api.archive([task.id], true); api.remove([task.id]); expect(api.snapshot()).toHaveLength(1);
    api.control(task.id, 'stop'); task.finish(); expect(api.snapshot()[0]).toMatchObject({ state: 'canceled', items: [{ state: 'complete' }, { state: 'canceled' }] });
    api.archive([task.id], true); expect(api.snapshot()[0].archived).toBe(true); api.remove([task.id]); expect(api.snapshot()).toHaveLength(0);
  });

  it('isolates owner cancellation and does not cancel server jobs', async () => {
    const api = await journal(); const stops = [vi.fn(), vi.fn(), vi.fn()];
    ['a', 'b', 'a'].forEach((owner, index) => api.begin(owner, 'sync', [], undefined, undefined, { location: index === 2 ? 'server' : 'device' }).bind({ stop: stops[index] }));
    api.stopOwner('a'); expect(stops[0]).toHaveBeenCalledOnce(); expect(stops[1]).not.toHaveBeenCalled(); expect(stops[2]).not.toHaveBeenCalled();
  });

  it('expires only unarchived successful and canceled history', async () => {
    const api = await journal(); const old = new Date(Date.now() - 40 * 86400000).toISOString();
    for (const state of ['complete', 'failed', 'interrupted', 'unconfirmed', 'running'] as const) api.project({ id: state, owner: 'a', kind: 'sync', state, updatedAt: old, endedAt: state === 'running' ? undefined : old, items: [] });
    await api.flush('a'); expect(api.snapshot().map(task => task.id)).toEqual(['failed', 'interrupted', 'unconfirmed', 'running']);
  });

  it('surfaces storage failures and redacts secrets in errors', async () => {
    storage.setItem.mockRejectedValue(new Error('disk')); const api = await journal();
    const task = api.begin('owner', 'chat', []); task.error('token=private Bearer secret C:\\private\\file'); await api.flush('owner');
    expect(api.storageError()).toBe('TASK_STORAGE_FAILED'); expect(api.snapshot()[0].error).not.toContain('private');
  });
});
