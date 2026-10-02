import { expect, it, vi } from 'vitest';
import { scheduleModel } from './modelScheduler';

it('serializes model calls, prioritizes screening, observes RPM, and cancels queued requests', async () => {
  vi.useFakeTimers();
  try {
    const events: string[] = [];
    const signal = new AbortController().signal;
    let release!: () => void;
    const first = scheduleModel(() => new Promise<void>(resolve => { events.push('first'); release = resolve; }), signal, 60);
    await vi.advanceTimersByTimeAsync(1);
    const detail = scheduleModel(async () => { events.push('detail'); }, signal, 60, 0);
    const screen = scheduleModel(async () => { events.push('screen'); }, signal, 60, 1);
    const controller = new AbortController();
    const cancelled = scheduleModel(async () => { events.push('cancelled'); }, controller.signal);
    const assertion = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    release();
    await first;
    await vi.advanceTimersByTimeAsync(998);
    expect(events).toEqual(['first']);
    await vi.advanceTimersByTimeAsync(2001);
    await Promise.all([detail, screen, assertion]);
    expect(events).toEqual(['first', 'screen', 'detail']);
  } finally { vi.useRealTimers(); }
});
