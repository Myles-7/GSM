import { useAppStore } from '../store/useAppStore';
import { organizationCategories } from '../store/helpers/repositoryOrganization';
import { membershipOf, sameMembership } from '../store/helpers/aiOrganizationTransaction';
import type { OrganizationCategory, OrganizationEntry } from '../types/aiOrganization';
import type { WorkbenchProposal } from '../types/aiWorkbench';
import { repositoryChatStorage as storage } from './repositoryChatStorage';
import { organizationDraftSchema } from './aiOrganizationSchema';
import { forceSyncToBackend } from './autoSync';
import { classificationProjection } from '../store/helpers/classificationSchemes';
import type { ClassificationSchemeId } from '../types/classification';
import { stageOrganizationResults, acknowledgeOrganizationResults } from './aiOrganizationResultRecovery';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function organizationCategorySnapshot(id: ClassificationSchemeId = 'purpose'): OrganizationCategory[] {
  const state = classificationProjection(useAppStore.getState(), id);
  const main = organizationCategories(state).filter(c => c.id !== 'all' && c.id !== 'pending' && !c.mergedInto);
  main.sort((a, b) => (state.categoryOrder.includes(a.id) ? state.categoryOrder.indexOf(a.id) : state.categoryOrder.length) - (state.categoryOrder.includes(b.id) ? state.categoryOrder.indexOf(b.id) : state.categoryOrder.length));
  return [...main.map(c => ({ id: c.id, name: c.name, icon: c.icon, parentId: null, isNew: false })),
    ...state.subcategories.filter(c => main.some(m => m.id === c.parentId)).map(c => ({ ...c, isNew: false }))];
}
export async function requireOrganizationProposal(id: string, expectedUpdatedAt?: string): Promise<WorkbenchProposal> {
  const value = await storage.getProposal(id);
  if (!value?.organization || value.ownerId !== String(useAppStore.getState().user?.id ?? '')) throw new Error('Organization account or draft changed');
  organizationDraftSchema.parse(value.organization);
  if (expectedUpdatedAt && value.updatedAt !== expectedUpdatedAt) throw new Error('Draft changed; review the latest version');
  const session = await storage.getSession(value.sessionId);
  if (!session || session.ownerId !== value.ownerId || session.deletedAt || session.archived) throw new Error('Conversation is read-only');
  const versions = await storage.listProposals(value.ownerId, value.sessionId);
  if (value.ownerId !== String(useAppStore.getState().user?.id ?? '')) throw new Error('Organization account changed');
  if (versions.some(p => p.organization && p.organization.revision > value.organization!.revision)) throw new Error('Only the latest draft can be changed');
  return clone(value);
}
export async function saveOrganizationProposal(proposal: WorkbenchProposal, expectedUpdatedAt?: string): Promise<void> {
  if (proposal.organization?.version === 3 && proposal.organization.dual) {
    proposal.organization.categories = proposal.organization.dual.schemes.purpose.categories;
    proposal.organization.entries = proposal.organization.dual.schemes.purpose.entries;
    proposal.organization.createdCategoryIds = proposal.organization.dual.schemes.purpose.createdCategoryIds;
  }
  if (proposal.ownerId !== String(useAppStore.getState().user?.id ?? '')) throw new Error('Account changed');
  organizationDraftSchema.parse(proposal.organization);
  const existing = await storage.getProposal(proposal.id);
  if (proposal.ownerId !== String(useAppStore.getState().user?.id ?? '')) throw new Error('Account changed');
  if (existing?.organization?.agyReceipts?.length && proposal.organization) {
    proposal.organization.agyReceipts = [...new Map([...existing.organization.agyReceipts, ...(proposal.organization.agyReceipts ?? [])].map(receipt => [receipt.requestId, receipt])).values()];
  }
  const recovery = await stageOrganizationResults(proposal, existing ?? undefined);
  const expectedRevision = expectedUpdatedAt ?? (recovery.length ? existing?.updatedAt : proposal.organization?.externalAgent && existing ? proposal.updatedAt : undefined);
  proposal.updatedAt = new Date(Math.max(Date.now(), Date.parse(existing?.updatedAt ?? proposal.updatedAt) + 1)).toISOString();
  await storage.saveProposal(clone(proposal), expectedRevision);
  await acknowledgeOrganizationResults(proposal, recovery);
}
export async function editOrganizationProposal(id: string, expectedUpdatedAt: string, edit: {
  schemeId?: import('../types/classification').ClassificationSchemeId; schemeSelected?: boolean;
  retireCategoryIds?: string[];
  cleanupReplaced?: boolean;
  repositoryId?: number; patch?: Partial<Pick<OrganizationEntry, 'categoryId' | 'subcategoryId' | 'selected' | 'overrideLocked'>>;
  selection?: { repositoryIds: number[]; selected: boolean };
  categoryId?: string; name?: string;
  bulk?: { repositoryIds: number[]; categoryId?: string | null; subcategoryId?: string | null; action?: 'keep' | 'subdivide' | 'reconsider' };
}): Promise<WorkbenchProposal> {
  const proposal = await requireOrganizationProposal(id, expectedUpdatedAt);
  if (proposal.organization?.version === 3 && proposal.organization.dual) {
    const { editDualOrganizationProposal } = await import('./aiOrganizationDualExecution');
    return editDualOrganizationProposal(proposal, edit);
  }
  const draft = proposal.organization!;
  if (!['ready', 'interrupted'].includes(draft.status)) throw new Error('Draft is not editable');
  if (edit.selection) {
    const ids = new Set(edit.selection.repositoryIds);
    for (const entry of draft.entries) if (ids.has(entry.repositoryId) && entry.status === 'pending' && entry.disposition === 'move') {
      entry.selected = edit.selection.selected && (!entry.before.locked || entry.categoryId === entry.before.categoryId || entry.overrideLocked);
    }
  }
  if (edit.categoryId && edit.name !== undefined) {
    const category = draft.categories.find(c => c.id === edit.categoryId);
    if (!category?.isNew || !edit.name.trim()) throw new Error('Only new categories may be renamed');
    category.name = edit.name.trim();
    if (draft.categories.some(c => c.id !== category.id && c.parentId === category.parentId && c.name.toLocaleLowerCase() === category.name.toLocaleLowerCase())) throw new Error('Duplicate category name');
  }
  const entries = edit.bulk ? draft.entries.filter(e => edit.bulk!.repositoryIds.includes(e.repositoryId)) : draft.entries.filter(e => e.repositoryId === edit.repositoryId);
  for (const entry of entries) {
    if (entry.status !== 'pending') continue;
    const patch = edit.bulk ? edit.bulk.action === 'keep' ? { categoryId: entry.before.categoryId, subcategoryId: entry.before.subcategoryId }
      : edit.bulk.action === 'subdivide' ? { categoryId: entry.before.categoryId, subcategoryId: entry.before.subcategoryId }
      : edit.bulk.action === 'reconsider' ? { selected: false } : { categoryId: edit.bulk.categoryId ?? null, subcategoryId: edit.bulk.subcategoryId ?? null } : edit.patch;
    if (!patch) continue;
    Object.assign(entry, patch);
    if ((draft.mode === 'supplement' || entry.preserveMain) && entry.before.categoryId && entry.categoryId !== entry.before.categoryId) throw new Error('Supplement mode cannot change an existing main category');
    if ('categoryId' in patch || 'subcategoryId' in patch) {
      entry.disposition = entry.categoryId === entry.before.categoryId && entry.subcategoryId === entry.before.subcategoryId ? 'unchanged' : 'move';
      entry.manual = true;
      entry.status = 'pending';
      delete entry.error;
      entry.selected = entry.disposition === 'move';
    }
    if (edit.bulk?.action === 'reconsider') { entry.manual = false; entry.preserveMain = false; entry.disposition = 'insufficient'; entry.selected = false; entry.reason = ''; }
    if (edit.bulk?.action === 'subdivide') { entry.manual = false; entry.preserveMain = true; entry.disposition = 'insufficient'; entry.selected = false; entry.reason = ''; }
    if (entry.before.locked && entry.categoryId !== entry.before.categoryId && !entry.overrideLocked) entry.selected = false;
    if (entry.disposition !== 'move') entry.selected = false;
  }
  await saveOrganizationProposal(proposal);
  return proposal;
}
async function sync(proposal: WorkbenchProposal) {
  if (proposal.ownerId !== String(useAppStore.getState().user?.id ?? '')) throw new Error('Account changed');
  let syncErr: string | undefined;
  try { await forceSyncToBackend({ reportFailures: true }); }
  catch { syncErr = 'Local changes saved; backend synchronization failed. Retry synchronization.'; }
  const latest = await storage.getProposal(proposal.id);
  const target = latest ?? proposal;
  if (syncErr) {
    target.syncError = syncErr;
  } else {
    delete target.syncError;
  }
  if (latest?.organization && proposal.organization) {
    for (const pe of proposal.organization.entries) {
      if (pe.status === 'success' || pe.status === 'conflict') {
        const te = target.organization!.entries.find(e => e.repositoryId === pe.repositoryId);
        if (te) {
          te.status = pe.status;
          te.categoryId = pe.categoryId;
          te.subcategoryId = pe.subcategoryId;
          te.selected = pe.selected;
          if (pe.error) te.error = pe.error;
          else delete te.error;
        }
      }
    }
    target.organization!.createdCategoryIds = Array.from(new Set([
      ...target.organization!.createdCategoryIds,
      ...proposal.organization.createdCategoryIds,
    ]));
  }
  await saveOrganizationProposal(target);
  return target;
}
export async function retryOrganizationSync(id: string): Promise<WorkbenchProposal> {
  return sync(await requireOrganizationProposal(id));
}

