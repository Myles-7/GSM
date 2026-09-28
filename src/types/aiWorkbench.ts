import type { Repository } from './index';

export type WorkbenchScope = 'github' | 'selected' | 'project' | 'library';
export type WorkbenchDepth = 'quick' | 'standard' | 'deep';
export interface WorkbenchRequirements {
  purpose: string;
  required: string[];
  preferred: string[];
  excluded: string[];
  questions: string[];
  queries: string[];
}
export interface WorkbenchCandidate {
  repository: Repository;
  summary: string;
  reasons: string[];
  limitations: string[];
  sources: string[];
  status: 'candidate' | 'verifying' | 'verified' | 'insufficient';
}
export interface WorkbenchSearchBatch {
  id: string;
  createdAt: string;
  requirements: WorkbenchRequirements;
  candidates: WorkbenchCandidate[];
  queries: string[];
  nextPage: number;
}
export interface WorkbenchProject {
  id: string;
  ownerId: string;
  name: string;
  instructions: string;
  conclusions: string;
  repositories: Repository[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}
export type WorkbenchEditableFields = Pick<Repository, 'custom_category' | 'category_id' | 'subcategory_id' | 'category_locked' | 'custom_tags' | 'custom_description'>;
export interface WorkbenchOperation {
  id: string;
  repository: Repository;
  kind: 'update' | 'unstar';
  reason: string;
  before: WorkbenchEditableFields;
  after: WorkbenchEditableFields;
  selected: boolean;
  overrideLocked: boolean;
  status: 'proposed' | 'running' | 'success' | 'failed' | 'unknown' | 'conflict' | 'restored';
  error?: string;
}
export interface WorkbenchProposal {
  id: string;
  ownerId: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  operations: WorkbenchOperation[];
  syncError?: string;
}
export interface WorkbenchSessionData {
  scope: WorkbenchScope;
  depth: WorkbenchDepth;
  selectedRepositories: Repository[];
  requirements?: WorkbenchRequirements;
  searchBatches: WorkbenchSearchBatch[];
}
export interface WorkbenchTaskState {
  sessionId: string | null;
  ownerId: string | null;
  stage: string;
  running: boolean;
  error?: string;
}
