import { z } from 'zod';
import { indexedDBStorage } from './indexedDbStorage';

export const TASK_KINDS = ['summary', 'details', 'gists', 'discovery', 'discovery-analysis', 'plugins', 'organization', 'release', 'search', 'chat', 'research', 'index', 'refresh', 'sync', 'import', 'export', 'backup', 'restore'] as const;
export type AITaskKind = typeof TASK_KINDS[number];
const states = ['queued', 'running', 'pausing', 'paused', 'stopping', 'canceled', 'complete', 'partial', 'failed', 'interrupted', 'unconfirmed', 'committing'] as const;
const schema = z.object({
  id: z.string(), owner: z.string(), kind: z.enum(TASK_KINDS), configId: z.string().optional(), channelId: z.string().optional(),
  state: z.enum(states), updatedAt: z.string(), createdAt: z.string().optional(), startedAt: z.string().optional(), endedAt: z.string().optional(),
  title: z.string().optional(), phase: z.string().optional(), error: z.string().optional(), archived: z.boolean().optional(),
  connectionError: z.string().optional(), lastServerCheckAt: z.string().optional(),
  trigger: z.enum(['manual', 'automatic']).optional(), location: z.enum(['device', 'server']).optional(),
  parentId: z.string().optional(), remoteId: z.string().optional(),
  config: z.object({ model: z.string().optional(), provider: z.string().optional(), effort: z.string().optional(), timeoutSeconds: z.number().optional() }).optional(),
  target: z.object({ view: z.string(), id: z.string().optional(), tab: z.string().optional() }).optional(),
  progress: z.object({ done: z.number(), total: z.number() }).optional(), usage: z.record(z.string(), z.number()).optional(),
  items: z.array(z.object({ id: z.string(), label: z.string(), error: z.string().optional(), phase: z.string().optional(), state: z.enum(['pending', 'running', 'complete', 'failed', 'canceled']) })),
});
export type AITaskRecord = z.infer<typeof schema>;
export interface AITaskControls { pause?(): void; resume?(): void; stop?(): void; }
export type TaskMetadata = Partial<Pick<AITaskRecord, 'title' | 'phase' | 'trigger' | 'location' | 'parentId' | 'remoteId' | 'config' | 'target' | 'usage'>>;
const controls = new Map<string, AITaskControls>();
const listeners = new Set<() => void>();
const loaded = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const writes = new Map<string, Promise<void>>();
let records: AITaskRecord[] = [];
let hosts = 0;
let storageError = '';
const deletedRemote = new Set<string>();
const key = (owner: string) => `gsm:ai-task-journal:${encodeURIComponent(owner)}`;
const emit = () => listeners.forEach(listener => listener());
export const taskNeedsAttention = (task: AITaskRecord) => !!task.connectionError || ['failed', 'partial', 'interrupted', 'unconfirmed'].includes(task.state)
  || (task.state === 'complete' && task.items.some(item => item.state === 'failed'));
export const taskIsTerminal = (task: AITaskRecord) => ['complete', 'partial', 'failed', 'canceled', 'interrupted', 'unconfirmed'].includes(task.state);
export const taskDisplayState = (task: AITaskRecord): AITaskRecord['state'] => ['complete', 'failed'].includes(task.state) && task.items.some(item => item.state === 'failed')
  ? task.items.some(item => item.state === 'complete') ? 'partial' : 'failed' : task.state;
const retained = (task: AITaskRecord) => task.archived || taskNeedsAttention(task) || !taskIsTerminal(task)
  || !Number.isFinite(Date.parse(task.endedAt ?? task.updatedAt)) || Date.now() - Date.parse(task.endedAt ?? task.updatedAt) < 30 * 86400000;

