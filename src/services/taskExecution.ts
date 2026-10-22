import type { AIConfig } from '../types';
import { aiTaskJournal, type AITaskKind, type TaskMetadata } from './aiTaskJournal';
import { agyProfileIdentity } from './agyProfiles';
import type { AgyFeature } from '../types/agy';
import { bindTaskSignal, taskForSignal } from '../utils/taskSignals';
import { flushAppStorePersistence } from '../store/persistence/storage';
export { bindTaskSignal, taskForSignal, inheritTaskSignal, bindTaskItemSignal, taskItemForSignal } from '../utils/taskSignals';

export type TaskHandle = ReturnType<typeof aiTaskJournal.begin>;
export interface LocalTaskCommitOptions {
  /** Additional local durability barrier that must finish before the task is marked saved. */
  durabilityBarrier?: () => Promise<void>;
  failureCode?: string;
}
/** Confirm local writes once per batch, independently of any later server sync. */
export async function confirmLocalTaskCommit(task: TaskHandle | null, options: LocalTaskCommitOptions = {}): Promise<boolean> {
  const started = performance.now();
  try {
    task?.phase('committing');
    await flushAppStorePersistence();
    await options.durabilityBarrier?.();
    task?.commit('saved');
    const record = aiTaskJournal.snapshot().find(item => item.id === task?.id);
    record?.items.filter(item => item.state === 'complete').forEach(item => task?.itemExecution(item.id, { commitStatus: 'saved' }));
    return true;
  } catch (error) {
    task?.commit('failed', options.failureCode ?? 'LOCAL_PERSISTENCE_FAILED');
    task?.error(error);
    return false;
  } finally {
    if (task) {
      const usage = { ...aiTaskJournal.snapshot().find(record => record.id === task.id)?.usage };
      usage.phase_committing_ms = (usage.phase_committing_ms ?? 0) + Math.max(0, performance.now() - started);
      task.metadata({ usage });
    }
  }
}
export function taskConfigSnapshot(config: AIConfig, feature?: AgyFeature) {
  if (config.provider === 'agy-cli' && config.agyRequestProfile) return { ...config.agyRequestProfile, provider: 'agy-cli' };
  const resolvedFeature = feature ?? (config.provider === 'agy-cli' ? config.agyFeature : undefined);
  const profile = resolvedFeature ? agyProfileIdentity(config, resolvedFeature) : { model: config.model, effort: config.provider === 'agy-cli' ? config.agyEffort : config.reasoningEffort };
  return { ...profile, provider: config.provider ?? 'http', timeoutSeconds: config.provider === 'agy-cli'
    ? (resolvedFeature ? config.agyFeatureOverrides?.[resolvedFeature]?.timeoutSeconds : undefined) ?? config.agyTimeoutSeconds : undefined };
}
export interface TaskRetryParameters { model?: string; effort?: 'low' | 'medium' | 'high' | 'max'; timeoutSeconds?: number; }
export const featureForTask: Partial<Record<AITaskKind, AgyFeature>> = { summary: 'repository-summary', details: 'repository-details',
  exploration: 'organization',
  gists: 'gist-summary', 'discovery-analysis': 'repository-details', discovery: 'discovery', chat: 'repository-chat', research: 'workbench',
  organization: 'organization', release: 'release-summary', plugins: 'plugin', search: 'repository-rerank' };
export function retryTaskConfig(current: AIConfig, previous: import('./aiTaskJournal').AITaskRecord, parameters?: TaskRetryParameters): AIConfig {
  const same = current.id === previous.configId && (current.provider ?? 'http') === previous.config?.provider;
  const fallback = taskConfigSnapshot(current, featureForTask[previous.kind]);
  const model = parameters?.model ?? (same ? previous.config?.model : undefined) ?? fallback.model;
  if (current.provider !== 'agy-cli') return { ...current, model };
  const effort = parameters?.effort ?? (same && ['low', 'medium', 'high', 'max'].includes(previous.config?.effort ?? '') ? previous.config!.effort as typeof current.agyEffort : fallback.effort as typeof current.agyEffort);
  const timeoutSeconds = parameters?.timeoutSeconds ?? (same ? previous.config?.timeoutSeconds : undefined) ?? fallback.timeoutSeconds ?? 180;
  return { ...current, model, agyEffort: effort, agyRequestProfile: { model, effort, timeoutSeconds } };
}
export async function runTrackedTask<T>(input: {
  owner: string; kind: AITaskKind; label: string; signal?: AbortSignal; config?: AIConfig; metadata?: TaskMetadata;
}, action: (signal: AbortSignal, task: TaskHandle) => Promise<T>): Promise<T> {
  const parent = taskForSignal(input.signal);
  if (parent && input.signal) return action(input.signal, parent);
  const controller = new AbortController();
  const task = aiTaskJournal.begin(input.owner, input.kind, [{ id: 'operation', label: input.label }], input.config?.id, undefined,
    { ...input.metadata, ...(input.config ? { config: taskConfigSnapshot(input.config), ...(input.config.provider === 'agy-cli' ? {executor:'agy-device' as const} : {}) } : {}) });
  bindTaskSignal(controller.signal, task);
  const abort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener('abort', abort, { once: true });
  if (input.signal?.aborted) abort();
  task.bind({ stop: () => controller.abort() }); task.item('operation', 'running');
  try {
    controller.signal.throwIfAborted();
    const result = await action(controller.signal, task);
    controller.signal.throwIfAborted();
    task.item('operation', 'complete'); task.finish('complete'); return result;
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) task.finish('canceled');
    else { task.item('operation', 'failed', error); task.error(error); task.finish('failed'); }
    throw error;
  } finally { input.signal?.removeEventListener('abort', abort); }
}
