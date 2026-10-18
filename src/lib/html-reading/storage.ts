import {
  emptyReadingState, defaultSettings, settingsSchema, snapshotItems, snapshotViews,
  type ReadingSettings, type ReadingState, type ReadingSnapshot, type ReadingReturn, type ReadingPosition,
} from './model';
import { rememberCandidateSource, type ReadingCandidateSource, type ReadingStarBatch, type ReadingImportMetadata } from './candidates';
import { initializeReadingWorkspace, reconcileReadingProcessing, rememberProjectSource, rememberReadingImport, type ReadingProjectSource, type ReadingProcessing, type ReadingStarObservation, type ReadingLatestImport } from './workspace';
import { assertRepositoryIdentityWritable, assertRepositoryMaintenanceOwner } from '../../services/repositoryIdentityGate';

export interface StoredSnapshot {
  base: Record<string, ReadingState>;
  allowed: ReadingSettings['operations'];
  version?: 1 | 2;
  sequence?: number;
  views?: Record<string, number[]>;
  viewNames?: Record<string, string>;
  generatedAt?: string;
}
export interface StoredReadingPosition extends ReadingPosition { snapshotId: string; sequence: number }
interface StoredActiveView { id: string; viewId: string; revision: number; snapshotId: string; sequence: number }
export interface ReadingData {
  workspaceVersion?: 5; workspaceBackupAt?: string; projectRevisions?: Record<string, number>;
  projectSources?: Record<string, ReadingProjectSource>; processing?: Record<string, ReadingProcessing>;
  starObservations?: Record<string, ReadingStarObservation>; latestImport?: ReadingLatestImport;
  generationFailures?: Array<{ at: string; bytes: number; limitMb: number }>;
  storageVersion?: 2; migrationBackupAt?: string;
  artifactVersion?: 3;
  candidateVersion?: 4; candidateBackupAt?: string; candidateRevisions?: Record<string, number>;
  candidateSources?: Record<string, ReadingCandidateSource>; starBatches?: Record<string, ReadingStarBatch>;
  settings: ReadingSettings; states: Record<string, ReadingState>; names: Record<string, string>;
  applied: Record<string, string>; snapshots: Record<string, StoredSnapshot>;
  sequence?: number; positions?: Record<string, StoredReadingPosition>; activeView?: StoredActiveView | null;
  positionReceipts?: Record<string, string>;
}
export interface ReadingMigrationBackup { accountId: string; savedAt: string; data: ReadingData }
const empty = (): ReadingData => ({ storageVersion: 2, settings: structuredClone(defaultSettings), states: {}, names: {}, applied: {}, snapshots: {}, sequence: 0, positions: {}, activeView: null, positionReceipts: {} });
const backupKey = (account: string) => `${account}:before-v2`;
const owns = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

