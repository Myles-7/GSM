import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { SyncError } from './syncV2.js';

type Github = (path: string, optional?: boolean) => Promise<unknown>;
interface GithubRequestOptions { timeoutMs:number; signal:AbortSignal }
type ReleaseGithub = (path:string,optional?:boolean,options?:GithubRequestOptions)=>Promise<unknown>;
interface GithubRepository extends Record<string,unknown> { id:number; full_name:string }
interface StarRepository extends GithubRepository { stargazers_count:number }
interface GithubRelease extends Record<string,unknown> { id:number; tag_name:string; published_at:string; draft:false }
interface ReleaseItem extends GithubRepository { release:{id:number;tagName:string;name:string;publishedAt:string;body:string;htmlUrl:string|undefined;prerelease:boolean} }
function record(value:unknown):value is Record<string,unknown> {return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function searchResponse(value:unknown) {
  if(!record(value)||!Array.isArray(value.items)||!value.items.every(record)||typeof value.total_count!=='number'||!Number.isSafeInteger(value.total_count)||value.total_count<0)throw new SyncError('DISCOVERY_INVALID_RESPONSE',502);
  return {items:value.items as Record<string,unknown>[],total_count:value.total_count,incomplete_results:value.incomplete_results===true};
}
function repository(value:Record<string,unknown>):GithubRepository {
  if(typeof value.id!=='number'||!Number.isSafeInteger(value.id)||value.id<=0||typeof value.full_name!=='string'||!/^[\w.-]+\/[\w.-]+$/.test(value.full_name))throw new SyncError('DISCOVERY_INVALID_RESPONSE',502);
  return value as GithubRepository;
}
function publicRelease(value:unknown):value is GithubRelease {
  return record(value)&&typeof value.id==='number'&&Number.isSafeInteger(value.id)&&value.id>0&&value.draft===false&&typeof value.tag_name==='string'&&value.tag_name.length>0&&typeof value.published_at==='string'&&Number.isFinite(Date.parse(value.published_at));
}
interface Range { low: number; high: number | null; page: number }
interface State { ranges: Range[]; incomplete: boolean; truncatedTies: boolean; requests: number }
interface Feed { id:string; parameters:string; state:string }
function initialize(db:Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS discovery_feeds(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,github_user_id INTEGER NOT NULL,parameters TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS discovery_feed_items(feed_id TEXT NOT NULL,position INTEGER NOT NULL,repository_id INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(feed_id,position),UNIQUE(feed_id,repository_id));
    CREATE TABLE IF NOT EXISTS discovery_feed_cursors(token TEXT PRIMARY KEY,feed_id TEXT NOT NULL,position INTEGER NOT NULL);`);
}
const locks = new Map<string,Promise<unknown>>();
/** Append-only repository snapshots. A retry consumes the same cursor and never reorders saved rows. */
export async function popularFeed(db:Database.Database, github:Github, requested:{workspaceId:string;githubUserId:number;language?:string;topic?:string;perPage?:number;feedId:string;after:string}) {
  initialize(db);
  let input={...requested,language:requested.language??'',topic:requested.topic??'',perPage:requested.perPage??30};
  let parameters=JSON.stringify({language:input.language,topic:input.topic,perPage:input.perPage});
  let feed:Feed|undefined;
  if(input.feedId) {
    feed=db.prepare('SELECT id,parameters,state FROM discovery_feeds WHERE id=? AND workspace_id=? AND github_user_id=?').get(input.feedId,input.workspaceId,input.githubUserId) as Feed|undefined;
    if(!feed)throw new SyncError('DISCOVERY_FEED_NOT_FOUND',404);
    const saved=JSON.parse(feed.parameters) as {language:string;topic:string;perPage:number};
    if(requested.language!==undefined&&requested.language!==saved.language||requested.topic!==undefined&&requested.topic!==saved.topic||requested.perPage!==undefined&&requested.perPage!==saved.perPage)throw new SyncError('DISCOVERY_FEED_PARAMETERS_CHANGED',409);
    input={...input,...saved};parameters=feed.parameters;
  } else {
    if(input.after)throw new SyncError('INVALID_DISCOVERY_CURSOR');
    feed={id:randomUUID(),parameters,state:JSON.stringify({ranges:[{low:1001,high:null,page:1}],incomplete:false,truncatedTies:false,requests:0} satisfies State)};
    db.prepare('INSERT INTO discovery_feeds VALUES(?,?,?,?,?,?)').run(feed.id,input.workspaceId,input.githubUserId,parameters,feed.state,new Date().toISOString());
  }
  const id=feed.id;
  const previous=locks.get(id)??Promise.resolve();
  const work=previous.catch(()=>{}).then(async()=>{
    let position=0;
    if(input.after) {
      const cursor=db.prepare('SELECT position FROM discovery_feed_cursors WHERE token=? AND feed_id=?').get(input.after,id) as {position:number}|undefined;
      if(!cursor)throw new SyncError('INVALID_DISCOVERY_CURSOR');
      position=cursor.position;
    }
    const state=JSON.parse((db.prepare('SELECT state FROM discovery_feeds WHERE id=?').get(id) as {state:string}).state) as State;
    let count=(db.prepare('SELECT COUNT(*) count FROM discovery_feed_items WHERE feed_id=?').get(id) as {count:number}).count;
    let warning:string|undefined;
    for(let attempt=0;count<position+input.perPage&&state.ranges.length&&attempt<4;attempt++) {
      const range=state.ranges[0];
      const q=[range.high===null?`stars:>=${range.low}`:`stars:${range.low}..${range.high}`,input.language?`language:${JSON.stringify(input.language)}`:'',input.topic?`topic:${input.topic}`:''].filter(Boolean).join(' ');
      let upstream:unknown;
      try {upstream=await github(`/search/repositories?${new URLSearchParams({q,sort:'stars',order:'desc',per_page:'100',page:String(range.page)})}`);} catch(error) {
        if(!(error instanceof SyncError))throw error;
        warning=error.code;break;
      }
      const response=searchResponse(upstream);
      const rows=response.items.map(value=>{
        const row=repository(value);
        if(typeof row.stargazers_count!=='number'||!Number.isSafeInteger(row.stargazers_count)||row.stargazers_count<range.low||range.high!==null&&row.stargazers_count>range.high)throw new SyncError('DISCOVERY_INVALID_RESPONSE',502);
        return row as StarRepository;
      });
      state.requests++;state.incomplete ||= response.incomplete_results===true;
      // Split overfull search ranges before consuming them, keeping high-star ranges first.
      const min=rows.length?Math.min(...rows.map(r=>r.stargazers_count)):range.low;
      const max=rows.length?Math.max(...rows.map(r=>r.stargazers_count)):range.low;
      const pivot=range.high===null?min:Math.floor((range.low+range.high)/2);
      if(range.page===1&&response.total_count>1000&&max>range.low&&pivot>=range.low&&(range.high===null||pivot<range.high)) {
        state.ranges.splice(0,1,{low:pivot+1,high:range.high,page:1},{low:range.low,high:pivot,page:1});
      } else {
        db.transaction(()=>{for(const row of rows) {
          if(db.prepare('SELECT 1 FROM discovery_feed_items WHERE feed_id=? AND repository_id=?').get(id,row.id))continue;
          db.prepare('INSERT INTO discovery_feed_items VALUES(?,?,?,?)').run(id,count++,row.id,JSON.stringify(row));
        }})();
        if(range.page>=10||rows.length<100||range.page*100>=response.total_count) {
          state.ranges.shift();if(response.total_count>1000)state.truncatedTies=true;
        } else range.page++;
      }
      db.prepare('UPDATE discovery_feeds SET state=? WHERE id=?').run(JSON.stringify(state),id);
      if(state.requests>=5000){state.ranges=[];state.incomplete=true;db.prepare('UPDATE discovery_feeds SET state=? WHERE id=?').run(JSON.stringify(state),id);break;}
    }
    const items=(db.prepare('SELECT data FROM discovery_feed_items WHERE feed_id=? AND position>=? ORDER BY position LIMIT ?').all(id,position,input.perPage) as {data:string}[]).map(row=>JSON.parse(row.data) as StarRepository);
    const nextPosition=position+items.length,hasMore=nextPosition<count||state.ranges.length>0;
    const nextAfter=hasMore?randomUUID():null;
    if(nextAfter)db.prepare('INSERT INTO discovery_feed_cursors VALUES(?,?,?)').run(nextAfter,id,nextPosition);
    return {items,feedId:id,nextAfter,hasMore,total_count:count,incomplete_results:state.incomplete||state.truncatedTies,source:'github-search-star-buckets',coverage:{minimumStars:1001,searchLimitPerBucket:1000,truncatedTies:state.truncatedTies,snapshot:'append-only',complete:!hasMore&&!state.incomplete&&!state.truncatedTies},...(warning?{warning}:{})};
  });
  locks.set(id,work);try{return await work;}finally{if(locks.get(id)===work)locks.delete(id);}
}

/** Public Releases from a disclosed, bounded candidate set; pushed_at is never a release date. */
export async function releaseFeed(github:ReleaseGithub,input:{language:string;topic:string;page:number;perPage:number}) {
  const requestBudgetMs=60000,deadline=Date.now()+requestBudgetMs;
  // Enforce the deadline even if an injected transport does not honor cancellation.
  async function boundedGithub(path:string,optional:boolean,maxTimeoutMs:number) {
    const timeoutMs=Math.min(maxTimeoutMs,deadline-Date.now());
    if(timeoutMs<=0)throw new SyncError('DISCOVERY_UPSTREAM_UNAVAILABLE',502);
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(()=>github(path,optional,{timeoutMs,signal:controller.signal})),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new SyncError('DISCOVERY_UPSTREAM_UNAVAILABLE',502));},timeoutMs);}),
      ]);
    } finally {clearTimeout(timer);}
  }
  const q=['stars:>1000',input.language?`language:${JSON.stringify(input.language)}`:'',input.topic?`topic:${input.topic}`:''].filter(Boolean).join(' ');
  const candidates=searchResponse(await boundedGithub(`/search/repositories?${new URLSearchParams({q,sort:'updated',order:'desc',per_page:'30',page:String(input.page)})}`,false,20000));
  const items:ReleaseItem[]=[];const failures:SyncError[]=[];
  let checkedRepositories=0,successfulRepositories=0,budgetExhausted=false;
  // Limit concurrent repository API calls while allowing individual failures.
  for(let index=0;index<candidates.items.length;index+=4) {
    if(Date.now()>=deadline){budgetExhausted=true;break;}
    await Promise.all(candidates.items.slice(index,index+4).map(async(value)=>{
      checkedRepositories++;
      try {
        const candidate=repository(value);
        const releases=await boundedGithub(`/repos/${candidate.full_name}/releases?per_page=5&page=1`,true,10000);
        if(releases===null){successfulRepositories++;return;}
        if(!Array.isArray(releases))throw new SyncError('DISCOVERY_INVALID_RESPONSE',502);
        successfulRepositories++;
        const latest=releases.filter(publicRelease).sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at))[0];
        if(latest)items.push({...candidate,release:{id:latest.id,tagName:latest.tag_name,name:typeof latest.name==='string'?latest.name:latest.tag_name,publishedAt:latest.published_at,body:typeof latest.body==='string'?latest.body:'',htmlUrl:typeof latest.html_url==='string'?latest.html_url:undefined,prerelease:latest.prerelease===true}});
      } catch(error) {failures.push(error instanceof SyncError?error:new SyncError('DISCOVERY_UPSTREAM_UNAVAILABLE',502));}
    }));
    if(Date.now()>=deadline)budgetExhausted=true;
    if(budgetExhausted||failures.some(error=>error.code==='DISCOVERY_RATE_LIMITED'))break;
  }
  const rateLimit=failures.find(error=>error.code==='DISCOVERY_RATE_LIMITED');
  if(candidates.items.length&&!successfulRepositories)throw rateLimit??failures[0]??new SyncError('DISCOVERY_UPSTREAM_UNAVAILABLE',502);
  items.sort((a,b)=>Date.parse(b.release.publishedAt)-Date.parse(a.release.publishedAt)||a.id-b.id);
  const candidateCount=Math.min(Number(candidates.total_count)||0,990);
  const hasMore=candidates.items.length>0&&input.page<33&&input.page*30<candidateCount;
  return {items:items.slice(0,input.perPage),total_count:candidateCount,hasMore,nextPage:hasMore?input.page+1:null,incomplete_results:candidates.incomplete_results===true||failures.length>0||budgetExhausted,source:'github-releases',coverage:{candidateQuery:q,candidatePage:input.page,candidateLimit:30,candidatePageLimit:33,candidateScopeLimit:990,releasesPerRepository:5,checkedRepositories,successfulRepositories,failedRepositories:failures.length,requestBudgetMs,budgetExhausted,scope:'recently-updated-popular-repositories',globalReleaseFeed:false},...(failures.length||budgetExhausted?{warning:rateLimit?'DISCOVERY_RATE_LIMITED':'DISCOVERY_PARTIAL_UPSTREAM_FAILURE'}:{})};
}
