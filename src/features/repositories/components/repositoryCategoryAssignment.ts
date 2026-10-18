import { getAllCategories, useAppStore } from '../../../store/useAppStore';
import { classificationProjection } from '../../../store/helpers/classificationSchemes';
import { organizationCategories } from '../../../store/helpers/repositoryOrganization';
import type { ClassificationSchemeId } from '../../../types/classification';

/** Call only after the UI has obtained consent for changing a locked category. */
export function assignConfirmedCategory(repositoryId: number, categoryId: string | null, schemeId: ClassificationSchemeId = 'purpose'): void {
  const canonical = useAppStore.getState();
  const state = classificationProjection(canonical, schemeId);
  const repository = state.repositories.find(repo => repo.id === repositoryId);
  if (!repository || (repository.category_id ?? null) === categoryId) return;
  const categories = schemeId === 'purpose' ? getAllCategories(state.customCategories, state.language, state.hiddenDefaultCategoryIds, state.defaultCategoryOverrides) : organizationCategories(state);
  const category = categories.find(item => item.id === categoryId);
  if (categoryId !== null && (!category || category.id === 'all')) return;
  const next = {
    ...repository,
    category_id: categoryId,
    subcategory_id: null,
    custom_category: category?.name ?? '',
    category_locked: categoryId !== null && !!repository.category_locked,
    last_edited: new Date().toISOString(),
  };
  if (schemeId === 'purpose') canonical.updateRepository(next, { overrideCategoryLock: true });
  else canonical.updateClassificationRepository(schemeId, next, { overrideCategoryLock: true });
}
