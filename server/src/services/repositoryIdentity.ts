import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { assertWorkspace, getRecord, type Collection, type SyncRecord, writeCanonicalRecord } from './syncV2.js';

export interface IdentityMapping { oldId: number; newId: number; fullName: string; evidence: string }
export class IdentityMigrationError extends Error {
  constructor(public code: string) { super(code); }
}
export function initializeIdentityMigration(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repository_identity_maps (
      workspace_id TEXT NOT NULL,github_user_id INTEGER NOT NULL,old_id INTEGER NOT NULL,new_id INTEGER NOT NULL,
      full_name TEXT NOT NULL,evidence TEXT NOT NULL,journal_id TEXT NOT NULL,
      PRIMARY KEY(workspace_id,old_id),UNIQUE(workspace_id,new_id)
    );
    CREATE TABLE IF NOT EXISTS repository_identity_journals (
      id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,github_user_id INTEGER NOT NULL,input_hash TEXT NOT NULL,
      mappings TEXT NOT NULL,status TEXT NOT NULL,backup TEXT NOT NULL,result TEXT,updated_at TEXT NOT NULL
    );
  `);
}
const fail = (code: string): never => { throw new IdentityMigrationError(code); };
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function assertIdleTasks(db: Database.Database, workspaceId: string) {
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_tasks'").get()
    && db.prepare("SELECT 1 FROM ai_tasks WHERE workspace_id=? AND status IN ('queued','running')").get(workspaceId)) fail('IDENTITY_ACTIVE_TASKS');
}
function validateJournalId(journalId: string) {
  if (typeof journalId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(journalId)) fail('IDENTITY_INVALID_JOURNAL');
}
function validateInputHash(inputHash: string) {
  if (typeof inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(inputHash)) fail('IDENTITY_INVALID_INPUT_HASH');
}
function stageLegacyIdentityNames(db: Database.Database, repositoryIds: number[]) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='repositories'").get()) return;
  const occupied = db.prepare('SELECT 1 FROM repositories WHERE full_name=?');
  const stage = db.prepare('UPDATE repositories SET full_name=? WHERE id=?');
  // Keep parent IDs alive until canonical child projections have moved. Deleting
  // here could cascade releases before they are reprojected; names are freed only
  // inside the enclosing immediate transaction and never committed as placeholders.
  for (const repositoryId of repositoryIds) {
    let name = `__gsm_identity_staging__/${repositoryId}`;
    while (occupied.get(name)) name += '-';
    stage.run(name, repositoryId);
  }
}
export function validateIdentityMappings(mappings: IdentityMapping[]) {
  if (!Array.isArray(mappings) || !mappings.length || mappings.length > 1000) fail('IDENTITY_INVALID_MAPPINGS');
  const old = new Set<number>(), target = new Set<number>();
  for (const row of mappings) {
    if (!row || !Number.isSafeInteger(row.oldId) || row.oldId < 1e11
      || !Number.isSafeInteger(row.newId) || row.newId <= 0 || row.newId >= 1e11
      || typeof row.fullName !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(row.fullName)
      || typeof row.evidence !== 'string' || !row.evidence.trim() || row.evidence.length > 2000
      || old.has(row.oldId) || target.has(row.newId)) fail('IDENTITY_INVALID_MAPPINGS');
    old.add(row.oldId); target.add(row.newId);
  }
}

/** Only typed mutable references are translated. Historical evidence is untouched. */
export function translateIdentityData(collection: Collection, data: Record<string, unknown> | null, mappings: IdentityMapping[]): Record<string, unknown> | null {
  if (!data) return data;
  const ids = new Map(mappings.map(row => [row.oldId, row.newId]));
  const id = (value: unknown) => typeof value === 'number' ? ids.get(value) ?? value : value;
  const hasOldId = (value: unknown) => typeof value === 'number' && ids.has(value);
  const list = (value: unknown) => Array.isArray(value) ? [...new Set(value.map(id))] : value;
  const assertName = (repoId: unknown, fullName: unknown) => {
    const mapping = mappings.find(row => row.oldId === repoId || row.newId === repoId);
    if (mapping && (typeof fullName !== 'string' || fullName.toLowerCase() !== mapping.fullName.toLowerCase())) {
      fail('REPOSITORY_IDENTITY_NAME_CONFLICT');
    }
  };
  const repository = (value: unknown) => {
    if (!isObject(value)) return id(value);
    if (mappings.some(row => row.oldId === value.id || row.newId === value.id)) assertName(value.id, value.full_name);
    return hasOldId(value.id) ? { ...value, id: id(value.id) } : value;
  };
  const repositories = (value: unknown) => {
    if (!Array.isArray(value)) return value;
    const seen = new Set<unknown>();
    return value.map(item => {
      const next = repository(item);
      const repoId = isObject(next) ? next.id : next;
      if (typeof repoId === 'number') {
        if (seen.has(repoId)) fail('REPOSITORY_IDENTITY_COLLISION');
        seen.add(repoId);
      }
      return next;
    });
  };
  const result = { ...data };
  if (collection === 'repositories') result.id = id(data.id);
  if (collection === 'subscriptions') result.repoId = id(data.repoId);
  if (collection === 'releases') {
    if (data.repo_id !== undefined) result.repo_id = id(data.repo_id);
    if (data.repository && typeof data.repository === 'object') {
      const repo = data.repository as Record<string, unknown>;
      result.repository = { ...repo, id: id(repo.id) };
    }
  }
  if (collection === 'organization' && data.repositoryOrder !== undefined) result.repositoryOrder = list(data.repositoryOrder);
  if (collection === 'sessions') {
    if (data.repoFullName !== undefined) assertName(data.repoId, data.repoFullName);
    result.repoId = id(data.repoId);
    if (isObject(data.workbench) && data.workbench.selectedRepositories !== undefined) {
      result.workbench = { ...data.workbench, selectedRepositories: repositories(data.workbench.selectedRepositories) };
    }
  }
  if (collection === 'projects') {
    if (data.repositories !== undefined) result.repositories = repositories(data.repositories);
  }
  if (collection === 'proposals') {
    if (Array.isArray(data.operations)) {
      const proposed = data.operations.filter(operation => isObject(operation) && operation.status === 'proposed');
      repositories(proposed.map(operation => operation.repository));
      result.operations = data.operations.map(operation => {
        if (!isObject(operation)) return operation;
        if (operation.status === 'running' && isObject(operation.repository) && hasOldId(operation.repository.id)) {
          fail('PAUSE_RUNNING_WORKBENCH_OPERATION');
        }
        return operation.status === 'proposed'
          ? { ...operation, repository: repository(operation.repository) } : operation;
      });
    }
    const organization = data.organization;
    if (isObject(organization)) {
      const scope = isObject(organization.scope) ? organization.scope : null;
      if (['generating', 'applying', 'restoring'].includes(String(organization.status))
        && Array.isArray(scope?.repositoryIds) && scope.repositoryIds.some(hasOldId)) {
        fail('PAUSE_RUNNING_ORGANIZATION_DRAFT');
      }
      if (['ready', 'interrupted', 'imported'].includes(String(organization.status))) {
        const entryIds = new Set<unknown>();
        const entries = Array.isArray(organization.entries) ? organization.entries.map(entry => {
          if (!isObject(entry)) return entry;
          const repositoryId = entry.status === 'pending' ? id(entry.repositoryId) : entry.repositoryId;
          if (typeof repositoryId === 'number') {
            if (entryIds.has(repositoryId)) fail('ORGANIZATION_IDENTITY_COLLISION');
            entryIds.add(repositoryId);
          }
          return repositoryId === entry.repositoryId ? entry : { ...entry, repositoryId };
        }) : organization.entries;
        const batches = Array.isArray(organization.batches) ? organization.batches.map(batch =>
          isObject(batch) && batch.status === 'pending' ? { ...batch, repositoryIds: list(batch.repositoryIds) } : batch,
        ) : organization.batches;
        result.organization = {
          ...organization,
          ...(scope ? { scope: { ...scope, repositoryIds: list(scope.repositoryIds) } } : {}),
          ...(organization.entries !== undefined ? { entries } : {}),
          ...(organization.batches !== undefined ? { batches } : {}),
        };
      }
    }
  }
  if (collection === 'discovery_reads') result.repoId = id(data.repoId);
  // Search batches, completed operations and editions remain historical evidence.
  if (collection === 'discovery_subscriptions' && String(data.id ?? '').startsWith('custom:')) {
    if (data.read !== undefined) result.read = list(data.read);
    if (data.blocked !== undefined) result.blocked = list(data.blocked);
    if (isObject(data.recommended)) {
      const seen = new Set<string>();
      result.recommended = Object.fromEntries(Object.entries(data.recommended).map(([key, value]) => {
        const repositoryId = Number(key);
        const nextKey = key === String(repositoryId) && ids.has(repositoryId) ? String(ids.get(repositoryId)) : key;
        if (seen.has(nextKey)) fail('REPOSITORY_IDENTITY_COLLISION');
        seen.add(nextKey);
        return [nextKey, value];
      }));
    }
  }
  return result;
}
export function identityWriteNeedsUpgrade(db: Database.Database, workspaceId: string, collection: Collection, recordId: string, data?: Record<string, unknown>): boolean {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='repository_identity_maps'").get()) return false;
  const mappings = db.prepare('SELECT old_id AS oldId,new_id AS newId,full_name AS fullName,evidence FROM repository_identity_maps WHERE workspace_id=?').all(workspaceId) as IdentityMapping[];
  if (!mappings.length) return false;
  if (['repositories', 'subscriptions'].includes(collection) && mappings.some(row => String(row.oldId) === recordId)) return true;
  if (collection === 'discovery_reads' && mappings.some(row => recordId.endsWith(`:${row.oldId}`))) return true;
  if (collection === 'repositories' && Number(recordId) >= 1e11 && !getRecord(db, collection, recordId)) return true;
  try {
    return !!data && JSON.stringify(translateIdentityData(collection, data, mappings)) !== JSON.stringify(data);
  } catch (error) {
    if (error instanceof IdentityMigrationError) return true;
    throw error;
  }
}
export function identityWriteNeedsConfirmation(db: Database.Database, collection: Collection, recordId: string, data?: Record<string, unknown>): boolean {
  if (collection !== 'repositories' || typeof data?.full_name !== 'string') return false;
  // A name match is not identity proof, even when the incoming payload retains
  // personal metadata. Check canonical names as well as the UNIQUE legacy slot.
  if (db.prepare(`SELECT 1 FROM sync_v2_records WHERE collection='repositories' AND deleted=0 AND id<>?
    AND lower(json_extract(data,'$.full_name'))=lower(?) LIMIT 1`).get(recordId, data.full_name)) return true;
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='repositories'").get()
    && !!db.prepare('SELECT 1 FROM repositories WHERE id<>? AND lower(full_name)=lower(?) LIMIT 1').get(recordId, data.full_name);
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Input = { workspaceId: string; githubUserId: number; mappings: IdentityMapping[] };
function identityPlan(db: Database.Database, input: Input) {
  assertWorkspace(db, input.workspaceId, input.githubUserId);
  validateIdentityMappings(input.mappings);
  assertIdleTasks(db, input.workspaceId);
  const rows = db.prepare('SELECT collection,id FROM sync_v2_records ORDER BY collection,id').all() as {collection: Collection; id: string}[];
  const records = rows.map(row => getRecord(db, row.collection, row.id)!);
  const replacements: Array<{ old?: SyncRecord; next: Pick<SyncRecord, 'collection'|'id'|'data'|'deleted'> }> = [];
  for (const mapping of input.mappings) {
    const source = getRecord(db, 'repositories', String(mapping.oldId));
    const target = getRecord(db, 'repositories', String(mapping.newId));
    if (!source || source.deleted || target?.deleted) throw new IdentityMigrationError('IDENTITY_SOURCE_OR_TARGET_TOMBSTONED');
    if (source.data?.id !== mapping.oldId || (target && target.data?.id !== mapping.newId)) fail('IDENTITY_SOURCE_OR_TARGET_CHANGED');
    if (String(source.data?.full_name).toLowerCase() !== mapping.fullName.toLowerCase()
      || (target && String(target.data?.full_name).toLowerCase() !== mapping.fullName.toLowerCase())) fail('IDENTITY_NAME_OR_TARGET_COLLISION');
    const confirmed = db.prepare('SELECT new_id FROM repository_identity_maps WHERE workspace_id=? AND old_id=?').get(input.workspaceId, mapping.oldId) as {new_id:number}|undefined;
    if (confirmed && confirmed.new_id !== mapping.newId) fail('IDENTITY_MAPPING_CONFLICT');
    for (const field of [
      'custom_description', 'custom_tags', 'custom_category', 'category_id', 'subcategory_id',
      'category_locked', 'category_candidates', 'category_legacy', 'ai_summary', 'ai_tags',
      'ai_platforms', 'ai_details',
    ]) {
      if (source.data?.[field] !== undefined && target?.data?.[field] !== undefined
        && JSON.stringify(source.data[field]) !== JSON.stringify(target.data[field])) fail('IDENTITY_METADATA_COLLISION');
    }
  }
  for (const record of records) {
    let id = record.id;
    const mapping = input.mappings.find(row =>
      (['repositories', 'subscriptions'].includes(record.collection) && String(row.oldId) === id)
      || (record.collection === 'discovery_reads' && id.endsWith(`:${row.oldId}`)));
    if (mapping) id = record.collection === 'discovery_reads'
      ? id.slice(0, id.lastIndexOf(':') + 1) + mapping.newId : String(mapping.newId);
    const translated = translateIdentityData(record.collection, record.data, input.mappings);
    if (['sessions', 'projects', 'proposals'].includes(record.collection) && record.data?.ownerId !== undefined
      && String(record.data.ownerId) !== String(input.githubUserId)
      && JSON.stringify(translated) !== JSON.stringify(record.data)) fail('IDENTITY_REFERENCE_OWNER_CONFLICT');
    if (id !== record.id) {
      const target = getRecord(db, record.collection, id);
      if (target?.deleted || record.deleted) fail('IDENTITY_REFERENCE_TOMBSTONED');
      const data = { ...target?.data, ...translated };
      replacements.push({ old: record, next: { collection: record.collection, id, data, deleted: false } });
    } else if (JSON.stringify(translated) !== JSON.stringify(record.data)) {
      replacements.push({ next: { ...record, data: translated } });
    }
  }
  return { records, replacements, inputHash: hash({
    workspaceId: input.workspaceId, githubUserId: input.githubUserId, mappings: input.mappings, records,
  }) };
}
export function previewIdentityMigration(db: Database.Database, input: Input) {
  const plan = identityPlan(db, input);
  return { inputHash: plan.inputHash, affectedRecords: plan.replacements.length, mappings: input.mappings };
}
export function applyIdentityMigration(db: Database.Database, input: Input & { journalId: string; inputHash: string }) {
  return db.transaction(() => {
    assertWorkspace(db, input.workspaceId, input.githubUserId);
    validateIdentityMappings(input.mappings);
    validateJournalId(input.journalId);
    validateInputHash(input.inputHash);
    const previous = db.prepare('SELECT * FROM repository_identity_journals WHERE id=?').get(input.journalId) as {workspace_id:string;github_user_id:number;input_hash:string;mappings:string;result:string;status:string}|undefined;
    if (previous) {
      if (previous.workspace_id !== input.workspaceId || previous.github_user_id !== input.githubUserId
        || previous.input_hash !== input.inputHash || previous.mappings !== JSON.stringify(input.mappings)) fail('IDENTITY_JOURNAL_REUSED');
      if (previous.status==='restored' || previous.status==='cancelled') fail('IDENTITY_JOURNAL_RESTORED');
      return JSON.parse(previous.result);
    }
    const plan = identityPlan(db, { workspaceId: input.workspaceId, githubUserId: input.githubUserId, mappings: input.mappings });
    if (plan.inputHash !== input.inputHash) fail('IDENTITY_PREVIEW_CHANGED');
    for (const mapping of input.mappings) db.prepare('INSERT INTO repository_identity_maps VALUES(?,?,?,?,?,?,?)')
      .run(input.workspaceId, input.githubUserId, mapping.oldId, mapping.newId, mapping.fullName, mapping.evidence, input.journalId);
    const result = { journalId: input.journalId, affectedRecords: plan.replacements.length, mappings: input.mappings };
    db.prepare('INSERT INTO repository_identity_journals VALUES(?,?,?,?,?,?,?,?,?)').run(
      input.journalId,input.workspaceId,input.githubUserId,input.inputHash,JSON.stringify(input.mappings),'applying',JSON.stringify(plan.records),null,new Date().toISOString(),
    );
    stageLegacyIdentityNames(db, input.mappings.map(mapping => mapping.oldId));
    plan.replacements.sort((a,b) => Number(b.next.collection === 'repositories') - Number(a.next.collection === 'repositories'));
    for (const replacement of plan.replacements) {
      writeCanonicalRecord(db, replacement.next);
    }
    for (const replacement of plan.replacements) if (replacement.old) writeCanonicalRecord(db, { ...replacement.old, data: null, deleted: true });
    const after=db.prepare('SELECT collection,id FROM sync_v2_records ORDER BY collection,id').all() as {collection:Collection;id:string}[];
    const response={...result,postHash:hash(after.map(row=>getRecord(db,row.collection,row.id)))};
    db.prepare("UPDATE repository_identity_journals SET status='complete',result=?,updated_at=? WHERE id=?").run(JSON.stringify(response),new Date().toISOString(),input.journalId);
    return response;
  }).immediate();
}
export function restoreIdentityMigration(db: Database.Database, input: {
  workspaceId: string; githubUserId: number; journalId: string; inputHash?: string; mappings?: IdentityMapping[];
}) {
  return db.transaction(() => {
    assertWorkspace(db,input.workspaceId,input.githubUserId);
    validateJournalId(input.journalId);
    if (input.inputHash !== undefined) validateInputHash(input.inputHash);
    if (input.mappings !== undefined) validateIdentityMappings(input.mappings);
    const journal=db.prepare('SELECT workspace_id,github_user_id,input_hash,mappings,status,backup,result FROM repository_identity_journals WHERE id=?').get(input.journalId) as {workspace_id:string;github_user_id:number;input_hash:string;mappings:string;status:string;backup:string;result:string}|undefined;
    if (!journal) {
      if (!input.inputHash || !input.mappings) fail('IDENTITY_RECOVERY_PROOF_REQUIRED');
      const mappings = input.mappings!;
      // Apply atomically commits its journal, aliases and business writes.
      // Reject orphaned evidence before recording cancellation.
      if (db.prepare('SELECT 1 FROM repository_identity_maps WHERE journal_id=?').get(input.journalId)
        || mappings.some(mapping => db.prepare('SELECT 1 FROM repository_identity_maps WHERE workspace_id=? AND (old_id IN (?,?) OR new_id IN (?,?))')
          .get(input.workspaceId, mapping.oldId, mapping.newId, mapping.oldId, mapping.newId))) {
        fail('IDENTITY_RECOVERY_MAPPING_CONFLICT');
      }
      identityPlan(db, { workspaceId: input.workspaceId, githubUserId: input.githubUserId, mappings });
      for (const mapping of mappings) {
        if (db.prepare(`SELECT 1 FROM sync_v2_changes
          WHERE json_extract(record,'$.collection')='repositories' AND json_extract(record,'$.id')=?
          AND (json_extract(record,'$.deleted')=1 OR json_extract(record,'$.data.id')<>?) LIMIT 1`)
          .get(String(mapping.oldId), mapping.oldId)) fail('IDENTITY_RECOVERY_SOURCE_HISTORY_CONFLICT');
      }
      const result = { journalId: input.journalId, restored: false, notApplied: true };
      // This immediate transaction serializes with apply: a delayed original
      // request must see terminal evidence rather than write after local restore.
      db.prepare('INSERT INTO repository_identity_journals VALUES(?,?,?,?,?,?,?,?,?)').run(
        input.journalId, input.workspaceId, input.githubUserId, input.inputHash,
        JSON.stringify(mappings), 'cancelled', '[]', JSON.stringify(result), new Date().toISOString(),
      );
      return result;
    }
    if (journal.workspace_id!==input.workspaceId || journal.github_user_id!==input.githubUserId) fail('IDENTITY_RECOVERY_SCOPE_CONFLICT');
    if ((input.inputHash !== undefined && journal.input_hash !== input.inputHash)
      || (input.mappings !== undefined && journal.mappings !== JSON.stringify(input.mappings))) fail('IDENTITY_JOURNAL_REUSED');
    if (journal.status==='cancelled') return JSON.parse(journal.result);
    if (journal.status==='restored') return {journalId:input.journalId,restored:true};
    assertIdleTasks(db,input.workspaceId);
    if (journal.status !== 'complete' || !journal.result) fail('IDENTITY_RECOVERY_JOURNAL_INCOMPLETE');
    const records=JSON.parse(journal.backup) as SyncRecord[];
    const expected=new Set(records.map(row=>`${row.collection}:${row.id}`));
    const current=db.prepare('SELECT collection,id FROM sync_v2_records ORDER BY collection,id').all() as {collection:Collection;id:string}[];
    if (JSON.parse(journal.result).postHash!==hash(current.map(row=>getRecord(db,row.collection,row.id)))) fail('IDENTITY_RECOVERY_REMOTE_CHANGED');
    const mappings = JSON.parse(journal.mappings) as IdentityMapping[];
    stageLegacyIdentityNames(db, mappings.flatMap(mapping => [mapping.oldId, mapping.newId]));
    // Preserve monotonic versions/cursors; no old operation payload or ACK evidence is rewritten.
    for (const row of records.filter(row=>row.collection==='repositories')) writeCanonicalRecord(db,row);
    for (const row of records.filter(row=>row.collection!=='repositories')) writeCanonicalRecord(db,row);
    for (const row of current) if (!expected.has(`${row.collection}:${row.id}`)) writeCanonicalRecord(db,{...row,data:null,deleted:true});
    db.prepare('DELETE FROM repository_identity_maps WHERE workspace_id=? AND journal_id=?').run(input.workspaceId,input.journalId);
    db.prepare("UPDATE repository_identity_journals SET status='restored',updated_at=? WHERE id=?").run(new Date().toISOString(),input.journalId);
    return {journalId:input.journalId,restored:true};
  }).immediate();
}
