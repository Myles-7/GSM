import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import Database from 'better-sqlite3';
import {initializeSyncV2,getRecord,pushOperations} from '../src/services/syncV2.js';
import {applyTaskProposal} from '../src/services/taskProposals.js';
import {encrypt} from '../src/services/crypto.js';
import {config} from '../src/config.js';
import {initializeTasks,createTask,getTask,cancelTask,resumeTask,runTask,taskEvents,pruneTaskEvents,startTaskRunner,stopTaskRunner,type CreateTask} from '../src/services/taskRunner.js';
import {readModelStream} from '../src/services/taskModel.js';
import {bindTaskProjectPrompt} from '../src/services/taskProject.js';
let db:Database.Database;
const base:CreateTask={requestId:'a',workspaceId:'workspace',githubUserId:42,configId:'deepseek',kind:'chat',input:{prompt:'Explain this'}};
beforeEach(()=>{db=new Database(':memory:');initializeSyncV2(db);initializeTasks(db);db.exec("INSERT INTO sync_v2_workspace(id,github_user_id,initialized_at) VALUES('workspace',42,'2026-09-29');CREATE TABLE ai_configs(id TEXT,api_key_encrypted TEXT,base_url TEXT,model TEXT,reasoning_effort TEXT);INSERT INTO ai_configs VALUES('deepseek','encrypted','https://api.deepseek.com','deepseek-chat',NULL)");db.prepare('UPDATE ai_configs SET api_key_encrypted=?').run(encrypt('fake-deepseek-key',config.encryptionKey));});
afterEach(async()=>{await stopTaskRunner();db.close();vi.restoreAllMocks();});
describe('durable task execution',()=>{
 it('is idempotent and refuses request ID reuse with changed payload',()=>{const a=createTask(db,base);expect(createTask(db,base).id).toBe(a.id);expect(()=>createTask(db,{...base,input:{prompt:'different'}})).toThrow('REQUEST_ID_CONFLICT');});
 it('rejects wrong account for creation and retrieval',()=>{const task=createTask(db,base);expect(()=>createTask(db,{...base,githubUserId:43})).toThrow('WORKSPACE_ACCOUNT_MISMATCH');expect(()=>getTask(db,task.id,'workspace',43)).toThrow('WORKSPACE_ACCOUNT_MISMATCH');});
 it('persists final result and sync message atomically; reasoning never escapes',async()=>{const task=createTask(db,base);await runTask(db,task,{model:async(_t,_e,_s,emit)=>{emit('reasoning',{text:'private thought'});emit('content',{text:'answer'});return 'answer';}});const result=getTask(db,task.id,'workspace',42);expect(result.status).toBe('completed');expect(getRecord(db,'messages',task.id)?.data?.content).toBe('answer');expect(JSON.stringify(taskEvents(db,task.id,0))).not.toContain('private thought');const seq=taskEvents(db,task.id,0)[1].seq;expect(taskEvents(db,task.id,seq).every(e=>e.seq>seq)).toBe(true);});
 it('marks unknown calls interrupted after restart without reissuing the model call',()=>{const task=createTask(db,base);db.prepare("UPDATE ai_tasks SET status='running',stage='model',checkpoint=? WHERE id=?").run(JSON.stringify({evidence:[]}),task.id);initializeTasks(db);const recovered=getTask(db,task.id,'workspace',42);expect(recovered.status).toBe('interrupted');expect(recovered.error).toBe('SERVER_RESTART_UNKNOWN_CALL');expect(resumeTask(db,task.id,'workspace',42).status).toBe('queued');});
 it.each(['queued','evidence','search'])('automatically requeues a safe %s stage after restart',stage=>{
   const task=createTask(db,base);db.prepare("UPDATE ai_tasks SET status='running',stage=? WHERE id=?").run(stage,task.id);
   initializeTasks(db);expect(getTask(db,task.id,'workspace',42)).toMatchObject({status:'queued',error:null});
   expect(taskEvents(db,task.id,0).at(-1)?.data.status).toBe('queued');
 });
 it.each(['model','saving'])('recovers a validated %s checkpoint without another provider call',async stage=>{
   const task=createTask(db,base);db.prepare("UPDATE ai_tasks SET status='running',stage=?,checkpoint=? WHERE id=?").run(stage,JSON.stringify({evidence:[],validated:true,content:'saved answer',value:{content:'saved answer'}}),task.id);
   initializeTasks(db);const recovered=getTask(db,task.id,'workspace',42);expect(recovered.status).toBe('queued');
   const model=vi.fn();await runTask(db,recovered,{model});expect(model).not.toHaveBeenCalled();
   expect(getTask(db,task.id,'workspace',42)).toMatchObject({status:'completed',result:{content:'saved answer'}});
 });
 it('requeues committed batch items while leaving unvalidated saving and research calls interrupted',()=>{
   const batch=createTask(db,{...base,requestId:'batch',kind:'summary',input:{repositories:['owner/one','owner/two']}});
   db.prepare("UPDATE ai_tasks SET status='running',stage='saving',checkpoint=? WHERE id=?").run(JSON.stringify({batch:{current:null,completed:[{repository:'owner/one'}]}}),batch.id);
   for(const stage of ['saving','planning','drafting','reviewing']){const task=createTask(db,{...base,requestId:stage});db.prepare("UPDATE ai_tasks SET status='running',stage=? WHERE id=?").run(stage,task.id);}
   initializeTasks(db);expect(getTask(db,batch.id,'workspace',42).status).toBe('queued');
   const interrupted=db.prepare("SELECT request_id FROM ai_tasks WHERE status='interrupted'").all();expect(interrupted).toHaveLength(4);
 });
 it('resumes safe evidence checkpoint and requires explicit action after provider failure',async()=>{const task=createTask(db,{...base,input:{repositories:['owner/repo']}});db.prepare('UPDATE ai_tasks SET checkpoint=? WHERE id=?').run(JSON.stringify({evidence:[]}),task.id);const evidence=vi.fn();await runTask(db,getTask(db,task.id,'workspace',42),{evidence,model:async()=>{throw new Error('UNKNOWN_CALL');}});expect(evidence).not.toHaveBeenCalled();expect(getTask(db,task.id,'workspace',42).status).toBe('interrupted');});
 it('cancels running work and ignores late result',async()=>{const task=createTask(db,base);let resolve!:(value:string)=>void;const promise=runTask(db,task,{model:()=>new Promise(r=>{resolve=r;})});cancelTask(db,task.id,'workspace',42);resolve('late answer');await promise;expect(getTask(db,task.id,'workspace',42).status).toBe('cancelled');expect(getRecord(db,'messages',task.id)).toBeNull();});
 it('keeps the original cancellation controller when duplicate execution is attempted',async()=>{
   const task=createTask(db,base);let resolve!:(value:string)=>void;
   const model=vi.fn(()=>new Promise<string>(r=>{resolve=r;}));
   const pending=runTask(db,task,{model});await runTask(db,task,{model});
   cancelTask(db,task.id,'workspace',42);expect(()=>resumeTask(db,task.id,'workspace',42)).toThrow('TASK_STILL_STOPPING');
   resolve('late');await pending;expect(model).toHaveBeenCalledTimes(1);
   expect(getTask(db,task.id,'workspace',42).status).toBe('cancelled');expect(getRecord(db,'messages',task.id)).toBeNull();
 });
 it('prunes only old terminal streams and recovers expired cursors from a durable result snapshot',async()=>{
   const task=createTask(db,base);await runTask(db,task,{model:async()=> 'retained answer'});
   const queued=createTask(db,{...base,requestId:'queued'});
   const lastSeq=getTask(db,task.id,'workspace',42).lastSeq;
   db.prepare('UPDATE ai_task_events SET created_at=?').run('2026-07-01T00:00:00.000Z');
   db.prepare('UPDATE ai_tasks SET updated_at=?').run('2026-07-01T00:00:00.000Z');
   expect(pruneTaskEvents(db,new Date('2026-09-29T00:00:00.000Z'))).toBeGreaterThan(0);
   expect(getTask(db,task.id,'workspace',42).lastSeq).toBe(lastSeq);
   const events=taskEvents(db,task.id,0);expect(events).toHaveLength(1);
   expect(events[0]).toMatchObject({seq:lastSeq,type:'resync',data:{reason:'EVENT_CURSOR_EXPIRED',task:{status:'completed',result:{content:'retained answer'}}}});
   expect(events[0].data.task).not.toHaveProperty('checkpoint');
   expect(taskEvents(db,task.id,lastSeq)).toEqual([]);
   expect(taskEvents(db,queued.id,0)[0].type).toBe('state');
   expect(getRecord(db,'messages',task.id)?.data?.content).toBe('retained answer');
   expect(pruneTaskEvents(db,new Date('2026-09-29T00:00:00.000Z'))).toBe(0);
 });
 it('preserves recent terminal streams and keeps cursors monotonic when an expired cancelled task resumes',()=>{
   const task=createTask(db,base);cancelTask(db,task.id,'workspace',42);
   expect(pruneTaskEvents(db)).toBe(0);
   db.prepare('UPDATE ai_task_events SET created_at=?').run('2026-07-01T00:00:00.000Z');
   db.prepare('UPDATE ai_tasks SET updated_at=?').run('2026-07-01T00:00:00.000Z');
   const cursor=getTask(db,task.id,'workspace',42).lastSeq;
   pruneTaskEvents(db,new Date('2026-09-29T00:00:00.000Z'));
   const resumed=resumeTask(db,task.id,'workspace',42);expect(resumed.lastSeq).toBeGreaterThan(cursor);
   expect(taskEvents(db,task.id,0)[0]).toMatchObject({type:'resync',seq:resumed.lastSeq,data:{task:{status:'queued'}}});
   expect(taskEvents(db,task.id,cursor)[0]).toMatchObject({type:'state',data:{status:'queued'}});
 });
 it('never starts a third provider call concurrently',async()=>{for(let n=0;n<4;n++)createTask(db,{...base,requestId:String(n)});const releases:Array<(s:string)=>void>=[];const model=vi.fn(()=>new Promise<string>(r=>releases.push(r)));startTaskRunner(db,{model});expect(model).toHaveBeenCalledTimes(2);stopTaskRunner();for(const release of releases)release('answer');await new Promise(r=>setTimeout(r,10));});
 it('checks decrypted configuration before accepting paid work',()=>{db.prepare('UPDATE ai_configs SET api_key_encrypted=?').run('invalid');expect(()=>createTask(db,base)).toThrow('AI_CONFIG_DECRYPT_FAILED');});
 it('checkpoints completed batch repositories and resumes without repeating completed calls',async()=>{
   const task=createTask(db,{...base,kind:'summary',input:{repositories:['owner/one','owner/two']}});
   const evidence=vi.fn(async(_db:Database.Database,names:string[])=>[{repository:names[0],commit:'a'.repeat(40),retrievedAt:'2026-09-29T00:00:00.000Z',metadata:{id:names[0].endsWith('one')?1:2},readme:'docs',tree:[],files:[],limitations:[]}]);
   let calls=0;const model=vi.fn(async()=>{calls++;if(calls===2)throw new Error('MODEL_UNKNOWN');return JSON.stringify({summary:'summary',tags:[],platforms:[]});});
   await runTask(db,task,{evidence,model});expect(getTask(db,task.id,'workspace',42).checkpoint.batch.completed).toHaveLength(1);
   const resumed=resumeTask(db,task.id,'workspace',42);await runTask(db,resumed,{evidence,model});expect(model).toHaveBeenCalledTimes(3);expect(evidence).toHaveBeenCalledTimes(2);expect(getTask(db,task.id,'workspace',42).result.completed).toBe(2);
 });
});
describe('unified details and discovery snapshots',()=>{
 const details={summary:'A useful repository',tags:['tool'],platforms:[],problem:null,features:[],scenarios:[],architecture:null,quickstart:[],deployment:null,cost:null,maintenance:null,software_forms:[],deployment_modes:[]};
 const evidence=async()=>[{repository:'owner/external',commit:'a'.repeat(40),retrievedAt:'2026-09-30T00:00:00Z',metadata:{id:77,full_name:'owner/external'},readme:'README',tree:[],files:[],limitations:[]}];
 it('retains external analysis in a durable result without adding or starring a repository',async()=>{
   const task=createTask(db,{...base,kind:'details',input:{repositories:['owner/external']}});
   await runTask(db,task,{evidence,model:async()=>JSON.stringify(details)});
   expect(getTask(db,task.id,'workspace',42)).toMatchObject({status:'completed',result:{data:{summary:details.summary},repository:{id:77,full_name:'owner/external'},repositoryWrite:{status:'snapshot'}}});
   expect(getRecord(db,'repositories','77')).toBeNull();
 });
 it('persists a repository snapshot beside the legacy batch repository name without adding or starring it',async()=>{
   const names=['owner/external','owner/second'];const task=createTask(db,{...base,kind:'details',input:{repositories:names}});
   await runTask(db,task,{evidence:async(_db,selected)=>(await evidence()).map(row=>({...row,repository:selected[0],metadata:{id:selected[0]===names[0]?77:78,full_name:selected[0]}})),model:async()=>JSON.stringify(details)});
   const completed=getTask(db,task.id,'workspace',42);expect(completed.status).toBe('completed');
   for(let index=0;index<names.length;index++) {
     const message=getRecord(db,'messages',`${task.id}:batch:${index}`);
     expect(message?.data).toMatchObject({repository:names[index],repositorySnapshot:{id:77+index,full_name:names[index]},repositoryWrite:{status:'snapshot'},data:{summary:details.summary}});
     expect(getRecord(db,'repositories',String(77+index))).toBeNull();
   }
 });
 it('updates summary and details with one model result while respecting canonical version conflicts',async()=>{
   pushOperations(db,{workspaceId:'workspace',githubUserId:42,clientId:'test',operations:[{opId:'seed-details',collection:'repositories',id:'77',baseVersion:0,kind:'put',data:{id:77,full_name:'owner/external',ai_summary:'old'}}]});
   const task=createTask(db,{...base,kind:'details',input:{repositories:['owner/external'],expectedVersions:{'77':1}}});
   const model=vi.fn(async()=>JSON.stringify(details));await runTask(db,task,{evidence,model});expect(model).toHaveBeenCalledTimes(1);
   expect(getRecord(db,'repositories','77')?.data).toMatchObject({ai_summary:details.summary,ai_details:{summary:details.summary}});
   const stale=createTask(db,{...base,requestId:'stale-details',kind:'details',input:{repositories:['owner/external'],expectedVersions:{'77':1}}});
   await runTask(db,stale,{evidence,model:async()=>JSON.stringify({...details,summary:'stale summary'})});
   expect(getTask(db,stale.id,'workspace',42).result?.repositoryWrite?.status).toBe('conflict');expect(getRecord(db,'repositories','77')?.data?.ai_summary).toBe(details.summary);
 });
});
describe('durable project task context',()=>{
 function project(patch:Record<string,unknown>={},version=0) {
   const result=pushOperations(db,{workspaceId:'workspace',githubUserId:42,clientId:'project-test',operations:[{opId:`project-${version}`,collection:'projects',id:'project',kind:'put',baseVersion:version,data:{id:'project',ownerId:'42',name:'Knowledge base',instructions:'Must support offline Chinese search',repositories:[{id:1,full_name:'owner/original'}],...patch}}]});
   expect(result.results[0].status).toBe('applied');
 }
 it('freezes goals, version and candidate names and preserves idempotency after later project edits',async()=>{
   project(); const request={...base,input:{prompt:'Which should I use?',projectId:'project'}};
   const accepted=createTask(db,request);
   project({instructions:'NEW goals',repositories:[{id:2,full_name:'owner/new'}]},1);
   const replay=createTask(db,request);
   expect(replay.id).toBe(accepted.id);
   expect(replay.configSnapshot.project).toEqual({id:'project',version:1,name:'Knowledge base',instructions:'Must support offline Chinese search',repositories:['owner/original']});
   expect(replay.input.repositories).toEqual(['owner/original']);
   const evidence=vi.fn(async()=>[]);
   const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n'));
   await runTask(db,replay,{evidence});
   expect(evidence.mock.calls[0][1]).toEqual(['owner/original']);
   const body=JSON.parse(String(fetcher.mock.calls[0][1]?.body));
   const prompt=JSON.parse(body.messages.at(-1).content);
   expect(prompt.project).toEqual(accepted.configSnapshot.project);
   expect(JSON.parse(prompt.request).requirements).toBeDefined();
   expect(JSON.stringify(body)).not.toContain('NEW goals');
   expect(getTask(db,accepted.id,'workspace',42).status).toBe('completed');
 });
 it('honors explicitly selected candidates and empty selections',()=>{
   project();
   expect(createTask(db,{...base,input:{projectId:'project',repositories:['owner/selected']}}).input.repositories).toEqual(['owner/selected']);
   expect(createTask(db,{...base,requestId:'empty',input:{projectId:'project',repositories:[]}}).input.repositories).toEqual([]);
 });
 it('rejects missing, foreign, deleted and local-only project context before creating a task',()=>{
   const request={...base,input:{projectId:'project'}};
   expect(()=>createTask(db,request)).toThrow('PROJECT_NOT_FOUND');
   project({ownerId:'99'}); expect(()=>createTask(db,request)).toThrow('PROJECT_ACCOUNT_MISMATCH');
   project({deviceOnly:true},1); expect(()=>createTask(db,request)).toThrow('PROJECT_LOCAL_SOURCES_UNSUPPORTED');
   project({containsLocalSources:true},2); expect(()=>createTask(db,request)).toThrow('PROJECT_LOCAL_SOURCES_UNSUPPORTED');
   project({deletedAt:'2026-09-30'},3); expect(()=>createTask(db,request)).toThrow('PROJECT_NOT_FOUND');
   expect(db.prepare('SELECT COUNT(*) n FROM ai_tasks').get()).toEqual({n:0});
 });
 it('rejects local or foreign session history and mismatched project references',()=>{
   project();
   for(const [id,data,error] of [['local',{deviceOnly:true},'SESSION_LOCAL_SOURCES_UNSUPPORTED'],['foreign',{ownerId:'99'},'SESSION_ACCOUNT_MISMATCH'],['other',{projectId:'other'},'SESSION_PROJECT_MISMATCH']] as const) {
     pushOperations(db,{workspaceId:'workspace',githubUserId:42,clientId:'project-test',operations:[{opId:id,collection:'sessions',id,kind:'put',baseVersion:0,data:{ownerId:'42',...data}}]});
     expect(()=>createTask(db,{...base,input:{projectId:'project',sessionId:id}})).toThrow(error);
   }
 });
 it('binds saved goals to planning and verification prompts as well as ordinary answers',()=>{
   project(); const task=createTask(db,{...base,input:{projectId:'project'}});
   for(const stage of ['planning','verification']) {
     const bound=bindTaskProjectPrompt({system:stage,user:JSON.stringify({originalRequest:'Compare'})},task.configSnapshot.project);
     expect(JSON.parse(bound.user).project.instructions).toBe('Must support offline Chinese search');
     expect(bound.system).toContain('saved project instructions');
   }
 });
 it('does not silently rebind legacy project tasks without a saved snapshot',async()=>{
   project(); const task=createTask(db,{...base,input:{projectId:'project'}});
   const configSnapshot={...task.configSnapshot}; delete configSnapshot.project;
   db.prepare('UPDATE ai_tasks SET config_snapshot=? WHERE id=?').run(JSON.stringify(configSnapshot),task.id);
   const model=vi.fn(); await runTask(db,getTask(db,task.id,'workspace',42),{model});
   expect(model).not.toHaveBeenCalled();
   expect(getTask(db,task.id,'workspace',42).error).toBe('PROJECT_CONTEXT_SNAPSHOT_REQUIRED');
 });
});
describe('DeepSeek streaming',()=>{
 it('aborts a stalled body reader without waiting for another provider frame',async()=>{
   const cancelled=vi.fn();const controller=new AbortController();
   const response=new Response(new ReadableStream({cancel:cancelled}));
   const promise=readModelStream(response,controller.signal,()=>{});
   controller.abort(new Error('DEADLINE'));
   await expect(promise).rejects.toThrow('DEADLINE');expect(cancelled).toHaveBeenCalledTimes(1);
 });
 it('keeps reasoning separate and handles split UTF8/SSE frames',async()=>{const wire='data: {"choices":[{"delta":{"reasoning_content":"thought"}}]}\n\ndata: {"choices":[{"delta":{"content":"答案"}}]}\n\ndata: [DONE]\n\n';const bytes=new TextEncoder().encode(wire);const response=new Response(new ReadableStream({start(c){for(const b of bytes)c.enqueue(new Uint8Array([b]));c.close();}}));const emit=vi.fn();expect(await readModelStream(response,new AbortController().signal,emit)).toBe('答案');expect(emit).toHaveBeenCalledWith('reasoning',{text:'thought'});});
 it('does not accept a disconnected partial answer as completed',async()=>{await expect(readModelStream(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),new AbortController().signal,()=>{})).rejects.toThrow('MODEL_STREAM_INTERRUPTED');});
});
describe('explicit proposal application',()=>{
 function seed(){pushOperations(db,{workspaceId:'workspace',githubUserId:42,clientId:'test',operations:[{opId:'repo',collection:'repositories',id:'1',kind:'put',baseVersion:0,data:{id:1,full_name:'owner/repo',custom_description:'before'}},{opId:'proposal',collection:'proposals',id:'p',kind:'put',baseVersion:0,data:{proposal:{operations:[{kind:'update',repository:'owner/repo',patch:{custom_description:'after'}}]}}}]});}
 it('requires explicit current version confirmation and updates selected safe fields',async()=>{seed();const input={workspaceId:'workspace',githubUserId:42,proposalVersion:1,confirm:true,selectedIndices:[0],expectedVersions:{'1':1}};await expect(applyTaskProposal(db,'p',{...input,confirm:false})).rejects.toThrow('EXPLICIT_VERSIONED_CONFIRMATION_REQUIRED');expect((await applyTaskProposal(db,'p',input)).results[0].status).toBe('applied');expect(getRecord(db,'repositories','1')?.data?.custom_description).toBe('after');expect((await applyTaskProposal(db,'p',{...input,proposalVersion:2})).results[0].replayed).toBe(true);});
 it('preserves repository edited after proposal review',async()=>{seed();const result=await applyTaskProposal(db,'p',{workspaceId:'workspace',githubUserId:42,proposalVersion:1,confirm:true,selectedIndices:[0],expectedVersions:{'1':0}});expect(result.results[0].status).toBe('conflict');expect(getRecord(db,'repositories','1')?.data?.custom_description).toBe('before');});
 it('rejects subscription patches that bypass the canonical subscription version',async()=>{
   seed();const proposal=getRecord(db,'proposals','p')!;
   (proposal.data!.proposal as {operations:Array<{patch?:Record<string,unknown>;index?:number}>}).operations[0].patch={subscribed_to_releases:true};
   db.prepare("UPDATE sync_v2_records SET data=? WHERE collection='proposals' AND id='p'").run(JSON.stringify(proposal.data));
   await expect(applyTaskProposal(db,'p',{workspaceId:'workspace',githubUserId:42,proposalVersion:1,confirm:true,selectedIndices:[0],expectedVersions:{'1':1}})).rejects.toThrow('UNSAFE_PROPOSAL_PATCH');
   expect(getRecord(db,'repositories','1')?.version).toBe(1);
 });
 it('uses the confirmed array index even if synced operation data supplies an index field',async()=>{
   seed();const proposal=getRecord(db,'proposals','p')!;
   (proposal.data!.proposal as {operations:Array<{patch?:Record<string,unknown>;index?:number}>}).operations[0].index=9;
   db.prepare("UPDATE sync_v2_records SET data=? WHERE collection='proposals' AND id='p'").run(JSON.stringify(proposal.data));
   const result=await applyTaskProposal(db,'p',{workspaceId:'workspace',githubUserId:42,proposalVersion:1,confirm:true,selectedIndices:[0],expectedVersions:{'1':1}});
   expect(result.results[0].index).toBe(0);expect(getRecord(db,'proposals','p')?.data?.status).toBe('applied');
 });
 it('refuses stale confirmation when a proposal changes during GitHub verification',async()=>{
   db.exec('CREATE TABLE settings(key TEXT,value TEXT)');db.prepare('INSERT INTO settings VALUES(?,?)').run('github_token',encrypt('fake-token',config.encryptionKey));
   pushOperations(db,{workspaceId:'workspace',githubUserId:42,clientId:'test',operations:[{opId:'star-proposal',collection:'proposals',id:'p',kind:'put',baseVersion:0,data:{proposal:{operations:[{kind:'star',repository:'owner/repo'}]}}}]});
   const fetcher=vi.fn(async(url:RequestInfo|URL)=>{
     if(String(url).endsWith('/user'))return new Response(JSON.stringify({id:42}));
     pushOperations(db,{workspaceId:'workspace',githubUserId:42,clientId:'test',operations:[{opId:'delete-proposal',collection:'proposals',id:'p',kind:'delete',baseVersion:1}]});
     return new Response(null,{status:404});
   }) as unknown as typeof fetch;
   await expect(applyTaskProposal(db,'p',{workspaceId:'workspace',githubUserId:42,proposalVersion:1,confirm:true,selectedIndices:[0],expectedVersions:{}},fetcher)).rejects.toThrow('PROPOSAL_VERSION_CONFLICT');
   expect(fetcher).toHaveBeenCalledTimes(2);
   expect(db.prepare('SELECT * FROM ai_proposal_effects').all()).toHaveLength(0);
 });
 it('verifies an unknown GitHub effect before retrying; does not repeat a completed mutation',async()=>{
   db.exec('CREATE TABLE settings(key TEXT,value TEXT)');db.prepare('INSERT INTO settings VALUES(?,?)').run('github_token',encrypt('fake-token',config.encryptionKey));
   pushOperations(db,{workspaceId:'workspace',githubUserId:42,clientId:'test',operations:[{opId:'star-proposal',collection:'proposals',id:'p',kind:'put',baseVersion:0,data:{proposal:{operations:[{kind:'star',repository:'owner/repo'}]}}}]});
   const input={workspaceId:'workspace',githubUserId:42,proposalVersion:1,confirm:true,selectedIndices:[0],expectedVersions:{}};
   let starred=false;let mutations=0;const fetcher=vi.fn(async(url:RequestInfo|URL,init:RequestInit)=>{
     if(String(url).endsWith('/user'))return new Response(JSON.stringify({id:42}));
     if(init.method==='PUT'){mutations++;starred=true;throw new Error('connection lost after server applied');}
     return new Response(null,{status:starred?204:404});
   }) as unknown as typeof fetch;
   expect((await applyTaskProposal(db,'p',input,fetcher)).results[0].status).toBe('unknown');
   expect((await applyTaskProposal(db,'p',{...input,proposalVersion:2},fetcher)).results[0].status).toBe('applied');expect(mutations).toBe(1);
 });
});




