import type { Collection, HomeOperation, HomeRecord, PendingOperation } from './types';
import { z } from 'zod';
import { PendingTaskRequestError } from './taskSubmission';

const collectionSchema = z.enum(['repositories', 'organization', 'releases', 'release_reads', 'subscriptions', 'sessions', 'messages', 'evidence', 'projects', 'proposals', 'discovery_config', 'discovery_subscriptions', 'discovery_reads', 'discovery_history', 'discovery_editions']);
const recordSchema = z.object({ collection: collectionSchema, id: z.string().min(1), data: z.record(z.string(), z.unknown()).nullable(), version: z.number().int().nonnegative(), deleted: z.boolean().optional(), seq: z.number().int().nonnegative().optional() });
const operationSchema = z.object({ key: z.string(), opId: z.string().min(1), collection: collectionSchema, id: z.string().min(1), baseVersion: z.number().int().nonnegative(), kind: z.enum(['put', 'delete']), data: z.record(z.string(), z.unknown()).optional(), source: z.enum(['user', 'ai']), conflict: recordSchema.nullable().optional(), rejected: z.string().optional() }).refine(value => value.key === `${value.collection}:${value.id}` && (value.kind === 'delete' || !!value.data));
const preferencesSchema = z.object({ density:z.enum(['compact','standard']), readingFontSize:z.union([z.literal(14),z.literal(16),z.literal(18),z.literal(20)]), reducedMotion:z.boolean() });
const savedFilterSchema = z.object({id:z.string().min(1).max(150),name:z.string().min(1).max(80),filter:z.object({query:z.string().max(500),category:z.string().max(150),language:z.string().max(100),sort:z.string().max(80),starState:z.string().max(30).optional(),tag:z.string().max(80).optional()})});
const recentViewSchema = z.object({id:z.string().min(1).max(150),fullName:z.string().min(1).max(300),viewedAt:z.string().max(80)});
const experienceSchema = z.object({preferences:preferencesSchema.optional(),theme:z.enum(['system','light','dark']).optional(),savedFilters:z.array(savedFilterSchema).max(100).optional(),recentViews:z.array(recentViewSchema).max(100).optional()});
const backupSchema = z.object({ format: z.literal('gsm-mobile-backup'), version: z.literal(1), workspaceId: z.string().min(1), githubUserId: z.number().int().positive(), createdAt: z.string(), records: z.array(recordSchema), pending: z.array(operationSchema), localExperience:experienceSchema.optional() });
export type BackupExperience = z.infer<typeof experienceSchema>;
type BackupIdentity = { workspaceId: string; githubUserId: number };
// Credentials and device configuration are never exported, including legacy credential fields.
const secretField = /api[_-]?key|api[_-]?secret|access[_-]?token|refresh[_-]?token|github[_-]?token|authorization|password|secret|token|credential|cookie|^ct0$/i;
const backupJson = (value: unknown) => JSON.stringify(value, (name, item) => secretField.test(name) ? undefined : item);

const key = (collection: Collection, id: string) => `${collection}:${id}`;
const result = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
const complete = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('本地保存中断'));
});

