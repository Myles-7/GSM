import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {readStarSyncCheckpoint,writeStarSyncCheckpoint,clearStarSyncCheckpoint} from './starSyncCheckpoint';
import {setStorageEntries} from './indexedDbStorage';
import type {Repository} from '../types';
const rows=Array.from({length:100},(_,index)=>({id:index+1,full_name:`owner/repo-${index}`} as Repository));
const meta=()=>({version:1 as const,nextPage:2,startedAt:new Date().toISOString(),firstPageIds:rows.map(row=>row.id)});
beforeEach(()=>{vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('IDBKeyRange',IDBKeyRange);localStorage.clear();});
afterEach(()=>vi.unstubAllGlobals());
describe('durable star page checkpoints',()=>{
  it('reloads an ordered prefix, keeps owners separate and deletes only its exact namespace',async()=>{
    await writeStarSyncCheckpoint('42',meta(),1,rows);await writeStarSyncCheckpoint('420',meta(),1,rows);
    const tail=[{id:101,full_name:'owner/tail'} as Repository];await writeStarSyncCheckpoint('42',{...meta(),nextPage:3},2,tail);
    expect((await readStarSyncCheckpoint('42'))?.repositories).toEqual([...rows,...tail]);
    await clearStarSyncCheckpoint('42');expect(await readStarSyncCheckpoint('42')).toBeUndefined();expect((await readStarSyncCheckpoint('420'))?.repositories).toEqual(rows);
  });
  it.each(['invalid-json','missing-page','expired','bad-anchor'])('discards corrupt cache %s before starting a fresh snapshot',async fault=>{
    const base='gsm:star-sync:42';let value=meta();
    if(fault==='expired')value={...value,startedAt:'2020-01-01T00:00:00.000Z'};
    if(fault==='bad-anchor')value={...value,firstPageIds:[999]};
    await setStorageEntries(base,[[`${base}#meta`,fault==='invalid-json'?'{bad':JSON.stringify(value)],...(fault==='missing-page'?[]:[[`${base}#page:1`,JSON.stringify(rows)] as const])]);
    expect(await readStarSyncCheckpoint('42')).toBeUndefined();expect(await readStarSyncCheckpoint('42')).toBeUndefined();
  });
});
