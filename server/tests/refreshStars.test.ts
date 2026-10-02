import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import Database from 'better-sqlite3';
import {initializeSyncV2,getRecord,pushOperations} from '../src/services/syncV2.js';
import {initializeTasks,createTask,getTask,cancelTask,resumeTask,runTask,stopTaskRunner,type CreateTask} from '../src/services/taskRunner.js';
import {encrypt} from '../src/services/crypto.js';
import {config} from '../src/config.js';
let db:Database.Database;
const identity={workspaceId:'workspace',githubUserId:42};
const request:CreateTask={...identity,requestId:'refresh',kind:'refresh_stars',input:{}};
const star=(id:number,extra:Record<string,unknown>={})=>({starred_at:'2026-09-01T00:00:00Z',repo:{id,name:`repo${id}`,full_name:`owner/repo${id}`,description:'new upstream',owner:{login:'owner',avatar_url:'https://example.com/avatar'},html_url:`https://github.com/owner/repo${id}`,topics:[],...extra}});
const response=(body:unknown,link?:string)=>new Response(JSON.stringify(body),{headers:link?{link}:undefined});
function put(id:string,data:Record<string,unknown>,collection:'repositories'|'organization'|'messages'='repositories') {
  const current=getRecord(db,collection,id);
  pushOperations(db,{...identity,clientId:'test',operations:[{opId:crypto.randomUUID(),collection,id,baseVersion:current?.version??0,kind:'put',source:'user',data}]});
}
beforeEach(()=>{db=new Database(':memory:');initializeSyncV2(db);initializeTasks(db);db.exec("INSERT INTO sync_v2_workspace(id,github_user_id,initialized_at) VALUES('workspace',42,'2026-09-29');CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)");db.prepare('INSERT INTO settings VALUES(?,?)').run('github_token',encrypt('fake-token',config.encryptionKey));put('1',{id:1,full_name:'owner/repo1',description:'old',notes:'my note',ai_details:{summary:'AI'},category_id:'mine',category_locked:true,github_star_state:'starred'});put('2',{id:2,full_name:'owner/repo2',notes:'keep even unstarred',ai_summary:'keep',github_star_state:'starred'});put('default',{customCategories:[{id:'mine',name:'Mine'}],githubStarsLastCheckedAt:'old'},'organization');put('message',{id:'message',content:'saved conversation'},'messages');});
afterEach(async()=>{vi.useRealTimers();await stopTaskRunner();db.close();vi.restoreAllMocks();});
describe('non-model durable GitHub stars refresh',()=>{
 it('deduplicates requests without a model configuration and limits active work per workspace',()=>{
   const task=createTask(db,request);expect(createTask(db,request).id).toBe(task.id);
   expect(()=>createTask(db,{...request,requestId:'second'})).toThrow('REFRESH_STARS_TASK_ACTIVE');
   expect(()=>createTask(db,{...request,input:{prompt:'different'}})).toThrow('REQUEST_ID_CONFLICT');
   expect(()=>createTask(db,{...request,githubUserId:43})).toThrow('WORKSPACE_ACCOUNT_MISMATCH');
   cancelTask(db,task.id,identity.workspaceId,identity.githubUserId);
   createTask(db,{...request,requestId:'second'});
   expect(()=>resumeTask(db,task.id,identity.workspaceId,identity.githubUserId)).toThrow('REFRESH_STARS_TASK_ACTIVE');
 });
 it('reconciles complete pages atomically and preserves concurrent notes, categories, locks and AI fields',async()=>{
   const task=createTask(db,request),model=vi.fn(),evidence=vi.fn();
   const githubFetch=vi.fn<typeof fetch>().mockImplementation(async(url)=>{
     if(String(url).endsWith('/user'))return response({id:42});
     const current=getRecord(db,'repositories','1')!;
     put('1',{...current.data,notes:'edited while GitHub request ran',category_id:'new-category'});
     return response([star(1,{notes:'malicious upstream',ai_summary:'overwrite',category_id:'overwrite'}),star(3)]);
   });
   await runTask(db,task,{githubFetch,model,evidence});
   expect(getTask(db,task.id,'workspace',42)).toMatchObject({status:'completed',result:{fetched:2,updated:1,added:1,unstarred:1}});
   expect(model).not.toHaveBeenCalled();expect(evidence).not.toHaveBeenCalled();
   expect(getRecord(db,'repositories','1')?.data).toMatchObject({description:'new upstream',notes:'edited while GitHub request ran',category_id:'new-category',category_locked:true,ai_details:{summary:'AI'},github_star_state:'starred'});
   expect(getRecord(db,'repositories','2')).toMatchObject({deleted:false,data:{notes:'keep even unstarred',ai_summary:'keep',github_star_state:'unstarred'}});
   expect(getRecord(db,'repositories','3')?.data?.github_star_state).toBe('starred');
   expect(getRecord(db,'organization','default')?.data).toMatchObject({customCategories:[{id:'mine',name:'Mine'}],githubStarsLastCheckedAt:expect.stringMatching(/^20/)});
   expect(getRecord(db,'messages','message')?.version).toBe(1);
 });
 it('keeps failed page work staged and resumes from the persisted page without unstar marking',async()=>{
   const task=createTask(db,request);
   const githubFetch=vi.fn<typeof fetch>().mockResolvedValueOnce(response({id:42})).mockResolvedValueOnce(response([star(1)],'<https://api.github.com/user/starred?per_page=100&page=2>; rel="next"')).mockResolvedValueOnce(new Response('',{status:502}));
   await runTask(db,task,{githubFetch});
   expect(getTask(db,task.id,'workspace',42)).toMatchObject({status:'interrupted',error:'GITHUB_HTTP_502',checkpoint:{stars:{nextPage:2,complete:false}}});
   expect(getRecord(db,'repositories','1')?.version).toBe(1);expect(getRecord(db,'repositories','2')?.data?.github_star_state).toBe('starred');expect(getRecord(db,'organization','default')?.data?.githubStarsLastCheckedAt).toBe('old');
   githubFetch.mockResolvedValueOnce(response({id:42})).mockResolvedValueOnce(response([star(3)]));
   await runTask(db,resumeTask(db,task.id,'workspace',42),{githubFetch});
   expect(String(githubFetch.mock.calls[4][0])).toContain('page=2');
   expect(getTask(db,task.id,'workspace',42).status).toBe('completed');
   expect(getRecord(db,'repositories','1')?.data?.github_star_state).toBe('starred');
 });
 it('rejects a rotated credential for a different account before fetching stars',async()=>{
   const task=createTask(db,request),githubFetch=vi.fn<typeof fetch>().mockResolvedValue(response({id:99}));
   await runTask(db,task,{githubFetch});expect(githubFetch).toHaveBeenCalledTimes(1);
   expect(getTask(db,task.id,'workspace',42)).toMatchObject({status:'interrupted',error:'GITHUB_ACCOUNT_MISMATCH'});
   expect(getRecord(db,'repositories','2')?.version).toBe(1);
 });
 it('cancels an in-flight next page and never commits its late response',async()=>{
   const task=createTask(db,request);let release!:(response:Response)=>void;
   const githubFetch=vi.fn<typeof fetch>().mockResolvedValueOnce(response({id:42})).mockResolvedValueOnce(response([star(1)],'<https://api.github.com/user/starred?per_page=100&page=2>; rel="next"')).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
   const pending=runTask(db,task,{githubFetch});await vi.waitFor(()=>expect(githubFetch).toHaveBeenCalledTimes(3));
   cancelTask(db,task.id,'workspace',42);release(response([]));await pending;
   expect(getTask(db,task.id,'workspace',42).status).toBe('cancelled');
   expect(getRecord(db,'repositories','2')?.data?.github_star_state).toBe('starred');expect(getRecord(db,'organization','default')?.data?.githubStarsLastCheckedAt).toBe('old');
 });
 it('automatically recovers fetching and complete saving checkpoints after restart',async()=>{
   const task=createTask(db,request);
   db.prepare('INSERT INTO task_refresh_stars VALUES(?,?,?)').run(task.id,'1',JSON.stringify({id:1,full_name:'owner/repo1',description:'staged'}));
   db.prepare("UPDATE ai_tasks SET status='running',stage='saving',checkpoint=? WHERE id=?").run(JSON.stringify({stars:{nextPage:2,complete:true,fetched:1}}),task.id);
   initializeTasks(db);
   const recovered=getTask(db,task.id,'workspace',42);expect(recovered.status).toBe('queued');
   const githubFetch=vi.fn<typeof fetch>().mockResolvedValue(response({id:42}));
   await runTask(db,recovered,{githubFetch});expect(githubFetch).toHaveBeenCalledTimes(1);
   expect(getTask(db,task.id,'workspace',42).status).toBe('completed');
   const version=getRecord(db,'repositories','1')?.version;
   await runTask(db,getTask(db,task.id,'workspace',42),{githubFetch});expect(getRecord(db,'repositories','1')?.version).toBe(version);
   const fetching=createTask(db,{...request,requestId:'fetching'});
   db.prepare("UPDATE ai_tasks SET status='running',stage='fetching' WHERE id=?").run(fetching.id);initializeTasks(db);expect(getTask(db,fetching.id,'workspace',42).status).toBe('queued');
 });
 it('rolls back the entire reconciliation if a canonical write fails',async()=>{
   db.exec("CREATE TRIGGER fail_stars BEFORE UPDATE ON sync_v2_records WHEN NEW.id='2' AND NEW.collection='repositories' BEGIN SELECT RAISE(ABORT,'test failure'); END");
   const task=createTask(db,request),githubFetch=vi.fn<typeof fetch>().mockResolvedValueOnce(response({id:42})).mockResolvedValueOnce(response([star(1),star(3)]));
   await runTask(db,task,{githubFetch});
   expect(getTask(db,task.id,'workspace',42).status).toBe('interrupted');expect(getRecord(db,'repositories','1')?.version).toBe(1);expect(getRecord(db,'repositories','3')).toBeNull();expect(getRecord(db,'organization','default')?.data?.githubStarsLastCheckedAt).toBe('old');
 });
 it('walks full pages without a Link header and handles more than one sync batch',async()=>{
   const task=createTask(db,request);
   const githubFetch=vi.fn<typeof fetch>().mockImplementation(async(url)=>{
     if(String(url).endsWith('/user'))return response({id:42});
     const page=Number(new URL(String(url)).searchParams.get('page'));
     return response(page<=6?Array.from({length:100},(_,n)=>star((page-1)*100+n+1)):[]);
   });
   await runTask(db,task,{githubFetch});
   expect(githubFetch).toHaveBeenCalledTimes(8);expect(getTask(db,task.id,'workspace',42)).toMatchObject({status:'completed',result:{fetched:600,added:598,updated:2,unstarred:0}});
   expect(getRecord(db,'repositories','600')?.data?.github_star_state).toBe('starred');
 });
 it('does not resurrect explicitly deleted records or update unrelated business collections',async()=>{
   pushOperations(db,{...identity,clientId:'test',operations:[{opId:'delete',collection:'repositories',id:'2',baseVersion:1,kind:'delete',source:'user'}]});
   const task=createTask(db,request),githubFetch=vi.fn<typeof fetch>().mockResolvedValueOnce(response({id:42})).mockResolvedValueOnce(response([star(1),star(2)]));
   await runTask(db,task,{githubFetch});expect(getRecord(db,'repositories','2')).toMatchObject({deleted:true,version:2});expect(getRecord(db,'messages','message')?.version).toBe(1);
 });
 it('refuses malformed pages and untrusted pagination before committing records',async()=>{
   const task=createTask(db,request),githubFetch=vi.fn<typeof fetch>().mockResolvedValueOnce(response({id:42})).mockResolvedValueOnce(response([star(1)],'<https://evil.example/user/starred?page=2>; rel="next"'));
   await runTask(db,task,{githubFetch});expect(getTask(db,task.id,'workspace',42)).toMatchObject({status:'interrupted',error:'GITHUB_STARS_INVALID_PAGINATION'});expect(getRecord(db,'repositories','1')?.version).toBe(1);
 });
 it.each(['headers','body'])('times out stalled %s while preserving the previous page checkpoint',async(stalled)=>{
   vi.useFakeTimers();
   const task=createTask(db,request);let requestSignal:AbortSignal|undefined;
   const githubFetch=vi.fn<typeof fetch>().mockResolvedValueOnce(response({id:42})).mockResolvedValueOnce(response([star(1)],'<https://api.github.com/user/starred?per_page=100&page=2>; rel="next"')).mockImplementationOnce(async(_url,init)=>{
     requestSignal=init?.signal as AbortSignal;
     if(stalled==='headers')return new Promise<Response>(()=>{});
     const result=response([]);vi.spyOn(result,'text').mockImplementation(()=>new Promise<string>(()=>{}));return result;
   });
   const pending=runTask(db,task,{githubFetch});
   await vi.advanceTimersByTimeAsync(0);expect(githubFetch).toHaveBeenCalledTimes(3);
   await vi.advanceTimersByTimeAsync(20000);await pending;
   expect(requestSignal?.aborted).toBe(true);
   expect(getTask(db,task.id,'workspace',42)).toMatchObject({status:'interrupted',error:'GITHUB_REQUEST_TIMEOUT',checkpoint:{stars:{nextPage:2,complete:false}}});
   expect(getRecord(db,'repositories','2')?.data?.github_star_state).toBe('starred');expect(getRecord(db,'organization','default')?.data?.githubStarsLastCheckedAt).toBe('old');
   githubFetch.mockResolvedValueOnce(response({id:42})).mockResolvedValueOnce(response([]));
   await runTask(db,resumeTask(db,task.id,'workspace',42),{githubFetch});expect(getTask(db,task.id,'workspace',42).status).toBe('completed');
 });
});
