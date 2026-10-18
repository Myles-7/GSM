import type { ClassificationSchemeId } from '../types/classification';
import type { IntegratedCategoryOperation, OrganizationCategory, OrganizationEntry, OrganizationMembership, OrganizationSchemeDraft, OrganizationTransaction } from '../types/aiOrganization';
import type { WorkbenchProposal } from '../types/aiWorkbench';
import type { AppStoreState } from '../store/types';
import { useAppStore } from '../store/useAppStore';
import { classificationMembership, classificationProjection } from '../store/helpers/classificationSchemes';
import { organizationCategories } from '../store/helpers/repositoryOrganization';
import { sameMembership, organizationTransaction, validateOrganizationAssignment } from '../store/helpers/aiOrganizationTransaction';
import { stableStructure, structureSnapshot } from '../store/helpers/organizationStructure';
import { CLASSIFICATION_SCHEME_IDS, createDualOrganizationDraft, organizationFingerprint, organizationSourceMetadata } from './aiOrganizationDual';
import { requireOrganizationProposal, saveOrganizationProposal } from './aiOrganizationExecution';
import { forceSyncToBackend } from './autoSync';
import { emptyReplacedCategories, withDualStructureRetirement } from './aiOrganizationDualStructure';

export type CategoryTreeEdit = {
  kind: 'create' | 'rename' | 'merge' | 'withdraw';
  targetId?: string; parentId?: string | null; sourceIds?: string[];
  name?: string; icon?: string; operationId?: string;
};
const pending = (op: IntegratedCategoryOperation) => ['pending', 'conflict'].includes(op.status);
const copy = <T,>(value: T): T => structuredClone(value);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1500);
function unchanged(repositoryId: number, before: OrganizationMembership): OrganizationEntry {
  return { repositoryId, before, categoryId: before.categoryId, subcategoryId: before.subcategoryId, reason: '', disposition: 'unchanged', selected: false, overrideLocked: false, manual: true, status: 'pending' };
}
function editable(proposal: WorkbenchProposal) {
  if (!proposal.organization?.dual || !['ready', 'interrupted'].includes(proposal.organization.status)) throw new Error('Draft is not editable');
}

export async function createManualOrganizationProposal(sessionId: string, configId: string, previous?: WorkbenchProposal) {
  const state = useAppStore.getState(); const date = new Date().toISOString();
  const organization = createDualOrganizationDraft({ repositories: state.repositories, scopeName: 'all', instruction: '', configId: configId || 'manual', previous: previous?.organization });
  organization.status = 'ready'; organization.structureReady = true; organization.dual!.phase = 'review'; organization.dual!.outcome = 'unchanged';
  organization.batches.forEach(batch => { batch.status = 'complete'; });
  for (const id of CLASSIFICATION_SCHEME_IDS) {
    const scheme = organization.dual!.schemes[id]; scheme.ready = true; scheme.cleanupReplaced = false; scheme.structureOperations = [];
    scheme.entries = state.repositories.map(repo => unchanged(repo.id, classificationMembership(repo, id)));
  }
  const proposal: WorkbenchProposal = { id: crypto.randomUUID(), ownerId: String(state.user?.id ?? ''), sessionId, createdAt: date, updatedAt: date, operations: [], organization };
  await saveOrganizationProposal(proposal); return proposal;
}

function includeMembers(proposal: WorkbenchProposal, ids: number[]) {
  const draft = proposal.organization!; const dual = draft.dual!; const state = useAppStore.getState();
  const missing = ids.filter(id => !draft.scope.repositoryIds.includes(id));
  for (const id of missing) {
    const repo = state.repositories.find(repo => repo.id === id); if (!repo) throw new Error('Repository disappeared');
    draft.scope.repositoryIds.push(id);
    dual.understanding.push({ repositoryId: id, fingerprint: organizationFingerprint(repo), sourceMetadata: organizationSourceMetadata(repo), status: 'pending', purpose: [], technology: [], sources: [] });
    for (const schemeId of CLASSIFICATION_SCHEME_IDS) dual.schemes[schemeId].entries.push(unchanged(id, classificationMembership(repo, schemeId)));
  }
  if (missing.length) draft.batches.push(...Array.from({ length: Math.ceil(missing.length / 20) }, (_, i) => ({ repositoryIds: missing.slice(i * 20, i * 20 + 20), status: 'complete' as const })));
}

