export const AGY_FEATURES = ['repository-summary', 'repository-details', 'organization', 'gist-summary', 'release-summary', 'query-expansion', 'repository-rerank', 'gist-rerank', 'repository-chat', 'workbench', 'discovery', 'plugin', 'other'] as const;
export type AgyFeature = typeof AGY_FEATURES[number];
export interface AgyProfile { model: string; effort: 'low' | 'medium' | 'high' | 'max'; timeoutSeconds: number; concurrency: number; }
export interface AgyDevicePrefs {
  concurrency?: number;
  featureOverrides?: Partial<Record<AgyFeature, Partial<AgyProfile>>>;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'max';
  mode: 'model' | 'research';
  timeoutSeconds: number;
  maxQueued: number;
  enabled: boolean;
}

export interface AgyDeviceState {
  requiresTest?: boolean;
  testedProfiles?: string[];
  revision?: number;
  featureProbes?: Partial<Record<AgyFeature, { code: string; at: string; model: string; effort: string; fingerprint?: string }>>;
  pool?: { running: number; queued: number; limit: number; effective: number; quarantined?: boolean; suspect?: number; degraded?: boolean; cooldownUntil: number; features: Record<string, { running: number; queued: number; limit: number }> };
  prefs: AgyDevicePrefs;
  supported: boolean;
  enabled: boolean;
  executable: { name: string; fingerprint: string; path?: string } | null;
  lastProbe: { code: string; toolCount: number | null; at: string; fingerprint: string; promptsSent: number; identity?: string } | null;
  busy: boolean;
  queued?: number;
}

export interface AgyModel { id: string; label: string }
export interface AgyLocalProject { id: string; name: string; identity?: string; entries: { path: string; type: string; bytes: number }[]; truncated: boolean }
export interface AgyLocalFile { path: string; content: string; contentHash: string; retrievedAt: string }
export interface AgyRecoveryRecord {
  requestId: string; taskId?: string; itemId?: string; step?: string; retryOf?: string; feature?: AgyFeature; inputDigest: string; profile: string;
  dispatch: 'prepared' | 'sent'; providerOutcome: 'not_started' | 'in_flight' | 'succeeded' | 'failed' | 'unknown';
  resultDigest?: string; receipt?: 'consumed' | 'discarded'; recoverable: boolean; createdAt: string; failureCode?: string;
}
export interface AgyRecoveryIssue {
  requestId: string;
  code: 'RECOVERY_RECORD_CORRUPT';
  certainty: 'definitely-unsent' | 'unknown';
  dispatch?: 'prepared' | 'sent';
  providerOutcome?: AgyRecoveryRecord['providerOutcome'];
  createdAt?: string;
}
export type AgyRecoveryRepairAction = 'discard-unsent' | 'abandon-unknown';
export interface AgyRecoveryRepairResult extends AgyRecoveryIssue { action: AgyRecoveryRepairAction; }
export interface AgyRecoveryOptions { context?: unknown; step?: string; requestId?: string; retryOf?: string; onResult?: (record: AgyRecoveryRecord) => void; }
export interface AgyGenerationRequest { system: string; user: string; model: string; effort: AgyDevicePrefs['effort']; feature?: AgyFeature; revision?: number; priority?: 'interactive' | 'background'; profileOverride?: Pick<AgyProfile, 'model' | 'effort' | 'timeoutSeconds'>; taskId?: string; itemId?: string; step?: string; retryOf?: string; recoveryContext?: unknown; }
export interface AgyGenerationResult { text: string; usage: Record<string, number>; cleanupStatus?: 'pending' | 'recovered'; recovery?: AgyRecoveryRecord; }
export interface AgyEvent { requestId: string; session: string; type: 'queued' | 'running' | 'sent' | 'text' | 'scheduler' | 'initializing' | 'cleanup' | 'warning'; text?: string; code?: string; position?: number; pool?: AgyDeviceState['pool']; }
export type AgyResult<T> = { ok: true; value: T } | { ok: false; code: string; details?: { operation?: string; systemCode?: string; originalCode?: string; exitObserved?: boolean; retryAfterMs?: number; sent?: boolean; providerOutcome?: string } };
export interface AgyDesktopAPI {
  chooseProject(requestId: string): Promise<AgyResult<AgyLocalProject>>;
  readProject(requestId: string, grantId: string, relative: string): Promise<AgyResult<AgyLocalFile>>;
  revokeProject(grantId: string): Promise<void>;
  getState(): Promise<AgyDeviceState>;
  detect(requestId: string): Promise<AgyResult<AgyDeviceState>>;
  recover(requestId: string): Promise<AgyResult<AgyDeviceState>>;
  choose(requestId: string): Promise<AgyResult<AgyDeviceState>>;
  save(requestId: string, prefs: AgyDevicePrefs): Promise<AgyResult<AgyDeviceState>>;
  listModels(requestId: string): Promise<AgyResult<AgyModel[]>>;
  probe(requestId: string, feature?: AgyFeature): Promise<AgyResult<AgyDeviceState>>;
  cancel(requestId: string): Promise<void>;
  setSession(session: string, account?: string): Promise<void>;
  recoveryList(session: string, cursor?: string, limit?: number): Promise<AgyResult<{ records: AgyRecoveryRecord[]; errors: AgyRecoveryIssue[]; nextCursor?: string }>>;
  recoveryRead(session: string, requestId: string): Promise<AgyResult<{ record: AgyRecoveryRecord; result?: AgyGenerationResult; context?: unknown; commit?: unknown }>>;
  recoveryAck(session: string, requestId: string, digest: string): Promise<AgyResult<void>>;
  recoveryStage(session: string, requestId: string, digest: string, commit: unknown): Promise<AgyResult<void>>;
  recoveryDiscard(session: string, requestId: string): Promise<AgyResult<void>>;
  recoveryRepair(session: string, requestId: string, action: AgyRecoveryRepairAction): Promise<AgyResult<AgyRecoveryRepairResult>>;
  start(requestId: string, session: string, request: AgyGenerationRequest): Promise<AgyResult<AgyGenerationResult>>;
  onEvent(listener: (event: AgyEvent) => void): () => void;
}
