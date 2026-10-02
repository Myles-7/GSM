import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoUpdateCheck } from './useAutoUpdateCheck';

const mocks = vi.hoisted(() => {
  const state = {
    updateNotification: null as { version: string; dismissed: boolean } | null,
    dismissUpdateNotification: vi.fn(),
  };
  state.dismissUpdateNotification.mockImplementation(() => { state.updateNotification = null; });
  return { state, useAppStore: (selector: (value: typeof state) => unknown) => selector(state) };
});

vi.mock('../store/useAppStore', () => ({ useAppStore: mocks.useAppStore }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.state.updateNotification = null;
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('disabled automatic upstream checks', () => {
  it('does not schedule a startup request, including StrictMode remounts', async () => {
    renderHook(() => useAutoUpdateCheck(), { wrapper: StrictMode });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.state.dismissUpdateNotification).not.toHaveBeenCalled();
  });

  it.each([false, true])('clears a stale notification with dismissed=%s', (dismissed) => {
    mocks.state.updateNotification = { version: '0.8.5', dismissed };
    renderHook(() => useAutoUpdateCheck());
    expect(mocks.state.updateNotification).toBeNull();
    expect(mocks.state.dismissUpdateNotification).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears an obsolete notification restored after the first render', () => {
    const { rerender } = renderHook(() => useAutoUpdateCheck());
    mocks.state.updateNotification = { version: '0.8.5', dismissed: false };
    rerender();
    expect(mocks.state.updateNotification).toBeNull();
    rerender();
    expect(mocks.state.dismissUpdateNotification).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