/** All edits affect the proposal only. A model is not needed for explicit user edits. */
export function changeCategoryTree(proposal: WorkbenchProposal, schemeId: ClassificationSchemeId, edit: CategoryTreeEdit): WorkbenchProposal {
  editable(proposal); const next = copy(proposal); const scheme = next.organization!.dual!.schemes[schemeId];
  const operations = scheme.structureOperations ??= [];
  if (edit.kind === 'withdraw') {
    const op = operations.find(op => op.id === edit.operationId && pending(op)); if (!op) throw new Error('Only unapplied changes can be withdrawn');
    if (op.kind === 'create' && (scheme.categories.some(cat => cat.parentId === op.targetId) || operations.some(other => other.id !== op.id && pending(other) && (other.targetId === op.targetId || other.sourceIds.includes(op.targetId))))) throw new Error('Withdraw dependent changes first');
    if (op.kind === 'create') {
      scheme.categories = scheme.categories.filter(cat => cat.id !== op.targetId);
      for (const entry of scheme.entries) if (entry.status === 'pending' && (entry.categoryId === op.targetId || entry.subcategoryId === op.targetId)) Object.assign(entry, { categoryId: entry.before.categoryId, subcategoryId: entry.before.subcategoryId, disposition: 'unchanged', selected: false });
    } else {
      const restoredIds = new Set(op.kind === 'merge' ? op.categoriesBefore.map(cat => cat.id) : [op.targetId]);
      scheme.categories = scheme.categories.map(cat => restoredIds.has(cat.id) ? copy(op.categoriesBefore.find(old => old.id === cat.id) ?? cat) : cat);
      if (op.kind === 'merge') for (const entry of scheme.entries) {
        const before = op.entriesBefore.find(row => row.repositoryId === entry.repositoryId); if (before && entry.status === 'pending') Object.assign(entry, copy(before));
      }
      if (op.kind === 'merge') {
        if (!op.categoriesBefore.some(cat => cat.id === op.targetId)) scheme.categories = scheme.categories.filter(cat => cat.id !== op.targetId);
        const related = (other: IntegratedCategoryOperation) => op.categoriesBefore.some(cat => cat.id === other.targetId) || [op.targetId, ...op.sourceIds].includes(other.parentId ?? '');
        const removed = operations.filter((other, index) => index > operations.indexOf(op) && pending(other) && related(other));
        scheme.structureOperations = operations.filter(other => other.id !== op.id && !removed.includes(other));
        scheme.categories = scheme.categories.filter(cat => !removed.some(other => other.kind === 'create' && other.targetId === cat.id));
        for (const other of scheme.structureOperations.filter(other => pending(other) && related(other))) {
          const category = scheme.categories.find(cat => cat.id === other.targetId);
          if (category) { other.name = category.name; other.icon = category.icon; }
        }
        for (const entry of scheme.entries) if (entry.status === 'pending' && (entry.categoryId && !scheme.categories.some(cat => cat.id === entry.categoryId) || entry.subcategoryId && !scheme.categories.some(cat => cat.id === entry.subcategoryId))) Object.assign(entry, unchanged(entry.repositoryId, entry.before));
        return next;
      }
    }
    scheme.structureOperations = operations.filter(other => other.id !== op.id);
    return next;
  }
  const name = edit.name?.trim();
  if (edit.kind !== 'merge' && (!name || name.length > 120)) throw new Error('Enter a category name (1–120 characters)');
  const target = scheme.categories.find(cat => cat.id === edit.targetId);
  if (edit.kind === 'rename' && !target) throw new Error('Category disappeared');
  const parentId = edit.kind === 'create' || edit.kind === 'merge' && !target ? edit.parentId ?? null : target?.parentId ?? null;
  if (parentId && !scheme.categories.some(cat => cat.id === parentId && !cat.parentId)) throw new Error('Choose a valid main category');
  const targetId = target?.id ?? crypto.randomUUID();
  const sourceIds = edit.kind === 'merge' ? edit.sourceIds ?? [] : [];
  const activeMerges = operations.filter(op => op.kind === 'merge' && pending(op));
  if (edit.kind === 'merge') {
    if (!sourceIds.length || new Set(sourceIds).size !== sourceIds.length || sourceIds.includes(targetId)
      || sourceIds.some(id => !scheme.categories.some(cat => cat.id === id && (cat.parentId ?? null) === parentId))) throw new Error('Choose distinct source categories with the same parent');
    if (activeMerges.some(op => [...op.sourceIds, op.targetId].some(id => [...sourceIds, targetId].includes(id)))) throw new Error('Resolve or withdraw the existing merge before creating a dependent merge');
  }
  const effectiveName = edit.kind === 'merge' && target ? target.name : name;
  if (!effectiveName || effectiveName.length > 120) throw new Error('Enter a category name');
  const mergeOwner = activeMerges.find(op => op.targetId === parentId || op.targetId === targetId || op.sourceIds.includes(targetId));
  if (scheme.categories.some(cat => cat.id !== targetId && !sourceIds.includes(cat.id) && cat.parentId === parentId && cat.name.toLocaleLowerCase() === effectiveName.toLocaleLowerCase()) && !mergeOwner) throw new Error('A category with that name already exists');
  const beforeCategories = edit.kind === 'merge' ? copy(scheme.categories.filter(cat => [targetId, ...sourceIds].includes(parentId ? cat.id : cat.parentId ?? cat.id))) : target ? [copy(target)] : [];
  const existing = operations.find(op => pending(op) && op.targetId === targetId && op.kind !== 'merge');
  if (edit.kind === 'rename' && existing) {
    existing.name = effectiveName; existing.icon = edit.icon ?? target!.icon; delete existing.error; existing.status = 'pending';
    Object.assign(target!, { name: effectiveName, icon: existing.icon }); return next;
  }
  if (edit.kind === 'rename' && mergeOwner?.targetId === targetId) {
    mergeOwner.name = effectiveName; mergeOwner.icon = edit.icon ?? target!.icon; Object.assign(target!, { name: effectiveName, icon: mergeOwner.icon }); return next;
  }
  const state = useAppStore.getState(); const affected = new Set([targetId, ...sourceIds]);
  const members = state.repositories.filter(repo => {
    const membership = classificationMembership(repo, schemeId);
    return affected.has((parentId && edit.kind === 'merge' ? membership.subcategoryId : membership.categoryId) ?? '');
  }).map(repo => ({ repositoryId: repo.id, before: classificationMembership(repo, schemeId) }));
  if (edit.kind === 'merge') includeMembers(next, members.map(member => member.repositoryId));
  const op: IntegratedCategoryOperation = { id: crypto.randomUUID(), kind: edit.kind, targetId, sourceIds, parentId, name: effectiveName, icon: edit.icon ?? target?.icon ?? 'folder', selected: true, status: 'pending', categoriesBefore: beforeCategories, members, entriesBefore: edit.kind === 'merge' ? copy(scheme.entries.filter(entry => members.some(member => member.repositoryId === entry.repositoryId))) : [] };
  if (!target) scheme.categories.push({ id: targetId, name: effectiveName, icon: op.icon, parentId, isNew: true });
  else if (edit.kind === 'rename') Object.assign(target, { name: effectiveName, icon: op.icon });
  if (edit.kind === 'merge') {
    if (!parentId) for (const child of scheme.categories) if (child.parentId && sourceIds.includes(child.parentId)) child.parentId = targetId;
    for (const member of members) {
      const entry = scheme.entries.find(entry => entry.repositoryId === member.repositoryId)!;
      if (entry.status === 'success') throw new Error('Start a new draft to merge already-applied memberships');
      const subcategoryId = parentId ? targetId : entry.manual && entry.subcategoryId && scheme.categories.some(cat => cat.id === entry.subcategoryId && cat.parentId === targetId) ? entry.subcategoryId : member.before.subcategoryId;
      const categoryId = parentId ?? targetId;
      const moving = member.before.categoryId !== categoryId || member.before.subcategoryId !== subcategoryId;
      Object.assign(entry, { categoryId, subcategoryId, manual: true, reason: state.language.startsWith('zh') ? '按指定目标合并类别，保留一级归属及分组映射。' : 'Explicit category merge with retained membership mapping', disposition: moving ? 'move' : 'unchanged', selected: moving && (!member.before.locked || member.before.categoryId === categoryId), overrideLocked: false, status: 'pending' });
      delete entry.error;
    }
  }
  operations.push(op); scheme.ready = true;
  return next;
}
export async function editCategoryTree(id: string, expected: string, schemeId: ClassificationSchemeId, edit: CategoryTreeEdit) {
  const next = changeCategoryTree(await requireOrganizationProposal(id, expected), schemeId, edit);
  next.organization!.dual!.outcome = Object.values(next.organization!.dual!.schemes).some(scheme => scheme.structureOperations?.some(pending) || scheme.entries.some(entry => entry.disposition === 'move')) ? 'complete' : 'unchanged';
  await saveOrganizationProposal(next, expected); return next;
}

