export type Collection = 'repositories' | 'organization' | 'releases' | 'release_reads' | 'subscriptions' | 'sessions' | 'messages' | 'evidence' | 'projects' | 'proposals' | 'discovery_config' | 'discovery_subscriptions' | 'discovery_reads' | 'discovery_history' | 'discovery_editions';
export interface HomeRecord {
  collection: Collection;
  id: string;
  data: Record<string, unknown> | null;
  version: number;
  deleted?: boolean;
  seq?: number;
}
export interface HomeOperation {
  opId: string;
  collection: Collection;
  id: string;
  baseVersion: number;
  kind: 'put' | 'delete';
  data?: Record<string, unknown>;
  source: 'user' | 'ai';
}
export interface PendingOperation extends HomeOperation { key: string; conflict?: HomeRecord | null; rejected?: string }
export interface HomeModel { id: string; name: string; model: string; apiType?: string; available?: boolean; credentialSource?: 'backend' }
export interface Capabilities {
  protocolVersion: number;
  workspace: { id: string; githubUserId: number; initializedAt?: string } | null;
  github: { configured: boolean; verified?: boolean; id?: number; login?: string };
  aiConfigs?: HomeModel[];
  ai?: { configured: boolean; configs?: HomeModel[] };
  discovery?: { available: boolean; channels: string[]; x: { configured: boolean; credentialSource: string }; credentials: string; features?: {stablePopular?:boolean;publicReleases?:boolean} };
  tasks?: { kinds?: string[]; refreshStars?: {available:boolean;lastCheckedAt?:string} };
}
export interface HomeTask {
  id: string; requestId: string; kind: string; status: string; stage?: string;
  input: Record<string, unknown>; result?: Record<string, unknown> | null;
  error?: string | null; createdAt: string; updatedAt: string; lastSeq?: number;
}
export type SyncStatus = 'offline' | 'syncing' | 'synced' | 'pending' | 'conflict' | 'auth-required' | 'error';
export interface SyncView { status: SyncStatus; pending: number; conflicts: number; lastSync?: string; error?: string }
