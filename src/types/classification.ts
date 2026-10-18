import type { OrganizationMembership, OrganizationStructureSnapshot } from './aiOrganization';

export type ClassificationSchemeId = 'purpose' | 'technology';
export interface ClassificationScheme extends OrganizationStructureSnapshot {
  initialized: boolean;
}
export type ClassificationSchemes = Partial<Record<ClassificationSchemeId, ClassificationScheme>>;
export interface ClassificationNavigation { selected: string; expanded: string[]; collapsedGroups?: string[] }
export type RepositoryClassifications = Partial<Record<ClassificationSchemeId, OrganizationMembership>>;
