import { useAppStore } from '../store/useAppStore';
import { organizationCategories } from '../store/helpers/repositoryOrganization';
import { membershipOf, sameMembership } from '../store/helpers/aiOrganizationTransaction';
import type { OrganizationCategory, OrganizationEntry } from '../types/aiOrganization';
import type { WorkbenchProposal } from '../types/aiWorkbench';
import { repositoryChatStorage as storage } from './repositoryChatStorage';
import { organizationDraftSchema } from './aiOrganizationSchema';
import { forceSyncToBackend } from './autoSync';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function organizationCategorySnapshot(): OrganizationCategory[] {
  const state = useAppStore.getState();
  return [...organizationCategories(state).filter(c => c.id !== 'all' && c.id !== 'pending').map(c => ({ id: c.id, name: c.name, icon: c.icon, parentId: null, isNew: false })),
    ...state.subcategories.map(c => ({ ...c, isNew: false }))];
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
export async function saveOrganizationProposal(proposal: WorkbenchProposal): Promise<void> {
  if (proposal.ownerId !== String(useAppStore.getState().user?.id ?? '')) throw new Error('Account changed');
  organizationDraftSchema.parse(proposal.organization);
  const existing = await storage.getProposal(proposal.id);
  if (proposal.ownerId !== String(useAppStore.getState().user?.id ?? '')) throw new Error('Account changed');
  proposal.updatedAt = new Date(Math.max(Date.now(), Date.parse(existing?.updatedAt ?? proposal.updatedAt) + 1)).toISOString();
  await storage.saveProposal(clone(proposal));
}
export async function editOrganizationProposal(id: string, expectedUpdatedAt: string, edit: {
  repositoryId?: number; patch?: Partial<Pick<OrganizationEntry, 'categoryId' | 'subcategoryId' | 'selected' | 'overrideLocked'>>;
  categoryId?: string; name?: string;
}): Promise<WorkbenchProposal> {
  const proposal = await requireOrganizationProposal(id, expectedUpdatedAt);
  const draft = proposal.organization!;
  if (!['ready', 'interrupted'].includes(draft.status)) throw new Error('Draft is not editable');
  if (edit.categoryId && edit.name !== undefined) {
    const category = draft.categories.find(c => c.id === edit.categoryId);
    if (!category?.isNew || !edit.name.trim()) throw new Error('Only new categories may be renamed');
    category.name = edit.name.trim();
  }
  const entry = draft.entries.find(e => e.repositoryId === edit.repositoryId);
  if (entry && edit.patch) {
    Object.assign(entry, edit.patch);
    if ('categoryId' in edit.patch || 'subcategoryId' in edit.patch) {
      entry.disposition = entry.categoryId === entry.before.categoryId && entry.subcategoryId === entry.before.subcategoryId ? 'unchanged' : 'move';
      entry.manual = true;
      entry.status = 'pending';
      delete entry.error;
    }
    if (entry.before.locked && entry.categoryId !== entry.before.categoryId && !entry.overrideLocked) entry.selected = false;
    if (entry.disposition !== 'move') entry.selected = false;
  }
  await saveOrganizationProposal(proposal);
  return proposal;
}
async function sync(proposal: WorkbenchProposal) {
  if (proposal.ownerId !== String(useAppStore.getState().user?.id ?? '')) throw new Error('Account changed');
  try { await forceSyncToBackend({ reportFailures: true }); delete proposal.syncError; }
  catch { proposal.syncError = 'Local changes saved; backend synchronization failed. Retry synchronization.'; }
  await saveOrganizationProposal(proposal);
  return proposal;
}
export async function retryOrganizationSync(id: string): Promise<WorkbenchProposal> {
  return sync(await requireOrganizationProposal(id));
}

export async function applyOrganizationProposal(id: string, expectedUpdatedAt: string, signal?: AbortSignal): Promise<WorkbenchProposal> {
  const proposal = await requireOrganizationProposal(id, expectedUpdatedAt);
  signal?.throwIfAborted();
  const draft = proposal.organization!;
  if (!['ready', 'interrupted'].includes(draft.status)) throw new Error('Generate a new draft before applying');
  const currentCategories = organizationCategorySnapshot();
  const currentById = new Map(currentCategories.map(c => [c.id, c]));
  const valid: OrganizationEntry[] = [];
  for (const entry of draft.entries.filter(e => e.selected && e.disposition === 'move' && e.status === 'pending')) {
    const repository = useAppStore.getState().repositories.find(r => r.id === entry.repositoryId);
    const targets = draft.categories.filter(c => c.id === entry.categoryId || c.id === entry.subcategoryId);
    let error: string | undefined;
    if (!repository || !sameMembership(membershipOf(repository), entry.before)) error = 'Repository membership or lock changed';
    else if (entry.before.locked && entry.categoryId !== entry.before.categoryId && !entry.overrideLocked) error = 'Locked category requires explicit confirmation';
    else if (targets.some(c => c.isNew ? currentById.has(c.id) : !currentById.has(c.id) || currentById.get(c.id)?.parentId !== c.parentId)) error = 'Target category changed';
    if (error) { entry.status = 'conflict'; entry.error = error; entry.selected = false; }
    else valid.push(entry);
  }
  const referenced = new Set(valid.flatMap(e => [e.categoryId, e.subcategoryId]).filter((v): v is string => !!v));
  const additions = draft.categories.filter(c => c.isNew && referenced.has(c.id));
  draft.createdCategoryIds = additions.map(c => c.id);
  draft.status = 'applying';
  await saveOrganizationProposal(proposal);
  try {
    signal?.throwIfAborted();
    useAppStore.getState().applyAIOrganization({ ownerId: proposal.ownerId, categories: additions,
      assignments: valid.map(e => ({ repositoryId: e.repositoryId, before: e.before, after: { categoryId: e.categoryId, subcategoryId: e.subcategoryId, locked: e.before.locked }, overrideLocked: e.overrideLocked })) });
    valid.forEach(e => { e.status = 'success'; });
    draft.status = 'applied';
  } catch (error) {
    valid.forEach(e => { e.status = 'conflict'; e.error = error instanceof Error ? error.message : String(error); e.selected = false; });
    draft.createdCategoryIds = [];
    draft.status = 'interrupted';
  }
  await saveOrganizationProposal(proposal);
  return valid.some(e => e.status === 'success') ? sync(proposal) : proposal;
}

export async function restoreOrganizationProposal(id: string, expectedUpdatedAt: string, signal?: AbortSignal): Promise<WorkbenchProposal> {
  const proposal = await requireOrganizationProposal(id, expectedUpdatedAt);
  signal?.throwIfAborted();
  const draft = proposal.organization!;
  if (!['applied', 'restoring'].includes(draft.status)) throw new Error('No applied changes to restore');
  const currentCategories = organizationCategorySnapshot();
  const valid: OrganizationEntry[] = [];
  for (const entry of draft.entries.filter(e => e.status === 'success')) {
    const repo = useAppStore.getState().repositories.find(r => r.id === entry.repositoryId);
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
  useAppStore.getState().applyAIOrganization({ ownerId: proposal.ownerId, categories: [],
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
  if (draft.status === 'generating') draft.status = 'interrupted';
  else {
    const restoring = draft.status === 'restoring';
    for (const e of draft.entries.filter(entry => restoring ? entry.status === 'success' : entry.selected && entry.disposition === 'move')) {
      const repo = useAppStore.getState().repositories.find(r => r.id === e.repositoryId);
      const expected = restoring ? e.before : { categoryId: e.categoryId, subcategoryId: e.subcategoryId, locked: e.before.locked };
      if (repo && sameMembership(membershipOf(repo), expected)) e.status = restoring ? 'restored' : 'success';
      else { e.status = 'conflict'; e.error = 'Interrupted operation requires review'; e.selected = false; }
    }
    draft.status = restoring ? 'restored' : 'applied';
  }
  await saveOrganizationProposal(proposal);
  return proposal;
}
