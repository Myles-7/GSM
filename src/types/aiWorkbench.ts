import type { Repository } from './index';
import type { OrganizationDraft } from './aiOrganization';

export type WorkbenchScope = 'github' | 'selected' | 'project' | 'library' | 'local' | 'mixed';
export type WorkbenchDepth = 'quick' | 'standard' | 'deep';
export type WorkbenchInputIntent = 'search' | 'results' | 'research';
export interface WorkbenchOverview {
  summary: string;
  category: string;
  categoryDescription: string;
  kind: 'tool' | 'library' | 'resource' | 'other';
  status: 'ready' | 'insufficient' | 'failed';
  basis: 'metadata' | 'readme' | 'existing';
  error?: string;
}
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
  overview?: WorkbenchOverview;
}
export interface WorkbenchSearchBatch {
  id: string;
  createdAt: string;
  requirements: WorkbenchRequirements;
  candidates: WorkbenchCandidate[];
  queries: string[];
  nextPage: number;
  overviewSummary?: string;
}
export interface WorkbenchProject {
  id: string;
  ownerId: string;
  name: string;
  instructions: string;
  conclusions: string;
  repositories: Repository[];
  /** Canonical project selections, including names awaiting metadata while offline. */
  selectedRepositoryNames?: string[];
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
  organization?: OrganizationDraft;
}
export interface WorkbenchSessionData {
  localProject?: { name: string; identity?: string };
  scope: WorkbenchScope;
  depth: WorkbenchDepth;
  selectedRepositories: Repository[];
  requirements?: WorkbenchRequirements;
  searchBatches: WorkbenchSearchBatch[];
  inputIntent?: WorkbenchInputIntent;
}
export interface WorkbenchTaskState {
  sessionId: string | null;
  ownerId: string | null;
  stage: string;
  running: boolean;
  startedAt?: number;
  readFiles?: number;
  currentSource?: string;
  error?: string;
}
