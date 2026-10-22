import { z } from 'zod';
import { getStorageItemStrict } from './indexedDbStorage';
import { taskJournalStorage } from './taskJournalStorage';
import { reconcileAgyTask } from './agyRecoveryPolicy';
import { taskObservability } from './taskObservability';

export const TASK_KINDS = ['summary', 'details', 'gists', 'discovery', 'discovery-analysis', 'plugins', 'organization', 'exploration', 'release', 'search', 'chat', 'research', 'index', 'refresh', 'sync', 'import', 'export', 'backup', 'restore'] as const;
export type AITaskKind = typeof TASK_KINDS[number];
export const TASK_PHASES = ['queue_wait', 'initializing', 'generating', 'committing', 'cleanup', 'reconciling'] as const;
export type AITaskPhase = typeof TASK_PHASES[number];
export type AITaskExecutor = 'agy-device' | 'server-provider';
export type CommitStatus = 'not_started' | 'pending' | 'saved' | 'conflict' | 'failed';
export type ProviderOutcome = 'not_started' | 'in_flight' | 'succeeded' | 'failed' | 'unknown';
const states = ['queued', 'running', 'pausing', 'paused', 'stopping', 'canceled', 'complete', 'partial', 'failed', 'interrupted', 'unconfirmed', 'committing'] as const;
const schema = z.object({
  id: z.string(), owner: z.string(), kind: z.enum(TASK_KINDS), configId: z.string().optional(), channelId: z.string().optional(),
  state: z.enum(states), updatedAt: z.string(), createdAt: z.string().optional(), startedAt: z.string().optional(), endedAt: z.string().optional(),
  title: z.string().optional(), phase: z.string().optional(), error: z.string().optional(), archived: z.boolean().optional(), pinned: z.boolean().optional(),
  connectionError: z.string().optional(), lastServerCheckAt: z.string().optional(),
  trigger: z.enum(['manual', 'automatic']).optional(), location: z.enum(['device', 'server']).optional(),
  executor: z.enum(['agy-device', 'server-provider']).optional(),
  commitStatus: z.enum(['not_started', 'pending', 'saved', 'conflict', 'failed']).optional(),
  providerOutcome: z.enum(['not_started', 'in_flight', 'succeeded', 'failed', 'unknown']).optional(),
  failureCode: z.string().max(120).optional(),
  stopReason: z.enum(['user', 'account_change', 'unmounted', 'config_changed', 'lease_lost']).optional(),
  capabilities: z.object({ pause: z.boolean(), cancel: z.boolean(), resume: z.enum(['safe', 'new-provider-call', 'unsupported']) }).optional(),
  parentId: z.string().optional(), remoteId: z.string().optional(),
  config: z.object({ model: z.string().optional(), provider: z.string().optional(), effort: z.string().optional(), timeoutSeconds: z.number().optional() }).optional(),
  target: z.object({ view: z.string(), id: z.string().optional(), tab: z.string().optional() }).optional(),
  progress: z.object({ done: z.number(), total: z.number() }).optional(), usage: z.record(z.string(), z.number()).optional(),
  units: z.object({items:z.enum(['batches','repositories','steps']),repositories:z.number().int().nonnegative().optional()}).optional(),
  items: z.array(z.object({ id: z.string(), label: z.string(), error: z.string().optional(), phase: z.string().optional(),
    providerOutcome: z.enum(['not_started', 'in_flight', 'succeeded', 'failed', 'unknown']).optional(),
    commitStatus: z.enum(['not_started', 'pending', 'saved', 'conflict', 'failed']).optional(),
    failureCode: z.string().max(120).optional(), requestId: z.string().max(80).optional(),
    recovery: z.object({ requestId: z.string().max(80), digest: z.string().max(64).optional() }).optional(),
    validationStatus: z.enum(['passed', 'failed']).optional(),
    warning: z.string().max(120).optional(), state: z.enum(['pending', 'running', 'complete', 'failed', 'canceled']) })),
});
export type AITaskRecord = z.infer<typeof schema>;
export interface AITaskControls { pause?(): void; resume?(): void; stop?(): void; commit?(): void; }
export type TaskMetadata = Partial<Pick<AITaskRecord, 'title' | 'phase' | 'trigger' | 'location' | 'executor' | 'commitStatus' | 'providerOutcome' | 'failureCode' | 'capabilities' | 'parentId' | 'remoteId' | 'config' | 'target' | 'usage' | 'stopReason' | 'units'>>;
export interface TaskActivity { lastRun?: string; runCount: number; changedCount: number; failureCount: number; noChangeCount: number; lastError?: string; }
const activitySchema = z.object({ lastRun: z.string().optional(), runCount: z.number().nonnegative(), changedCount: z.number().nonnegative(), failureCount: z.number().nonnegative(), noChangeCount: z.number().nonnegative(), lastError: z.string().optional() });
const controls = new Map<string, AITaskControls>();
const listeners = new Set<() => void>();
const loaded = new Set<string>();
const loading = new Map<string, Promise<void>>();
const initialized = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const writes = new Map<string, Promise<void>>();
const pendingIds = new Map<string, Set<string>>();
const removedIds = new Map<string, Set<string>>();
const dirtyActivity = new Set<string>();
const dirtyHidden = new Set<string>();
const byId = new Map<string, AITaskRecord>();
let snapshot: AITaskRecord[] | undefined;
const records = () => snapshot ??= [...byId.values()];
let hosts = 0;
let storageError = '';
const deletedRemote = new Set<string>();
const activities = new Map<string, TaskActivity>();
const key = (owner: string) => `gsm:ai-task-journal:${encodeURIComponent(owner)}`;
const emit = () => { snapshot = undefined; listeners.forEach(listener => listener()); };
export const taskNeedsAttention = (task: AITaskRecord) => !!task.connectionError || ['failed', 'partial', 'interrupted', 'unconfirmed'].includes(task.state)
  || task.commitStatus === 'conflict' || task.commitStatus === 'failed' || task.providerOutcome === 'unknown'
  || taskIsTerminal(task) && task.items.some(item => !!item.recovery)
  || (task.state === 'complete' && task.items.some(item => item.state === 'failed'));
