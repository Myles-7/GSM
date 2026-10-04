export interface OrganizationCategory {
  id: string;
  name: string;
  icon: string;
  parentId: string | null;
  isNew: boolean;
}
export interface OrganizationMembership {
  categoryId: string | null;
  subcategoryId: string | null;
  locked: boolean;
}
export interface OrganizationEntry {
  repositoryId: number;
  before: OrganizationMembership;
  categoryId: string | null;
  subcategoryId: string | null;
  reason: string;
  disposition: 'move' | 'unchanged' | 'insufficient';
  selected: boolean;
  overrideLocked: boolean;
  manual: boolean;
  preserveMain?: boolean;
  status: 'pending' | 'success' | 'conflict' | 'restored';
  error?: string;
}
export interface OrganizationBatch {
  repositoryIds: number[];
  status: 'pending' | 'complete' | 'failed';
  error?: string;
}
export type OrganizationMode = 'supplement' | 'reorganize';
export interface OrganizationStructureSnapshot {
  customCategories: import('./index').Category[];
  defaultCategoryOverrides: Record<string, Partial<import('./index').Category>>;
  hiddenDefaultCategoryIds: string[];
  categoryOrder: string[];
  subcategories: import('./repositoryOrganization').RepositorySubcategory[];
  subcategoryOrder: string[];
  repositoryOrder: number[];
  categoryListIdMap: Record<string, string>;
}
export interface OrganizationStructureOperation {
  id: string;
  kind: 'create' | 'rename' | 'merge';
  sourceIds: string[];
  targetId: string;
  name: string;
  icon: string;
  keywords: string[];
  reason: string;
  selected: boolean;
  status: 'pending' | 'success' | 'conflict' | 'restored';
  manual?: boolean;
  error?: string;
  members: { repositoryId: number; before: OrganizationMembership }[];
  before: OrganizationStructureSnapshot;
  after?: OrganizationStructureSnapshot;
}
export interface OrganizationDraft {
  version: 1 | 2;
  purpose?: 'repositories' | 'structure';
  mode?: OrganizationMode;
  rangeSource?: string;
  structureOperations?: OrganizationStructureOperation[];
  revision: number;
  scope: { name: string; repositoryIds: number[] };
  instruction: string;
  configId: string;
  maxNewSubcategories: number;
  structureReady: boolean;
  categories: OrganizationCategory[];
  entries: OrganizationEntry[];
  batches: OrganizationBatch[];
  status: 'generating' | 'ready' | 'interrupted' | 'applying' | 'applied' | 'restoring' | 'restored' | 'imported';
  createdCategoryIds: string[];
}
export interface OrganizationTransaction {
  ownerId: string;
  categories: OrganizationCategory[];
  assignments: { repositoryId: number; before: OrganizationMembership; after: OrganizationMembership; overrideLocked: boolean }[];
  removeCategories?: OrganizationCategory[];
  structureChange?: {
    expected: OrganizationStructureSnapshot;
    next: OrganizationStructureSnapshot;
    members: { repositoryId: number; before: OrganizationMembership }[];
    affectedCategoryIds: string[];
  };
}
