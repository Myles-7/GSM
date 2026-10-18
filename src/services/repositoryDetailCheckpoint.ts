import { assertRepositoryIdentityWritable } from './repositoryIdentityGate';

// Local only; never part of Store, Home replication, task exports, or diagnostics.
// Failed responses expire after a day and are bounded independently of task history.
export const DETAIL_CHECKPOINT_LIMIT = 20;
const ttl = 86400000;
export type DetailCheckpointContext = { fullName: string; pushedAt: string | null; language: string; model: string;
  readme: { content: string; retrievedAt: string } };
type Checkpoint = { key: string; owner: number; repositoryId: number; createdAt: number; response: string; context?: DetailCheckpointContext };
const listeners = new Set<() => void>();
export function subscribeDetailCheckpoints(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
const emit = () => listeners.forEach(listener => listener());
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('gsm-detail-response-checkpoints', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('responses', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function saveDetailResponseCheckpoint(owner: number, repositoryId: number, response: string, context?: DetailCheckpointContext): Promise<boolean> {
  if (!Number.isSafeInteger(owner) || owner <= 0 || !Number.isSafeInteger(repositoryId) || repositoryId <= 0
    || response.length > 96000 || (context && JSON.stringify(context).length > 48000)) return false;
  assertRepositoryIdentityWritable();
  const db = await open();
  try {
    assertRepositoryIdentityWritable();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('responses', 'readwrite'), store = tx.objectStore('responses');
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error);
      const request = store.getAll();
      request.onsuccess = () => {
        try {
        const now = Date.now(), key = `${owner}:${repositoryId}`;
        const rows = request.result as Checkpoint[];
        for (const row of rows) if (now - row.createdAt >= ttl) store.delete(row.key);
        const retained = rows.filter(row => row.owner === owner && row.key !== key && now - row.createdAt < ttl).sort((a, b) => b.createdAt - a.createdAt);
        for (const row of retained.slice(DETAIL_CHECKPOINT_LIMIT - 1)) store.delete(row.key);
        store.put({ key, owner, repositoryId, response, createdAt: now, context } satisfies Checkpoint);
        } catch (error) { tx.abort(); reject(error); }
      };
    });
    emit(); return true;
  } finally { db.close(); }
}
export async function readDetailResponseCheckpoint(owner: number, repositoryId: number): Promise<Checkpoint | undefined> {
  const db = await open();
  try {
    const row = await new Promise<Checkpoint | undefined>((resolve, reject) => {
      const tx = db.transaction('responses', 'readonly');
      const request = tx.objectStore('responses').get(`${owner}:${repositoryId}`);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    if (!row || row.owner !== owner || row.repositoryId !== repositoryId) return undefined;
    if (Date.now() - row.createdAt >= ttl) { await clearDetailResponseCheckpoint(owner, repositoryId).catch(() => {}); return undefined; }
    return row;
  } finally { db.close(); }
}
export async function clearDetailResponseCheckpoint(owner: number, repositoryId: number): Promise<void> {
  assertRepositoryIdentityWritable();
  const db = await open();
  try {
    assertRepositoryIdentityWritable();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('responses', 'readwrite');
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error);
      tx.objectStore('responses').delete(`${owner}:${repositoryId}`);
    });
    emit();
  } finally { db.close(); }
}