describe('discovery and organization task persistence',()=>{
 const evidence=[{repository:'owner/repo',commit:'a'.repeat(40),retrievedAt:'2026-09-29',metadata:{id:99},readme:'Useful tool',tree:[],files:[],limitations:[]}];
 it('saves evidenced custom editions to canonical sync state',async()=>{const task=createTask(db,{...base,kind:'custom_discovery',input:{channelId:'tools',prompt:'Useful tools',repositories:['owner/repo']}});await runTask(db,task,{evidence:async()=>evidence,model:async()=>JSON.stringify({title:'Tools',summary:'A tool',repositories:[{repository:'owner/repo',reason:'Useful'}]})});expect(getTask(db,task.id,'workspace',42).status).toBe('completed');expect(getRecord(db,'discovery_editions',String(getTask(db,task.id,'workspace',42).result?.editionId))?.data).toMatchObject({channelId:'tools',data:{title:'Tools'}});});
 it('rejects fabricated custom discovery repositories',async()=>{const task=createTask(db,{...base,kind:'custom_discovery',input:{channelId:'tools',prompt:'Useful tools',repositories:['owner/repo']}});await runTask(db,task,{evidence:async()=>evidence,model:async()=>JSON.stringify({title:'Tools',summary:'A tool',repositories:[{repository:'invented/repo',reason:'Useful'}]})});expect(getTask(db,task.id,'workspace',42).error).toBe('UNEVIDENCED_DISCOVERY_RESULT');expect(getRecord(db,'discovery_editions',task.id)).toBeNull();});
 it('persists organization as a proposal without changing repositories',async()=>{const task=createTask(db,{...base,kind:'organization',input:{repositories:['owner/repo']}});await runTask(db,task,{evidence:async()=>evidence,model:async()=>JSON.stringify({title:'Organize',rationale:'Tools',operations:[{kind:'update',repository:'owner/repo',patch:{category_id:'tools'}}]})});expect(getTask(db,task.id,'workspace',42).status).toBe('completed');expect(getRecord(db,'proposals',task.id)?.data?.status).toBe('pending');expect(getRecord(db,'repositories','99')).toBeNull();});
 it('requires versioned confirmation and respects locked repository assignments',async()=>{
  const task=createTask(db,{...base,kind:'organization',input:{repositories:['owner/repo']}});await runTask(db,task,{evidence:async()=>evidence,model:async()=>JSON.stringify({title:'Organize',rationale:'Tools',operations:[{kind:'update',repository:'owner/repo',patch:{category_id:'tools'}}],organization:{customCategories:[{id:'tools',name:'Tools'}],subcategories:[]}})});
  pushOperations(db,{workspaceId:'workspace',githubUserId:42,clientId:'test',operations:[{opId:'repo',collection:'repositories',id:'99',baseVersion:0,kind:'put',data:{id:99,full_name:'owner/repo',category_locked:true}}]});
  const input={workspaceId:'workspace',githubUserId:42,proposalVersion:1,confirm:true,selectedIndices:[0],expectedVersions:{'99':1},applyOrganization:true,organizationVersion:0};
  const applied=await applyTaskProposal(db,task.id,input);expect(applied.organizationApplied).toBe(true);expect(applied.results[0]).toMatchObject({status:'conflict',reason:'USER_LOCKED'});expect(getRecord(db,'organization','default')?.data?.customCategories).toEqual([{id:'tools',name:'Tools'}]);expect(getRecord(db,'repositories','99')?.data?.category_id).toBeUndefined();
 });
 it('can apply a category-only proposal with an empty repository selection',async()=>{pushOperations(db,{workspaceId:'workspace',githubUserId:42,clientId:'test',operations:[{opId:'proposal',collection:'proposals',id:'categories',baseVersion:0,kind:'put',data:{proposal:{operations:[],organization:{customCategories:[{id:'tools',name:'Tools'}],subcategories:[]}}}}]});const result=await applyTaskProposal(db,'categories',{workspaceId:'workspace',githubUserId:42,proposalVersion:1,confirm:true,selectedIndices:[],expectedVersions:{},applyOrganization:true,organizationVersion:0});expect(result.organizationApplied).toBe(true);});
});


