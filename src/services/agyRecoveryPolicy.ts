import type { AITaskRecord } from './aiTaskJournal';
import type { AgyRecoveryRecord } from '../types/agy';
const confirmedCalls = new Set<string>();
export const wasAgyRetryConfirmed = (id: string) => confirmedCalls.has(id);
export const confirmAgyRetry = (id: string) => { confirmedCalls.add(id); };

export function reconcileAgyTask(task: AITaskRecord, calls: AgyRecoveryRecord[] = []): AITaskRecord {
  const related = calls.filter(call => call.taskId === task.id);
  if (task.location === 'server' || task.executor !== 'agy-device' && task.config?.provider !== 'agy-cli' && !related.length) return task;
  const wasActive = ['queued', 'running', 'pausing', 'stopping', 'committing'].includes(task.state);
  const sourceItems = [...task.items];
  for (const call of related) if (call.itemId && !sourceItems.some(item => item.id === call.itemId || item.requestId === call.requestId)) {
    sourceItems.push({ id: call.itemId, label: call.step ?? call.itemId, state: call.receipt === 'consumed' ? 'complete' : 'pending', requestId: call.requestId });
  }
  const items = sourceItems.map(item => {
    const call = related.find(call => call.requestId === item.requestId) ?? [...related].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .find(call => call.itemId === item.id || !call.itemId && sourceItems.length === 1);
    // Legacy running journals cannot prove that a prompt was never sent. Only
    // the durable main-process record can provide that proof after a crash.
    const unknown = item.providerOutcome === 'in_flight' || wasActive && item.state === 'running'
      && !['succeeded', 'failed', 'unknown'].includes(item.providerOutcome ?? '');
    const providerOutcome = call?.providerOutcome ?? (unknown ? 'unknown' : item.providerOutcome);
    return { ...item, ...(providerOutcome ? { providerOutcome } : {}),
      ...(call?.receipt === 'consumed' ? { state: 'complete' as const, recovery: undefined, commitStatus: 'saved' as const, error: undefined } : {}),
      ...(call?.recoverable ? { recovery: { requestId: call.requestId, digest: call.resultDigest }, commitStatus: 'pending' as const } : {}),
      ...(providerOutcome === 'unknown' ? { failureCode: 'unknown_provider_outcome' } : {}) };
  });
  const uncertain = items.some(item => item.providerOutcome === 'unknown') || !items.some(item => item.providerOutcome)
    && (related.some(call => call.providerOutcome === 'unknown') || task.providerOutcome === 'in_flight' || wasActive && task.providerOutcome === undefined);
  return { ...task, executor: 'agy-device', items, ...(uncertain ? { providerOutcome: 'unknown', capabilities: { pause: false, cancel: false, resume: 'new-provider-call' }, failureCode: 'unknown_provider_outcome' } : related.length ? { providerOutcome: items.some(item => item.providerOutcome === 'succeeded') ? 'succeeded' : items.every(item => item.providerOutcome === 'not_started') ? 'not_started' : 'failed',
    capabilities: { pause: false, cancel: false, resume: 'safe' }, failureCode: undefined } : {}),
    ...(items.some(item => item.recovery) ? { commitStatus: 'failed' } : related.length && items.length && items.every(item => item.state === 'complete')
      ? { state: 'complete', commitStatus: 'saved', error: undefined } : {}) };
}

export function taskRecoveryNeedsConfirmation(task: AITaskRecord, selectedIds?: string[]): boolean {
  const selected = task.items.filter(item => (!selectedIds || selectedIds.includes(item.id)) && item.state !== 'complete' && !item.recovery);
  if (selected.some(item => ['unknown', 'in_flight'].includes(item.providerOutcome ?? ''))) return true;
  if (!selected.length) return false;
  return !selected.some(item => item.providerOutcome) && (['unknown', 'in_flight'].includes(task.providerOutcome ?? '') || task.capabilities?.resume === 'new-provider-call');
}
export function confirmTaskRecovery(task: AITaskRecord, chinese: boolean, selectedIds?: string[]): boolean {
  const allowed = !taskRecoveryNeedsConfirmation(task, selectedIds) || window.confirm(chinese
    ? '上次模型调用结果未知，可能已经计费。继续将发起新的模型调用，是否继续？'
    : 'The previous provider call may already have been billed. Continuing starts a new provider call. Continue?');
  if (allowed) for (const item of task.items.filter(item => !selectedIds || selectedIds.includes(item.id))) {
    if (item.requestId) confirmedCalls.add(item.requestId);
  }
  return allowed;
}
