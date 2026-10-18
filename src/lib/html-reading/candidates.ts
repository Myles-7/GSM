import { readingTransaction, type ReadingData, type ReadingLoadOptions } from './storage';

/** Latest accepted candidate=true operation; legacy candidates deliberately have no invented date. */
export interface ReadingCandidateSource {
  repoId: number; operationId: string; fileName: string; snapshotId: string;
  generatedAt?: string; importedAt: string; importId: string;
}
export type ReadingStarRowStatus = 'queued' | 'checking' | 'sending' | 'starred' | 'already-starred' | 'failed' | 'uncertain' | 'local-pending' | 'skipped';
export interface ReadingStarBatchRow {
  repoId: number; name: string; sourceFingerprint: string; projectFingerprint?: string; status: ReadingStarRowStatus;
  error?: string; updatedAt?: string; starredAt?: string; outcome?: 'starred' | 'already-starred';
  reconcileRequired?: boolean; lastAttemptAt?: string;
}
export interface ReadingStarBatch {
  id: string; accountId: string; createdAt: string; updatedAt: string; selectionMode?: 'candidates' | 'projects';
  status: 'running' | 'paused' | 'completed'; rows: ReadingStarBatchRow[];
  pauseReason?: string; retryAt?: string; syncError?: string;
}
export type CandidateWorkspace = ReadingData & {
  candidateSources: Record<string, ReadingCandidateSource>; starBatches: Record<string, ReadingStarBatch>;
};
export type CandidateTransactionOptions = Pick<ReadingLoadOptions, 'validate' | 'signal'>;
export function candidateTransaction<T>(account: string, mutate: (data: CandidateWorkspace) => T, options: CandidateTransactionOptions = {}): Promise<T> {
  return readingTransaction(account, data => mutate(data as CandidateWorkspace), { ...options, includeSnapshots: false, includeCandidates: true, includeStarBatches: true });
}
export const readCandidateWorkspace = (account: string, options?: CandidateTransactionOptions) => candidateTransaction(account, data => structuredClone(data), options);
export const saveStarBatch = (account: string, batch: ReadingStarBatch, options?: CandidateTransactionOptions) => candidateTransaction(account, data => {
  if (batch.accountId !== account) throw new Error('收藏批次属于其他 GitHub 账户。');
  data.starBatches[batch.id] = structuredClone(batch);
}, options);
export const updateStarBatch = <T>(account: string, id: string, mutate: (batch: ReadingStarBatch, data: CandidateWorkspace) => T, options?: CandidateTransactionOptions) => candidateTransaction(account, data => {
  const batch = data.starBatches[id];
  if (!batch || batch.accountId !== account) throw new Error('找不到当前账户的收藏批次。');
  return mutate(batch, data);
}, options);
export function candidateFingerprint(data: ReadingData, repoId: number): string {
  if (!data.candidateSources) throw new Error('请先加载候选来源。');
  const source = data.candidateSources[repoId];
  return JSON.stringify([data.states[repoId]?.candidate === true, data.candidateRevisions?.[repoId] ?? 0, source?.operationId ?? null, source?.importId ?? null]);
}
/** A batch may finish after a later import; only clear the exact candidate it selected. */
export function clearCandidateIfUnchanged(data: ReadingData, repoId: number, fingerprint: string): boolean {
  if (candidateFingerprint(data, repoId) !== fingerprint || !data.states[repoId]?.candidate) return false;
  data.states[repoId].candidate = false;
  return true;
}
export interface ReadingImportMetadata { fileName?: string; importId?: string }
export function rememberCandidateSource(data: ReadingData, source: ReadingCandidateSource): void {
  if (!data.candidateSources) throw new Error('候选来源必须与导入收据在同一事务中保存。');
  data.candidateSources[source.repoId] = source;
}
