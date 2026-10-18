import type { WorkbenchProject, WorkbenchProposal } from '../types/aiWorkbench';
import type {
  OrganizationDraft, OrganizationEntry, OrganizationSchemeDraft, OrganizationStructureOperation, OrganizationStructureSnapshot,
} from '../types/aiOrganization';
import type { RepositoryChatSession } from '../types/repositoryChat';
import type { RepositoryIdentityMapping } from '../utils/repositoryIdentity';
import {
  assertRepositoryIdentityName, remapParticipantRepositoryList,
  validateParticipantMappings, type RepositoryIdentityParticipantResult,
} from '../utils/repositoryIdentityRemap';
import { remapCustomDiscoveryRepositoryIdentityData, type CustomDiscoveryData } from '../features/discovery/custom/model';
import type { VectorSearchService, VectorRepositoryIdentityBackup } from './vectorSearchService';
import { exportDiscoveryWorkspaceBackup, importDiscoveryWorkspaceBackup, remapDiscoveryWorkspaceBackup,
  validateDiscoveryWorkspaceBackup, type DiscoveryWorkspaceBackup } from './discoveryWorkspaceBackup';
import type { ReadingData } from '../lib/html-reading/storage';

export type { RepositoryIdentityMapping } from '../utils/repositoryIdentity';
export {
  assertRepositoryIdentityName, remapParticipantClassificationSchemes, remapParticipantRepositoryIds, remapParticipantRepositoryList, validateParticipantMappings,
} from '../utils/repositoryIdentityRemap';
export type { RepositoryIdentityParticipantResult } from '../utils/repositoryIdentityRemap';
export interface WorkbenchRepositoryIdentityScope { ownerId: string; maintenanceJournalId?: string }
export interface WorkbenchRepositoryIdentitySnapshot {
  sessions: RepositoryChatSession[];
  projects: WorkbenchProject[];
  proposals: WorkbenchProposal[];
  discoveryWorkspace?: DiscoveryWorkspaceBackup;
}
export interface RepositoryIdentityParticipantBackup {
  account: string;
  workbench: WorkbenchRepositoryIdentitySnapshot;
  customDiscovery: CustomDiscoveryData | null;
  /** Independent HTML Reading IndexedDB state for this account. Optional for pre-Reading journals. */
  reading?: ReadingData;
  vectors: { storage: 'remote-vectorize'; backedUp: false };
}

const mapRepositoryId = (id: number, mappings: ReadonlyArray<RepositoryIdentityMapping>): number =>
  mappings.find(mapping => mapping.oldId === id)?.newId ?? id;

function remapStrictRepositoryIds(ids: number[], mappings: ReadonlyArray<RepositoryIdentityMapping>, code = 'ORGANIZATION_IDENTITY_COLLISION'): number[] {
  const result = ids.map(id => mapRepositoryId(id, mappings));
  if (new Set(result).size !== result.length) throw new Error(code);
  return result.some((id, index) => id !== ids[index]) ? result : ids;
}

function remapOrganizationSnapshot(snapshot: OrganizationStructureSnapshot, mappings: ReadonlyArray<RepositoryIdentityMapping>): OrganizationStructureSnapshot {
  const repositoryOrder = remapStrictRepositoryIds(snapshot.repositoryOrder, mappings);
  return repositoryOrder === snapshot.repositoryOrder ? snapshot : { ...snapshot, repositoryOrder };
}

function remapOrganizationEntries(entries: OrganizationEntry[], mappings: ReadonlyArray<RepositoryIdentityMapping>, allStatuses = false): OrganizationEntry[] {
  const result = entries.map(entry => {
    if (!allStatuses && entry.status !== 'pending') return entry;
    const repositoryId = mapRepositoryId(entry.repositoryId, mappings);
    return repositoryId === entry.repositoryId ? entry : { ...entry, repositoryId };
  });
  if (new Set(result.map(entry => entry.repositoryId)).size !== result.length) throw new Error('ORGANIZATION_IDENTITY_COLLISION');
  return result.some((entry, index) => entry !== entries[index]) ? result : entries;
}

