import type { AgyAIConfig } from '../types';
import type { AgyDesktopAPI, AgyDeviceState, AgyRecoveryIssue, AgyRecoveryRecord, AgyRecoveryRepairAction } from '../types/agy';
import { useAppStore } from '../store/useAppStore';
import { AGY_CONFIG_ID, isAgyConfig } from '../utils/aiConfig';
import './electronProxy';
import { taskForSignal, taskItemForSignal } from './taskExecution';
import { aiTaskJournal, type ProviderOutcome } from './aiTaskJournal';

let bridge: AgyDesktopAPI | undefined;
let session = '';
let sessionReady: Promise<void> = Promise.resolve();
let unsubscribe: (() => void) | undefined;
let scheduler: AgyDeviceState['pool'];
const schedulerListeners = new Set<() => void>();
export const agySchedulerStatus = {
  snapshot: () => scheduler,
  subscribe(listener: () => void) { schedulerListeners.add(listener); return () => { schedulerListeners.delete(listener); }; },
};
const setScheduler = (pool: AgyDeviceState['pool']) => { scheduler = pool; schedulerListeners.forEach(listener => listener()); };
const queuePositions = new Map<string, { position: number; taskId?: string }>();
const queueListeners = new Set<() => void>();
const notifyQueue = () => queueListeners.forEach(listener => listener());
export const agyQueueStatus = {
  subscribe(listener: () => void) { queueListeners.add(listener); return () => { queueListeners.delete(listener); }; },
  snapshot: (taskId?: string) => Math.min(...[...queuePositions.values()].filter(item => !taskId || item.taskId === taskId).map(item => item.position), Infinity),
};

function bindSession(api: AgyDesktopAPI) {
  if (bridge === api) return;
  unsubscribe?.();
  bridge = api;
  const renew = () => {
    setScheduler(undefined);
    queuePositions.clear(); notifyQueue();
    session = crypto.randomUUID();
    sessionReady = api.setSession(session, useAppStore.getState().user ? String(useAppStore.getState().user!.id) : undefined);
    void sessionReady.catch(() => {});
  };
  renew();
  unsubscribe = useAppStore.subscribe((next, previous) => {
    const before = previous.aiConfigs.find(item => item.id === configId(previous.activeAIConfig));
    const after = next.aiConfigs.find(item => item.id === configId(next.activeAIConfig));
    const providerChanged = before && after && isAgyConfig(before) && isAgyConfig(after)
      && before.isActive !== after.isActive;
    if (next.user?.id !== previous.user?.id || next.githubToken !== previous.githubToken ||
        next.activeAIConfig !== previous.activeAIConfig || providerChanged) renew();
  });
}

const configId = (active: string | null) => active ?? AGY_CONFIG_ID;

export function applyAgyDeviceState(device: AgyDeviceState): void {
  setScheduler(device.pool);
  const store = useAppStore.getState();
  const config: AgyAIConfig = {
    id: AGY_CONFIG_ID, name: 'AGY CLI', provider: 'agy-cli', model: device.prefs.model,
    agyEffort: device.prefs.effort, agyMode: device.prefs.mode,
    deviceBound: !!device.executable, isActive: device.enabled, concurrency: device.prefs.concurrency ?? 5,
    agyRevision: device.revision, agyTimeoutSeconds: device.prefs.timeoutSeconds, agyFeatureOverrides: device.prefs.featureOverrides,
  };
  const old = store.aiConfigs.find(item => item.id === AGY_CONFIG_ID);
  if (JSON.stringify(old) !== JSON.stringify(config)) store.setAIConfigs([
    ...store.aiConfigs.filter(item => item.id !== AGY_CONFIG_ID), config,
  ]);
}

export async function refreshAgyDeviceState(): Promise<void> {
  const api = window.electronAPI?.agy;
  if (!api) return;
  bindSession(api);
  applyAgyDeviceState(await api.getState());
}

