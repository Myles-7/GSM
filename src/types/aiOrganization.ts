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
  status: 'pending' | 'success' | 'conflict' | 'restored';
  error?: string;
}
export interface OrganizationBatch {
  repositoryIds: number[];
  status: 'pending' | 'complete' | 'failed';
  error?: string;
}
export interface OrganizationDraft {
  version: 1;
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
}