function remapOrganizationMembers<T extends { repositoryId: number }>(members: T[] | undefined, mappings: ReadonlyArray<RepositoryIdentityMapping>): T[] | undefined {
  if (!members) return members;
  const result = members.map(member => {
    const repositoryId = mapRepositoryId(member.repositoryId, mappings);
    return repositoryId === member.repositoryId ? member : { ...member, repositoryId };
  });
  if (new Set(result.map(member => member.repositoryId)).size !== result.length) throw new Error('ORGANIZATION_IDENTITY_COLLISION');
  return result.some((member, index) => member !== members[index]) ? result : members;
}

function remapOrganizationOperation(operation: OrganizationStructureOperation, mappings: ReadonlyArray<RepositoryIdentityMapping>): OrganizationStructureOperation {
  const members = remapOrganizationMembers(operation.members, mappings) ?? operation.members;
  const before = remapOrganizationSnapshot(operation.before, mappings);
  const after = operation.after ? remapOrganizationSnapshot(operation.after, mappings) : undefined;
  if (members === operation.members && before === operation.before && after === operation.after) return operation;
  return { ...operation, members, before, ...(after ? { after } : {}) };
}

type IntegratedOperation = NonNullable<OrganizationSchemeDraft['structureOperations']>[number];
function remapIntegratedOperation(operation: IntegratedOperation, mappings: ReadonlyArray<RepositoryIdentityMapping>): IntegratedOperation {
  const members = remapOrganizationMembers(operation.members, mappings) ?? operation.members;
  const entriesBefore = remapOrganizationEntries(operation.entriesBefore, mappings, true);
  if (members === operation.members && entriesBefore === operation.entriesBefore) return operation;
  return { ...operation, members, entriesBefore };
}

function remapOrganizationDraft(draft: OrganizationDraft, mappings: ReadonlyArray<RepositoryIdentityMapping>): { draft: OrganizationDraft; changed: number } {
  let changed = false;
  const next = structuredClone(draft);
  const replace = <T>(current: T, value: T): T => {
    if (value !== current) changed = true;
    return value;
  };
  next.scope = { ...next.scope, repositoryIds: replace(next.scope.repositoryIds, remapStrictRepositoryIds(next.scope.repositoryIds, mappings)) };
  next.entries = replace(next.entries, remapOrganizationEntries(next.entries, mappings, true));
  next.batches = next.batches.map(batch => {
    if (batch.status !== 'pending') return batch;
    const repositoryIds = remapStrictRepositoryIds(batch.repositoryIds, mappings);
    if (repositoryIds === batch.repositoryIds) return batch;
    changed = true;
    return { ...batch, repositoryIds };
  });
  next.structureOperations = next.structureOperations?.map(operation => {
    const remapped = remapOrganizationOperation(operation, mappings);
    if (remapped !== operation) changed = true;
    return remapped;
  });

  const dual = next.dual;
  if (dual) {
    const understanding = dual.understanding.map(row => {
      const repositoryId = mapRepositoryId(row.repositoryId, mappings);
      return repositoryId === row.repositoryId ? row : { ...row, repositoryId };
    });
    if (new Set(understanding.map(row => row.repositoryId)).size !== understanding.length) throw new Error('ORGANIZATION_IDENTITY_COLLISION');
    if (understanding.some((row, index) => row !== dual.understanding[index])) { dual.understanding = understanding; changed = true; }
    const summaries = dual.summaries.map(summary => {
      const repositoryIds = remapStrictRepositoryIds(summary.repositoryIds, mappings);
      return repositoryIds === summary.repositoryIds ? summary : { ...summary, repositoryIds };
    });
    if (summaries.some((row, index) => row !== dual.summaries[index])) { dual.summaries = summaries; changed = true; }
    if (dual.verificationIds) {
      const verificationIds = remapStrictRepositoryIds(dual.verificationIds, mappings);
      if (verificationIds !== dual.verificationIds) { dual.verificationIds = verificationIds; changed = true; }
    }
    const errors = dual.errors.map(error => {
      const repositoryIds = remapStrictRepositoryIds(error.repositoryIds, mappings);
      return repositoryIds === error.repositoryIds ? error : { ...error, repositoryIds };
    });
    if (errors.some((row, index) => row !== dual.errors[index])) { dual.errors = errors; changed = true; }
    for (const scheme of Object.values(dual.schemes)) {
      const entries = remapOrganizationEntries(scheme.entries, mappings, true);
      if (entries !== scheme.entries) { scheme.entries = entries; changed = true; }
      scheme.before = replace(scheme.before, remapOrganizationSnapshot(scheme.before, mappings));
      if (scheme.after) scheme.after = replace(scheme.after, remapOrganizationSnapshot(scheme.after, mappings));
      if (scheme.proposedCategoryIds) { /* category IDs are string identities */ }
      const operations = scheme.structureOperations?.map(operation => {
        const remapped = remapIntegratedOperation(operation, mappings);
        if (remapped !== operation) changed = true;
        return remapped;
      });
      if (operations) scheme.structureOperations = operations;
      const members = remapOrganizationMembers(scheme.members, mappings);
      if (members !== scheme.members) { scheme.members = members; changed = true; }
      if (scheme.application) {
        const application = scheme.application;
        const repositoryIds = remapStrictRepositoryIds(application.repositoryIds, mappings);
        const membersAfter = remapOrganizationMembers(application.membersAfter, mappings) ?? application.membersAfter;
        const before = remapOrganizationSnapshot(application.before, mappings);
        const after = remapOrganizationSnapshot(application.after, mappings);
        if (repositoryIds !== application.repositoryIds || membersAfter !== application.membersAfter || before !== application.before || after !== application.after) {
          scheme.application = { ...application, repositoryIds, membersAfter, before, after };
          changed = true;
        }
      }
    }
  }
  return { draft: changed ? next : draft, changed: changed ? 1 : 0 };
}

