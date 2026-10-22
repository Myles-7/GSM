import type { OrganizationMembership, OrganizationStructureSnapshot } from './aiOrganization';

export type ClassificationSchemeId = 'purpose' | 'technology';
export interface ClassificationScheme extends OrganizationStructureSnapshot {
  initialized: boolean;
}
export type ClassificationGenerationStatus = 'idle' | 'stale' | 'running' | 'ready' | 'failed';
export interface ClassificationGenerationState {
  status: ClassificationGenerationStatus;
  generation: number;
  queuedRepositoryIds: number[];
  repositoryIds?: number[];
  lastGeneratedAt?: string;
  sourceFingerprint?: string;
  error?: string;
  syncPending?: boolean;
  algorithmVersion?: string;
  lastChange?: Partial<Record<ClassificationSchemeId, ClassificationChangeStats>>;
}
export interface ClassificationChangeStats {
  beforeGroups: number;
  afterGroups: number;
  beforeOversized: number;
  afterOversized: number;
  changedMemberships: number;
}
export type ClassificationConfidence = 'high' | 'medium' | 'low';
export interface ClassificationFacet {
  id: string;
  label: string;
  score: number;
  evidence: string[];
  group?: 'technology' | 'platform' | 'scenario';
}
export interface ClassificationInsight {
  confidence: ClassificationConfidence;
  evidence: string[];
  facets: ClassificationFacet[];
  categoryId?: string;
  subcategoryId?: string;
  refinementReason?: string;
}
export interface ClassificationSchemes extends Partial<Record<ClassificationSchemeId, ClassificationScheme>> {
  generation?: ClassificationGenerationState;
}
export interface ClassificationNavigation { selected: string; expanded: string[]; collapsedGroups?: string[] }
export type RepositoryClassifications = Partial<Record<ClassificationSchemeId, OrganizationMembership>>;
