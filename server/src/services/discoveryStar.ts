import {createHash} from 'node:crypto';
import type Database from 'better-sqlite3';
import {config} from '../config.js';
import {decrypt} from './crypto.js';
import {assertWorkspace,getRecord,pushOperations,SyncError} from './syncV2.js';
const active=new Set<string>();
export async function changeDiscoveryStar(db:Database.Database,input:{workspaceId:string;githubUserId:number;requestId:string;repository:string;starred:boolean;confirm:boolean},fetcher:typeof fetch=fetch){
 assertWorkspace(db,input.workspaceId,input.githubUserId);
 if(input.confirm!==true||typeof input.starred!=='boolean'||typeof input.requestId!=='string'||!/^[\w:-]{1,150}$/.test(input.requestId)||!/^([\w-]+)\/([\w.-]+)$/.test(input.repository)||input.repository.split('/').some(p=>p==='.'||p==='..'))throw new SyncError('EXPLICIT_STAR_CONFIRMATION_REQUIRED');
 db.exec('CREATE TABLE IF NOT EXISTS discovery_star_effects(workspace_id TEXT NOT NULL,request_id TEXT NOT NULL,digest TEXT NOT NULL,status TEXT NOT NULL,result TEXT,PRIMARY KEY(workspace_id,request_id))');
 const digest=createHash('sha256').update(JSON.stringify({repository:input.repository,starred:input.starred})).digest('hex');
 const previous=db.prepare('SELECT * FROM discovery_star_effects WHERE workspace_id=? AND request_id=?').get(input.workspaceId,input.requestId) as {digest:string;status:string;result:string}|undefined;
 if(previous&&previous.digest!==digest)throw new SyncError('REQUEST_ID_CONFLICT',409);
 if(previous?.status==='applied')return {...JSON.parse(previous.result),replayed:true};
 const key=`${input.workspaceId}:${input.requestId}`;if(active.has(key))throw new SyncError('STAR_REQUEST_ACTIVE',409);active.add(key);
 try{
  const row=db.prepare("SELECT value FROM settings WHERE key='github_token'").get() as {value:string}|undefined;if(!row)throw new SyncError('BACKEND_GITHUB_CREDENTIAL_REQUIRED',409);
  const token=decrypt(row.value,config.encryptionKey);
  const github=(path:string,method='GET')=>fetcher(`https://api.github.com${path}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(20000)});
  // Verify account again immediately before any external effect, independent of route caching.
  const account=await github('/user');if(!account.ok||(await account.json() as {id:number}).id!==input.githubUserId)throw new SyncError('BACKEND_ACCOUNT_MISMATCH',403);
  let observed=await github(`/user/starred/${input.repository}`);if(![204,404].includes(observed.status))throw new SyncError('STAR_VERIFICATION_UNAVAILABLE',502);
  const repoResponse=await github(`/repos/${input.repository}`);if(!repoResponse.ok)throw new SyncError('DISCOVERY_REPOSITORY_UNAVAILABLE',502);const repository=await repoResponse.json() as Record<string,unknown>;if(!Number.isSafeInteger(repository.id)||Number(repository.id)<=0)throw new SyncError('DISCOVERY_INVALID_RESPONSE',502);
  const current=getRecord(db,'repositories',String(repository.id));
  db.prepare("INSERT INTO discovery_star_effects VALUES(?,?,?,'unknown',NULL) ON CONFLICT(workspace_id,request_id) DO NOTHING").run(input.workspaceId,input.requestId,digest);
  if((observed.status===204)!==input.starred){const changed=await github(`/user/starred/${input.repository}`,input.starred?'PUT':'DELETE');if(changed.status!==204)throw new SyncError('STAR_OUTCOME_UNKNOWN',502);observed=await github(`/user/starred/${input.repository}`);}
  if(![204,404].includes(observed.status)||(observed.status===204)!==input.starred)throw new SyncError('STAR_OUTCOME_UNKNOWN',502);
  assertWorkspace(db,input.workspaceId,input.githubUserId);
  return db.transaction(()=>{const sync=pushOperations(db,{workspaceId:input.workspaceId,githubUserId:input.githubUserId,clientId:'discovery-star',operations:[{opId:input.requestId,collection:'repositories',id:String(repository.id),baseVersion:current?.version??0,kind:input.starred?'put':'delete',source:'user',...(input.starred?{data:{...repository,...current?.data,starred_at:current?.data?.starred_at??new Date().toISOString()}}:{})}]});const result={applied:true,starred:input.starred,repository:input.repository,syncStatus:sync.results[0].status};db.prepare("UPDATE discovery_star_effects SET status='applied',result=? WHERE workspace_id=? AND request_id=?").run(JSON.stringify(result),input.workspaceId,input.requestId);return result;})();
 }catch(error){if(error instanceof SyncError)throw error;throw new SyncError('STAR_OUTCOME_UNKNOWN',502);}finally{active.delete(key);}
}