const readingIdentityKeys = ['states', 'names', 'projectSources', 'processing', 'starObservations', 'projectRevisions', 'candidateRevisions', 'candidateSources'] as const;
const readingObjectOwns = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

function remapReadingKeyedRecord<T>(record: Record<string, T> | undefined, mappings: ReadonlyArray<RepositoryIdentityMapping>): { value: Record<string, T> | undefined; changed: boolean } {
  if (!record) return { value: record, changed: false };
  let changed = false;
  const result: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    const numeric = Number(key);
    const nextKey = Number.isSafeInteger(numeric) && numeric > 0 ? String(mapRepositoryId(numeric, mappings)) : key;
    if (readingObjectOwns(result, nextKey)) throw new Error('READING_IDENTITY_COLLISION');
    if (nextKey !== key) changed = true;
    result[nextKey] = value;
  }
  return { value: changed ? result : record, changed };
}

function remapReadingSnapshots(data: ReadingData, mappings: ReadonlyArray<RepositoryIdentityMapping>): boolean {
  let changed = false;
  const snapshots = Object.fromEntries(Object.entries(data.snapshots).map(([snapshotId, snapshot]) => {
    const base = remapReadingKeyedRecord(snapshot.base, mappings);
    const views = snapshot.views && Object.fromEntries(Object.entries(snapshot.views).map(([viewId, ids]) => {
      const nextIds = remapStrictRepositoryIds(ids, mappings, 'READING_IDENTITY_COLLISION');
      if (nextIds !== ids) changed = true;
      return [viewId, nextIds];
    }));
    if (base.changed || views && JSON.stringify(views) !== JSON.stringify(snapshot.views)) changed = true;
    return [snapshotId, base.changed || views && JSON.stringify(views) !== JSON.stringify(snapshot.views)
      ? { ...snapshot, base: base.value!, ...(views ? { views } : {}) } : snapshot];
  }));
  if (changed) data.snapshots = snapshots;
  return changed;
}