export function openReadingDb(readOnly = false) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('gsm-html-reading', 5);
    req.onupgradeneeded = () => {
      if (readOnly) { req.transaction!.abort(); return; }
      if (!req.result.objectStoreNames.contains('accounts')) req.result.createObjectStore('accounts');
      if (!req.result.objectStoreNames.contains('migration-backups')) req.result.createObjectStore('migration-backups');
      if (!req.result.objectStoreNames.contains('snapshots')) req.result.createObjectStore('snapshots').createIndex('account', 'accountId');
      if (!req.result.objectStoreNames.contains('discovery-cache')) req.result.createObjectStore('discovery-cache').createIndex('account', 'accountId');
      if (!req.result.objectStoreNames.contains('candidate-sources')) req.result.createObjectStore('candidate-sources').createIndex('account', 'accountId');
      if (!req.result.objectStoreNames.contains('star-batches')) req.result.createObjectStore('star-batches').createIndex('account', 'accountId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(readOnly && req.error?.name === 'AbortError' ? new Error('READING_SCHEMA_MIGRATION_REQUIRED') : req.error);
  });
}
function migrateData(data: ReadingData): ReadingData {
  data.settings = settingsSchema.parse({ ...defaultSettings, ...data.settings,
    fields: { ...defaultSettings.fields, ...data.settings?.fields },
    analysis: { ...defaultSettings.analysis, ...data.settings?.analysis },
    operations: { ...defaultSettings.operations, ...data.settings?.operations },
  });
  data.storageVersion = 2;
  data.sequence ??= 0; data.positions ??= {}; data.activeView ??= null; data.positionReceipts ??= {};
  if (!Number.isSafeInteger(data.sequence) || data.sequence < 0) throw new Error('阅读快照序号无效，请恢复阅读资料备份。');
  return data;
}
export interface ReadingLoadOptions {
  includeSnapshots?: boolean; snapshotIds?: string[] | ((data: ReadingData) => string[]);
  includeCandidates?: boolean; includeStarBatches?: boolean; validate?: () => void; signal?: AbortSignal;
  /** Read paths may proceed during identity maintenance; writers must prove ownership. */
  readOnly?: boolean;
  identityMaintenance?: { account: string; journalId: string };
}
export async function readingTransaction<T>(account: string, mutate: (data: ReadingData) => T, options: ReadingLoadOptions = {}): Promise<T> {
  if (!/^\d+$/.test(account)) throw new Error('请先登录 GitHub 账户。');
  const validateTransaction = () => {
    options.validate?.();
    if (options.readOnly) return;
    if (options.identityMaintenance) {
      if (options.identityMaintenance.account !== account) throw new Error('REPOSITORY_MAINTENANCE_OWNER_MISMATCH');
      assertRepositoryMaintenanceOwner(account, options.identityMaintenance.journalId);
    } else {
      assertRepositoryIdentityWritable(account);
    }
  };
  validateTransaction();
  if (options.readOnly && !(await indexedDB.databases()).some(database => database.name === 'gsm-html-reading')) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('READING_ABORTED');
    validateTransaction();
    const data = migrateData(empty());
    initializeReadingWorkspace(data);
    Object.assign(data, { candidateRevisions: {}, artifactVersion: 3, candidateVersion: 4, workspaceVersion: 5,
      ...(options.includeCandidates ? { candidateSources: {} } : {}), ...(options.includeStarBatches ? { starBatches: {} } : {}) });
    return mutate(data);
  }
  const db = await openReadingDb(options.readOnly);
  try {
    validateTransaction();
    return await new Promise<T>((resolve, reject) => {
      const stores = ['accounts', 'migration-backups', 'snapshots'];
      if (options.includeCandidates) stores.push('candidate-sources');
      if (options.includeStarBatches) stores.push('star-batches');
      const tx = db.transaction(stores, options.readOnly ? 'readonly' : 'readwrite');
      let result: T; let error: unknown;
      const abort = () => { try { validateTransaction(); } catch (cause) { error = cause; } error ??= options.signal?.reason; try { tx.abort(); } catch { /* Already settled. */ } };
      options.signal?.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(() => tx.abort(), 15000);
      const cleanup = () => { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); };
      tx.oncomplete = () => { cleanup(); resolve(result); };
      tx.onabort = tx.onerror = () => { cleanup(); reject(error ?? tx.error ?? new Error('阅读资料保存失败')); };
      if (options.signal?.aborted) { abort(); return; }
      const req = tx.objectStore('accounts').get(account);
      req.onsuccess = () => {
        const raw = req.result as ReadingData | undefined;
        const finish = (backup?: ReadingMigrationBackup, candidateBackup?: ReadingMigrationBackup, workspaceBackup?: ReadingMigrationBackup) => { try {
          if (options.readOnly && raw && (raw.workspaceVersion !== 5 || raw.candidateVersion !== 4 || raw.storageVersion !== 2 || raw.artifactVersion !== 3)) {
            throw new Error('READING_SCHEMA_MIGRATION_REQUIRED');
          }
          const data = raw ? structuredClone(raw) : empty();
          if (raw && raw.workspaceVersion !== 5) {
            const savedAt = workspaceBackup?.savedAt ?? new Date().toISOString();
            if (!workspaceBackup) tx.objectStore('migration-backups').add({ accountId: account, savedAt, data: structuredClone(raw) }, `${account}:before-workspace-v5`);
            data.workspaceBackupAt = savedAt;
          }
          initializeReadingWorkspace(data);
          if (raw && raw.workspaceVersion !== 5) for (const [id, state] of Object.entries(data.states)) {
            if (state.interest === 'ignored' && !data.processing![id]) data.processing![id] = { processed: true, reason: 'ignored', updatedAt: data.workspaceBackupAt! };
          }
          // Keep the untouched v3 account and existing artifact store until the first v4 write commits.
          if (raw && raw.candidateVersion !== 4) {
            const savedAt = candidateBackup?.savedAt ?? new Date().toISOString();
            if (!candidateBackup) tx.objectStore('migration-backups').add({ accountId: account, savedAt, data: structuredClone(raw) }, `${account}:before-candidates-v4`);
            data.candidateBackupAt = savedAt;
          }
          data.candidateRevisions ??= {};
          if (raw && raw.storageVersion !== 2) {
            const savedAt = backup?.savedAt ?? new Date().toISOString();
            // The backup and first v2 write commit together; failures leave the old account intact.
            if (!backup) tx.objectStore('migration-backups').add({ accountId: account, savedAt, data: structuredClone(raw) }, backupKey(account));
            data.migrationBackupAt = savedAt;
          }
          const artifacts = tx.objectStore('snapshots');
          const legacy = data.snapshots ?? {};
          if (raw && raw.artifactVersion !== 3) {
            tx.objectStore('migration-backups').put({ accountId: account, savedAt: new Date().toISOString(), data: structuredClone(raw) }, `${account}:before-artifacts-v3`);
            for (const [id, snapshot] of Object.entries(legacy)) artifacts.put({ accountId: account, snapshotId: id, data: snapshot }, [account, id]);
          }
          migrateData(data);
          const loaded: Record<string, StoredSnapshot> = Object.create(null) as Record<string, StoredSnapshot>;
          const persist = () => { try {
            validateTransaction();
            data.snapshots = loaded;
            if (options.readOnly) {
              // The callback receives a detached snapshot. Even an accidental
              // mutation cannot persist, increment revisions or create receipts.
              Object.assign(data, { artifactVersion: 3, candidateVersion: 4, workspaceVersion: 5 });
              result = mutate(data);
              return;
            }
            const original = new Map(Object.entries(loaded).map(([id, snapshot]) => [id, JSON.stringify(snapshot)]));
            const priorCandidates = new Map(Object.entries(data.states).map(([id, state]) => [id, state.candidate]));
            const priorStates = structuredClone(data.states);
            const priorProcessing = structuredClone(data.processing!);
            const projectOriginal = new Map(Object.keys(data.states).map(id => [id, JSON.stringify([data.names[id], data.states[id], data.projectSources?.[id], data.processing?.[id]])]));
            const sourceOriginal = new Map(Object.entries(data.candidateSources ?? {}).map(([id, source]) => [id, JSON.stringify(source)]));
            const batchOriginal = new Map(Object.entries(data.starBatches ?? {}).map(([id, batch]) => [id, JSON.stringify(batch)]));
            result = mutate(data);
            for (const id of options.identityMaintenance ? [] : new Set([...Object.keys(priorStates), ...Object.keys(data.states)])) {
              if (JSON.stringify(priorProcessing[id]) === JSON.stringify(data.processing?.[id])) reconcileReadingProcessing(data, id, priorStates[id] ?? emptyReadingState(), data.states[id] ?? emptyReadingState());
              if (projectOriginal.get(id) !== JSON.stringify([data.names[id], data.states[id], data.projectSources?.[id], data.processing?.[id]])) data.projectRevisions![id] = (data.projectRevisions![id] ?? 0) + 1;
            }
            for (const id of options.identityMaintenance ? [] : new Set([...priorCandidates.keys(), ...Object.keys(data.states)])) {
              if ((priorCandidates.get(id) ?? false) !== (data.states[id]?.candidate ?? false)) data.candidateRevisions![id] = (data.candidateRevisions![id] ?? 0) + 1;
            }
            for (const [id, snapshot] of Object.entries(data.snapshots)) if (original.get(id) !== JSON.stringify(snapshot)) artifacts.put({ accountId: account, snapshotId: id, data: snapshot }, [account, id]);
            for (const id of original.keys()) if (!owns(data.snapshots, id)) artifacts.delete([account, id]);
            const saveOptional = (storeName: string, values: Record<string, unknown>, before: Map<string, string>) => {
              const store = tx.objectStore(storeName);
              for (const [id, value] of Object.entries(values)) if (before.get(id) !== JSON.stringify(value)) store.put({ accountId: account, id, data: value }, [account, id]);
              for (const id of before.keys()) if (!owns(values, id)) store.delete([account, id]);
            };
            if (options.includeCandidates) saveOptional('candidate-sources', data.candidateSources ?? {}, sourceOriginal);
            if (options.includeStarBatches) {
              if (Object.values(data.starBatches ?? {}).some(batch => batch.accountId !== account)) throw new Error('收藏批次属于其他 GitHub 账户。');
              saveOptional('star-batches', data.starBatches ?? {}, batchOriginal);
            }
            const record = Object.fromEntries(Object.entries(data).filter(([key]) => !['snapshots', 'candidateSources', 'starBatches'].includes(key)));
            tx.objectStore('accounts').put({ ...record, artifactVersion: 3, candidateVersion: 4, workspaceVersion: 5 }, account);
          } catch (e) { error = e; tx.abort(); } };
          const complete = () => {
            let pending = Number(!!options.includeCandidates) + Number(!!options.includeStarBatches);
            if (!pending) { persist(); return; }
            const loadOptional = (storeName: string, field: 'candidateSources' | 'starBatches') => {
              const read = tx.objectStore(storeName).index('account').getAll(account);
              read.onsuccess = () => {
                Object.assign(data, { [field]: Object.fromEntries(read.result.map(record => [record.id, record.data])) });
                if (--pending === 0) persist();
              };
            };
            if (options.includeCandidates) loadOptional('candidate-sources', 'candidateSources');
            if (options.includeStarBatches) loadOptional('star-batches', 'starBatches');
          };
          const snapshotIds = typeof options.snapshotIds === 'function' ? options.snapshotIds(data) : options.snapshotIds;
          if (snapshotIds) {
            let pending = new Set(snapshotIds).size;
            if (!pending) complete();
            for (const id of new Set(snapshotIds)) { const read = artifacts.get([account, id]); read.onsuccess = () => { if (read.result) loaded[id] = read.result.data; if (--pending === 0) complete(); }; }
          } else if (options.includeSnapshots === false) complete();
          else { const read = artifacts.index('account').getAll(account); read.onsuccess = () => { for (const record of read.result) loaded[record.snapshotId] = record.data; complete(); }; }
        } catch (e) { error = e; tx.abort(); } };
        const prepareWorkspace = (backup?: ReadingMigrationBackup, candidateBackup?: ReadingMigrationBackup) => {
          if (raw && raw.workspaceVersion !== 5) {
            const saved = tx.objectStore('migration-backups').get(`${account}:before-workspace-v5`);
            saved.onsuccess = () => finish(backup, candidateBackup, saved.result);
          } else finish(backup, candidateBackup);
        };
        const begin = (backup?: ReadingMigrationBackup) => {
          if (raw && raw.candidateVersion !== 4) {
            const candidateBackup = tx.objectStore('migration-backups').get(`${account}:before-candidates-v4`);
            candidateBackup.onsuccess = () => prepareWorkspace(backup, candidateBackup.result);
          } else prepareWorkspace(backup);
        };
        if (raw && raw.storageVersion !== 2) {
          const backup = tx.objectStore('migration-backups').get(backupKey(account));
          backup.onsuccess = () => begin(backup.result);
        } else begin();
      };
    });
  } finally { db.close(); }
}
export async function loadReadingMigrationBackup(account: string, version: 'v2' | 'artifacts-v3' | 'candidates-v4' | 'workspace-v5' = 'v2'): Promise<ReadingMigrationBackup | null> {
  if (!/^\d+$/.test(account)) throw new Error('请先登录 GitHub 账户。');
  const db = await openReadingDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction('migration-backups', 'readonly').objectStore('migration-backups').get(version === 'v2' ? backupKey(account) : `${account}:before-${version}`);
      req.onsuccess = () => resolve(req.result ?? null); req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}