/** Cache, server shadows, cursor and durable outbox share one IDB transaction boundary. */
export class HomeDatabase {
  private opening?: Promise<IDBDatabase>;
  constructor(readonly namespace: string) {}
  private open(): Promise<IDBDatabase> {
    return this.opening ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(`gsm-home-v2-${encodeURIComponent(this.namespace)}`, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of ['records', 'shadow', 'outbox', 'meta']) db.createObjectStore(store);
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    });
  }
  async list(collection?: Collection): Promise<HomeRecord[]> {
    const db = await this.open();
    const records = await result(db.transaction('records').objectStore('records').getAll()) as HomeRecord[];
    return records.filter(row => !row.deleted && (!collection || row.collection === collection));
  }
  async allRecords(): Promise<HomeRecord[]> {
    const db = await this.open();
    return result(db.transaction('records').objectStore('records').getAll());
  }
  async pending(): Promise<PendingOperation[]> {
    const db = await this.open(); return result(db.transaction('outbox').objectStore('outbox').getAll());
  }
  async exportBackup(identity: BackupIdentity, preferences?: BackupExperience['preferences'], theme?: BackupExperience['theme']): Promise<string> {
    const db = await this.open(); const tx = db.transaction(['records', 'outbox', 'meta']); const done = complete(tx);
    const [records, pending, inFlight, task, savedFilters, recentViews] = await Promise.all([
      result(tx.objectStore('records').getAll()), result(tx.objectStore('outbox').getAll()),
      result(tx.objectStore('meta').get('inFlight')), result(tx.objectStore('meta').get('unconfirmedTask')),
      result(tx.objectStore('meta').get('mobile:savedFilters')), result(tx.objectStore('meta').get('mobile:recentViews')),
    ]);
    await done;
    if (inFlight || task) throw new Error('有尚未确认的同步或任务提交，请先恢复确认后再备份');
    const localExperience = experienceSchema.parse({preferences,theme,savedFilters,recentViews});
    return backupJson({ format: 'gsm-mobile-backup', version: 1, ...identity, createdAt: new Date().toISOString(), records, pending, localExperience });
  }
  previewBackup(text: string, identity: BackupIdentity) {
    if (new Blob([text]).size > 20 * 1024 * 1024) throw new Error('备份超过 20 MB 上限');
    const parsed = backupSchema.safeParse(JSON.parse(backupJson(JSON.parse(text))));
    if (!parsed.success) throw new Error('备份格式无效');
    const backup = parsed.data;
    if (backup.workspaceId !== identity.workspaceId || backup.githubUserId !== identity.githubUserId) throw new Error('只能恢复同一 GitHub 账户和工作区的备份');
    return {createdAt:backup.createdAt,records:backup.records.length,pending:backup.pending.length,collections:backup.records.reduce<Record<string,number>>((counts,row)=>({...counts,[row.collection]:(counts[row.collection]??0)+1}),{}),localExperience:backup.localExperience};
  }
  async importBackup(text: string, identity: BackupIdentity): Promise<BackupExperience | undefined> {
    this.previewBackup(text,identity);
    const backup = backupSchema.parse(JSON.parse(backupJson(JSON.parse(text))));
    const db = await this.open(); const tx = db.transaction(['records', 'shadow', 'outbox', 'meta'], 'readwrite'); const done = complete(tx);
    const [inFlight, task, localPending] = await Promise.all([
      result(tx.objectStore('meta').get('inFlight')), result(tx.objectStore('meta').get('unconfirmedTask')),
      result(tx.objectStore('outbox').getAll()) as Promise<PendingOperation[]>,
    ]);
    if (inFlight || task) { await done; throw new Error('有尚未确认的同步或任务提交，请先恢复确认后再导入'); }
    for (const row of backup.records) tx.objectStore('records').put(row, key(row.collection, row.id));
    // Local edits always win; preserve operation IDs and base versions for safe replay/conflicts.
    const pending = new Map([...backup.pending, ...localPending].map(item => [item.key, item]));
    for (const item of pending.values()) {
      tx.objectStore('outbox').put(item, item.key);
      tx.objectStore('records').put({ collection: item.collection, id: item.id, version: item.baseVersion, data: item.data ?? null, deleted: item.kind === 'delete' }, item.key);
    }
    tx.objectStore('meta').put(false, 'initialized');
    if (backup.localExperience?.savedFilters) tx.objectStore('meta').put(backup.localExperience.savedFilters,'mobile:savedFilters');
    if (backup.localExperience?.recentViews) tx.objectStore('meta').put(backup.localExperience.recentViews,'mobile:recentViews');
    await done;
    return backup.localExperience;
  }
  async cacheStats(): Promise<{entries:number;bytes:number}> {
    const db=await this.open(); const store=db.transaction('meta').objectStore('meta');
    const [keys,values]=await Promise.all([result(store.getAllKeys()),result(store.getAll())]);
    let entries=0,bytes=0;keys.forEach((name,index)=>{const value=values[index];const legacy=String(name).startsWith('discovery-view:')&&value&&typeof value==='object'&&'results' in value?value.results:undefined;if (this.isCacheKey(String(name))||legacy) {entries++;bytes+=new Blob([JSON.stringify(legacy??value)??'']).size;}});return {entries,bytes};
  }
  private isCacheKey(name:string) {return /^(repository-readme:|discovery-cache:|discovery-last:|discovery-repo:)/.test(name);}
  async clearCaches(): Promise<void> {
    const db=await this.open();const tx=db.transaction('meta','readwrite');const done=complete(tx);const store=tx.objectStore('meta');
    const keys=await result(store.getAllKeys()); for(const name of keys){if(this.isCacheKey(String(name)))store.delete(name);else if(String(name).startsWith('discovery-view:')){const value=await result(store.get(name));if(value&&typeof value==='object'&&'results' in value){const controls={...value};delete controls.results;store.put(controls,name);}}} await done;
  }
  /** Freeze a request durably before dispatch; lost acknowledgements must replay identical bytes. */
  async nextBatch(): Promise<{ clientId: string; operations: HomeOperation[] }> {
    const db = await this.open(); const tx = db.transaction(['meta', 'outbox'], 'readwrite'); const done = complete(tx);
    const meta = tx.objectStore('meta');
    const previous = await result(meta.get('inFlight')) as { clientId: string; operations: HomeOperation[] } | undefined;
    if (previous) { await done; return previous; }
    let clientId = await result(meta.get('clientId')) as string | undefined;
    if (!clientId) { clientId = crypto.randomUUID(); meta.put(clientId, 'clientId'); }
    const pending = await result(tx.objectStore('outbox').getAll()) as PendingOperation[];
    const operations = pending.filter(item => item.conflict === undefined && !item.rejected).slice(0, 100).map(item => ({ opId: item.opId, collection: item.collection, id: item.id, baseVersion: item.baseVersion, kind: item.kind, ...(item.data ? { data: item.data } : {}), source: item.source }));
    const batch = { clientId, operations };
    if (operations.length) meta.put(batch, 'inFlight');
    await done; return batch;
  }
  async finishBatch(operations: HomeOperation[]): Promise<void> {
    const db = await this.open(); const tx = db.transaction('meta', 'readwrite'); const done = complete(tx);
    const pending = await result(tx.objectStore('meta').get('inFlight')) as { operations: HomeOperation[] } | undefined;
    if (JSON.stringify(pending?.operations) === JSON.stringify(operations)) tx.objectStore('meta').delete('inFlight'); await done;
  }
  async claimTaskRequest(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const db = await this.open(); const tx = db.transaction('meta', 'readwrite'); const done = complete(tx);
    const previous = await result(tx.objectStore('meta').get('unconfirmedTask')) as Record<string, unknown> | undefined;
    if (previous !== undefined) {
      if (!previous || typeof previous !== 'object' || Array.isArray(previous) || typeof previous.requestId !== 'string' || !previous.requestId) {
        await done;
        throw new PendingTaskRequestError(undefined, '未确认任务的本机记录格式无效，无法安全恢复；请检查原工作区的任务中心。');
      }
      const oldPayload = { ...previous }; delete oldPayload.requestId;
      const newPayload = { ...request }; delete newPayload.requestId;
      await done;
      if (JSON.stringify(oldPayload) !== JSON.stringify(newPayload)) throw new PendingTaskRequestError(previous);
      return previous;
    }
    tx.objectStore('meta').put(request, 'unconfirmedTask'); await done; return request;
  }
  async confirmTaskRequest(requestId: unknown): Promise<void> {
    if (typeof requestId !== 'string' || !requestId) return;
    const db = await this.open(); const tx = db.transaction('meta', 'readwrite'); const done = complete(tx);
    const pending = await result(tx.objectStore('meta').get('unconfirmedTask')) as Record<string, unknown> | undefined;
    if (pending?.requestId === requestId) tx.objectStore('meta').delete('unconfirmedTask');
    await done;
  }
  async metadata<T>(name: string): Promise<T | undefined> {
    const db = await this.open(); return result(db.transaction('meta').objectStore('meta').get(name));
  }
  async setMetadata(name: string, value: unknown): Promise<void> {
    const db = await this.open(); const tx = db.transaction('meta', 'readwrite'); const done = complete(tx);
    tx.objectStore('meta').put(value, name); await done;
  }
  async edit(collection: Collection, id: string, data: Record<string, unknown> | null, source: 'user' | 'ai' = 'user', expectedVersion?: number): Promise<void> {
    const db = await this.open(); const tx = db.transaction(['records', 'shadow', 'outbox'], 'readwrite'); const done = complete(tx);
    const recordKey = key(collection, id);
    const pending = await result(tx.objectStore('outbox').get(recordKey)) as PendingOperation | undefined;
    const shadow = await result(tx.objectStore('shadow').get(recordKey)) as HomeRecord | undefined;
    if (expectedVersion !== undefined && expectedVersion !== (shadow?.version ?? 0)) { await done; throw new Error('资料版本已改变，请刷新或处理同步冲突后重试'); }
    const operation: PendingOperation = {
      key: recordKey, opId: crypto.randomUUID(), collection, id, baseVersion: pending?.baseVersion ?? shadow?.version ?? 0,
      kind: data === null ? 'delete' : 'put', ...(data ? { data } : {}), source,
      ...(pending?.conflict !== undefined ? { conflict: pending.conflict } : {}),
    };
    tx.objectStore('outbox').put(operation, recordKey);
    tx.objectStore('records').put({ collection, id, data, version: operation.baseVersion, deleted: data === null }, recordKey);
    await done;
  }
  async applyRemote(rows: HomeRecord[], cursor: number, reset = false): Promise<void> {
    const db = await this.open(); const tx = db.transaction(['records', 'shadow', 'outbox', 'meta'], 'readwrite'); const done = complete(tx);
    const pending = await result(tx.objectStore('outbox').getAll()) as PendingOperation[];
    const pendingKeys = new Set(pending.map(item => item.key));
    if (reset) { tx.objectStore('records').clear(); tx.objectStore('shadow').clear(); }
    for (const row of rows) {
      const recordKey = key(row.collection, row.id);
      const previous = await result(tx.objectStore('shadow').get(recordKey)) as HomeRecord | undefined;
      if (previous && previous.version > row.version) continue;
      tx.objectStore('shadow').put(row, recordKey);
      if (!pendingKeys.has(recordKey)) tx.objectStore('records').put(row, recordKey);
    }
    if (reset) for (const item of pending) tx.objectStore('records').put({ collection: item.collection, id: item.id, version: item.baseVersion, data: item.data ?? null, deleted: item.kind === 'delete' }, item.key);
    tx.objectStore('meta').put(cursor, 'cursor'); tx.objectStore('meta').put(true, 'initialized');
    await done;
  }
  async acknowledge(sent: HomeOperation, record: HomeRecord): Promise<void> {
    const db = await this.open(); const tx = db.transaction(['records', 'shadow', 'outbox'], 'readwrite'); const done = complete(tx);
    const recordKey = key(sent.collection, sent.id);
    const pending = await result(tx.objectStore('outbox').get(recordKey)) as PendingOperation | undefined;
    const shadow = await result(tx.objectStore('shadow').get(recordKey)) as HomeRecord | undefined;
    const newest = shadow && shadow.version > record.version ? shadow : record;
    tx.objectStore('shadow').put(newest, recordKey);
    if (pending?.opId === sent.opId) {
      tx.objectStore('outbox').delete(recordKey); tx.objectStore('records').put(newest, recordKey);
    } else if (pending) {
      // An edit made while the request was in flight is based on our own acknowledged write.
      if (pending.baseVersion < record.version) tx.objectStore('outbox').put({ ...pending, opId: crypto.randomUUID(), baseVersion: record.version }, recordKey);
    }
    await done;
  }
  async reject(sent: HomeOperation, remote: HomeRecord | null, message?: string): Promise<void> {
    const db = await this.open(); const tx = db.transaction('outbox', 'readwrite'); const done = complete(tx);
    const recordKey = key(sent.collection, sent.id);
    const pending = await result(tx.objectStore('outbox').get(recordKey)) as PendingOperation | undefined;
    if (pending) tx.objectStore('outbox').put({ ...pending, conflict: remote, rejected: message }, recordKey);
    await done;
  }
  async resolve(recordKey: string, keepLocal: boolean): Promise<void> {
    const db = await this.open(); const tx = db.transaction(['records', 'outbox', 'shadow'], 'readwrite'); const done = complete(tx);
    const item = await result(tx.objectStore('outbox').get(recordKey)) as PendingOperation | undefined;
    if (!item) { await done; return; }
    const remote = item.conflict !== undefined ? item.conflict : await result(tx.objectStore('shadow').get(recordKey)) as HomeRecord | undefined;
    if (remote) tx.objectStore('shadow').put(remote, recordKey); else tx.objectStore('shadow').delete(recordKey);
    if (keepLocal) {
      const operation = { ...item }; delete operation.conflict; delete operation.rejected;
      tx.objectStore('outbox').put({ ...operation, opId: crypto.randomUUID(), baseVersion: remote?.version ?? 0 }, recordKey);
      tx.objectStore('records').put({collection:item.collection,id:item.id,data:item.data??null,deleted:item.kind==='delete',version:remote?.version??0},recordKey);
    } else {
      tx.objectStore('outbox').delete(recordKey);
      if (remote) tx.objectStore('records').put(remote, recordKey); else tx.objectStore('records').delete(recordKey);
    }
    await done;
  }
}

