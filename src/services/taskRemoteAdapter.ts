import { aiTaskJournal, taskError, taskIsTerminal, type AITaskKind, type AITaskRecord } from './aiTaskJournal';
import type { HomeTask } from '../home/types';
import type { HomeSync } from '../home/sync';
import { readPendingTaskRequests, lookupTaskReceipt, confirmPolledTaskReceipt } from '../home/taskSubmission';

const remoteKinds: Record<string, AITaskKind> = { summary: 'summary', details: 'details', classification: 'organization', organization: 'organization', chat: 'chat', research: 'research', compare: 'research', requirements: 'research', proposal: 'organization', custom_discovery: 'discovery', refresh_stars: 'refresh' };
const remoteStates: Record<string, AITaskRecord['state']> = { queued: 'queued', running: 'running', completed: 'complete', failed: 'failed', cancelled: 'canceled', interrupted: 'interrupted' };

export function projectRemoteTask(sync: HomeSync, remote: HomeTask): AITaskRecord {
  const owner = String(sync.identity.githubUserId), id = `server:${sync.identity.workspaceId}:${remote.id}`;
  const existing = aiTaskJournal.snapshot().find(task => task.id === id);
  const state = remoteStates[remote.status] ?? 'unconfirmed';
  if(existing&&existing.updatedAt===remote.updatedAt&&!existing.connectionError&&existing.state===state
    &&existing.phase===(remote.phase??remote.stage)&&existing.commitStatus===(remote.commitStatus??(state==='complete'?'saved':'not_started'))
    &&existing.providerOutcome===(remote.providerOutcome??(state==='complete'?'succeeded':'in_flight'))
    &&existing.failureCode===(remote.failureCode??undefined)&&existing.error===(remote.error?taskError(remote.error):undefined)
    &&(!remote.capabilities||JSON.stringify(existing.capabilities)===JSON.stringify(remote.capabilities)))return existing;
  const kind = remoteKinds[remote.kind] ?? 'research';
  const names = Array.isArray(remote.input.repositories) ? remote.input.repositories.filter((value): value is string => typeof value === 'string') : [];
  const completedRepositories = new Set(Array.isArray(remote.result?.batch)
    ? remote.result.batch.flatMap(value => value && typeof value === 'object' && typeof (value as { repository?: unknown }).repository === 'string'
      ? [(value as { repository: string }).repository] : [])
    : []);
  const pendingRepository = typeof remote.result?.pendingRepository === 'string' ? remote.result.pendingRepository : undefined;
  const extended = remote;
  const task: AITaskRecord = { ...existing, id, owner, kind, state, location: 'server', executor: remote.kind==='refresh_stars'?undefined:extended.executor ?? 'server-provider', commitStatus: extended.commitStatus ?? (state === 'complete' ? 'saved' : 'not_started'), providerOutcome: extended.providerOutcome ?? (state === 'complete' ? 'succeeded' : 'in_flight'), failureCode: extended.failureCode ?? undefined,
    phase: extended.phase ?? remote.stage, capabilities: extended.capabilities ?? { pause: false, cancel: state === 'running' || state === 'queued', resume: ['interrupted', 'failed', 'canceled'].includes(state) ? 'new-provider-call' : 'unsupported' }, remoteId: remote.id,
    createdAt: remote.createdAt, startedAt: existing?.startedAt, updatedAt: remote.updatedAt,
    endedAt: ['complete', 'failed', 'canceled', 'interrupted'].includes(state) ? remote.updatedAt : undefined,
    error: remote.error ? taskError(remote.error) : undefined,
    connectionError: undefined, lastServerCheckAt: new Date().toISOString(),
    target: { view: kind === 'chat' || kind === 'research' || kind === 'organization' ? 'ai' : kind === 'discovery' ? 'subscription' : 'repositories',
      id: typeof remote.input.sessionId === 'string' ? remote.input.sessionId : undefined },
    title: names.length === 1 ? names[0] : undefined,
    items: names.length ? names.map(name => ({ id: name, label: name, state: state === 'complete' || completedRepositories.has(name) ? 'complete' : name === pendingRepository ? state === 'canceled' ? 'canceled' : state === 'failed' || state === 'interrupted' ? 'failed' : 'running' : 'pending' }))
      : [{ id: remote.id, label: remote.kind, state: state === 'complete' ? 'complete' : state === 'failed' ? 'failed' : state === 'canceled' ? 'canceled' : state === 'running' ? 'running' : 'pending' }],
  };
  aiTaskJournal.project(task);
  return task;
}
export function watchRemoteTasks(getSync: () => HomeSync | null, expectedOwner: string) {
  let stopped = false, pending = false;
  const controller = new AbortController();
  let scan: { sync: HomeSync; cursor?: string; watermark?: string; asOf?: string; ids: Set<string> } | undefined;
  let nextScanAt = 0;
  let liveOffset = 0;
  const markOffline = (error: unknown) => aiTaskJournal.snapshot().filter(task => task.owner === expectedOwner && task.location === 'server'
    && !['complete', 'failed', 'canceled', 'partial'].includes(task.state)).forEach(task => {
      aiTaskJournal.unbind(task.id);
      if (task.connectionError !== taskError(error)) aiTaskJournal.patch(task.id, { connectionError: taskError(error) });
    });
  const refresh = async () => {
    const sync = getSync();
    if (stopped || pending) return;
    if (!sync || String(sync.identity.githubUserId) !== expectedOwner) { markOffline('SERVER_NOT_CONNECTED'); return; }
    pending = true;
    try {
      const query = new URLSearchParams({ workspaceId: sync.identity.workspaceId, githubUserId: expectedOwner });
      const pendingRequests = await readPendingTaskRequests(sync).then(requests => {
        const invalidId = `submission-invalid:${sync.identity.workspaceId}`;
        if (!stopped && getSync() === sync && aiTaskJournal.snapshot().some(task => task.id === invalidId && task.state === 'unconfirmed')) {
          aiTaskJournal.patch(invalidId, { state: 'complete', endedAt: new Date().toISOString(), error: undefined });
        }
        return requests;
      }).catch(error => {
        if (!stopped && getSync() === sync) aiTaskJournal.project({
          id: `submission-invalid:${sync.identity.workspaceId}`, owner: expectedOwner, kind: 'sync', location: 'server',
          state: 'unconfirmed', updatedAt: new Date().toISOString(), error: taskError(error),
          target: { view: 'settings', tab: 'backend' }, items: [],
        });
        return [];
      });
      if (stopped || getSync() !== sync) return;
      for (const pendingRequest of pendingRequests) {
        const id = `submission:${sync.identity.workspaceId}:${pendingRequest.requestId}`;
        if (!aiTaskJournal.snapshot().some(task => task.id === id)) aiTaskJournal.project({ id, owner: expectedOwner,
          kind: remoteKinds[pendingRequest.kind] ?? 'research', location: 'server', state: 'unconfirmed', updatedAt: new Date().toISOString(),
          phase: 'Awaiting submission receipt / 等待提交回执', error: 'Submission not confirmed; verify the original request in connection settings / 提交尚未确认，请在连接设置核对原请求',
          target: { view: 'settings', tab: 'backend' }, items: [] });
        if (aiTaskJournal.snapshot().some(task => task.id === id && task.state === 'unconfirmed')) aiTaskJournal.bind(id, { resume: () => {
          void lookupTaskReceipt(sync,pendingRequest).then(receipt => {
            if (stopped || getSync() !== sync) return;
            if (receipt) { projectRemoteTask(sync, receipt); aiTaskJournal.patch(id, { state: 'complete', endedAt: new Date().toISOString(), error: undefined, connectionError: undefined }); aiTaskJournal.unbind(id); }
            else { aiTaskJournal.patch(id, { state: 'unconfirmed', error: 'Receipt not yet available; recover the original submission in connection settings / 回执尚未可用，请在连接设置恢复原提交' }); }
          }).catch(error => { if (!stopped && getSync() === sync) aiTaskJournal.patch(id, { state: 'unconfirmed', error: taskError(error) }); });
        } });
      }
      const remotes: HomeTask[] = [];
      let reconcileComplete = false;
      if (scan?.sync !== sync) { scan = undefined; nextScanAt = 0; }
      if (!scan && Date.now() >= nextScanAt) scan = { sync, ids: new Set() };
      const scanning = scan;
      // At most five pages per poll, with the cursor retained for the next poll.
      // A complete scan runs once a minute; live older tasks are fetched by ID.
      for (let pageIndex=0;pageIndex<(scanning?5:1);pageIndex++) {
        const pageQuery = new URLSearchParams(query); pageQuery.set('limit','100');
        if (scanning?.cursor) pageQuery.set('cursor',scanning.cursor);
        const response = await sync.api.request<{ tasks: HomeTask[]; nextCursor?: string; reconcile?: { watermark: string; asOf?: string; complete?: boolean; deletedIds?: string[] } }>(`/tasks?${pageQuery}`, undefined, controller.signal);
        if (stopped || getSync() !== sync) return;
        remotes.push(...(response.tasks ?? []));
        if (!scanning) break;
        if (scanning.watermark && scanning.watermark !== response.reconcile?.watermark) throw Error('TASK_RECONCILE_WATERMARK_CHANGED');
        scanning.watermark=response.reconcile?.watermark; scanning.asOf=response.reconcile?.asOf;
        for(const remote of response.tasks??[])scanning.ids.add(remote.id);
        for(const id of response.reconcile?.deletedIds??[]) {
          const missing=aiTaskJournal.snapshot().find(task=>task.id===`server:${sync.identity.workspaceId}:${id}`);
          if(missing&&!taskIsTerminal(missing)){aiTaskJournal.patch(missing.id,{state:'interrupted',failureCode:'REMOTE_TASK_DELETED',error:'Remote task deleted / 远端任务已删除'});aiTaskJournal.unbind(missing.id);}
        }
        scanning.cursor=response.nextCursor;
        if (!response.nextCursor) { reconcileComplete=response.reconcile?.complete===true; scan=undefined;nextScanAt=Date.now()+60000;break; }
      }
      const knownLive=aiTaskJournal.snapshot().filter(task=>task.id.startsWith(`server:${sync.identity.workspaceId}:`)&&task.remoteId&&!taskIsTerminal(task)&&!remotes.some(remote=>remote.id===task.remoteId));
      const liveWindow=knownLive.length?Array.from({length:Math.min(20,knownLive.length)},(_,index)=>knownLive[(liveOffset+index)%knownLive.length]):[];
      liveOffset=knownLive.length?(liveOffset+liveWindow.length)%knownLive.length:0;
      for(const task of liveWindow) {
        try { remotes.push(await sync.api.request<HomeTask>(`/tasks/${encodeURIComponent(task.remoteId!)}?${query}`,undefined,controller.signal)); }
        catch(error){ if(stopped||getSync()!==sync)return;if(error && typeof error==='object'&&'status' in error && error.status===404) {aiTaskJournal.patch(task.id,{state:'interrupted',failureCode:'REMOTE_TASK_DELETED',error:'Remote task deleted / 远端任务已删除'});aiTaskJournal.unbind(task.id);}else throw error; }
      }
      if (stopped || getSync() !== sync) return;
      const remoteIds = scanning?.ids ?? new Set(remotes.map(remote => remote.id));
      for (const remote of remotes) {

        const receiptId = `submission:${sync.identity.workspaceId}:${remote.requestId}`;
        if (aiTaskJournal.snapshot().some(task => task.id === receiptId && task.state === 'unconfirmed')) {
          const pendingRequest=pendingRequests.find(request=>request.requestId===remote.requestId);
          if(pendingRequest) {
            try {
              await confirmPolledTaskReceipt(sync,pendingRequest,remote);
              if(stopped||getSync()!==sync)return;
              aiTaskJournal.patch(receiptId, { state: 'complete', endedAt: new Date().toISOString(), error: undefined, connectionError: undefined, phase: 'Submission confirmed / 提交已确认' });
              aiTaskJournal.unbind(receiptId);
            } catch(error) { aiTaskJournal.patch(receiptId,{state:'unconfirmed',error:taskError(error)}); }
          }
        }
        if (aiTaskJournal.hiddenRemote(`server:${sync.identity.workspaceId}:${remote.id}`)) continue;
        const task = projectRemoteTask(sync, remote);
        const canResume = ['interrupted', 'failed', 'cancelled'].includes(remote.status) && remote.capabilities?.resume !== 'unsupported';
        if (!['queued', 'running'].includes(remote.status) && !canResume && remote.commitStatus!=='conflict') { aiTaskJournal.unbind(task.id); continue; }
        const action = async (operation: 'cancel' | 'resume') => {
          if (stopped || getSync() !== sync) return;
          try {
            const result = await sync.api.request<HomeTask>(`/tasks/${encodeURIComponent(remote.id)}/${operation}`, sync.identity, controller.signal);
            if (!stopped && getSync() === sync) { projectRemoteTask(sync, result); aiTaskJournal.unbind(task.id); }
          } catch (error) {
            if (!stopped) aiTaskJournal.patch(task.id, { state: 'unconfirmed', error: taskError(error) });
          }
        };
        const commit = remote.commitStatus === 'conflict' ? { commit: () => {
          void (async()=>{
            const preview=await sync.api.request<{targets:Array<{repositoryId:string;repository:string;currentVersion:number;expectedVersion:number;fields:string[]}>}>(`/tasks/${encodeURIComponent(remote.id)}/commit-preview?${query}`,undefined,controller.signal);
            if(stopped||getSync()!==sync)return;
            const changed=preview.targets.filter(target=>target.currentVersion!==target.expectedVersion);
            if(changed.length&&!window.confirm('保存冲突：以下仓库已有更新。仅将已生成的 AI 字段写入当前版本，其他字段保留；不会调用模型。是否继续？\nSave conflict: apply the generated AI fields to the current version, preserving other fields, without calling the provider?\n\n'+changed.map(target=>`${target.repository} · v${target.expectedVersion} → v${target.currentVersion} · ${target.fields.join(', ')}`).join('\n')))return;
            return sync.api.request<HomeTask>(`/tasks/${encodeURIComponent(remote.id)}/commit`, {...sync.identity,expectedVersions:Object.fromEntries(changed.map(target=>[target.repositoryId,target.currentVersion]))}, controller.signal);
          })()
            .then(result => { if (!stopped && getSync() === sync) { if(result){projectRemoteTask(sync, result); aiTaskJournal.unbind(task.id);}else aiTaskJournal.patch(task.id,{state:task.state}); } })
            .catch(error=>{if(!stopped&&getSync()===sync)aiTaskJournal.patch(task.id,{state:task.state,commitStatus:'conflict',error:taskError(error)});});
        } } : {};
        aiTaskJournal.bind(task.id, { ...(canResume ? { resume: () => { void action('resume'); } } : ['queued','running'].includes(remote.status)?{ stop: () => { void action('cancel'); } } : {}), ...commit });
      }
      if (reconcileComplete) {
        for (const task of aiTaskJournal.snapshot().filter(item => item.owner === expectedOwner && item.id.startsWith(`server:${sync.identity.workspaceId}:`) && item.remoteId && !remoteIds.has(item.remoteId) && (!scanning?.asOf || item.createdAt && item.createdAt <= scanning.asOf) && !taskIsTerminal(item))) {
          aiTaskJournal.patch(task.id, { state: 'interrupted', error: 'Remote task was reconciled out of the server window / 远端任务已从服务端窗口中核对移除', failureCode: 'REMOTE_TASK_RECONCILED' });
          aiTaskJournal.unbind(task.id);
        }
      }
    } catch (error) { scan=undefined;nextScanAt=0;if (!stopped && getSync() === sync) markOffline(error); }
    finally { pending = false; }
  };
  void refresh();
  const timer = setInterval(() => { void refresh(); }, 5000);
  return () => { stopped = true; clearInterval(timer); controller.abort(); aiTaskJournal.snapshot().filter(task => task.owner === expectedOwner && task.location === 'server').forEach(task => aiTaskJournal.unbind(task.id)); };
}
