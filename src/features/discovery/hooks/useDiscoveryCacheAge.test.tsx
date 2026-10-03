import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDiscoveryCacheExpired, useDiscoveryCacheAge } from './useDiscoveryCacheAge';

afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('passive cached-channel update hints', () => {
  it('uses channel-specific age limits without marking absent or invalid caches as updated', () => {
    const time = Date.parse('2026-10-02T09:00:00Z');
    const saved = new Date(time).toISOString();
    expect(isDiscoveryCacheExpired('trending', saved, time + 3600000)).toBe(true);
    expect(isDiscoveryCacheExpired('most-popular', saved, time + 3600000)).toBe(false);
    expect(isDiscoveryCacheExpired('search', saved, time + 3600000)).toBe(false);
    expect(isDiscoveryCacheExpired('trending', null, time)).toBe(false);
    expect(isDiscoveryCacheExpired('trending', 'invalid', time)).toBe(false);
    expect(isDiscoveryCacheExpired('code-search', saved, time + 86400000)).toBe(false);
  });
  it('changes only a status flag as time passes, and clears it after a successful refresh', () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-10-02T09:00:00Z');
    const saved = new Date().toISOString();
    const { result, rerender } = renderHook(({ time }) => useDiscoveryCacheAge('trending', time), { initialProps: { time: saved } });
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(3600000));
    expect(result.current).toBe(true);
    rerender({ time: new Date().toISOString() });
    expect(result.current).toBe(false);
  });
});
