import { waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { agyQueueStatus, generateAgyText } from './agyClient';
import { bindTaskSignal, bindTaskItemSignal } from './taskExecution';
import type { AgyEvent } from '../types/agy';
import { aiTaskJournal } from './aiTaskJournal';
import { taskObservability } from './taskObservability';

vi.mock('./taskObservability', async importOriginal => {
  const actual = await importOriginal<typeof import('./taskObservability')>();
  return { ...actual, taskObservability: { ...actual.taskObservability,
    begin: vi.fn(), phase: vi.fn(), append: vi.fn(), complete: vi.fn(), event: vi.fn(),
  } };
});

it('captures linked AGY request channels and reconciles the final answer without replaying chunks', async () => {
  vi.clearAllMocks();
  const listeners = new Set<(event: AgyEvent) => void>();
  const previous = window.electronAPI;
  window.electronAPI = { agy: { setSession: async () => {}, cancel: async () => {},
    onEvent: (listener: (event: AgyEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    start: async (requestId: string, session: string) => {
      for (const event of [{ type: 'sent' }, { type: 'reasoning', text: 'explicit reason' },
        { type: 'observation', observation: { event: 'step_update', stepType: 'agent_response', stepIndex: 2, state: 'running' } },
        { type: 'text', text: '<think>literal</think>' }, { type: 'cleanup' }]) {
        listeners.forEach(listener => listener({ requestId, session, ...event } as AgyEvent));
      }
      return { ok: true, value: { text: '<think>literal</think> final', usage: { output_tokens: 4 } } };
    },
  } } as unknown as typeof previous;
  const controller = new AbortController(), chunks = vi.fn();
  const task = aiTaskJournal.begin('journal-owner', 'details', [{ id: 'repo', label: 'Repository' }]);
  bindTaskItemSignal(controller.signal, task, 'repo');
  try {
    expect(await generateAgyText({ id: 'agy', name: 'AGY', provider: 'agy-cli', model: 'fixture', agyEffort: 'high', agyMode: 'model', isActive: true, deviceBound: true },
      { system: '', user: '', signal: controller.signal, onChunk: chunks })).toBe('<think>literal</think> final');
    expect(taskObservability.begin).toHaveBeenCalledWith(expect.objectContaining({ owner: 'journal-owner', taskId: task.id, itemId: 'repo', source: 'agy', model: 'fixture' }));
    const { requestId } = vi.mocked(taskObservability.begin).mock.calls[0][0];
    expect(taskObservability.append).toHaveBeenCalledWith('journal-owner', task.id, requestId, 'reasoning', 'explicit reason');
    expect(taskObservability.append).toHaveBeenCalledWith('journal-owner', task.id, requestId, 'answer', '<think>literal</think>');
    expect(taskObservability.complete).toHaveBeenCalledWith('journal-owner', task.id, requestId, expect.objectContaining({ outcome: 'succeeded', answer: '<think>literal</think> final', usage: { output_tokens: 4 } }));
    expect(chunks.mock.calls).toEqual([['<think>literal</think>']]);
    expect(taskObservability.event).toHaveBeenCalledWith('journal-owner', task.id, expect.objectContaining({ type: 'step_update', stepIndex: 2 }));
    expect(listeners.size).toBe(0);
  } finally { task.finish('complete'); window.electronAPI = previous; }
});

it('returns explicit unsent deferral without an automatic admission retry', async () => {
  const start = vi.fn().mockResolvedValueOnce({ ok: false, code: 'RESOURCE_DEFERRED', details: { retryAfterMs: 1 } })
    .mockResolvedValueOnce({ ok: true, value: { text: 'ok', usage: {} } });
  const previous = window.electronAPI;
  window.electronAPI = { agy: { setSession: async () => {}, cancel: async () => {}, start, onEvent: () => () => {} } } as unknown as typeof previous;
  const controller = new AbortController(), providerOutcome = vi.fn();
  bindTaskSignal(controller.signal, { id: 'deferred', phase: vi.fn(), metadata: vi.fn(), providerOutcome } as unknown as Parameters<typeof bindTaskSignal>[1]);
  try {
    await expect(generateAgyText({ id: 'agy', name: 'AGY', provider: 'agy-cli', model: 'fixture', agyEffort: 'high', agyMode: 'model', isActive: true, deviceBound: true },
      { system: '', user: '', signal: controller.signal })).rejects.toThrow('AGY_RESOURCE_DEFERRED');
    expect(start).toHaveBeenCalledTimes(1);
    expect(providerOutcome).not.toHaveBeenCalledWith('unknown', expect.anything());
  } finally { window.electronAPI = previous; }
});

vi.mock('../store/useAppStore', () => ({ useAppStore: {
  getState: () => ({ aiConfigs: [], language: 'zh', user: { id: 7 } }), subscribe: () => () => {},
} }));

it('tracks a direct authenticated AGY call once when the caller has no parent task', async () => {
  vi.clearAllMocks();
  const previous = window.electronAPI, before = new Set(aiTaskJournal.snapshot().map(record => record.id));
  const start = vi.fn().mockResolvedValue({ ok: true, value: { text: 'original', usage: {} } });
  window.electronAPI = { agy: { setSession: async () => {}, cancel: async () => {}, start, onEvent: () => () => {} } } as unknown as typeof previous;
  try {
    expect(await generateAgyText({ id: 'agy', name: 'AGY', provider: 'agy-cli', model: 'fixture', agyEffort: 'high', agyMode: 'model', isActive: true, deviceBound: true },
      { feature: 'repository-details', system: '', user: '' })).toBe('original');
    const created = aiTaskJournal.snapshot().filter(record => !before.has(record.id));
    expect(created).toHaveLength(1); expect(created[0]).toMatchObject({ owner: '7', kind: 'details', state: 'complete' });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0][2]).toMatchObject({ taskId: created[0].id, itemId: 'operation' });
    expect(taskObservability.begin).toHaveBeenCalledTimes(1);
  } finally { window.electronAPI = previous; }
});

it('submits background work to the authoritative queue to use spare capacity during a manual batch', async () => {
  const previous = window.electronAPI;
  const start = vi.fn().mockResolvedValue({ ok: true, value: { text: 'idle result', usage: {} } });
  window.electronAPI = { agy: { setSession: async () => {}, cancel: async () => {}, start, onEvent: () => () => {} } } as unknown as typeof previous;
  const foreground = aiTaskJournal.begin('7', 'details', [], undefined, undefined, { executor: 'agy-device', trigger: 'manual' });
  try {
    const pending = generateAgyText({ id: 'agy', name: 'AGY', provider: 'agy-cli', model: 'fixture', agyEffort: 'high', agyMode: 'model', agyPriority: 'background', isActive: true, deviceBound: true }, { system: '', user: '' });
    expect(await pending).toBe('idle result');
    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0][2]).toMatchObject({ priority: 'background' });
  } finally { foreground.finish('complete'); window.electronAPI = previous; }
});

