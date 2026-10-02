import { z } from 'zod';

export type AITaskKind = 'summary' | 'details' | 'gists' | 'discovery' | 'discovery-analysis' | 'plugins';
const schema = z.object({
  id: z.string(), owner: z.string(), kind: z.enum(['summary', 'details', 'gists', 'discovery', 'discovery-analysis', 'plugins']), configId: z.string().optional(),
  channelId: z.string().optional(),
  state: z.enum(['running', 'paused', 'complete', 'interrupted']), updatedAt: z.string(),
  items: z.array(z.object({ id: z.string(), label: z.string(),
    state: z.enum(['pending', 'running', 'complete', 'failed']) })).max(10_000),
});
export type AITaskRecord = z.infer<typeof schema>;
export interface AITaskControls { pause?(): void; resume?(): void; stop?(): void; }
const controls = new Map<string, AITaskControls>();
const listeners = new Set<() => void>();
const loaded = new Set<string>();
let records: AITaskRecord[] = [];
let hosts = 0;
const key = (owner: string) => `gsm:ai-task-journal:${encodeURIComponent(owner)}`;
const publish = (record: AITaskRecord) => {
  records = [...records.filter(item => item.id !== record.id), record].slice(-60);
  try { localStorage.setItem(key(record.owner), JSON.stringify(records.filter(item => item.owner === record.owner).slice(-20))); } catch { /* Memory progress remains available. */ }
  listeners.forEach(listener => listener());
};

export const aiTaskJournal = {
  attachHost() { hosts++; return () => { hosts--; }; },
  hasHost: () => hosts > 0,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  snapshot: () => records,
  load(owner: string) {
    if (!owner || loaded.has(owner)) return;
    loaded.add(owner);
    try {
      const saved = z.array(schema).max(20).parse(JSON.parse(localStorage.getItem(key(owner)) ?? '[]'));
      records = [...records, ...saved.filter(item => item.owner === owner && !records.some(current => current.id === item.id))
        .map(item => ({ ...item, state: item.state === 'complete' ? 'complete' as const : 'interrupted' as const,
          items: item.items.map(entry => ({ ...entry, state: entry.state === 'running' ? 'pending' as const : entry.state })) }))];
      listeners.forEach(listener => listener());
    } catch { /* Invalid checkpoints must not start work. */ }
  },
  control(id: string, action: keyof AITaskControls) { controls.get(id)?.[action]?.(); },
  supports(id: string, action: keyof AITaskControls) { return !!controls.get(id)?.[action]; },
  live(id: string) { return controls.has(id); },
  busy(owner: string, kind: AITaskKind) { return records.some(item => item.owner === owner && item.kind === kind && controls.has(item.id)); },
  stopOwner(owner: string) {
    for (const record of records) if (record.owner === owner) controls.get(record.id)?.stop?.();
  },
  begin(owner: string, kind: AITaskKind, items: { id: string; label: string }[], configId?: string, channelId?: string) {
    let record: AITaskRecord = { id: crypto.randomUUID(), owner, kind, configId, channelId, state: 'running',
      updatedAt: new Date().toISOString(), items: items.map(item => ({ ...item, state: 'pending' })) };
    const update = (patch: Partial<AITaskRecord>) => {
      record = { ...record, ...patch, updatedAt: new Date().toISOString() }; publish(record);
    };
    publish(record);
    return {
      id: record.id,
      bind(value: AITaskControls) { controls.set(record.id, value); },
      state(state: AITaskRecord['state']) { update({ state }); },
      item(id: string, state: AITaskRecord['items'][number]['state']) {
        update({ items: record.items.map(item => item.id === id ? { ...item, state } : item) });
      },
      finish() {
        controls.delete(record.id);
        update({ state: record.items.some(item => item.state === 'pending' || item.state === 'running') ? 'interrupted' : 'complete',
          items: record.items.map(item => ({ ...item, state: item.state === 'running' ? 'pending' : item.state })) });
      },
    };
  },
};