export const loadReadingData = (account: string, options?: ReadingLoadOptions) => readingTransaction(account, data => structuredClone(data), options);
export const saveReadingSettings = async (account: string, settings: ReadingSettings) => {
  await readingTransaction(account, data => { data.settings = settingsSchema.parse(settings); }, { includeSnapshots: false });
  window.dispatchEvent(new Event('gsm:html-reading-settings'));
};

function fallbackView(viewId: string, views: Record<string, number[]>) {
  if (owns(views, viewId)) return { viewId, notice: undefined as string | undefined };
  const channel = viewId.split('::')[0];
  const edition = Object.keys(views).find(id => id.split('::')[0] === channel);
  if (edition) return { viewId: edition, notice: '原期刊未包含在本次导出中，已返回该频道最新一期。' };
  return { viewId: owns(views, 'repositories') ? 'repositories' : Object.keys(views)[0], notice: '原频道未包含在本次导出中，已返回可用阅读页面。' };
}
function resolveSnapshotResume(data: ReadingData, snapshot: ReadingSnapshot) {
  const views = snapshotViews(snapshot); const resolved = new Map<string, { viewId: string; repoId: number; notice?: string }>();
  const notices = new Set<string>();
  const savedPositions = Object.values(data.positions ?? {}).sort((a, b) => a.sequence - b.sequence || a.revision - b.revision);
  for (const position of savedPositions) {
    const target = fallbackView(position.viewId, views);
    if (!target.viewId) continue;
    const current = views[target.viewId]; let repoId = current.includes(position.repoId) ? position.repoId : undefined;
    let notice = target.notice;
    if (!repoId && !target.notice) {
      const prior = data.snapshots[position.snapshotId]?.views?.[position.viewId] ?? [];
      const index = prior.indexOf(position.repoId); const available = new Set(current);
      for (let offset = 1; index >= 0 && offset < prior.length && !repoId; offset++) {
        if (available.has(prior[index + offset])) repoId = prior[index + offset];
        else if (available.has(prior[index - offset])) repoId = prior[index - offset];
      }
      notice = '上次阅读的项目未包含在本次导出中，已定位到附近可用项目。';
    }
    repoId ??= current[0];
    if (repoId) resolved.set(target.viewId, { viewId: target.viewId, repoId, ...(notice ? { notice } : {}) });
    else if (notice) notices.add(notice);
  }
  let activeViewId: string | undefined;
  if (data.activeView) {
    const target = fallbackView(data.activeView.viewId, views); activeViewId = target.viewId;
    if (target.notice && activeViewId) {
      const resume = resolved.get(activeViewId);
      const first = views[activeViewId][0];
      if (resume) resume.notice = target.notice;
      else if (first) resolved.set(activeViewId, { viewId: activeViewId, repoId: first, notice: target.notice });
      else notices.add(target.notice);
    }
  }
  return { resume: [...resolved.values()], activeViewId, notices: [...notices] };
}
export async function restoreReadingSnapshotResume(account: string, snapshot: ReadingSnapshot, validate?: () => void, signal?: AbortSignal) {
  const data = await readingTransaction(account, data => structuredClone(data), { validate, signal, snapshotIds: data => Object.values(data.positions ?? {}).map(position => position.snapshotId) });
  const saved = resolveSnapshotResume(data, snapshot);
  snapshot.resume = saved.resume; snapshot.activeViewId = saved.activeViewId;
  if (saved.notices.length) snapshot.warnings = [...new Set([...(snapshot.warnings ?? []), ...saved.notices])];
}
export async function rememberSnapshot(account: string, snapshot: ReadingSnapshot, validate?: () => void, signal?: AbortSignal) {
  const saved = await readingTransaction(account, data => {
    if (snapshot.accountId !== account) throw new Error('账户已变更，请重新生成。');
    if (data.snapshots[snapshot.id]) throw new Error('导出快照标识已存在，请重新生成。');
    const base: Record<string, ReadingState> = {};
    for (const item of snapshotItems(snapshot)) { base[item.id] = { ...item.state }; data.names[item.id] = item.name; }
    const sequence = (data.sequence ?? 0) + 1;
    if (!Number.isSafeInteger(sequence)) throw new Error('阅读快照序号已超出范围。');
    data.sequence = sequence;
    const resume = snapshot.version === 2 ? resolveSnapshotResume(data, snapshot) : { resume: [], activeViewId: undefined, notices: [] };
    const viewNames: Record<string, string> = {};
    for (const section of snapshot.sections) {
      if (section.editions?.length) for (const edition of section.editions) viewNames[`${section.id}::${encodeURIComponent(edition.id)}`] = `${section.title} · ${edition.date}`;
      else viewNames[section.id] = section.title;
    }
    data.snapshots[snapshot.id] = { base, allowed: { ...snapshot.settings.operations }, version: snapshot.version, sequence, views: snapshotViews(snapshot), viewNames, generatedAt: snapshot.generatedAt };
    return { sequence, ...resume };
  }, { validate, signal, snapshotIds: data => [snapshot.id, ...Object.values(data.positions ?? {}).map(position => position.snapshotId)] });
  if (snapshot.version === 2) {
    snapshot.sequence = saved.sequence; snapshot.resume = saved.resume; snapshot.activeViewId = saved.activeViewId;
    if (saved.notices.length) snapshot.warnings = [...new Set([...(snapshot.warnings ?? []), ...saved.notices])];
  }
}

