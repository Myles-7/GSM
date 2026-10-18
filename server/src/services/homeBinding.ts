import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { decrypt } from './crypto.js';
import { getWorkspace, setWorkspaceBinding, SyncError } from './syncV2.js';

export interface GithubIdentity { id: number; login: string }
const cache = new WeakMap<Database.Database, { hash: string; expiresAt: number; identity: GithubIdentity }>();
const inFlight = new WeakMap<Database.Database, Promise<void>>();
const fingerprint = (db: Database.Database) => {
  const row=db.prepare("SELECT value FROM settings WHERE key='github_token'").get() as {value:string}|undefined;
  if(!row?.value)throw new SyncError('BACKEND_GITHUB_CREDENTIAL_REQUIRED',409);
  let token:string;try{token=decrypt(row.value,config.encryptionKey);}catch{throw new SyncError('BACKEND_GITHUB_CREDENTIAL_INVALID',409);}
  return {token,hash:createHash('sha256').update(token).digest('hex')};
};
export async function verifyServerGithubAccount(db:Database.Database,force=false):Promise<GithubIdentity> {
  const {token,hash}=fingerprint(db),saved=cache.get(db);
  if(!force&&saved?.hash===hash&&saved.expiresAt>Date.now())return saved.identity;
  const response=await fetch('https://api.github.com/user',{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw new SyncError('BACKEND_GITHUB_VERIFICATION_FAILED',502);
  const user=await response.json() as GithubIdentity;
  if(!Number.isSafeInteger(user.id)||user.id<1||typeof user.login!=='string')throw new SyncError('BACKEND_GITHUB_VERIFICATION_FAILED',502);
  const identity={id:user.id,login:user.login};cache.set(db,{hash,identity,expiresAt:Date.now()+300000});return identity;
}
export function recordVerifiedBinding(db:Database.Database,identity:GithubIdentity):void {
  const workspace=getWorkspace(db);if(!workspace)return;
  const {hash}=fingerprint(db);
  db.transaction(()=>{
    setWorkspaceBinding(db,workspace.id,identity.id===workspace.githubUserId?'verified':'blocked');
    db.prepare('UPDATE sync_v2_binding SET credential_hash=?,login=?,audit_error=NULL,next_audit_at=? WHERE workspace_id=?')
      .run(hash,identity.login,new Date(Date.now()+86400000).toISOString(),workspace.id);
  })();
}
export function bindingStatus(db:Database.Database) {
  const workspace=getWorkspace(db);if(!workspace)return null;
  return db.prepare('SELECT status,checked_at AS checkedAt,audit_error AS error,next_audit_at AS retryAt,login FROM sync_v2_binding WHERE workspace_id=?').get(workspace.id) as {status:string;checkedAt?:string;error?:string;retryAt?:string;login?:string}|undefined;
}
/** Network failure keeps the last binding usable. Only an authenticated account
 * mismatch blocks replication; a stale audit may never overwrite a rotation. */
export function auditWorkspaceBinding(db:Database.Database,verify:()=>Promise<GithubIdentity>=()=>verifyServerGithubAccount(db,true),force=false):Promise<void> {
  if(inFlight.has(db))return inFlight.get(db)!;
  const workspace=getWorkspace(db);if(!workspace)return Promise.resolve();
  const state=bindingStatus(db);
  if(!force&&state?.retryAt&&Date.parse(state.retryAt)>Date.now())return Promise.resolve();
  const run=(async()=>{
    let before:string|undefined;
    try {
      before=fingerprint(db).hash;const identity=await verify();
      if(fingerprint(db).hash!==before||getWorkspace(db)?.id!==workspace.id)return;
      recordVerifiedBinding(db,identity);
    } catch(error) {
      if(before){try{if(fingerprint(db).hash!==before)return;}catch{/* expose credential error */}}
      const code=error instanceof SyncError?error.code:'GITHUB_AUDIT_UNAVAILABLE';
      db.prepare("INSERT INTO sync_v2_binding(workspace_id,status,audit_error,next_audit_at) VALUES(?,'verified',?,?) ON CONFLICT(workspace_id) DO UPDATE SET audit_error=excluded.audit_error,next_audit_at=excluded.next_audit_at")
        .run(workspace.id,code,new Date(Date.now()+15*60000).toISOString());
    }
  })().finally(()=>inFlight.delete(db));inFlight.set(db,run);return run;
}
export function startWorkspaceBindingAudit(db:Database.Database) {
  let stopped=false;
  const tick=()=>{if(!stopped)void auditWorkspaceBinding(db).catch(()=>{});};
  const timer=setInterval(tick,60000);timer.unref();tick();
  return async()=>{stopped=true;clearInterval(timer);await inFlight.get(db);};
}
