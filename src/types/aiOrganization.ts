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
  verification?: 'pending' | 'verified' | 'failed';
  verificationHash?: string;
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
export type OrganizationAnalysisDepth = 'quick' | 'deep';
export interface OrganizationRunProgress {
  summaryLevel?: number;
  summaryCompleted?: number;
  summaryTotal?: number;
  summaryFallback?: number;
  startedAt: number;
  concurrency: number;
  effectiveConcurrency: number;
  running: number;
  queued: number;
  reading: number;
  requests: number;
  completedRequests: number;
  reused: number;
  readMs: number;
  queueMs: number;
  modelMs: number;
  parseMs: number;
  saveMs: number;
  successfulBatches: number;
  batchMs: number;
}
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
  agyReceipts?: { requestId: string; digest: string }[];
  externalAgent?: {
    source: 'local-agent';
    startRequestId: string;
    startHash: string;
    baseProposalId?: string;
    progress?: string;
    receipts: { requestId: string; hash: string; aliases: Record<string, string> }[];
  };
  version: 1 | 2 | 3;
  analysisDepth?: OrganizationAnalysisDepth;
  concurrency?: number;
  dual?: DualOrganizationDraft;
  /** Explicit single-scheme advanced structure record; absent in legacy v1/v2. */
  singleSchemeId?: import('./classification').ClassificationSchemeId;
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
export interface OrganizationUnderstanding {
  deferred?: boolean;
  repositoryId: number;
  fingerprint: string;
  sourceMetadata: { name: string; description: string; summary: string; tags: string[]; language: string; details: string };
  status: 'pending' | 'understood' | 'insufficient' | 'read-failed' | 'failed';
  purpose: string[];
  technology: string[];
  sources: { kind: 'metadata' | 'readme' | 'analysis' | 'document'; url: string; retrievedAt: string }[];
  error?: string;
  depth?: OrganizationAnalysisDepth;
  understoodAt?: string;
  analysisGeneratedAt?: string;
  staleAnalysis?: boolean;
  reused?: boolean;
  activity?: 'reading' | 'queued' | 'understanding';
}
export interface OrganizationSchemeDraft {
  structureOperations?: IntegratedCategoryOperation[];
  selected: boolean;
  categories: OrganizationCategory[];
  entries: OrganizationEntry[];
  before: OrganizationStructureSnapshot;
  createdCategoryIds: string[];
  ready: boolean;
  after?: OrganizationStructureSnapshot;
  proposedCategoryIds?: string[];
  retireCategoryIds?: string[];
  cleanupReplaced?: boolean;
  scopeIsFullLibrary?: boolean;
  members?: { repositoryId: number; before: OrganizationMembership }[];
  application?: { status: 'prepared' | 'applied' | 'restoring' | 'restored'; repositoryIds: number[]; operationIds?: string[]; before: OrganizationStructureSnapshot; after: OrganizationStructureSnapshot; createdCategoryIds: string[]; membersAfter: { repositoryId: number; before: OrganizationMembership }[] };
}
export interface IntegratedCategoryOperation {
  redesigned?: boolean;
  id: string;
  kind: 'create' | 'rename' | 'merge';
  targetId: string;
  sourceIds: string[];
  parentId: string | null;
  name: string;
  icon: string;
  selected: boolean;
  status: 'pending' | 'success' | 'conflict' | 'restored';
  error?: string;
  categoriesBefore: OrganizationCategory[];
  entriesBefore: OrganizationEntry[];
  members: { repositoryId: number; before: OrganizationMembership }[];
}
export interface DualOrganizationDraft {
  execution?: { version: 2; runId: string; configIdentity: string; scopeHash: string; promptVersion: string };
  verificationIds?: number[];
  progress?: OrganizationRunProgress;
  phase: 'understanding' | 'structure' | 'assignments' | 'review';
  outcome?: 'complete' | 'partial' | 'empty' | 'unchanged';
  understanding: OrganizationUnderstanding[];
  summaries: { repositoryIds: number[]; purpose: string; technology: string; inputHash?: string; level?: number; index?: number }[];
  schemes: Record<import('./classification').ClassificationSchemeId, OrganizationSchemeDraft>;
  requests: Record<string, number>;
  errors: { stage: string; repositoryIds: number[]; message: string }[];
  blocked?: { code: string; message: string; phase: DualOrganizationDraft['phase'] };
}
export interface OrganizationTransaction {
  schemeId?: import('./classification').ClassificationSchemeId;
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
