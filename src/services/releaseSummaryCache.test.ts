import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn() }));
vi.mock('./indexedDbStorage', () => ({ indexedDBStorage: storage }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  storage.getItem.mockResolvedValue(null); storage.setItem.mockResolvedValue(undefined);
});

describe('device release summary cache', () => {
  it('persists source versions with isolated owner keys', async () => {
    const cache = await import('./releaseSummaryCache');
    await cache.saveReleaseSummaryCache('a', 1, 'A', 'v1');
    await cache.saveReleaseSummaryCache('b', 1, 'B', 'v2');
    expect(storage.setItem.mock.calls.map(call => call[0])).toEqual(['gsm:release-summary-cache:a', 'gsm:release-summary-cache:b']);
    expect(JSON.parse(storage.setItem.mock.calls[0][1])['1']).toMatchObject({ content: 'A', source: 'v1' });
    expect(JSON.parse(storage.setItem.mock.calls[1][1])['1']).toMatchObject({ content: 'B', source: 'v2' });
  });

  it('does not let a delayed load replace a freshly generated summary', async () => {
    let finish!: (value: string) => void;
    storage.getItem.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    const cache = await import('./releaseSummaryCache');
    const loading = cache.loadReleaseSummaryCache('a');
    await cache.saveReleaseSummaryCache('a', 1, 'new', 'v2');
    finish(JSON.stringify({ 1: { content: 'old', source: 'v1', at: new Date().toISOString() } }));
    await loading;
    await cache.saveReleaseSummaryCache('a', 2, 'second', 'v3');
    expect(JSON.parse(storage.setItem.mock.calls[1][1])['1']).toMatchObject({ content: 'new', source: 'v2' });
  });

  it('surfaces failed writes and allows subsequent persistence to recover', async () => {
    storage.setItem.mockRejectedValueOnce(new Error('disk'));
    const cache = await import('./releaseSummaryCache');
    await expect(cache.saveReleaseSummaryCache('a', 1, 'A', 'v1')).rejects.toThrow('disk');
    await expect(cache.saveReleaseSummaryCache('a', 2, 'B', 'v2')).resolves.toBeUndefined();
    expect(JSON.parse(storage.setItem.mock.calls[1][1])).toHaveProperty('1');
  });
});
