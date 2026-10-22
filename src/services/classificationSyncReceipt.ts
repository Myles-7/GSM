import type { AppState } from '../types';
import { useAppStore } from '../store/useAppStore';
import { classificationExport, classificationMembership } from '../store/helpers/classificationSchemes';

export function classificationSyncSettings(state: AppState): Record<string, unknown> {
  return {
    classificationSchemes: classificationExport(state), customCategories: state.customCategories,
    hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds, defaultCategoryOverrides: state.defaultCategoryOverrides,
    categoryOrder: state.categoryOrder, subcategories: state.subcategories, subcategoryOrder: state.subcategoryOrder,
    repositoryOrder: state.repositoryOrder, categoryListIdMap: state.categoryListIdMap,
  };
}

/** Local version token. Runtime status is deliberately absent from its payload. */
export function classificationSyncToken(state: AppState): string {
  const generation = state.classificationSchemes?.generation;
  const exported = classificationExport(state);
  const schemes = { purpose: exported.purpose, technology: exported.technology };
  const ids = classificationSnapshotRepositoryIds(state);
  return JSON.stringify([state.user?.id, generation?.generation, generation?.sourceFingerprint,
    schemes, state.repositories.filter(repository => ids.has(String(repository.id))).map(repository => [repository.id,
      classificationMembership(repository, 'purpose'), classificationMembership(repository, 'technology'), repository.classificationInsights])]);
}

export function classificationSnapshotRepositoryIds(state: AppState): Set<string> {
  return new Set((state.classificationSchemes?.generation?.repositoryIds ?? state.classificationSchemes?.technology?.repositoryOrder
    ?? state.classificationSchemes?.purpose?.repositoryOrder
    ?? state.repositories.map(repository => repository.id)).map(String));
}

export function acknowledgeClassificationSync(snapshot: AppState): boolean {
  const current = useAppStore.getState();
  if (!snapshot.user || classificationSyncToken(snapshot) !== classificationSyncToken(current)) return false;
  if (current.classificationSchemes?.generation?.syncPending) {
    current.setClassificationGeneration({ syncPending: false,
      ...(current.classificationSchemes.generation.error?.startsWith('SYNC_PENDING:') ? { error: undefined } : {}) });
  }
  return true;
}