export async function continueLegacyCategoryProposal(id: string, expected: string, configId: string) {
  const original = await requireOrganizationProposal(id, expected);
  const proposal = await createManualOrganizationProposal(original.sessionId, configId, original);
  const schemeId = original.organization!.singleSchemeId ?? 'purpose';
  let next = proposal;
  for (const op of original.organization!.structureOperations?.filter(op => op.status === 'pending' && op.selected) ?? []) {
    try {
      const affected = new Set([op.targetId, ...op.sourceIds]);
      const actual = useAppStore.getState().repositories.filter(repo => affected.has(classificationMembership(repo, schemeId).categoryId ?? ''));
      if (op.kind === 'merge' && (actual.length !== op.members.length || op.members.some(member => {
        const repo = useAppStore.getState().repositories.find(repo => repo.id === member.repositoryId);
        return !repo || !sameMembership(classificationMembership(repo, schemeId), member.before);
      }))) throw new Error('Historical merge membership changed; review the current categories');
      next = changeCategoryTree(next, schemeId, { kind: op.kind, targetId: op.kind === 'create' || !next.organization!.dual!.schemes[schemeId].categories.some(cat => cat.id === op.targetId) ? undefined : op.targetId, sourceIds: op.sourceIds, name: op.name, icon: op.icon });
    } catch (error) { next.organization!.dual!.errors.push({ stage: 'legacy', repositoryIds: op.members.map(member => member.repositoryId), message: errorText(error) }); }
  }
  if (!original.organization!.structureOperations?.length) {
    const scheme = next.organization!.dual!.schemes[schemeId];
    for (const entry of original.organization!.entries.filter(entry => entry.status === 'pending' && entry.selected)) {
      const current = scheme.entries.find(row => row.repositoryId === entry.repositoryId);
      if (!current || !sameMembership(current.before, entry.before)) {
        next.organization!.dual!.errors.push({ stage: 'legacy', repositoryIds: [entry.repositoryId], message: 'Historical repository membership changed; review its current target' }); continue;
      }
      for (const category of original.organization!.categories.filter(cat => [entry.categoryId, entry.subcategoryId].includes(cat.id))) {
        if (!scheme.categories.some(cat => cat.id === category.id) && category.isNew) scheme.categories.push(copy(category));
      }
      if (entry.categoryId && !scheme.categories.some(cat => cat.id === entry.categoryId)) {
        next.organization!.dual!.errors.push({ stage: 'legacy', repositoryIds: [entry.repositoryId], message: 'Historical target category disappeared; select a current target' }); continue;
      }
      Object.assign(current, copy(entry), { manual: true });
    }
  }
  await saveOrganizationProposal(next); return next;
}

