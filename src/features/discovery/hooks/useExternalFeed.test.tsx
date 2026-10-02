import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalFeedKind } from '../../../types/externalFeed';
import { useExternalFeed } from './useExternalFeed';

const mocks = vi.hoisted(() => ({ useAppStore: vi.fn(), json: vi.fn(), rss: vi.fn() }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: mocks.useAppStore }));
vi.mock('../../../services/externalDiscoveryFeed', () => ({
  readExternalDiscoveryFeed: mocks.json, readExternalDiscoveryRssFeed: mocks.rss,
}));

const makeState = () => ({
  user: { id: 7 },
  githubToken: 'token',
  language: 'en',
  discoveryChannels: [] as Array<{ id: string; sourceUrl: string; sourceKind?: ExternalFeedKind; enabled: boolean }>,
  addExternalDiscoveryChannel: vi.fn(() => true),
  removeExternalDiscoveryChannel: vi.fn(),
});
let state = makeState();
type TestState = ReturnType<typeof makeState>;
const listeners = new Set<(next: TestState) => void>();
Object.assign(mocks.useAppStore, {
  getState: () => state,
  subscribe: (listener: (next: TestState) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
});
mocks.useAppStore.mockImplementation(selector => selector(state));
const change = (patch: Partial<typeof state>) => {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener(state));
};
function deferred() {
  let resolve!: (value: string[]) => void;
  const promise = new Promise<string[]>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  state = makeState();
  mocks.json.mockResolvedValue(['owner/repo']);
  mocks.rss.mockResolvedValue(['owner/repo']);
});

describe('useExternalFeed', () => {
  it('validates and forwards the normalized URL, kind and captured numeric account', async () => {
    const { result } = renderHook(() => useExternalFeed());
    await act(async () => { expect(await result.current.add(' Feed ', 'https://example.com/feed#part', 'rss')).toBe(true); });
    expect(mocks.rss).toHaveBeenCalledWith('https://example.com/feed', expect.any(AbortSignal));
    expect(mocks.json).not.toHaveBeenCalled();
    expect(state.addExternalDiscoveryChannel).toHaveBeenCalledWith('Feed', 'https://example.com/feed', 'rss', 7);
    expect(result.current.isChecking).toBe(false);
    expect(listeners.size).toBe(0);
  });
  it('rejects invalid URLs, duplicate URLs and the ten-feed limit without network', async () => {
    const { result } = renderHook(() => useExternalFeed());
    await act(async () => { expect(await result.current.add('Feed', 'http://example.com/feed')).toBe(false); });
    state.discoveryChannels = [{ id: 'external:one', sourceUrl: 'https://example.com/feed', enabled: true }];
    await act(async () => { expect(await result.current.add('Feed', 'https://example.com/feed#part')).toBe(false); });
    state.discoveryChannels = Array.from({ length: 10 }, (_, i) => ({ id: `external:${i}`, sourceUrl: `https://example.com/${i}`, enabled: false }));
    await act(async () => { expect(await result.current.add('Feed', 'https://example.com/new')).toBe(false); });
    expect(mocks.json).not.toHaveBeenCalled();
    expect(state.addExternalDiscoveryChannel).not.toHaveBeenCalled();
    expect(result.current.error).toContain('10');
  });
  it('reports store rejection after validation, without assuming preflight was sufficient', async () => {
    state.addExternalDiscoveryChannel.mockReturnValue(false);
    const { result } = renderHook(() => useExternalFeed());
    await act(async () => { expect(await result.current.add('Feed', 'https://example.com/feed')).toBe(false); });
    expect(result.current.error).toContain('already exists');
  });
  it.each(['switch', 'away-back', 'token'] as const)('aborts and ignores old validation on %s transition', async mode => {
    const read = deferred();
    mocks.json.mockReturnValue(read.promise);
    const { result } = renderHook(() => useExternalFeed());
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.add('Feed', 'https://example.com/feed'); });
    const signal = mocks.json.mock.calls[0][1] as AbortSignal;
    act(() => {
      if (mode === 'token') change({ githubToken: 'new-token' });
      else {
        change({ user: { id: 8 } });
        if (mode === 'away-back') change({ user: { id: 7 } });
      }
    });
    expect(signal.aborted).toBe(true);
    expect(result.current.isChecking).toBe(false);
    await act(async () => { read.resolve(['owner/repo']); expect(await pending).toBe(false); });
    expect(state.addExternalDiscoveryChannel).not.toHaveBeenCalled();
    expect(result.current.error).toBe('');
  });
  it('cancels previous validation when a newer add starts and prevents old finally clearing its spinner', async () => {
    const first = deferred();
    const second = deferred();
    mocks.json.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useExternalFeed());
    let one!: Promise<boolean>;
    let two!: Promise<boolean>;
    act(() => { one = result.current.add('One', 'https://example.com/one'); });
    act(() => { two = result.current.add('Two', 'https://example.com/two'); });
    expect(mocks.json.mock.calls[0][1].aborted).toBe(true);
    await act(async () => { first.resolve(['owner/repo']); expect(await one).toBe(false); });
    expect(result.current.isChecking).toBe(true);
    await act(async () => { second.resolve(['owner/repo']); expect(await two).toBe(true); });
    expect(state.addExternalDiscoveryChannel).toHaveBeenCalledOnce();
    expect(state.addExternalDiscoveryChannel).toHaveBeenCalledWith('Two', 'https://example.com/two', 'json', 7);
  });
  it('aborts on unmount and never saves a late success', async () => {
    const read = deferred();
    mocks.json.mockReturnValue(read.promise);
    const { result, unmount } = renderHook(() => useExternalFeed());
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.add('Feed', 'https://example.com/feed'); });
    unmount();
    expect(mocks.json.mock.calls[0][1].aborted).toBe(true);
    read.resolve(['owner/repo']);
    expect(await pending).toBe(false);
    expect(state.addExternalDiscoveryChannel).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
  it('shows timeout errors with English defaults and only removes external IDs', async () => {
    mocks.json.mockRejectedValue(new DOMException('deadline', 'TimeoutError'));
    const { result } = renderHook(() => useExternalFeed());
    await act(async () => { expect(await result.current.add('Feed', 'https://example.com/feed')).toBe(false); });
    expect(result.current.error).toContain('15 seconds');
    result.current.remove('external:one');
    expect(state.removeExternalDiscoveryChannel).toHaveBeenCalledWith('external:one');
  });
});
