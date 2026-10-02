import { emptyData, type CustomDiscoveryData } from './model';

const DB_NAME = 'gsm-custom-discovery';
export async function transact<T>(account: string, change: (data: CustomDiscoveryData) => T, source: 'local' | 'home-projection' | 'read' = 'local'): Promise<T> {
  if (!account) throw new Error('Account required');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('accounts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Discovery storage is blocked'));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('accounts', 'readwrite');
      const timer = setTimeout(() => { tx.abort(); }, 15000);
      let result: T;
      let failure: unknown;
      tx.oncomplete = () => { clearTimeout(timer); if (source !== 'read' && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('gsm:custom-discovery-changed', { detail: { account, source } })); resolve(result); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(failure || tx.error || new Error('Storage transaction aborted')); };
      const request = tx.objectStore('accounts').get(account);
      request.onsuccess = () => {
        try {
          const data: CustomDiscoveryData = request.result ?? emptyData();
          result = change(data);
          tx.objectStore('accounts').put(data, account);
        } catch (error) { failure = error; tx.abort(); }
      };
    });
  } finally { db.close(); }
}
export const loadData = (account: string) => transact(account, data => data, 'read');

export const acquireLease = (account: string, owner: string, now = Date.now()) =>
  transact(account, data => {
    if (data.lease && data.lease.expires > now && data.lease.owner !== owner) return false;
    data.lease = { owner, expires: now + 120000 };
    return true;
  });
export const releaseLease = (account: string, owner: string) =>
  transact(account, data => { if (data.lease?.owner === owner) delete data.lease; });
