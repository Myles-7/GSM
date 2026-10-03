import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { popularFeed, releaseFeed } from '../../src/services/discoveryFeeds.js';
import { SyncError } from '../../src/services/syncV2.js';
let db:Database.Database;
beforeEach(()=>{db=new Database(':memory:');});
afterEach(()=>{db.close();vi.useRealTimers();});
const input={workspaceId:'home',githubUserId:42,language:'',topic:'',perPage:2,feedId:'',after:''};
const repository=(id:number,stars=10000)=>({id,full_name:`owner/repo${id}`,stargazers_count:stars,description:`Saved ${id}`});
describe('persistent popular discovery feed',()=>{
 it('keeps saved order and data across retry, upstream changes and continuation',async()=>{
   const github=vi.fn().mockResolvedValue({items:[repository(3),repository(2),repository(1)],total_count:3});
   const first=await popularFeed(db,github,input);expect(first.items.map(r=>r.id)).toEqual([3,2]);
   github.mockResolvedValue({items:[repository(99)],total_count:1});
   const resumed=await popularFeed(db,github,{...input,feedId:first.feedId,after:first.nextAfter!});
   expect(resumed.items.map(r=>r.id)).toEqual([1]);expect(resumed.hasMore).toBe(false);
   const replay=await popularFeed(db,github,{...input,feedId:first.feedId});expect(replay.items).toEqual(first.items);expect(github).toHaveBeenCalledTimes(1);
   const refreshed=await popularFeed(db,github,input);expect(refreshed.feedId).not.toBe(first.feedId);expect(refreshed.items[0].id).toBe(99);
 });
 it('binds account, cursor and all request parameters',async()=>{
   const github=vi.fn().mockResolvedValue({items:[repository(1),repository(2),repository(3)],total_count:3});const feed=await popularFeed(db,github,input);
   await expect(popularFeed(db,github,{...input,feedId:feed.feedId,githubUserId:43})).rejects.toThrow('DISCOVERY_FEED_NOT_FOUND');
   await expect(popularFeed(db,github,{...input,feedId:feed.feedId,language:'Rust'})).rejects.toThrow('DISCOVERY_FEED_PARAMETERS_CHANGED');
   await expect(popularFeed(db,github,{...input,feedId:feed.feedId,after:'tampered'})).rejects.toThrow('INVALID_DISCOVERY_CURSOR');
 });
 it('restores feed rows and opaque cursor after reopening SQLite',async()=>{
   const github=vi.fn().mockResolvedValue({items:[repository(1),repository(2),repository(3)],total_count:3});
   const first=await popularFeed(db,github,input);const bytes=db.serialize();db.close();db=new Database(bytes);
   const restored=await popularFeed(db,github,{...input,feedId:first.feedId,after:first.nextAfter!});
   expect(restored.items.map(r=>r.id)).toEqual([3]);expect(github).toHaveBeenCalledTimes(1);
 });
 it('derives omitted parameters from a filtered saved feed while rejecting explicit changes',async()=>{
   const github=vi.fn().mockResolvedValue({items:[repository(1),repository(2),repository(3)],total_count:3});
   const first=await popularFeed(db,github,{...input,language:'Rust',topic:'cli',perPage:1});
   const restored=await popularFeed(db,github,{workspaceId:'home',githubUserId:42,feedId:first.feedId,after:''});expect(restored.items.map(r=>r.id)).toEqual([1]);
   const next=await popularFeed(db,github,{workspaceId:'home',githubUserId:42,feedId:first.feedId,after:first.nextAfter!});expect(next.items.map(r=>r.id)).toEqual([2]);
   await expect(popularFeed(db,github,{workspaceId:'home',githubUserId:42,feedId:first.feedId,after:'',language:''})).rejects.toThrow('DISCOVERY_FEED_PARAMETERS_CHANGED');
 });
 it('retains successfully fetched rows and checkpoint on rate limiting',async()=>{
   const rows=Array.from({length:100},(_,i)=>repository(i+1));
   const github=vi.fn().mockResolvedValueOnce({items:rows,total_count:200}).mockRejectedValueOnce(new SyncError('DISCOVERY_RATE_LIMITED',429));
   const first=await popularFeed(db,github,{...input,perPage:100});
   const limited=await popularFeed(db,github,{...input,perPage:100,feedId:first.feedId,after:first.nextAfter!});expect(limited.warning).toBe('DISCOVERY_RATE_LIMITED');expect(limited.hasMore).toBe(true);
   github.mockResolvedValueOnce({items:[repository(101)],total_count:101});
   const resumed=await popularFeed(db,github,{...input,perPage:100,feedId:first.feedId,after:limited.nextAfter!});expect(resumed.items[0].id).toBe(101);expect(github.mock.calls[2][0]).toContain('page=2');
 });
 it('splits overfull buckets and strictly deduplicates repository IDs',async()=>{
   const github=vi.fn().mockResolvedValueOnce({items:[repository(1,20000),repository(2,15000)],total_count:2000})
     .mockResolvedValueOnce({items:[repository(1,20000)],total_count:1})
     .mockResolvedValueOnce({items:[repository(2,15000),repository(2,15000),repository(3,12000)],total_count:3});
   const first=await popularFeed(db,github,input);expect(first.items.map(r=>r.id)).toEqual([1,2]);
   const last=await popularFeed(db,github,{...input,feedId:first.feedId,after:first.nextAfter!});expect(last.items.map(r=>r.id)).toEqual([3]);
   expect(github.mock.calls[1][0]).toContain('stars%3A%3E%3D15001');expect(github.mock.calls[2][0]).toContain('stars%3A1001..15000');
 });
 it('caps each GitHub query at ten pages even for an unsplittable star tie',async()=>{
   const github=vi.fn(async(path:string)=>{const page=Number(new URL(`https://api.github.com${path}`).searchParams.get('page'));return {items:Array.from({length:100},(_,i)=>repository((page-1)*100+i+1,1001)),total_count:1500};});
   let response=await popularFeed(db,github,{...input,perPage:100});
   for(let n=0;n<9;n++)response=await popularFeed(db,github,{...input,perPage:100,feedId:response.feedId,after:response.nextAfter!});
   expect(response.hasMore).toBe(false);expect(response.coverage.truncatedTies).toBe(true);expect(github).toHaveBeenCalledTimes(10);expect(response.total_count).toBe(1000);
 });
});
describe('real release discovery',()=>{
 const releaseInput={language:'',topic:'',page:1,perPage:30};
 const release={id:5,tag_name:'v1',draft:false,published_at:'2026-09-29T00:00:00Z'};
 it('throws when every repository read fails so clients can retain saved releases',async()=>{
   const github=vi.fn(async(path:string)=>{
     if(path.startsWith('/search'))return {items:[repository(1),repository(2)],total_count:2};
     throw new SyncError('DISCOVERY_UPSTREAM_FAILED',502);
   });
   await expect(releaseFeed(github,releaseInput)).rejects.toMatchObject({code:'DISCOVERY_UPSTREAM_FAILED',status:502});
 });
 it('allows a verified empty release result when repository reads succeed',async()=>{
   const github=vi.fn(async(path:string)=>path.startsWith('/search')?{items:[repository(1),repository(2)],total_count:2}:[]);
   expect(await releaseFeed(github,releaseInput)).toMatchObject({items:[],incomplete_results:false,coverage:{checkedRepositories:2,successfulRepositories:2,failedRepositories:0,budgetExhausted:false}});
 });
 it('stops after the current wave on rate limiting and keeps successful releases',async()=>{
   const github=vi.fn(async(path:string)=>{
     if(path.startsWith('/search'))return {items:Array.from({length:30},(_,i)=>repository(i+1)),total_count:30};
     if(path.startsWith('/repos/owner/repo1/'))return [release];
     throw new SyncError('DISCOVERY_RATE_LIMITED',429);
   });
   const response=await releaseFeed(github,releaseInput);
   expect(response).toMatchObject({warning:'DISCOVERY_RATE_LIMITED',incomplete_results:true,coverage:{checkedRepositories:4,successfulRepositories:1,failedRepositories:3}});
   expect(response.items.map(item=>item.id)).toEqual([1]);expect(github).toHaveBeenCalledTimes(5);
 });
 it('preserves the rate limit error when the whole first wave fails',async()=>{
   const github=vi.fn(async(path:string)=>{
     if(path.startsWith('/search'))return {items:Array.from({length:30},(_,i)=>repository(i+1)),total_count:30};
     throw new SyncError(path.includes('repo1/')?'DISCOVERY_UPSTREAM_FAILED':'DISCOVERY_RATE_LIMITED',429);
   });
   await expect(releaseFeed(github,releaseInput)).rejects.toMatchObject({code:'DISCOVERY_RATE_LIMITED',status:429});
   expect(github).toHaveBeenCalledTimes(5);
 });
 it('bounds the candidate search even when its transport ignores the abort signal',async()=>{
   vi.useFakeTimers();
   const github=vi.fn<(_path:string,_optional?:boolean,_request?:{timeoutMs:number;signal:AbortSignal})=>Promise<unknown>>(()=>new Promise<unknown>(()=>{}));
   const result=releaseFeed(github,releaseInput).catch(error=>error);
   await vi.advanceTimersByTimeAsync(20000);
   expect(await result).toMatchObject({code:'DISCOVERY_UPSTREAM_UNAVAILABLE'});
   expect(github).toHaveBeenCalledTimes(1);expect(github.mock.calls[0][2]?.timeoutMs).toBe(20000);expect(github.mock.calls[0][2]?.signal.aborted).toBe(true);
   expect(vi.getTimerCount()).toBe(0);
 });
 it('includes candidate search time in the 60 second budget and reports only attempted repositories',async()=>{
   vi.useFakeTimers();const started=Date.now();
   const github=vi.fn<(path:string,_optional?:boolean,_request?:{timeoutMs:number;signal:AbortSignal})=>Promise<unknown>>((path)=>{
     if(path.startsWith('/search'))return new Promise<unknown>(resolve=>setTimeout(()=>resolve({items:Array.from({length:30},(_,i)=>repository(i+1)),total_count:30}),15000));
     if(path.startsWith('/repos/owner/repo1/'))return Promise.resolve([release]);
     return new Promise<unknown>(()=>{});
   });
   const result=releaseFeed(github,releaseInput);
   await vi.advanceTimersByTimeAsync(60000);
   const response=await result;
   expect(Date.now()-started).toBe(60000);
   expect(response).toMatchObject({warning:'DISCOVERY_PARTIAL_UPSTREAM_FAILURE',incomplete_results:true,coverage:{checkedRepositories:20,successfulRepositories:1,failedRepositories:19,requestBudgetMs:60000,budgetExhausted:true}});
   expect(response.items.map(item=>item.id)).toEqual([1]);expect(github).toHaveBeenCalledTimes(21);
   const reads=github.mock.calls.slice(1);
   expect(reads.every(call=>call[2]!.timeoutMs<=10000)).toBe(true);
   expect(reads.slice(-4).map(call=>call[2]!.timeoutMs)).toEqual([5000,5000,5000,5000]);
   expect(reads.slice(1).every(call=>call[2]!.signal.aborted)).toBe(true);expect(vi.getTimerCount()).toBe(0);
 });
 it('caps continuation at the last supported candidate page for searches exceeding the GitHub cap',async()=>{
   const github=vi.fn(async(path:string)=>path.startsWith('/search')?{items:[repository(1)],total_count:50000}:[]);
   const first=await releaseFeed(github,{language:'',topic:'',page:1,perPage:30});expect(first).toMatchObject({total_count:990,hasMore:true,nextPage:2});
   const last=await releaseFeed(github,{language:'',topic:'',page:33,perPage:30});expect(last).toMatchObject({total_count:990,hasMore:false,nextPage:null});
   github.mockImplementation(async()=>({items:[],total_count:0}));expect((await releaseFeed(github,{language:'',topic:'',page:1,perPage:30})).hasMore).toBe(false);
 });
 it('uses actual public release data and discloses bounded candidate coverage',async()=>{
   const github=vi.fn().mockResolvedValueOnce({items:[repository(1),repository(2)],total_count:5000})
     .mockResolvedValueOnce([{id:5,tag_name:'draft',draft:true,published_at:'2026-09-30'}, {id:6,tag_name:'v2',name:'Version 2',draft:false,published_at:'2026-09-29T00:00:00Z',body:'Real notes',html_url:'https://github.com/owner/repo1/releases/tag/v2'}])
     .mockRejectedValueOnce(new SyncError('DISCOVERY_UPSTREAM_FAILED',502));
   const response=await releaseFeed(github,{language:'',topic:'',page:1,perPage:30});expect(response.items).toHaveLength(1);
   expect(response.items[0].release).toMatchObject({tagName:'v2',publishedAt:'2026-09-29T00:00:00Z',body:'Real notes'});
   expect(response.coverage).toMatchObject({globalReleaseFeed:false,candidateLimit:30,failedRepositories:1});expect(response.incomplete_results).toBe(true);
   expect(github.mock.calls[0][0]).not.toContain('pushed');
 });
});
