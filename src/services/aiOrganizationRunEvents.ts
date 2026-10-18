import { indexedDBStorage } from './indexedDbStorage';
import { taskError } from './aiTaskJournal';
import { validateOrganizationResult } from './aiOrganizationResultRecovery';

export interface OrganizationRequestTrace {
  id: string; ownerId: string; proposalId: string; runId: string; key: string; attempt: number;
  model: string; effort?: string; repositoryIds: number[]; inputChars: number;
  state: 'queued' | 'initializing' | 'running' | 'cleanup' | 'received' | 'verified' | 'failed' | 'canceled';
  createdAt: number; startedAt?: number; firstOutputAt?: number; lastOutputAt?: number; endedAt?: number;
  queueMs?: number; initMs?: number; modelMs?: number; cleanupMs?: number;
  output: string; code?: string; originalCode?: string; error?: string; warning?: string;
}
const listeners = new Set<() => void>();
const rows = new Map<string, OrganizationRequestTrace[]>();
const empty: OrganizationRequestTrace[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const writes = new Map<string, Promise<void>>();
const retainedMs = 7 * 86400000;
const byteLength = (value: string) => new TextEncoder().encode(value).length;
export function organizationExcerpt(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  let lower = 0, upper = Math.min(value.length, maxBytes);
  while (lower < upper) { const mid = Math.ceil((lower + upper) / 2); if (byteLength(value.slice(0, mid)) <= maxBytes) lower = mid; else upper = mid - 1; }
  return value.slice(0, lower);
}
export function redactOrganizationOutput(value: string, secrets: string[] = []): string {
  return secrets.filter(Boolean).reduce((text, secret) => text.split(secret).join('[redacted]'), value)
    .replace(/Bearer\s+[^\s"\\]+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|token|secret|password)["']?\s*[=:]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]');
}
const storageKey = (owner: string) => `gsm:organization-diagnostics:${encodeURIComponent(owner)}`;
function persist(owner: string) {
  const pending = (writes.get(owner) ?? Promise.resolve()).then(async () => {
    const saved = JSON.parse(await indexedDBStorage.getItem(storageKey(owner)) ?? '[]') as OrganizationRequestTrace[];
    const combined = new Map<string, OrganizationRequestTrace>((Array.isArray(saved) ? saved : []).filter(row => row.ownerId === owner).map(row => [row.id, row]));
    for (const row of [...rows.values()].flat()) if (row.ownerId === owner) combined.set(row.id, row);
    const all = [...combined.values()].filter(row => row.ownerId === owner && !!row.endedAt && row.endedAt > Date.now() - retainedMs)
      .sort((a, b) => b.createdAt - a.createdAt).map(row => ({ ...row, output: '' }));
    let bytes = 0;
    const kept = all.filter(row => { const size = byteLength(JSON.stringify(row)); if (bytes + size > 10 * 1024 * 1024) return false; bytes += size; return true; });
    await indexedDBStorage.setItem(storageKey(owner), JSON.stringify(kept));
  }).catch(() => {});
  writes.set(owner, pending);
}
function emit(proposalId: string, immediate = false) {
  if (immediate) { clearTimeout(timers.get(proposalId)); timers.delete(proposalId); listeners.forEach(fn => fn()); return; }
  if (!timers.has(proposalId)) timers.set(proposalId, setTimeout(() => { timers.delete(proposalId); listeners.forEach(fn => fn()); }, 150));
}
export const organizationRunEvents = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  snapshot(proposalId?: string) { return proposalId ? rows.get(proposalId) ?? empty : empty; },
  begin(row: OrganizationRequestTrace) {
    rows.set(row.proposalId, [...(rows.get(row.proposalId) ?? []).slice(-499), row]); emit(row.proposalId, true);
  },
  patch(proposalId: string, id: string, patch: Partial<OrganizationRequestTrace>, immediate = false) {
    const current = rows.get(proposalId); if (!current) return;
    rows.set(proposalId, current.map(row => row.id === id ? { ...row, ...patch } : row)); emit(proposalId, immediate);
    if (patch.endedAt) { const owner = current.find(row => row.id === id)?.ownerId; if (owner) persist(owner); }
  },
  validation(proposalId: string, key: string, error?: unknown) {
    validateOrganizationResult(proposalId, key, !error);
    const trace = [...(rows.get(proposalId) ?? [])].reverse().find(row => row.key === key && row.state === 'received');
    if (trace) this.patch(proposalId, trace.id, error ? { state: 'failed', code: 'MODEL_SCHEMA', error: redactOrganizationOutput(taskError(error)), endedAt: Date.now() } : { state: 'verified', endedAt: Date.now() }, true);
  },
  async load(owner: string, proposalId: string) {
    try {
      const saved = JSON.parse(await indexedDBStorage.getItem(storageKey(owner)) ?? '[]') as OrganizationRequestTrace[];
      if (!Array.isArray(saved)) return;
      const existing = rows.get(proposalId) ?? [];
      const clean = saved.filter(row => row.ownerId === owner && row.proposalId === proposalId && typeof row.id === 'string' && !!row.endedAt && row.endedAt > Date.now() - retainedMs && !existing.some(item => item.id === row.id));
      rows.set(proposalId, [...clean.map(row => ({ ...row, output: '' })), ...existing].sort((a, b) => a.createdAt - b.createdAt).slice(-500)); emit(proposalId, true);
      if (saved.some(row => row.ownerId === owner && (row.output || row.endedAt && row.endedAt <= Date.now() - retainedMs))) persist(owner);
    } catch { /* Diagnostics never invalidate a durable classification draft. */ }
  },
  async flush(owner: string) { persist(owner); await writes.get(owner); },
};
