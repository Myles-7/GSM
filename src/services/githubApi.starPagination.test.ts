import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubApiService } from './githubApi';
import type { Repository } from '../types';
const rows=(start:number,count=100)=>Array.from({length:count},(_,i)=>({id:start+i,full_name:`owner/repo-${start+i}`} as Repository));
afterEach(()=>vi.restoreAllMocks());
describe('bounded and resumable Star pagination',()=>{
  it('reports rate limiting immediately even if a speculative transport ignores abort',async()=>{
    const api=new GitHubApiService('fixture'),progress=vi.fn();let finish!: (value:Repository[])=>void;
    vi.spyOn(api,'getStarredRepositories').mockImplementation(async page=>{
      if(page===1)return rows(1);
      if(page===2)throw Object.assign(Error('rate limited'),{code:'rate_limited',retryAt:Date.now()+60000});
      return new Promise(resolve=>{finish=resolve;});
    });
    try {
      await expect(api.getAllStarredRepositories(undefined,progress)).rejects.toMatchObject({code:'rate_limited'});
      expect(progress.mock.lastCall?.[0]).toMatchObject({status:'rate_limited',fetched:100,page:2});
    } finally { finish?.([]); }
  });
  it('bounds concurrency, deduplicates pages, checkpoints only contiguous pages',async()=>{
    const api=new GitHubApiService('fixture');let active=0,max=0;
    vi.spyOn(api,'getStarredRepositories').mockImplementation(async page=>{active++;max=Math.max(max,active);await Promise.resolve();active--;return page===1?rows(1):page===2?rows(100):page===3?rows(200,2):[];});
    const checkpoint=vi.fn();const result=await api.getAllStarredRepositories(undefined,undefined,{onCheckpoint:checkpoint});
    expect(max).toBe(3);expect(result).toHaveLength(201);expect(checkpoint.mock.calls.map(call=>call[1])).toEqual([1,2,3]);
  });
  it('does not fail a completed final page due to a speculative later page failure',async()=>{
    const api=new GitHubApiService('fixture');
    vi.spyOn(api,'getStarredRepositories').mockImplementation(async page=>{if(page===1)return rows(1,3);throw Error('speculative failure');});
    expect(await api.getAllStarredRepositories()).toHaveLength(3);
  });
  it('retains a confirmed prefix and resumes without re-fetching its middle pages',async()=>{
    const api=new GitHubApiService('fixture');const progress=vi.fn(),checkpoint=vi.fn();
    const get=vi.spyOn(api,'getStarredRepositories').mockImplementation(async page=>{if(page===1)return rows(1);if(page===2)return rows(101);throw Object.assign(Error('rate limited'),{code:'rate_limited',retryAt:Date.now()+60000});});
    await expect(api.getAllStarredRepositories(undefined,progress,{onCheckpoint:checkpoint})).rejects.toMatchObject({code:'rate_limited'});
    expect(checkpoint.mock.calls.map(call=>call[1])).toEqual([1,2]);
    expect(progress.mock.calls[progress.mock.calls.length-1]?.[0]).toMatchObject({status:'rate_limited',fetched:200});
    get.mockClear();get.mockImplementation(async page=>page===1?rows(1):[]);
    const saved=checkpoint.mock.calls[checkpoint.mock.calls.length-1]![0];
    expect(await api.getAllStarredRepositories(undefined,undefined,{checkpoint:{...saved,repositories:[...rows(1),...rows(101)]}})).toHaveLength(200);
    expect(get.mock.calls.some(call=>call[0]===2)).toBe(false);
  });
  it('rejects a resumed checkpoint when the Star-list anchor changed',async()=>{
    const api=new GitHubApiService('fixture');vi.spyOn(api,'getStarredRepositories').mockResolvedValue(rows(2));
    await expect(api.getAllStarredRepositories(undefined,undefined,{checkpoint:{version:1,nextPage:2,firstPageIds:rows(1).map(row=>row.id),repositories:rows(1),startedAt:new Date().toISOString()}})).rejects.toMatchObject({code:'STAR_LIST_CHANGED'});
  });
  it('cancels speculative pages when the final page is already known',async()=>{
    const api=new GitHubApiService('fixture');let aborted=0;
    vi.spyOn(api,'getStarredRepositories').mockImplementation(async(page,_size,signal)=>{
      if(page===1)return rows(1,1);
      return new Promise((_resolve,reject)=>signal?.addEventListener('abort',()=>{aborted++;reject(Error('aborted'));},{once:true}));
    });
    expect(await api.getAllStarredRepositories()).toHaveLength(1);expect(aborted).toBe(2);
  });
});