export interface CategoryApplicationPreview {
  transactions: OrganizationTransaction[];
  eligible: { schemeId: ClassificationSchemeId; operationIds: string[]; repositoryIds: number[]; createdIds: string[] }[];
  deferred: { schemeId: ClassificationSchemeId; operationId: string; reason: string }[];
  conflicts: { schemeId: ClassificationSchemeId; repositoryId: number; reason: string }[];
}
function validateMerge(scheme: OrganizationSchemeDraft, op: IntegratedCategoryOperation, view: AppStoreState) {
  const affected = new Set([op.targetId, ...op.sourceIds]);
  const actual = view.repositories.filter(repo => affected.has((op.parentId ? repo.subcategory_id : repo.category_id) ?? ''));
  if (actual.length !== op.members.length || actual.some(repo => !op.members.some(member => member.repositoryId === repo.id && sameMembership(classificationMembership(repo, 'purpose'), member.before)))) throw new Error('Merge membership changed; create a fresh preview');
  for (const member of op.members) {
    const entry = scheme.entries.find(row => row.repositoryId === member.repositoryId);
    if (!entry || entry.categoryId !== (op.parentId ?? op.targetId) || op.parentId && entry.subcategoryId !== op.targetId || entry.disposition === 'insufficient' || entry.error || entry.status !== 'pending') throw new Error('Resolve all affected repository targets before merging');
    if (entry.subcategoryId && !scheme.categories.some(cat => cat.id === entry.subcategoryId && cat.parentId === (op.parentId ?? op.targetId))) throw new Error('Invalid subgroup mapping');
    if (!sameMembership(entry.before, member.before)) throw new Error('Merge confirmation is stale');
    const moving = entry.before.categoryId !== entry.categoryId || entry.before.subcategoryId !== entry.subcategoryId;
    if (moving && (!entry.selected || entry.before.locked && entry.before.categoryId !== entry.categoryId && !entry.overrideLocked)) throw new Error('Select all affected moves and individually authorize locked repositories');
  }
}
function mergeCategories(scheme: OrganizationSchemeDraft, op: IntegratedCategoryOperation) {
  const children = scheme.categories.filter(cat => cat.parentId === op.targetId);
  return children.filter(child => {
    const duplicate = children.some(other => other.id !== child.id && other.name.trim().toLocaleLowerCase() === child.name.trim().toLocaleLowerCase());
    const originalMembers = op.members.filter(member => member.before.subcategoryId === child.id);
    // Only explicit reassignment can retire a colliding original subgroup; empty identities are retained.
    const mappedAway = originalMembers.length > 0 && originalMembers.every(member => {
      const entry = scheme.entries.find(row => row.repositoryId === member.repositoryId);
      return entry?.manual && entry.categoryId === op.targetId && entry.subcategoryId !== child.id;
    });
    const referenced = scheme.entries.some(entry => entry.subcategoryId === child.id);
    const edited = scheme.structureOperations?.some(edit => pending(edit) && edit.kind !== 'merge' && edit.targetId === child.id);
    return !duplicate || !mappedAway || referenced || edited;
  });
}
export function finalizeCategoryMerges(scheme: OrganizationSchemeDraft, operationIds: string[]) {
  for (const op of scheme.structureOperations?.filter(op => op.kind === 'merge' && operationIds.includes(op.id)) ?? []) {
    if (op.parentId) {
      scheme.categories = scheme.categories.filter(cat => !op.sourceIds.includes(cat.id));
      continue;
    }
    const retained = new Set(mergeCategories(scheme, op).map(child => child.id));
    scheme.categories = scheme.categories.filter(cat => cat.parentId !== op.targetId || retained.has(cat.id));
    if (scheme.proposedCategoryIds) scheme.proposedCategoryIds = scheme.proposedCategoryIds.filter(id => scheme.categories.some(cat => cat.id === id));
  }
}
function setDefinition(view: AppStoreState, category: OrganizationCategory) {
  if (category.parentId) {
    const child = view.subcategories.find(cat => cat.id === category.id);
    if (child) Object.assign(child, { name: category.name, icon: category.icon, parentId: category.parentId });
    else view.subcategories.push({ id: category.id, name: category.name, icon: category.icon, parentId: category.parentId });
    if (!view.subcategoryOrder.includes(category.id)) view.subcategoryOrder.push(category.id);
  } else {
    const custom = view.customCategories.find(cat => cat.id === category.id);
    if (custom) Object.assign(custom, { name: category.name, icon: category.icon });
    else if (organizationCategories(view).some(cat => cat.id === category.id)) view.defaultCategoryOverrides[category.id] = { ...view.defaultCategoryOverrides[category.id], name: category.name, icon: category.icon };
    else view.customCategories.push({ id: category.id, name: category.name, icon: category.icon, keywords: [], isCustom: true });
    if (!view.categoryOrder.includes(category.id)) view.categoryOrder.push(category.id);
  }
}

