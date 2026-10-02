import type { Repository } from '../types';
import type { WorkbenchProject, WorkbenchProposal } from '../types/aiWorkbench';
import type { RepositoryChatSession } from '../types/repositoryChat';
import {
  validateRepositoryIdentityMappings,
  type RepositoryIdentityMapping,
} from '../utils/repositoryIdentity';
import type { CustomDiscoveryData } from '../features/discovery/custom/model';
import type { VectorSearchService, VectorRepositoryIdentityBackup } from './vectorSearchService';

export type { RepositoryIdentityMapping } from '../utils/repositoryIdentity';
export interface WorkbenchRepositoryIdentityScope { ownerId: string }
export interface RepositoryIdentityParticipantResult { changed: number }
export interface WorkbenchRepositoryIdentitySnapshot {
  sessions: RepositoryChatSession[];
  projects: WorkbenchProject[];
  proposals: WorkbenchProposal[];
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
  const [workbench, customDiscovery] = await Promise.all([
    repositoryChatStorage.backupRepositoryIdentityReferences(account),
    backupCustomRepositoryIdentityData(account),
  ]);
  return { account, workbench, customDiscovery, vectors: { storage: 'remote-vectorize', backedUp: false } };
}

/** Each database restores atomically; retrying after an interrupted cross-DB restore is harmless. */
export async function restoreParticipantIdentities(account: string, backup: RepositoryIdentityParticipantBackup): Promise<void> {
  if (!account?.trim() || backup?.account !== account) throw new Error('PARTICIPANT_BACKUP_ACCOUNT_CONFLICT');
  if (!backup.workbench || !['sessions', 'projects', 'proposals'].every(name =>
    Array.isArray(backup.workbench[name as keyof WorkbenchRepositoryIdentitySnapshot])
    && backup.workbench[name as keyof WorkbenchRepositoryIdentitySnapshot].every(row => row.ownerId === account))) {
    throw new Error('PARTICIPANT_BACKUP_ACCOUNT_CONFLICT');
  }
  if (backup.customDiscovery && (!Array.isArray(backup.customDiscovery.channels)
    || !Array.isArray(backup.customDiscovery.editions) || !backup.customDiscovery.cache)) {
    throw new Error('INVALID_CUSTOM_DISCOVERY_IDENTITY_BACKUP');
  }
  const { repositoryChatStorage } = await import('./repositoryChatStorage');
  await repositoryChatStorage.restoreRepositoryIdentityReferences(account, backup.workbench);
  if (backup.customDiscovery) {
    const { restoreCustomRepositoryIdentityData } = await import('../features/discovery/custom/storage');
    await restoreCustomRepositoryIdentityData(account, backup.customDiscovery);
  }
}

export function validateParticipantMappings(mappings: ReadonlyArray<RepositoryIdentityMapping>): void {
  validateRepositoryIdentityMappings(mappings);
  const names = new Set<string>();
  for (const mapping of mappings) {
    const name = mapping.fullName.toLowerCase();
    if (names.has(name)) throw new Error('AMBIGUOUS_IDENTITY_NAME');
    names.add(name);
  }
}

export function assertRepositoryIdentityName(id: number, name: string, mappings: ReadonlyArray<RepositoryIdentityMapping>): void {
  const mapping = mappings.find(item => item.oldId === id || item.newId === id);
  if (mapping && (typeof name !== 'string' || name.toLowerCase() !== mapping.fullName.toLowerCase())) {
    throw new Error('REPOSITORY_IDENTITY_NAME_CONFLICT');
  }
}

/** Only explicit repository fields are rewritten; counters, text and historical evidence are not. */
export function remapParticipantRepositoryList(repositories: Repository[], mappings: ReadonlyArray<RepositoryIdentityMapping>): Repository[] {
  const ids = new Set<number>();
  let changed = false;
  const result = repositories.map(repo => {
    assertRepositoryIdentityName(repo.id, repo.full_name, mappings);
    const mapping = mappings.find(item => item.oldId === repo.id);
    const id = mapping?.newId ?? repo.id;
    if (ids.has(id)) throw new Error('REPOSITORY_IDENTITY_COLLISION');
    ids.add(id);
    if (!mapping) return repo;
    changed = true;
    return { ...repo, id };
  });
  return changed ? result : repositories;
}

export function remapParticipantRepositoryIds(ids: number[], mappings: ReadonlyArray<RepositoryIdentityMapping>): number[] {
  const result = ids.map(id => mappings.find(item => item.oldId === id)?.newId ?? id);
  return result.some((id, index) => id !== ids[index]) ? [...new Set(result)] : ids;
}

export function remapWorkbench(snapshot: WorkbenchRepositoryIdentitySnapshot, ownerId: string, mappings: ReadonlyArray<RepositoryIdentityMapping>): RepositoryIdentityParticipantResult {
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
  return repositoryChatStorage.mutateRepositoryIdentityReferences(scope.ownerId, snapshot => remapWorkbench(snapshot, scope.ownerId, mappings));
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
