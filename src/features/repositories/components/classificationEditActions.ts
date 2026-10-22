import { useAppStore } from '../../../store/useAppStore';
import { classificationProjection } from '../../../store/helpers/classificationSchemes';
import { classificationEditToken, type ClassificationEditOperation, type ClassificationTarget } from '../../../store/helpers/classificationEdits';
import type { ClassificationSchemeId } from '../../../types/classification';
import type { useDialog } from '../../../hooks/useDialog';
import { organizationCategories } from '../../../store/helpers/repositoryOrganization';
import { syncClassificationEdit } from '../hooks/syncClassificationEdit';

type DialogActions = Pick<ReturnType<typeof useDialog>, 'confirm' | 'toast'>;
export function captureClassificationEdit(schemeId: ClassificationSchemeId = useAppStore.getState().activeClassificationScheme ?? 'purpose') {
  const state = useAppStore.getState();
  return { schemeId, expectedAccountId: state.user?.id ?? null, expectedToken: classificationEditToken(state, schemeId) };
}
export type ClassificationEditCapture = ReturnType<typeof captureClassificationEdit>;
export function classificationTargetPath(target: ClassificationTarget, schemeId: ClassificationSchemeId): string {
  const view = classificationProjection(useAppStore.getState(), schemeId);
  const zh = view.language.startsWith('zh');
  const category = organizationCategories(view).find(item => item.id === target.categoryId);
  const group = view.subcategories.find(item => item.id === target.subcategoryId);
  return [schemeId === 'purpose' ? zh ? '用途' : 'Purpose' : zh ? '技术' : 'Technology', category?.name ?? (zh ? '待分类' : 'Pending'), group?.name].filter(Boolean).join(' / ');
}

/** Captures before showing consent; the store validates the same snapshot atomically. */
export async function performClassificationEdit(operation: ClassificationEditOperation, dialogs: DialogActions, captured = captureClassificationEdit()): Promise<boolean> {
  const canonical = useAppStore.getState();
  const zh = canonical.language.startsWith('zh');
  const view = classificationProjection(canonical, captured.schemeId);
  if (classificationEditToken(canonical, captured.schemeId) !== captured.expectedToken || (canonical.user?.id ?? null) !== captured.expectedAccountId)
    throw new Error(zh ? '分类或账号已变化，请重新打开后重试。' : 'Classification or account changed. Please reopen and try again.');
  const source = 'id' in operation ? view.subcategories.find(group => group.id === operation.id) : undefined;
  const affected = operation.type === 'assign' ? view.repositories.filter(repo => operation.repositoryIds.includes(repo.id) && ((repo.category_id ?? null) !== operation.categoryId || (repo.subcategory_id ?? null) !== operation.subcategoryId))
    : source && ['delete', 'merge', 'move'].includes(operation.type) ? view.repositories.filter(repo => repo.subcategory_id === source.id && repo.category_id === source.parentId) : [];
  const lockedCount = affected.filter(repo => repo.category_locked).length;
  if (operation.type === 'assign' && !affected.length) {
    canonical.applyClassificationEdit(captured.schemeId, { ...operation, expectedAccountId: captured.expectedAccountId, expectedToken: captured.expectedToken });
    return true;
  }
  const target: ClassificationTarget | undefined = operation.type === 'assign' ? operation
    : operation.type === 'move' ? { categoryId: operation.parentId, subcategoryId: source?.id ?? null }
    : operation.type === 'delete' ? { categoryId: source?.parentId ?? null, subcategoryId: null }
    : operation.type === 'merge' ? (() => { const group = view.subcategories.find(item => item.id === operation.targetId); return { categoryId: group?.parentId ?? null, subcategoryId: group?.id ?? null }; })() : undefined;
  if (['delete', 'merge', 'move'].includes(operation.type) || operation.type === 'assign' && (operation.repositoryIds.length > 1 || lockedCount > 0)) {
    const destination = target ? classificationTargetPath(target, captured.schemeId) : '';
    const sourcePath = source ? classificationTargetPath({ categoryId: source.parentId, subcategoryId: source.id }, captured.schemeId) : '';
    const message = `${sourcePath ? `${sourcePath}\n→ ` : ''}${destination}\n${zh ? `影响 ${affected.length} 个项目，其中 ${lockedCount} 个锁定归属。` : `Affected: ${affected.length} repositories. Locked memberships: ${lockedCount}.`}${operation.type === 'delete' ? zh ? '\n项目保留在一级分类，移出二级分类。' : '\nRepositories stay in the parent without a subgroup.' : ''}${lockedCount ? zh ? '\n确认将修改上述锁定归属。' : '\nConfirm changing these locked memberships.' : ''}`;
    if (!await dialogs.confirm(operation.type === 'delete' ? zh ? '删除二级分类' : 'Delete subgroup' : zh ? '确认分类变更' : 'Confirm classification change', message, { type: operation.type === 'delete' ? 'danger' : 'warning' })) return false;
  }
  canonical.applyClassificationEdit(captured.schemeId, { ...operation, expectedAccountId: captured.expectedAccountId, expectedToken: captured.expectedToken, overrideLocks: lockedCount > 0 });
  try {
    await syncClassificationEdit();
  } catch {
    dialogs.toast(zh ? '已保存在本地，同步失败后可重试。' : 'Saved locally. Sync failed; retry when connected.', 'error');
  }
  return true;
}
export function assignClassificationRepositories(repositoryIds: number[], target: ClassificationTarget, dialogs: DialogActions, captured = captureClassificationEdit()): Promise<boolean> {
  return performClassificationEdit({ type: 'assign', repositoryIds, ...target }, dialogs, captured);
}

export function repositoryIdsFromDrop(dataTransfer: DataTransfer): number[] {
  const multi = dataTransfer.getData('application/x-gsm-repository-ids');
  if (multi) {
    try { const ids: unknown = JSON.parse(multi); return Array.isArray(ids) && ids.every(id => Number.isSafeInteger(id) && id > 0) ? [...new Set(ids as number[])] : []; } catch { return []; }
  }
  const id = Number(dataTransfer.getData('application/x-gsm-repository-id'));
  return Number.isSafeInteger(id) && id > 0 ? [id] : [];
}
export function isRepositoryDrop(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types ?? []).some(type => type === 'application/x-gsm-repository-id' || type === 'application/x-gsm-repository-ids');
}