export function taskError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[endpoint]')
    .replace(/[A-Za-z]:[\\/][^\n\r"<>]+/g, '[local path]').slice(0, 1000);
}
function persist(owner: string, immediate = false) {
  if (timers.has(owner)) clearTimeout(timers.get(owner));
  const save = () => {
    timers.delete(owner);
    records = records.filter(item => item.owner !== owner || retained(item));
    const text = JSON.stringify(records.filter(item => item.owner === owner));
    const pending = (writes.get(owner) ?? Promise.resolve()).then(() => indexedDBStorage.setItem(key(owner), text)).then(() => {}, () => {
      storageError = 'TASK_STORAGE_FAILED'; emit();
    });
    writes.set(owner, pending);
  };
  if (immediate) save(); else timers.set(owner, setTimeout(save, 250));
}
function publish(record: AITaskRecord, immediate = false) {
  const index = records.findIndex(item => item.id === record.id);
  records = index < 0 ? [...records, record] : records.map((item, i) => i === index ? record : item);
  persist(record.owner, immediate); emit();
}
function mergeSaved(owner: string, raw: string | null) {
  if (!raw) return;
  const parsed = z.array(z.unknown()).safeParse(JSON.parse(raw));
  if (!parsed.success) return;
  const saved = parsed.data.flatMap(value => {
    const result = schema.safeParse(value);
    if (!result.success || result.data.owner !== owner) return [];
    const item = result.data;
    if (!retained(item) || records.some(current => current.id === item.id)) return [];
    return [{ ...item, state: item.location === 'server' || taskIsTerminal(item) ? item.state : 'interrupted' as const,
      items: item.items.map(entry => ({ ...entry, state: entry.state === 'running' && item.location !== 'server' ? 'pending' as const : entry.state })) }];
  });
  records = [...records, ...saved]; emit();
}

export const aiTaskJournal = {
  attachHost() { hosts++; return () => { hosts--; }; },
  hasHost: () => hosts > 0,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  snapshot: () => records,
  project(record: AITaskRecord) { if (!deletedRemote.has(record.id)) publish(schema.parse(record)); },
  hiddenRemote(id: string) { return deletedRemote.has(id); },
  bind(id: string, value: AITaskControls) { controls.set(id, value); emit(); },
  unbind(id: string) { if (controls.delete(id)) emit(); },
  storageError: () => storageError,
  load(owner: string) {
    if (!owner || loaded.has(owner)) return Promise.resolve();
    loaded.add(owner);
    let legacy: string | null = null;
    try { legacy = localStorage.getItem(key(owner)); } catch { storageError = 'TASK_STORAGE_INVALID'; emit(); }
    return Promise.resolve(indexedDBStorage.getItem(key(owner))).then(raw => {
      // IndexedDB is authoritative; legacy records only fill missing IDs.
      for (const saved of [raw, legacy]) {
        try { mergeSaved(owner, saved); } catch { storageError = 'TASK_STORAGE_INVALID'; emit(); }
      }
    }).then(async () => {
      const tombstones = await indexedDBStorage.getItem(`${key(owner)}:hidden`);
      try { for (const id of z.array(z.string()).parse(JSON.parse(tombstones ?? '[]'))) deletedRemote.add(id); } catch { /* Old storage has no server tombstones. */ }
      records = records.filter(task => !deletedRemote.has(task.id)); emit();
      persist(owner, true);
      await writes.get(owner);
      if (legacy && !storageError) localStorage.removeItem(key(owner));
    }).catch(() => { storageError = 'TASK_STORAGE_FAILED'; emit(); });
  },
  flush(owner: string) { persist(owner, true); return writes.get(owner) ?? Promise.resolve(); },
  control(id: string, action: keyof AITaskControls) {
    const task = records.find(item => item.id === id), handler = controls.get(id)?.[action];
    if (!task || !handler || task.state === 'committing' || task.state === 'stopping'
      || (action === 'pause' && !['running', 'queued'].includes(task.state))
      || (action === 'resume' && !['paused', 'pausing', 'interrupted', 'unconfirmed'].includes(task.state))) return;
    publish({ ...task, state: action === 'stop' ? 'stopping' : action === 'pause' ? 'pausing' : 'running', updatedAt: new Date().toISOString() }, true);
    handler();
  },
  supports(id: string, action: keyof AITaskControls) { return !!controls.get(id)?.[action] && records.find(item => item.id === id)?.state !== 'committing'; },
  live(id: string) { return controls.has(id); },
  busy(owner: string, kind: AITaskKind) { return records.some(item => item.owner === owner && item.kind === kind && controls.has(item.id)); },
  stopOwner(owner: string) { for (const record of records) if (record.owner === owner && record.location !== 'server') aiTaskJournal.control(record.id, 'stop'); },
  archive(ids: string[], value: boolean) {
    const owners = new Set<string>();
    records = records.map(task => ids.includes(task.id) && taskIsTerminal(task) && !controls.has(task.id)
      ? (owners.add(task.owner), { ...task, archived: value }) : task);
    owners.forEach(owner => persist(owner, true)); emit();
  },
  remove(ids: string[]) {
    const owners = new Set<string>();
    records = records.filter(task => {
      if (!ids.includes(task.id) || !taskIsTerminal(task) || controls.has(task.id)) return true;
      if (task.location === 'server') deletedRemote.add(task.id);
      owners.add(task.owner); return false;
    });
    owners.forEach(owner => persist(owner, true)); emit();
    owners.forEach(owner => { void Promise.resolve(indexedDBStorage.setItem(`${key(owner)}:hidden`, JSON.stringify([...deletedRemote]))).catch(() => { storageError = 'TASK_STORAGE_FAILED'; emit(); }); });
  },
  patch(id: string, patch: Partial<AITaskRecord>) {
    const record = records.find(item => item.id === id);
    if (record) publish({ ...record, ...patch, id: record.id, owner: record.owner, updatedAt: new Date().toISOString() }, true);
  },
  begin(owner: string, kind: AITaskKind, items: { id: string; label: string }[], configId?: string, channelId?: string, metadata: TaskMetadata = {}) {
    const at = new Date().toISOString(), id = crypto.randomUUID();
    publish({ id, owner, kind, configId, channelId, state: 'running', createdAt: at, startedAt: at, updatedAt: at,
      trigger: 'manual', location: 'device', ...metadata, items: items.map(item => ({ ...item, state: 'pending' })) });
    const update = (patch: Partial<AITaskRecord>, immediate = false) => {
      const record = records.find(item => item.id === id);
      if (record && !record.endedAt) publish({ ...record, ...patch, updatedAt: new Date().toISOString() }, immediate);
    };
    return {
      id,
      bind(value: AITaskControls) { controls.set(id, value); emit(); },
      state(state: AITaskRecord['state']) {
        const record = records.find(item => item.id === id);
        update({ state: state === 'paused' && record?.items.some(item => item.state === 'running') ? 'pausing' : state }, true);
      },
      metadata(patch: TaskMetadata) { update(patch); },
      progress(done: number, total: number, phase?: string) { update({ progress: { done, total }, ...(phase ? { phase } : {}) }); },
      error(error: unknown) { update({ error: taskError(error) }, true); },
      item(itemId: string, state: AITaskRecord['items'][number]['state'], error?: unknown, phase?: string) {
        const record = records.find(item => item.id === id);
        if (!record) return;
        const items = record.items.map(item => item.id === itemId ? { ...item, state, ...(error !== undefined ? { error: taskError(error) } : {}), ...(phase ? { phase } : {}) } : item);
        const paused = ['paused', 'pausing'].includes(record.state) && !items.some(item => item.state === 'running');
        update({ items, ...(paused ? { state: 'paused' as const } : {}) }, paused || state === 'complete' || state === 'failed');
      },
      finish(state?: AITaskRecord['state']) {
        controls.delete(id);
        const record = records.find(item => item.id === id);
        if (!record) return;
        const next = state ?? (record.state === 'stopping' ? 'canceled' : record.items.some(item => ['pending', 'running'].includes(item.state)) ? 'interrupted'
          : record.items.some(item => item.state === 'canceled' || item.state === 'failed')
            ? record.items.some(item => item.state === 'complete') ? 'partial' : record.items.some(item => item.state === 'failed') ? 'failed' : 'canceled' : 'complete');
        update({ state: next, endedAt: new Date().toISOString(), items: record.items.map(item => ({ ...item,
          state: item.state === 'running' || (next === 'canceled' && item.state === 'pending') ? next === 'canceled' ? 'canceled' : 'pending' : item.state })) }, true);
      },
    };
  },
};
