import type { ClassificationSchemeId } from '../types/classification';
import type { OrganizationEntry, OrganizationTransaction } from '../types/aiOrganization';
import type { WorkbenchProposal } from '../types/aiWorkbench';
import { useAppStore } from '../store/useAppStore';
import { classificationMembership, classificationProjection } from '../store/helpers/classificationSchemes';
import { organizationCategories } from '../store/helpers/repositoryOrganization';
import { sameMembership, organizationTransaction } from '../store/helpers/aiOrganizationTransaction';
import { stableStructure, structureSnapshot } from '../store/helpers/organizationStructure';
import { CLASSIFICATION_SCHEME_IDS, organizationFingerprint } from './aiOrganizationDual';
import { forceSyncToBackend } from './autoSync';
import { requireOrganizationProposal, saveOrganizationProposal } from './aiOrganizationExecution';
import { emptyReplacedCategories, withDualStructureRetirement } from './aiOrganizationDualStructure';

async function synchronize(proposal: WorkbenchProposal) {
  try { await forceSyncToBackend({ reportFailures: true }); delete proposal.syncError; }
  catch { proposal.syncError = 'Local changes saved; synchronization failed. Retry sync without replaying changes.'; }
  await saveOrganizationProposal(proposal); return proposal;
}
export async function editDualOrganizationProposal(proposal: WorkbenchProposal, edit: {
  schemeId?: ClassificationSchemeId; schemeSelected?: boolean; repositoryId?: number; patch?: Partial<Pick<OrganizationEntry, 'categoryId' | 'subcategoryId' | 'selected' | 'overrideLocked'>>;
  retireCategoryIds?: string[];
  cleanupReplaced?: boolean;
  selection?: { repositoryIds: number[]; selected: boolean }; categoryId?: string; name?: string;
  bulk?: { repositoryIds: number[]; categoryId?: string | null; subcategoryId?: string | null; action?: 'keep' | 'subdivide' | 'reconsider' };
}) {
  const draft = proposal.organization!; const scheme = draft.dual!.schemes[edit.schemeId ?? 'purpose'];
  if (!['ready', 'interrupted'].includes(draft.status)) throw new Error('Draft is not editable');
  if (edit.schemeSelected !== undefined) scheme.selected = edit.schemeSelected;
  if (edit.retireCategoryIds) scheme.retireCategoryIds = [...new Set(edit.retireCategoryIds)];
  if (edit.cleanupReplaced !== undefined) scheme.cleanupReplaced = edit.cleanupReplaced;
  if (edit.categoryId && edit.name !== undefined) {
    const target = scheme.categories.find(c => c.id === edit.categoryId);
    if (!target?.isNew || !edit.name.trim()) throw new Error('Only new categories may be renamed');
    target.name = edit.name.trim();
  }
  for (const entry of scheme.entries) {
    if (entry.status !== 'pending') continue;
    if (edit.selection?.repositoryIds.includes(entry.repositoryId)) entry.selected = edit.selection.selected && entry.disposition === 'move' && (!entry.before.locked || entry.categoryId === entry.before.categoryId || entry.overrideLocked);
    const patch = edit.repositoryId === entry.repositoryId ? edit.patch : edit.bulk?.repositoryIds.includes(entry.repositoryId)
      ? edit.bulk.action === 'keep' || edit.bulk.action === 'subdivide' ? { categoryId: entry.before.categoryId, subcategoryId: entry.before.subcategoryId }
      : edit.bulk.action === 'reconsider' ? { selected: false } : { categoryId: edit.bulk.categoryId ?? null, subcategoryId: edit.bulk.subcategoryId ?? null } : undefined;
    if (!patch) continue;
    if ('categoryId' in patch && patch.categoryId !== entry.categoryId && !('subcategoryId' in patch)) entry.subcategoryId = null;
    Object.assign(entry, patch);
    if ('categoryId' in patch || 'subcategoryId' in patch) { entry.manual = true; entry.disposition = entry.categoryId === entry.before.categoryId && entry.subcategoryId === entry.before.subcategoryId ? 'unchanged' : 'move'; entry.selected = entry.disposition === 'move'; delete entry.error; }
    if (edit.bulk?.action === 'reconsider' || edit.bulk?.action === 'subdivide') { entry.manual = false; entry.preserveMain = edit.bulk.action === 'subdivide'; entry.disposition = 'insufficient'; entry.selected = false; }
    if (patch.overrideLocked === true && entry.disposition === 'move') entry.selected = true;
    if (entry.before.locked && entry.categoryId !== entry.before.categoryId && !entry.overrideLocked) entry.selected = false;
    if (entry.disposition !== 'move') entry.selected = false;
  }
  await saveOrganizationProposal(proposal, proposal.updatedAt); return proposal;
}
export async function applyDualOrganizationProposal(id: string, expected: string | undefined, signal?: AbortSignal) {
  const proposal = await requireOrganizationProposal(id, expected); const draft = proposal.organization!;
  if (!draft.dual || !['ready', 'interrupted'].includes(draft.status)) throw new Error('Generate and review a draft before applying');
  if (Object.values(draft.dual.schemes).some(scheme => scheme.structureOperations !== undefined)) {
    const { applyIntegratedCategoryProposal } = await import('./aiOrganizationTree');
    return applyIntegratedCategoryProposal(id, expected, signal);
  }
  const transactions: OrganizationTransaction[] = []; const applied: { id: ClassificationSchemeId; entries: OrganizationEntry[]; additions: string[] }[] = [];
  const state = useAppStore.getState();
  for (const schemeId of CLASSIFICATION_SCHEME_IDS) {
    const scheme = draft.dual.schemes[schemeId]; if (!scheme.selected) continue;
    const selected = scheme.entries.filter(e => e.selected && e.disposition === 'move' && e.status === 'pending');
    if (!selected.length && !scheme.retireCategoryIds?.length && !scheme.cleanupReplaced) continue;
    const view = classificationProjection(state, schemeId);
    if (stableStructure(structureSnapshot(view)) !== stableStructure(scheme.after ?? scheme.before)) {
      selected.forEach(e => { e.status = 'conflict'; e.error = 'Category definitions, order or membership scope changed; generate a fresh preview'; e.selected = false; }); continue;
    }
    const valid: OrganizationEntry[] = [];
    for (const entry of selected) {
      const repo = state.repositories.find(r => r.id === entry.repositoryId);
      const evidence = draft.dual.understanding.find(r => r.repositoryId === entry.repositoryId);
      if (!repo || !sameMembership(classificationMembership(repo, schemeId), entry.before) || !evidence || organizationFingerprint(repo) !== evidence.fingerprint || entry.before.locked && entry.categoryId !== entry.before.categoryId && !entry.overrideLocked) {
        entry.status = 'conflict'; entry.selected = false; entry.error = 'Repository data, membership or lock changed; review again';
      } else valid.push(entry);
    }
    const referenced = new Set(valid.flatMap(e => [e.categoryId, e.subcategoryId]));
    const existingIds = new Set([...organizationCategories(view).map(c => c.id), ...view.subcategories.map(c => c.id)]);
    const categories = scheme.categories.filter(c => c.isNew && referenced.has(c.id) && !existingIds.has(c.id));
    const effectiveRetirements = scheme.cleanupReplaced ? emptyReplacedCategories(scheme, new Set(valid.map(entry => entry.repositoryId))) : scheme.retireCategoryIds ?? [];
    if (valid.length || effectiveRetirements.length) {
      const basic: OrganizationTransaction = { schemeId, ownerId: proposal.ownerId, categories, assignments: valid.map(e => ({ repositoryId: e.repositoryId, before: e.before, after: { categoryId: e.categoryId, subcategoryId: e.subcategoryId, locked: e.before.locked }, overrideLocked: e.overrideLocked })) };
      const transaction = withDualStructureRetirement(view, { ...scheme, retireCategoryIds: effectiveRetirements }, basic);
      const predicted = { ...state, ...organizationTransaction(state, transaction) };
      scheme.application = { status: 'prepared', repositoryIds: valid.map(e => e.repositoryId), before: structureSnapshot(view), after: structureSnapshot(classificationProjection(predicted, schemeId)), createdCategoryIds: categories.map(c => c.id), membersAfter: predicted.repositories.map(repo => ({ repositoryId: repo.id, before: classificationMembership(repo, schemeId) })) };
      transactions.push(transaction);
      applied.push({ id: schemeId, entries: valid, additions: categories.map(c => c.id) });
    }
  }
  if (!transactions.length) { await saveOrganizationProposal(proposal); return proposal; }
  draft.status = 'applying'; await saveOrganizationProposal(proposal);
  // Journal is durable before the single local Store transaction. No model/request in this block.
  try {
    signal?.throwIfAborted();
    const current = useAppStore.getState();
    for (const item of applied) for (const entry of item.entries) {
      const repo = current.repositories.find(r => r.id === entry.repositoryId);
      if (!repo || organizationFingerprint(repo) !== draft.dual.understanding.find(r => r.repositoryId === entry.repositoryId)?.fingerprint) throw new Error('Repository facts changed while saving confirmation; review again');
    }
    if (transactions.length) useAppStore.getState().applyClassificationTransactions(transactions);
    for (const item of applied) { const scheme = draft.dual.schemes[item.id]; item.entries.forEach(e => { e.status = 'success'; }); scheme.createdCategoryIds = [...new Set([...scheme.createdCategoryIds, ...item.additions])]; scheme.after = structureSnapshot(classificationProjection(useAppStore.getState(), item.id)); scheme.application!.status = 'applied'; }
    draft.status = 'applied';
  } catch (error) { draft.status = 'interrupted'; for (const item of applied) item.entries.forEach(e => { e.status = 'conflict'; e.error = error instanceof Error ? error.message : String(error); e.selected = false; }); }
  await saveOrganizationProposal(proposal); return transactions.length && draft.status === 'applied' ? synchronize(proposal) : proposal;
}
export async function restoreDualOrganizationProposal(id: string, expected: string, signal?: AbortSignal) {
  const proposal = await requireOrganizationProposal(id, expected); const draft = proposal.organization!;
  if (!draft.dual || !['applied', 'ready', 'interrupted'].includes(draft.status) || !Object.values(draft.dual.schemes).some(scheme => scheme.application?.status === 'applied' || scheme.entries.some(entry => entry.status === 'success'))) throw new Error('No applied draft to restore');
  const transactions: OrganizationTransaction[] = []; const restored: OrganizationEntry[] = [];
  for (const schemeId of CLASSIFICATION_SCHEME_IDS) {
    const scheme = draft.dual.schemes[schemeId]; const entries = scheme.entries.filter(e => e.status === 'success'); if (!entries.length && scheme.application?.status !== 'applied') continue;
    const state = useAppStore.getState(); const view = classificationProjection(state, schemeId);
    const conflict = !scheme.after || stableStructure(structureSnapshot(view)) !== stableStructure(scheme.after) || scheme.application?.membersAfter.some(row => {
      const repo = state.repositories.find(r => r.id === row.repositoryId); return !repo || !sameMembership(classificationMembership(repo, schemeId), row.before);
    }) || entries.some(e => {
      const repo = state.repositories.find(r => r.id === e.repositoryId); return !repo || !sameMembership(classificationMembership(repo, schemeId), { categoryId: e.categoryId, subcategoryId: e.subcategoryId, locked: e.before.locked });
    });
    if (conflict) { entries.forEach(e => { e.error = 'Recovery paused: classification or members changed after application'; }); continue; }
    const assignments = entries.map(e => ({ repositoryId: e.repositoryId, before: { categoryId: e.categoryId, subcategoryId: e.subcategoryId, locked: e.before.locked }, after: e.before, overrideLocked: e.overrideLocked }));
    transactions.push({ schemeId, ownerId: proposal.ownerId, categories: [], assignments,
      ...(scheme.application ? { structureChange: { expected: scheme.after!, next: scheme.application.before, members: state.repositories.map(repo => ({ repositoryId: repo.id, before: classificationMembership(repo, schemeId) })), affectedCategoryIds: organizationCategories(view).map(c => c.id) } }
        : { removeCategories: scheme.categories.filter(c => scheme.createdCategoryIds.includes(c.id)) }) });
    if (scheme.application) scheme.application.status = 'restoring';
    restored.push(...entries);
  }
  if (!transactions.length) { await saveOrganizationProposal(proposal); return proposal; }
  draft.status = 'restoring'; await saveOrganizationProposal(proposal); signal?.throwIfAborted();
  useAppStore.getState().applyClassificationTransactions(transactions); restored.forEach(e => { e.status = 'restored'; });
  for (const schemeId of CLASSIFICATION_SCHEME_IDS) if (draft.dual.schemes[schemeId].application?.status === 'restoring') {
    draft.dual.schemes[schemeId].application!.status = 'restored';
    draft.dual.schemes[schemeId].structureOperations?.filter(op => op.status === 'success').forEach(op => { op.status = 'restored'; });
  }
  draft.status = CLASSIFICATION_SCHEME_IDS.some(id => draft.dual!.schemes[id].entries.some(e => e.status === 'success') || draft.dual!.schemes[id].application?.status === 'applied') ? 'applied' : 'restored';
  await saveOrganizationProposal(proposal); return synchronize(proposal);
}

