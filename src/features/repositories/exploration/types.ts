export type RelationKind = 'direct' | 'interoperable' | 'similar' | 'discovery';
export interface ExplorationEvidence {
  id: string; kind: 'metadata' | 'analysis' | 'readme' | 'document'; label: string;
  text: string; url?: string; retrievedAt: string; verified: boolean;
}
export interface ExplorationTopic { id: string; label: string; evidenceIds?: string[] }
export interface ExplorationEntity { id: string; label: string; aliases: string[]; description: string }
export interface ExplorationRelation {
  id: string; repositoryId: number; targetType: 'topic' | 'entity' | 'repository'; targetId: string;
  kind: RelationKind; branch: string; reason: string; evidenceIds: string[]; verified: boolean;
}
export interface ExplorationProfile {
  repositoryId: number; fingerprint: string; summary: string; status: 'ready' | 'insufficient';
  topics: ExplorationTopic[]; entities: ExplorationEntity[]; relations: ExplorationRelation[]; evidence: ExplorationEvidence[];
}
export interface ExplorationIndex {
  version: 1; id: string; createdAt: string; model: string; generation?: string; profiles: Record<string, ExplorationProfile>;
}
export type ExplorationOverride = { id: string; createdAt: string } & (
  { type: 'remove-relation'; relationId: string } |
  { type: 'rename-topic'; topicId: string; label: string } |
  { type: 'set-topics'; repositoryId: number; topics: ExplorationTopic[] }
);
export interface ExplorationQueryCache {
  id: string; query: string; scope?: string; fingerprint: string; createdAt: string; model: string; generation?: string; profiles: Record<string, ExplorationProfile>;
}
export interface ExplorationTask {
  id: string; type: 'build' | 'query'; status: 'running' | 'paused' | 'interrupted' | 'failed';
  startedAt: string; model: string; generation?: string; query?: string; scope?: string; force?: boolean; fingerprint: string;
  completed: number; total: number; error?: string; draft: Record<string, ExplorationProfile>;
  phase?: 'profiles' | 'topics';
  savedId?: string;
  failures?: { repositoryIds: number[]; message: string; unknown: boolean }[];
  checked?: Record<string, string>;
  journalId?: string;
}
export interface ExplorationCamera { zoom: number; x: number; y: number }
export interface SavedExploration {
  id: string; name: string; query: string; createdAt: string; updatedAt: string; model: string;
  path: ExplorationFocus[]; kindFilter: RelationKind | 'all'; camera?: ExplorationCamera;
  scope?: ExplorationFocus;
  layoutPositions?: Record<string, { x: number; y: number }>;
  profiles: Record<string, ExplorationProfile>; repositories: import('../../../types').Repository[];
  checked: Record<string, string>; resultIds: number[];
  overrides: ExplorationOverride[];
}
export interface ExplorationAccount {
  version: 1; ownerId: string; revision: number; index: ExplorationIndex | null;
  overrides: ExplorationOverride[]; queries: ExplorationQueryCache[]; task: ExplorationTask | null;
  saved?: SavedExploration[];
  pendingTasks?: ExplorationTask[];
}
export type ExplorationFocus = { type: 'all' } | { type: 'topic'; id: string; label: string } |
  { type: 'entity'; id: string; label: string } | { type: 'repository'; id: number; label: string } |
  { type: 'branch'; targetId: string; label: string; kind: RelationKind; branch: string };
export interface ExplorationResult {
  repositoryId: number; kind: RelationKind; reason: string; relations: ExplorationRelation[];
  evidence: ExplorationEvidence[]; verified: boolean;
  localBranch?: string;
}
export interface ExplorationScene {
  topics: (ExplorationTopic & { repositoryIds: number[] })[]; entities: ExplorationEntity[];
  results: ExplorationResult[]; branches: { id: string; label: string; kind: RelationKind; count: number }[];
  profiles: Record<string, ExplorationProfile>; unresolvedOverrides: ExplorationOverride[];
}
