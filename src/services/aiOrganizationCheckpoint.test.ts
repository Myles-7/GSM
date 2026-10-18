import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrganizationCheckpointWriter } from './aiOrganizationCheckpoint';
afterEach(() => vi.useRealTimers());
describe('bounded organization checkpoints', () => {
  it('coalesces a burst into one write instead of an unbounded promise chain', async () => {
    vi.useFakeTimers(); const save = vi.fn().mockResolvedValue(undefined);
    const writer = new OrganizationCheckpointWriter(save, vi.fn());
    await Promise.all(Array.from({length: 100}, () => writer.request(false)));
    expect(save).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1); await writer.close();
  });
  it('keeps updates arriving during slow I/O and resolves forced callers only after they are saved', async () => {
    let release!: () => void; let state = 1; const snapshots: number[] = [];
    const save = vi.fn(async () => { snapshots.push(state); if (snapshots.length === 1) await new Promise<void>(resolve => { release = resolve; }); });
    const writer = new OrganizationCheckpointWriter(save, vi.fn());
    const first = writer.request(); await Promise.resolve(); state = 2;
    const later = Array.from({length: 30}, () => writer.request());
    expect(save).toHaveBeenCalledTimes(1); release(); await Promise.all([first, ...later]);
    expect(snapshots).toEqual([1, 2]); await writer.close();
  });
  it('reports a write error once and cancels delayed writes on interruption', async () => {
    vi.useFakeTimers(); const error = new Error('disk failure'); const onError = vi.fn();
    const save = vi.fn().mockRejectedValue(error); const writer = new OrganizationCheckpointWriter(save, onError);
    await expect(writer.request()).rejects.toThrow('disk failure'); await writer.close();
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    const stopped = new OrganizationCheckpointWriter(save, onError); await stopped.request(false); await stopped.close();
    await vi.advanceTimersByTimeAsync(1000); expect(save).toHaveBeenCalledTimes(1);
  });
});