export const taskIsTerminal = (task: AITaskRecord) => ['complete', 'partial', 'failed', 'canceled', 'interrupted', 'unconfirmed'].includes(task.state);
export const taskHasProtectedContent = (task:AITaskRecord) => !taskIsTerminal(task)||['interrupted','unconfirmed'].includes(task.state)||task.providerOutcome==='unknown'
  ||['pending','failed','conflict'].includes(task.commitStatus??'')||task.items.some(item=>!!item.recovery||item.providerOutcome==='unknown'||['pending','failed','conflict'].includes(item.commitStatus??''));
export const taskDisplayState = (task: AITaskRecord): AITaskRecord['state'] => ['complete', 'failed'].includes(task.state) && task.items.some(item => item.state === 'failed')
  ? task.items.some(item => item.state === 'complete') ? 'partial' : 'failed' : task.state;
const retained = (task: AITaskRecord) => task.archived || task.pinned || taskHasProtectedContent(task)
  || !Number.isFinite(Date.parse(task.endedAt ?? task.updatedAt)) || Date.now() - Date.parse(task.endedAt ?? task.updatedAt) < 30 * 86400000;
export function taskError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[endpoint]')
    .replace(/[A-Za-z]:[\\/][^\n\r"<>]+/g, '[local path]').slice(0, 1000);
}
function ownerRecords(owner: string) { return [...byId.values()].filter(item => item.owner === owner); }
function defaultActivity(): TaskActivity { return { runCount: 0, changedCount: 0, failureCount: 0, noChangeCount: 0 }; }
function markPending(owner: string, id: string) { const ids = pendingIds.get(owner) ?? new Set<string>(); ids.add(id); pendingIds.set(owner, ids); }
function persist(owner: string, immediate = false, id?: string) {
  if (id) markPending(owner, id);
  if (timers.has(owner)) clearTimeout(timers.get(owner));
  const save = () => {
    timers.delete(owner);
    const pending = (writes.get(owner) ?? Promise.resolve()).then(async () => {
      await aiTaskJournal.load(owner);
      const ids = pendingIds.get(owner) ?? new Set<string>();
      const removals = removedIds.get(owner) ?? new Set<string>();
      const activity = dirtyActivity.delete(owner), hidden = dirtyHidden.delete(owner);
      pendingIds.delete(owner); removedIds.delete(owner);
      if (!ids.size && !removals.size && !activity && !hidden && initialized.has(owner)) return;
      try {
        await taskJournalStorage.commit(owner, {
          upserts: initialized.has(owner) ? [...ids].flatMap(id => { const task = byId.get(id); return task?.owner === owner ? [task] : []; }) : ownerRecords(owner),
          removals: [...removals],
          ...(activity ? { activity: activities.get(owner) ?? defaultActivity() } : {}),
          ...(hidden ? { hidden: ownerRecordsHidden(owner) } : {}),
          initialize: !initialized.has(owner),
        });
        initialized.add(owner); storageError = '';
      } catch {
        ids.forEach(id => markPending(owner, id));
        const pendingRemovals = removedIds.get(owner) ?? new Set<string>();
        removals.forEach(id => pendingRemovals.add(id)); removedIds.set(owner, pendingRemovals);
        if (activity) dirtyActivity.add(owner); if (hidden) dirtyHidden.add(owner);
        storageError = 'TASK_STORAGE_FAILED'; emit();
      }
    }).catch(() => { storageError = 'TASK_STORAGE_FAILED'; emit(); });
    writes.set(owner, pending);
  };
  if (immediate) save(); else timers.set(owner, setTimeout(save, 250));
}
function publish(record: AITaskRecord, immediate = false) {
  const previous=byId.get(record.id);
  byId.set(record.id, record);
  taskObservability.markTask(record.owner,record.id,{state:record.state,endedAt:record.endedAt,pinned:record.pinned,protected:taskHasProtectedContent(record)});
  if(previous?.state!==record.state||previous?.phase!==record.phase||previous?.commitStatus!==record.commitStatus)taskObservability.event(record.owner,record.id,{source:record.location==='server'?'server':'gsm',type:'task-state',phase:record.phase,message:record.state});
  for(const item of record.items){
    const old=previous?.items.find(row=>row.id===item.id);
    if(old?.state!==item.state||old?.commitStatus!==item.commitStatus)taskObservability.event(record.owner,record.id,{source:record.location==='server'?'server':'gsm',type:'item-state',itemId:item.id,requestId:item.requestId,phase:item.phase,message:item.state});
    if(item.state==='complete'&&(old?.state!=='complete'||old?.commitStatus!==item.commitStatus)){
      const request=[...taskObservability.snapshot(record.owner,record.id).requests].reverse().find(row=>(row.itemId===item.id||!row.itemId&&record.items.length===1)&&row.outcome==='succeeded');
      if(request?.answer){let data:unknown=request.answer;try{data=JSON.parse(request.answer);}catch{/* Plain answers remain readable text. */}taskObservability.result(record.owner,record.id,{id:`${item.id}:${request.requestId}`,itemId:item.id,requestId:request.requestId,label:item.label,data,commitStatus:item.commitStatus??record.commitStatus??'not_started'});}
    }
  }
  // Retention runs on terminal transitions, never on progress/activity updates.
  if (immediate && taskIsTerminal(record)) pruneOwner(record.owner);
  persist(record.owner, immediate, record.id); emit();
}
async function mergeSaved(owner: string, values: unknown[]) {
  const restored = values.map(value => schema.parse(value));
  let calls: Awaited<ReturnType<typeof import('./agyClient')['listAgyRecovery']>> = [];
  if (typeof window !== 'undefined' && window.electronAPI?.agy?.recoveryList) {
    try { calls = await (await import('./agyClient')).listAgyRecovery(owner); }
    catch (error) {
      // Keep the registry fail-closed for new provider calls, but do not let one
      // corrupt recovery row hide otherwise-valid task history from Task Center.
      storageError = error instanceof Error ? error.message : 'AGY_RECOVERY_RECORD_CORRUPT';
    }
  }
  for (const call of calls.filter(call => !call.receipt && (call.recoverable || call.providerOutcome === 'unknown'))) {
    const taskId = call.taskId ?? `agy-recovery-${call.requestId}`;
    if (!restored.some(task => task.id === taskId)) {
      const context = call.recoverable ? (await (await import('./agyClient')).readAgyRecovery(owner, call.requestId)).context as { source?: { channelId: string } } | undefined : undefined;
      restored.push({ id: taskId, owner,
      kind: call.feature === 'repository-details' ? 'details' : call.feature === 'organization' ? 'organization' : 'research',
      ...(context?.source?.channelId ? { kind: 'discovery-analysis', channelId: context.source.channelId } : {}),
      configId: 'agy-cli-local', executor: 'agy-device', state: 'interrupted', createdAt: call.createdAt, updatedAt: call.createdAt,
      providerOutcome: call.providerOutcome, commitStatus: call.recoverable ? 'failed' : 'not_started',
      items: [{ id: call.itemId ?? call.requestId, label: call.step ?? 'AGY recovery', state: 'pending', requestId: call.requestId,
        providerOutcome: call.providerOutcome, ...(call.recoverable ? { recovery: { requestId: call.requestId, digest: call.resultDigest } } : {}) }] });
    }
  }
  for (const value of restored) {
    const item = reconcileAgyTask(schema.parse(value), calls);
    if (item.owner !== owner) throw Error('TASK_OWNER_MISMATCH');
    if (byId.has(item.id)) continue;
    byId.set(item.id, { ...item, state: item.location === 'server' || taskIsTerminal(item) ? item.state : 'interrupted',
      items: item.items.map(entry => ({ ...entry, state: entry.state === 'running' && item.location !== 'server' ? 'pending' : entry.state })) });
  }
}
const hiddenOwners = new Map<string, Set<string>>();
function ownerRecordsHidden(owner: string) { return [...(hiddenOwners.get(owner) ?? [])]; }
function removeRecord(task: AITaskRecord) {
  byId.delete(task.id);
  const ids = removedIds.get(task.owner) ?? new Set<string>(); ids.add(task.id); removedIds.set(task.owner, ids);
}
function pruneOwner(owner: string) {
  ownerRecords(owner).forEach(task => { if (!retained(task) && !controls.has(task.id)) removeRecord(task); });
}
export const aiTaskJournal = {
  attachHost() { hosts++; return () => { hosts--; }; }, hasHost: () => hosts > 0,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }, snapshot: records,
  project(record: AITaskRecord) { if (!deletedRemote.has(record.id)) publish(schema.parse(record)); }, hiddenRemote(id: string) { return deletedRemote.has(id); },
  bind(id: string, value: AITaskControls) { controls.set(id, value); emit(); }, unbind(id: string) { if (controls.delete(id)) emit(); }, storageError: () => storageError,
  activity(owner: string): TaskActivity { return { ...(activities.get(owner) ?? defaultActivity()) }; },
  noteActivity(owner: string, patch: { changed?: boolean; failed?: boolean; noChange?: boolean; lastError?: string } = {}) {
    const current = activities.get(owner) ?? defaultActivity(); const next = { ...current, lastRun: new Date().toISOString(), runCount: current.runCount + 1,
      changedCount: current.changedCount + (patch.changed ? 1 : 0), failureCount: current.failureCount + (patch.failed ? 1 : 0), noChangeCount: current.noChangeCount + (patch.noChange ? 1 : 0), lastError: patch.lastError ?? current.lastError };
    activities.set(owner, next); dirtyActivity.add(owner); persist(owner); emit();
  },
  load(owner: string) {
    if (!owner || loaded.has(owner)) return Promise.resolve();
    if (loading.has(owner)) return loading.get(owner)!;
    const pending = (async () => {
      const saved = await taskJournalStorage.read(owner);
      if (saved.initialized) { await mergeSaved(owner, saved.records); initialized.add(owner); }
      else {
        const legacy = await getStorageItemStrict(key(owner), key(owner));
        await mergeSaved(owner, legacy ? z.array(z.unknown()).parse(JSON.parse(legacy)) : []);
        // Keep the original legacy blob untouched as an explicit rollback source.
      }
      if (saved.activity && !dirtyActivity.has(owner)) activities.set(owner, activitySchema.parse(saved.activity));
      const hidden = new Set(z.array(z.string()).parse(saved.hidden)); hiddenOwners.set(owner, hidden);
      hidden.forEach(id => { deletedRemote.add(id); byId.delete(id); });
      loaded.add(owner); pruneOwner(owner);
      if (!saved.initialized) {
        try {
          await taskJournalStorage.commit(owner, { upserts: ownerRecords(owner), removals: [...(removedIds.get(owner) ?? [])], initialize: true });
          initialized.add(owner);
        } catch { storageError = 'TASK_STORAGE_FAILED'; }
      }
      emit();
    })().catch(error => { storageError = error instanceof Error && /RECOVERY/.test(error.message) ? error.message : 'TASK_STORAGE_FAILED'; emit(); }).finally(() => loading.delete(owner));
    loading.set(owner, pending); return pending;
  },
  flush(owner: string) { persist(owner, true); return writes.get(owner) ?? Promise.resolve(); },
  control(id: string, action: keyof AITaskControls) {
    const task = byId.get(id), handler = controls.get(id)?.[action];
    if (!task || !handler || task.state === 'committing' || task.state === 'stopping' || (action === 'pause' && !['running', 'queued'].includes(task.state)) || (action === 'resume' && !['paused', 'pausing', 'interrupted', 'unconfirmed', 'failed', 'canceled'].includes(task.state)) || (action === 'commit' && task.commitStatus !== 'conflict')) return;
    publish({ ...task, state: action === 'stop' ? 'stopping' : action === 'pause' ? 'pausing' : action === 'commit' ? 'committing' : 'running', updatedAt: new Date().toISOString() }, true); handler();
  },
  supports(id: string, action: keyof AITaskControls) { return !!controls.get(id)?.[action] && byId.get(id)?.state !== 'committing'; }, live(id: string) { return controls.has(id); },
  busy(owner: string, kind: AITaskKind) { return records().some(item => item.owner === owner && item.kind === kind && controls.has(item.id)); },
  stopOwner(owner: string) { for (const record of byId.values()) if (record.owner === owner && record.location !== 'server') aiTaskJournal.control(record.id, 'stop'); },
  archive(ids: string[], value: boolean) { const owners = new Set<string>(); for (const id of ids) { const task = byId.get(id); if (task && taskIsTerminal(task) && !controls.has(id)) { byId.set(id, { ...task, archived: value }); markPending(task.owner, id); owners.add(task.owner); } } owners.forEach(owner => persist(owner, true)); emit(); },
  remove(ids: string[]) { const owners = new Set<string>(); for (const id of ids) { const task = byId.get(id); if (!task || !taskIsTerminal(task) || controls.has(id)) continue; if (task.location === 'server') { deletedRemote.add(id); const hidden = hiddenOwners.get(task.owner) ?? new Set<string>(); hidden.add(id); hiddenOwners.set(task.owner, hidden); dirtyHidden.add(task.owner); } removeRecord(task); owners.add(task.owner); } owners.forEach(owner => persist(owner, true)); emit(); },
  patch(id: string, patch: Partial<AITaskRecord>) { const record = byId.get(id); if (record) publish({ ...record, ...patch, id: record.id, owner: record.owner, updatedAt: new Date().toISOString() }, true); },
  begin(owner: string, kind: AITaskKind, items: { id: string; label: string }[], configId?: string, channelId?: string, metadata: TaskMetadata = {}) {
    const at = new Date().toISOString(), id = crypto.randomUUID(), location = metadata.location ?? 'device';
    publish({ id, owner, kind, configId, channelId, state: 'running', createdAt: at, startedAt: at, updatedAt: at, trigger: 'manual', location,
      phase: metadata.phase ?? 'queue_wait', commitStatus: metadata.commitStatus ?? 'not_started', providerOutcome: metadata.providerOutcome ?? 'not_started', capabilities: metadata.capabilities ?? { pause: false, cancel: true, resume: 'unsupported' }, ...metadata,
      items: items.map(item => ({ ...item, state: 'pending' })) });
    const update = (patch: Partial<AITaskRecord>, immediate = false) => { const record = byId.get(id); if (record && !record.endedAt) publish({ ...record, ...patch, updatedAt: new Date().toISOString() }, immediate); };
    return {
      id, bind(value: AITaskControls) { controls.set(id, value); emit(); }, state(state: AITaskRecord['state']) { const record = byId.get(id); update({ state: state === 'paused' && record?.items.some(item => item.state === 'running') ? 'pausing' : state }, true); }, metadata(patch: TaskMetadata) { update(patch); }, phase(phase: AITaskPhase) { update({ phase }); }, providerOutcome(providerOutcome: ProviderOutcome, failureCode?: string) { update({ providerOutcome, ...(failureCode ? { failureCode } : {}) }, true); }, commit(status: CommitStatus, failureCode?: string) { update({ commitStatus: status, ...(status === 'conflict' ? { phase: 'committing' } : {}), ...(failureCode ? { failureCode } : {}) }, true); }, progress(done: number, total: number, phase?: string) { update({ progress: { done, total }, ...(phase ? { phase } : {}) }); }, error(error: unknown) { update({ error: taskError(error) }, true); },
      item(itemId: string, itemState: AITaskRecord['items'][number]['state'], error?: unknown, phase?: string) { const record = byId.get(id); if (!record) return; const nextItems = record.items.map(item => item.id === itemId ? { ...item, state: itemState, ...(error !== undefined ? { error: taskError(error) } : {}), ...(phase ? { phase } : {}) } : item); const paused = ['paused', 'pausing'].includes(record.state) && !nextItems.some(item => item.state === 'running'); update({ items: nextItems, ...(paused ? { state: 'paused' as const } : {}) }, paused || itemState === 'complete' || itemState === 'failed'); },
      itemExecution(itemId: string, patch: Partial<Pick<AITaskRecord['items'][number], 'phase' | 'providerOutcome' | 'commitStatus' | 'failureCode' | 'requestId' | 'warning' | 'recovery' | 'validationStatus'>>) {
        const record = byId.get(id); if (!record) return;
        const items = record.items.map(item => item.id === itemId ? { ...item, ...patch } : item);
        const outcomes = items.map(item => item.providerOutcome);
        const providerOutcome: ProviderOutcome = outcomes.includes('unknown') ? 'unknown' : outcomes.includes('in_flight') ? 'in_flight'
          : outcomes.includes('failed') ? 'failed' : outcomes.includes('succeeded') ? 'succeeded' : record.providerOutcome ?? 'not_started';
        const failedItem = items.find(item => item.providerOutcome === 'failed');
        const failureCode = record.commitStatus === 'failed' || record.commitStatus === 'conflict' ? record.failureCode
          : providerOutcome === 'unknown' ? 'unknown_provider_outcome' : failedItem?.failureCode;
        const activePhases=items.filter(item=>item.state==='running').map(item=>item.phase);
        const phase=['generating','initializing','cleanup','queue_wait'].find(value=>activePhases.includes(value));
        update({ items, providerOutcome, failureCode,...(phase&&record.phase!=='committing'?{phase}:{}) }, !!patch.providerOutcome || !!patch.commitStatus);
      },
      finish(state?: AITaskRecord['state']) { controls.delete(id); const record = byId.get(id); if (!record) return; const next = state ?? (record.state === 'stopping' ? 'canceled' : record.items.some(item => ['pending', 'running'].includes(item.state)) ? 'interrupted' : record.items.some(item => item.state === 'canceled' || item.state === 'failed') ? record.items.some(item => item.state === 'complete') ? 'partial' : record.items.some(item => item.state === 'failed') ? 'failed' : 'canceled' : 'complete'); update({ state: next, endedAt: new Date().toISOString(), items: record.items.map(item => ({ ...item, state: item.state === 'running' || (next === 'canceled' && item.state === 'pending') ? next === 'canceled' ? 'canceled' : 'pending' : item.state })) }, true); },
    };
  },
};