export async function generateAgyText(config: AgyAIConfig, options: {
  system: string; user: string; maxTokens?: number; signal?: AbortSignal; onChunk?: (text: string) => void;
  feature?: import('../types/agy').AgyFeature;
  onRequestState?: (state: 'queued' | 'running') => void;
  onLifecycle?: (event: 'initializing' | 'cleanup' | 'warning', code?: string) => void;
  onSent?: () => void;
  recovery?: import('../types/agy').AgyRecoveryOptions;
}): Promise<string> {
  const api = window.electronAPI?.agy;
  if (!api || !config.deviceBound || !config.isActive) throw new Error('AGY_DISABLED');
  if (options.signal?.aborted) throw new DOMException('Canceled', 'AbortError');
  bindSession(api);
  const ownedSession = session;
  await sessionReady;
  if (session !== ownedSession || options.signal?.aborted) throw new DOMException('Canceled', 'AbortError');
  const requestId = options.recovery?.requestId ?? crypto.randomUUID();
  // This is a character ceiling, not a claim that CLI supports HTTP token limits.
  const maxChars = Math.min(192_000, Math.max(4_000, (options.maxTokens ?? 4_000) * 8));
  let receivedChars = 0;
  let overLimit = false;
  let sent = false;
  let succeeded = false;
  const task = taskForSignal(options.signal);
  const itemId = taskItemForSignal(options.signal);
  let phase = 'queue_wait', phaseStarted = performance.now();
  const timings: Record<string, number> = {};
  const enterPhase = (next: 'queue_wait' | 'initializing' | 'generating' | 'cleanup') => {
    const at = performance.now();
    timings[`phase_${phase}_ms`] = (timings[`phase_${phase}_ms`] ?? 0) + Math.max(0, at - phaseStarted);
    phase = next; phaseStarted = at;
    task?.phase(next);
    if (itemId) task?.itemExecution(itemId, { phase: next });
  };
  const outcome = (value:ProviderOutcome, failureCode?:string) => {
    if (itemId && task?.itemExecution) { task.itemExecution(itemId, { providerOutcome: value, failureCode, requestId }); return; }
    // One uncertain item must not be hidden by a healthy sibling completing.
    if(task&&aiTaskJournal.snapshot().find(record=>record.id===task.id)?.providerOutcome!=='unknown')task.providerOutcome(value,failureCode);
  };
  task?.metadata({executor:'agy-device'});task?.phase('queue_wait');
  options.onRequestState?.('queued');
  const stop = () => { void api.cancel(requestId).catch(() => {}); };
  const off = api.onEvent(event => {
    if (event.session === ownedSession && session === ownedSession && event.requestId === requestId && !options.signal?.aborted) {
      if (event.type === 'scheduler') setScheduler(event.pool);
      if (event.type === 'queued' && Number.isInteger(event.position) && event.position! > 0) {
        enterPhase('queue_wait');
        queuePositions.set(requestId, { position: event.position!, taskId: taskForSignal(options.signal)?.id }); notifyQueue();
      } else if (event.type === 'running') { enterPhase(sent ? 'generating' : 'initializing'); options.onRequestState?.('running'); queuePositions.delete(requestId); notifyQueue(); }
      else if (event.type === 'sent') { sent=true;enterPhase('generating');outcome('in_flight');options.onSent?.(); }
      else if (['initializing', 'cleanup', 'warning'].includes(event.type)) {if(event.type!=='warning')enterPhase(event.type as 'initializing' | 'cleanup');
        else if (itemId) task?.itemExecution(itemId, { warning: event.code });
        options.onLifecycle?.(event.type as 'initializing' | 'cleanup' | 'warning', event.code);}
    }
    if (event.session === ownedSession && session === ownedSession && event.requestId === requestId &&
        !options.signal?.aborted && event.type === 'text' && typeof event.text === 'string') {
      receivedChars += event.text.length;
      if (receivedChars > maxChars) { overLimit = true; }
      else options.onChunk?.(event.text);
    }
  });
  options.signal?.addEventListener('abort', stop, { once: true });
  try {
    const request = {
      system: `${options.system}\nApplication output ceiling: ${maxChars} characters. Stay within it without dropping requested requirements. Return a complete result, never truncated JSON.`,
      user: options.user, model: config.model, effort: config.agyEffort,
      profileOverride: config.agyRequestProfile,
      feature: config.agyFeature ?? options.feature ?? 'other', revision: config.agyRevision, priority: config.agyPriority ?? 'interactive',
      taskId: taskForSignal(options.signal)?.id,
      itemId, step: options.recovery?.step, retryOf: options.recovery?.retryOf ?? aiTaskJournal.snapshot()
        .find(record => record.id === aiTaskJournal.snapshot().find(record => record.id === task?.id)?.parentId)?.items.find(item => item.id === itemId)?.requestId,
      recoveryContext: options.recovery?.context,
    };
    if (typeof api.recoveryList === 'function') {
      const owner = String(useAppStore.getState().user?.id ?? '');
      const previous = (await listAgyRecovery(owner)).filter(record => !record.receipt && record.providerOutcome === 'unknown');
      const { wasAgyRetryConfirmed } = await import('./agyRecoveryPolicy');
      for (const record of previous) {
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([
          request.system, request.user, record.profile, request.recoveryContext ?? null,
        ])));
        const hash = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
        if (!(request.step && request.step === record.step) && record.inputDigest !== hash && record.requestId !== request.retryOf) continue;
        if (!wasAgyRetryConfirmed(record.requestId) && !window.confirm(useAppStore.getState().language.startsWith('zh')
          ? '上次模型调用结果未知，可能已经计费。继续将发起新的模型调用，是否继续？'
          : 'The previous provider call may already have been billed. Start a new provider call?')) throw new DOMException('Canceled', 'AbortError');
        request.retryOf = record.requestId;
        break;
      }
    }
    const assertSession = () => {
      if (session !== ownedSession || options.signal?.aborted) throw new DOMException('Canceled', 'AbortError');
      const live = useAppStore.getState().aiConfigs.find(item => item.id === config.id);
      if (live && isAgyConfig(live) && !live.isActive) throw new DOMException('Configuration changed', 'AbortError');
    };
    assertSession();
    const result = await api.start(requestId, ownedSession, request);
    if (result.ok) {
      succeeded = true; outcome('succeeded');
      if (result.value.recovery) {
        options.recovery?.onResult?.(result.value.recovery);
        if (itemId) task?.itemExecution(itemId, { recovery: { requestId, digest: result.value.recovery.resultDigest }, commitStatus: 'pending' });
      }
    } else if (result.details?.providerOutcome === 'succeeded') {
      succeeded = true; outcome('succeeded', result.code);
    }
    if (overLimit || (result.ok && result.value.text.length > maxChars)) throw new Error('AGY_OUTPUT_LIMIT');
    if (options.signal?.aborted || session !== ownedSession) throw new DOMException('Canceled', 'AbortError');
    const live = useAppStore.getState().aiConfigs.find(item => item.id === config.id);
    if (live && isAgyConfig(live) && !live.isActive) throw new DOMException('Configuration changed', 'AbortError');
    if (!result.ok) {
      if (['CANCELED', 'SESSION_CHANGED'].includes(result.code)) throw new DOMException('Canceled', 'AbortError');
      throw Object.assign(new Error(`AGY_${result.code}`), { details: result.details, retryAfterMs: result.details?.retryAfterMs });
    }
    outcome('succeeded');
    if (!options.recovery?.context && result.value.recovery?.resultDigest && api.recoveryAck) {
      const ack = await api.recoveryAck(ownedSession, requestId, result.value.recovery.resultDigest);
      if (!ack.ok) throw new Error(`AGY_${ack.code}`);
    }
    if (task) {
      const previous = import('./aiTaskJournal').then(({ aiTaskJournal }) => {
        const usage = { ...aiTaskJournal.snapshot().find(record => record.id === task.id)?.usage };
        for (const [key, value] of Object.entries(result.value.usage)) if (Number.isFinite(value)) usage[key] = (usage[key] ?? 0) + value;
        task.metadata({ usage });
      });
      await previous;
    }
    return result.value.text;
  } catch(error) {
    const code=error instanceof Error?error.message:'';
    const unknown=!succeeded&&sent&&!/^AGY_(?:AUTH_REQUIRED|PERMISSION_DENIED|RATE_LIMIT|QUOTA_EXHAUSTED|BUDGET_LIMIT|MODEL_EFFORT_CONFLICT|INVALID_MODEL|INVALID_EFFORT)$/.test(code);
    outcome(succeeded?'succeeded':unknown?'unknown':'failed',unknown?'unknown_provider_outcome':/^AGY_[A-Z_]+$/.test(code)?code:undefined);
    if (succeeded && itemId) task?.itemExecution(itemId, { validationStatus: 'failed', failureCode: code });
    if(unknown)task?.metadata({capabilities:{pause:false,cancel:false,resume:'new-provider-call'}});
    throw error;
  } finally {
    timings[`phase_${phase}_ms`] = (timings[`phase_${phase}_ms`] ?? 0) + Math.max(0, performance.now() - phaseStarted);
    if (task) {
      const usage = { ...aiTaskJournal.snapshot().find(record => record.id === task.id)?.usage };
      for (const [key, value] of Object.entries(timings)) usage[key] = (usage[key] ?? 0) + value;
      task.metadata({ usage });
    }
    queuePositions.delete(requestId); notifyQueue();
    off();
    options.signal?.removeEventListener('abort', stop);
  }
}

