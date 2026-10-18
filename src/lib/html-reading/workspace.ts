import { emptyReadingState, type ReadingState } from './model';
import { candidateTransaction, type ReadingCandidateSource, type CandidateTransactionOptions } from './candidates';
import type { ReadingData } from './storage';

export type ReadingProjectSource = ReadingCandidateSource;
export type ReadingProcessedReason = 'ignored' | 'starred' | 'manual';
export interface ReadingProcessing { processed: boolean; reason?: ReadingProcessedReason; updatedAt: string }
export interface ReadingStarObservation { starred: boolean; checkedAt: string }
export interface ReadingLatestImport { id: string; importedAt: string; ids: string[] }
export type ReadingProjectPatch = Partial<ReadingState> & { processed?: boolean };

/** Desktop metadata stays outside the strict phone ReadingState protocol. */
export function initializeReadingWorkspace(data: ReadingData): void {
  data.projectSources ??= {}; data.processing ??= {}; data.starObservations ??= {}; data.projectRevisions ??= {};
}
export function reconcileReadingProcessing(data: ReadingData, id: string, before: ReadingState, after: ReadingState): void {
  initializeReadingWorkspace(data);
  if (before.interest === after.interest && before.note === after.note && before.candidate === after.candidate) return;
  data.processing![id] = after.interest === 'ignored' && before.interest !== after.interest
    ? { processed: true, reason: 'ignored', updatedAt: new Date().toISOString() }
    : { processed: false, updatedAt: new Date().toISOString() };
}
export function rememberProjectSource(data: ReadingData, source: ReadingProjectSource): void {
  initializeReadingWorkspace(data); data.projectSources![source.repoId] = source;
}
export function rememberReadingImport(data: ReadingData, id: string, importedAt: string, ids: Iterable<string>): void {
  const accepted = [...new Set(ids)];
  if (accepted.length) data.latestImport = { id, importedAt, ids: accepted };
}
/** Includes revisions so change-and-restore cannot resurrect an old confirmation. */
export function readingProjectFingerprint(data: ReadingData, id: number | string): string {
  return JSON.stringify([data.names[id] ?? null, data.states[id] ?? emptyReadingState(), data.projectSources?.[id] ?? null, data.candidateSources?.[id] ?? null,
    data.processing?.[id] ?? null, data.projectRevisions?.[id] ?? 0]);
}
export function completeReadingProjectIfUnchanged(data: ReadingData, id: number, expected: string): boolean {
  if (readingProjectFingerprint(data, id) !== expected) return false;
  initializeReadingWorkspace(data);
  if (data.states[id]) data.states[id].candidate = false;
  data.processing![id] = { processed: true, reason: 'starred', updatedAt: new Date().toISOString() };
  return true;
}
export const readReadingWorkspace = (account: string, options?: CandidateTransactionOptions) => candidateTransaction(account, data => structuredClone(data), options);
export const updateReadingProjects = (account: string, ids: string[], patch: ReadingProjectPatch, expected: Record<string, string>, options?: CandidateTransactionOptions) => candidateTransaction(account, data => {
  const selected = [...new Set(ids)];
  if (!selected.length) throw new Error('请先选择项目。');
  if (patch.note !== undefined && selected.length !== 1) throw new Error('请逐项编辑阅读笔记。');
  const allowed = new Set(['read', 'interest', 'note', 'candidate', 'processed']);
  if (Object.keys(patch).some(key => !allowed.has(key)) || (patch.interest !== undefined && !['neutral', 'interested', 'ignored'].includes(patch.interest))
    || (patch.note !== undefined && (typeof patch.note !== 'string' || patch.note.length > 12000))
    || ['read', 'candidate', 'processed'].some(key => patch[key as keyof ReadingProjectPatch] !== undefined && typeof patch[key as keyof ReadingProjectPatch] !== 'boolean')) throw new Error('项目修改无效。');
  // Validate every row before mutating any: one stale confirmation rolls back all.
  for (const id of selected) if (!data.states[id] || !data.names[id] || !expected || expected[id] !== readingProjectFingerprint(data, id)) throw new Error('项目已变化，请刷新清单后重新确认。');
  for (const id of selected) {
    const before = { ...data.states[id] };
    for (const field of ['read', 'interest', 'note', 'candidate'] as const) if (patch[field] !== undefined) Object.assign(data.states[id], { [field]: patch[field] });
    reconcileReadingProcessing(data, id, before, data.states[id]);
    if (patch.processed !== undefined && (data.processing?.[id]?.processed ?? false) !== patch.processed) {
      data.processing![id] = { processed: patch.processed, ...(patch.processed ? { reason: 'manual' as const } : {}), updatedAt: new Date().toISOString() };
    }
  }
}, options);
