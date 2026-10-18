export const classificationActionNames = [
  'addCustomCategory', 'updateCustomCategory', 'deleteCustomCategory', 'updateDefaultCategory',
  'hideDefaultCategory', 'showDefaultCategory', 'resetDefaultCategory', 'resetDefaultCategoryNameIcon', 'resetDefaultCategoryKeywords',
  'addSubcategory', 'updateSubcategory', 'deleteSubcategory', 'moveRepositoryToSubcategory',
  'assignRepositoryCategory', 'reorderRepositories', 'reorderSubcategories', 'setCategoryOrder', 'reorderCategories',
] as const;
export type ClassificationActionName = typeof classificationActionNames[number];
export type ClassificationCommand = { [K in ClassificationActionName]: { action: K; args: Parameters<import('./types').AppActions[K]> } }[ClassificationActionName];
