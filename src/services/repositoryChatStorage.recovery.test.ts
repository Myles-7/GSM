import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const key = 'gsm-repository-chat-fallback-v1';
const mode = 'gsm-repository-chat-use-fallback-v1';
const date = '2026-10-07T00:00:00Z';
const proposal = (id: string) => ({ id, ownerId: 'fixture', sessionId: 'session', operations: [], createdAt: date, updatedAt: date });
const snapshot = () => ({ sessions: [], messages: [], evidence: [], toolEvents: [], projects: [], proposals: [proposal('preserved')] });
beforeEach(() => { localStorage.clear(); vi.resetModules(); });

describe('recovery from persistent chat fallback', () => {
  it('atomically restores the authoritative fallback including deletions and keeps its recovery copy', async () => {
    const raw = JSON.stringify(snapshot()); localStorage.setItem(key, raw); localStorage.setItem(mode, '1');
    const { repositoryChatStorage: storage, openRepositoryChatDatabase } = await import('./repositoryChatStorage');
    const db = await openRepositoryChatDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('proposals', 'readwrite'); tx.objectStore('proposals').put(proposal('stale-deleted'));
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
    const [found, listed] = await Promise.all([storage.getProposal('preserved'), storage.listProposals('fixture', 'session')]);
    expect(found?.id).toBe('preserved'); expect(listed.map(row => row.id)).toEqual(['preserved']);
    expect(localStorage.getItem(mode)).toBeNull(); expect(localStorage.getItem(key)).toBe(raw);
    await storage.saveProposal(proposal('new-checkpoint'));
    expect(localStorage.getItem(key)).toBe(raw);
    expect((await storage.listProposals('fixture')).map(row => row.id).sort()).toEqual(['new-checkpoint', 'preserved']);
  });
  it('does not clear IndexedDB or disable fallback when the snapshot is incomplete', async () => {
    localStorage.setItem(key, '{}'); localStorage.setItem(mode, '1');
    const { repositoryChatStorage: storage, openRepositoryChatDatabase } = await import('./repositoryChatStorage');
    const db = await openRepositoryChatDatabase();
    await new Promise<void>(resolve => { const tx = db.transaction('proposals', 'readwrite'); tx.objectStore('proposals').put(proposal('still-safe')); tx.oncomplete = () => resolve(); });
    expect(await storage.getProposal('preserved')).toBeNull(); expect(localStorage.getItem(mode)).toBe('1');
    const saved = await new Promise(resolve => { const r = db.transaction('proposals').objectStore('proposals').get('still-safe'); r.onsuccess = () => resolve(r.result); });
    expect(saved).toMatchObject({ id: 'still-safe' }); db.close();
  });
  it('retains fallback when opening IndexedDB fails, with targeted checkpoint notifications', async () => {
    localStorage.setItem(key, JSON.stringify(snapshot())); localStorage.setItem(mode, '1');
    const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('Unavailable'); });
    const listener = vi.fn(); window.addEventListener('gsm:global-chat-history-changed', listener);
    try {
      const { repositoryChatStorage: storage } = await import('./repositoryChatStorage');
      await storage.saveProposal(proposal('saved-in-fallback'));
      expect(localStorage.getItem(mode)).toBe('1');
      expect(listener.mock.calls[listener.mock.calls.length - 1]?.[0].detail).toEqual({ proposalId: 'saved-in-fallback', ownerId: 'fixture', sessionId: 'session' });
      expect(await storage.getProposal('preserved')).toMatchObject({ id: 'preserved' });
    } finally { open.mockRestore(); window.removeEventListener('gsm:global-chat-history-changed', listener); }
  });
});
