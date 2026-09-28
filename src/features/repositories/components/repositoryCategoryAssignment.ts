import { getAllCategories, useAppStore } from '../../../store/useAppStore';

/** Call only after the UI has obtained consent for changing a locked category. */
export function assignConfirmedCategory(repositoryId: number, categoryId: string | null): void {
  const state = useAppStore.getState();
  const repository = state.repositories.find(repo => repo.id === repositoryId);
  if (!repository || (repository.category_id ?? null) === categoryId) return;
  const categories = getAllCategories(state.customCategories, state.language, state.hiddenDefaultCategoryIds, state.defaultCategoryOverrides);
  const category = categories.find(item => item.id === categoryId);
  if (categoryId !== null && (!category || category.id === 'all')) return;
  state.updateRepository({
    ...repository,
    category_id: categoryId,
    subcategory_id: null,
    custom_category: category?.name ?? '',
    category_locked: categoryId !== null && !!repository.category_locked,
    last_edited: new Date().toISOString(),
  }, { overrideCategoryLock: true });
}
