import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { HomeApi, HomeApiError } from './api';
import { HomeSync } from './sync';
import type { Capabilities, HomeOperation, HomeRecord } from './types';
import { holdRepositoryIdentityWrites, releaseRepositoryIdentityWrites } from '../services/repositoryIdentityGate';
import { aiTaskJournal } from '../services/aiTaskJournal';

describe('home synchronization recovery', () => {
  it('aggregates a repeated deterministic rejection but never repairs a request with unknown receipt', async () => {
    const caps: Capabilities = { protocolVersion: 2, workspace: { id: crypto.randomUUID(), githubUserId: 42 }, github: { configured: true } };
    const request = vi.fn(async (path: string) => {
      if (path.startsWith('/sync/v2/changes')) return { records: [], cursor: 1, hasMore: false };
      throw new HomeApiError(400, 'PRIVATE_DATA_NOT_SYNCABLE', 'PRIVATE_DATA_NOT_SYNCABLE');
    });
    const sync = new HomeSync({ url: `https://${crypto.randomUUID()}.test/api`, request } as unknown as HomeApi, caps);
    await sync.db.applyRemote([], 1, true);
    await sync.db.edit('repositories', '1', { id: 1, description: 'C:\\private\\file' });
    const frozen = await sync.db.nextBatch();
    const begin = vi.spyOn(aiTaskJournal, 'begin');
    try {
      expect(await sync.db.repairRejectedRepositoryBatch(frozen, { status: 500, code: 'PRIVATE_DATA_NOT_SYNCABLE' })).toBe(false);
      await sync.sync(); await sync.sync();
      expect(begin).toHaveBeenCalledTimes(1);
      expect(await sync.db.nextBatch()).toEqual(frozen);
      const id = await sync.db.metadata('dataFailureTask');
      expect(aiTaskJournal.snapshot().find(task => task.id === id)?.usage?.occurrences).toBe(2);
    } finally { sync.stop(); begin.mockRestore(); }
  });
  it('repairs a definitively rejected legacy batch and retains newer local edits', async () => {
    const sent: HomeOperation[][] = [];
    const caps: Capabilities = { protocolVersion: 2, workspace: { id: crypto.randomUUID(), githubUserId: 42 }, github: { configured: true } };
    const request = vi.fn(async (path: string, body?: { operations: HomeOperation[] }) => {
      if (path.startsWith('/sync/v2/changes')) return { records: [], cursor: 1, hasMore: false };
      sent.push(structuredClone(body!.operations));
      if (sent.length === 1) {
        await sync.db.edit('repositories', '1', { id: 1, name: 'newer', temp_clone_token: 'private', category_id: null });
        throw new HomeApiError(400, 'PRIVATE_DATA_NOT_SYNCABLE', 'PRIVATE_DATA_NOT_SYNCABLE');
      }
      return { results: body!.operations.map(op => ({ opId: op.opId, status: 'applied', record: { collection: op.collection, id: op.id, version: 1, data: op.data } })) };
    });
    const sync = new HomeSync({ url: `https://${crypto.randomUUID()}.test/api`, request } as unknown as HomeApi, caps);
    await sync.db.applyRemote([], 1, true);
    await sync.db.edit('organization', 'default', { categoryOrder: [] });
    await sync.db.edit('repositories', '1', { id: 1, name: 'old', temp_clone_token: 'private' });
    const original = await sync.db.nextBatch();
    try {
      await sync.sync();
      expect(sent).toHaveLength(2);
      expect(sent[0]).toEqual(original.operations);
      const repaired = sent[1].find(op => op.collection === 'repositories')!;
      expect(repaired.data).toEqual({ id: 1, name: 'newer', category_id: null });
      expect(repaired.opId).not.toBe(original.operations.find(op => op.collection === 'repositories')!.opId);
      expect(await sync.db.pending()).toEqual([]);
      expect(await sync.db.metadata('inFlight')).toBeUndefined();
      expect((await sync.db.getRecord('repositories', '1'))?.data?.name).toBe('newer');
      expect(sync.view.status).toBe('synced');
    } finally { sync.stop(); }
  });
  it('aggregates no-op polls and creates tasks only for changes or failures', async () => {
    const caps: Capabilities = { protocolVersion: 2, workspace: { id: crypto.randomUUID(), githubUserId: 42 }, github: { configured: true } };
    const request = vi.fn().mockResolvedValue({ records: [], cursor: 1, hasMore: false });
    const sync = new HomeSync({ url: `https://${crypto.randomUUID()}.test/api`, request } as unknown as HomeApi, caps);
    await sync.db.applyRemote([], 1, true);
    const begin = vi.spyOn(aiTaskJournal, 'begin'), activity = vi.spyOn(aiTaskJournal, 'noteActivity');
    try {
      for (let i = 0; i < 10; i++) await sync.sync();
      expect(begin).not.toHaveBeenCalled(); expect(activity).toHaveBeenCalledTimes(10);
      expect(activity.mock.lastCall?.[1]).toMatchObject({ noChange: true, changed: false });
      request.mockResolvedValueOnce({ records: [{ collection: 'repositories', id: '1', version: 1, data: { name: 'changed' } }], cursor: 2, hasMore: false });
      await sync.sync(); expect(begin).toHaveBeenCalledTimes(1);
      // The server can repeat an acknowledged immutable version in a later feed page.
      request.mockResolvedValueOnce({ records: [{ collection: 'repositories', id: '1', version: 1, data: { name: 'changed' } }], cursor: 3, hasMore: false });
      await sync.sync(); expect(begin).toHaveBeenCalledTimes(1);
      expect(activity.mock.lastCall?.[1]).toMatchObject({ noChange: true, changed: false });
      request.mockRejectedValueOnce(Error('offline')); await sync.sync(); expect(begin).toHaveBeenCalledTimes(2);
      expect(activity.mock.lastCall?.[1]).toMatchObject({ failed: true });
    } finally { sync.stop(); begin.mockRestore(); activity.mockRestore(); }
  });
  it('preserves cache and outbox when snapshot pages cross a server boundary', async () => {
    const caps: Capabilities = { protocolVersion: 2, workspace: { id: crypto.randomUUID(), githubUserId: 42 }, github: { configured: true } };
    const request = vi.fn().mockResolvedValueOnce({ records: [{ collection: 'repositories', id: 'new', version: 1, data: {} }], cursor: 2, snapshotId: 'first', nextOffset: 200, hasMore: true })
      .mockResolvedValueOnce({ records: [], cursor: 3, snapshotId: 'different', nextOffset: 200, hasMore: false });
    const sync = new HomeSync({ url: `https://${crypto.randomUUID()}.test/api`, request } as unknown as HomeApi, caps);
    await sync.db.applyRemote([{ collection: 'repositories', id: 'old', version: 1, data: { name: 'old' } }], 1, true);
    await sync.db.edit('repositories', 'old', { name: 'local edit' }); await sync.db.setMetadata('initialized', false);
    const pending = await sync.db.pending();
    try {
      await sync.sync(); expect(sync.view.error).toBe('HOME_SNAPSHOT_BOUNDARY_CHANGED');
      expect((await sync.db.list()).map(record => record.id)).toEqual(['old']);
      expect(await sync.db.pending()).toEqual(pending); expect(await sync.db.metadata('cursor')).toBe(1);
    } finally { sync.stop(); }
  });
  it('stops and drains an in-flight original batch without dispatching a newer edit or unfreezing writes', async () => {
    let reply!: (value: unknown) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const request = vi.fn(async (path: string, body?: { operations: HomeOperation[] }) => {
      if (path.startsWith('/sync/v2/changes')) return { records: [], cursor: 1, hasMore: false };
      if (path === '/sync/v2/operations') {
        entered();
        return new Promise(resolve => { reply = resolve; });
      }
      throw new Error(`unexpected request ${body}`);
    });
    const caps: Capabilities = { protocolVersion: 2, workspace: { id: crypto.randomUUID(), githubUserId: 42 }, github: { configured: true } };
    const sync = new HomeSync({ url: `https://${crypto.randomUUID()}.test/api`, request } as unknown as HomeApi, caps);
    await sync.db.applyRemote([], 1, true);
    await sync.db.edit('repositories', '1', { name: 'sent' });
    const running = sync.sync();
    await started;
    const sent = (request.mock.calls.find(([path]) => path === '/sync/v2/operations')![1]!).operations[0];
    await sync.db.edit('repositories', '1', { name: 'newer' });
    holdRepositoryIdentityWrites('42', 'sync-drain-test');
    try {
      sync.stop();
      let drained = false;
      const drain = sync.drain().then(() => { drained = true; });
      sync.changed();
      await Promise.resolve();
      expect(drained).toBe(false);
      reply({ results: [{ opId: sent.opId, status: 'applied', record: {
        collection: 'repositories', id: '1', version: 2, data: { name: 'sent' },
      } }] });
      await Promise.all([running, drain]);
      expect(await sync.db.metadata('inFlight')).toBeUndefined();
      expect((await sync.db.pending())[0]).toMatchObject({ data: { name: 'newer' }, baseVersion: 2 });
      await expect(sync.db.edit('repositories', '2', { name: 'blocked' })).rejects.toThrow('REPOSITORY_IDENTITY_MAINTENANCE_REQUIRED');
      const count = request.mock.calls.length;
      await sync.sync();
      expect(request).toHaveBeenCalledTimes(count);
    } finally { sync.stop(); releaseRepositoryIdentityWrites('42'); }
  });
  it('discards a stopped pull before applying records or requesting another page', async () => {
    let reply!: (value: unknown) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const request = vi.fn(async () => {
      entered();
      return new Promise(resolve => { reply = resolve; });
    });
    const caps: Capabilities = { protocolVersion: 2, workspace: { id: crypto.randomUUID(), githubUserId: 42 }, github: { configured: true } };
    const sync = new HomeSync({ url: `https://${crypto.randomUUID()}.test/api`, request } as unknown as HomeApi, caps);
    await sync.db.applyRemote([], 1, true);
    const running = sync.sync();
    await started;
    sync.stop();
    const drain = sync.drain();
    reply({ records: [{ collection: 'repositories', id: 'old', version: 1, data: { name: 'late' } }], cursor: 2, hasMore: true });
    await Promise.all([running, drain]);
    expect(await sync.db.list()).toEqual([]);
    expect(await sync.db.metadata('cursor')).toBe(1);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('stops pagination during an initial snapshot but permits explicit identity-maintenance reload without unfreezing', async () => {
    let reply!: (value: unknown) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const request = vi.fn(async () => {
      entered();
      return new Promise(resolve => { reply = resolve; });
    });
    const caps: Capabilities = { protocolVersion: 2, workspace: { id: crypto.randomUUID(), githubUserId: 42 }, github: { configured: true } };
    const sync = new HomeSync({ url: `https://${crypto.randomUUID()}.test/api`, request } as unknown as HomeApi, caps);
    const running = sync.sync();
    await started;
    sync.stop();
    reply({ records: [], cursor: 2, snapshotId: 'old', nextOffset: 200, hasMore: true });
    await Promise.all([running, sync.drain()]);
    expect(await sync.db.metadata('initialized')).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    request.mockImplementation(async () => ({
      records: [{ collection: 'repositories', id: 'new', version: 3, data: { name: 'canonical' } }],
      cursor: 3, snapshotId: 'new', nextOffset: 0, hasMore: false,
    }));
    holdRepositoryIdentityWrites('42', 'snapshot-test');
    try {
      await sync.reloadSnapshotForIdentityMaintenance();
      expect((await sync.db.list())[0].id).toBe('new');
      await expect(sync.db.edit('repositories', 'new', {})).rejects.toThrow('REPOSITORY_IDENTITY_MAINTENANCE_REQUIRED');
    } finally { releaseRepositoryIdentityWrites('42'); }
  });
  it('serializes backup restore after an in-flight pull and forces the next full snapshot',async()=>{
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let pulling=false;let snapshots=0;
    const api={url:`https://${crypto.randomUUID()}.test/api`,request:async(path:string)=>{
      if(path.startsWith('/sync/v2/changes')){pulling=true;await gate;return {records:[],cursor:2,hasMore:false};}
      if(path.startsWith('/sync/v2/snapshot')){snapshots++;return {records:[],cursor:3,snapshotId:'fixed',nextOffset:0,hasMore:false};}
      throw new Error('unexpected request');
    }} as unknown as HomeApi;
    const caps:Capabilities={protocolVersion:2,workspace:{id:crypto.randomUUID(),githubUserId:42},github:{configured:true}};
    const sync=new HomeSync(api,caps);await sync.db.applyRemote([],1,true);const pull=sync.sync();while(!pulling)await new Promise(resolve=>setTimeout(resolve,0));
    let restored=false;const restore=sync.withLocalMaintenance(async()=>{await sync.db.setMetadata('initialized',false);restored=true;});expect(restored).toBe(false);release();await Promise.all([pull,restore]);expect(await sync.db.metadata('initialized')).toBe(false);await sync.sync();expect(snapshots).toBe(1);
  });
  it('survives a lost server acknowledgement followed by another offline edit', async () => {
    let server: HomeRecord = { collection: 'repositories', id: '1', version: 1, seq: 1, data: { name: 'initial' } };
    const receipts = new Map<string, HomeRecord>(); const dispatched: HomeOperation[] = []; let loseReply = true;
    const api = { url: `https://${crypto.randomUUID()}.test/api`, request: async (path: string, body?: { operations: HomeOperation[] }) => {
      if (path.startsWith('/sync/v2/changes')) return { records: [server], cursor: server.seq, hasMore: false };
      if (path.startsWith('/sync/v2/snapshot')) return { records: [server], cursor: 1, snapshotId: 'snapshot', nextOffset: 1, hasMore: false };
      const op = body!.operations[0]; dispatched.push(structuredClone(op));
      let receipt = receipts.get(op.opId);
      if (!receipt) {
        expect(op.baseVersion).toBe(server.version);
        server = { ...server, version: server.version + 1, seq: server.version + 1, data: op.data! };
        receipt = structuredClone(server); receipts.set(op.opId, receipt);
      }
      if (loseReply) { loseReply = false; throw new TypeError('network disconnected after commit'); }
      return { results: [{ opId: op.opId, status: 'applied', record: receipt }] };
    } } as unknown as HomeApi;
    const caps: Capabilities = { protocolVersion: 2, workspace: { id: crypto.randomUUID(), githubUserId: 42 }, github: { configured: true, verified: true, id: 42 } };
    const sync = new HomeSync(api, caps);
    await sync.db.applyRemote([server], 1, true);
    await sync.db.edit('repositories', '1', { name: 'first' }); await sync.sync();
    expect(sync.view.status).toBe('offline');
    await sync.db.edit('repositories', '1', { name: 'latest' }); await sync.sync();
    expect(sync.view.status).toBe('synced'); expect(server.data?.name).toBe('latest');
    expect(dispatched).toHaveLength(3); expect(dispatched[0]).toEqual(dispatched[1]);
    expect(dispatched[2].baseVersion).toBe(2); expect((await sync.db.list())[0].version).toBe(3);
  });
});
