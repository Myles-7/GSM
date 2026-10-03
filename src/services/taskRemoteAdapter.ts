import { aiTaskJournal, taskError, type AITaskKind, type AITaskRecord } from './aiTaskJournal';
import type { HomeTask } from '../home/types';
import type { HomeSync } from '../home/sync';
import { readPendingTaskRequest, recoverPendingTaskRequest } from '../home/taskSubmission';

const remoteKinds: Record<string, AITaskKind> = { summary: 'summary', details: 'details', classification: 'organization', organization: 'organization', chat: 'chat', research: 'research', compare: 'research', requirements: 'research', proposal: 'organization', custom_discovery: 'discovery', refresh_stars: 'refresh' };
const remoteStates: Record<string, AITaskRecord['state']> = { queued: 'queued', running: 'running', completed: 'complete', failed: 'failed', cancelled: 'canceled', interrupted: 'interrupted' };

export function projectRemoteTask(sync: HomeSync, remote: HomeTask): AITaskRecord {
  const owner = String(sync.identity.githubUserId), id = `server:${sync.identity.workspaceId}:${remote.id}`;
  const existing = aiTaskJournal.snapshot().find(task => task.id === id);
  if (existing?.updatedAt === remote.updatedAt && !existing.connectionError && existing.state === (remoteStates[remote.status] ?? 'unconfirmed')) return existing;
  const state = remoteStates[remote.status] ?? 'unconfirmed';
  const kind = remoteKinds[remote.kind] ?? 'research';
  const names = Array.isArray(remote.input.repositories) ? remote.input.repositories.filter((value): value is string => typeof value === 'string') : [];
  const task: AITaskRecord = { ...existing, id, owner, kind, state, location: 'server', trigger: 'manual', remoteId: remote.id,
    createdAt: remote.createdAt, startedAt: existing?.startedAt, updatedAt: remote.updatedAt,
    endedAt: ['complete', 'failed', 'canceled', 'interrupted'].includes(state) ? remote.updatedAt : undefined,
    phase: remote.stage, error: remote.error ? taskError(remote.error) : undefined,
    connectionError: undefined, lastServerCheckAt: new Date().toISOString(),
    target: { view: kind === 'chat' || kind === 'research' || kind === 'organization' ? 'ai' : kind === 'discovery' ? 'subscription' : 'repositories',
      id: typeof remote.input.sessionId === 'string' ? remote.input.sessionId : undefined },
    title: names.length === 1 ? names[0] : undefined,
    items: names.length ? names.map(name => ({ id: name, label: name, state: state === 'complete' ? 'complete' : state === 'failed' ? 'failed' : state === 'canceled' ? 'canceled' : 'pending' }))
      : [{ id: remote.id, label: remote.kind, state: state === 'complete' ? 'complete' : state === 'failed' ? 'failed' : state === 'canceled' ? 'canceled' : state === 'running' ? 'running' : 'pending' }],
  };
  aiTaskJournal.project(task);
  return task;
}
export function watchRemoteTasks(getSync: () => HomeSync | null, expectedOwner: string) {
  let stopped = false, pending = false;
  const controller = new AbortController();
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
      const pendingRequest = await readPendingTaskRequest(sync).then(request => {
        const invalidId = `submission-invalid:${sync.identity.workspaceId}`;
        if (!stopped && getSync() === sync && aiTaskJournal.snapshot().some(task => task.id === invalidId && task.state === 'unconfirmed')) {
          aiTaskJournal.patch(invalidId, { state: 'complete', endedAt: new Date().toISOString(), error: undefined });
        }
        return request;
      }).catch(error => {
        if (!stopped && getSync() === sync) aiTaskJournal.project({
          id: `submission-invalid:${sync.identity.workspaceId}`, owner: expectedOwner, kind: 'sync', location: 'server',
          state: 'unconfirmed', updatedAt: new Date().toISOString(), error: taskError(error),
          target: { view: 'settings', tab: 'backend' }, items: [],
        });
        return null;
      });
      if (stopped || getSync() !== sync) return;
      if (pendingRequest) {
        const id = `submission:${sync.identity.workspaceId}:${pendingRequest.requestId}`;
        if (!aiTaskJournal.snapshot().some(task => task.id === id)) aiTaskJournal.project({ id, owner: expectedOwner,
          kind: remoteKinds[pendingRequest.kind] ?? 'research', location: 'server', state: 'unconfirmed', updatedAt: new Date().toISOString(),
          phase: 'Awaiting submission receipt / 等待提交回执', error: 'Submission not confirmed; verify the original request in connection settings / 提交尚未确认，请在连接设置核对原请求',
          target: { view: 'settings', tab: 'backend' }, items: [] });
        if (aiTaskJournal.snapshot().some(task => task.id === id && task.state === 'unconfirmed')) aiTaskJournal.bind(id, { resume: () => {
          void recoverPendingTaskRequest(sync).then(receipt => {
            if (stopped || getSync() !== sync) return;
            if (receipt) { projectRemoteTask(sync, receipt); aiTaskJournal.patch(id, { state: 'complete', endedAt: new Date().toISOString(), error: undefined, connectionError: undefined }); aiTaskJournal.unbind(id); }
            else { aiTaskJournal.patch(id, { state: 'unconfirmed', error: 'No pending submission found / 未找到待确认提交' }); aiTaskJournal.unbind(id); }
          }).catch(error => { if (!stopped && getSync() === sync) aiTaskJournal.patch(id, { state: 'unconfirmed', error: taskError(error) }); });
        } });
      }
      const response = await sync.api.request<{ tasks: HomeTask[] }>(`/tasks?${query}`, undefined, controller.signal);
      if (stopped || getSync() !== sync) return;
      for (const remote of response.tasks) {
        const receiptId = `submission:${sync.identity.workspaceId}:${remote.requestId}`;
        if (aiTaskJournal.snapshot().some(task => task.id === receiptId && task.state === 'unconfirmed')) aiTaskJournal.patch(receiptId,
          { state: 'complete', endedAt: new Date().toISOString(), error: undefined, connectionError: undefined, phase: 'Submission confirmed / 提交已确认' });
        if (aiTaskJournal.hiddenRemote(`server:${sync.identity.workspaceId}:${remote.id}`)) continue;
        const task = projectRemoteTask(sync, remote);
        if (!['queued', 'running', 'interrupted'].includes(remote.status)) { aiTaskJournal.unbind(task.id); continue; }
        const action = async (operation: 'cancel' | 'resume') => {
          if (stopped || getSync() !== sync) return;
          try {
            const result = await sync.api.request<HomeTask>(`/tasks/${encodeURIComponent(remote.id)}/${operation}`, sync.identity, controller.signal);
            if (!stopped && getSync() === sync) { projectRemoteTask(sync, result); aiTaskJournal.unbind(task.id); }
          } catch (error) {
            if (!stopped) aiTaskJournal.patch(task.id, { state: 'unconfirmed', error: taskError(error) });
          }
        };
        aiTaskJournal.bind(task.id, { ...(remote.status === 'interrupted' ? { resume: () => { void action('resume'); } } : { stop: () => { void action('cancel'); } }) });
      }
    } catch (error) { if (!stopped && getSync() === sync) markOffline(error); }
    finally { pending = false; }
  };
  void refresh();
  const timer = setInterval(() => { void refresh(); }, 5000);
  return () => { stopped = true; clearInterval(timer); controller.abort(); aiTaskJournal.snapshot().filter(task => task.owner === expectedOwner && task.location === 'server').forEach(task => aiTaskJournal.unbind(task.id)); };
}
