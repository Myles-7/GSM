import type Database from 'better-sqlite3';
import { config } from '../config.js';
import { createHash } from 'node:crypto';
import { decrypt } from './crypto.js';
import { assertWorkspace, getRecord, pushOperations, validateOperation } from './syncV2.js';

export interface ProposalApplyInput {workspaceId:string;githubUserId:number;proposalVersion:number;confirm:boolean;selectedIndices:number[];expectedVersions:Record<string,number>;applyOrganization?:boolean;organizationVersion?:number}
interface ProposalOperation {kind:string;repository:string;patch?:Record<string,unknown>}
interface ProposalResult extends Record<string,unknown> {index:number;status:string;replayed?:boolean}
const busy=new Set<string>();
// Subscription state has its own versioned collection; a repository patch must
// not claim to update it while leaving the canonical subscription unchanged.
const allowedFields=new Set(['custom_description','custom_tags','custom_category','category_locked','category_id','subcategory_id','category_candidates']);
export function initializeTaskProposals(db:Database.Database) {
  db.exec('CREATE TABLE IF NOT EXISTS ai_proposal_effects (proposal_id TEXT NOT NULL,proposal_version INTEGER NOT NULL,operation_index INTEGER NOT NULL,kind TEXT NOT NULL,repository TEXT NOT NULL,status TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(proposal_id,proposal_version,operation_index))');
}
/** GitHub PUT/DELETE effects are idempotent; ambiguous attempts must be checked before retry. */
export async function applyTaskProposal(db:Database.Database,id:string,input:ProposalApplyInput,fetcher:typeof fetch=fetch) {
  assertWorkspace(db,input.workspaceId,input.githubUserId);
  if(input.confirm!==true||!Number.isSafeInteger(input.proposalVersion)||!Array.isArray(input.selectedIndices)||(!input.selectedIndices.length&&!input.applyOrganization)||new Set(input.selectedIndices).size!==input.selectedIndices.length)throw new Error('EXPLICIT_VERSIONED_CONFIRMATION_REQUIRED');
  const proposal=getRecord(db,'proposals',id);if(!proposal||proposal.deleted||proposal.version!==input.proposalVersion)throw new Error('PROPOSAL_VERSION_CONFLICT');
  if(busy.has(id))throw new Error('PROPOSAL_APPLY_ACTIVE');
  const operations=(proposal.data?.proposal as {operations?:ProposalOperation[]}|undefined)?.operations || (proposal.data?.data as {operations?:ProposalOperation[]}|undefined)?.operations || proposal.data?.operations;
  if(!Array.isArray(operations)||input.selectedIndices.some(i=>!Number.isInteger(i)||i<0||i>=operations.length))throw new Error('INVALID_PROPOSAL_SELECTION');
  const proposedOrganization=(proposal.data?.proposal as {organization?:Record<string,unknown>}|undefined)?.organization;
  if(input.applyOrganization){if(!proposedOrganization||!Number.isSafeInteger(input.organizationVersion))throw new Error('ORGANIZATION_VERSION_REQUIRED');validateOperation({opId:'organization-review',collection:'organization',id:'default',baseVersion:input.organizationVersion!,kind:'put',data:proposedOrganization});if((getRecord(db,'organization','default')?.version??0)!==input.organizationVersion)throw new Error('ORGANIZATION_VERSION_CONFLICT');}
  const selected=input.selectedIndices.map(i=>({...(operations[i] as ProposalOperation),index:i}));
  for(const op of selected){if(!['star','unstar','update'].includes(op.kind)||!/^[\w.-]+\/[\w.-]+$/.test(op.repository))throw new Error('INVALID_PROPOSAL_OPERATION');if(op.kind==='update'&&(!op.patch||typeof op.patch!=='object'||Array.isArray(op.patch)||Object.keys(op.patch).some(k=>!allowedFields.has(k))))throw new Error('UNSAFE_PROPOSAL_PATCH');}
  busy.add(id);
  const results:ProposalResult[]=[];let organizationApplied=false;
  try {
    let token='';
    async function github(path:string,method='GET') {
      const response=await fetcher(`https://api.github.com${path}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000),redirect:'error'});return response;
    }
    if(selected.some(op=>op.kind!=='update')) {
      const credential=db.prepare('SELECT value FROM settings WHERE key=?').get('github_token') as {value:string}|undefined;if(!credential)throw new Error('GITHUB_CREDENTIAL_REQUIRED');token=decrypt(credential.value,config.encryptionKey);
      const response=await github('/user');if(!response.ok||(await response.json() as {id:number}).id!==input.githubUserId)throw new Error('GITHUB_ACCOUNT_MISMATCH');
    }
    if(input.applyOrganization){const applied=pushOperations(db,{workspaceId:input.workspaceId,githubUserId:input.githubUserId,clientId:'proposal-apply',operations:[{opId:`${id}:${input.proposalVersion}:organization`,collection:'organization',id:'default',baseVersion:input.organizationVersion!,kind:'put',source:'user',data:proposedOrganization!}]}).results[0];organizationApplied=applied.status==='applied';if(!organizationApplied)throw new Error('ORGANIZATION_VERSION_CONFLICT');}
    for(const op of selected) {
      assertWorkspace(db,input.workspaceId,input.githubUserId);
      if(getRecord(db,'proposals',id)?.version!==input.proposalVersion)throw new Error('PROPOSAL_VERSION_CONFLICT');
      const previous=db.prepare('SELECT status FROM ai_proposal_effects WHERE proposal_id=? AND proposal_version=? AND operation_index=?').get(id,input.proposalVersion,op.index) as {status:string}|undefined;
      if(previous?.status==='applied'){results.push({index:op.index,status:'applied',replayed:true});continue;}
      if(op.kind==='update') {
        const records=db.prepare("SELECT id,data FROM sync_v2_records WHERE collection='repositories' AND deleted=0").all() as {id:string;data:string}[];
        const found=records.find(r=>JSON.parse(r.data).full_name===op.repository);if(!found){results.push({index:op.index,status:'conflict',reason:'REPOSITORY_NOT_FOUND'});continue;}
        const record=getRecord(db,'repositories',found.id)!;const version=input.expectedVersions?.[found.id];if(record.data?.category_locked && Object.keys(op.patch??{}).some(k=>['category_id','subcategory_id','category_candidates','custom_category'].includes(k))){results.push({index:op.index,status:'conflict',reason:'USER_LOCKED'});continue;}if(!Number.isSafeInteger(version)){results.push({index:op.index,status:'conflict',reason:'EXPECTED_VERSION_REQUIRED'});continue;}
        const result=db.transaction(()=>{
          const result=pushOperations(db,{workspaceId:input.workspaceId,githubUserId:input.githubUserId,clientId:'proposal-apply',operations:[{opId:`${id}:${input.proposalVersion}:${op.index}`,collection:'repositories',id:found.id,kind:'put',source:'user',baseVersion:version,data:{...record.data,...op.patch}}]}).results[0];
          if(result.status==='applied')db.prepare('INSERT INTO ai_proposal_effects VALUES(?,?,?,?,?,?,?) ON CONFLICT DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at').run(id,input.proposalVersion,op.index,op.kind,op.repository,'applied',new Date().toISOString());return result;
        })();results.push({index:op.index,...result});continue;
      }
      const desired=op.kind==='star';
      // Always inspect current GitHub state, including before recovering an unknown attempt.
      let observed:Response;
      try{observed=await github(`/user/starred/${op.repository}`);}catch{results.push({index:op.index,status:'unknown',reason:'VERIFY_UNAVAILABLE'});continue;}
      if(![204,404].includes(observed.status)){results.push({index:op.index,status:'unknown',reason:`VERIFY_HTTP_${observed.status}`});continue;}
      // Confirmation is tied to the exact proposal version. A sync edit may
      // arrive while GitHub verification is in flight.
      assertWorkspace(db,input.workspaceId,input.githubUserId);
      const confirmed=getRecord(db,'proposals',id);
      if(!confirmed || confirmed.deleted || confirmed.version!==input.proposalVersion)throw new Error('PROPOSAL_VERSION_CONFLICT');
      if((observed.status===204)!==desired) {
        db.prepare('INSERT INTO ai_proposal_effects VALUES(?,?,?,?,?,?,?) ON CONFLICT DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at').run(id,input.proposalVersion,op.index,op.kind,op.repository,'unknown',new Date().toISOString());
        try{const changed=await github(`/user/starred/${op.repository}`,desired?'PUT':'DELETE');if(changed.status!==204){results.push({index:op.index,status:'unknown',reason:`GITHUB_HTTP_${changed.status}`});continue;}}catch{results.push({index:op.index,status:'unknown',reason:'GITHUB_OUTCOME_UNKNOWN'});continue;}
        try{observed=await github(`/user/starred/${op.repository}`);}catch{results.push({index:op.index,status:'unknown',reason:'VERIFY_UNAVAILABLE'});continue;}
        if(![204,404].includes(observed.status)||(observed.status===204)!==desired){results.push({index:op.index,status:'unknown',reason:'VERIFY_MISMATCH'});continue;}
      }
      db.prepare('INSERT INTO ai_proposal_effects VALUES(?,?,?,?,?,?,?) ON CONFLICT DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at').run(id,input.proposalVersion,op.index,op.kind,op.repository,'applied',new Date().toISOString());
      results.push({index:op.index,status:'applied',verified:true});
    }
    const allEffects=db.prepare('SELECT operation_index,status FROM ai_proposal_effects WHERE proposal_id=? AND proposal_version=?').all(id,input.proposalVersion) as {operation_index:number;status:string}[];
    const allApplied=operations.every((_op:unknown,index:number)=>allEffects.some(effect=>effect.operation_index===index&&effect.status==='applied'));
    const update=db.transaction(()=>{
      const digest=createHash('sha256').update(JSON.stringify(results)).digest('hex').slice(0,16);
      const updated=pushOperations(db,{workspaceId:input.workspaceId,githubUserId:input.githubUserId,clientId:'proposal-apply',operations:[{opId:`${id}:${input.proposalVersion}:status:${digest}`,collection:'proposals',id,baseVersion:input.proposalVersion,kind:'put',source:'user',data:{...proposal.data,status:allApplied?'applied':'partial',applyResults:results,appliedIndices:allEffects.filter(effect=>effect.status==='applied').map(effect=>effect.operation_index),updatedAt:new Date().toISOString()}}]}).results[0];
      if(updated.status==='applied')db.prepare('INSERT OR IGNORE INTO ai_proposal_effects SELECT proposal_id,?,operation_index,kind,repository,status,updated_at FROM ai_proposal_effects WHERE proposal_id=? AND proposal_version=?').run(updated.record.version,id,input.proposalVersion);
      return updated;
    })();
    return {organizationApplied,proposalId:id,proposalVersion:update.status==='applied'?update.record.version:input.proposalVersion,results,syncStatus:update.status};
  } finally {busy.delete(id);}
}