/** Remap all mutable repository references in one account's HTML Reading state. */
export function remapReadingRepositoryIdentityData(data: ReadingData, mappings: ReadonlyArray<RepositoryIdentityMapping>, account?: string): RepositoryIdentityParticipantResult {
  validateParticipantMappings(mappings);
  if (!mappings.length) return { changed: 0 };
  let changed = 0;
  for (const key of readingIdentityKeys) {
    const result = remapReadingKeyedRecord(data[key] as Record<string, never> | undefined, mappings);
    if (result.changed) { (data as unknown as Record<string, unknown>)[key] = result.value; changed++; }
  }
  for (const key of ['projectSources', 'candidateSources'] as const) {
    const values = data[key];
    if (!values) continue;
    let touched = false;
    const next = Object.fromEntries(Object.entries(values).map(([id, value]) => {
      const repositoryId = mapRepositoryId(value.repoId, mappings);
      if (repositoryId === value.repoId) return [id, value];
      touched = true;
      return [id, { ...value, repoId: repositoryId }];
    }));
    if (touched) { data[key] = next; changed++; }
  }
  if (remapReadingSnapshots(data, mappings)) changed++;
  if (data.positions) {
    let touched = false;
    const positions = Object.fromEntries(Object.entries(data.positions).map(([key, position]) => {
      const repoId = mapRepositoryId(position.repoId, mappings);
      if (repoId === position.repoId) return [key, position];
      touched = true; return [key, { ...position, repoId }];
    }));
    if (touched) { data.positions = positions; changed++; }
  }
  if (data.latestImport) {
    const ids = data.latestImport.ids.map(id => {
      const numeric = Number(id);
      return Number.isSafeInteger(numeric) && numeric > 0 ? String(mapRepositoryId(numeric, mappings)) : id;
    });
    if (ids.some((id, index) => id !== data.latestImport!.ids[index])) { data.latestImport = { ...data.latestImport, ids: [...new Set(ids)] }; changed++; }
  }
  if (data.starBatches) {
    for (const [batchId, batch] of Object.entries(data.starBatches)) {
      if (account && batch.accountId !== account) throw new Error('READING_BACKUP_ACCOUNT_CONFLICT');
      const rows = batch.rows.map(row => ({ ...row, repoId: mapRepositoryId(row.repoId, mappings) }));
      if (new Set(rows.map(row => row.repoId)).size !== rows.length) throw new Error('READING_IDENTITY_COLLISION');
      if (rows.some((row, index) => row.repoId !== batch.rows[index].repoId)) { data.starBatches[batchId] = { ...batch, rows }; changed++; }
    }
  }
  return { changed };
}

/** The coordinator must durably save this account-bound snapshot before calling participants. */
export async function backupParticipantIdentities(account: string, options: { prepareReading?: boolean } = {}): Promise<RepositoryIdentityParticipantBackup> {
  if (!account?.trim()) throw new Error('PARTICIPANT_BACKUP_ACCOUNT_REQUIRED');
  const [{ repositoryChatStorage }, { backupCustomRepositoryIdentityData }, { loadReadingData }] = await Promise.all([
    import('./repositoryChatStorage'), import('../features/discovery/custom/storage'), import('../lib/html-reading/storage'),
  ]);
  // Run existing atomic schema migrations before the identity journal/gate.
  // Recovery fingerprint reads below never perform these writes.
  if (options.prepareReading && /^\d+$/.test(account)) await loadReadingData(account, { includeSnapshots: false });
  const [workbench, customDiscovery, discoveryWorkspace, reading] = await Promise.all([
    repositoryChatStorage.backupRepositoryIdentityReferences(account),
    backupCustomRepositoryIdentityData(account),
    exportDiscoveryWorkspaceBackup(account, false),
    /^\d+$/.test(account) ? loadReadingData(account, { readOnly: true, includeCandidates: true, includeStarBatches: true }) : Promise.resolve(undefined),
  ]);
  workbench.discoveryWorkspace = discoveryWorkspace;
  if (reading) {
    // Keep absent/new account snapshots canonical without creating a row.
    reading.workspaceVersion ??= 5;
    reading.artifactVersion ??= 3;
    reading.candidateVersion ??= 4;
  }
  return { account, workbench, customDiscovery, ...(reading ? { reading } : {}), vectors: { storage: 'remote-vectorize', backedUp: false } };
}

