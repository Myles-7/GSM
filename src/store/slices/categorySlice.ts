
import type { AppStoreSlice } from '../types';
import { defaultCategories } from '../schema';
import { getAllCategories, getCategoryNameVariants, sortCategoriesByOrder } from '../helpers/categoryHelpers';
import { categoryName } from '../../constants/categoryI18n';
import { normalizeOrder, organizationCategories, organizationSnapshot } from '../helpers/repositoryOrganization';

export const createCategorySlice: AppStoreSlice<Pick<import('../types').AppActions,
  | 'addCustomCategory'
  | 'addSubcategory'
  | 'updateSubcategory'
  | 'deleteSubcategory'
  | 'moveRepositoryToSubcategory'
  | 'reorderSubcategories'
  | 'reorderRepositories'
  | 'assignRepositoryCategory'
  | 'updateCustomCategory'
  | 'updateDefaultCategory'
  | 'resetDefaultCategory'
  | 'resetDefaultCategoryNameIcon'
  | 'resetDefaultCategoryKeywords'
  | 'deleteCustomCategory'
  | 'hideDefaultCategory'
  | 'showDefaultCategory'
  | 'setCategoryOrder'
  | 'reorderCategories'
  | 'setCollapsedSidebarCategoryCount'
  | 'setCategoryMatchMode'
  | 'addAssetFilter'
  | 'updateAssetFilter'
  | 'deleteAssetFilter'
