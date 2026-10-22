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

it('lets native AGY admit concurrent requests without a hidden renderer slot', async () => {
  const events: string[] = [];
  const signal = new AbortController().signal;
  let releaseFirst!: () => void;
  let startedFirst!: () => void;
  const firstStarted = new Promise<void>(resolve => { startedFirst = resolve; });
  const first = scheduleModel(() => new Promise<void>(resolve => {
    events.push('first');
    startedFirst();
    releaseFirst = resolve;
  }), signal, 0, 0, true);

  await firstStarted;
  expect(events).toEqual(['first']);

  const detail = scheduleModel(async () => { events.push('detail'); }, signal, 0, 0, true);
  const screen = scheduleModel(async () => { events.push('screen'); }, signal, 0, 1, true);

  await Promise.all([detail, screen]);
  expect(events).toEqual(['first', 'detail', 'screen']);
  releaseFirst();
  await first;
});
