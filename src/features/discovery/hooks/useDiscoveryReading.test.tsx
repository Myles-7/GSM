import 'fake-indexeddb/auto';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useAutomaticDiscoveryLoading, useDiscoveryBrowseRestore, useReadingAnchor } from './useDiscoveryReading';
import { saveBrowsePage, saveReadingAnchor } from '../workspace/storage';
import { workspaceSessionKey } from '../workspace/model';

vi.mock('../../../store/useAppStore', async () => {
  const { create } = await import('zustand');
  const store = create<Record<string, unknown>>((set) => ({
    user: null, discoveryRepos: {}, discoveryNextPage: {}, discoveryHasMore: {}, discoveryTotalCount: {}, discoveryLastRefresh: {},
    setDiscoveryRepos: (id: string, repos: unknown[]) => set(s => ({ discoveryRepos: { ...s.discoveryRepos as object, [id]: repos } })),
    setDiscoveryNextPage: (id: string, page: number) => set(s => ({ discoveryNextPage: { ...s.discoveryNextPage as object, [id]: page } })),
    setDiscoveryHasMore: (id: string, value: boolean) => set(s => ({ discoveryHasMore: { ...s.discoveryHasMore as object, [id]: value } })),
    setDiscoveryTotalCount: (id: string, value: number) => set(s => ({ discoveryTotalCount: { ...s.discoveryTotalCount as object, [id]: value } })),
    setDiscoveryLastRefresh: (id: string, value: string) => set(s => ({ discoveryLastRefresh: { ...s.discoveryLastRefresh as object, [id]: value } })),
    setDiscoveryLoadMoreError: vi.fn(),
  }));
  return { useAppStore: store };
});

let account: string;
beforeEach(() => {
  account = String(Math.floor(Math.random() * 10000000) + 1);
  useAppStore.setState({ user: { id: Number(account), login: 'test', avatar_url: '' } as never });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
});
afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('durable reading hooks', () => {
  it('restores more than one page and its cursor without a network call', async () => {
    const key = workspaceSessionKey('most-popular', 'test');
    await saveBrowsePage(account, { key, channelId: 'most-popular', signature: 'test',
      items: Array.from({ length: 60 }, (_, id) => ({ id: id + 1, full_name: `a/${id}` })),
      nextPage: 4, hasMore: true, totalCount: 1000, mode: 'replace' });
    const { result } = renderHook(() => useDiscoveryBrowseRestore(account, 'most-popular', 'test', true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(useAppStore.getState().discoveryRepos['most-popular']).toHaveLength(60);
    expect(useAppStore.getState().discoveryNextPage['most-popular']).toBe(4);
    expect(useAppStore.getState().discoveryHasMore['most-popular']).toBe(true);
  });
  it('restores a stable project identity and respects user navigation before hydration completes', async () => {
    const root = createRef<HTMLDivElement>();
    const element = document.createElement('div');
    const card = document.createElement('div'); card.dataset.readingKey = 'repo:7'; element.append(card); document.body.append(element);
    Object.assign(root, { current: element });
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ top: 600, bottom: 800 } as DOMRect);
    await saveReadingAnchor(account, { sessionKey: 'one', itemKey: 'repo:7', offset: 120, previousKeys: [], updatedAt: 10 });
    const { unmount } = renderHook(() => useReadingAnchor(account, 'one', root, true, true));
    await waitFor(() => expect(window.scrollBy).toHaveBeenCalledWith({ top: 480, behavior: 'auto' }));
    unmount(); vi.mocked(window.scrollBy).mockClear(); vi.mocked(window.scrollTo).mockClear();
    renderHook(() => useReadingAnchor(account, 'one', root, true, true));
    act(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 })));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(window.scrollBy).not.toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
  it('never auto-loads on mount or synthetic scroll; one deliberate browse triggers only one load', () => {
    const root = createRef<HTMLDivElement>(); const element = document.createElement('div');
    Object.assign(root, { current: element });
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ bottom: 300 } as DOMRect);
    const load = vi.fn();
    const { rerender } = renderHook(({ error }) => useAutomaticDiscoveryLoading(root, true, false, true, error, load, 'one'), { initialProps: { error: false } });
    act(() => window.dispatchEvent(new Event('scroll'))); expect(load).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))); expect(load).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 })));
    act(() => window.dispatchEvent(new Event('scroll'))); expect(load).toHaveBeenCalledTimes(1);
    rerender({ error: true });
    act(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 })));
    act(() => window.dispatchEvent(new Event('scroll'))); expect(load).toHaveBeenCalledTimes(1);
  });
  it('does not auto-load while reading details, using a dialog or scrolling upward', () => {
    const root = createRef<HTMLDivElement>(); const element = document.createElement('div');
    Object.assign(root, { current: element }); document.body.append(element);
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ bottom: 300 } as DOMRect);
    const detail = document.createElement('aside'); detail.dataset.independentReading = ''; element.append(detail);
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); document.body.append(dialog);
    const load = vi.fn();
    renderHook(() => useAutomaticDiscoveryLoading(root, true, false, true, false, load, 'one'));
    act(() => detail.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 })));
    act(() => dialog.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' })));
    act(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 })));
    act(() => window.dispatchEvent(new Event('scroll')));
    expect(load).not.toHaveBeenCalled();
    act(() => element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 })));
    expect(load).toHaveBeenCalledTimes(1);
  });
});