/** Build exactly the writes shown by confirmation, without changing Store or the proposal. */
export function previewCategoryApplication(proposal: WorkbenchProposal, state = useAppStore.getState()): CategoryApplicationPreview {
  const result: CategoryApplicationPreview = { transactions: [], eligible: [], deferred: [], conflicts: [] };
  const draft = proposal.organization; if (!draft?.dual || proposal.ownerId !== String(state.user?.id ?? '')) return result;
  for (const schemeId of CLASSIFICATION_SCHEME_IDS) {
    const scheme = draft.dual.schemes[schemeId]; if (!scheme.selected) continue;
    const view = classificationProjection(state, schemeId); const expected = structureSnapshot(view);
    const operations = (scheme.structureOperations ?? []).filter(op => pending(op) && op.selected);
    const merges = (scheme.structureOperations ?? []).filter(op => op.kind === 'merge' && pending(op));
    const entryIds: number[] = []; const operationIds: string[] = []; const createdIds: string[] = []; const affected = new Set<string>(); const checkedMembers = new Map<number, OrganizationMembership>();
    if (stableStructure(expected) !== stableStructure(scheme.after ?? scheme.before)) {
      operations.forEach(op => result.deferred.push({ schemeId, operationId: op.id, reason: 'Category structure changed; refresh the draft before applying' }));
      scheme.entries.filter(entry => entry.selected && entry.status === 'pending').forEach(entry => result.conflicts.push({ schemeId, repositoryId: entry.repositoryId, reason: 'Category structure changed; review again' })); continue;
    }
    let working = { ...view, ...copy(expected), repositories: copy(view.repositories) } as AppStoreState;
    const assignments: OrganizationTransaction['assignments'] = [];
    const related = (op: IntegratedCategoryOperation, merge: IntegratedCategoryOperation) => [merge.targetId, ...merge.sourceIds].includes(op.targetId) || [merge.targetId, ...merge.sourceIds].includes(op.parentId ?? '') || merge.categoriesBefore.some(cat => cat.id === op.targetId);
    const groups = [...operations.filter(op => op.kind !== 'merge' && !merges.some(merge => related(op, merge))).map(op => [op]), ...operations.filter(op => op.kind === 'merge').map(merge => [merge, ...operations.filter(op => op.kind !== 'merge' && related(op, merge))])];
    groups.sort((a, b) => Number(a[0].kind === 'merge') - Number(b[0].kind === 'merge') || Number(!!a[0].parentId) - Number(!!b[0].parentId));
    for (const group of groups) {
      const op = group[0]; const trial = { ...working, ...copy(structureSnapshot(working)), repositories: copy(working.repositories) } as AppStoreState;
      const groupAssignments: OrganizationTransaction['assignments'] = []; const ids = new Set([op.targetId, ...op.sourceIds]);
      try {
        if (op.kind === 'merge') {
          validateMerge(scheme, op, view);
          const target = scheme.categories.find(cat => cat.id === op.targetId)!;
          setDefinition(trial, { ...target, name: op.name, icon: op.icon });
          if (!op.parentId) {
            const keywordIds = new Set([op.targetId, ...op.sourceIds]);
            const keywords = [...new Set(organizationCategories(working).filter(cat => keywordIds.has(cat.id)).flatMap(cat => cat.keywords ?? []))];
            const custom = trial.customCategories.find(cat => cat.id === op.targetId);
            if (custom) custom.keywords = keywords;
            else trial.defaultCategoryOverrides[op.targetId] = { ...trial.defaultCategoryOverrides[op.targetId], keywords };
            const children = mergeCategories(scheme, op);
            const obsolete = new Set(scheme.categories.filter(cat => cat.parentId === op.targetId && !children.some(child => child.id === cat.id)).map(cat => cat.id));
            for (const child of children) setDefinition(trial, child);
            trial.subcategories = trial.subcategories.filter(child => !obsolete.has(child.id));
            if (op.redesigned) trial.subcategories = trial.subcategories.filter(child => ![op.targetId, ...op.sourceIds].includes(child.parentId) || scheme.categories.some(cat => cat.id === child.id));
          } else {
            trial.subcategories = trial.subcategories.filter(child => !op.sourceIds.includes(child.id));
          }
          trial.subcategoryOrder = trial.subcategoryOrder.filter(id => trial.subcategories.some(child => child.id === id));
          for (const member of op.members) {
            const entry = scheme.entries.find(row => row.repositoryId === member.repositoryId)!;
            if (entry.categoryId !== entry.before.categoryId || entry.subcategoryId !== entry.before.subcategoryId) groupAssignments.push({ repositoryId: entry.repositoryId, before: entry.before, after: { categoryId: entry.categoryId, subcategoryId: entry.subcategoryId, locked: entry.before.locked }, overrideLocked: entry.overrideLocked });
          }
          if (!op.parentId) {
            trial.customCategories = trial.customCategories.filter(cat => !op.sourceIds.includes(cat.id));
            for (const sourceId of op.sourceIds) if (!working.customCategories.some(cat => cat.id === sourceId) && organizationCategories(working).some(cat => cat.id === sourceId)) {
              trial.defaultCategoryOverrides[sourceId] = { ...trial.defaultCategoryOverrides[sourceId], retired: true, mergedInto: op.targetId, retirementTargets: [op.targetId] };
              if (!trial.hiddenDefaultCategoryIds.includes(sourceId)) trial.hiddenDefaultCategoryIds.push(sourceId);
            }
            trial.categoryOrder = trial.categoryOrder.filter(id => !op.sourceIds.includes(id));
          }
          if (op.parentId) ids.add(op.parentId);
        }
        for (const item of group) if (item.kind !== 'merge') {
          const category = scheme.categories.find(cat => cat.id === item.targetId)!;
          if (op.kind === 'merge' && op.sourceIds.includes(category.id)) continue;
          setDefinition(trial, { ...category, name: item.name, icon: item.icon });
          if (category.parentId) ids.add(category.parentId);
        }
        const members = op.kind === 'merge' ? op.parentId
          ? view.repositories.filter(repo => repo.category_id === op.parentId).map(repo => ({ repositoryId: repo.id, before: classificationMembership(repo, 'purpose') }))
          : op.members : [];
        const transaction: OrganizationTransaction = { ownerId: proposal.ownerId, categories: [], assignments: groupAssignments, structureChange: { expected: structureSnapshot(working), next: structureSnapshot(trial), members, affectedCategoryIds: op.kind === 'merge' ? [...ids] : [] } };
        const patch = organizationTransaction(working, transaction); working = { ...working, ...patch };
        operationIds.push(...group.map(item => item.id)); assignments.push(...groupAssignments); entryIds.push(...groupAssignments.map(item => item.repositoryId));
        group.forEach(item => { if (item.kind === 'create' || item.kind === 'merge' && ![...organizationCategories(view), ...view.subcategories].some(cat => cat.id === item.targetId)) createdIds.push(item.targetId); });
        ids.forEach(id => affected.add(id)); members.forEach(member => checkedMembers.set(member.repositoryId, member.before));
      } catch (error) { group.forEach(item => result.deferred.push({ schemeId, operationId: item.id, reason: errorText(error) })); }
    }
    const independent: OrganizationTransaction['assignments'] = [];
    const additions = new Map<string, OrganizationCategory>();
    const main = organizationCategories(working); const mainIds = new Set(main.map(category => category.id));
    const repositoryById = new Map(working.repositories.map(repo => [repo.id, repo]));
    for (const entry of scheme.entries.filter(entry => entry.selected && entry.disposition === 'move' && entry.status === 'pending')) {
      if (merges.some(op => op.members.some(member => member.repositoryId === entry.repositoryId)) || entryIds.includes(entry.repositoryId)) continue;
      if (merges.some(op => !operationIds.includes(op.id) && [op.targetId, ...op.sourceIds].includes(entry.categoryId ?? ''))) continue;
      const repo = view.repositories.find(repo => repo.id === entry.repositoryId); const fact = draft.dual.understanding.find(row => row.repositoryId === entry.repositoryId);
      try {
        const requireFacts = !entry.manual || !Object.values(draft.dual.schemes).some(scheme => scheme.structureOperations !== undefined);
        if (!repo || !sameMembership(classificationMembership(repo, 'purpose'), entry.before) || requireFacts && (!fact || organizationFingerprint(repo) !== fact.fingerprint)) throw new Error('Repository facts or membership changed; review again');
        const missing = scheme.categories.filter(cat => [entry.categoryId, entry.subcategoryId].includes(cat.id) && cat.isNew && !mainIds.has(cat.id) && !working.subcategories.some(old => old.id === cat.id) && !additions.has(cat.id));
        if (missing.some(cat => !cat.name.trim())) throw new Error('Category identity changed');
        const targets = new Set([...mainIds, ...missing.filter(cat => !cat.parentId).map(cat => cat.id)]);
        const groups = [...working.subcategories, ...additions.values(), ...missing].filter((cat): cat is OrganizationCategory & { parentId: string } => !!cat.parentId);
        if (groups.some(group => !targets.has(group.parentId))) throw new Error('Invalid category parent');
        const assignment = { repositoryId: entry.repositoryId, before: entry.before, after: { categoryId: entry.categoryId, subcategoryId: entry.subcategoryId, locked: entry.before.locked }, overrideLocked: entry.overrideLocked };
        validateOrganizationAssignment(repositoryById.get(entry.repositoryId), assignment, targets, groups);
        independent.push(assignment);
        missing.forEach(cat => { additions.set(cat.id, cat); if (!cat.parentId) mainIds.add(cat.id); });
      } catch (error) { result.conflicts.push({ schemeId, repositoryId: entry.repositoryId, reason: errorText(error) }); }
    }
    // Validate each target cheaply; normalize the full repository collection only once.
    if (independent.length) {
      try {
        const patch = organizationTransaction(working, { ownerId: proposal.ownerId, categories: [...additions.values()], assignments: independent });
        working = { ...working, ...patch }; assignments.push(...independent); entryIds.push(...independent.map(item => item.repositoryId));
        createdIds.push(...additions.keys()); independent.forEach(item => checkedMembers.set(item.repositoryId, item.before));
      } catch (error) { independent.forEach(item => result.conflicts.push({ schemeId, repositoryId: item.repositoryId, reason: errorText(error) })); }
    }
    const retirements = scheme.cleanupReplaced ? emptyReplacedCategories(scheme, new Set(entryIds)) : scheme.retireCategoryIds ?? [];
    if (operationIds.length || entryIds.length || retirements.length) {
      let transaction: OrganizationTransaction = { schemeId, ownerId: proposal.ownerId, categories: [], assignments, structureChange: { expected, next: structureSnapshot(working), members: [...checkedMembers].map(([repositoryId, before]) => ({ repositoryId, before })), affectedCategoryIds: [...affected].filter(id => merges.some(op => operationIds.includes(op.id) && [...op.sourceIds, op.targetId].includes(id))) } };
      if (retirements.length) {
        try {
          transaction = withDualStructureRetirement(view, { ...scheme, retireCategoryIds: retirements }, { ...transaction, schemeId: undefined });
          transaction.schemeId = schemeId;
          transaction.structureChange!.members = [...new Map([...checkedMembers].map(([repositoryId, before]) => [repositoryId, { repositoryId, before }])).values(), ...transaction.structureChange!.members.filter(member => !checkedMembers.has(member.repositoryId))];
        } catch (error) {
          result.deferred.push({ schemeId, operationId: 'cleanup', reason: errorText(error) });
          if (!operationIds.length && !entryIds.length) continue;
        }
      }
      result.transactions.push(transaction); result.eligible.push({ schemeId, operationIds, repositoryIds: [...new Set(entryIds)], createdIds: [...new Set(createdIds)] });
    }
  }
  return result;
}

