import type { AgyAIConfig } from '../types';
import type { AgyDesktopAPI, AgyDeviceState } from '../types/agy';
import { useAppStore } from '../store/useAppStore';
import { AGY_CONFIG_ID, isAgyConfig } from '../utils/aiConfig';
import './electronProxy';
import { taskForSignal } from './taskExecution';

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
    sessionReady = api.setSession(session);
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
}): Promise<string> {
  const api = window.electronAPI?.agy;
  if (!api || !config.deviceBound || !config.isActive) throw new Error('AGY_DISABLED');
  if (options.signal?.aborted) throw new DOMException('Canceled', 'AbortError');
  bindSession(api);
  const ownedSession = session;
  await sessionReady;
  if (session !== ownedSession || options.signal?.aborted) throw new DOMException('Canceled', 'AbortError');
  const requestId = crypto.randomUUID();
  // This is a character ceiling, not a claim that CLI supports HTTP token limits.
  const maxChars = Math.min(192_000, Math.max(4_000, (options.maxTokens ?? 4_000) * 8));
  let receivedChars = 0;
  let overLimit = false;
  const stop = () => { void api.cancel(requestId).catch(() => {}); };
  const off = api.onEvent(event => {
    if (event.session === ownedSession && session === ownedSession && event.requestId === requestId && !options.signal?.aborted) {
      if (event.type === 'scheduler') setScheduler(event.pool);
      if (event.type === 'queued' && Number.isInteger(event.position) && event.position! > 0) {
        taskForSignal(options.signal)?.metadata({ phase: `AGY ${useAppStore.getState().language.startsWith('zh') ? '等待位置' : 'queue position'} ${event.position}` });
        queuePositions.set(requestId, { position: event.position!, taskId: taskForSignal(options.signal)?.id }); notifyQueue();
      } else if (event.type === 'running') { queuePositions.delete(requestId); notifyQueue(); }
    }
    if (event.session === ownedSession && session === ownedSession && event.requestId === requestId &&
        !options.signal?.aborted && event.type === 'text' && typeof event.text === 'string') {
      receivedChars += event.text.length;
      if (receivedChars > maxChars) { overLimit = true; stop(); }
      else options.onChunk?.(event.text);
    }
  });
  options.signal?.addEventListener('abort', stop, { once: true });
  try {
    const pending = api.start(requestId, ownedSession, {
      system: `${options.system}\nApplication output ceiling: ${maxChars} characters. Stay within it without dropping requested requirements. Return a complete result, never truncated JSON.`,
      user: options.user, model: config.model, effort: config.agyEffort,
      profileOverride: config.agyRequestProfile,
      feature: config.agyFeature ?? options.feature ?? 'other', revision: config.agyRevision, priority: config.agyPriority ?? 'interactive',
    });
    if (options.signal?.aborted) stop();
    const result = await pending;
    if (overLimit || (result.ok && result.value.text.length > maxChars)) throw new Error('AGY_OUTPUT_LIMIT');
    if (options.signal?.aborted || session !== ownedSession) throw new DOMException('Canceled', 'AbortError');
    const live = useAppStore.getState().aiConfigs.find(item => item.id === config.id);
    if (live && isAgyConfig(live) && !live.isActive) throw new DOMException('Configuration changed', 'AbortError');
    if (!result.ok) {
      if (['CANCELED', 'SESSION_CHANGED'].includes(result.code)) throw new DOMException('Canceled', 'AbortError');
      throw new Error(`AGY_${result.code}`);
    }
    const task = taskForSignal(options.signal);
    if (task) {
      const previous = import('./aiTaskJournal').then(({ aiTaskJournal }) => {
        const usage = { ...aiTaskJournal.snapshot().find(record => record.id === task.id)?.usage };
        for (const [key, value] of Object.entries(result.value.usage)) if (Number.isFinite(value)) usage[key] = (usage[key] ?? 0) + value;
        task.metadata({ usage });
      });
      await previous;
    }
    return result.value.text;
  } finally {
    queuePositions.delete(requestId); notifyQueue();
    off();
    options.signal?.removeEventListener('abort', stop);
  }
}
