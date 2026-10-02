import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {createDiscoveryRouter} from '../../src/routes/discovery.js';
import {initializeSyncV2,pushOperations,pullChanges} from '../../src/services/syncV2.js';
import {config} from '../../src/config.js';
import {encrypt} from '../../src/services/crypto.js';
let db:Database.Database;let originalSecret:string;const fetcher=vi.fn<typeof fetch>();
beforeEach(()=>{originalSecret=config.apiSecret;config.apiSecret='test-secret';db=new Database(':memory:');initializeSyncV2(db);db.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); INSERT INTO sync_v2_workspace VALUES('home',42,'2026-09-29',0)");db.prepare('INSERT INTO settings VALUES(?,?)').run('github_token',encrypt('private-github',config.encryptionKey));fetcher.mockReset();});
afterEach(()=>{db.close();config.apiSecret=originalSecret;});
const identity={workspaceId:'home',githubUserId:42};
const app=(id=42)=>express().use(express.json()).use(createDiscoveryRouter({db:()=>db,verifyAccount:async()=>({id,login:'test'}),fetcher}));
const get=(url:string,id=42)=>request(app(id)).get(url).set('Authorization','Bearer test-secret').query(identity);
describe('account-bound discovery',()=>{
 it('requires API secret and authorization',async()=>{expect((await request(app()).get('/api/discovery/code').query(identity)).status).toBe(401);config.apiSecret='';expect((await request(app()).get('/api/discovery/code').query(identity)).status).toBe(503);expect(fetcher).not.toHaveBeenCalled();});
 it('rejects account mismatch before an upstream call',async()=>{expect((await get('/api/discovery/code',43).query({q:'test'})).status).toBe(403);expect(fetcher).not.toHaveBeenCalled();});
 it('validates query, paging, repositories and social names',async()=>{for(const [url,query] of [['/api/discovery/code',{}],['/api/discovery/repositories',{page:'-2'}],['/api/discovery/repository',{repository:'../settings'}],['/api/discovery/telegram',{channel:'https://evil'}],['/api/discovery/x/profile',{handle:'../home'}]] as const)expect((await get(url).query(query)).status).toBe(400);expect(fetcher).not.toHaveBeenCalled();});
 it('uses server-held GitHub credential and returns real search data',async()=>{fetcher.mockResolvedValue(new Response(JSON.stringify({items:[{id:1,full_name:'owner/repo'}],total_count:1})));const response=await get('/api/discovery/repositories').query({kind:'search',q:'agent'});expect(response.body.items[0].full_name).toBe('owner/repo');expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({Authorization:'Bearer private-github'});expect(response.text).not.toContain('private-github');});
 it('falls back to trending RSS and enriches repository metadata',async()=>{fetcher.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(new Response('<rss><item><link>https://github.com/owner/repo</link></item></rss>')).mockResolvedValueOnce(new Response(JSON.stringify({id:8,full_name:'owner/repo'})));const response=await get('/api/discovery/repositories').query({kind:'trending'});expect(response.body.source).toBe('github-trending-rss');expect(response.body.items[0].id).toBe(8);});
 it('keeps official ranking order and available metadata when one repository disappears',async()=>{fetcher.mockResolvedValueOnce(new Response('<title>Trending repositories</title><article class="Box-row"><h2><a href="/owner/first">first</a></h2></article><article class="Box-row"><h2><a href="/owner/gone">gone</a></h2></article><article class="Box-row"><h2><a href="/owner/third">third</a></h2></article>')).mockImplementation(async url=>String(url).endsWith('/gone')?new Response('{}',{status:404}):new Response(JSON.stringify({id:1,full_name:String(url).endsWith('/first')?'owner/first':'owner/third'})));const response=await get('/api/discovery/repositories').query({kind:'trending'});expect(response.status).toBe(200);expect(response.body.source).toBe('github-trending');expect(response.body.items.map((r:{full_name:string})=>r.full_name)).toEqual(['owner/first','owner/third']);expect(response.body.incomplete_results).toBe(true);expect(response.body.warning).toBe('DISCOVERY_PARTIAL_UPSTREAM_FAILURE');});
 it('exposes account-bound stable popular cursors and refuses parameter changes',async()=>{
   fetcher.mockResolvedValue(new Response(JSON.stringify({items:[{id:1,full_name:'owner/one',stargazers_count:2000},{id:2,full_name:'owner/two',stargazers_count:1800}],total_count:2})));
   const first=await get('/api/discovery/popular').query({perPage:1,language:'Rust',topic:'cli'});expect(first.status).toBe(200);expect(first.body.items[0].id).toBe(1);expect(first.body.feedId).toBeTruthy();
   const restore=await get('/api/discovery/popular').query({feedId:first.body.feedId});expect(restore.status).toBe(200);expect(restore.body.items[0].id).toBe(1);
   const next=await get('/api/discovery/popular').query({feedId:first.body.feedId,after:first.body.nextAfter});expect(next.body.items[0].id).toBe(2);expect(fetcher).toHaveBeenCalledTimes(1);
   expect((await get('/api/discovery/popular').query({perPage:2,feedId:first.body.feedId})).status).toBe(409);
 });
 it('returns release tag, publication and body instead of a pushed date',async()=>{
   fetcher.mockResolvedValueOnce(new Response(JSON.stringify({items:[{id:1,full_name:'owner/one',pushed_at:'2026-09-30'}],total_count:1})))
     .mockResolvedValueOnce(new Response(JSON.stringify([{id:5,tag_name:'v1.2',draft:false,published_at:'2026-09-25T00:00:00Z',body:'Release changes'}])));
   const response=await get('/api/discovery/repositories').query({kind:'hot-release'});expect(response.body.source).toBe('github-releases');expect(response.body.items[0].release).toMatchObject({tagName:'v1.2',publishedAt:'2026-09-25T00:00:00Z',body:'Release changes'});
 });
 it('surfaces upstream failures without leaking provider error bodies',async()=>{fetcher.mockResolvedValue(new Response('secret-provider-content',{status:500}));const response=await get('/api/discovery/code').query({q:'test'});expect(response.status).toBe(502);expect(response.text).not.toContain('secret-provider-content');});
 it('encrypts X credentials, rejects SSRF and never sends cookies to static asset origin',async()=>{
   const save=await request(app()).post('/api/discovery/x/credentials').set('Authorization','Bearer test-secret').send({...identity,authToken:'private-x-session',ct0:'private-csrf'});expect(save.body.configured).toBe(true);expect(JSON.stringify(db.prepare('SELECT * FROM discovery_credentials').all())).not.toContain('private-x-session');
   expect((await get('/api/discovery/x/credentials')).text).not.toContain('private-x');
   const post=(url:string)=>request(app()).post('/api/discovery/x/graphql').set('Authorization','Bearer test-secret').send({...identity,url});
   expect((await post('https://x.com.evil.test/home')).status).toBe(400);expect(fetcher).not.toHaveBeenCalled();
   fetcher.mockResolvedValue(new Response('javascript'));expect((await post('https://abs.twimg.com/responsive-web/client-web/main.abc.js')).body.text).toBe('javascript');expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('Cookie');expect(fetcher.mock.calls[0][1]?.redirect).toBe('error');
 });
 it('syncs discovery state and rejects secret-bearing channel metadata',()=>{const result=pushOperations(db,{...identity,clientId:'mobile',operations:[{opId:'config',collection:'discovery_config',id:'default',baseVersion:0,kind:'put',data:{channelOrder:['trending'],channels:[{id:'custom',prompt:'tools'}]}}]});expect(result.results[0].status).toBe('applied');expect(JSON.stringify(pullChanges(db,0))).toContain('discovery_config');expect(()=>pushOperations(db,{...identity,clientId:'mobile',operations:[{opId:'bad',collection:'discovery_subscriptions',id:'x',baseVersion:0,kind:'put',data:{authToken:'secret'}}]})).toThrow('PRIVATE_DATA_NOT_SYNCABLE');});
});
