import { searchCustomDiscovery, discoveryCompilePrompt, mergeChannelEdition, type DiscoverySearch } from './customDiscovery.js';
import { assessResults, effectiveRules, rankAssessments, parsePlan, type ChannelDailyEdition, type CandidateAssessment } from '../core/customDiscovery.js';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { config } from '../config.js';
import { decrypt } from './crypto.js';
import { assertWorkspace, getRecord, pushOperations, type Operation } from './syncV2.js';
import { collectTaskEvidence,searchTaskRepositories } from './taskEvidence.js';
import { researchTask,taskEvidenceRecords, type ResearchCheckpoint } from './taskResearch.js';
import { initializeTaskProposals } from './taskProposals.js';
import { taskKinds, taskPrompt, validateTaskResult, readModelStream, type TaskKind, type TaskEvidence } from './taskModel.js';
import { snapshotTaskProject, bindTaskProjectPrompt, hasLocalTaskSources, type TaskProjectSnapshot } from './taskProject.js';
import { initializeStarsRefresh, refreshStars, type StarsCheckpoint } from './taskRefreshStars.js';

export interface TaskInput {prompt?:string;repositories?:string[];sessionId?:string;userMessageId?:string;projectId?:string;language?:string;expectedVersions?:Record<string,number>;channelId?:string;date?:string}
export interface CreateTask {requestId:string;workspaceId:string;githubUserId:number;configId?:string;kind:TaskKind;input:TaskInput}
interface ConfigSnapshot {model:string;baseUrl:string;configId:string;reasoningEffort:string|null;project?:TaskProjectSnapshot}
interface TaskOutput extends Record<string,unknown> {content?:string;repositoryWrite?:RepositoryWrite}
type RepositoryWrite=ReturnType<typeof pushOperations>['results'][number] | {status:'proposal'|'snapshot';reason:string};
interface ValidatedCheckpoint {evidence?:TaskEvidence[];validated?:boolean;content?:string;value?:Record<string,unknown>}
interface BatchItem extends ValidatedCheckpoint {repository:string;evidence:TaskEvidence[]}
interface BatchCheckpoint {completed:Array<{repository:string;repositoryId:string;messageId:string;status:string}>;current:BatchItem|null}
interface TaskCheckpoint extends ValidatedCheckpoint {compiledPlan?:unknown;discovery?:DiscoverySearch;research?:ResearchCheckpoint;batch?:BatchCheckpoint;stars?:StarsCheckpoint}
interface TaskRow {id:string;workspace_id:string;github_user_id:number;request_id:string;request_hash:string;kind:TaskKind;config_id:string;config_snapshot:string;input:string;status:string;stage:string;checkpoint:string|null;result:string|null;error:string|null;created_at:string;updated_at:string}
export interface TaskRecord extends CreateTask {id:string;status:string;stage:string;configSnapshot:ConfigSnapshot;result:TaskOutput|null;error:string|null;createdAt:string;updatedAt:string;lastSeq:number;checkpoint:TaskCheckpoint|null}
export function publicTask(task:TaskRecord):Omit<TaskRecord,'checkpoint'> {const output:Partial<TaskRecord>={...task};delete output.checkpoint;return output as Omit<TaskRecord,'checkpoint'>;}
type DB=Database.Database;
const controllers=new Map<string,AbortController>();
const activePromises=new Set<Promise<void>>();
let runner:ReturnType<typeof setInterval>|undefined;
let running=false, interactiveStreak=0;
const now=()=>new Date().toISOString();
const inputSchema=z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),channelId:z.string().min(1).max(150).optional(),prompt:z.string().max(16000).optional(),repositories:z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/)).max(100).optional(),sessionId:z.string().min(1).max(150).optional(),userMessageId:z.string().min(1).max(200).optional(),projectId:z.string().min(1).max(150).optional(),language:z.string().max(40).optional(),expectedVersions:z.record(z.string(),z.number().int().min(0)).optional()}).strict();
function stableJson(value:unknown):string {if(Array.isArray(value))return `[${value.map(stableJson).join(',')}]`;if(value&&typeof value==='object')return `{${Object.keys(value).sort().filter(k=>(value as Record<string,unknown>)[k]!==undefined).map(k=>`${JSON.stringify(k)}:${stableJson((value as Record<string,unknown>)[k])}`).join(',')}}`;return JSON.stringify(value);}
function taskRequestHash(request:CreateTask):string {return createHash('sha256').update(stableJson({requestId:request.requestId,workspaceId:request.workspaceId,githubUserId:request.githubUserId,configId:request.configId,kind:request.kind,input:request.input})).digest('hex');}
interface RequestRejection {github_user_id:number;request_hash:string;error_code:string}
function assertRequestNotRejected(db:DB,request:CreateTask,hash:string):void {
  const rejected=db.prepare('SELECT github_user_id,request_hash,error_code FROM ai_task_request_rejections WHERE workspace_id=? AND request_id=?').get(request.workspaceId,request.requestId) as RequestRejection|undefined;
  if(rejected)throw new Error(rejected.github_user_id===request.githubUserId&&rejected.request_hash===hash?rejected.error_code:'REQUEST_ID_CONFLICT');
}
/** A definitive rejection prevents a delayed original POST from accepting work later. */
export function recordTaskCreationRejection(db:DB,request:CreateTask,code:string):boolean {
  assertWorkspace(db,request.workspaceId,request.githubUserId);
  if(!isTaskRequestId(request.requestId))return false;
  const hash=taskRequestHash(request);
  return db.transaction(()=>{
    if(db.prepare('SELECT id FROM ai_tasks WHERE workspace_id=? AND request_id=?').get(request.workspaceId,request.requestId))return false;
    const rejected=db.prepare('SELECT github_user_id,request_hash,error_code FROM ai_task_request_rejections WHERE workspace_id=? AND request_id=?').get(request.workspaceId,request.requestId) as RequestRejection|undefined;
    if(rejected)return rejected.github_user_id===request.githubUserId&&rejected.request_hash===hash&&rejected.error_code===code;
    db.prepare('INSERT INTO ai_task_request_rejections(workspace_id,github_user_id,request_id,request_hash,error_code,created_at) VALUES(?,?,?,?,?,?)').run(request.workspaceId,request.githubUserId,request.requestId,hash,code,now());
    return true;
  }).immediate();
}
export function initializeTasks(db:DB):void {
  initializeTaskProposals(db);
  initializeStarsRefresh(db);
  db.exec(`CREATE TABLE IF NOT EXISTS ai_tasks (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,github_user_id INTEGER NOT NULL,request_id TEXT NOT NULL,request_hash TEXT NOT NULL,kind TEXT NOT NULL,config_id TEXT NOT NULL,config_snapshot TEXT NOT NULL,input TEXT NOT NULL,status TEXT NOT NULL,stage TEXT NOT NULL,checkpoint TEXT,result TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(workspace_id,request_id)); CREATE TABLE IF NOT EXISTS ai_task_events (seq INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,type TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS ai_task_events_task ON ai_task_events(task_id,seq); CREATE TABLE IF NOT EXISTS ai_task_event_watermarks (task_id TEXT PRIMARY KEY,pruned_seq INTEGER NOT NULL);`);
  db.exec('CREATE TABLE IF NOT EXISTS ai_task_request_rejections(workspace_id TEXT NOT NULL,github_user_id INTEGER NOT NULL,request_id TEXT NOT NULL,request_hash TEXT NOT NULL,error_code TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(workspace_id,request_id))');
  pruneTaskEvents(db);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ai_tasks_active_stars ON ai_tasks(workspace_id) WHERE kind='refresh_stars' AND status IN ('queued','running')");
  for(const row of db.prepare("SELECT id,kind,stage,checkpoint FROM ai_tasks WHERE status='running'").all() as {id:string;kind:TaskKind;stage:string;checkpoint:string|null}[]) {
    let checkpoint:TaskCheckpoint|null=null;
    try { checkpoint=row.checkpoint?JSON.parse(row.checkpoint):null; } catch { /* Unknown checkpoint state must require explicit recovery. */ }
    const validated=(value:ValidatedCheckpoint|null|undefined)=>value?.validated===true && typeof value.content==='string' && value.value!==undefined && Array.isArray(value.evidence);
    // Stage is persisted before the corresponding work begins. Reads can be
    // repeated; validated outputs and committed batch items need no repeat call.
    const safe=row.kind==='refresh_stars' || ['queued','evidence','search'].includes(row.stage)
      || (['model','saving'].includes(row.stage) && (validated(checkpoint) || validated(checkpoint?.batch?.current)))
      || (row.stage==='saving' && checkpoint?.batch?.current===null && Array.isArray(checkpoint.batch.completed) && checkpoint.batch.completed.length>0);
    db.transaction(()=>{
      db.prepare('UPDATE ai_tasks SET status=?,error=?,updated_at=? WHERE id=?').run(safe?'queued':'interrupted',safe?null:'SERVER_RESTART_UNKNOWN_CALL',now(),row.id);
      taskEvent(db,row.id,'state',{status:safe?'queued':'interrupted',stage:row.stage,reason:safe?'Server restarted; safe checkpoint automatically requeued.':'Server restarted; explicit resume required. The previous provider call may have been charged.'});
    })();
  }
}
export function taskEvent(db:DB,id:string,type:string,data:unknown):void {db.prepare('INSERT INTO ai_task_events(task_id,type,data,created_at) VALUES(?,?,?,?)').run(id,type,JSON.stringify(data),now());}
function shape(db:DB,raw:unknown):TaskRecord {const row=raw as TaskRow;return {id:row.id,workspaceId:row.workspace_id,githubUserId:row.github_user_id,requestId:row.request_id,configId:row.config_id,kind:row.kind,input:JSON.parse(row.input),status:row.status,stage:row.stage,configSnapshot:JSON.parse(row.config_snapshot),checkpoint:row.checkpoint?JSON.parse(row.checkpoint):null,result:row.result?JSON.parse(row.result):null,error:row.error,createdAt:row.created_at,updatedAt:row.updated_at,lastSeq:(db.prepare('SELECT MAX(COALESCE((SELECT MAX(seq) FROM ai_task_events WHERE task_id=?),0),COALESCE((SELECT pruned_seq FROM ai_task_event_watermarks WHERE task_id=?),0)) seq').get(row.id,row.id) as {seq:number}).seq};}
export function getTask(db:DB,id:string,workspaceId:string,githubUserId:number):TaskRecord {
  assertWorkspace(db,workspaceId,githubUserId); const row=db.prepare('SELECT * FROM ai_tasks WHERE id=? AND workspace_id=? AND github_user_id=?').get(id,workspaceId,githubUserId);
  if(!row) throw new Error('TASK_NOT_FOUND'); return shape(db,row);
}
export function isTaskRequestId(value:unknown):value is string {return typeof value==='string'&&value.length>0&&value.length<=150;}
export function getTaskByRequest(db:DB,requestId:string,workspaceId:string,githubUserId:number):TaskRecord {
  assertWorkspace(db,workspaceId,githubUserId);
  if(!isTaskRequestId(requestId))throw new Error('INVALID_TASK');
  const row=db.prepare('SELECT * FROM ai_tasks WHERE request_id=? AND workspace_id=? AND github_user_id=?').get(requestId,workspaceId,githubUserId);
  if(!row)throw new Error('TASK_REQUEST_NOT_FOUND');
  return shape(db,row);
}
export function listTasks(db:DB,workspaceId:string,githubUserId:number):TaskRecord[] {assertWorkspace(db,workspaceId,githubUserId);return db.prepare('SELECT * FROM ai_tasks WHERE workspace_id=? AND github_user_id=? ORDER BY created_at DESC LIMIT 100').all(workspaceId,githubUserId).map(r=>shape(db,r));}
/** Expire terminal task streams after 30 days; durable task results remain intact. */
export function pruneTaskEvents(db:DB, at=new Date()):number {
  const cutoff=new Date(at.getTime()-30*24*60*60*1000).toISOString();
  return db.transaction(()=>{
    db.prepare(`INSERT INTO ai_task_event_watermarks(task_id,pruned_seq)
      SELECT e.task_id,MAX(e.seq) FROM ai_task_events e JOIN ai_tasks t ON t.id=e.task_id
      WHERE t.status IN ('completed','cancelled','failed') AND t.updated_at<? AND e.created_at<? GROUP BY e.task_id
      ON CONFLICT(task_id) DO UPDATE SET pruned_seq=MAX(pruned_seq,excluded.pruned_seq)`).run(cutoff,cutoff);
    return db.prepare('DELETE FROM ai_task_events WHERE seq <= (SELECT pruned_seq FROM ai_task_event_watermarks WHERE task_id=ai_task_events.task_id)').run().changes;
  })();
}
export function taskEvents(db:DB,id:string,after:number) {
  const watermark=db.prepare('SELECT pruned_seq FROM ai_task_event_watermarks WHERE task_id=?').get(id) as {pruned_seq:number}|undefined;
  if(watermark && after<watermark.pruned_seq) {
    const row=db.prepare('SELECT * FROM ai_tasks WHERE id=?').get(id);
    if(!row)throw new Error('TASK_NOT_FOUND');
    const task=publicTask(shape(db,row));
    return [{seq:task.lastSeq,type:'resync',data:{reason:'EVENT_CURSOR_EXPIRED',task},createdAt:now()}];
  }
  return (db.prepare('SELECT * FROM ai_task_events WHERE task_id=? AND seq>? ORDER BY seq LIMIT 1000').all(id,after) as {seq:number;type:string;data:string;created_at:string}[]).map(r=>({seq:r.seq,type:r.type,data:JSON.parse(r.data),createdAt:r.created_at}));
}
export function createTask(db:DB,request:CreateTask):TaskRecord {
  assertWorkspace(db,request.workspaceId,request.githubUserId);
  if(!isTaskRequestId(request.requestId))throw new Error('INVALID_TASK');
  const hash=taskRequestHash(request);
  assertRequestNotRejected(db,request,hash);
  if(!taskKinds.includes(request.kind) || !inputSchema.safeParse(request.input).success || JSON.stringify(request.input).length>30000) throw new Error('INVALID_TASK');
  const existing=db.prepare('SELECT * FROM ai_tasks WHERE workspace_id=? AND request_id=?').get(request.workspaceId,request.requestId) as TaskRow|undefined;
  if(existing){if(existing.github_user_id!==request.githubUserId||existing.request_hash!==hash)throw new Error('REQUEST_ID_CONFLICT'); return shape(db,existing);}
  if(request.kind==='refresh_stars') {
    if(Object.keys(request.input).length)throw new Error('INVALID_TASK');
    const id=randomUUID(),date=now();
    db.transaction(()=>{
      assertRequestNotRejected(db,request,hash);
      if(db.prepare("SELECT id FROM ai_tasks WHERE workspace_id=? AND kind='refresh_stars' AND status IN ('queued','running')").get(request.workspaceId))throw new Error('REFRESH_STARS_TASK_ACTIVE');
      db.prepare('INSERT INTO ai_tasks(id,workspace_id,github_user_id,request_id,request_hash,kind,config_id,config_snapshot,input,status,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,request.workspaceId,request.githubUserId,request.requestId,hash,request.kind,'',JSON.stringify({model:'',baseUrl:'',configId:'',reasoningEffort:null}),'{}','queued','queued',date,date);
      taskEvent(db,id,'state',{status:'queued',stage:'queued'});
    }).immediate();
    return getTask(db,id,request.workspaceId,request.githubUserId);
  }
  const project=request.input.projectId?snapshotTaskProject(db,request.input.projectId,request.githubUserId):undefined;
  const input:TaskInput={...request.input,...(project&&request.input.repositories===undefined?{repositories:project.repositories}:{})};
  const names=input.repositories || [];
  if(!Array.isArray(names)||names.length>100||new Set(names).size!==names.length||names.some(n=>typeof n!=='string'||!/^[\w.-]+\/[\w.-]+$/.test(n))) throw new Error('INVALID_REPOSITORIES');
  if(['summary','details','classification'].includes(request.kind)&&!names.length) throw new Error('REPOSITORY_EVIDENCE_REQUIRED');
  if(!['summary','details','classification','organization'].includes(request.kind)&&names.length>4)throw new Error('RESEARCH_REPOSITORY_LIMIT');
  if(request.kind==='compare'&&names.length<2) throw new Error('REPOSITORY_EVIDENCE_REQUIRED');
  if(request.kind==='research'&&!names.length&&!request.input.prompt?.trim())throw new Error('RESEARCH_QUERY_REQUIRED');
  if(request.kind==='custom_discovery'&&(!request.input.channelId||!request.input.prompt?.trim()))throw new Error('DISCOVERY_CHANNEL_QUERY_REQUIRED');
  if(request.kind==='organization'&&!names.length)throw new Error('REPOSITORY_EVIDENCE_REQUIRED');
  if(request.input.sessionId) {
    const session=getRecord(db,'sessions',request.input.sessionId);
    if(session&&!session.deleted&&session.data) {
      if(session.data.ownerId!==undefined&&String(session.data.ownerId)!==String(request.githubUserId))throw new Error('SESSION_ACCOUNT_MISMATCH');
      if(hasLocalTaskSources(session.data))throw new Error('SESSION_LOCAL_SOURCES_UNSUPPORTED');
      if(session.data.projectId!==undefined&&session.data.projectId!==null&&session.data.projectId!==request.input.projectId)throw new Error('SESSION_PROJECT_MISMATCH');
    }
  }
  if(request.input.userMessageId) {
    const message=getRecord(db,'messages',request.input.userMessageId);const session=request.input.sessionId?getRecord(db,'sessions',request.input.sessionId):null;
    if(!session||session.deleted||(session.data?.ownerId!==undefined&&String(session.data.ownerId)!==String(request.githubUserId))||!message||message.deleted||message.data?.role!=='user'||message.data?.sessionId!==request.input.sessionId||message.data?.content!==request.input.prompt)throw new Error('USER_MESSAGE_MISMATCH');
  }
  if(!request.configId)throw new Error('AI_CONFIG_REQUIRED');
  const cfg=db.prepare('SELECT * FROM ai_configs WHERE id=?').get(request.configId) as {id:string;api_key_encrypted:string;base_url:string;model:string;reasoning_effort:string|null}|undefined;
  if(!cfg?.api_key_encrypted) throw new Error('AI_CONFIG_REQUIRED');
  try {if(!decrypt(cfg.api_key_encrypted,config.encryptionKey).trim())throw new Error();}catch{throw new Error('AI_CONFIG_DECRYPT_FAILED');}
  const endpoint=new URL(cfg.base_url || 'https://api.deepseek.com');
  if(endpoint.protocol!=='https:'||endpoint.hostname!=='api.deepseek.com')throw new Error('DEEPSEEK_ENDPOINT_REQUIRED');
  if(typeof cfg.model!=='string'||!cfg.model.trim()||cfg.model.length>150)throw new Error('DEEPSEEK_MODEL_REQUIRED');
  const snapshot:ConfigSnapshot={model:cfg.model,baseUrl:endpoint.origin,configId:String(cfg.id),reasoningEffort:cfg.reasoning_effort || null,...(project?{project}:{})};
  const id=randomUUID(); const date=now();
  if(request.input.sessionId && db.prepare("SELECT id FROM ai_tasks WHERE workspace_id=? AND json_extract(input,'$.sessionId')=? AND status IN ('queued','running')").get(request.workspaceId,request.input.sessionId))throw new Error('SESSION_TASK_ACTIVE');
  db.transaction(()=>{assertRequestNotRejected(db,request,hash);db.prepare('INSERT INTO ai_tasks(id,workspace_id,github_user_id,request_id,request_hash,kind,config_id,config_snapshot,input,status,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,request.workspaceId,request.githubUserId,request.requestId,hash,request.kind,request.configId,JSON.stringify(snapshot),JSON.stringify(input),'queued','queued',date,date);taskEvent(db,id,'state',{status:'queued',stage:'queued'});}).immediate();
  return getTask(db,id,request.workspaceId,request.githubUserId);
}
export function cancelTask(db:DB,id:string,workspaceId:string,githubUserId:number):TaskRecord {
  const task=getTask(db,id,workspaceId,githubUserId);if(['completed','cancelled'].includes(task.status))return task;
  db.transaction(()=>{db.prepare("UPDATE ai_tasks SET status='cancelled',updated_at=? WHERE id=?").run(now(),id);taskEvent(db,id,'state',{status:'cancelled'});})(); controllers.get(id)?.abort();return getTask(db,id,workspaceId,githubUserId);
}
export function resumeTask(db:DB,id:string,workspaceId:string,githubUserId:number):TaskRecord {
  const task=getTask(db,id,workspaceId,githubUserId);if(!['interrupted','failed','cancelled'].includes(task.status))throw new Error('TASK_NOT_RESUMABLE');
  if(controllers.has(id))throw new Error('TASK_STILL_STOPPING');
  if(task.kind==='refresh_stars' && db.prepare("SELECT id FROM ai_tasks WHERE id<>? AND workspace_id=? AND kind='refresh_stars' AND status IN ('queued','running')").get(id,workspaceId))throw new Error('REFRESH_STARS_TASK_ACTIVE');
  if(task.input.sessionId && db.prepare("SELECT id FROM ai_tasks WHERE id<>? AND workspace_id=? AND json_extract(input,'$.sessionId')=? AND status IN ('queued','running')").get(id,workspaceId,task.input.sessionId))throw new Error('SESSION_TASK_ACTIVE');
  db.transaction(()=>{db.prepare("UPDATE ai_tasks SET status='queued',error=NULL,updated_at=? WHERE id=?").run(now(),id);taskEvent(db,id,'state',{status:'queued',stage:'resume',warning:task.stage==='model'?'Explicit resume starts a new provider call; previous call outcome was unknown':null});})();return getTask(db,id,workspaceId,githubUserId);
}
export interface TaskDependencies {githubFetch?:typeof fetch;evidence?:typeof collectTaskEvidence;model?:(task:TaskRecord,evidence:TaskEvidence[],signal:AbortSignal,emit:(type:string,data:unknown)=>void)=>Promise<string>}
async function modelCall(db:DB,task:TaskRecord,evidence:TaskEvidence[],signal:AbortSignal,emit:(type:string,data:unknown)=>void,promptOverride?:{system:string;user:string}) {
  const cfg=db.prepare('SELECT api_key_encrypted FROM ai_configs WHERE id=?').get(task.configId ?? '') as {api_key_encrypted:string}|undefined;
  if(!cfg)throw new Error('AI_CONFIG_REMOVED'); const key=decrypt(cfg.api_key_encrypted,config.encryptionKey);
  const prompt=promptOverride || taskPrompt(task.kind,task.input,evidence);
  if(task.kind==='custom_discovery'&&task.checkpoint?.discovery)prompt.user=JSON.stringify({request:JSON.parse(prompt.user),channel:task.checkpoint.discovery.channel,rules:effectiveRules(task.checkpoint.discovery.channel.plan,task.checkpoint.discovery.channel.ruleOverrides)});
  if(task.kind==='organization')prompt.user=JSON.stringify({request:JSON.parse(prompt.user),currentOrganization:getRecord(db,'organization','default')?.data??{},repositories:(task.input.repositories??[]).map(name=>{const record=(db.prepare("SELECT data FROM sync_v2_records WHERE collection='repositories' AND deleted=0 AND json_extract(data,'$.full_name')=?").get(name) as {data:string}|undefined);return record?JSON.parse(record.data):{full_name:name};})});
  const boundPrompt=bindTaskProjectPrompt(prompt,task.configSnapshot.project);
  const history=task.input.sessionId?(db.prepare("SELECT data FROM sync_v2_records WHERE collection='messages' AND deleted=0 AND id<>? AND json_extract(data,'$.sessionId')=? ORDER BY seq DESC LIMIT 12").all(task.input.userMessageId || '',task.input.sessionId) as {data:string}[]).reverse().map(r=>JSON.parse(r.data)).filter(r=>['user','assistant'].includes(r.role)&&typeof r.content==='string').map(r=>({role:r.role,content:r.content.slice(0,8000)})):[];
  const response=await fetch(`${task.configSnapshot.baseUrl}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:task.configSnapshot.model,stream:true,max_tokens:6000,messages:[{role:'system',content:boundPrompt.system},...history,{role:'user',content:boundPrompt.user}]}),signal,redirect:'error'});
  return readModelStream(response,signal,emit);
}
export async function runTask(db:DB,task:TaskRecord,deps:TaskDependencies={}):Promise<void> {
  if(controllers.has(task.id))return;
  const controller=new AbortController();controllers.set(task.id,controller);const signal=controller.signal;
  const deadline=setTimeout(()=>controller.abort(),Math.min(3600000,Math.max(240000,(task.input.repositories?.length || 1)*180000)));
  const emit=(type:string,data:unknown)=>{signal.throwIfAborted();if(type!=='reasoning')taskEvent(db,task.id,type,data);};
  const stage=(value:string)=>{signal.throwIfAborted();db.prepare('UPDATE ai_tasks SET stage=?,updated_at=? WHERE id=?').run(value,now(),task.id);emit('state',{status:'running',stage:value});};
  try {
    assertWorkspace(db,task.workspaceId,task.githubUserId);
    const claim=db.prepare("UPDATE ai_tasks SET status='running' WHERE id=? AND status='queued'").run(task.id);if(!claim.changes)return;
    if(task.input.projectId&&!task.configSnapshot.project)throw new Error('PROJECT_CONTEXT_SNAPSHOT_REQUIRED');
    const checkpoint=(value:unknown)=>{signal.throwIfAborted();db.prepare('UPDATE ai_tasks SET checkpoint=? WHERE id=?').run(JSON.stringify(value),task.id);};
    if(task.kind==='refresh_stars') {
      await refreshStars(db,task,signal,{fetch:deps.githubFetch,state:task.checkpoint?.stars,stage,checkpoint:stars=>checkpoint({stars}),progress:data=>emit('progress',data),finish:result=>{
        db.prepare("UPDATE ai_tasks SET status='completed',stage='completed',result=?,error=NULL,updated_at=? WHERE id=?").run(JSON.stringify(result),now(),task.id);
        taskEvent(db,task.id,'result',result);taskEvent(db,task.id,'state',{status:'completed',stage:'completed'});
      }});
      return;
    }
    if(['summary','details','classification'].includes(task.kind)&&(task.input.repositories?.length || 0)>1){await runTaskBatch(db,task,deps,signal,emit,stage,checkpoint);return;}
    if(task.kind==='custom_discovery'){
      const channelRecord=getRecord(db,'discovery_subscriptions',task.input.channelId!);
      if(channelRecord&&!channelRecord.deleted&&channelRecord.data?.planSource==='pending'){
        if(channelRecord.data.enabled===false||channelRecord.data.paused===true)throw new Error('DISCOVERY_CHANNEL_PAUSED');
        stage('compiling');const instruction=String(channelRecord.data.instruction??task.input.prompt??'');
        const raw=await(deps.model?deps.model(task,[],signal,emit):modelCall(db,task,[],signal,()=>{},{system:discoveryCompilePrompt,user:instruction.slice(0,4000)}));signal.throwIfAborted();
        const plan=parsePlan(raw,instruction);if(plan.conflicts.length)throw new Error('DISCOVERY_PLAN_CONFLICTS');
        db.transaction(()=>{const saved=pushOperations(db,{workspaceId:task.workspaceId,githubUserId:task.githubUserId,clientId:'backend-task-runner',operations:[{opId:`task:${task.id}:compile`,collection:'discovery_subscriptions',id:channelRecord.id,baseVersion:channelRecord.version,kind:'put',source:'ai',data:{...channelRecord.data,plan,planSource:'compiled'}}]});if(saved.results[0].status!=='applied')throw new Error('DISCOVERY_CHANNEL_CHANGED');checkpoint({compiledPlan:plan});stage('evidence');})();
      }
    }
    let discovery=task.checkpoint?.discovery;
    let evidence=task.checkpoint?.evidence as TaskEvidence[]|undefined;
    if(!evidence){stage('evidence');let names=task.input.repositories || [];
      if(task.kind==='custom_discovery'){stage('search');discovery=discovery??await searchCustomDiscovery(db,task.input.channelId!,task.githubUserId,signal)??undefined;if(discovery)names=discovery.names;}
      if(['research','custom_discovery'].includes(task.kind)&&!names.length&&!discovery){stage('search');names=await searchTaskRepositories(db,task.input.prompt!,task.githubUserId,signal);if(!names.length)throw new Error('NO_RESEARCH_CANDIDATES');emit('candidates',{repositories:names});}
      evidence=names.length?await(deps.evidence||collectTaskEvidence)(db,names,task.githubUserId,signal):[];signal.throwIfAborted();checkpoint({evidence,discovery});emit('evidence',{sources:evidence.map(e=>({repository:e.repository,commit:e.commit,files:e.files.map(f=>f.path),limitations:e.limitations}))});}
    if(discovery)task.checkpoint={...task.checkpoint,discovery};
    let content:string;let value:Record<string,unknown>;
    if(task.checkpoint?.validated){content=task.checkpoint.content!;value=task.checkpoint.value!;}
    else {stage('model');
      if(['research','compare'].includes(task.kind)&&!deps.model){
        const researched=await researchTask(db,task.id,task.input.prompt || task.kind,evidence,signal,async(prompt,researchStage)=>{stage(researchStage);return modelCall(db,task,evidence!,signal,()=>{},prompt);},async()=>{stage('drafting');return modelCall(db,task,evidence!,signal,()=>{});},research=>checkpoint({evidence,research}),task.checkpoint?.research);
        content=researched.content;value={content,quality:'model-reviewed',...(researched.review as Record<string,unknown>)};emit('content',{text:content});
      }else{content=await(deps.model ? deps.model(task,evidence,signal,emit):modelCall(db,task,evidence,signal,emit));value=validateTaskResult(task.kind,content,evidence);}
      signal.throwIfAborted();if(task.kind==='details')value={...(value as Record<string,unknown>),model:task.configSnapshot.model};checkpoint({evidence,discovery,validated:true,content,value});}
    stage('saving');
    const result:TaskOutput={...(['summary','details','classification'].includes(task.kind)&&evidence[0]?{repository:{...evidence[0].metadata,full_name:evidence[0].repository}}:{}),content:typeof value.content==='string'?value.content:content,data:value,evidence:evidence.map(e=>({repository:e.repository,commit:e.commit,retrievedAt:e.retrievedAt})),...(['proposal','organization'].includes(task.kind)?{proposal:value}:{})};
    db.transaction(()=>{
      assertWorkspace(db,task.workspaceId,task.githubUserId);
      const collection=['proposal','organization'].includes(task.kind)?'proposals':task.kind==='custom_discovery'?'discovery_editions':'messages';
      const id=task.id;
      const evidenceRecords=taskEvidenceRecords(task.id,evidence);
      const sessionId=task.input.sessionId || task.id;
      const operations:Operation[]=[{opId:`task:${task.id}:result`,collection,id,baseVersion:0,kind:'put',source:'ai',data:{...result,id,taskId:task.id,sessionId,projectId:task.input.projectId || null,...(task.kind==='custom_discovery'?{channelId:task.input.channelId,editionId:task.id}:{}),role:'assistant',evidenceIds:evidenceRecords.map(e=>e.id),status:['proposal','organization'].includes(task.kind)?'pending':'complete',createdAt:now()}}];
      if(task.kind==='custom_discovery'){
        const date=task.input.date??task.createdAt.slice(0,10);const channel=discovery?.channel;const editionId=`${task.input.channelId}:${date}:${channel?.revision??1}`;operations[0].id=editionId;operations[0].baseVersion=getRecord(db,'discovery_editions',editionId)?.version??0;Object.assign(operations[0].data!,{id:editionId,editionId});result.editionId=editionId;const selected=(value.repositories??[]) as Array<{repository:string;reason:string;findings?:unknown[];relevance?:number}>;
        const rules=channel?effectiveRules(channel.plan,channel.ruleOverrides):null;
        const candidates=evidence.map(source=>({repo:{...source.metadata,...discovery?.repositories.find(r=>r.full_name===source.repository),full_name:source.repository} as never,text:[source.readme,...source.files.map(f=>f.content)].join('\n')}));
        const assessments=rules?assessResults(selected.map(item=>({id:Number(evidence.find(e=>e.repository===item.repository)?.metadata.id),reason:item.reason,relevance:item.relevance??1,findings:item.findings??[]})),candidates,rules.plan):selected.map(item=>({repo:candidates.find(c=>(c.repo as {full_name:string}).full_name===item.repository)!.repo,reason:item.reason,verdict:'match',evidence:[],method:'ai',relevance:1,preference:0}));
        const ranked=(rules?rankAssessments(assessments as never,rules.sort):assessments).map(item=>({...item,relation:discovery?.relations?.[String((item.repo as {id:number}).id)]??'direct'})) as CandidateAssessment[];
        const edition:ChannelDailyEdition={channelId:task.input.channelId!,date,revision:channel?.revision??1,instruction:channel?.instruction??task.input.prompt??'',entries:ranked.filter(item=>item.verdict==='match').slice(0,channel?.limit??10),pending:ranked.filter(item=>item.verdict==='unknown'),errors:[],complete:true,searched:discovery?.searched??1,filtered:discovery?.filtered??0,generatedAt:now(),...(rules?{ruleSnapshot:rules}:{})};
        const previous=getRecord(db,'discovery_editions',editionId);
        const rejected=candidates.filter(candidate=>!ranked.some(item=>item.repo.id===(candidate.repo as {id:number}).id)).map(candidate=>(candidate.repo as {id:number}).id);
        const merged=channel?mergeChannelEdition(channel,edition,previous&&!previous.deleted?previous.data as unknown as ChannelDailyEdition:undefined,rejected):{edition,recommended:{}};
        value.repositories=merged.edition.entries.map(item=>({repository:item.repo.full_name,reason:item.reason}));
        Object.assign(operations[0].data!,JSON.parse(JSON.stringify(merged.edition)));
        if(channel&&discovery){const current=getRecord(db,'discovery_subscriptions',channel.id);if(current?.version!==discovery.channelVersion)throw new Error('DISCOVERY_CHANNEL_CHANGED');operations.push({opId:`task:${task.id}:channel`,collection:'discovery_subscriptions',id:channel.id,baseVersion:discovery.channelVersion,kind:'put',source:'ai',data:{...channel,cursors:discovery.cursors,lastCompletedDate:date,lastRefresh:now(),recommended:merged.recommended}});}
      }
      operations.push(...evidenceRecords.map(e=>({opId:`task:${e.id}:evidence`,collection:'evidence' as const,id:e.id,baseVersion:0,kind:'put' as const,source:'ai' as const,data:e})));
      if(!task.input.userMessageId)operations.push({opId:`task:${task.id}:user`,collection:'messages',id:`${task.id}:user`,baseVersion:0,kind:'put',source:'user',data:{id:`${task.id}:user`,sessionId,role:'user',content:task.input.prompt || task.kind,status:'complete',evidenceIds:[],createdAt:task.createdAt}});
      if(!getRecord(db,'sessions',sessionId))operations.push({opId:`task:${task.id}:session`,collection:'sessions',id:sessionId,baseVersion:0,kind:'put',source:'user',data:{id:sessionId,repoId:evidence[0]?.metadata.id || 0,repoFullName:evidence[0]?.repository || '',sourceRefSha:evidence[0]?.commit || '',title:(task.input.prompt||task.kind).slice(0,100),ownerId:String(task.githubUserId),kind:task.input.projectId?'workbench':'repository',...(task.input.projectId?{projectId:task.input.projectId}:{}),createdAt:task.createdAt,updatedAt:now()}});
      const saved=pushOperations(db,{workspaceId:task.workspaceId,githubUserId:task.githubUserId,clientId:'backend-task-runner',operations});
      if(saved.results.some(r=>r.status==='conflict'))throw new Error('RESULT_SYNC_CONFLICT');
      if(['summary','details','classification'].includes(task.kind)&&evidence[0]) {
        const repoId=String(evidence[0].metadata.id);const current=getRecord(db,'repositories',repoId);
        if(current && task.input.expectedVersions?.[repoId]!==undefined) {
          const patch=task.kind==='details'?{ai_details:value,...(typeof value.summary==='string'&&value.summary.trim()?{ai_summary:value.summary}: {})}:task.kind==='classification'?{ai_tags:(value as Record<string,unknown>).tags,ai_category:(value as Record<string,unknown>).category}:{ai_summary:(value as Record<string,unknown>).summary,ai_tags:(value as Record<string,unknown>).tags,ai_platforms:(value as Record<string,unknown>).platforms};
          const update=pushOperations(db,{workspaceId:task.workspaceId,githubUserId:task.githubUserId,clientId:'backend-task-runner',operations:[{opId:`task:${task.id}:repository`,collection:'repositories',id:repoId,baseVersion:task.input.expectedVersions[repoId],kind:'put',source:'ai',data:{...current.data,...patch,analyzed_at:now()}}]});
          result.repositoryWrite=update.results[0];
        } else result.repositoryWrite=current?{status:'proposal',reason:'Expected repository version required to apply AI fields'}:{status:'snapshot',reason:'Discovery analysis retained in task result; repository was not added or starred'};
      }
      db.prepare("UPDATE ai_tasks SET status='completed',stage='completed',result=?,error=NULL,updated_at=? WHERE id=?").run(JSON.stringify(result),now(),task.id);taskEvent(db,task.id,'result',result);taskEvent(db,task.id,'state',{status:'completed',stage:'completed'});
    })();
  } catch(error) {
    const current=db.prepare('SELECT status FROM ai_tasks WHERE id=?').get(task.id) as {status:string}|undefined;
    if(current?.status!=='cancelled') {const reason=error instanceof Error && /^[A-Z][A-Z_0-9]+$/.test(error.message)?error.message:(signal.aborted?'TASK_DEADLINE_OR_SHUTDOWN':'TASK_EXECUTION_FAILED');db.prepare("UPDATE ai_tasks SET status='interrupted',error=?,updated_at=? WHERE id=?").run(reason,now(),task.id);taskEvent(db,task.id,'state',{status:'interrupted',error:reason});}
  } finally {clearTimeout(deadline);controllers.delete(task.id);}
}
async function runTaskBatch(db:DB,task:TaskRecord,deps:TaskDependencies,signal:AbortSignal,emit:(type:string,data:unknown)=>void,stage:(stage:string)=>void,checkpoint:(value:unknown)=>void) {
  const state:BatchCheckpoint=task.checkpoint?.batch || {completed:[],current:null};
  const names=task.input.repositories!;
  for(let index=state.completed.length;index<names.length;index++) {
    signal.throwIfAborted();assertWorkspace(db,task.workspaceId,task.githubUserId);
    stage('evidence');emit('progress',{completed:index,total:names.length,repository:names[index]});
    const evidence:TaskEvidence[]=state.current?.repository===names[index]?state.current.evidence:await(deps.evidence || collectTaskEvidence)(db,[names[index]],task.githubUserId,signal);
    state.current={...(state.current?.repository===names[index]?state.current:{}),repository:names[index],evidence};checkpoint({batch:state});
    let value:Record<string,unknown>=state.current.value!;let content:string=state.current.content!;
    if(!state.current.validated){stage('model');const itemTask={...task,input:{...task.input,repositories:[names[index]]}};content=await(deps.model?deps.model(itemTask,evidence,signal,emit):modelCall(db,itemTask,evidence,signal,emit));signal.throwIfAborted();value=validateTaskResult(task.kind,content,evidence);if(task.kind==='details')value={...value,model:task.configSnapshot.model};state.current={...state.current,validated:true,content,value};checkpoint({batch:state});}
    stage('saving');
    db.transaction(()=>{
      assertWorkspace(db,task.workspaceId,task.githubUserId);
      const repoId=String(evidence[0].metadata.id),current=getRecord(db,'repositories',repoId),id=`${task.id}:batch:${index}`;
      const records=taskEvidenceRecords(id,evidence);let write:RepositoryWrite=current?{status:'proposal',reason:'Expected repository version required'}:{status:'snapshot',reason:'Discovery analysis retained in task message; repository was not added or starred'};
      if(current&&task.input.expectedVersions?.[repoId]!==undefined) {
        const patch=task.kind==='details'?{ai_details:value,...(typeof value.summary==='string'&&value.summary.trim()?{ai_summary:value.summary}: {})}:task.kind==='classification'?{ai_tags:value.tags,ai_category:value.category}:{ai_summary:value.summary,ai_tags:value.tags,ai_platforms:value.platforms};
        write=pushOperations(db,{workspaceId:task.workspaceId,githubUserId:task.githubUserId,clientId:'backend-task-runner',operations:[{opId:`${id}:repository`,collection:'repositories',id:repoId,baseVersion:task.input.expectedVersions[repoId],kind:'put',source:'ai',data:{...current.data,...patch,analyzed_at:now()}}]}).results[0];
      }
      const saved=pushOperations(db,{workspaceId:task.workspaceId,githubUserId:task.githubUserId,clientId:'backend-task-runner',operations:[{opId:`${id}:message`,collection:'messages',id,baseVersion:0,kind:'put',source:'ai',data:{id,sessionId:task.input.sessionId || task.id,role:'assistant',status:'complete',evidenceIds:records.map(r=>r.id),content,data:value,repository:names[index],repositorySnapshot:{...evidence[0].metadata,full_name:names[index]},repositoryWrite:write,createdAt:now()}},...records.map(r=>({opId:`${r.id}:evidence`,collection:'evidence' as const,id:r.id,baseVersion:0,kind:'put' as const,source:'ai' as const,data:r}))]});
      if(saved.results.some(r=>r.status==='conflict'))throw new Error('RESULT_SYNC_CONFLICT');
      const sessionId=task.input.sessionId || task.id;
      if(!getRecord(db,'sessions',sessionId))pushOperations(db,{workspaceId:task.workspaceId,githubUserId:task.githubUserId,clientId:'backend-task-runner',operations:[{opId:`${task.id}:batch-session`,collection:'sessions',id:sessionId,baseVersion:0,kind:'put',source:'user',data:{id:sessionId,repoId:0,repoFullName:'',sourceRefSha:'',title:`${task.kind}: ${names.length} repositories`,ownerId:String(task.githubUserId),kind:'workbench',createdAt:task.createdAt,updatedAt:now()}}]});
      state.completed.push({repository:names[index],repositoryId:repoId,messageId:id,status:write.status});state.current=null;checkpoint({batch:state});taskEvent(db,task.id,'progress',{completed:index+1,total:names.length,repository:names[index],repositoryWrite:write.status});
    })();
  }
  const result={content:state.completed.map(r=>`${r.repository}: ${r.status}`).join('\n'),batch:state.completed,completed:state.completed.length,total:names.length};
  db.transaction(()=>{db.prepare("UPDATE ai_tasks SET status='completed',stage='completed',result=?,error=NULL,updated_at=? WHERE id=?").run(JSON.stringify(result),now(),task.id);taskEvent(db,task.id,'result',result);taskEvent(db,task.id,'state',{status:'completed',stage:'completed'});})();
}
export function startTaskRunner(db:DB,deps:TaskDependencies={}):void {
  if(runner)return;running=true;
  let lastPruned=0;
  const tick=()=>{
    if(!running)return;
    if(Date.now()-lastPruned>=60*60*1000){pruneTaskEvents(db);lastPruned=Date.now();}
    while(controllers.size<2){
      const preferInteractive=interactiveStreak<3;
      const row=db.prepare(`SELECT * FROM ai_tasks WHERE status='queued' ORDER BY CASE WHEN kind IN ('chat','requirements') THEN ${preferInteractive?0:1} ELSE ${preferInteractive?1:0} END,created_at LIMIT 1`).get();
      if(!row)break;const task=shape(db,row);interactiveStreak=['chat','requirements'].includes(task.kind)?interactiveStreak+1:0;
      const promise=runTask(db,task,deps);activePromises.add(promise);void promise.finally(()=>activePromises.delete(promise));
    }
  }; runner=setInterval(tick,250);runner.unref();tick();
}
export async function stopTaskRunner():Promise<void> {running=false;if(runner)clearInterval(runner);runner=undefined;for(const controller of controllers.values())controller.abort();await Promise.allSettled([...activePromises]);}

