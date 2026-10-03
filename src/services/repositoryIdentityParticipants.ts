import type { WorkbenchProject, WorkbenchProposal } from '../types/aiWorkbench';
import type { RepositoryChatSession } from '../types/repositoryChat';
import type { RepositoryIdentityMapping } from '../utils/repositoryIdentity';
import {
  assertRepositoryIdentityName, remapParticipantRepositoryIds, remapParticipantRepositoryList,
  validateParticipantMappings, type RepositoryIdentityParticipantResult,
} from '../utils/repositoryIdentityRemap';
import { remapCustomDiscoveryRepositoryIdentityData, type CustomDiscoveryData } from '../features/discovery/custom/model';
import type { VectorSearchService, VectorRepositoryIdentityBackup } from './vectorSearchService';
import { exportDiscoveryWorkspaceBackup, importDiscoveryWorkspaceBackup, remapDiscoveryWorkspaceBackup,
  validateDiscoveryWorkspaceBackup, type DiscoveryWorkspaceBackup } from './discoveryWorkspaceBackup';

export type { RepositoryIdentityMapping } from '../utils/repositoryIdentity';
export {
  assertRepositoryIdentityName, remapParticipantRepositoryIds, remapParticipantRepositoryList, validateParticipantMappings,
} from '../utils/repositoryIdentityRemap';
export type { RepositoryIdentityParticipantResult } from '../utils/repositoryIdentityRemap';
export interface WorkbenchRepositoryIdentityScope { ownerId: string }
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
  vectors: { storage: 'remote-vectorize'; backedUp: false };
}

/** The coordinator must durably save this account-bound snapshot before calling participants. */
export async function backupParticipantIdentities(account: string): Promise<RepositoryIdentityParticipantBackup> {
  if (!account?.trim()) throw new Error('PARTICIPANT_BACKUP_ACCOUNT_REQUIRED');
  const [{ repositoryChatStorage }, { backupCustomRepositoryIdentityData }] = await Promise.all([
    import('./repositoryChatStorage'), import('../features/discovery/custom/storage'),
  ]);
  const [workbench, customDiscovery, discoveryWorkspace] = await Promise.all([
    repositoryChatStorage.backupRepositoryIdentityReferences(account),
    backupCustomRepositoryIdentityData(account),
    exportDiscoveryWorkspaceBackup(account, false),
  ]);
  workbench.discoveryWorkspace = discoveryWorkspace;
  return { account, workbench, customDiscovery, vectors: { storage: 'remote-vectorize', backedUp: false } };
}

/** Each database restores atomically; retrying after an interrupted cross-DB restore is harmless. */
export async function restoreParticipantIdentities(account: string, backup: RepositoryIdentityParticipantBackup): Promise<void> {
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
  const { repositoryChatStorage } = await import('./repositoryChatStorage');
  await repositoryChatStorage.restoreRepositoryIdentityReferences(account, backup.workbench);
  await importDiscoveryWorkspaceBackup(account, backup.workbench.discoveryWorkspace, 'replace', true);
  if (backup.customDiscovery) {
    const { restoreCustomRepositoryIdentityData } = await import('../features/discovery/custom/storage');
    await restoreCustomRepositoryIdentityData(account, backup.customDiscovery);
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
  const variants: RepositoryIdentityParticipantBackup[] = [];
  for (let mask = 0; mask < 16; mask++) {
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
        || proposal.organization?.scope.repositoryIds.some(id => mappings.some(mapping => mapping.oldId === id)))) {
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
      && organization.scope.repositoryIds.some(id => mappings.some(mapping => mapping.oldId === id))) {
      throw new Error('PAUSE_RUNNING_ORGANIZATION_DRAFT');
    }
    if (organization && ['ready', 'interrupted', 'imported'].includes(organization.status)) {
      const repositoryIds = remapParticipantRepositoryIds(organization.scope.repositoryIds, mappings);
      const entryIds = new Set<number>();
      const entries = organization.entries.map(entry => {
        const repositoryId = entry.status === 'pending'
          ? mappings.find(mapping => mapping.oldId === entry.repositoryId)?.newId ?? entry.repositoryId
          : entry.repositoryId;
        if (entryIds.has(repositoryId)) throw new Error('ORGANIZATION_IDENTITY_COLLISION');
        entryIds.add(repositoryId);
        return repositoryId === entry.repositoryId ? entry : { ...entry, repositoryId };
      });
      const batches = organization.batches.map(batch => {
        if (batch.status !== 'pending') return batch;
        const repositoryIds = remapParticipantRepositoryIds(batch.repositoryIds, mappings);
        return repositoryIds === batch.repositoryIds ? batch : { ...batch, repositoryIds };
      });
      if (repositoryIds !== organization.scope.repositoryIds
        || entries.some((entry, index) => entry !== organization!.entries[index])
        || batches.some((batch, index) => batch !== organization!.batches[index])) {
        touched = true;
        organization = { ...organization, scope: { ...organization.scope, repositoryIds }, entries, batches };
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
  const { repositoryChatStorage } = await import('./repositoryChatStorage');
  const discoveryWorkspace = await exportDiscoveryWorkspaceBackup(scope.ownerId, false);
  // Preflight the new stores before committing the existing participant.
  remapDiscoveryWorkspaceBackup(structuredClone(discoveryWorkspace), mappings);
  const workbench = await repositoryChatStorage.mutateRepositoryIdentityReferences(scope.ownerId, snapshot => remapWorkbench(snapshot, scope.ownerId, mappings));
  const [{ migrateDiscoveryWorkspaceIdentities }, { migrateRepositoryAnalysisAssetIdentities }] = await Promise.all([
    import('../features/discovery/workspace/storage'), import('./repositoryAnalysisAssets'),
  ]);
  const workspace = discoveryWorkspace.workspace ? await migrateDiscoveryWorkspaceIdentities(scope.ownerId, mappings) : { changed: 0 };
  const analyses = discoveryWorkspace.analyses?.assets.some(asset => mappings.some(row => row.oldId === asset.repositoryId))
    ? await migrateRepositoryAnalysisAssetIdentities(scope.ownerId, mappings) : { changed: 0 };
  return { changed: workbench.changed + workspace.changed + analyses.changed };
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
