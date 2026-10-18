import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { openRepositoryChatDatabase, repositoryChatStorage as storage } from './repositoryChatStorage';
import type { WorkbenchProposal } from '../types/aiWorkbench';
describe('incremental organization storage', () => {
  it('queries the session index without reading other large account drafts, while retaining owner isolation', async () => {
    const date = new Date().toISOString();
    const make = (id: string, ownerId: string, sessionId: string): WorkbenchProposal => ({ id, ownerId, sessionId, createdAt: date, updatedAt: date, operations: [] });
    await storage.saveProposal(make('a', 'owner', 'current'));
    await storage.saveProposal(make('b', 'owner', 'other'));
    await storage.saveProposal(make('c', 'different', 'current'));
    const db = await openRepositoryChatDatabase();
    const indexPrototype = Object.getPrototypeOf(db.transaction('proposals').objectStore('proposals').index('ownerId'));
    const getAll = vi.spyOn(indexPrototype, 'getAll');
    try {
      expect((await storage.listProposals('owner','current')).map(p => p.id)).toEqual(['a']);
      expect(getAll).toHaveBeenCalledExactlyOnceWith('current');
    } finally { getAll.mockRestore(); db.close(); }
  });
  it('broadcasts only checkpoint identifiers, never the whole proposal', async () => {
    let detail: unknown;
    const listener = (event: Event) => { detail = (event as CustomEvent).detail; };
    window.addEventListener('gsm:global-chat-history-changed', listener);
    try {
      const date = new Date().toISOString();
      await storage.saveProposal({ id:'notification',ownerId:'owner',sessionId:'current',operations:[],createdAt:date,updatedAt:date });
      expect(detail).toEqual({ proposalId:'notification',ownerId:'owner',sessionId:'current' });
    } finally { window.removeEventListener('gsm:global-chat-history-changed', listener); }
  });
});
