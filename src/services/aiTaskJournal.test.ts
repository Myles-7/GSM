import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { taskJournalStorage } from './taskJournalStorage';
import { indexedDBStorage } from './indexedDbStorage';

async function journal() { return (await import('./aiTaskJournal')).aiTaskJournal; }
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear();
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('task journal persistence and lifecycle', () => {
  it('retains completed tasks that still need a save or hold a recoverable result', async () => {
    const { aiTaskJournal: api, taskNeedsAttention } = await import('./aiTaskJournal');
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    const base = { owner: 'recovery-owner', kind: 'details' as const, state: 'complete' as const,
      trigger: 'automatic' as const, updatedAt: old, endedAt: old,
      items: [{ id: 'repo', label: 'Repo', state: 'complete' as const, providerOutcome: 'succeeded' as const }] };
    const failed = { ...base, id: 'save-failed', commitStatus: 'failed' as const };
    const recoverable = { ...base, id: 'save-pending', items: [{ ...base.items[0], recovery: { requestId: 'pending-result' } }] };
    const saved = { ...base, id: 'saved', commitStatus: 'saved' as const };
    expect(taskNeedsAttention(failed)).toBe(true);
    expect(taskNeedsAttention(recoverable)).toBe(true);
    expect(taskNeedsAttention(saved)).toBe(false);
    for (const record of [failed, recoverable, saved]) api.project(record);
    await api.flush(base.owner);
    expect(api.snapshot().map(task => task.id)).toEqual(['save-failed', 'save-pending']);
    vi.resetModules(); const reloaded = await journal(); await reloaded.load(base.owner);
    expect(reloaded.snapshot().map(task => task.id)).toEqual(['save-failed', 'save-pending']);
  });
  it('keeps unknown outcomes per item while healthy siblings retain their saved results', async () => {
    const api = await journal();
    const task = api.begin('items', 'details', [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    task.itemExecution('a', { providerOutcome: 'unknown', failureCode: 'AGY_TIMEOUT', requestId: 'request-a' });
    task.item('a', 'failed', 'timeout');
    task.itemExecution('b', { providerOutcome: 'succeeded', commitStatus: 'saved', requestId: 'request-b' });
    task.item('b', 'complete'); task.finish();
    await api.flush('items');
    expect(api.snapshot()[0]).toMatchObject({ state: 'partial', providerOutcome: 'unknown', failureCode: 'unknown_provider_outcome',
      items: [{ providerOutcome: 'unknown', requestId: 'request-a' }, { providerOutcome: 'succeeded', commitStatus: 'saved', requestId: 'request-b' }] });
  });
  it('preserves a local persistence failure while another item reports a lifecycle phase', async () => {
    const api = await journal(); const task = api.begin('items', 'details', [{ id: 'a', label: 'A' }]);
    task.commit('failed', 'LOCAL_PERSISTENCE_FAILED');
    task.itemExecution('a', { phase: 'cleanup' });
    expect(api.snapshot()[0].failureCode).toBe('LOCAL_PERSISTENCE_FAILED');
  });
  it('reloads per-task records and treats an empty migrated owner as authoritative', async () => {
    let api = await journal();
    const task = api.begin('owner', 'sync', []); task.finish('complete'); await api.flush('owner');
    localStorage.setItem('gsm:ai-task-journal:owner', JSON.stringify(api.snapshot()));
    vi.resetModules(); api = await journal(); await api.load('owner');
    expect(api.snapshot()).toHaveLength(1);
    api.remove([task.id]); await api.flush('owner');
    vi.resetModules(); api = await journal(); await api.load('owner');
    expect(api.snapshot()).toEqual([]);
  });

  it('rolls back a partially attempted migration and retries without losing the legacy source', async () => {
    const legacy = [{ id: 'old', owner: 'owner', kind: 'sync', state: 'complete', updatedAt: new Date().toISOString(), items: [] }];
    localStorage.setItem('gsm:ai-task-journal:owner', JSON.stringify(legacy));
    const put = IDBObjectStore.prototype.put;
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'owners') throw Error('fail at migration marker');
      return put.call(this, value, key);
    });
    let api = await journal(); await api.load('owner');
    expect(api.snapshot()).toHaveLength(1);
    expect((await taskJournalStorage.read('owner')).initialized).toBe(false);
    expect(localStorage.getItem('gsm:ai-task-journal:owner')).toBe(JSON.stringify(legacy));
    fault.mockRestore(); await api.flush('owner');
    vi.resetModules(); api = await journal(); await api.load('owner');
    expect(api.snapshot()).toHaveLength(1);
  });

  it('writes only one changed task with 10,000 records and no task data for a day of no-op activity', async () => {
    const at = new Date().toISOString();
    await taskJournalStorage.commit('owner', { initialize: true, removals: [], upserts: Array.from({ length: 10_000 }, (_, i) => ({ id: String(i), owner: 'owner', kind: 'sync', state: 'complete', updatedAt: at, items: [] })) });
    const api = await journal(); await api.load('owner');
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    api.patch('42', { title: 'one edit' }); await api.flush('owner');
    expect(put.mock.instances.filter(store => (store as IDBObjectStore).name === 'tasks')).toHaveLength(1);
    put.mockClear();
    for (let i = 0; i < 17_280; i++) api.noteActivity('owner', { noChange: true });
    await api.flush('owner');
    expect(put.mock.instances.filter(store => (store as IDBObjectStore).name === 'tasks')).toHaveLength(0);
    expect(api.activity('owner').runCount).toBe(17_280);
  },20000);

  it('retries a failed task update and physically deletes removed records', async () => {
    const api = await journal(); const task = api.begin('owner', 'sync', []); task.finish('complete'); await api.flush('owner');
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw Error('disk'); });
    api.patch(task.id, { title: 'durable retry' }); await api.flush('owner');
    expect(api.storageError()).toBe('TASK_STORAGE_FAILED');
    put.mockRestore(); await api.flush('owner');
    expect((await taskJournalStorage.read('owner')).records[0]).toMatchObject({ title: 'durable retry' });
    api.remove([task.id]); await api.flush('owner');
    expect((await taskJournalStorage.read('owner')).records).toEqual([]);
  });

  it('retains thirty-day automatic history without the old two-hundred task cap', async () => {
    const api = await journal();
    for (let i = 0; i < 240; i++) api.begin('owner', 'sync', [], undefined, undefined, { trigger: 'automatic' }).finish('complete');
    const attention = api.begin('owner', 'sync', [], undefined, undefined, { trigger: 'automatic' }); attention.finish('failed');
    await api.flush('owner');
    expect(api.snapshot()).toHaveLength(241);
    expect(api.snapshot().some(record => record.id === attention.id)).toBe(true);
  });
  it('keeps stable order and persists more than twenty active tasks', async () => {
    const api = await journal();
    const handles = Array.from({ length: 31 }, (_, index) => api.begin('owner', 'summary', [{ id: String(index), label: `repo-${index}` }]));
    handles[0].item('0', 'running'); handles[10].progress(2, 4);
    expect(api.snapshot().map(task => task.id)).toEqual(handles.map(task => task.id));
    await api.flush('owner');
    expect((await taskJournalStorage.read('owner')).records).toHaveLength(31);
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
    await indexedDBStorage.setItem('gsm:ai-task-journal:owner', JSON.stringify([{ ...record, state: 'complete' }]));
    const api = await journal(); await api.load('owner');
    expect(api.snapshot()[0].state).toBe('complete');
    expect((await taskJournalStorage.read('owner')).initialized).toBe(true);
  });

  it('retains legacy logs if migration cannot persist', async () => {
    localStorage.setItem('gsm:ai-task-journal:owner', JSON.stringify([]));
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw Error('disk'); });
    const api = await journal(); await api.load('owner');
    expect(localStorage.getItem('gsm:ai-task-journal:owner')).not.toBeNull();
  });

  it('displays mixed explicit failures as partial without changing running states', async () => {
    const { taskDisplayState } = await import('./aiTaskJournal');
    const record = { id: 'a', owner: 'owner', kind: 'summary' as const, state: 'failed' as const, updatedAt: new Date().toISOString(), items: [{ id: 'a', label: 'A', state: 'complete' as const }, { id: 'b', label: 'B', state: 'failed' as const }] };
    expect(taskDisplayState(record)).toBe('partial');
    expect(taskDisplayState({ ...record, state: 'running' })).toBe('running');
    expect(taskDisplayState({ ...record, state: 'partial', items: [{ id: 'failed', label: 'Failed', state: 'failed' }, { id: 'pending', label: 'Pending', state: 'pending' }] })).toBe('failed');
  });

  it('pauses only after in-flight items finish and disallows controls during commit', async () => {
    const api = await journal(); const stop = vi.fn(), pause = vi.fn();
    const task = api.begin('owner', 'summary', [{ id: 'a', label: 'A' }]); task.bind({ stop, pause }); task.item('a', 'running');
    api.control(task.id, 'pause'); task.state('paused');
    expect(api.snapshot()[0].state).toBe('pausing'); task.item('a', 'complete');
    expect(api.snapshot()[0].state).toBe('paused'); task.state('committing'); api.control(task.id, 'stop'); expect(stop).not.toHaveBeenCalled();
  });

  it('aggregates concurrent item phases instead of displaying the latest callback as the whole task',async()=>{
    const api=await journal();const task=api.begin('owner','exploration',[{id:'a',label:'A'},{id:'b',label:'B'}]);
    task.item('a','running');task.item('b','running');task.itemExecution('a',{phase:'generating'});task.itemExecution('b',{phase:'cleanup'});
    expect(api.snapshot()[0].phase).toBe('generating');
    task.itemExecution('a',{phase:'initializing'});expect(api.snapshot()[0].phase).toBe('initializing');
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

  it('expires unprotected finished history after 30 days while preserving unresolved tasks', async () => {
    const api = await journal(); const old = new Date(Date.now() - 40 * 86400000).toISOString();
    for (const state of ['complete', 'failed', 'interrupted', 'unconfirmed', 'running'] as const) api.project({ id: state, owner: 'a', kind: 'sync', state, updatedAt: old, endedAt: state === 'running' ? undefined : old, items: [] });
    await api.flush('a'); expect(api.snapshot().map(task => task.id)).toEqual(['interrupted', 'unconfirmed', 'running']);
  });

  it('surfaces storage failures and redacts secrets in errors', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw Error('disk'); }); const api = await journal();
    const task = api.begin('owner', 'chat', []); task.error('token=private Bearer secret C:\\private\\file'); await api.flush('owner');
    expect(api.storageError()).toBe('TASK_STORAGE_FAILED'); expect(api.snapshot()[0].error).not.toContain('private');
  });

  it('writes task records independently and aggregates automatic activity', async () => {
    const api = await journal(); const task = api.begin('owner', 'sync', [{ id: 'one', label: 'one' }], undefined, undefined, { trigger: 'automatic' });
    task.finish('complete'); api.noteActivity('owner', { noChange: true }); await api.flush('owner');
    expect((await taskJournalStorage.read('owner')).records).toHaveLength(1);
    expect(api.activity('owner')).toMatchObject({ runCount: 1, noChangeCount: 1 });
  });

  it('keeps the legacy blob as a rollback source after v2 migration', async () => {
    const legacy = { id: 'legacy-v2', owner: 'owner', kind: 'sync', state: 'complete', updatedAt: new Date().toISOString(), endedAt: new Date().toISOString(), items: [] };
    await indexedDBStorage.setItem('gsm:ai-task-journal:owner', JSON.stringify([legacy]));
    const api = await journal(); await api.load('owner'); expect(api.snapshot()[0].id).toBe('legacy-v2');
    expect((await taskJournalStorage.read('owner')).initialized).toBe(true);
    expect(await indexedDBStorage.getItem('gsm:ai-task-journal:owner')).toBe(JSON.stringify([legacy]));
  });
});
