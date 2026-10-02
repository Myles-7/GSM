import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { HomeApi } from './api';
import { HomeSync } from './sync';
import type { Capabilities, HomeOperation, HomeRecord } from './types';

describe('home synchronization recovery', () => {
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
