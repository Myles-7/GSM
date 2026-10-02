import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { identityWriteNeedsConfirmation, identityWriteNeedsUpgrade } from './repositoryIdentity.js';

export const COLLECTIONS = ['repositories', 'organization', 'releases', 'release_reads', 'subscriptions', 'sessions', 'messages', 'evidence', 'projects', 'proposals', 'discovery_config', 'discovery_subscriptions', 'discovery_reads', 'discovery_history', 'discovery_editions'] as const;
export type Collection = typeof COLLECTIONS[number];
export interface SyncRecord { collection: Collection; id: string; data: Record<string, unknown> | null; version: number; seq: number; deleted: boolean }
export interface Operation { opId: string; collection: Collection; id: string; baseVersion: number; kind: 'put' | 'delete'; data?: Record<string, unknown>; source?: 'user' | 'ai' }
export class SyncError extends Error { constructor(public code: string, public status = 400) { super(code); } }
export function initializeSyncV2(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_v2_workspace (id TEXT PRIMARY KEY, github_user_id INTEGER NOT NULL, initialized_at TEXT NOT NULL, floor_seq INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sync_v2_records (collection TEXT NOT NULL,id TEXT NOT NULL,data TEXT,version INTEGER NOT NULL,seq INTEGER NOT NULL,deleted INTEGER NOT NULL,PRIMARY KEY(collection,id));
    CREATE TABLE IF NOT EXISTS sync_v2_changes (seq INTEGER PRIMARY KEY AUTOINCREMENT,record TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_v2_operations (client_id TEXT NOT NULL,op_id TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(client_id,op_id));
    CREATE TABLE IF NOT EXISTS sync_v2_conflicts (id TEXT PRIMARY KEY,collection TEXT NOT NULL,record_id TEXT NOT NULL,incoming TEXT NOT NULL,current_record TEXT,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_v2_previews (id TEXT PRIMARY KEY,digest TEXT NOT NULL,github_user_id INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_v2_snapshots (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,boundary INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_v2_snapshot_rows (snapshot_id TEXT NOT NULL,ordinal INTEGER NOT NULL,record TEXT NOT NULL,PRIMARY KEY(snapshot_id,ordinal));
  `);
}
export function getWorkspace(db: Database.Database): { id: string; githubUserId: number; initializedAt: string } | null {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_v2_workspace'").get()) return null;
  const row = db.prepare('SELECT id, github_user_id AS githubUserId, initialized_at AS initializedAt FROM sync_v2_workspace LIMIT 1').get();
  return (row as ReturnType<typeof getWorkspace>) ?? null;
}
export function assertWorkspace(db: Database.Database, workspaceId: string, githubUserId: number) {
  const workspace = getWorkspace(db);
  if (!workspace) throw new SyncError('WORKSPACE_UNINITIALIZED', 409);
  if (workspace.id !== workspaceId || workspace.githubUserId !== githubUserId) throw new SyncError('WORKSPACE_ACCOUNT_MISMATCH', 403);
  return workspace;
}
const secretKey = /(?:token|password|secret|api[_-]?key|authorization|credential|local[_-]?path|file[_-]?path|download[_-]?(?:path|directory)|cache[_-]?path|proxy[_-]?url|encrypted)/i;
/** Fail closed: no silently truncated or partially accepted credential-bearing objects. */
export function validateData(value: unknown, depth = 0): void {
  if (depth > 24) throw new SyncError('PAYLOAD_TOO_DEEP');
  if (typeof value === 'string') {
    if (/^(?:[a-z]:[\\/]|file:\/\/|\\\\|\/(?:Users|home|mnt|var|tmp)\/)/i.test(value) || /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})/.test(value)) throw new SyncError('PRIVATE_DATA_NOT_SYNCABLE');
  } else if (Array.isArray(value)) { for (const entry of value) validateData(entry, depth + 1); }
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (secretKey.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new SyncError('PRIVATE_DATA_NOT_SYNCABLE');
      validateData(entry, depth + 1);
    }
  } else if (value !== null && !['number', 'boolean'].includes(typeof value)) throw new SyncError('INVALID_DATA');
}
function identifier(value: unknown) { return typeof value === 'string' && value.length > 0 && value.length <= 200 && !Array.from(value).some(character => character.charCodeAt(0) < 32); }
function validateOrganization(data: Record<string, unknown>) {
  const categories = data.customCategories ?? [];
  const subs = data.subcategories ?? [];
  if (!Array.isArray(categories) || !Array.isArray(subs)) throw new SyncError('INVALID_ORGANIZATION');
  const uniqueIds = (rows: unknown[]) => {
    const ids = new Set<string>();
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      if (!r || !identifier(r.id) || typeof r.name !== 'string' || !r.name.trim() || ids.has(r.id as string)) throw new SyncError('INVALID_ORGANIZATION');
      ids.add(r.id as string);
    }
    return ids;
  };
  uniqueIds(categories); uniqueIds(subs);
  for (const row of subs) if (!identifier(row.parentId) || row.parentId === row.id) throw new SyncError('INVALID_ORGANIZATION');
  for (const key of ['categoryOrder', 'subcategoryOrder', 'hiddenDefaultCategoryIds', 'repositoryOrder']) {
    const order = data[key];
    if (order !== undefined && (!Array.isArray(order) || new Set(order).size !== order.length || order.some(id => key === 'repositoryOrder' ? !Number.isSafeInteger(id) || id <= 0 : !identifier(id)))) throw new SyncError('INVALID_ORGANIZATION');
  }
  for (const key of ['defaultCategoryOverrides', 'categoryListIdMap', 'releaseSourceSettings']) if (data[key] !== undefined && (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key]))) throw new SyncError('INVALID_ORGANIZATION');
}
export function validateOperation(op: Operation) {
  if (!op || !identifier(op.opId) || !identifier(op.id) || !COLLECTIONS.includes(op.collection) || !Number.isSafeInteger(op.baseVersion) || op.baseVersion < 0 || !['put', 'delete'].includes(op.kind) || (op.source && !['user', 'ai'].includes(op.source))) throw new SyncError('INVALID_OPERATION');
  if (['organization','discovery_config'].includes(op.collection) && op.id !== 'default') throw new SyncError('ORGANIZATION_SINGLETON_REQUIRED');
  if (op.kind === 'put') {
    if (!op.data || typeof op.data !== 'object' || Array.isArray(op.data)) throw new SyncError('INVALID_RECORD');
    if (JSON.stringify(op.data).length > 2_000_000) throw new SyncError('RECORD_TOO_LARGE', 413);
    validateData(op.data);
    if (op.collection === 'organization') validateOrganization(op.data);
  }
}
export function getRecord(db: Database.Database, collection: string, id: string): SyncRecord | null {
  const r = db.prepare('SELECT * FROM sync_v2_records WHERE collection=? AND id=?').get(collection, id) as (Omit<SyncRecord, 'data'> & { data: string | null }) | undefined;
  return r ? { ...r, data: r.data ? JSON.parse(r.data) : null, deleted: !!r.deleted } : null;
}
export function currentCursor(db: Database.Database) { return (db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM sync_v2_records').get() as { seq: number }).seq; }
function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
/** Transactional compatibility projection: old read-only API/MCP consumers see current data. */
function projectLegacy(db: Database.Database, record: SyncRecord) {
  const tableExists = (table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  const data = record.data ?? {};
  const writeRow = (table: string, values: Record<string, unknown>) => {
    const schema = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number; dflt_value: unknown; pk: number }[];
    const existing = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(values.id) as Record<string, unknown> | undefined;
    const merged = { ...existing, ...values };
    for (const column of schema) if (column.notnull && column.dflt_value === null && merged[column.name] == null) throw new SyncError('LEGACY_REQUIRED_FIELD_MISSING');
    const columns = schema.map(c => c.name).filter(name => merged[name] !== undefined);
    const bindings = columns.map(name => { const value = merged[name]; return value === null ? null : typeof value === 'boolean' ? Number(value) : typeof value === 'object' ? JSON.stringify(value) : value as string | number; });
    db.prepare(`INSERT INTO ${table} (${columns.map(c => `"${c}"`).join(',')}) VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.filter(c => c !== 'id').map(c => `"${c}"=excluded."${c}"`).join(',')}`).run(...bindings);
  };
  if (record.collection === 'repositories' || record.collection === 'releases') {
    const table = record.collection;
    if (!tableExists(table)) return;
    if (!/^\d+$/.test(record.id) || !Number.isSafeInteger(Number(record.id))) throw new SyncError('INVALID_GITHUB_RECORD_ID');
    if (record.deleted) { db.prepare(`DELETE FROM ${table} WHERE id=?`).run(Number(record.id)); return; }
    const row: Record<string, unknown> = { ...data, id: Number(record.id) };
    if (table === 'repositories') {
      const owner = data.owner as Record<string, unknown> | undefined;
      row.owner_login = data.owner_login ?? owner?.login ?? '';
      row.owner_avatar_url = data.owner_avatar_url ?? owner?.avatar_url ?? null;
      if (data.category_id !== undefined) row.category_id_defined = 1;
      if (data.license && typeof data.license === 'object') row.license = (data.license as Record<string, unknown>).spdx_id ?? null;
      const subscription = getRecord(db, 'subscriptions', record.id);
      if (subscription && !subscription.deleted) row.subscribed_to_releases = !!(subscription.data?.subscribed ?? subscription.data?.enabled);
    } else {
      const repository = data.repository as Record<string, unknown> | undefined;
      row.repo_id = data.repo_id ?? repository?.id;
      row.repo_name = data.repo_name ?? repository?.name;
      row.repo_full_name = data.repo_full_name ?? repository?.full_name;
      const read = getRecord(db, 'release_reads', record.id);
      if (read && !read.deleted) row.is_read = !!(read.data?.is_read ?? read.data?.isRead);
    }
    writeRow(table, row);
  } else if (record.collection === 'release_reads' && tableExists('releases')) {
    db.prepare('UPDATE releases SET is_read=? WHERE id=?').run(Number(!record.deleted && !!(data.is_read ?? data.isRead)), Number(record.id));
  } else if (record.collection === 'subscriptions' && tableExists('repositories')) {
    db.prepare('UPDATE repositories SET subscribed_to_releases=? WHERE id=?').run(Number(!record.deleted && !!(data.subscribed ?? data.enabled)), Number(record.id));
  } else if (record.collection === 'organization' && tableExists('settings')) {
    const keys = ['customCategories', 'hiddenDefaultCategoryIds', 'categoryOrder', 'subcategories', 'subcategoryOrder', 'repositoryOrder', 'defaultCategoryOverrides', 'categoryListIdMap', 'releaseSourceSettings'];
    for (const key of keys) {
      if (record.deleted || data[key] === undefined) db.prepare('DELETE FROM settings WHERE key=?').run(key);
      else db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(data[key]));
    }
    if (tableExists('categories')) {
      db.prepare('DELETE FROM categories WHERE is_custom=1').run();
      for (const category of (data.customCategories ?? []) as Record<string, unknown>[]) writeRow('categories', { ...category, is_custom: 1 });
    }
  }
}
export function writeCanonicalRecord(db: Database.Database, input: Pick<SyncRecord, 'collection'|'id'|'data'|'deleted'>): SyncRecord {
  const current = getRecord(db, input.collection, input.id);
  const record: SyncRecord = { ...input, version: (current?.version ?? 0) + 1, seq: 0 };
  const row = db.prepare('INSERT INTO sync_v2_changes(record,created_at) VALUES(?,?)').run('{}', Date.now());
  record.seq = Number(row.lastInsertRowid);
  db.prepare('UPDATE sync_v2_changes SET record=? WHERE seq=?').run(JSON.stringify(record), record.seq);
  db.prepare('INSERT INTO sync_v2_records VALUES(?,?,?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data,version=excluded.version,seq=excluded.seq,deleted=excluded.deleted').run(record.collection,record.id,JSON.stringify(record.data),record.version,record.seq,Number(record.deleted));
  projectLegacy(db, record);
  return record;
}
export function pushOperations(db: Database.Database, input: { workspaceId: string; githubUserId: number; clientId: string; operations: Operation[] }) {
  assertWorkspace(db, input.workspaceId, input.githubUserId);
  if (!identifier(input.clientId) || !Array.isArray(input.operations) || input.operations.length > 500) throw new SyncError('INVALID_BATCH');
  input.operations.forEach(validateOperation);
  return db.transaction(() => {
    const results = input.operations.map(op => {
      const hash = digest(op);
      const previous = db.prepare('SELECT digest,result FROM sync_v2_operations WHERE client_id=? AND op_id=?').get(input.clientId, op.opId) as { digest: string; result: string } | undefined;
      if (previous) {
        if (previous.digest !== hash) throw new SyncError('OPERATION_ID_REUSED', 409);
        return JSON.parse(previous.result);
      }
      const current = getRecord(db, op.collection, op.id);
      const locked = op.source === 'ai' && current?.data && (current.data.locked || current.data.category_locked || current.data.categoryLocked || current.data.userLocked);
      let result;
      const identityUpgrade = identityWriteNeedsUpgrade(db, input.workspaceId, op.collection, op.id, op.data);
      const identityConfirmation = op.kind === 'put' && identityWriteNeedsConfirmation(db, op.collection, op.id, op.data);
      const configUpgrade = op.collection === 'discovery_config' && (current?.data?.schemaVersion === 2 && op.data?.schemaVersion !== 2);
      if ((current?.version ?? 0) !== op.baseVersion || locked || identityUpgrade || identityConfirmation || configUpgrade) {
        const conflict = { id: randomUUID(), reason: identityUpgrade ? 'REPOSITORY_IDENTITY_UPGRADE_REQUIRED' : identityConfirmation ? 'REPOSITORY_IDENTITY_CONFIRMATION_REQUIRED' : configUpgrade ? 'DISCOVERY_CONFIG_UPGRADE_REQUIRED' : locked ? 'USER_LOCKED' : 'VERSION_MISMATCH', incoming: op, current };
        db.prepare('INSERT INTO sync_v2_conflicts VALUES(?,?,?,?,?,?)').run(conflict.id, op.collection, op.id, JSON.stringify(op), JSON.stringify(current), Date.now());
        result = { opId: op.opId, status: 'conflict', conflict };
      } else {
        const record = writeCanonicalRecord(db, { collection: op.collection, id: op.id, deleted: op.kind === 'delete', data: op.kind === 'delete' ? null : op.data! });
        result = { opId: op.opId, status: 'applied', record };
      }
      db.prepare('INSERT INTO sync_v2_operations VALUES(?,?,?,?)').run(input.clientId, op.opId, hash, JSON.stringify(result));
      return result;
    });
    return { results, cursor: currentCursor(db) };
  }).immediate();
}
export function bootstrapWorkspace(db: Database.Database, input: { githubUserId: number; source: string; records: { collection: Collection; id: string; data: Record<string, unknown> }[]; confirm?: boolean; previewToken?: string }) {
  if (getWorkspace(db)) throw new SyncError('WORKSPACE_ALREADY_INITIALIZED', 409);
  if (!Number.isSafeInteger(input.githubUserId) || input.githubUserId < 1 || input.source !== 'desktop' || !Array.isArray(input.records) || !input.records.some(r => r.collection === 'repositories') || input.records.length > 100000) throw new SyncError('DESKTOP_NONEMPTY_SNAPSHOT_REQUIRED');
  const seen = new Set<string>();
  for (const r of input.records) {
    validateOperation({ ...r, opId: r.id, kind: 'put', baseVersion: 0 });
    const key = `${r.collection}:${r.id}`;
    if (seen.has(key)) throw new SyncError('DUPLICATE_RECORD');
    seen.add(key);
  }
  const hash = digest({ githubUserId: input.githubUserId, records: input.records });
  if (!input.confirm) {
    const previewToken = randomUUID();
    db.prepare('INSERT INTO sync_v2_previews VALUES(?,?,?,?)').run(previewToken, hash, input.githubUserId, Date.now() + 600000);
    const legacyCounts = Object.fromEntries(['repositories', 'releases'].map(table => [table, db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) ? (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n : 0]));
    return { previewToken, count: input.records.length, counts: Object.fromEntries(COLLECTIONS.map(c => [c, input.records.filter(r => r.collection === c).length])), legacyCounts, requiresConfirmation: true };
  }
  return db.transaction(() => {
    if (getWorkspace(db)) throw new SyncError('WORKSPACE_ALREADY_INITIALIZED', 409);
    const preview = db.prepare('SELECT * FROM sync_v2_previews WHERE id=?').get(input.previewToken ?? '') as { digest: string; github_user_id: number; expires_at: number } | undefined;
    if (!preview || preview.digest !== hash || preview.github_user_id !== input.githubUserId || preview.expires_at < Date.now()) throw new SyncError('BOOTSTRAP_PREVIEW_EXPIRED', 409);
    const workspace = { id: randomUUID(), githubUserId: input.githubUserId, initializedAt: new Date().toISOString() };
    // The preview describes a full desktop import; discard old unbound projections atomically.
    for (const table of ['repositories', 'releases']) if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) db.prepare(`DELETE FROM ${table}`).run();
    db.prepare('INSERT INTO sync_v2_workspace(id,github_user_id,initialized_at) VALUES(?,?,?)').run(workspace.id, workspace.githubUserId, workspace.initializedAt);
    for (let offset = 0; offset < input.records.length; offset += 500) pushOperations(db, { workspaceId: workspace.id, githubUserId: workspace.githubUserId, clientId: 'bootstrap', operations: input.records.slice(offset, offset + 500).map(r => ({ ...r, opId: `${r.collection}:${r.id}`, kind: 'put', baseVersion: 0 })) });
    db.prepare('DELETE FROM sync_v2_previews').run();
    return { workspace, cursor: currentCursor(db), imported: input.records.length };
  }).immediate();
}
export function pruneSyncHistory(db: Database.Database, now = Date.now()) {
  db.transaction(() => {
    const cutoff = now - 90 * 86400000;
    const { seq } = db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM sync_v2_changes WHERE created_at<?').get(cutoff) as { seq: number };
    db.prepare('UPDATE sync_v2_workspace SET floor_seq=MAX(floor_seq,?)').run(seq);
    db.prepare('DELETE FROM sync_v2_changes WHERE seq<=?').run(seq);
    // Compact deletion records remain as a graveyard, preventing stale resurrection after log expiry.
    db.prepare('DELETE FROM sync_v2_snapshot_rows WHERE snapshot_id IN(SELECT id FROM sync_v2_snapshots WHERE expires_at<?)').run(now);
    db.prepare('DELETE FROM sync_v2_snapshots WHERE expires_at<?').run(now);
    db.prepare('DELETE FROM sync_v2_previews WHERE expires_at<?').run(now);
  })();
}
export function pullChanges(db: Database.Database, cursor: number, limit = 200) {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new SyncError('INVALID_CURSOR');
  pruneSyncHistory(db);
  const floor = (db.prepare('SELECT floor_seq FROM sync_v2_workspace').get() as { floor_seq: number }).floor_seq;
  if (cursor < floor) throw new SyncError('CURSOR_EXPIRED', 410);
  const boundary = currentCursor(db);
  if (cursor > boundary) throw new SyncError('INVALID_CURSOR');
  const records = (db.prepare('SELECT record FROM sync_v2_changes WHERE seq>? AND seq<=? ORDER BY seq LIMIT ?').all(cursor, boundary, limit) as { record: string }[]).map(r => JSON.parse(r.record) as SyncRecord);
  const nextCursor = records.at(-1)?.seq ?? cursor;
  return { records, cursor: nextCursor, boundary, hasMore: nextCursor < boundary };
}
export function snapshotPage(db: Database.Database, workspaceId: string, snapshotId?: string, offset = 0, limit = 200) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500 || (!snapshotId && offset)) throw new SyncError('INVALID_PAGE');
  pruneSyncHistory(db);
  return db.transaction(() => {
    if (!snapshotId) {
      snapshotId = randomUUID();
      db.prepare('INSERT INTO sync_v2_snapshots VALUES(?,?,?,?)').run(snapshotId, workspaceId, currentCursor(db), Date.now() + 86400000);
      const rows = db.prepare('SELECT collection,id FROM sync_v2_records ORDER BY collection,id').all() as { collection: string; id: string }[];
      rows.forEach((r, index) => db.prepare('INSERT INTO sync_v2_snapshot_rows VALUES(?,?,?)').run(snapshotId, index, JSON.stringify(getRecord(db, r.collection, r.id))));
    }
    const snapshot = db.prepare('SELECT * FROM sync_v2_snapshots WHERE id=? AND workspace_id=?').get(snapshotId, workspaceId) as { boundary: number; expires_at: number } | undefined;
    if (!snapshot || snapshot.expires_at < Date.now()) throw new SyncError('SNAPSHOT_EXPIRED', 410);
    const rows = db.prepare('SELECT record FROM sync_v2_snapshot_rows WHERE snapshot_id=? AND ordinal>=? ORDER BY ordinal LIMIT ?').all(snapshotId, offset, limit + 1) as { record: string }[];
    const records = rows.slice(0, limit).map(r => JSON.parse(r.record));
    return { snapshotId, boundary: snapshot.boundary, cursor: snapshot.boundary, records, nextOffset: offset + records.length, hasMore: rows.length > limit };
  }).immediate();
}