export async function applyOrganizationProposal(id: string, expectedUpdatedAt?: string, signal?: AbortSignal, targetRepositoryIds?: number[]): Promise<WorkbenchProposal> {
  const current = await storage.getProposal(id);
  if (current?.organization?.version === 3 && current.organization.dual) {
    const { applyDualOrganizationProposal } = await import('./aiOrganizationDualExecution');
    return applyDualOrganizationProposal(id, expectedUpdatedAt, signal);
  }
  const proposal = await requireOrganizationProposal(id, expectedUpdatedAt);
  signal?.throwIfAborted();
  const draft = proposal.organization!;
  if (draft.purpose === 'structure') throw new Error('Historical structure drafts are read-only here; continue in a new organization draft');
  if (!['ready', 'interrupted', 'generating'].includes(draft.status)) throw new Error('Generate a new draft before applying');
  const currentCategories = organizationCategorySnapshot(draft.singleSchemeId);
  const currentById = new Map(currentCategories.map(c => [c.id, c]));
  const valid: OrganizationEntry[] = [];
  const targetIdSet = targetRepositoryIds && targetRepositoryIds.length > 0 ? new Set(targetRepositoryIds) : null;
  for (const entry of draft.entries.filter(e => e.selected && e.disposition === 'move' && e.status === 'pending')) {
    if (targetIdSet && !targetIdSet.has(entry.repositoryId)) continue;
    const repository = classificationProjection(useAppStore.getState(), draft.singleSchemeId ?? 'purpose').repositories.find(r => r.id === entry.repositoryId);
    const targets = draft.categories.filter(c => c.id === entry.categoryId || c.id === entry.subcategoryId);
    let error: string | undefined;
    if (!repository || !sameMembership(membershipOf(repository), entry.before)) error = 'Repository membership or lock changed';
    else if ((draft.mode === 'supplement' || entry.preserveMain) && entry.before.categoryId && entry.categoryId !== entry.before.categoryId) error = 'Supplement mode cannot change an existing main category';
    else if (entry.before.locked && entry.categoryId !== entry.before.categoryId && !entry.overrideLocked) error = 'Locked category requires explicit confirmation';
    else if (targets.some(c => {
      const isAlreadyCreated = draft.createdCategoryIds.includes(c.id);
      if (c.isNew && !isAlreadyCreated) return currentById.has(c.id);
      return !currentById.has(c.id) || currentById.get(c.id)?.parentId !== c.parentId;
    })) error = 'Target category changed';
    if (error) { entry.status = 'conflict'; entry.error = error; entry.selected = false; }
    else valid.push(entry);
  }
  const referenced = new Set(valid.flatMap(e => [e.categoryId, e.subcategoryId]).filter((v): v is string => !!v));
  const additions = draft.categories.filter(c => c.isNew && referenced.has(c.id) && !currentById.has(c.id) && !draft.createdCategoryIds.includes(c.id));
  const priorStatus = draft.status;
  if (priorStatus !== 'generating') {
    draft.status = 'applying';
  }
  await saveOrganizationProposal(proposal);
  try {
    signal?.throwIfAborted();
    useAppStore.getState().applyAIOrganization({ schemeId: draft.singleSchemeId ?? 'purpose', ownerId: proposal.ownerId, categories: additions,
      assignments: valid.map(e => ({ repositoryId: e.repositoryId, before: e.before, after: { categoryId: e.categoryId, subcategoryId: e.subcategoryId, locked: e.before.locked }, overrideLocked: e.overrideLocked })) });
    valid.forEach(e => { e.status = 'success'; });
    draft.createdCategoryIds = Array.from(new Set([...draft.createdCategoryIds, ...additions.map(c => c.id)]));
    const hasRemainingPending = draft.entries.some(e => e.status === 'pending' && e.disposition === 'move');
    if (priorStatus === 'generating') {
      draft.status = 'generating';
    } else {
      draft.status = hasRemainingPending ? 'ready' : 'applied';
    }
  } catch (error) {
    valid.forEach(e => { e.status = 'conflict'; e.error = error instanceof Error ? error.message : String(error); e.selected = false; });
    draft.status = 'interrupted';
  }

  const latestStored = await storage.getProposal(proposal.id);
  if (latestStored?.organization) {
    proposal.organization!.batches = latestStored.organization.batches;
    const validRepoIds = new Set(valid.map(e => e.repositoryId));
    for (const storedEntry of latestStored.organization.entries) {
      if (!validRepoIds.has(storedEntry.repositoryId)) {
        const idx = proposal.organization!.entries.findIndex(e => e.repositoryId === storedEntry.repositoryId);
        if (idx >= 0) {
          proposal.organization!.entries[idx] = storedEntry;
        }
      }
    }
    const existingCatIds = new Set(proposal.organization!.categories.map(c => c.id));
    for (const cat of latestStored.organization.categories) {
      if (!existingCatIds.has(cat.id)) {
        proposal.organization!.categories.push(cat);
      }
    }
    proposal.organization!.createdCategoryIds = Array.from(new Set([
      ...proposal.organization!.createdCategoryIds,
      ...latestStored.organization.createdCategoryIds,
    ]));
    if (priorStatus === 'generating' && draft.status !== 'interrupted') {
      proposal.organization!.status = 'generating';
    }
  }

  await saveOrganizationProposal(proposal);
  return valid.some(e => e.status === 'success') ? sync(proposal) : proposal;
}