>> = (set) => ({
      addSubcategory: (input) => set(state => organizationSnapshot(state, {
        subcategories: [...state.subcategories, { ...input, id: crypto.randomUUID() }],
      })),
      updateSubcategory: (id, updates) => set(state => {
        if (updates.name !== undefined && !updates.name.trim()) return state;
        return organizationSnapshot(state, {
          subcategories: state.subcategories.map(group => group.id === id ? { ...group, ...updates } : group),
        });
      }),
      deleteSubcategory: (id) => set(state => organizationSnapshot(state, {
        subcategories: state.subcategories.filter(group => group.id !== id),
      })),
      moveRepositoryToSubcategory: (repoId, subcategoryId) => set(state => {
        const repo = state.repositories.find(item => item.id === repoId);
        const group = state.subcategories.find(item => item.id === subcategoryId);
        if (!repo || (subcategoryId !== null && (!group || group.parentId !== repo.category_id))) return state;
        return organizationSnapshot(state, {
          repositories: state.repositories.map(item => item.id === repoId ? { ...item, subcategory_id: subcategoryId } : item),
        });
      }),
      reorderSubcategories: (ids) => set(state => ({
        subcategoryOrder: normalizeOrder([...ids, ...state.subcategoryOrder], state.subcategories.map(group => group.id)),
      })),
      reorderRepositories: (ids) => set(state => ({
        repositoryOrder: normalizeOrder([...ids, ...state.repositoryOrder], state.repositories.map(repo => repo.id)),
      })),
      assignRepositoryCategory: (repoId, categoryId) => set(state => {
        if (categoryId !== null && !organizationCategories(state).some(category => category.id === categoryId)) return state;
        const repo = state.repositories.find(item => item.id === repoId);
        if (!repo || (repo.category_locked && repo.category_id !== categoryId)) return state;
        return organizationSnapshot(state, {
          repositories: state.repositories.map(item => item.id === repoId ? {
            ...item, category_id: categoryId,
            subcategory_id: item.category_id === categoryId ? item.subcategory_id : null,
            custom_category: categoryId === null ? '' : item.custom_category,
            last_edited: new Date().toISOString(),
          } : item),
        });
      }),
      // Category actions
      addCustomCategory: (category) => set((state) => {
        if (organizationCategories(state).some(item => item.id === category.id) || category.id === 'all' || category.id === 'pending') return state;
        return organizationSnapshot(state, { customCategories: [...state.customCategories, { ...category, isCustom: true }] });
      }),
      updateCustomCategory: (id, updates) => set((state) => {
        const targetCategory = state.customCategories.find(category => category.id === id);
        const nextCategories = state.customCategories.map(category =>
          category.id === id ? { ...category, ...updates, id: category.id } : category
        );

        if (!targetCategory || !updates.name || updates.name === targetCategory.name) {
          return { customCategories: nextCategories };
        }

        const nextRepositories = state.repositories.map(repo =>
          repo.category_id === id || (repo.category_id === undefined && repo.custom_category === targetCategory.name)
            ? { ...repo, custom_category: updates.name, last_edited: new Date().toISOString() }
            : repo
        );

        return organizationSnapshot(state, {
          customCategories: nextCategories,
          repositories: nextRepositories,
        });
      }),
      updateDefaultCategory: (id, updates) => set((state) => {
        const defaultCat = defaultCategories.find(c => c.id === id);
        if (!defaultCat) return {};

        const originalName = defaultCat.name;
        const displayedName = categoryName(id, state.language);
        const originalIcon = defaultCat.icon;
        const originalKeywords = defaultCat.keywords || [];
        const currentOverride = state.defaultCategoryOverrides[id];
        const currentName = currentOverride?.name || originalName;
        const newName = updates.name;

        const filteredUpdates: { name?: string; icon?: string; keywords?: string[] } = {};

        if (updates.name !== undefined && updates.name !== '' && updates.name !== originalName && updates.name !== displayedName) {
          filteredUpdates.name = updates.name;
        }
        if (updates.icon !== undefined && updates.icon !== originalIcon) {
          filteredUpdates.icon = updates.icon;
        }
        if (updates.keywords !== undefined) {
          const sortedOriginal = [...originalKeywords].sort().join(',');
          const sortedNew = [...updates.keywords].sort().join(',');
          if (sortedNew !== sortedOriginal) {
            filteredUpdates.keywords = updates.keywords;
          }
        }

        const existingOverride = state.defaultCategoryOverrides[id] || {};
        const mergedOverride = { ...existingOverride, ...filteredUpdates };

        for (const key of ['name', 'icon', 'keywords'] as const) {
          if (key in mergedOverride) {
            if (key === 'keywords') {
              const sortedOriginal = [...originalKeywords].sort().join(',');
              const sortedMerged = [...(mergedOverride.keywords || [])].sort().join(',');
              if (sortedMerged === sortedOriginal) {
                delete mergedOverride.keywords;
              }
            } else if (key === 'name' && (mergedOverride.name === originalName || mergedOverride.name === displayedName || mergedOverride.name === '')) {
              delete mergedOverride.name;
            } else if (key === 'icon' && mergedOverride.icon === originalIcon) {
              delete mergedOverride.icon;
            }
          }
        }

        const nextOverrides = { ...state.defaultCategoryOverrides };
        if (Object.keys(mergedOverride).length === 0) {
          delete nextOverrides[id];
        } else {
          nextOverrides[id] = mergedOverride;
        }

        const currentDisplayedName = currentOverride?.name ?? displayedName;
        if (!newName || newName === currentName || newName === currentDisplayedName) {
          return { defaultCategoryOverrides: nextOverrides };
        }

        const currentNameVariants = getCategoryNameVariants(originalName, currentName);
        // Avoid self-rewrite when newName already matches the displayed default name.

        const nextRepositories = state.repositories.map(repo =>
          repo.category_id === id || (repo.category_id === undefined && currentNameVariants.includes(repo.custom_category || ''))
            ? { ...repo, custom_category: newName, last_edited: new Date().toISOString() }
            : repo
        );

        return organizationSnapshot(state, {
          defaultCategoryOverrides: nextOverrides,
          repositories: nextRepositories,
        });
      }),
      resetDefaultCategory: (id) => set((state) => {
        const defaultCat = defaultCategories.find(c => c.id === id);
        if (!defaultCat) return {};

        const override = state.defaultCategoryOverrides[id];
        if (!override) return {};

        const overriddenName = override.name;
        const originalName = defaultCat.name;

        const nextOverrides = { ...state.defaultCategoryOverrides };
        delete nextOverrides[id];

        if (!overriddenName || overriddenName === originalName) {
          return { defaultCategoryOverrides: nextOverrides };
        }

        const overriddenNameVariants = getCategoryNameVariants(originalName, overriddenName);

        const nextRepositories = state.repositories.map(repo =>
          repo.category_id === id || (repo.category_id === undefined && overriddenNameVariants.includes(repo.custom_category || ''))
            ? { ...repo, custom_category: originalName, last_edited: new Date().toISOString() }
            : repo
        );

        return organizationSnapshot(state, {
          defaultCategoryOverrides: nextOverrides,
          repositories: nextRepositories,
        });
      }),
      resetDefaultCategoryNameIcon: (id) => set((state) => {
        const defaultCat = defaultCategories.find(c => c.id === id);
        if (!defaultCat) return {};

        const override = state.defaultCategoryOverrides[id];
        if (!override) return {};

        const overriddenName = override.name;
        const originalName = defaultCat.name;

        const nextOverride = { ...override };
        delete nextOverride.name;
        delete nextOverride.icon;

        const nextOverrides = { ...state.defaultCategoryOverrides };
        if (Object.keys(nextOverride).length === 0) {
          delete nextOverrides[id];
        } else {
          nextOverrides[id] = nextOverride;
        }

        if (!overriddenName || overriddenName === originalName) {
          return { defaultCategoryOverrides: nextOverrides };
        }

        const overriddenNameVariants = getCategoryNameVariants(originalName, overriddenName);

        const nextRepositories = state.repositories.map(repo =>
          repo.category_id === id || (repo.category_id === undefined && overriddenNameVariants.includes(repo.custom_category || ''))
            ? { ...repo, custom_category: originalName, last_edited: new Date().toISOString() }
            : repo
        );

        return organizationSnapshot(state, {
          defaultCategoryOverrides: nextOverrides,
          repositories: nextRepositories,
        });
      }),
      resetDefaultCategoryKeywords: (id) => set((state) => {
        const override = state.defaultCategoryOverrides[id];
        if (!override) return {};

        const nextOverride = { ...override };
        delete nextOverride.keywords;

        const nextOverrides = { ...state.defaultCategoryOverrides };
        if (Object.keys(nextOverride).length === 0) {
          delete nextOverrides[id];
        } else {
          nextOverrides[id] = nextOverride;
        }

        return { defaultCategoryOverrides: nextOverrides };
      }),
      deleteCustomCategory: (id) => set((state) => {
        const targetCategory = state.customCategories.find(category => category.id === id);
        const nextSelectedCategory = state.selectedCategory === id ? 'all' : state.selectedCategory;

        if (!targetCategory) {
          return {
            customCategories: state.customCategories.filter(category => category.id !== id),
            selectedCategory: nextSelectedCategory
          };
        }

        const clearedRepositories = state.repositories.map(repo =>
          repo.category_id === id || (repo.category_id === undefined && repo.custom_category === targetCategory.name)
            ? { ...repo, category_id: null, subcategory_id: null, last_edited: new Date().toISOString() }
            : repo
        );

        return organizationSnapshot(state, {
          customCategories: state.customCategories.filter(category => category.id !== id),
          repositories: clearedRepositories,
          selectedCategory: nextSelectedCategory
        });
      }),
      hideDefaultCategory: (id) => set((state) => ({
        hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds.includes(id)
          ? state.hiddenDefaultCategoryIds
          : [...state.hiddenDefaultCategoryIds, id],
        selectedCategory: state.selectedCategory === id ? 'all' : state.selectedCategory
      })),
      showDefaultCategory: (id) => set((state) => ({
        hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds.filter(categoryId => categoryId !== id)
      })),
      setCategoryOrder: (order) => set({ categoryOrder: order }),
      reorderCategories: (oldIndex, newIndex) => set((state) => {
        const allCategories = getAllCategories(state.customCategories, state.language, state.hiddenDefaultCategoryIds, state.defaultCategoryOverrides);
        const orderedCategories = sortCategoriesByOrder(allCategories, state.categoryOrder);
        const newOrder = orderedCategories.map(c => c.id);
        const [movedId] = newOrder.splice(oldIndex, 1);
        newOrder.splice(newIndex, 0, movedId);
        return { categoryOrder: newOrder };
      }),
      setCollapsedSidebarCategoryCount: (count) => set({ collapsedSidebarCategoryCount: count }),
      setCategoryMatchMode: (mode) => set({ categoryMatchMode: mode }),

      // Asset Filter actions
      addAssetFilter: (filter) => set((state) => ({
        assetFilters: [...state.assetFilters, filter]
      })),
      updateAssetFilter: (id, updates) => set((state) => ({
        assetFilters: state.assetFilters.map(filter =>
          filter.id === id ? { ...filter, ...updates } : filter
        )
      })),
      deleteAssetFilter: (id) => set((state) => ({
        assetFilters: state.assetFilters.filter(filter => filter.id !== id)
      })),

});
