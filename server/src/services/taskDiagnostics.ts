import type Database from 'better-sqlite3';
type DB=Database.Database;
export const REQUEST_PREVIEW_BYTES=1024*1024;
export const ACCOUNT_DIAGNOSTIC_BYTES=256*1024*1024;
const bodyTypes=new Set(['content','reasoning','provider_request','provider_result']);
export interface TaskDiagnostics {cumulative:true;providerRequests:number;contentBytes:number;reasoningBytes:number;storedBytes:number;droppedEvents:number;truncated:boolean}
export function initializeTaskDiagnostics(db:DB):void {
 db.exec(`CREATE TABLE IF NOT EXISTS ai_task_diagnostics(task_id TEXT PRIMARY KEY,provider_requests INTEGER NOT NULL DEFAULT 0,content_bytes INTEGER NOT NULL DEFAULT 0,reasoning_bytes INTEGER NOT NULL DEFAULT 0,stored_bytes INTEGER NOT NULL DEFAULT 0,nonbody_events INTEGER NOT NULL DEFAULT 0,dropped_events INTEGER NOT NULL DEFAULT 0,truncated INTEGER NOT NULL DEFAULT 0);
 INSERT OR IGNORE INTO ai_task_diagnostics(task_id,stored_bytes,nonbody_events) SELECT task_id,SUM(length(CAST(data AS BLOB))),SUM(type NOT IN ('content','reasoning','provider_request','provider_result')) FROM ai_task_events GROUP BY task_id;`);
 const columns=db.prepare('PRAGMA table_info(ai_task_diagnostics)').all() as Array<{name:string}>;
 if(!columns.some(c=>c.name==='gap_seq'))db.exec('ALTER TABLE ai_task_diagnostics ADD COLUMN gap_seq INTEGER NOT NULL DEFAULT 0');
}
export function taskDiagnostics(db:DB,id:string):TaskDiagnostics {
 const row=db.prepare('SELECT * FROM ai_task_diagnostics WHERE task_id=?').get(id) as Record<string,number>|undefined;
 return {cumulative:true,providerRequests:row?.provider_requests??0,contentBytes:row?.content_bytes??0,reasoningBytes:row?.reasoning_bytes??0,storedBytes:row?.stored_bytes??0,droppedEvents:row?.dropped_events??0,truncated:!!row?.truncated};
}
export function utf8Preview(text:string,limit=REQUEST_PREVIEW_BYTES):string {
 const bytes=Buffer.from(text);if(bytes.length<=limit)return text;
 let end=limit;while(end>0&&(bytes[end]&0xc0)===0x80)end--;return bytes.subarray(0,end).toString('utf8');
}
/** Diagnostics may be dropped; task checkpoints and validated results never are. */
export function appendTaskDiagnostic(db:DB,id:string,type:string,data:unknown):void {
 const task=db.prepare('SELECT request_id,stage,phase,workspace_id,github_user_id,checkpoint,input FROM ai_tasks WHERE id=?').get(id) as {request_id:string;stage:string;phase:string;workspace_id:string;github_user_id:number;checkpoint:string|null;input:string}|undefined;
 if(!task)return;
 db.prepare('INSERT OR IGNORE INTO ai_task_diagnostics(task_id) VALUES(?)').run(id);
 const input=data&&typeof data==='object'?data as Record<string,unknown>:{value:data};
 let batch:{completed:unknown[];current?:{repository:string}}|undefined;
 try{batch=task.checkpoint?JSON.parse(task.checkpoint)?.batch:undefined;}catch{/* A corrupt recovery checkpoint must not prevent its diagnostic state event. */}
 const output={...input,taskId:id,requestId:task.request_id,phase:task.phase,stage:task.stage,...(!input.batch&&batch?.current?{batch:{index:batch.completed.length,total:JSON.parse(task.input).repositories?.length??0,repository:batch.current.repository}}:{})} as Record<string,unknown>;
 if(type==='provider_request'&&typeof output.body==='string'){
  const bytes=Buffer.byteLength(output.body);output.body=utf8Preview(output.body);output.bodyBytes=bytes;output.previewBytes=Buffer.byteLength(output.body as string);if(bytes>REQUEST_PREVIEW_BYTES)output.truncated=true;
 }
 // Count the provider stream once, independently of raw-result snapshots.
 db.prepare('UPDATE ai_task_diagnostics SET provider_requests=provider_requests+?,content_bytes=content_bytes+?,reasoning_bytes=reasoning_bytes+?,truncated=MAX(truncated,?) WHERE task_id=?').run(type==='provider_request'?1:0,type==='content'&&typeof input.text==='string'?Buffer.byteLength(input.text):0,type==='reasoning'&&typeof input.text==='string'?Buffer.byteLength(input.text):0,output.truncated?1:0,id);
 const counts=db.prepare('SELECT nonbody_events,truncated FROM ai_task_diagnostics WHERE task_id=?').get(id) as {nonbody_events:number;truncated:number};
 const accountBytes=(db.prepare('SELECT COALESCE(SUM(d.stored_bytes),0) n FROM ai_task_diagnostics d JOIN ai_tasks t ON t.id=d.task_id WHERE t.github_user_id=?').get(task.github_user_id) as {n:number}).n;
 const metrics=taskDiagnostics(db,id);output.metrics={providerRequests:metrics.providerRequests,contentBytes:metrics.contentBytes,reasoningBytes:metrics.reasoningBytes,droppedEvents:metrics.droppedEvents,truncated:metrics.truncated};
 const serialized=JSON.stringify(output),bytes=Buffer.byteLength(serialized),body=bodyTypes.has(type);
 const reason=!body&&counts.nonbody_events>=4999?'NONBODY_EVENT_LIMIT':accountBytes+bytes>ACCOUNT_DIAGNOSTIC_BYTES-2048?'ACCOUNT_DIAGNOSTIC_LIMIT':null;
 if(reason){
  db.prepare('UPDATE ai_task_diagnostics SET dropped_events=dropped_events+1,truncated=1 WHERE task_id=?').run(id);
  // Reserve one bounded marker; subsequent loss remains visible in cumulative diagnostics.
  if(!db.prepare("SELECT 1 FROM ai_task_events WHERE task_id=? AND type='diagnostic_truncated'").get(id)){
   const marker=JSON.stringify({taskId:id,requestId:task.request_id,phase:task.phase,reason,gap:true,cumulative:true});
   if(accountBytes+Buffer.byteLength(marker)<=ACCOUNT_DIAGNOSTIC_BYTES&&counts.nonbody_events<5000){
    db.prepare('INSERT INTO ai_task_events(task_id,type,data,created_at) VALUES(?,?,?,?)').run(id,'diagnostic_truncated',marker,new Date().toISOString());
    db.prepare('UPDATE ai_task_diagnostics SET stored_bytes=stored_bytes+?,nonbody_events=nonbody_events+1 WHERE task_id=?').run(Buffer.byteLength(marker),id);
   }
  }
  // Advance the existing SSE cursor even when no payload can be retained.
  // This lets the consumer receive a durable task snapshot after later saves.
  db.prepare("UPDATE sqlite_sequence SET seq=seq+1 WHERE name='ai_task_events'").run();
  db.prepare("UPDATE ai_task_diagnostics SET gap_seq=(SELECT seq FROM sqlite_sequence WHERE name='ai_task_events') WHERE task_id=?").run(id);
  return;
 }
 db.prepare('INSERT INTO ai_task_events(task_id,type,data,created_at) VALUES(?,?,?,?)').run(id,type,serialized,new Date().toISOString());
 db.prepare('UPDATE ai_task_diagnostics SET stored_bytes=stored_bytes+?,nonbody_events=nonbody_events+? WHERE task_id=?').run(bytes,body?0:1,id);
}
