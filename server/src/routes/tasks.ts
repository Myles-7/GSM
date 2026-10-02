import { Router, type Request, type Response } from 'express';
import { getDb } from '../db/connection.js';
import { createTask,getTask,getTaskByRequest,isTaskRequestId,recordTaskCreationRejection,publicTask,listTasks,taskEvents,cancelTask,resumeTask } from '../services/taskRunner.js';
import { applyTaskProposal } from '../services/taskProposals.js';
import { SyncError } from '../services/syncV2.js';
import { config } from '../config.js';
import { authMiddleware } from '../middleware/auth.js';
const router=Router();
router.use(['/api/tasks','/api/proposals'],(req,res,next)=>{if(!config.apiSecret){res.status(503).json({error:'API_SECRET_REQUIRED',code:'API_SECRET_REQUIRED'});return;}authMiddleware(req,res,next);});
router.post(['/api/tasks/proposals/:id/apply','/api/proposals/:id/apply'],async(req,res)=>{try{const a=identity(req);res.json(await applyTaskProposal(getDb(),req.params.id,{...req.body,...a}));}catch(e){fail(res,e);}});
function identity(req:Request) {const source=(req.method==='GET'?req.query:req.body)??{}; const workspaceId=String(source.workspaceId || '');const githubUserId=Number(source.githubUserId);if(!workspaceId||!Number.isSafeInteger(githubUserId)||githubUserId<=0)throw new Error('WORKSPACE_IDENTITY_REQUIRED');return {workspaceId,githubUserId};}
function errorCode(error:unknown){const message=error instanceof Error?error.message:'TASK_ERROR';return /^[A-Z][A-Z_0-9]+$/.test(message)?message:'TASK_ERROR';}
function fail(res:Response,error:unknown,status?:number,accepted?:false){const code=errorCode(error);res.status(status??(code==='TASK_NOT_FOUND'||code==='TASK_REQUEST_NOT_FOUND'?404:code.includes('CONFLICT')||code.includes('MISMATCH')?409:400)).json({error:code,code,...(accepted===false?{accepted:false}:{})});}
// These validation failures occur before the task insert. Other errors can be
// raised after commit, so they must never promise that work was not accepted.
const creationValidationCodes=new Set([
  'INVALID_TASK','INVALID_REPOSITORIES','REPOSITORY_EVIDENCE_REQUIRED',
  'RESEARCH_REPOSITORY_LIMIT','RESEARCH_QUERY_REQUIRED','DISCOVERY_CHANNEL_QUERY_REQUIRED',
  'PROJECT_NOT_FOUND','PROJECT_ACCOUNT_MISMATCH','PROJECT_LOCAL_SOURCES_UNSUPPORTED',
  'INVALID_PROJECT_CONTEXT','INVALID_PROJECT_REPOSITORIES',
  'SESSION_ACCOUNT_MISMATCH','SESSION_LOCAL_SOURCES_UNSUPPORTED','SESSION_PROJECT_MISMATCH',
  'USER_MESSAGE_MISMATCH','SESSION_TASK_ACTIVE','REFRESH_STARS_TASK_ACTIVE',
  'AI_CONFIG_REQUIRED','AI_CONFIG_DECRYPT_FAILED','DEEPSEEK_ENDPOINT_REQUIRED','DEEPSEEK_MODEL_REQUIRED',
]);
const identityCodes=new Set(['WORKSPACE_IDENTITY_REQUIRED','WORKSPACE_UNINITIALIZED','WORKSPACE_ACCOUNT_MISMATCH']);
function creationFailure(req:Request,res:Response,error:unknown,account?:ReturnType<typeof identity>) {
  const code=errorCode(error);
  if(!creationValidationCodes.has(code)&&!identityCodes.has(code)&&code!=='REQUEST_ID_CONFLICT') {fail(res,error,500);return;}
  const status=error instanceof SyncError?error.status:code.includes('CONFLICT')||code.includes('MISMATCH')?409:400;
  if(account&&isTaskRequestId(req.body?.requestId)&&creationValidationCodes.has(code)) {
    try {
      const rejected=recordTaskCreationRejection(getDb(),{...req.body,...account},code);
      fail(res,error,status,rejected?false:undefined);return;
    }catch{fail(res,new Error('TASK_ERROR'),500);return;}
  }
  fail(res,error,status);
}
router.post('/api/tasks',(req,res)=>{let account:ReturnType<typeof identity>|undefined;try{account=identity(req);res.status(202).json(publicTask(createTask(getDb(),{...req.body,...account})));}catch(e){creationFailure(req,res,e,account);}});
router.get('/api/tasks',(req,res)=>{try{const a=identity(req);res.json({tasks:listTasks(getDb(),a.workspaceId,a.githubUserId).map(publicTask)});}catch(e){fail(res,e);}});
router.get('/api/tasks/by-request/:requestId',(req,res)=>{try{const a=identity(req);res.json(publicTask(getTaskByRequest(getDb(),req.params.requestId,a.workspaceId,a.githubUserId)));}catch(e){const code=errorCode(e);fail(res,e,e instanceof SyncError?e.status:code==='TASK_REQUEST_NOT_FOUND'?404:code==='INVALID_TASK'||identityCodes.has(code)?400:500);}});
router.get('/api/tasks/:id',(req,res)=>{try{const a=identity(req);res.json(publicTask(getTask(getDb(),req.params.id,a.workspaceId,a.githubUserId)));}catch(e){fail(res,e);}});
for(const action of ['cancel','resume'] as const)router.post(`/api/tasks/:id/${action}`,(req,res)=>{try{const a=identity(req);res.json(publicTask((action==='cancel'?cancelTask:resumeTask)(getDb(),req.params.id,a.workspaceId,a.githubUserId)));}catch(e){fail(res,e);}});
router.get('/api/tasks/:id/events',(req,res)=>{
  try {
    const a=identity(req);const db=getDb();getTask(db,req.params.id,a.workspaceId,a.githubUserId);
    let after=Number(req.get('Last-Event-ID') || req.query.after || 0);if(!Number.isSafeInteger(after)||after<0)throw new Error('INVALID_EVENT_CURSOR');
    res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();
    let closed=false,blocked=false; const pump=()=>{
      if(closed||blocked)return;
      try{getTask(db,req.params.id,a.workspaceId,a.githubUserId);for(const event of taskEvents(db,req.params.id,after)){const writable=res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);after=event.seq;if(!writable){blocked=true;break;}}}catch{res.end();}
    };
    res.on('drain',()=>{blocked=false;pump();});
    pump();const interval=setInterval(pump,300);const heartbeat=setInterval(()=>{if(!closed&&!blocked)blocked=!res.write(': keepalive\n\n');},15000);
    res.on('close',()=>{closed=true;clearInterval(interval);clearInterval(heartbeat);});
  }catch(e){if(!res.headersSent)fail(res,e);else res.end();}
});
export default router;
