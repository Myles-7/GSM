import type { AIConfig } from '../types';
import { aiTaskJournal, type AITaskKind, type TaskMetadata } from './aiTaskJournal';
import { agyProfileIdentity } from './agyProfiles';
import type { AgyFeature } from '../types/agy';
import { bindTaskSignal, taskForSignal } from '../utils/taskSignals';
export { bindTaskSignal, taskForSignal, inheritTaskSignal } from '../utils/taskSignals';

export type TaskHandle = ReturnType<typeof aiTaskJournal.begin>;
export function taskConfigSnapshot(config: AIConfig, feature?: AgyFeature) {
  if (config.provider === 'agy-cli' && config.agyRequestProfile) return { ...config.agyRequestProfile, provider: 'agy-cli' };
  const resolvedFeature = feature ?? (config.provider === 'agy-cli' ? config.agyFeature : undefined);
  const profile = resolvedFeature ? agyProfileIdentity(config, resolvedFeature) : { model: config.model, effort: config.provider === 'agy-cli' ? config.agyEffort : config.reasoningEffort };
  return { ...profile, provider: config.provider ?? 'http', timeoutSeconds: config.provider === 'agy-cli'
    ? (resolvedFeature ? config.agyFeatureOverrides?.[resolvedFeature]?.timeoutSeconds : undefined) ?? config.agyTimeoutSeconds : undefined };
}
export interface TaskRetryParameters { model?: string; effort?: 'low' | 'medium' | 'high' | 'max'; timeoutSeconds?: number; }
export const featureForTask: Partial<Record<AITaskKind, AgyFeature>> = { summary: 'repository-summary', details: 'repository-details',
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
    { ...input.metadata, ...(input.config ? { config: taskConfigSnapshot(input.config) } : {}) });
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