export async function applyIntegratedCategoryProposal(id: string, expected: string | undefined, signal?: AbortSignal) {
  const proposal = await requireOrganizationProposal(id, expected); editable(proposal);
  const draft = proposal.organization!; const preview = previewCategoryApplication(proposal);
  for (const item of preview.deferred) { const op = draft.dual!.schemes[item.schemeId].structureOperations?.find(op => op.id === item.operationId); if (op) op.error = item.reason; }
  for (const item of preview.conflicts) { const entry = draft.dual!.schemes[item.schemeId].entries.find(entry => entry.repositoryId === item.repositoryId)!; entry.status = 'conflict'; entry.error = item.reason; entry.selected = false; }
  if (!preview.transactions.length) { await saveOrganizationProposal(proposal); return proposal; }
  const state = useAppStore.getState();
  for (const item of preview.eligible) {
    const scheme = draft.dual!.schemes[item.schemeId]; const transaction = preview.transactions.find(transaction => transaction.schemeId === item.schemeId)!;
    const nextState = { ...state, ...organizationTransaction(state, transaction) }; const old = scheme.application;
    scheme.application = { status: 'prepared', before: old?.before ?? transaction.structureChange!.expected, after: transaction.structureChange!.next,
      repositoryIds: [...new Set([...(old?.repositoryIds ?? []), ...item.repositoryIds])], operationIds: [...new Set([...(old?.operationIds ?? []), ...item.operationIds])],
      createdCategoryIds: [...new Set([...(old?.createdCategoryIds ?? []), ...item.createdIds])], membersAfter: nextState.repositories.map(repo => ({ repositoryId: repo.id, before: classificationMembership(repo, item.schemeId) })) };
  }
  draft.status = 'applying'; await saveOrganizationProposal(proposal);
  try {
    signal?.throwIfAborted();
    const current = useAppStore.getState();
    for (const item of preview.eligible) for (const entry of draft.dual!.schemes[item.schemeId].entries.filter(entry => item.repositoryIds.includes(entry.repositoryId) && !entry.manual)) {
      const repo = current.repositories.find(repo => repo.id === entry.repositoryId); const fact = draft.dual!.understanding.find(row => row.repositoryId === entry.repositoryId);
      if (!repo || organizationFingerprint(repo) !== fact?.fingerprint) throw new Error('Repository facts changed while saving confirmation');
    }
    current.applyClassificationTransactions(preview.transactions);
    for (const item of preview.eligible) {
      const scheme = draft.dual!.schemes[item.schemeId];
      scheme.entries.filter(entry => item.repositoryIds.includes(entry.repositoryId)).forEach(entry => { entry.status = 'success'; delete entry.error; });
      finalizeCategoryMerges(scheme, item.operationIds);
      scheme.structureOperations?.filter(op => item.operationIds.includes(op.id)).forEach(op => { op.status = 'success'; delete op.error; });
      scheme.after = structureSnapshot(classificationProjection(useAppStore.getState(), item.schemeId)); scheme.application!.status = 'applied'; scheme.createdCategoryIds = scheme.application!.createdCategoryIds;
    }
    const remaining = Object.values(draft.dual!.schemes).some(scheme => scheme.structureOperations?.some(pending) || scheme.entries.some(entry => entry.status === 'pending' && entry.disposition === 'move'));
    draft.status = remaining ? 'ready' : 'applied';
    draft.dual!.outcome = remaining ? 'partial' : 'complete';
  } catch (error) {
    draft.status = 'interrupted';
    for (const item of preview.eligible) draft.dual!.schemes[item.schemeId].structureOperations?.filter(op => item.operationIds.includes(op.id)).forEach(op => { op.error = errorText(error); });
    await saveOrganizationProposal(proposal); return proposal;
  }
  await saveOrganizationProposal(proposal);
  try { await forceSyncToBackend({ reportFailures: true }); delete proposal.syncError; }
  catch { proposal.syncError = 'Local changes saved; synchronization failed. Retry sync without replaying changes.'; }
  await saveOrganizationProposal(proposal); return proposal;
}
