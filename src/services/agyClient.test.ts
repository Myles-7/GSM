import { waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { agyQueueStatus, generateAgyText } from './agyClient';
import { bindTaskSignal, bindTaskItemSignal } from './taskExecution';
import type { AgyEvent } from '../types/agy';
import { aiTaskJournal } from './aiTaskJournal';

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