describe('custom channel semantic compilation checkpoint',()=>{
 it('compiles pending instructions once and resumes search without another compilation',async()=>{
  const plan={version:1,required:[],excluded:[],preferred:[],branches:[{terms:['tools'],readme:false}],filters:{language:null,minStars:null,maxStars:null,createdWithinDays:null},filterSources:{language:null,minStars:null,maxStars:null,createdWithinDays:null},conflicts:[]};
  db.exec('CREATE TABLE settings(key TEXT,value TEXT)');db.prepare('INSERT INTO settings VALUES(?,?)').run('github_token',encrypt('test-key',config.encryptionKey));
  pushOperations(db,{workspaceId:'workspace',githubUserId:42,clientId:'test',operations:[{opId:'channel',collection:'discovery_subscriptions',id:'custom:tools',baseVersion:0,kind:'put',data:{id:'custom:tools',name:'Tools',instruction:'tools',revision:1,planSource:'pending',enabled:true,paused:false,plan,limit:10,cursors:[],blocked:[],read:[],recommended:{}}}]});
  const model=vi.fn().mockResolvedValueOnce(JSON.stringify(plan)).mockResolvedValueOnce(JSON.stringify({title:'Tools',summary:'No new matches',repositories:[]}));
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify({id:42}))).mockRejectedValueOnce(new Error('network interruption'));
  const task=createTask(db,{...base,kind:'custom_discovery',input:{channelId:'custom:tools',prompt:'tools',date:'2026-09-30'}});await runTask(db,task,{model});expect(model).toHaveBeenCalledTimes(1);expect(getRecord(db,'discovery_subscriptions','custom:tools')?.data?.planSource).toBe('compiled');
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({id:42}))).mockResolvedValueOnce(new Response(JSON.stringify({items:[],incomplete_results:false})));
  await runTask(db,resumeTask(db,task.id,'workspace',42),{model});expect(model).toHaveBeenCalledTimes(2);expect(getTask(db,task.id,'workspace',42)).toMatchObject({status:'completed',error:null});expect(getRecord(db,'discovery_editions','custom:tools:2026-09-30:1')?.data).toMatchObject({entries:[],pending:[],complete:true});
 });
});
