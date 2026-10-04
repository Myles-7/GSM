import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { DiscoveryRepo } from '../../types';
import { loadReadingDiscoveryCache, saveReadingDiscoveryCache, sanitizeReadingDiscoveryRepo } from './cache';
import { openReadingDb } from './storage';
const repo = { id: 1, full_name: 'acme/tool', description: 'public', topics: [], pushed_at: '2026-10-01', stargazers_count: 5, apiKey: 'secret', owner: { login: 'acme', avatar_url: 'secret' } } as unknown as DiscoveryRepo;
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); });
describe('persistent HTML discovery cache', () => {
  it('allowlists public data and keys account, channel, actual source independently of presentation', async () => {
    await saveReadingDiscoveryCache('42', 'topic', '["react"]', { repos: [repo], updatedAt: new Date().toISOString(), status: 'updated' });
    const saved = await loadReadingDiscoveryCache('42', 'topic', '["react"]');
    expect(saved?.valid).toBe(true); expect(JSON.stringify(saved)).not.toContain('secret');
    expect(await loadReadingDiscoveryCache('43', 'topic', '["react"]')).toBeNull();
    expect(await loadReadingDiscoveryCache('42', 'topic', '["python"]')).toBeNull();
    expect(sanitizeReadingDiscoveryRepo(repo).description).toBe('public');
  });
  it('expires success at seven days and rejects unknown or future times', async () => {
    for (const [signature, date] of [['old', new Date(Date.now()-8*86400000).toISOString()], ['unknown', ''], ['future',new Date(Date.now()+86400000).toISOString()]]) {
      await saveReadingDiscoveryCache('42','topic',signature,{repos:[repo],updatedAt:date,status:'updated'});
      expect((await loadReadingDiscoveryCache('42','topic',signature))?.valid).toBe(false);
    }
  });
  it('persists confirmed empty success over the previous result', async () => {
    await saveReadingDiscoveryCache('42','topic','same',{repos:[repo],updatedAt:new Date().toISOString(),status:'updated'});
    await saveReadingDiscoveryCache('42','topic','same',{repos:[],updatedAt:new Date().toISOString(),status:'empty'});
    expect(await loadReadingDiscoveryCache('42','topic','same')).toMatchObject({valid:true,source:{repos:[],status:'empty'}});
  });
  it('preserves prior success freshness after a failed refresh but does not qualify a partial fetch as success', async () => {
    const date = new Date().toISOString();
    await saveReadingDiscoveryCache('42','topic','same',{repos:[repo],updatedAt:date,status:'updated'});
    await saveReadingDiscoveryCache('42','topic','same',{repos:[repo],updatedAt:date,status:'unavailable'});
    expect((await loadReadingDiscoveryCache('42','topic','same'))?.valid).toBe(true);
    await saveReadingDiscoveryCache('42','topic','same',{repos:[repo],updatedAt:date,status:'partial'});
    expect((await loadReadingDiscoveryCache('42','topic','same'))?.valid).toBe(false);
  });
  it('does not write results rejected by cancellation/account validation', async () => {
    await expect(saveReadingDiscoveryCache('42','topic','same',{repos:[repo],updatedAt:new Date().toISOString(),status:'updated'},()=>{throw Error('cancel');})).rejects.toThrow('cancel');
    expect(await loadReadingDiscoveryCache('42','topic','same')).toBeNull();
  });
  it('does not update access time when account validation fails during a cache read',async()=>{
    await saveReadingDiscoveryCache('42','topic','same',{repos:[repo],updatedAt:new Date().toISOString(),status:'updated'});
    const db=await openReadingDb();
    const before=await new Promise<{accessedAt:number}>((resolve,reject)=>{const read=db.transaction('discovery-cache','readonly').objectStore('discovery-cache').get(['42','topic','same']);read.onsuccess=()=>resolve(read.result);read.onerror=()=>reject(read.error);});db.close();
    let checks=0;await expect(loadReadingDiscoveryCache('42','topic','same',7,()=>{if(++checks>1)throw Error('account changed');})).rejects.toThrow('account changed');
    const next=await openReadingDb();const after=await new Promise<{accessedAt:number}>((resolve,reject)=>{const read=next.transaction('discovery-cache','readonly').objectStore('discovery-cache').get(['42','topic','same']);read.onsuccess=()=>resolve(read.result);read.onerror=()=>reject(read.error);});next.close();expect(after.accessedAt).toBe(before.accessedAt);
  });
  it('evicts least recently used records when the shared 100 MiB cap is exceeded', async () => {
    const db=await openReadingDb();
    await new Promise<void>((resolve,reject)=>{ const tx=db.transaction('discovery-cache','readwrite');
      for (const [signature,at] of [['old',1],['new',2]] as const) tx.objectStore('discovery-cache').put({accountId:'42',channelId:'topic',signature,source:{repos:[],updatedAt:'',status:'empty'},successfulAt:null,accessedAt:at,bytes:60*1024*1024},['42','topic',signature]);
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
    });db.close();
    await saveReadingDiscoveryCache('42','topic','third',{repos:[repo],updatedAt:new Date().toISOString(),status:'updated'});
    expect(await loadReadingDiscoveryCache('42','topic','old')).toBeNull(); expect(await loadReadingDiscoveryCache('42','topic','new')).not.toBeNull();
  });
});
