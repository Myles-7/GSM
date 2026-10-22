import type { AppStoreSlice, AppStoreState } from '../types';
import { classificationProjection, commitClassificationProjection } from '../helpers/classificationSchemes';
import { createCategorySlice } from './categorySlice';
import { organizationTransaction } from '../helpers/aiOrganizationTransaction';
import { defaultCategories } from '../schema';
import { normalizeOrder } from '../helpers/repositoryOrganization';
import type { Repository } from '../../types';
import { classificationMembershipSchema, classificationSchemesSchema, repositoryClassificationInsightsSchema } from '../../services/classificationSchema';
import { classificationChangeStats } from '../../services/classificationStats';
import { applyClassificationEdit } from '../helpers/classificationEdits';

export const createClassificationSlice: AppStoreSlice<Pick<import('../types').AppActions,
  'applyClassificationEdit' | 'applyClassificationTransactions' | 'setClassificationScheme' | 'setClassificationLocation' | 'setClassificationExpanded' | 'setClassificationCollapsedGroups' | 'mutateClassification' | 'updateClassificationRepository' | 'setClassificationGeneration' | 'replaceAIClassification'>> = (set) => ({
  applyClassificationEdit: (schemeId, command) => set(state => applyClassificationEdit(state, schemeId, command)),
  setClassificationGeneration: updates => set(state => ({ classificationSchemes: {
    ...state.classificationSchemes,
    generation: { status: 'idle', generation: 0, queuedRepositoryIds: [], ...state.classificationSchemes?.generation, ...updates },
  } })),
  replaceAIClassification: input => set(state => {
    // Validate the complete replacement before deriving any store patch.
    classificationSchemesSchema.parse({ purpose: input.purpose, technology: input.technology });
    const repositoryIds = new Set(state.repositories.map(repository => String(repository.id)));
    for (const schemeId of ['purpose', 'technology'] as const) {
      const scheme = input[schemeId];
      const categories = new Set([...scheme.customCategories.map(category => category.id), ...(schemeId === 'purpose' ? defaultCategories.filter(category => category.id !== 'all').map(category => category.id) : [])]);
      const subcategories = new Map(scheme.subcategories.map(group => [group.id, group.parentId]));
      if (scheme.subcategories.some(group => !categories.has(group.parentId)) || scheme.categoryOrder.some(id => id !== 'all' && !categories.has(id)) || scheme.subcategoryOrder.some(id => !subcategories.has(id)) || scheme.repositoryOrder.some(id => !repositoryIds.has(String(id)))) throw new Error('Invalid classification structure reference');
      for (const repositoryId of repositoryIds) {
        const assignment = input.assignments[repositoryId];
        if (!assignment) throw new Error('Missing repository classification assignment');
        const member = classificationMembershipSchema.parse(assignment[schemeId]);
        if (member.categoryId && !categories.has(member.categoryId) || member.subcategoryId && subcategories.get(member.subcategoryId) !== member.categoryId) throw new Error('Invalid classification membership reference');
      }
    }
    if (Object.keys(input.assignments).some(id => !repositoryIds.has(id))) throw new Error('Unknown repository classification assignment');
    for (const [repositoryId, value] of Object.entries(input.insights ?? {})) {
      if (!repositoryIds.has(repositoryId)) throw new Error('Unknown repository classification insight');
      repositoryClassificationInsightsSchema.parse(value);
      for (const id of ['purpose', 'technology'] as const) {
        const insight = value[id]; const member = input.assignments[repositoryId][id];
        if (insight?.categoryId !== undefined && insight.categoryId !== member.categoryId || insight?.subcategoryId !== undefined && insight.subcategoryId !== member.subcategoryId) throw new Error('Classification insight disagrees with assignment');
      }
    }
    const purposeById = new Map(input.purpose.customCategories.map(category => [category.id, category]));
    const repositories = state.repositories.map(repository => {
      const assignment = input.assignments[String(repository.id)] ?? { purpose: { categoryId: null, subcategoryId: null, locked: false }, technology: { categoryId: null, subcategoryId: null, locked: false } };
      const purposeCategory = assignment.purpose.categoryId ? purposeById.get(assignment.purpose.categoryId) : undefined;
      return {
        ...repository,
        category_id: assignment.purpose.categoryId,
        subcategory_id: assignment.purpose.subcategoryId,
        custom_category: purposeCategory?.name ?? '',
        category_locked: assignment.purpose.locked,
        category_candidates: [],
        classifications: { ...repository.classifications, technology: { ...assignment.technology } },
        category_legacy: undefined,
        classificationInsights: input.insights?.[String(repository.id)],
      };
    });
    const byId = new Map(repositories.map(repository => [repository.id, repository]));
    const replaceList = (list: Repository[]) => list.map(repository => byId.get(repository.id) ?? repository);
    const generation = { status: 'ready' as const, generation: (state.classificationSchemes?.generation?.generation ?? 0) + 1,
      queuedRepositoryIds: [], repositoryIds: state.repositories.map(repository => repository.id), algorithmVersion: state.classificationSchemes?.generation?.algorithmVersion, lastGeneratedAt: new Date().toISOString(), sourceFingerprint: input.sourceFingerprint,
      lastChange: { purpose: classificationChangeStats(state.repositories, repositories, 'purpose'), technology: classificationChangeStats(state.repositories, repositories, 'technology') } };
    const lockedDefaults = new Set(repositories.filter(repository => repository.category_locked).map(repository => repository.category_id));
    const purpose = { ...input.purpose, initialized: true, hiddenDefaultCategoryIds: defaultCategories.filter(category => category.id !== 'all' && !lockedDefaults.has(category.id)).map(category => category.id) };
    const technology = { ...input.technology, initialized: true };
    return {
      repositories,
      searchResults: replaceList(state.searchResults),
      similarView: state.similarView ? { ...state.similarView, similarResults: replaceList(state.similarView.similarResults), originalSearchResults: replaceList(state.similarView.originalSearchResults) } : null,
      customCategories: purpose.customCategories,
      hiddenDefaultCategoryIds: purpose.hiddenDefaultCategoryIds,
      defaultCategoryOverrides: purpose.defaultCategoryOverrides,
      categoryOrder: normalizeOrder(purpose.categoryOrder, [...purpose.customCategories.map(category => category.id), ...defaultCategories.filter(category => lockedDefaults.has(category.id)).map(category => category.id)]),
      subcategories: purpose.subcategories,
      subcategoryOrder: normalizeOrder(purpose.subcategoryOrder, purpose.subcategories.map(category => category.id)),
      repositoryOrder: normalizeOrder(purpose.repositoryOrder, repositories.map(repository => repository.id)),
      classificationSchemes: { purpose, technology, generation },
      classificationNavigation: { purpose: { selected: 'all', expanded: [] }, technology: { selected: 'all', expanded: [] } },
      selectedCategory: 'all',
      classificationContext: undefined,
    };
  }),
  applyClassificationTransactions: transactions => set(state => {
    let next = state;
    for (const transaction of transactions) next = { ...next, ...organizationTransaction(next, transaction) };
    return next;
  }),
  setClassificationScheme: activeClassificationScheme => set({ activeClassificationScheme, classificationContext: 'purpose' }),
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