it('isolates simultaneous AGY queue positions by task and clears running/completed requests', async () => {
  const listeners = new Set<(event: AgyEvent) => void>();
  const completions: Array<(value: unknown) => void> = [];
  const agy = { setSession: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined),
    onEvent: (listener: (event: AgyEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    start: vi.fn(() => new Promise(resolve => completions.push(resolve))),
  };
  const previous = window.electronAPI;
  window.electronAPI = { agy } as unknown as typeof window.electronAPI;
  try {
    const first = new AbortController(), second = new AbortController();
    const phase = vi.fn(), providerOutcome = vi.fn(), metadata = vi.fn();
    bindTaskSignal(first.signal, { id: 'task-a', metadata,phase,providerOutcome } as unknown as Parameters<typeof bindTaskSignal>[1]);
    bindTaskSignal(second.signal, { id: 'task-b', metadata: vi.fn(),phase:vi.fn(),providerOutcome:vi.fn() } as unknown as Parameters<typeof bindTaskSignal>[1]);
    const config = { id: 'agy', name: 'AGY', provider: 'agy-cli' as const, model: 'fixture', agyEffort: 'high' as const,
      agyMode: 'model' as const, isActive: true, deviceBound: true };
    const pending = Promise.allSettled([
      generateAgyText(config, { system: '', user: '', signal: first.signal }),
      generateAgyText(config, { system: '', user: '', signal: second.signal }),
    ]);
    await waitFor(() => expect(agy.start).toHaveBeenCalledTimes(2));
    const emit = (index: number, type: 'queued' | 'running' | 'sent', position?: number) => {
      const [requestId, session] = agy.start.mock.calls[index] as unknown as [string, string];
      listeners.forEach(listener => listener({ requestId, session, type, position } as AgyEvent));
    };
    emit(0, 'queued', 4); emit(1, 'queued', 2);
    expect(agyQueueStatus.snapshot('task-a')).toBe(4);
    expect(agyQueueStatus.snapshot('task-b')).toBe(2);
    expect(agyQueueStatus.snapshot('unknown')).toBe(Infinity);
    emit(1, 'running');
    expect(agyQueueStatus.snapshot('task-b')).toBe(Infinity);
    expect(agyQueueStatus.snapshot('task-a')).toBe(4);
    emit(0, 'sent'); emit(0, 'running');
    expect(phase).toHaveBeenLastCalledWith('generating');
    expect(providerOutcome).toHaveBeenLastCalledWith('in_flight', undefined);
    completions.forEach(resolve => resolve({ ok: false, code: 'CANCELED', error: 'Canceled' }));
    const settled = await pending;
    expect(providerOutcome).toHaveBeenLastCalledWith('unknown', 'unknown_provider_outcome');
    expect(metadata).toHaveBeenLastCalledWith({ usage: expect.objectContaining({ phase_queue_wait_ms: expect.any(Number), phase_generating_ms: expect.any(Number) }) });
    expect(settled.every(result => result.status === 'rejected')).toBe(true);
    expect(agyQueueStatus.snapshot()).toBe(Infinity);
    expect(listeners.size).toBe(0);
  } finally { window.electronAPI = previous; }
});

it('retains cleanup warnings and a known successful outcome when local output validation rejects', async () => {
  const listeners = new Set<(event: AgyEvent) => void>();
  const previous = window.electronAPI;
  window.electronAPI = { agy: { setSession: async () => {}, cancel: async () => {},
    onEvent: (listener: (event: AgyEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    start: async (requestId: string, session: string) => {
      for (const event of [{ type: 'sent' }, { type: 'cleanup' }, { type: 'warning', code: 'CLEANUP_TIMEOUT' }, { type: 'cleanup' }])
        listeners.forEach(listener => listener({ requestId, session, ...event } as AgyEvent));
      return { ok: true, value: { text: 'x'.repeat(4001), usage: {} } };
    },
  } } as unknown as typeof previous;
  const controller = new AbortController();
  const task = aiTaskJournal.begin('7', 'details', [{ id: 'repo', label: 'repo' }]);
  bindTaskItemSignal(controller.signal, task, 'repo');
  try {
    await expect(generateAgyText({ id: 'agy', name: 'AGY', provider: 'agy-cli', model: 'fixture', agyEffort: 'high', agyMode: 'model', isActive: true, deviceBound: true },
      { system: '', user: '', maxTokens: 1, signal: controller.signal })).rejects.toThrow('AGY_OUTPUT_LIMIT');
    expect(aiTaskJournal.snapshot().find(record => record.id === task.id)?.items[0]).toMatchObject({
      providerOutcome: 'succeeded', validationStatus: 'failed', warning: 'CLEANUP_TIMEOUT', failureCode: 'AGY_OUTPUT_LIMIT',
    });
  } finally { task.finish('partial'); window.electronAPI = previous; }
});

it('never calls window.confirm for background tasks with unconfirmed unknown recovery records', async () => {
  const previous = window.electronAPI;
  const confirmSpy = vi.spyOn(window, 'confirm');
  const recoveryList = vi.fn().mockResolvedValue({
    ok: true, value: { records: [{ requestId: 'prev-req', owner: '7', providerOutcome: 'unknown', receipt: null, step: 'step-1', inputDigest: 'digest' }], errors: [] },
  });
  const start = vi.fn().mockResolvedValue({ ok: true, value: { text: 'ok', usage: {} } });
  window.electronAPI = { agy: { setSession: async () => {}, cancel: async () => {}, start, recoveryList, onEvent: () => () => {} } } as unknown as typeof previous;
  try {
    const config = { id: 'agy', name: 'AGY', provider: 'agy-cli' as const, model: 'fixture', agyEffort: 'high' as const, agyMode: 'model' as const, isActive: true, deviceBound: true, agyPriority: 'background' as const };
    await expect(generateAgyText(config, { system: '', user: '', recovery: { step: 'step-1' } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  } finally {
    confirmSpy.mockRestore();
    window.electronAPI = previous;
  }
});

it('prompts window.confirm for interactive tasks with unconfirmed unknown recovery records and records confirmation', async () => {
  const previous = window.electronAPI;
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const recoveryList = vi.fn().mockResolvedValue({
    ok: true, value: { records: [{ requestId: 'interactive-req', owner: '7', providerOutcome: 'unknown', receipt: null, step: 'step-interactive', inputDigest: 'digest' }], errors: [] },
  });
  const start = vi.fn().mockResolvedValue({ ok: true, value: { text: 'interactive result', usage: {} } });
  window.electronAPI = { agy: { setSession: async () => {}, cancel: async () => {}, start, recoveryList, onEvent: () => () => {} } } as unknown as typeof previous;
  try {
    const config = { id: 'agy', name: 'AGY', provider: 'agy-cli' as const, model: 'fixture', agyEffort: 'high' as const, agyMode: 'model' as const, isActive: true, deviceBound: true, agyPriority: 'interactive' as const };
    const result = await generateAgyText(config, { system: '', user: '', recovery: { step: 'step-interactive' } });
    expect(result).toBe('interactive result');
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0][2]).toMatchObject({ retryOf: 'interactive-req' });

    // Second call should not prompt again because confirmation is recorded
    confirmSpy.mockClear();
    await generateAgyText(config, { system: '', user: '', recovery: { step: 'step-interactive' } });
    expect(confirmSpy).not.toHaveBeenCalled();
  } finally {
    confirmSpy.mockRestore();
    window.electronAPI = previous;
  }
});

it('keeps an unknown nested request visible even when its request reference is not a repository item',async()=>{
 const previous=window.electronAPI;const listeners=new Set<(event:AgyEvent)=>void>();
 window.electronAPI={agy:{setSession:async()=>{},cancel:async()=>{},onEvent:(listener:(event:AgyEvent)=>void)=>{listeners.add(listener);return()=>listeners.delete(listener);},start:async(requestId:string,session:string)=>{listeners.forEach(listener=>listener({type:'sent',requestId,session}));return {ok:false,code:'TIMEOUT'};}}} as unknown as typeof previous;
 const task=aiTaskJournal.begin('7','organization',[]),controller=new AbortController();bindTaskItemSignal(controller.signal,task,'nested-request');
 try{await expect(generateAgyText({id:'agy',name:'AGY',provider:'agy-cli',model:'fixture',agyEffort:'high',agyMode:'model',isActive:true,deviceBound:true},{system:'',user:'',signal:controller.signal})).rejects.toThrow('AGY_TIMEOUT');
 expect(aiTaskJournal.snapshot().find(row=>row.id===task.id)).toMatchObject({providerOutcome:'unknown',failureCode:'unknown_provider_outcome',phase:'generating'});
 }finally{task.finish('failed');window.electronAPI=previous;}
});