/** Each database restores atomically; retrying after an interrupted cross-DB restore is harmless. */
export async function restoreParticipantIdentities(account: string, backup: RepositoryIdentityParticipantBackup, maintenanceJournalId?: string): Promise<void> {
  if (!account?.trim() || backup?.account !== account) throw new Error('PARTICIPANT_BACKUP_ACCOUNT_CONFLICT');
  if (!backup.workbench || !['sessions', 'projects', 'proposals'].every(name =>
    Array.isArray(backup.workbench[name as 'sessions' | 'projects' | 'proposals'])
    && backup.workbench[name as 'sessions' | 'projects' | 'proposals'].every(row => row.ownerId === account))) {
    throw new Error('PARTICIPANT_BACKUP_ACCOUNT_CONFLICT');
  }
  validateDiscoveryWorkspaceBackup(account, backup.workbench.discoveryWorkspace);
  if (backup.customDiscovery && (!Array.isArray(backup.customDiscovery.channels)
    || !Array.isArray(backup.customDiscovery.editions) || !backup.customDiscovery.cache)) {
    throw new Error('INVALID_CUSTOM_DISCOVERY_IDENTITY_BACKUP');
  }
  if (backup.reading && (!backup.reading.settings || !backup.reading.states || !backup.reading.names || !backup.reading.snapshots
    || (backup.reading.starBatches && Object.values(backup.reading.starBatches).some(batch => batch.accountId !== account)))) {
    throw new Error('INVALID_READING_IDENTITY_BACKUP');
  }
  const { repositoryChatStorage } = await import('./repositoryChatStorage');
  await repositoryChatStorage.restoreRepositoryIdentityReferences(account, backup.workbench);
  await importDiscoveryWorkspaceBackup(account, backup.workbench.discoveryWorkspace, 'replace', true);
  if (backup.customDiscovery) {
    const { restoreCustomRepositoryIdentityData } = await import('../features/discovery/custom/storage');
    await restoreCustomRepositoryIdentityData(account, backup.customDiscovery);
  }
  if (backup.reading) {
    const { readingTransaction } = await import('../lib/html-reading/storage');
    const replacement = structuredClone(backup.reading);
    await readingTransaction(account, data => {
      for (const key of Object.keys(data)) delete (data as unknown as Record<string, unknown>)[key];
      Object.assign(data, replacement);
    }, { includeCandidates: true, includeStarBatches: true,
      ...(maintenanceJournalId ? { identityMaintenance: { account, journalId: maintenanceJournalId } } : {}) });
  }
}

/** The coordinator should fingerprint every cross-database intermediate state before migration. */
export function participantIdentityRecoverySnapshots(
  backup: RepositoryIdentityParticipantBackup,
  mappings: readonly RepositoryIdentityMapping[],
): RepositoryIdentityParticipantBackup[] {
  const original = structuredClone(backup);
  const migrated = structuredClone(backup);
  remapWorkbench(migrated.workbench, backup.account, mappings);
  if (migrated.customDiscovery) remapCustomDiscoveryRepositoryIdentityData(migrated.customDiscovery, mappings);
  if (migrated.reading) remapReadingRepositoryIdentityData(migrated.reading, mappings, backup.account);
  const variants: RepositoryIdentityParticipantBackup[] = [];
  for (let mask = 0; mask < 32; mask++) {
    const candidate = structuredClone(original);
    if (mask & 1) Object.assign(candidate.workbench, {
      sessions: migrated.workbench.sessions, projects: migrated.workbench.projects, proposals: migrated.workbench.proposals,
    });
    const discovery = candidate.workbench.discoveryWorkspace;
    if (discovery && migrated.workbench.discoveryWorkspace) {
      if (mask & 2) discovery.workspace = migrated.workbench.discoveryWorkspace.workspace;
      if (mask & 4) discovery.analyses = migrated.workbench.discoveryWorkspace.analyses;
    }
    if (mask & 8) candidate.customDiscovery = migrated.customDiscovery;
    if (mask & 16 && migrated.reading) candidate.reading = migrated.reading;
    variants.push(candidate);
  }
  return variants;
}

/** Older journals predate these optional stores and must compare only the stores they captured. */
export function participantIdentityRecoveryView(
  current: RepositoryIdentityParticipantBackup,
  original: RepositoryIdentityParticipantBackup,
): RepositoryIdentityParticipantBackup {
  const result = structuredClone(current);
  if (original.workbench.discoveryWorkspace === undefined) delete result.workbench.discoveryWorkspace;
  if (original.reading === undefined) delete result.reading;
  return result;
}

