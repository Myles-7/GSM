import Database from 'better-sqlite3';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {searchCustomDiscovery} from '../../src/services/customDiscovery.js';
import {initializeSyncV2,pushOperations} from '../../src/services/syncV2.js';
import {encrypt} from '../../src/services/crypto.js';
import {config} from '../../src/config.js';
import {assessResults} from '../../src/core/customDiscovery.js';
let db:Database.Database;
const plan={version:1,required:[],excluded:[],preferred:[],branches:[{terms:['tools'],readme:true}],filters:{language:null,minStars:null,maxStars:null,createdWithinDays:null},filterSources:{language:null,minStars:null,maxStars:null,createdWithinDays:null},conflicts:[]};
beforeEach(()=>{db=new Database(':memory:');initializeSyncV2(db);db.exec("INSERT INTO sync_v2_workspace VALUES('home',42,'2026-09-29',0);CREATE TABLE settings(key TEXT,value TEXT)");db.prepare('INSERT INTO settings VALUES(?,?)').run('github_token',encrypt('secret',config.encryptionKey));});
afterEach(()=>{db.close();vi.unstubAllGlobals();});
describe('saved channel backend discovery',()=>{
 it('honors overrides, blocked/read/recommended exclusions and retrieves more than four candidates',async()=>{
  pushOperations(db,{workspaceId:'home',githubUserId:42,clientId:'test',operations:[{opId:'channel',collection:'discovery_subscriptions',id:'custom:tools',baseVersion:0,kind:'put',data:{id:'custom:tools',name:'Tools',instruction:'tools',revision:1,plan,ruleOverrides:{language:'Rust',minStars:10},limit:10,enabled:true,paused:false,blocked:[1],read:[2],recommended:{'3':'2026-09-01'},cursors:[]}}]});
  const items=Array.from({length:12},(_,i)=>({id:i+1,full_name:`owner/tool${i}`,description:'tools',topics:[],language:'Rust',stargazers_count:100,created_at:'2026-09-01',pushed_at:'2026-09-28'}));
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({id:42}))).mockResolvedValueOnce(new Response(JSON.stringify({items,incomplete_results:false})));vi.stubGlobal('fetch',fetcher);
  const result=await searchCustomDiscovery(db,'custom:tools',42,new AbortController().signal);expect(result?.names).toHaveLength(9);expect(result?.filtered).toBe(3);expect(result?.repositories.some(r=>[1,2,3].includes(Number(r.id)))).toBe(false);const url=new URL(fetcher.mock.calls[1][0]);expect(url.searchParams.get('q')).toContain('language:"Rust"');expect(url.searchParams.get('q')).toContain('stars:>=10');
 });
 it('does not invent evidence when matching required and excluded conditions',()=>{const constrained={...plan,required:[{text:'works offline',source:'offline'}]} as never;const repo={id:1,full_name:'owner/repo',pushed_at:'2026-09-29',stargazers_count:1};const unknown=assessResults([{id:1,relevance:2,reason:'claim',findings:[{kind:'required',index:0,status:'yes',quote:'fabricated literal quote'}]}],[{repo:repo as never,text:'documented source'}],constrained);expect(unknown[0].verdict).toBe('unknown');});
});
