import { waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { agyQueueStatus, generateAgyText } from './agyClient';
import { bindTaskSignal } from './taskExecution';
import type { AgyEvent } from '../types/agy';

vi.mock('../store/useAppStore', () => ({ useAppStore: {
  getState: () => ({ aiConfigs: [], language: 'zh' }), subscribe: () => () => {},
} }));

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
    bindTaskSignal(first.signal, { id: 'task-a', metadata: vi.fn() } as unknown as Parameters<typeof bindTaskSignal>[1]);
    bindTaskSignal(second.signal, { id: 'task-b', metadata: vi.fn() } as unknown as Parameters<typeof bindTaskSignal>[1]);
    const config = { id: 'agy', name: 'AGY', provider: 'agy-cli' as const, model: 'fixture', agyEffort: 'high' as const,
      agyMode: 'model' as const, isActive: true, deviceBound: true };
    const pending = Promise.allSettled([
      generateAgyText(config, { system: '', user: '', signal: first.signal }),
      generateAgyText(config, { system: '', user: '', signal: second.signal }),
    ]);
    await waitFor(() => expect(agy.start).toHaveBeenCalledTimes(2));
    const emit = (index: number, type: 'queued' | 'running', position?: number) => {
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
    completions.forEach(resolve => resolve({ ok: false, code: 'CANCELED', error: 'Canceled' }));
    const settled = await pending;
    expect(settled.every(result => result.status === 'rejected')).toBe(true);
    expect(agyQueueStatus.snapshot()).toBe(Infinity);
    expect(listeners.size).toBe(0);
  } finally { window.electronAPI = previous; }
});
