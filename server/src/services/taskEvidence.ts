import type Database from 'better-sqlite3';
import { config } from '../config.js';
import { decrypt } from './crypto.js';
import type { TaskEvidence } from './taskModel.js';
import { selectAnalysisContext } from '../core/analysisContext.js';

interface GithubFile {encoding:string;size:number;content:string;path:string}
interface GithubRepository {id:number;default_branch:string;description:string|null;language:string|null;topics:string[];license?:{spdx_id:string};created_at:string;pushed_at:string;stargazers_count:number;archived:boolean}
interface GithubTree {tree?:Array<{type:string;path:string}>;truncated?:boolean}
export async function githubTaskRequest<T>(db:Database.Database,path:string,signal:AbortSignal):Promise<T> {
  const row=db.prepare('SELECT value FROM settings WHERE key=?').get('github_token') as {value:string}|undefined;if(!row?.value)throw new Error('GITHUB_CREDENTIAL_REQUIRED');
  const response=await fetch(`https://api.github.com${path}`,{headers:{Authorization:`Bearer ${decrypt(row.value,config.encryptionKey)}`,Accept:'application/vnd.github+json'},signal,redirect:'error'});
  if(!response.ok)throw new Error(`GITHUB_HTTP_${response.status}`);const body=await response.text();if(body.length>4_000_000)throw new Error('GITHUB_RESPONSE_TOO_LARGE');return JSON.parse(body);
}
export async function searchTaskRepositories(db:Database.Database,query:string,githubUserId:number,signal:AbortSignal):Promise<string[]> {
  const account=await githubTaskRequest<{id:number}>(db,'/user',signal);if(account.id!==githubUserId)throw new Error('GITHUB_ACCOUNT_MISMATCH');
  const response=await githubTaskRequest<{items?:Array<{full_name:string}>}>(db,`/search/repositories?q=${encodeURIComponent(query.slice(0,300))}&sort=stars&per_page=4`,signal);
  return (response.items || []).map(r=>String(r.full_name)).filter((name:string)=>/^[\w.-]+\/[\w.-]+$/.test(name)).slice(0,4);
}
export async function readTaskEvidenceFiles(db:Database.Database,evidence:TaskEvidence[],requests:Array<{repository:string;path:string}>,signal:AbortSignal):Promise<number> {
  let read=0;
  for(const request of requests.slice(0,4)) {
    signal.throwIfAborted();const source=evidence.find(e=>e.repository===request.repository);
    if(!source || !source.tree.includes(request.path) || source.files.some(f=>f.path===request.path) || request.path===source.readmePath || /(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i.test(request.path))continue;
    const file=await githubTaskRequest<GithubFile>(db,`/repos/${source.repository}/contents/${request.path.split('/').map(encodeURIComponent).join('/')}?ref=${source.commit}`,signal);
    if(file.encoding==='base64'&&file.size<=100000){const content=Buffer.from(file.content,'base64').toString('utf8');if(!content.includes('\0')){source.files.push({path:request.path,content:content.slice(0,10000)});read++;}}
  }
  return read;
}

export async function collectTaskEvidence(db: Database.Database, names: string[], githubUserId: number, signal:AbortSignal): Promise<TaskEvidence[]> {
  const row=db.prepare('SELECT value FROM settings WHERE key=?').get('github_token') as {value:string}|undefined;
  if(!row?.value) throw new Error('GITHUB_CREDENTIAL_REQUIRED');
  const token=decrypt(row.value,config.encryptionKey);
  async function get<T>(path:string,optional?:false):Promise<T>;
  async function get<T>(path:string,optional:true):Promise<T|null>;
  async function get<T>(path:string,optional=false):Promise<T|null> {
    const response=await fetch(`https://api.github.com${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},signal,redirect:'error'});
    if(optional && response.status===404) return null;
    if(!response.ok) throw new Error(`GITHUB_HTTP_${response.status}`);
    const value=await response.text(); if(value.length>4_000_000) throw new Error('GITHUB_RESPONSE_TOO_LARGE'); return JSON.parse(value);
  }
  const user=await get<{id:number}>('/user'); if(user.id!==githubUserId) throw new Error('GITHUB_ACCOUNT_MISMATCH');
  const evidence:TaskEvidence[]=[];
  for(const name of names) {
    signal.throwIfAborted();
    const metadata=await get<GithubRepository>(`/repos/${name}`);
    const head=await get<{sha:string}>(`/repos/${name}/commits/${encodeURIComponent(metadata.default_branch)}`);
    const commit=String(head.sha); if(!/^[a-f0-9]{40}$/.test(commit)) throw new Error('INVALID_COMMIT');
    const readme=await get<GithubFile>(`/repos/${name}/readme?ref=${commit}`,true);
    const tree=await get<GithubTree>(`/repos/${name}/git/trees/${commit}?recursive=1`);
    const paths=(tree.tree || []).filter(entry=>entry.type==='blob').map(entry=>String(entry.path)).slice(0,400);
    const sourcePaths=paths.filter((p:string)=>/^(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|src\/(index|main|app)\.[a-z]+|README[^/]*|docs\/[^/]+\.md)$/i.test(p)).filter((p:string)=>!/^README/i.test(p)).slice(0,4);
    const files:Array<{path:string;content:string}>=[];
    for(const path of sourcePaths) {
      const file=await get<GithubFile>(`/repos/${name}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${commit}`,true);
      if(file?.encoding==='base64' && file.size<=100_000) files.push({path,content:Buffer.from(file.content,'base64').toString('utf8').slice(0,8000)});
    }
    evidence.push({repository:name,commit,retrievedAt:new Date().toISOString(),metadata:{id:metadata.id,full_name:name,description:metadata.description,language:metadata.language,topics:metadata.topics,license:metadata.license?.spdx_id,created_at:metadata.created_at,pushed_at:metadata.pushed_at,stargazers_count:metadata.stargazers_count,archived:metadata.archived},readmePath:readme?.path || 'README.md',readme:readme?.encoding==='base64'?selectAnalysisContext(Buffer.from(readme.content,'base64').toString('utf8'),24000):'',tree:paths,files,limitations:['Bounded inspection: at most 400 tree paths and four source files; no code executed',...(tree.truncated?['GitHub tree response truncated']:[])]});
  }
  return evidence;
}