export function remapWorkbench(snapshot: WorkbenchRepositoryIdentitySnapshot, ownerId: string, mappings: ReadonlyArray<RepositoryIdentityMapping>): RepositoryIdentityParticipantResult {
  validateParticipantMappings(mappings);
  const discoveryWorkspace = snapshot.discoveryWorkspace
    ? structuredClone(snapshot.discoveryWorkspace) : undefined;
  if (discoveryWorkspace) {
    validateDiscoveryWorkspaceBackup(ownerId, discoveryWorkspace);
    remapDiscoveryWorkspaceBackup(discoveryWorkspace, mappings);
  }
  let changed = 0;
  snapshot.sessions = snapshot.sessions.map(session => {
    if (session.ownerId !== ownerId) {
      if (!session.ownerId && (mappings.some(mapping => mapping.oldId === session.repoId)
        || session.workbench?.selectedRepositories.some(repo => mappings.some(mapping => mapping.oldId === repo.id)))) {
        throw new Error('AMBIGUOUS_UNOWNED_WORKBENCH_IDENTITY');
      }
      return session;
    }
    assertRepositoryIdentityName(session.repoId, session.repoFullName, mappings);
    const repoId = mappings.find(mapping => mapping.oldId === session.repoId)?.newId ?? session.repoId;
    const selected = session.workbench
      ? remapParticipantRepositoryList(session.workbench.selectedRepositories, mappings) : undefined;
    if (repoId === session.repoId && selected === session.workbench?.selectedRepositories) return session;
    changed++;
    return { ...session, repoId, ...(session.workbench ? { workbench: { ...session.workbench, selectedRepositories: selected! } } : {}) };
  });
  snapshot.projects = snapshot.projects.map(project => {
    if (project.ownerId !== ownerId) {
      if (!project.ownerId && project.repositories.some(repo => mappings.some(mapping => mapping.oldId === repo.id))) {
        throw new Error('AMBIGUOUS_UNOWNED_WORKBENCH_IDENTITY');
      }
      return project;
    }
    const repositories = remapParticipantRepositoryList(project.repositories, mappings);
    if (repositories === project.repositories) return project;
    changed++;
    return { ...project, repositories };
  });
  snapshot.proposals = snapshot.proposals.map(proposal => {
    if (proposal.ownerId !== ownerId) {
      if (!proposal.ownerId && (proposal.operations.some(operation => ['proposed', 'running'].includes(operation.status)
        && mappings.some(mapping => mapping.oldId === operation.repository.id))
        || (proposal.organization && remapOrganizationDraft(proposal.organization, mappings).changed > 0))) {
        throw new Error('AMBIGUOUS_UNOWNED_WORKBENCH_IDENTITY');
      }
      return proposal;
    }
    const parent = snapshot.sessions.find(session => session.id === proposal.sessionId);
    if (parent && parent.ownerId !== ownerId) throw new Error('WORKBENCH_PROPOSAL_OWNER_CONFLICT');
    remapParticipantRepositoryList(proposal.operations.filter(operation => operation.status === 'proposed').map(operation => operation.repository), mappings);
    let touched = false;
    const operations = proposal.operations.map(operation => {
      if (operation.status === 'running' && mappings.some(mapping => mapping.oldId === operation.repository.id)) {
        throw new Error('PAUSE_RUNNING_WORKBENCH_OPERATION');
      }
      if (operation.status !== 'proposed') return operation;
      const [repository] = remapParticipantRepositoryList([operation.repository], mappings);
      if (repository === operation.repository) return operation;
      touched = true;
      return { ...operation, repository };
    });
    let organization = proposal.organization;
    if (organization && ['generating', 'applying', 'restoring'].includes(organization.status)
      && remapOrganizationDraft(organization, mappings).changed > 0) {
      throw new Error('PAUSE_RUNNING_ORGANIZATION_DRAFT');
    }
    if (organization && ['ready', 'interrupted', 'imported', 'applied'].includes(organization.status)) {
      const remapped = remapOrganizationDraft(organization, mappings);
      if (remapped.changed) {
        touched = true;
        organization = remapped.draft;
      }
    }
    if (!touched) return proposal;
    changed++;
    return { ...proposal, operations, organization };
  });
  if (discoveryWorkspace) {
    if (JSON.stringify(discoveryWorkspace) !== JSON.stringify(snapshot.discoveryWorkspace)) changed++;
    snapshot.discoveryWorkspace = discoveryWorkspace;
  }
  return { changed };
}

