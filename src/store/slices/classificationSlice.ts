import type { AppStoreSlice, AppStoreState } from '../types';
import { classificationProjection, commitClassificationProjection } from '../helpers/classificationSchemes';
import { createCategorySlice } from './categorySlice';
import { organizationTransaction } from '../helpers/aiOrganizationTransaction';

export const createClassificationSlice: AppStoreSlice<Pick<import('../types').AppActions,
  'applyClassificationTransactions' | 'setClassificationScheme' | 'setClassificationLocation' | 'setClassificationExpanded' | 'setClassificationCollapsedGroups' | 'mutateClassification' | 'updateClassificationRepository'>> = (set) => ({
  applyClassificationTransactions: transactions => set(state => {
    let next = state;
    for (const transaction of transactions) next = { ...next, ...organizationTransaction(next, transaction) };
    return next;
  }),
  setClassificationScheme: activeClassificationScheme => set({ activeClassificationScheme }),
  setClassificationLocation: (id, selected) => set(state => ({
    ...(id === 'purpose' ? { selectedCategory: selected } : {}),
    classificationNavigation: { ...state.classificationNavigation, [id]: { ...state.classificationNavigation?.[id], selected, expanded: state.classificationNavigation?.[id]?.expanded ?? [] } },
  })),
  setClassificationExpanded: (id, expanded) => set(state => ({ classificationNavigation: {
    ...state.classificationNavigation, [id]: { ...state.classificationNavigation?.[id], selected: id === 'purpose' ? state.selectedCategory : state.classificationNavigation?.[id]?.selected ?? 'all', expanded: [...new Set(expanded)] },
  } })),
  setClassificationCollapsedGroups: (id, collapsedGroups) => set(state => ({ classificationNavigation: {
    ...state.classificationNavigation, [id]: { ...state.classificationNavigation?.[id], selected: id === 'purpose' ? state.selectedCategory : state.classificationNavigation?.[id]?.selected ?? 'all', expanded: state.classificationNavigation?.[id]?.expanded ?? [], collapsedGroups: [...new Set(collapsedGroups)] },
  } })),
  mutateClassification: (id, command) => set(state => {
    const view = classificationProjection(state, id);
    let patch: Partial<AppStoreState> = {};
    const actions = createCategorySlice((update) => { patch = typeof update === 'function' ? update(view) : update; }, () => view);
    const action = actions[command.action] as (...args: unknown[]) => void;
    action(...command.args);
    return commitClassificationProjection(state, id, patch);
  }),
  updateClassificationRepository: (id, repository, options) => set(state => {
    const original = state.repositories.find(repo => repo.id === repository.id);
    if (!original) return state;
    const view = classificationProjection(state, id);
    const previous = view.repositories.find(repo => repo.id === repository.id)!;
    if (previous.category_locked && previous.category_id !== repository.category_id && !options?.overrideCategoryLock) throw new Error('Locked category requires explicit confirmation');
    // UI records are projections. Never persist their legacy fields into the other scheme.
    const patch = commitClassificationProjection(state, id, { repositories: view.repositories.map(repo => repo.id === repository.id ? repository : repo) });
    const copy = (repo: typeof repository) => repo.id === repository.id ? {
      ...repository, category_id: repo.category_id, subcategory_id: repo.subcategory_id, category_locked: repo.category_locked,
      custom_category: repo.custom_category, category_candidates: repo.category_candidates, category_legacy: repo.category_legacy, classifications: repo.classifications,
    } : repo;
    return { ...patch, repositories: (patch.repositories ?? state.repositories).map(copy), searchResults: (patch.searchResults ?? state.searchResults).map(copy) };
  }),
});
