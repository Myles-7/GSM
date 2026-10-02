import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeDatabase } from './database';
import type { HomeSync } from './sync';
const mocks = vi.hoisted(() => ({ sync: null as HomeSync | null, listeners: new Set<() => void>() }));
vi.mock('./desktop', () => ({ getDesktopHomeSync: () => mocks.sync, subscribeDesktopHome: (listener: () => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener); } }));
import { useDiscoveryPostRead } from './useDiscoveryPostRead';

describe('desktop source post read bridge', () => {
  it('projects phone read status and writes desktop toggles to the same canonical record', async () => {
    const db = new HomeDatabase(crypto.randomUUID()); const changed = vi.fn(); mocks.sync = { db, changed } as unknown as HomeSync;
    await db.applyRemote([{ collection: 'discovery_reads', id: 'post:telegram:news/123', version: 7, data: { kind: 'post', channelId: 'telegram', isRead: true } }], 1, true);
    const hook = renderHook(() => useDiscoveryPostRead('telegram', 'news/123', true));
    await waitFor(() => expect(hook.result.current.isRead).toBe(true));
    await act(() => hook.result.current.mark(false));
    expect((await db.pending())[0]).toMatchObject({ id: 'post:telegram:news/123', baseVersion: 7, data: { kind: 'post', channelId: 'telegram', isRead: false } });
    expect(changed).toHaveBeenCalledOnce(); expect(hook.result.current.isRead).toBe(false); hook.unmount();
  });
  it('responds to remote tombstones and disables the action outside an active home account', async () => {
    const db = new HomeDatabase(crypto.randomUUID()); mocks.sync = { db, changed: vi.fn() } as unknown as HomeSync;
    await db.applyRemote([{ collection: 'discovery_reads', id: 'post:x-tweet:123', version: 1, data: { kind: 'post', channelId: 'x-tweet', isRead: true } }], 1, true);
    const hook = renderHook(() => useDiscoveryPostRead('x-tweet', '123', true));
    await waitFor(() => expect(hook.result.current.isRead).toBe(true));
    await db.applyRemote([{ collection: 'discovery_reads', id: 'post:x-tweet:123', version: 2, deleted: true, data: null }], 2);
    act(() => mocks.listeners.forEach(listener => listener()));
    await waitFor(() => expect(hook.result.current.isRead).toBe(false));
    await act(() => hook.result.current.mark(true)); expect((await db.pending())[0].baseVersion).toBe(2);
    mocks.sync = null; act(() => mocks.listeners.forEach(listener => listener()));
    await waitFor(() => expect(hook.result.current.available).toBe(false)); hook.unmount();
  });
});