/** Read-only restart reconciliation compares the durable intent, never replays it. */
export async function reconcileDualOrganizationProposal(proposal: WorkbenchProposal) {
  const draft = proposal.organization!; const dual = draft.dual!;
  if (draft.status === 'generating') {
    draft.status = 'interrupted';
    if (dual.progress) Object.assign(dual.progress, { running: 0, queued: 0, reading: 0 });
    dual.understanding.forEach(row => { delete row.activity; });
  }
  else {
    let uncertain = false;
    for (const id of CLASSIFICATION_SCHEME_IDS) {
      const scheme = dual.schemes[id]; const log = scheme.application;
      if (!log || !['prepared', 'restoring'].includes(log.status)) continue;
      const restoring = log.status === 'restoring';
      const state = useAppStore.getState();
      const entries = scheme.entries.filter(e => log.repositoryIds.includes(e.repositoryId));
      const matches = stableStructure(structureSnapshot(classificationProjection(state, id))) === stableStructure(restoring ? log.before : log.after)
        && entries.every(e => { const repo = state.repositories.find(r => r.id === e.repositoryId); return repo && sameMembership(classificationMembership(repo, id), restoring ? e.before : { categoryId: e.categoryId, subcategoryId: e.subcategoryId, locked: e.before.locked }); });
      if (matches) {
        if (!restoring && log.operationIds?.length) {
          const { finalizeCategoryMerges } = await import('./aiOrganizationTree');
          finalizeCategoryMerges(scheme, log.operationIds);
        }
        log.status = restoring ? 'restored' : 'applied';
        scheme.after = log.after; scheme.createdCategoryIds = log.createdCategoryIds;
        entries.forEach(e => { e.status = restoring ? 'restored' : 'success'; });
        scheme.structureOperations?.filter(op => log.operationIds?.includes(op.id)).forEach(op => { op.status = restoring ? 'restored' : 'success'; });
      } else { uncertain = true; entries.forEach(e => { e.error = 'Interrupted operation requires review; no changes replayed'; e.selected = false; }); }
    }
    const pendingStructure = Object.values(dual.schemes).some(scheme => scheme.structureOperations?.some(op => ['pending', 'conflict'].includes(op.status)));
    draft.status = uncertain ? 'interrupted' : pendingStructure ? 'ready' : CLASSIFICATION_SCHEME_IDS.some(id => dual.schemes[id].application?.status === 'applied') ? 'applied' : 'restored';
  }
  await saveOrganizationProposal(proposal); return proposal;
}