export async function restoreOrganizationProposal(id: string, expectedUpdatedAt: string, signal?: AbortSignal): Promise<WorkbenchProposal> {
  const current = await storage.getProposal(id);
  if (current?.organization?.version === 3 && current.organization.dual) {
    const { restoreDualOrganizationProposal } = await import('./aiOrganizationDualExecution');
    return restoreDualOrganizationProposal(id, expectedUpdatedAt, signal);
  }
  const proposal = await requireOrganizationProposal(id, expectedUpdatedAt);
  signal?.throwIfAborted();
  const draft = proposal.organization!;
  if (!['applied', 'restoring'].includes(draft.status)) throw new Error('No applied changes to restore');
  const currentCategories = organizationCategorySnapshot(draft.singleSchemeId);
  const valid: OrganizationEntry[] = [];
  for (const entry of draft.entries.filter(e => e.status === 'success')) {
    const repo = classificationProjection(useAppStore.getState(), draft.singleSchemeId ?? 'purpose').repositories.find(r => r.id === entry.repositoryId);
    const after = { categoryId: entry.categoryId, subcategoryId: entry.subcategoryId, locked: entry.before.locked };
    if (!repo || !sameMembership(membershipOf(repo), after)
      || (entry.before.categoryId && !currentCategories.some(c => c.id === entry.before.categoryId && !c.parentId))
      || (entry.before.subcategoryId && !currentCategories.some(c => c.id === entry.before.subcategoryId && c.parentId === entry.before.categoryId))) {
      entry.status = 'conflict'; entry.error = 'Cannot restore: repository or original category changed';
    } else valid.push(entry);
  }
  draft.status = 'restoring';
  await saveOrganizationProposal(proposal);
  signal?.throwIfAborted();
  useAppStore.getState().applyAIOrganization({ schemeId: draft.singleSchemeId ?? 'purpose', ownerId: proposal.ownerId, categories: [],
    assignments: valid.map(e => ({ repositoryId: e.repositoryId, before: { categoryId: e.categoryId, subcategoryId: e.subcategoryId, locked: e.before.locked }, after: e.before, overrideLocked: e.overrideLocked })),
    removeCategories: draft.categories.filter(c => draft.createdCategoryIds.includes(c.id)),
  });
  valid.forEach(e => { e.status = 'restored'; });
  draft.status = 'restored';
  await saveOrganizationProposal(proposal);
  return sync(proposal);
}

