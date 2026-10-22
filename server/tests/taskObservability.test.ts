import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initializeSyncV2, getRecord } from '../src/services/syncV2.js';
import { config } from '../src/config.js';
import { encrypt } from '../src/services/crypto.js';
import { initializeTasks, createTask, getTask, runTask, pauseTask, continueTask, resumeTask, cancelTask, taskEvents, taskEvent, pruneTaskEvents, retainTaskHistory } from '../src/services/taskRunner.js';
let db:Database.Database;
const account={workspaceId:'workspace',githubUserId:42};
const base={...account,requestId:'a',configId:'deepseek',kind:'summary' as const,input:{repositories:['owner/one','owner/two']}};
const evidence=async(_db:unknown,names:string[])=>[{repository:names[0],commit:'a'.repeat(40),retrievedAt:'2026-10-22',metadata:{id:names[0]==='owner/one'?1:2},readme:'docs',tree:[],files:[],limitations:[]}];
const answer=JSON.stringify({summary:'answer',tags:[],platforms:[]});
beforeEach(()=>{db=new Database(':memory:');initializeSyncV2(db);initializeTasks(db);db.exec("INSERT INTO sync_v2_workspace(id,github_user_id,initialized_at) VALUES('workspace',42,'2026-10-22');CREATE TABLE ai_configs(id TEXT,api_key_encrypted TEXT,base_url TEXT,model TEXT,reasoning_effort TEXT)");db.prepare('INSERT INTO ai_configs VALUES(?,?,?,?,?)').run('deepseek',encrypt('fake-key',config.encryptionKey),'https://api.deepseek.com','deepseek-chat',null);});
afterEach(()=>{db.close();vi.unstubAllGlobals();});
it('pauses dispatch after the in-flight repository saves and continues without repeating it',async()=>{
 const task=createTask(db,base);let release!:(s:string)=>void;
 const model=vi.fn(()=>new Promise<string>(r=>{release=r;}));
 const running=runTask(db,task,{evidence,model});await vi.waitFor(()=>expect(model).toHaveBeenCalledOnce());
 expect(pauseTask(db,task.id,'workspace',42)).toMatchObject({status:'running',pauseRequested:true});
 release(answer);await running;
 expect(getTask(db,task.id,'workspace',42)).toMatchObject({status:'paused',checkpoint:{batch:{completed:[{repository:'owner/one'}]}}});
 expect(getRecord(db,'messages',`${task.id}:batch:0`)?.data?.content).toBe(answer);
 initializeTasks(db);expect(getTask(db,task.id,'workspace',42).status).toBe('paused');
 expect(()=>resumeTask(db,task.id,'workspace',42)).toThrow('TASK_NOT_RESUMABLE');
 const next=vi.fn(async()=>answer);await runTask(db,continueTask(db,task.id,'workspace',42),{evidence,model:next});
 expect(next).toHaveBeenCalledOnce();expect(getTask(db,task.id,'workspace',42).result?.completed).toBe(2);
});
it('enforces ownership, rejects unsupported pause, and can cancel a queued pause',()=>{
 const task=createTask(db,base);expect(()=>pauseTask(db,task.id,'workspace',43)).toThrow('WORKSPACE_ACCOUNT_MISMATCH');
 expect(pauseTask(db,task.id,'workspace',42).status).toBe('paused');
 expect(cancelTask(db,task.id,'workspace',42).status).toBe('cancelled');
 const chat=createTask(db,{...base,requestId:'chat',kind:'chat',input:{}});expect(()=>pauseTask(db,chat.id,'workspace',42)).toThrow('TASK_PAUSE_UNSUPPORTED');
});
it('retains exposed reasoning separately, request identities, raw results, and cumulative byte counts once',async()=>{
 const task=createTask(db,base);await runTask(db,task,{evidence,model:async(_t,_e,_s,emit)=>{emit('reasoning',{text:'思考'});emit('content',{text:answer});return answer;}});
 const events=taskEvents(db,task.id,0);expect(events.filter(e=>e.type==='reasoning').map(e=>e.data.text)).toEqual(['思考','思考']);
 const requests=events.filter(e=>e.type==='provider_request');expect(requests).toHaveLength(2);expect(new Set(requests.map(e=>e.data.providerRequestId)).size).toBe(2);
 expect(requests[1].data).toMatchObject({requestId:'a',phase:'generating',batch:{index:1,total:2,repository:'owner/two'}});
 expect(events.filter(e=>e.type==='provider_result').map(e=>e.data.content)).toEqual([answer,answer]);
 expect(getTask(db,task.id,'workspace',42).diagnostics).toMatchObject({cumulative:true,providerRequests:2,contentBytes:Buffer.byteLength(answer)*2,reasoningBytes:12});
 expect(getRecord(db,'messages',`${task.id}:batch:0`)?.data?.content).toBe(answer);
});
it('caps non-body events and marks gaps while preserving durable result and bounded UTF8 previews',async()=>{
 const task=createTask(db,base);for(let i=0;i<5010;i++)taskEvent(db,task.id,'progress',{i});
 const count=db.prepare("SELECT COUNT(*) n FROM ai_task_events WHERE task_id=? AND type NOT IN ('content','reasoning','provider_request','provider_result')").get(task.id) as {n:number};expect(count.n).toBeLessThanOrEqual(5000);
 expect(getTask(db,task.id,'workspace',42).diagnostics.truncated).toBe(true);
 taskEvent(db,task.id,'provider_request',{body:'中'.repeat(400000)});
 const request=db.prepare("SELECT data FROM ai_task_events WHERE task_id=? AND type='provider_request'").get(task.id) as {data:string};const preview=JSON.parse(request.data);expect(Buffer.byteLength(preview.body)).toBeLessThanOrEqual(1024*1024);expect(preview.truncated).toBe(true);expect(preview.body).not.toContain('�');
 await runTask(db,task,{evidence,model:async()=>answer});expect(getTask(db,task.id,'workspace',42).status).toBe('completed');
});
it('retains paused history and recoverable validated conflicts beyond terminal history expiry',()=>{
 const task=createTask(db,base);pauseTask(db,task.id,'workspace',42);
 const conflict=createTask(db,{...base,requestId:'conflict'});db.prepare("UPDATE ai_tasks SET status='interrupted',commit_status='conflict',checkpoint=? WHERE id=?").run(JSON.stringify({validated:true,content:answer,value:{},evidence:[]}),conflict.id);
 db.prepare("UPDATE ai_tasks SET updated_at='2026-01-01'").run();db.prepare("UPDATE ai_task_events SET created_at='2026-01-01'").run();
 expect(pruneTaskEvents(db,new Date('2026-10-22'))).toBe(0);
});
it('bounds the account cache without deleting active data and advances SSE gaps through final save',async()=>{
 const task=createTask(db,base);const before=db.prepare('SELECT * FROM ai_task_events WHERE task_id=?').all(task.id);
 db.prepare('UPDATE ai_task_diagnostics SET stored_bytes=? WHERE task_id=?').run(256*1024*1024-1024,task.id);
 taskEvent(db,task.id,'reasoning',{text:'x'.repeat(4096)});
 const first=getTask(db,task.id,'workspace',42);expect(first.diagnostics).toMatchObject({truncated:true,reasoningBytes:4096,droppedEvents:1});
 expect(taskEvents(db,task.id,0)[0]).toMatchObject({type:'resync',data:{reason:'DIAGNOSTIC_GAP'}});
 await runTask(db,task,{evidence,model:async()=>answer});
 const completed=getTask(db,task.id,'workspace',42);expect(completed.status).toBe('completed');expect(completed.lastSeq).toBeGreaterThan(first.lastSeq);
 expect(taskEvents(db,task.id,first.lastSeq)[0]).toMatchObject({type:'resync',data:{task:{status:'completed'}}});
 expect(taskEvents(db,task.id,completed.lastSeq)).toEqual([]);
 expect(db.prepare('SELECT * FROM ai_task_events WHERE seq=?').get((before[0] as {seq:number}).seq)).toEqual(before[0]);
 expect(completed.diagnostics.storedBytes).toBeLessThanOrEqual(256*1024*1024);
 expect(getRecord(db,'messages',`${task.id}:batch:0`)?.data?.content).toBe(answer);
});
it('does not auto resend a provider call after restart even with a pending dispatch pause',()=>{
 const task=createTask(db,base);db.prepare("UPDATE ai_tasks SET status='running',stage='model',provider_outcome='in_flight',pause_requested=1 WHERE id=?").run(task.id);
 initializeTasks(db);expect(getTask(db,task.id,'workspace',42)).toMatchObject({status:'interrupted',providerOutcome:'unknown',pauseRequested:true});
 expect(()=>continueTask(db,task.id,'workspace',42)).toThrow('TASK_NOT_CONTINUABLE');
});
it('records the actual provider request body without authorization and retains actual usage separately',async()=>{
 const task=createTask(db,{...base,kind:'chat',input:{prompt:'Explain'}});
 const fetcher=vi.fn(async()=>new Response('data: {"choices":[{"delta":{"reasoning_content":"exposed","content":"answer"}}]}\n\ndata: {"usage":{"prompt_tokens":10,"completion_tokens":3},"choices":[]}\n\ndata: [DONE]\n\n'));
 vi.stubGlobal('fetch',fetcher);await runTask(db,task);
 expect(fetcher).toHaveBeenCalledOnce();
 const events=taskEvents(db,task.id,0),request=events.find(e=>e.type==='provider_request')!;
 expect(request.data.body).toBe((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body);
 expect(JSON.stringify(events)).not.toContain('fake-key');
 expect(events.find(e=>e.type==='provider_usage')?.data).toMatchObject({cumulative:true,providerRequestId:request.data.providerRequestId,usage:{prompt_tokens:10,completion_tokens:3}});
 expect(getTask(db,task.id,'workspace',42)).toMatchObject({diagnostics:{providerRequests:1,contentBytes:6,reasoningBytes:7},result:{content:'answer'}});
});


it('protects manually retained and unknown history from 30-day cleanup with owner validation',()=>{
 const pinned=createTask(db,base),unknown=createTask(db,{...base,requestId:'unknown'});
 db.prepare("UPDATE ai_tasks SET status='completed',provider_outcome='succeeded',commit_status='saved',updated_at='2026-01-01'").run();
 db.prepare("UPDATE ai_tasks SET provider_outcome='unknown' WHERE id=?").run(unknown.id);
 db.prepare("UPDATE ai_task_events SET created_at='2026-01-01'").run();
 expect(()=>retainTaskHistory(db,pinned.id,'workspace',43,true)).toThrow('WORKSPACE_ACCOUNT_MISMATCH');
 expect(retainTaskHistory(db,pinned.id,'workspace',42,true).pinned).toBe(true);
 expect(pruneTaskEvents(db,new Date('2026-10-22'))).toBe(0);
 retainTaskHistory(db,pinned.id,'workspace',42,false);
 expect(pruneTaskEvents(db,new Date('2026-10-22'))).toBeGreaterThan(0);
 expect(taskEvents(db,unknown.id,0).some(e=>e.type!=='resync')).toBe(true);
});
