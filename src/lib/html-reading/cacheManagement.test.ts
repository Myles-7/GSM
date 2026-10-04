import { beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { readingCacheStatistics } from './cacheManagement';
import { saveReadingDiscoveryCache, loadReadingDiscoveryCache } from './cache';
import { readingTransaction, loadReadingData } from './storage';
beforeEach(()=>{vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('IDBKeyRange',IDBKeyRange);});
it('clears only selected-account discovery cache and preserves reading data and receipts',async()=>{
  for(const account of ['42','43'])await saveReadingDiscoveryCache(account,'trending','same',{repos:[],updatedAt:new Date().toISOString(),status:'empty'});
  await readingTransaction('42',data=>{data.states['1']={read:true,note:'precious',interest:'interested',candidate:true};data.applied.receipt='value';});
  const stats=await readingCacheStatistics('42');expect(stats.entries).toBe(1);expect(stats.bytes).toBeGreaterThan(0);
  await readingCacheStatistics('42',true);expect(await readingCacheStatistics('42')).toEqual({entries:0,bytes:0});expect(await loadReadingDiscoveryCache('43','trending','same')).not.toBeNull();expect((await loadReadingData('42')).states['1'].note).toBe('precious');expect((await loadReadingData('42')).applied.receipt).toBe('value');
});
