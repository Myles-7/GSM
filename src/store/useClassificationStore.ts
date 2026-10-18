import type { AppStoreState } from './types';
import { useAppStore, getAllCategories as legacyCategories } from './useAppStore';
import { classificationProjection } from './helpers/classificationSchemes';
import { classificationActionNames, type ClassificationCommand } from './classificationActions';
export { sortCategoriesByOrder } from './useAppStore';

const cache = new WeakMap<AppStoreState, AppStoreState>();
export function classificationView(state: AppStoreState): AppStoreState {
  // Purpose remains the canonical legacy view, including its purpose-bound actions.
  if ((state.activeClassificationScheme ?? 'purpose') === 'purpose') return state;
  const cached = cache.get(state);
  if (cached) return cached;
  const id = state.activeClassificationScheme ?? 'purpose';
  const view = classificationProjection(state, id);
  // Legacy actions are permanently purpose-bound, even while another view is active.
  for (const action of classificationActionNames) Object.assign(view, { [action]: (...args: unknown[]) => state.mutateClassification(id, { action, args } as ClassificationCommand) });
  view.setSelectedCategory = selected => state.setClassificationLocation(id, selected);
  view.updateRepository = (repository, options) => state.updateClassificationRepository(id, repository, options);
  view.setSearchResults = results => state.setSearchResults(results.map(repo => state.repositories.find(original => original.id === repo.id) ?? repo));
  view.updateRepositoriesMetadata = updates => {
    for (const update of updates) {
      const repo = view.repositories.find(item => item.id === update.id);
      if (repo) state.updateClassificationRepository(id, { ...repo, ...update.patch });
    }
  };
  cache.set(state, view);
  return view;
}
/** Read projection of the same Store; actions capture an explicit scheme ID. */
export function useClassificationStore<T>(selector: (state: AppStoreState) => T): T {
  return useAppStore(state => selector(classificationView(state)));
}
useClassificationStore.getState = () => classificationView(useAppStore.getState());
export function getAllCategories(...args: [...Parameters<typeof legacyCategories>, import('../types/classification').ClassificationSchemeId?]): ReturnType<typeof legacyCategories> {
  const [custom, language, hidden, overrides, schemeId] = args;
  return schemeId === 'technology' ? [...legacyCategories([], language).filter(category => category.id === 'all'), ...custom.filter(category => !category.isHidden)] : legacyCategories(custom, language, hidden, overrides);
}
