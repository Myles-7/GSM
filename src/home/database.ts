import type { Collection, HomeOperation, HomeRecord, PendingOperation } from './types';
import { z } from 'zod';
import { PendingTaskRequestError } from './taskSubmission';
import { assertRepositoryIdentityWritable, assertRepositoryMaintenanceOwner } from '../services/repositoryIdentityGate';
import { repositoryHomeProjection } from './repositoryProjection';

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
export interface LocalRestoreOperation { operation: PendingOperation; before: HomeRecord | null }
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
  private assertWritable(tx?: IDBTransaction, done?: Promise<void>): void {
    try { assertRepositoryIdentityWritable(); }
    catch (error) {
      if (tx) {
        void done?.catch(() => {});
        tx.abort();
      }
      throw error;
    }
  }
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
  /** Includes tombstones: callers need their version for conflict-safe edits. */
  async getRecord(collection: Collection, id: string): Promise<HomeRecord | undefined> {
    const db = await this.open();
    return result(db.transaction('records').objectStore('records').get(key(collection, id)));
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
    this.assertWritable();
    this.previewBackup(text,identity);
    const backup = backupSchema.parse(JSON.parse(backupJson(JSON.parse(text))));
    const db = await this.open(); this.assertWritable();
    const tx = db.transaction(['records', 'shadow', 'outbox', 'meta'], 'readwrite'); const done = complete(tx);
    const [inFlight, task, localPending] = await Promise.all([
      result(tx.objectStore('meta').get('inFlight')), result(tx.objectStore('meta').get('unconfirmedTask')),
      result(tx.objectStore('outbox').getAll()) as Promise<PendingOperation[]>,
    ]);
    this.assertWritable(tx, done);
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
    this.assertWritable(tx, done);
    let clientId = await result(meta.get('clientId')) as string | undefined;
    this.assertWritable(tx, done);
    const pending = await result(tx.objectStore('outbox').getAll()) as PendingOperation[];
    this.assertWritable(tx, done);
    if (!clientId) { clientId = crypto.randomUUID(); meta.put(clientId, 'clientId'); }
    const isOrganization = (item: PendingOperation) => item.collection === 'organization' && item.id === 'default';
    const dependency = (item: PendingOperation) => isOrganization(item) || item.collection === 'repositories';
    const group = pending.some(isOrganization) ? pending.filter(dependency) : [];
    if (group.length > 2000) { await done; throw new Error('分类结构和仓库关联超过单次同步上限（2000 项），请减少操作后重试'); }
    const blocked = group.some(item => item.conflict !== undefined || item.rejected);
    const readyGroup = blocked ? [] : group;
    const remainder = pending.filter(item => item.conflict === undefined && !item.rejected && (!group.length || !dependency(item)));
    const operations = [...readyGroup, ...remainder.slice(0, 2000 - readyGroup.length)].map(item => ({ opId: item.opId, collection: item.collection, id: item.id, baseVersion: item.baseVersion, kind: item.kind, ...(item.data ? { data: item.data } : {}), source: item.source }));
    const batch = { clientId, operations };
    if (operations.length) meta.put(batch, 'inFlight');
    await done; return batch;
  }
  async finishBatch(operations: HomeOperation[]): Promise<void> {
    const db = await this.open(); const tx = db.transaction('meta', 'readwrite'); const done = complete(tx);
    const pending = await result(tx.objectStore('meta').get('inFlight')) as { operations: HomeOperation[] } | undefined;
    if (JSON.stringify(pending?.operations) === JSON.stringify(operations)) tx.objectStore('meta').delete('inFlight'); await done;
  }
  /** Only the sync endpoint's pre-application data rejection proves this exact batch was not applied. */
  async repairRejectedRepositoryBatch(batch: { clientId: string; operations: HomeOperation[] }, proof: { status: number; code: string }): Promise<boolean> {
    if (proof.status !== 400 || proof.code !== 'PRIVATE_DATA_NOT_SYNCABLE') return false;
    const containsLegacyToken = (data: unknown): boolean => !!data && typeof data === 'object'
      && Object.entries(data).some(([name, value]) => name === 'temp_clone_token' || containsLegacyToken(value));
    if (!batch.operations.some(op => op.collection === 'repositories' && containsLegacyToken(op.data))) return false;
    this.assertWritable();
    const db = await this.open(); this.assertWritable();
    const tx = db.transaction(['meta', 'outbox', 'records'], 'readwrite'), done = complete(tx);
    try {
      const meta = tx.objectStore('meta'), outbox = tx.objectStore('outbox');
      const frozen = await result(meta.get('inFlight'));
      this.assertWritable(tx, done);
      if (JSON.stringify(frozen) !== JSON.stringify(batch)) { await done; return false; }
      const pending = await result(outbox.getAll()) as PendingOperation[];
      this.assertWritable(tx, done);
      const lineage: Array<{ previous: string; replacement: string }> = [];
      for (const op of pending) {
        if (op.collection !== 'repositories' || op.kind !== 'put' || !op.data) continue;
        const data = repositoryHomeProjection(op.data);
        if (JSON.stringify(data) === JSON.stringify(op.data)) continue;
        const replacement = crypto.randomUUID();
        lineage.push({ previous: op.opId, replacement });
        const sent = batch.operations.find(item => item.collection === op.collection && item.id === op.id);
        if (sent && sent.opId !== op.opId) lineage.push({ previous: sent.opId, replacement });
        outbox.put({ ...op, opId: replacement, data }, op.key);
        const record = await result(tx.objectStore('records').get(op.key)) as HomeRecord | undefined;
        this.assertWritable(tx, done);
        if (record) tx.objectStore('records').put({ ...record, data }, op.key);
      }
      // Never retain rejected credentials in a recovery marker or diagnostics.
      meta.put({ at: new Date().toISOString(), code: proof.code, lineage }, 'repositoryProjectionRepair');
      meta.delete('inFlight');
      await done; return true;
    } catch (error) { void done.catch(() => {}); try { tx.abort(); } catch { /* transaction already closed */ } throw error; }
  }
  async claimTaskRequest(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.assertWritable();
    const db = await this.open(); this.assertWritable();
    const tx = db.transaction('meta', 'readwrite'); const done = complete(tx);
    const previous = await result(tx.objectStore('meta').get('unconfirmedTask')) as Record<string, unknown> | undefined;
    this.assertWritable(tx, done);
    if (previous !== undefined) {
      if (!previous || typeof previous !== 'object' || Array.isArray(previous) || typeof previous.requestId !== 'string' || !previous.requestId) {
        await done;
        throw new PendingTaskRequestError(undefined, '未确认任务的本机记录格式无效，无法安全恢复；请检查原工作区的任务中心。');
      }
      const oldPayload = { ...previous }; delete oldPayload.requestId;
      const newPayload = { ...request }; delete newPayload.requestId;
      if(JSON.stringify(oldPayload)===JSON.stringify(newPayload)){await done;this.assertWritable();return previous;}
      if(request.requestId===previous.requestId){await done;throw new PendingTaskRequestError(previous);}
      const proof = await result(tx.objectStore('meta').get(`task-receipt:${previous.requestId}`)) as {request?:unknown;taskId?:unknown}|undefined;
      if (proof && typeof proof.taskId==='string' && JSON.stringify(proof.request)===JSON.stringify(previous)) {
        // A validated server receipt proves acceptance. Retain its cleanup
        // lineage independently so it cannot lock unrelated new submissions.
        tx.objectStore('meta').put(previous,`task-pending:${previous.requestId}`);
        tx.objectStore('meta').put(request,'unconfirmedTask');
        await done;this.assertWritable();return request;
      }
      await done;
      this.assertWritable();
      if (JSON.stringify(oldPayload) !== JSON.stringify(newPayload)) throw new PendingTaskRequestError(previous);
      return previous;
    }
    tx.objectStore('meta').put(request, 'unconfirmedTask'); await done;
    this.assertWritable();
    return request;
  }
  async confirmTaskRequest(requestId: unknown): Promise<void> {
    if (typeof requestId !== 'string' || !requestId) return;
    const db = await this.open(); const tx = db.transaction('meta', 'readwrite'); const done = complete(tx);
    const pending = await result(tx.objectStore('meta').get('unconfirmedTask')) as Record<string, unknown> | undefined;
    if (pending?.requestId === requestId) tx.objectStore('meta').delete('unconfirmedTask');
    tx.objectStore('meta').delete(`task-pending:${requestId}`);
    tx.objectStore('meta').delete(`task-receipt:${requestId}`);
    await done;
  }
  /** Called only after strict receipt payload and workspace identity validation. */
  async recordTaskReceipt(request: Record<string,unknown>, taskId:string):Promise<void> {
    const db=await this.open();const tx=db.transaction('meta','readwrite');const done=complete(tx);
    const meta=tx.objectStore('meta');
    const pending=await result(meta.get('unconfirmedTask')) as Record<string,unknown>|undefined;
    const archived=await result(meta.get(`task-pending:${request.requestId}`));
    if(JSON.stringify(pending)===JSON.stringify(request)||JSON.stringify(archived)===JSON.stringify(request))meta.put({request,taskId},`task-receipt:${request.requestId}`);
    await done;
  }
  async pendingTaskRequests():Promise<unknown[]> {
    const db=await this.open();const tx=db.transaction('meta');const meta=tx.objectStore('meta');
    const [pending,archived]=await Promise.all([result(meta.get('unconfirmedTask')),result(meta.getAll(IDBKeyRange.bound('task-pending:','task-pending:\uffff')))]);
    return [...(pending===undefined?[]:[pending]),...archived];
  }
  async metadata<T>(name: string): Promise<T | undefined> {
    const db = await this.open(); return result(db.transaction('meta').objectStore('meta').get(name));
  }
  async setMetadata(name: string, value: unknown): Promise<void> {
    const db = await this.open(); const tx = db.transaction('meta', 'readwrite'); const done = complete(tx);
    tx.objectStore('meta').put(value, name); await done;
  }
  async edit(collection: Collection, id: string, data: Record<string, unknown> | null, source: 'user' | 'ai' = 'user', expectedVersion?: number): Promise<void> {
    return this.editMany([{ collection, id, data, source, expectedVersion }]);
  }
  /** A taxonomy and its repository memberships become visible to the outbox together. */
  async editMany(edits: Array<{ collection: Collection; id: string; data: Record<string, unknown> | null; source?: 'user' | 'ai'; expectedVersion?: number }>): Promise<void> {
    this.assertWritable();
    const db = await this.open(); this.assertWritable();
    const tx = db.transaction(['records', 'shadow', 'outbox'], 'readwrite'); const done = complete(tx);
    try {
      for (const { collection, id, data, source = 'user', expectedVersion } of edits) {
        const recordKey = key(collection, id);
        const pending = await result(tx.objectStore('outbox').get(recordKey)) as PendingOperation | undefined;
        this.assertWritable(tx, done);
        const shadow = await result(tx.objectStore('shadow').get(recordKey)) as HomeRecord | undefined;
        this.assertWritable(tx, done);
        if (expectedVersion !== undefined && expectedVersion !== (shadow?.version ?? 0)) throw new Error('资料版本已改变，请刷新或处理同步冲突后重试');
        const operation: PendingOperation = {
          key: recordKey, opId: crypto.randomUUID(), collection, id, baseVersion: pending?.baseVersion ?? shadow?.version ?? 0,
          kind: data === null ? 'delete' : 'put', ...(data ? { data } : {}), source,
          ...(pending?.conflict !== undefined ? { conflict: pending.conflict } : {}),
        };
        tx.objectStore('outbox').put(operation, recordKey);
        tx.objectStore('records').put({ collection, id, data, version: operation.baseVersion, deleted: data === null }, recordKey);
      }
      await done;
    } catch (error) { void done.catch(() => {}); try { tx.abort(); } catch { /* transaction already finished */ } throw error; }
  }
  /** Only a backup-owned gate can stage/undo these records. No canonical shadow is replaced. */
  async stageLocalRestore(account: string, journalId: string, operations: LocalRestoreOperation[], undo = false): Promise<void> {
    const owner = () => assertRepositoryMaintenanceOwner(account, journalId);
    owner();
    if (!journalId.startsWith('local-backup:')) throw new Error('BACKUP_JOURNAL_INVALID');
    const markerKey = `local-restore:${journalId}`;
    const db = await this.open(); owner();
    const tx = db.transaction(['records', 'shadow', 'outbox', 'meta'], 'readwrite'); const done = complete(tx);
    try {
      const meta = tx.objectStore('meta'), records = tx.objectStore('records'), outbox = tx.objectStore('outbox');
      const [inFlight, task, marker, pending] = await Promise.all([
        result(meta.get('inFlight')), result(meta.get('unconfirmedTask')), result(meta.get(markerKey)), result(outbox.getAll()) as Promise<PendingOperation[]>,
      ]);
      owner();
      if (inFlight || task) throw new Error('BACKUP_UNCONFIRMED_OPERATIONS');
      const serialized = JSON.stringify(operations);
      if (marker !== undefined && marker !== serialized) throw new Error('BACKUP_HOME_CHECKPOINT_MISMATCH');
      if (undo && marker === undefined) { await done; return; }
      if (new Set(operations.map(item => item.operation.key)).size !== operations.length) throw new Error('BACKUP_DUPLICATE_OPERATION');
      const ownIds = new Set(operations.map(item => item.operation.opId));
      if (pending.some(item => !ownIds.has(item.opId)) || (!marker && pending.length)) throw new Error('BACKUP_PENDING_OPERATIONS');
      for (const { operation: op, before } of operations) {
        if (!['repositories', 'organization', 'releases', 'subscriptions', 'release_reads'].includes(op.collection) || (op.collection === 'organization' && op.id !== 'default') || op.key !== key(op.collection, op.id)) throw new Error('BACKUP_HOME_SCOPE_INVALID');
        const [current, queued, shadow] = await Promise.all([
          result(records.get(op.key)) as Promise<HomeRecord | undefined>, result(outbox.get(op.key)) as Promise<PendingOperation | undefined>,
          result(tx.objectStore('shadow').get(op.key)) as Promise<HomeRecord | undefined>,
        ]);
        owner();
        const target: HomeRecord = { collection: op.collection, id: op.id, data: op.data ?? null, version: op.baseVersion, deleted: op.kind === 'delete' };
        if (op.baseVersion !== (shadow?.version ?? 0)) throw new Error('BACKUP_HOME_VERSION_DRIFT');
        if (marker !== undefined) {
          if (JSON.stringify(queued) !== JSON.stringify(op) || JSON.stringify(current) !== JSON.stringify(target)) throw new Error('BACKUP_HOME_DISPATCHED_OR_CHANGED');
        } else if (JSON.stringify(current ?? null) !== JSON.stringify(before)) throw new Error('BACKUP_HOME_RECORD_DRIFT');
        if (undo) { if (before) records.put(before, op.key); else records.delete(op.key); outbox.delete(op.key); }
        else if (marker === undefined) { outbox.put(op, op.key); records.put(target, op.key); }
      }
      if (undo) meta.delete(markerKey); else meta.put(serialized, markerKey);
      await done;
    } catch (error) { void done.catch(() => {}); try { tx.abort(); } catch { /* already complete */ } throw error; }
  }
  async finishLocalRestore(account: string, journalId: string): Promise<void> {
    assertRepositoryMaintenanceOwner(account, journalId);
    const db = await this.open(); assertRepositoryMaintenanceOwner(account, journalId);
    const tx = db.transaction('meta', 'readwrite'); const done = complete(tx);
    tx.objectStore('meta').delete(`local-restore:${journalId}`); await done;
  }
  async applyRemote(rows: HomeRecord[], cursor: number, reset = false): Promise<number> {
    const db = await this.open(); const tx = db.transaction(['records', 'shadow', 'outbox', 'meta'], 'readwrite'); const done = complete(tx);
    const pending = await result(tx.objectStore('outbox').getAll()) as PendingOperation[];
    const pendingKeys = new Set(pending.map(item => item.key));
    let changed = 0;
    if (reset) { tx.objectStore('records').clear(); tx.objectStore('shadow').clear(); }
    for (const row of rows) {
      const recordKey = key(row.collection, row.id);
      const previous = await result(tx.objectStore('shadow').get(recordKey)) as HomeRecord | undefined;
      // Acknowledged writes later reappear in the change feed. An immutable
      // version already in shadow is an echo, not another business change.
      if (previous && previous.version >= row.version) continue;
      changed++;
      tx.objectStore('shadow').put(row, recordKey);
      if (!pendingKeys.has(recordKey)) tx.objectStore('records').put(row, recordKey);
    }
    if (reset) for (const item of pending) tx.objectStore('records').put({ collection: item.collection, id: item.id, version: item.baseVersion, data: item.data ?? null, deleted: item.kind === 'delete' }, item.key);
    tx.objectStore('meta').put(cursor, 'cursor'); tx.objectStore('meta').put(true, 'initialized');
    await done; return changed;
  }
  async clearSnapshotStage(): Promise<void> {
    const db=await this.open(),tx=db.transaction('meta','readwrite'),done=complete(tx);
    tx.objectStore('meta').delete(IDBKeyRange.bound('snapshot-stage:','snapshot-stage:\uffff'));await done;
  }
  async stageSnapshotPage(offset:number,rows:HomeRecord[]):Promise<void> {
    const db=await this.open(),tx=db.transaction('meta','readwrite'),done=complete(tx);
    tx.objectStore('meta').put(rows,`snapshot-stage:${String(offset).padStart(12,'0')}`);await done;
  }
  /** Promote staged pages and the fixed cursor atomically, retaining local outbox edits. */
  async commitSnapshotStage(cursor:number):Promise<void> {
    const db=await this.open(),tx=db.transaction(['meta','records','shadow','outbox'],'readwrite'),done=complete(tx);
    const pending=await result(tx.objectStore('outbox').getAll()) as PendingOperation[];
    const pendingKeys=new Set(pending.map(item=>item.key));
    const records=tx.objectStore('records'),shadow=tx.objectStore('shadow'),meta=tx.objectStore('meta');
    records.clear();shadow.clear();
    const pages=meta.openCursor(IDBKeyRange.bound('snapshot-stage:','snapshot-stage:\uffff'));
    pages.onsuccess=()=>{
      const page=pages.result;
      if(page){for(const row of page.value as HomeRecord[]){const id=key(row.collection,row.id);shadow.put(row,id);if(!pendingKeys.has(id))records.put(row,id);}page.delete();page.continue();}
      else {
        for(const item of pending)records.put({collection:item.collection,id:item.id,version:item.baseVersion,data:item.data??null,deleted:item.kind==='delete'},item.key);
        meta.put(cursor,'cursor');meta.put(true,'initialized');
      }
    };
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
    this.assertWritable();
    const db = await this.open(); this.assertWritable();
    const tx = db.transaction(['records', 'outbox', 'shadow'], 'readwrite'); const done = complete(tx);
    const item = await result(tx.objectStore('outbox').get(recordKey)) as PendingOperation | undefined;
    this.assertWritable(tx, done);
    if (!item) { await done; return; }
    const remote = item.conflict !== undefined ? item.conflict : await result(tx.objectStore('shadow').get(recordKey)) as HomeRecord | undefined;
    this.assertWritable(tx, done);
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

