import { emptyData, type CustomDiscoveryData } from './model';
import { assertRepositoryIdentityWritable } from '../../../services/repositoryIdentityGate';
import type { RepositoryIdentityParticipantResult } from '../../../services/repositoryIdentityParticipants';

const DB_NAME = 'gsm-custom-discovery';
const fallbackKey = (account: string) => `gsm-custom-discovery-fallback-v1:${encodeURIComponent(account)}`;
type Source = 'local' | 'home-projection' | 'read';
let changeChannel: BroadcastChannel | undefined;
const notifyChange = (account: string, source: Source | 'identity-migration') => {
  if (source !== 'read' && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gsm:custom-discovery-changed', { detail: { account, source } }));
    if (typeof BroadcastChannel !== 'undefined') {
      changeChannel ??= new BroadcastChannel('gsm-custom-discovery');
      changeChannel.postMessage({ account });
    }
  }
};
async function transactData<T>(
  account: string,
  change: (data: CustomDiscoveryData) => T,
  source: Source | 'identity-migration',
  options: { requireExisting?: boolean; shouldWrite?: (result: T) => boolean; onMissing?: () => T } = {},
): Promise<T> {
  if (!account?.trim()) throw new Error('Account required');
  if (source !== 'read' && source !== 'identity-migration') assertRepositoryIdentityWritable(account);
  if (typeof indexedDB === 'undefined') {
    if (typeof window === 'undefined') throw new Error('Discovery storage unavailable');
    const raw = window.localStorage.getItem(fallbackKey(account));
    if (!raw && options.onMissing) return options.onMissing();
    if (!raw && options.requireExisting) throw new Error('CUSTOM_DISCOVERY_ACCOUNT_NOT_FOUND');
    const data: CustomDiscoveryData = raw ? JSON.parse(raw) : emptyData();
    if (!data || !Array.isArray(data.channels) || !Array.isArray(data.editions) || !data.cache) {
      throw new Error('INVALID_CUSTOM_DISCOVERY_SNAPSHOT');
    }
    const result = change(data);
    if (source !== 'read' && (options.shouldWrite?.(result) ?? true)) {
      if (source !== 'identity-migration') assertRepositoryIdentityWritable(account);
      window.localStorage.setItem(fallbackKey(account), JSON.stringify(data));
      notifyChange(account, source);
    }
    return result;
  }
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('accounts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Discovery storage is blocked'));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      if (source !== 'read' && source !== 'identity-migration') assertRepositoryIdentityWritable(account);
      const tx = db.transaction('accounts', source === 'read' ? 'readonly' : 'readwrite');
      const timer = setTimeout(() => { tx.abort(); }, 15000);
      let result: T;
      let failure: unknown;
      let wrote = false;
      tx.oncomplete = () => { clearTimeout(timer); if (wrote) notifyChange(account, source); resolve(result); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(failure || tx.error || new Error('Storage transaction aborted')); };
      const request = tx.objectStore('accounts').get(account);
      request.onsuccess = () => {
        try {
          if (request.result === undefined && options.onMissing) {
            result = options.onMissing();
            return;
          }
          if (request.result === undefined && options.requireExisting) throw new Error('CUSTOM_DISCOVERY_ACCOUNT_NOT_FOUND');
          const data: CustomDiscoveryData = request.result ?? emptyData();
          result = change(data);
          if (source !== 'read' && (options.shouldWrite?.(result) ?? true)) {
            if (source !== 'identity-migration') assertRepositoryIdentityWritable(account);
            tx.objectStore('accounts').put(data, account);
            wrote = true;
          }
        } catch (error) { failure = error; tx.abort(); }
      };
    });
  } finally { db.close(); }
}
export const transact = <T>(account: string, change: (data: CustomDiscoveryData) => T, source: Source = 'local') =>
  transactData(account, change, source);
export const loadData = (account: string) => transact(account, data => data, 'read');
export const migrateCustomRepositoryIdentityData = (
  account: string,
  change: (data: CustomDiscoveryData) => RepositoryIdentityParticipantResult,
) => transactData(account, change, 'identity-migration', { requireExisting: true, shouldWrite: result => result.changed > 0 });
export const backupCustomRepositoryIdentityData = (account: string): Promise<CustomDiscoveryData | null> =>
  transactData<CustomDiscoveryData | null>(account, data => data, 'read', { onMissing: () => null });
export const restoreCustomRepositoryIdentityData = (account: string, backup: CustomDiscoveryData): Promise<RepositoryIdentityParticipantResult> =>
  transactData(account, data => {
    if (!backup || !Array.isArray(backup.channels) || !Array.isArray(backup.editions) || !backup.cache) {
      throw new Error('INVALID_CUSTOM_DISCOVERY_IDENTITY_BACKUP');
    }
    if (JSON.stringify(data) === JSON.stringify(backup)) return { changed: 0 };
    for (const key of Object.keys(data)) delete (data as unknown as Record<string, unknown>)[key];
    Object.assign(data, backup);
    return { changed: 1 };
  }, 'identity-migration', { shouldWrite: result => result.changed > 0 });

export const acquireLease = (account: string, owner: string, now = Date.now()) =>
  transact(account, data => {
    if (data.lease && data.lease.expires > now && data.lease.owner !== owner) return false;
    data.lease = { owner, expires: now + 120000 };
    return true;
  });
export const releaseLease = (account: string, owner: string) =>
  transact(account, data => { if (data.lease?.owner === owner) delete data.lease; });
