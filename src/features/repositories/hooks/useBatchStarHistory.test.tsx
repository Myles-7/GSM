import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBatchStarHistory } from './useBatchStarHistory';
import { batchStarHistoryKey, readBatchStarHistory } from '../../../services/batchStarHistoryStorage';

const mocks = vi.hoisted(() => ({
  accountId: 1 as number | undefined,
  listeners: new Set<(next: { user: { id: number } | undefined }, previous: { user: { id: number } | undefined }) => void>(),
}));
const state = () => ({ user: mocks.accountId == null ? undefined : { id: mocks.accountId } });
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign((selector: (value: ReturnType<typeof state>) => unknown) => selector(state()), {
    getState: () => state(),
    subscribe: (listener: (next: ReturnType<typeof state>, previous: ReturnType<typeof state>) => void) => {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    },
  }),
}));
const switchAccount = (id: number | undefined) => {
  const previous = state();
  mocks.accountId = id;
  mocks.listeners.forEach(listener => listener(state(), previous));
};
const storageDescriptors = [window, globalThis].map(target => ({
  target, descriptor: Object.getOwnPropertyDescriptor(target, 'localStorage'),
}));

describe('useBatchStarHistory', () => {
  beforeEach(() => { mocks.accountId = 1; localStorage.clear(); vi.restoreAllMocks(); });
  afterEach(() => {
    for (const { target, descriptor } of storageDescriptors) {
      if (descriptor) Object.defineProperty(target, 'localStorage', descriptor);
      else Reflect.deleteProperty(target, 'localStorage');
    }
    vi.restoreAllMocks();
  });
  it('records ten exact inputs, edits a loaded entry and reads the latest stored state', () => {
    const { result } = renderHook(() => useBatchStarHistory());
    act(() => {
      for (let index = 0; index < 12; index++) result.current.record(`  repo${index}\n`);
    });
    expect(result.current.history).toHaveLength(10);
    act(() => result.current.edit('  repo11\n', ' edited\n '));
    expect(result.current.history.some(entry => entry.text === ' edited\n ')).toBe(true);
    expect(result.current.history.some(entry => entry.text === '  repo11\n')).toBe(false);
    expect(readBatchStarHistory('1')).toEqual(result.current.history);
  });
  it('does not let an old callback write after switching away and back in one render batch', () => {
    const { result, rerender } = renderHook(() => useBatchStarHistory());
    const oldRecord = result.current.record;
    act(() => { switchAccount(2); switchAccount(1); });
    expect(oldRecord('stale')).toBe(false);
    expect(readBatchStarHistory('1')).toEqual([]);
    rerender();
    act(() => { expect(result.current.record('fresh')).toBe(true); });
    expect(readBatchStarHistory('1')[0].text).toBe('fresh');
  });
  it('isolates loaded histories and ignores logged-out writes', () => {
    const { result, rerender } = renderHook(() => useBatchStarHistory());
    act(() => result.current.record('first'));
    act(() => switchAccount(2));
    rerender();
    expect(result.current.history).toEqual([]);
    act(() => result.current.record('second'));
    act(() => switchAccount(1));
    rerender();
    expect(result.current.history[0].text).toBe('first');
    act(() => switchAccount(undefined));
    rerender();
    expect(result.current.record('logged out')).toBe(false);
  });
  it('refreshes on another tab storage event and surfaces storage failures', () => {
    const { result } = renderHook(() => useBatchStarHistory());
    localStorage.setItem(batchStarHistoryKey('1'), JSON.stringify([{ text: 'another tab', generatedAt: 1 }]));
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: batchStarHistoryKey('1') })));
    expect(result.current.history[0].text).toBe('another tab');
    const storage = window.localStorage;
    const throwingStorage: Storage = {
      get length() { return storage.length; },
      clear: storage.clear.bind(storage),
      getItem: storage.getItem.bind(storage),
      key: storage.key.bind(storage),
      removeItem: storage.removeItem.bind(storage),
      setItem: vi.fn(() => { throw new Error('quota'); }),
    };
    for (const { target } of storageDescriptors) {
      Object.defineProperty(target, 'localStorage', { configurable: true, writable: true, value: throwingStorage });
    }
    act(() => { expect(result.current.record('cannot save')).toBe(false); });
    expect(result.current.historyError).toBe(true);
    expect(throwingStorage.setItem).toHaveBeenCalledWith(batchStarHistoryKey('1'), expect.any(String));
    expect(JSON.parse(storage.getItem(batchStarHistoryKey('1'))!)).toEqual([{ text: 'another tab', generatedAt: 1 }]);
  });
});