/** The coordinator owns mapping confirmation, durable journaling and the maintenance gate. */
export async function migrateWorkbenchRepositoryIdentities(
  scope: WorkbenchRepositoryIdentityScope,
  mappings: ReadonlyArray<RepositoryIdentityMapping>,
): Promise<RepositoryIdentityParticipantResult> {
  if (!scope?.ownerId?.trim()) throw new Error('WORKBENCH_OWNER_REQUIRED');
  validateParticipantMappings(mappings);
  if (!mappings.length) return { changed: 0 };
  const [{ repositoryChatStorage }, { loadReadingData, readingTransaction }] = await Promise.all([
    import('./repositoryChatStorage'), import('../lib/html-reading/storage'),
  ]);
  const discoveryWorkspace = await exportDiscoveryWorkspaceBackup(scope.ownerId, false);
  const reading = /^\d+$/.test(scope.ownerId)
    ? await loadReadingData(scope.ownerId, { readOnly: true, includeCandidates: true, includeStarBatches: true }) : undefined;
  // Preflight the new stores before committing the existing participant.
  remapDiscoveryWorkspaceBackup(structuredClone(discoveryWorkspace), mappings);
  const plannedReading = reading ? structuredClone(reading) : undefined;
  const plannedReadingResult = plannedReading ? remapReadingRepositoryIdentityData(plannedReading, mappings, scope.ownerId) : { changed: 0 };
  const workbench = await repositoryChatStorage.mutateRepositoryIdentityReferences(scope.ownerId, snapshot => remapWorkbench(snapshot, scope.ownerId, mappings));
  const [{ migrateDiscoveryWorkspaceIdentities }, { migrateRepositoryAnalysisAssetIdentities }] = await Promise.all([
    import('../features/discovery/workspace/storage'), import('./repositoryAnalysisAssets'),
  ]);
  const workspace = discoveryWorkspace.workspace ? await migrateDiscoveryWorkspaceIdentities(scope.ownerId, mappings) : { changed: 0 };
  const analyses = discoveryWorkspace.analyses?.assets.some(asset => mappings.some(row => row.oldId === asset.repositoryId))
    ? await migrateRepositoryAnalysisAssetIdentities(scope.ownerId, mappings) : { changed: 0 };
  let readingChanged = 0;
  if (plannedReadingResult.changed) {
    readingChanged = await readingTransaction(scope.ownerId, data => remapReadingRepositoryIdentityData(data, mappings, scope.ownerId).changed,
      { includeCandidates: true, includeStarBatches: true,
        ...(scope.maintenanceJournalId ? { identityMaintenance: { account: scope.ownerId, journalId: scope.maintenanceJournalId } } : {}) });
  }
  return { changed: workbench.changed + workspace.changed + analyses.changed + readingChanged };
}

export async function migrateCustomDiscoveryRepositoryIdentities(
  account: string,
  mappings: ReadonlyArray<RepositoryIdentityMapping>,
): Promise<RepositoryIdentityParticipantResult> {
  if (!account?.trim()) throw new Error('CUSTOM_DISCOVERY_ACCOUNT_REQUIRED');
  validateParticipantMappings(mappings);
  if (!mappings.length) return { changed: 0 };
  const [{ migrateCustomRepositoryIdentityData }, { remapCustomDiscoveryRepositoryIdentityData }] = await Promise.all([
    import('../features/discovery/custom/storage'), import('../features/discovery/custom/model'),
  ]);
  return migrateCustomRepositoryIdentityData(account, data => remapCustomDiscoveryRepositoryIdentityData(data, mappings));
}

export async function migrateVectorRepositoryIdentities(
  namespace: string,
  mappings: ReadonlyArray<RepositoryIdentityMapping>,
  context?: { service: VectorSearchService; backup: VectorRepositoryIdentityBackup },
): Promise<RepositoryIdentityParticipantResult> {
  if (!namespace?.trim()) throw new Error('VECTOR_NAMESPACE_REQUIRED');
  validateParticipantMappings(mappings);
  if (!mappings.length) return { changed: 0 };
  if (!context) throw new Error('REMOTE_VECTORIZE_IDENTITY_ADAPTER_REQUIRED: durably back up vectors before migration');
  if (context.backup.scope.namespace !== namespace) throw new Error('VECTOR_IDENTITY_NAMESPACE_CONFLICT');
  return context.service.rekeyRepositoryIdentities(mappings, context.backup);
}
