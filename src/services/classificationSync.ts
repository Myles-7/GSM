import { backend } from './backendAdapter';
import { useAppStore } from '../store/useAppStore';
import { desktopStoreRecords, flushDesktopHome, getDesktopHomeSync, getDesktopClassificationReceiptToken, subscribeDesktopHome, waitForDesktopHomeCapture } from '../home/desktop';
import { acknowledgeClassificationSync, classificationSyncToken, classificationSnapshotRepositoryIds } from './classificationSyncReceipt';
import type { AppState } from '../types';
import type { PendingOperation } from '../home/types';

export type ClassificationSyncStatus = 'local' | 'offline' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'error';
export interface ClassificationSyncView { status: ClassificationSyncStatus; pending: number; error?: string }
const listeners = new Set<() => void>();
let revision = 0;
const publish = () => { revision++; listeners.forEach(listener => listener()); };
export const classificationSyncRevision = () => revision;
export function subscribeClassificationSync(listener: () => void): () => void {
  listeners.add(listener);
  const detach = subscribeDesktopHome(publish);
  const online = () => publish();
  window.addEventListener('online', online); window.addEventListener('offline', online);
  return () => { listeners.delete(listener); detach(); window.removeEventListener('online', online); window.removeEventListener('offline', online); };
}
const relevant = (operation: PendingOperation, ids: Set<string>) =>
  operation.collection === 'organization' && operation.id === 'default'
  || operation.collection === 'repositories' && ids.has(operation.id);
export function classificationPendingOperations(operations: PendingOperation[], state: AppState): PendingOperation[] {
  const ids = classificationSnapshotRepositoryIds(state);
  return operations.filter(operation => relevant(operation, ids));
}

/** Count real durable operations; queuedRepositoryIds is a generation work list. */
export async function readClassificationSyncView(): Promise<ClassificationSyncView> {
  const state = useAppStore.getState(); const sync = getDesktopHomeSync();
  if (!sync && !backend.isAvailable && !backend.configuredUrl) return { status: 'local', pending: 0 };
  if (sync) {
    const pending = classificationPendingOperations(await sync.db.pending(), state);
    const conflict = pending.find(operation => operation.conflict !== undefined || operation.rejected);
    if (conflict) return { status: 'conflict', pending: pending.length, error: conflict.rejected ?? '资料版本冲突' };
    if (sync.view.status === 'offline') return { status: 'offline', pending: pending.length, error: sync.view.error };
    if (['auth-required', 'error'].includes(sync.view.status) && (pending.length || state.classificationSchemes?.generation?.syncPending)) return { status: 'error', pending: pending.length, error: sync.view.error };
    if (pending.length) return { status: sync.view.status === 'syncing' ? 'syncing' : 'pending', pending: pending.length };
    return { status: state.classificationSchemes?.generation?.syncPending ? 'pending' : 'synced', pending: 0 };
  }
  if (!backend.isAvailable || navigator.onLine === false) return { status: 'offline', pending: 0 };
  const generation = state.classificationSchemes?.generation;
  return { status: generation?.syncPending ? generation.error ? 'error' : 'pending' : 'synced', pending: 0, error: generation?.syncPending ? generation.error?.replace(/^SYNC_PENDING:/, '') : undefined };
}

/** The exact locally captured version must have left the outbox and survived reconciliation. */
export async function acknowledgeDesktopClassification(snapshot: AppState): Promise<boolean> {
  const sync = getDesktopHomeSync();
  if (!sync || sync.identity.githubUserId !== snapshot.user?.id) return false;
  if (getDesktopClassificationReceiptToken() !== classificationSyncToken(snapshot)) return false;
  await waitForDesktopHomeCapture();
  if (getDesktopHomeSync() !== sync || classificationSyncToken(snapshot) !== classificationSyncToken(useAppStore.getState())) return false;
  if (classificationPendingOperations(await sync.db.pending(), snapshot).length) return false;
  const ids = classificationSnapshotRepositoryIds(snapshot);
  const expected = desktopStoreRecords(snapshot).filter(record => record.collection === 'organization' || record.collection === 'repositories' && ids.has(record.id));
  const records = await sync.db.allRecords();
  if (expected.some(record => !records.some(actual => actual.collection === record.collection && actual.id === record.id && !actual.deleted && JSON.stringify(actual.data) === JSON.stringify(record.data)))) return false;
  if (getDesktopHomeSync() !== sync) return false;
  return acknowledgeClassificationSync(snapshot);
}

/** Retry delivery of the current local classification without regenerating it. */
export async function syncAIClassification(): Promise<void> {
  const snapshot = useAppStore.getState();
  const token = classificationSyncToken(snapshot);
  const generation = snapshot.classificationSchemes?.generation;
  if (!snapshot.user || !generation) return;
  if (!getDesktopHomeSync() && !backend.isAvailable && !backend.configuredUrl) {
    acknowledgeClassificationSync(snapshot); publish(); return;
  }
  snapshot.setClassificationGeneration({ syncPending: true }); publish();
  try {
    if (getDesktopHomeSync()) {
      await flushDesktopHome();
      if (!await acknowledgeDesktopClassification(snapshot)) throw new Error('分类尚未同步，可能有资料冲突');
    } else {
      if (!backend.isAvailable || navigator.onLine === false) throw new Error('后端离线');
      const { forceSyncToBackend } = await import('./autoSync');
      await forceSyncToBackend({ reportFailures: true });
      // pushToBackend acknowledges only the snapshot it actually transmitted.
    }
  } catch (error) {
    // Another legacy shard can fail after both classification shards were acknowledged.
    if (classificationSyncToken(useAppStore.getState()) === token && !useAppStore.getState().classificationSchemes?.generation?.syncPending) return;
    if (classificationSyncToken(useAppStore.getState()) === token) useAppStore.getState().setClassificationGeneration({ syncPending: true,
      error: `SYNC_PENDING:${error instanceof Error ? error.message.slice(0, 220) : String(error).slice(0, 220)}` });
    throw error;
  } finally { publish(); }
}