export interface ImportRow { op: ReadingReturn['operations'][number]; name: string; status: 'ready' | 'duplicate' | 'conflict'; current: ReadingState[keyof ReadingState] }
function originalSnapshot(data: ReadingData, account: string, input: ReadingReturn) {
  if (new Blob([JSON.stringify(input)]).size > 4_000_000) throw new Error('回传内容超过 4 MB，请分批导出。');
  if (input.accountId !== account) throw new Error('这份回传文件属于其他 GitHub 账户。');
  const snapshot = owns(data.snapshots, input.snapshotId) ? data.snapshots[input.snapshotId] : undefined;
  if (!snapshot) throw new Error('找不到原始导出快照，请在生成文件的电脑账户中导入。');
  return snapshot;
}
export function inspectReadingReturn(data: ReadingData, account: string, input: ReadingReturn): ImportRow[] {
  const snapshot = originalSnapshot(data, account, input);
  const ids = new Set<string>(), targets = new Set<string>();
  return input.operations.map(op => {
    const base = snapshot.base[op.repoId];
    if (!base || !snapshot.allowed[op.field] || base[op.field] !== op.base) throw new Error('回传操作不匹配原始文件。');
    const valid = op.field === 'interest' ? ['neutral', 'interested', 'ignored'].includes(String(op.value)) && typeof op.value === 'string' : op.field === 'note' ? typeof op.value === 'string' : typeof op.value === 'boolean';
    const target = `${op.repoId}:${op.field}`;
    if (!valid || ids.has(op.id) || targets.has(target)) throw new Error('回传内容有非法或重复字段。'); ids.add(op.id); targets.add(target);
    const signature = JSON.stringify(op);
    if ((data.applied[op.id] && data.applied[op.id] !== signature) || data.positionReceipts?.[op.id]) throw new Error('操作 ID 已被不同内容使用。');
    const current = (data.states[op.repoId] ?? emptyReadingState())[op.field];
    return { op, name: data.names[op.repoId] ?? String(op.repoId), current, status: data.applied[op.id] ? 'duplicate' : current === op.base || current === op.value ? 'ready' : 'conflict' };
  });
}
export interface ImportPositionRow {
  kind: 'position' | 'active'; id: string; viewId: string; repoId?: number; revision: number;
  name: string; viewName: string; status: 'ready' | 'stale' | 'duplicate'; current: string | null;
}
const receiptSignature = (snapshotId: string, kind: ImportPositionRow['kind'], value: object) => JSON.stringify({ snapshotId, kind, value });
function isNewer(sequence: number, revision: number, current?: { sequence: number; revision: number } | null) {
  return !current || sequence > current.sequence || (sequence === current.sequence && revision > current.revision);
}
export function inspectReadingPositions(data: ReadingData, account: string, input: ReadingReturn): ImportPositionRow[] {
  const snapshot = originalSnapshot(data, account, input);
  if (input.version === 1) return [];
  if (snapshot.version !== 2 || !snapshot.sequence || !snapshot.views) throw new Error('阅读位置不匹配新版原始导出文件。');
  const ids = new Set(input.operations.map(op => op.id)); const views = new Set<string>(); const rows: ImportPositionRow[] = [];
  const addRow = (kind: ImportPositionRow['kind'], value: ReadingPosition | NonNullable<Extract<ReadingReturn, { version: 2 }>['activeView']>) => {
    const repos = owns(snapshot.views!, value.viewId) ? snapshot.views![value.viewId] : undefined;
    if (!repos || (kind === 'position' && (!('repoId' in value) || !repos.includes(value.repoId)))) throw new Error('继续阅读位置不属于原始频道或期刊。');
    if (ids.has(value.id) || (kind === 'position' && views.has(value.viewId))) throw new Error('回传内容有重复阅读位置。');
    ids.add(value.id); if (kind === 'position') views.add(value.viewId);
    const signature = receiptSignature(input.snapshotId, kind, value); const receipt = data.positionReceipts?.[value.id];
    if ((receipt && receipt !== signature) || data.applied[value.id]) throw new Error('位置 ID 已被不同内容使用。');
    const current = kind === 'position' ? data.positions && owns(data.positions, value.viewId) ? data.positions[value.viewId] : undefined : data.activeView;
    rows.push({ kind, id: value.id, viewId: value.viewId, ...('repoId' in value ? { repoId: value.repoId } : {}), revision: value.revision,
      name: 'repoId' in value ? data.names[value.repoId] ?? String(value.repoId) : '下次打开的页面',
      viewName: snapshot.viewNames?.[value.viewId] ?? value.viewId, current: current ? JSON.stringify(current) : null,
      status: receipt ? 'duplicate' : isNewer(snapshot.sequence!, value.revision, current) ? 'ready' : 'stale',
    });
  };
  input.positions.forEach(position => addRow('position', position));
  if (input.activeView) addRow('active', input.activeView);
  return rows;
}
export const applyReadingReturn = (account: string, input: ReadingReturn, choices: Record<string, 'phone' | 'desktop'>, expected?: ImportRow[], expectedPositions?: ImportPositionRow[], metadata: ReadingImportMetadata = {}) => readingTransaction(account, data => {
  const rows = inspectReadingReturn(data, account, input); const positions = inspectReadingPositions(data, account, input);
  const importId = metadata.importId ?? crypto.randomUUID(); const importedAt = new Date().toISOString();
  const acceptedIds = new Set<string>();
  let applied = 0, duplicate = 0, kept = 0, unchanged = 0;
  if (expected && rows.some(row => row.status !== 'duplicate' && row.current !== expected.find(prior => prior.op.id === row.op.id)?.current)) throw new Error('电脑记录在预览后发生变化，请重新预览。');
  if (expectedPositions && positions.some(row => row.status !== 'duplicate' && row.current !== expectedPositions.find(prior => prior.id === row.id && prior.kind === row.kind)?.current)) throw new Error('继续阅读位置在预览后发生变化，请重新预览。');
  for (const row of rows) {
    if (row.status === 'duplicate') { duplicate++; continue; }
    if (row.status === 'conflict' && !choices[row.op.id]) throw new Error('请处理所有冲突后再导入。');
    if (choices[row.op.id] === 'desktop') kept++;
    else {
      if (row.current === row.op.value) unchanged++;
      else {
        const state = data.states[row.op.repoId] ?? emptyReadingState(); Object.assign(state, { [row.op.field]: row.op.value }); data.states[row.op.repoId] = state; applied++;
      }
      data.states[row.op.repoId] ??= emptyReadingState();
      acceptedIds.add(String(row.op.repoId));
      rememberProjectSource(data, { repoId: row.op.repoId, operationId: row.op.id, fileName: metadata.fileName ?? '粘贴回传', snapshotId: input.snapshotId, generatedAt: data.snapshots[input.snapshotId].generatedAt, importedAt, importId });
      if (row.op.field === 'candidate' && row.op.value === true) {
        rememberCandidateSource(data, { repoId: row.op.repoId, operationId: row.op.id, fileName: metadata.fileName ?? '粘贴回传', snapshotId: input.snapshotId, generatedAt: data.snapshots[input.snapshotId].generatedAt, importedAt, importId });
      }
    }
    data.applied[row.op.id] = JSON.stringify(row.op);
  }
  rememberReadingImport(data, importId, importedAt, acceptedIds);
  if (input.version === 1) return { applied, duplicate, kept, ...(unchanged ? { unchanged } : {}), ...(acceptedIds.size ? { importId } : {}) };
  let positionApplied = 0, positionStale = 0, positionDuplicate = 0;
  const sequence = data.snapshots[input.snapshotId].sequence!;
  for (const row of positions) {
    if (row.status === 'duplicate') { positionDuplicate++; continue; }
    const value = row.kind === 'active' ? input.activeView! : input.positions.find(position => position.id === row.id)!;
    if (row.status === 'stale') positionStale++;
    else {
      if (row.kind === 'active') data.activeView = { ...input.activeView!, snapshotId: input.snapshotId, sequence };
      else Object.defineProperty(data.positions!, row.viewId, { value: { ...(value as ReadingPosition), snapshotId: input.snapshotId, sequence }, configurable: true, writable: true, enumerable: true });
      positionApplied++;
    }
    data.positionReceipts![row.id] = receiptSignature(input.snapshotId, row.kind, value);
  }
  return { applied, duplicate, kept, positionApplied, positionStale, positionDuplicate, ...(unchanged ? { unchanged } : {}), ...(acceptedIds.size ? { importId } : {}) };
}, { snapshotIds: [input.snapshotId], includeCandidates: true });