export async function agyRecoverySession(owner: string) {
  const api = window.electronAPI?.agy;
  if (!api || String(useAppStore.getState().user?.id ?? '') !== owner) return undefined;
  bindSession(api); const ownedSession = session; await sessionReady;
  if (ownedSession !== session || String(useAppStore.getState().user?.id ?? '') !== owner) throw new Error('AGY_SESSION_CHANGED');
  return { api, session: ownedSession };
}
export async function listAgyRecovery(owner: string) {
  const value = await inspectAgyRecovery(owner);
  if (value.errors.length) throw new Error('AGY_RECOVERY_RECORD_CORRUPT');
  return value.records;
}

export async function inspectAgyRecovery(owner: string): Promise<{ records: AgyRecoveryRecord[]; errors: AgyRecoveryIssue[] }> {
  if (!window.electronAPI?.agy?.recoveryList) return { records: [], errors: [] };
  const bound = await agyRecoverySession(owner); if (!bound?.api.recoveryList) return { records: [], errors: [] };
  const records: AgyRecoveryRecord[] = []; const errors: AgyRecoveryIssue[] = []; let cursor: string | undefined;
  do {
    const result = await bound.api.recoveryList(bound.session, cursor);
    if (!result.ok) throw new Error(`AGY_${result.code}`);
    records.push(...result.value.records);
    for (const issue of result.value.errors) if (!errors.some(current => current.requestId === issue.requestId)) errors.push(issue);
    cursor = result.value.nextCursor;
  } while (cursor);
  return { records, errors };
}
export async function readAgyRecovery(owner: string, requestId: string) {
  const bound = await agyRecoverySession(owner); if (!bound) throw new Error('AGY_SESSION_CHANGED');
  const result = await bound.api.recoveryRead(bound.session, requestId);
  if (!result.ok) throw new Error(`AGY_${result.code}`); return result.value;
}
export async function acknowledgeAgyRecovery(owner: string, requestId: string, digest: string) {
  const bound = await agyRecoverySession(owner); if (!bound) throw new Error('AGY_SESSION_CHANGED');
  const result = await bound.api.recoveryAck(bound.session, requestId, digest);
  if (!result.ok) throw new Error(`AGY_${result.code}`);
  for (const task of aiTaskJournal.snapshot().filter(task => task.owner === owner && task.items.some(item => item.recovery?.requestId === requestId))) {
    const items = task.items.map(item => item.recovery?.requestId === requestId ? { ...item, recovery: undefined, commitStatus: 'saved' as const, state: 'complete' as const, error: undefined } : item);
    aiTaskJournal.patch(task.id, { items, ...(items.every(item => item.state === 'complete') ? { commitStatus: 'saved', state: 'complete', error: undefined } : {}) });
  }
}
export async function discardAgyRecovery(owner: string, requestId: string) {
  const bound = await agyRecoverySession(owner); if (!bound) throw new Error('AGY_SESSION_CHANGED');
  const result = await bound.api.recoveryDiscard(bound.session, requestId);
  if (!result.ok) throw new Error(`AGY_${result.code}`);
  for (const task of aiTaskJournal.snapshot().filter(task => task.owner === owner && task.items.some(item => item.recovery?.requestId === requestId))) {
    aiTaskJournal.patch(task.id, { items: task.items.map(item => item.recovery?.requestId === requestId
      ? { ...item, recovery: undefined, commitStatus: 'not_started', error: 'RESULT_DISCARDED', state: 'canceled' } : item) });
  }
}

export async function repairAgyRecovery(owner: string, requestId: string, action: AgyRecoveryRepairAction) {
  const bound = await agyRecoverySession(owner); if (!bound?.api.recoveryRepair) throw new Error('AGY_RECOVERY_REPAIR_UNAVAILABLE');
  const result = await bound.api.recoveryRepair(bound.session, requestId, action);
  if (!result.ok) throw new Error(`AGY_${result.code}`);
  return result.value;
}
