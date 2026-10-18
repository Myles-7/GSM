// Independent of Store v17. An owner migration marker and every delta commit in
// one transaction; a failed migration can never make a partial index authoritative.
export const TASK_JOURNAL_DB = 'gsm-task-journal-v2';
type Owned = { owner: string; id: string; state: string; updatedAt: string; archived?: boolean; trigger?: string };
export interface JournalDelta<T extends Owned> {
  upserts: T[];
  removals: string[];
  activity?: unknown;
  hidden?: string[];
  initialize?: boolean;
}

async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(Error('TASK_STORAGE_OPEN_TIMEOUT')); }, 2000);
    let request:IDBOpenDBRequest;
    try{request=indexedDB.open(TASK_JOURNAL_DB,1);}catch(error){clearTimeout(timer);reject(error);return;}
    request.onupgradeneeded = () => {
      if (settled) { request.transaction?.abort(); return; }
      request.result.createObjectStore('tasks', { keyPath: ['owner', 'id'] }).createIndex('owner', 'owner');
      request.result.createObjectStore('index', { keyPath: ['owner', 'id'] }).createIndex('owner', 'owner');
      request.result.createObjectStore('owners', { keyPath: 'owner' });
      request.result.createObjectStore('activity');
      request.result.createObjectStore('hidden');
    };
    request.onsuccess = () => { clearTimeout(timer); if (settled) request.result.close(); else { settled = true; resolve(request.result); } };
    request.onerror = () => { clearTimeout(timer); settled = true; reject(request.error); };
  });
}

export const taskJournalStorage = {
  async read(owner: string): Promise<{ initialized: boolean; records: unknown[]; activity?: unknown; hidden: unknown }> {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(['tasks', 'index', 'owners', 'activity', 'hidden'], 'readonly');
        const marker = tx.objectStore('owners').get(owner);
        const tasks = tx.objectStore('tasks').index('owner').getAll(owner);
        const index = tx.objectStore('index').index('owner').getAll(owner);
        const activity = tx.objectStore('activity').get(owner);
        const hidden = tx.objectStore('hidden').get(owner);
        tx.oncomplete = () => {
          if (marker.result?.version === 2 && (tasks.result.length !== index.result.length ||
              tasks.result.some((task, i) => task.id !== index.result[i].id))) {
            reject(Error('TASK_STORAGE_INCOMPLETE')); return;
          }
          resolve({ initialized: marker.result?.version === 2, records: marker.result?.version === 2 ? tasks.result : [], activity: activity.result, hidden: hidden.result ?? [] });
        };
        tx.onabort = tx.onerror = () => reject(tx.error ?? Error('TASK_STORAGE_READ_FAILED'));
      });
    } finally { db.close(); }
  },
  async commit<T extends Owned>(owner: string, delta: JournalDelta<T>): Promise<void> {
    const db = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['tasks', 'index', 'owners', 'activity', 'hidden'], 'readwrite');
        let failure: unknown;
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? Error('TASK_STORAGE_WRITE_FAILED'));
        try {
          for (const record of delta.upserts) {
            if (record.owner !== owner) throw Error('TASK_OWNER_MISMATCH');
            tx.objectStore('tasks').put(record);
            tx.objectStore('index').put({ owner, id: record.id, state: record.state, updatedAt: record.updatedAt, archived: record.archived, trigger: record.trigger });
          }
          for (const id of delta.removals) {
            tx.objectStore('tasks').delete([owner, id]);
            tx.objectStore('index').delete([owner, id]);
          }
          if (delta.activity !== undefined) tx.objectStore('activity').put(delta.activity, owner);
          if (delta.hidden !== undefined) tx.objectStore('hidden').put(delta.hidden, owner);
          if (delta.initialize) tx.objectStore('owners').put({ owner, version: 2, migratedAt: new Date().toISOString() });
        } catch (error) { failure = error; tx.abort(); }
      });
    } finally { db.close(); }
  },
};