/** Reconcile journals only. Never replay a write after restarting the app. */
export async function reconcileOrganizationProposal(proposal: WorkbenchProposal): Promise<WorkbenchProposal> {
  const draft = proposal.organization;
  if (!draft || !['generating', 'applying', 'restoring'].includes(draft.status)) return proposal;
  if (draft.version === 3 && draft.dual) {
    const { reconcileDualOrganizationProposal } = await import('./aiOrganizationDualExecution');
    return reconcileDualOrganizationProposal(proposal);
  }
  if (draft.purpose === 'structure') {
    const { reconcileCategoryStructure } = await import('./aiCategoryStructure');
    return reconcileCategoryStructure(proposal);
  }
  if (draft.status === 'generating') draft.status = 'interrupted';
  else {
    const restoring = draft.status === 'restoring';
    for (const e of draft.entries.filter(entry => restoring ? entry.status === 'success' : entry.selected && entry.disposition === 'move')) {
      const repo = classificationProjection(useAppStore.getState(), draft.singleSchemeId ?? 'purpose').repositories.find(r => r.id === e.repositoryId);
      const expected = restoring ? e.before : { categoryId: e.categoryId, subcategoryId: e.subcategoryId, locked: e.before.locked };
      if (repo && sameMembership(membershipOf(repo), expected)) e.status = restoring ? 'restored' : 'success';
      else { e.status = 'conflict'; e.error = 'Interrupted operation requires review'; e.selected = false; }
    }
    draft.status = restoring ? 'restored' : 'applied';
  }
  await saveOrganizationProposal(proposal);
  return proposal;
}
