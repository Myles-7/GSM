import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForRequest, withDeadline } from './requestDeadline';

afterEach(() => vi.useRealTimers());
describe('request deadlines', () => {
  it('settles and aborts a provider that never returns', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const result = withDeadline(s => { signal = s; return new Promise(() => {}); }, 15000);
    const assertion = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels immediately and ignores a late success', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let resolve!: (value: string) => void;
    const result = withDeadline(() => new Promise<string>(r => { resolve = r; }), 60000, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    controller.abort();
    resolve('late');
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not start already cancelled work', async () => {
    const controller = new AbortController();
    controller.abort();
    const work = vi.fn();
    await expect(withDeadline(work, 1000, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(work).not.toHaveBeenCalled();
  });
  it('cleans up successful requests and cancels backoff', async () => {
    vi.useFakeTimers();
    await expect(withDeadline(async () => 42, 1000)).resolves.toBe(42);
    expect(vi.getTimerCount()).toBe(0);
    const controller = new AbortController();
    const waiting = waitForRequest(60000, controller.signal);
    const assertion = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
