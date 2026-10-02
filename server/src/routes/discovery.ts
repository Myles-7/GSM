import { changeDiscoveryStar } from '../services/discoveryStar.js';
import { popularFeed, releaseFeed } from '../services/discoveryFeeds.js';
import { readTrending } from '../services/discoveryTrending.js';
import { fetchXTimeline } from '../services/discoveryX.js';
import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { getDb } from '../db/connection.js';
import { config } from '../config.js';
import { authMiddleware } from '../middleware/auth.js';
import { encrypt, decrypt } from '../services/crypto.js';
import { assertWorkspace, SyncError } from '../services/syncV2.js';
import { verifyServerGithubAccount, type GithubIdentity } from './syncV2.js';

const repositoryPattern = /^[\w.-]+\/[\w.-]+$/;
const xUrlAllowed = (url: string) => url === 'https://x.com/home' || /^https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[A-Za-z0-9_-]+\.js$/.test(url) || /^https:\/\/x\.com\/i\/api\/graphql\/[A-Za-z0-9_-]+\/(UserTweets|UserByScreenName)(?:\?[^#]*)?$/.test(url);
const xBearer = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const userAgent = 'Mozilla/5.0 Chrome/126.0 Safari/537.36';
function string(value: unknown, fallback = '', max = 500): string { if (value === undefined) return fallback; if (typeof value !== 'string' || value.length > max || [...value].some(character=>character.charCodeAt(0)<32)) throw new SyncError('INVALID_DISCOVERY_QUERY'); return value.trim(); }
function integer(value: unknown, fallback: number, max: number) { const n = value === undefined ? fallback : Number(string(value)); if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new SyncError('INVALID_DISCOVERY_PAGE'); return n; }
function repo(value: unknown) { const name = string(value); if (!repositoryPattern.test(name) || name.split('/').some(part => part === '.' || part === '..')) throw new SyncError('INVALID_REPOSITORY'); return name; }
/** Credentials live outside settings/export and sync records, bound to the home account. */
function credentialTable(db: Database.Database) { db.exec('CREATE TABLE IF NOT EXISTS discovery_credentials (workspace_id TEXT PRIMARY KEY, github_user_id INTEGER NOT NULL, value_encrypted TEXT NOT NULL)'); }
export function discoveryAvailability(db: Database.Database) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE name='discovery_credentials'").get();
  return { available: true, features: { stablePopular: true, publicReleases: true }, channels: ['trending','popular','new','hot-release','topics','search','code','weekly','x','telegram'], x: { configured: !!(exists && db.prepare('SELECT 1 FROM discovery_credentials LIMIT 1').get()), credentialSource: 'backend' }, credentials: 'backend' };
}
export function createDiscoveryRouter(options: { db?: () => Database.Database; verifyAccount?: (db: Database.Database) => Promise<GithubIdentity>; fetcher?: typeof fetch; requireSecret?: boolean } = {}) {
  const router = Router(); const database = options.db ?? getDb; const fetcher = options.fetcher ?? fetch;
  router.use('/api/discovery', (req,res,next) => { if (options.requireSecret !== false && !config.apiSecret) { res.status(503).json({code:'API_SECRET_REQUIRED'}); return; } authMiddleware(req,res,next); });
  async function upstream(url: string, headers: Record<string,string> = {}, json = true,timeoutMs=20000,signal?:AbortSignal) {
    let response: globalThis.Response;
    try { response = await fetcher(url, {headers,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs),redirect:'error'}); } catch { throw new SyncError('DISCOVERY_UPSTREAM_UNAVAILABLE',502); }
    if (!response.ok) { const limited=response.status===429||(response.status===403&&(response.headers.get('x-ratelimit-remaining')==='0'||response.headers.has('retry-after'))); throw new SyncError(limited?'DISCOVERY_RATE_LIMITED':response.status===404?'DISCOVERY_NOT_FOUND':'DISCOVERY_UPSTREAM_FAILED',limited?429:response.status===404?404:502); }
    const body = await response.text(); if (body.length > 6_000_000) throw new SyncError('DISCOVERY_RESPONSE_TOO_LARGE',502);
    try { return json ? JSON.parse(body) : body; } catch { throw new SyncError('DISCOVERY_INVALID_RESPONSE',502); }
  }
  async function github(db: Database.Database, path: string, optional = false,timeoutMs=20000,signal?:AbortSignal) {
    const row = db.prepare("SELECT value FROM settings WHERE key='github_token'").get() as {value:string}|undefined;
    if (!row) throw new SyncError('BACKEND_GITHUB_CREDENTIAL_REQUIRED',409);
    let token: string; try { token=decrypt(row.value,config.encryptionKey); } catch { throw new SyncError('BACKEND_GITHUB_CREDENTIAL_INVALID',409); }
    try { return await upstream(`https://api.github.com${path}`, {Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},true,timeoutMs,signal); } catch(e) { if(optional && e instanceof SyncError && e.status===404)return null; throw e; }
  }
  const handle = (fn: (req:Request,res:Response,db:Database.Database) => Promise<void>) => async (req:Request,res:Response) => {
    try { const db=database(); const source=req.method==='GET'?req.query:req.body; const workspace=assertWorkspace(db,string(source.workspaceId),Number(source.githubUserId)); const actual=await(options.verifyAccount??verifyServerGithubAccount)(db); if(actual.id!==workspace.githubUserId)throw new SyncError('BACKEND_ACCOUNT_MISMATCH',403); res.setHeader('Cache-Control','private, no-store'); await fn(req,res,db); }
    catch(error) { const known=error instanceof SyncError; res.status(known?error.status:502).json({code:known?error.code:'DISCOVERY_UPSTREAM_UNAVAILABLE',error:known?error.code:'DISCOVERY_UPSTREAM_UNAVAILABLE'}); }
  };
  router.post('/api/discovery/star',handle(async(req,res,db)=>{res.json(await changeDiscoveryStar(db,req.body,fetcher));}));
  router.get('/api/discovery/popular',handle(async(req,res,db)=>{
    res.json(await popularFeed(db,(path,optional)=>github(db,path,optional),{workspaceId:string(req.query.workspaceId),githubUserId:Number(req.query.githubUserId),...(req.query.language!==undefined?{language:string(req.query.language,'',60)}:{}),...(req.query.topic!==undefined?{topic:string(req.query.topic,'',100)}:{}),...(req.query.perPage!==undefined?{perPage:integer(req.query.perPage,30,100)}:{}),feedId:string(req.query.feedId,'',100),after:string(req.query.after,'',100)}));
  }));
  router.get('/api/discovery/repositories',handle(async(req,res,db)=>{
    const kind=string(req.query.kind,'popular'); const page=integer(req.query.page,1,34),perPage=integer(req.query.perPage,30,100); const language=string(req.query.language,'',60),topic=string(req.query.topic,'',100);
    if(!['trending','popular','new','hot-release','topics','search'].includes(kind))throw new SyncError('INVALID_DISCOVERY_KIND');
    if(kind==='hot-release') { if(page>33)throw new SyncError('INVALID_DISCOVERY_PAGE');res.json(await releaseFeed((path,optional,request)=>github(db,path,optional,request?.timeoutMs,request?.signal),{language,topic,page,perPage}));return; }
    if(kind==='trending') {
      const since=string(req.query.since,'weekly'); if(!['daily','weekly','monthly'].includes(since))throw new SyncError('INVALID_TRENDING_RANGE');
      const deadline=Date.now()+25000;
      const {names,source}=await readTrending(async url=>await upstream(url,{'User-Agent':userAgent},false,8000) as string,since,language);
      const selected=names.slice((page-1)*perPage,page*perPage),items=[];const failures:SyncError[]=[];
      for(let index=0;index<selected.length;index+=6){
        if(Date.now()>=deadline){failures.push(new SyncError('DISCOVERY_UPSTREAM_UNAVAILABLE',502));break;}
        const batch=await Promise.all(selected.slice(index,index+6).map(async name=>{
          try{return await github(db,`/repos/${name}`,false,Math.max(1,Math.min(8000,deadline-Date.now())));}
          catch(e){failures.push(e instanceof SyncError?e:new SyncError('DISCOVERY_UPSTREAM_UNAVAILABLE',502));return null;}
        }));items.push(...batch.filter(Boolean));
        if(failures.some(e=>e.code==='DISCOVERY_RATE_LIMITED'))break;
      }
      if(!items.length&&selected.length&&failures.length)throw failures[0];
      res.json({items:language?items.filter(r=>String(r.language).toLowerCase()===language.toLowerCase()):items,total_count:names.length,incomplete_results:failures.length>0,source,...(failures.length?{warning:failures.some(e=>e.code==='DISCOVERY_RATE_LIMITED')?'DISCOVERY_RATE_LIMITED':'DISCOVERY_PARTIAL_UPSTREAM_FAILURE'}:{})});return;
    }
    let q=string(req.query.q); if(kind==='search'&&!q)throw new SyncError('DISCOVERY_QUERY_REQUIRED');
    if(kind==='topics'&&!topic&&!q)throw new SyncError('DISCOVERY_TOPIC_REQUIRED');
    if(!q)q=kind==='new'?`created:>=${new Date(Date.now()-30*86400000).toISOString().slice(0,10)}`:'stars:>1000';
    if(language)q+=` language:${JSON.stringify(language)}`; if(topic)q+=` topic:${topic}`;
    const sort=string(req.query.sort,kind==='new'?'updated':'stars');const order=string(req.query.order,'desc');if(!['best-match','stars','forks','updated','help-wanted-issues'].includes(sort)||!['asc','desc'].includes(order))throw new SyncError('INVALID_DISCOVERY_SORT');if(page*perPage>1000)throw new SyncError('DISCOVERY_SEARCH_LIMIT');res.json(await github(db,`/search/repositories?${new URLSearchParams({q,...(sort==='best-match'?{}:{sort}),order,page:String(page),per_page:String(perPage)})}`));
  }));
  router.get('/api/discovery/code',handle(async(req,res,db)=>{const q=string(req.query.q);if(!q)throw new SyncError('DISCOVERY_QUERY_REQUIRED');res.json(await github(db,`/search/code?${new URLSearchParams({q,page:String(integer(req.query.page,1,34)),per_page:String(integer(req.query.perPage,30,100))})}`));}));
  router.get('/api/discovery/repository',handle(async(req,res,db)=>{const name=repo(req.query.repository);const repository=await github(db,`/repos/${name}`);const head=await github(db,`/repos/${name}/commits/${encodeURIComponent(repository.default_branch)}`);const readme=await github(db,`/repos/${name}/readme?ref=${encodeURIComponent(head.sha)}`,true);res.json({repository,readme:readme?.encoding==='base64'?Buffer.from(readme.content,'base64').toString('utf8'):'',readmePath:readme?.path,commit:head.sha});}));
  router.get('/api/discovery/weekly/issues',handle(async(req,res,db)=>{const name=repo(req.query.repository??'ruanyf/weekly');const items=await github(db,`/repos/${name}/issues?state=all&sort=updated&direction=desc&page=${integer(req.query.page,1,10000)}&per_page=${integer(req.query.perPage,50,100)}`);res.json({items:items.filter((item:{pull_request?:unknown})=>!item.pull_request)});}));
  router.get('/api/discovery/weekly/body',handle(async(req,res,db)=>{res.json(await github(db,`/repos/${repo(req.query.repository??'ruanyf/weekly')}/issues/${integer(req.query.number,0,2147483647)}`));}));
  router.get('/api/discovery/telegram',handle(async(req,res)=>{const channel=string(req.query.channel);const before=string(req.query.before);if(!/^[A-Za-z0-9_]{3,64}$/.test(channel)||before&&!/^\d{1,20}$/.test(before))throw new SyncError('INVALID_CHANNEL');res.json({html:await upstream(`https://t.me/s/${channel}${before?`?before=${before}`:''}`,{'User-Agent':userAgent},false)});}));
  router.get('/api/discovery/x/timeline',handle(async(req,res,db)=>{
    const handle=string(req.query.handle),cursor=string(req.query.cursor,'',4000);if(!/^[A-Za-z0-9_]{1,15}$/.test(handle))throw new SyncError('INVALID_HANDLE');
    credentialTable(db);const row=db.prepare('SELECT value_encrypted FROM discovery_credentials WHERE workspace_id=? AND github_user_id=?').get(req.query.workspaceId,Number(req.query.githubUserId)) as {value_encrypted:string}|undefined;if(!row)throw new SyncError('X_CREDENTIAL_REQUIRED',409);
    const auth=JSON.parse(decrypt(row.value_encrypted,config.encryptionKey));
    res.json(await fetchXTimeline(handle,cursor,async url=>{if(!xUrlAllowed(url))throw new SyncError('INVALID_X_URL');const headers:Record<string,string>={'User-Agent':userAgent};if(url.startsWith('https://x.com/'))headers.Cookie=`auth_token=${auth.authToken}; ct0=${auth.ct0}`;if(url.startsWith('https://x.com/i/api/'))Object.assign(headers,{Authorization:`Bearer ${xBearer}`,'X-CSRF-Token':auth.ct0,'X-Twitter-Auth-Type':'OAuth2Session','X-Twitter-Active-User':'yes'});return await upstream(url,headers,false) as string;}));
  }));
  router.get('/api/discovery/x/profile',handle(async(req,res)=>{const handle=string(req.query.handle);if(!/^[A-Za-z0-9_]{1,15}$/.test(handle))throw new SyncError('INVALID_HANDLE');res.json({html:await upstream(`https://x.com/${handle}`,{'User-Agent':userAgent},false)});}));
  router.get('/api/discovery/x/credentials',handle(async(req,res,db)=>{credentialTable(db);res.json({configured:!!db.prepare('SELECT 1 FROM discovery_credentials WHERE workspace_id=? AND github_user_id=?').get(req.query.workspaceId,Number(req.query.githubUserId)),credentialSource:'backend'});}));
  router.post('/api/discovery/x/credentials',handle(async(req,res,db)=>{credentialTable(db);if(req.body.clear===true){db.prepare('DELETE FROM discovery_credentials WHERE workspace_id=? AND github_user_id=?').run(req.body.workspaceId,req.body.githubUserId);res.json({configured:false});return;}const authToken=string(req.body.authToken,'',4096),ct0=string(req.body.ct0,'',4096);if(!/^[\w%+/=.~-]+$/.test(authToken)||!/^[\w%+/=.~-]+$/.test(ct0))throw new SyncError('INVALID_X_CREDENTIALS');db.prepare('INSERT INTO discovery_credentials VALUES(?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET github_user_id=excluded.github_user_id,value_encrypted=excluded.value_encrypted').run(req.body.workspaceId,req.body.githubUserId,encrypt(JSON.stringify({authToken,ct0}),config.encryptionKey));res.json({configured:true,credentialSource:'backend'});}));
  router.post('/api/discovery/x/graphql',handle(async(req,res,db)=>{const url=string(req.body.url,'',12000);if(!xUrlAllowed(url))throw new SyncError('INVALID_X_URL');credentialTable(db);const row=db.prepare('SELECT value_encrypted FROM discovery_credentials WHERE workspace_id=? AND github_user_id=?').get(req.body.workspaceId,req.body.githubUserId) as {value_encrypted:string}|undefined;if(!row)throw new SyncError('X_CREDENTIAL_REQUIRED',409);const auth=JSON.parse(decrypt(row.value_encrypted,config.encryptionKey));const headers:Record<string,string>={'User-Agent':userAgent};if(url.startsWith('https://x.com/'))headers.Cookie=`auth_token=${auth.authToken}; ct0=${auth.ct0}`;if(url.startsWith('https://x.com/i/api/'))Object.assign(headers,{Authorization:`Bearer ${xBearer}`,'X-CSRF-Token':auth.ct0,'X-Twitter-Auth-Type':'OAuth2Session','X-Twitter-Active-User':'yes'});const text=await upstream(url,headers,false);res.json({text});}));
  return router;
}
export default createDiscoveryRouter();
