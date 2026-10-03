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
  revision?: number;
  featureProbes?: Partial<Record<AgyFeature, { code: string; at: string; model: string; effort: string; fingerprint?: string }>>;
  pool?: { running: number; queued: number; limit: number; effective: number; cooldownUntil: number; features: Record<string, { running: number; queued: number; limit: number }> };
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
export interface AgyGenerationRequest { system: string; user: string; model: string; effort: AgyDevicePrefs['effort']; feature?: AgyFeature; revision?: number; priority?: 'interactive' | 'background'; profileOverride?: Pick<AgyProfile, 'model' | 'effort' | 'timeoutSeconds'>; }
export interface AgyGenerationResult { text: string; usage: Record<string, number>; }
export interface AgyEvent { requestId: string; session: string; type: 'queued' | 'running' | 'text' | 'scheduler'; text?: string; position?: number; pool?: AgyDeviceState['pool']; }
export type AgyResult<T> = { ok: true; value: T } | { ok: false; code: string };
export interface AgyDesktopAPI {
  chooseProject(requestId: string): Promise<AgyResult<AgyLocalProject>>;
  readProject(requestId: string, grantId: string, relative: string): Promise<AgyResult<AgyLocalFile>>;
  revokeProject(grantId: string): Promise<void>;
  getState(): Promise<AgyDeviceState>;
  detect(requestId: string): Promise<AgyResult<AgyDeviceState>>;
  choose(requestId: string): Promise<AgyResult<AgyDeviceState>>;
  save(requestId: string, prefs: AgyDevicePrefs): Promise<AgyResult<AgyDeviceState>>;
  listModels(requestId: string): Promise<AgyResult<AgyModel[]>>;
  probe(requestId: string, feature?: AgyFeature): Promise<AgyResult<AgyDeviceState>>;
  cancel(requestId: string): Promise<void>;
  setSession(session: string): Promise<void>;
  start(requestId: string, session: string, request: AgyGenerationRequest): Promise<AgyResult<AgyGenerationResult>>;
  onEvent(listener: (event: AgyEvent) => void): () => void;
}
