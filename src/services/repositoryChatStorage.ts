import { organizationDraftSchema } from './aiOrganizationSchema';
import type {
  RepositoryChatMessage,
  RepositoryChatSession,
  RepositoryChatToolEvent,
  ToolEvidence,
} from '../types/repositoryChat';
import type {
  WorkbenchProject,
  WorkbenchProposal,
  WorkbenchSessionData,
} from '../types/aiWorkbench';
import type { Repository } from '../types';

const DB_NAME = 'gsm-repository-chat-db';
const DB_VERSION = 2;
const FALLBACK_KEY = 'gsm-repository-chat-fallback-v1';
const FALLBACK_MODE_KEY = 'gsm-repository-chat-use-fallback-v1';
const PRE_WORKBENCH_BACKUP_KEY = 'gsm-repository-chat-pre-workbench-v1';
const STORE_NAMES = ['sessions', 'messages', 'toolEvents', 'evidence', 'projects', 'proposals'] as const;
type StoreName = typeof STORE_NAMES[number];
const HISTORY_CHANGE_EVENT = 'gsm:global-chat-history-changed';
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type FallbackSnapshot = {
  sessions: RepositoryChatSession[];
  messages: RepositoryChatMessage[];
  toolEvents: RepositoryChatToolEvent[];
  evidence: ToolEvidence[];
  projects: WorkbenchProject[];
  proposals: WorkbenchProposal[];
};

const emptySnapshot = (): FallbackSnapshot => ({
  sessions: [],
  messages: [],
  toolEvents: [],
  evidence: [],
  projects: [],
  proposals: [],
});

const notifyGlobalHistoryChanged = (source?: 'home-projection'): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(HISTORY_CHANGE_EVENT, { detail: source ? { source } : undefined }));
};

const canUseIndexedDb = () => typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
const persistedFallbackMode = () => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(FALLBACK_MODE_KEY) === '1';
  } catch {
    return false;
  }
};
let useFallbackStorage = !canUseIndexedDb() || persistedFallbackMode();
const enableFallbackStorage = (): boolean => {
  if (typeof window === 'undefined') {
    useFallbackStorage = true;
    return true;
  }
  try {
    window.localStorage.setItem(FALLBACK_MODE_KEY, '1');
    useFallbackStorage = true;
    return true;
  } catch {
    return false;
  }
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs = 2000): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error('Repository chat IndexedDB timeout')), timeoutMs)),
  ]);
};

const readFallback = (): FallbackSnapshot => {
  if (typeof window === 'undefined') return emptySnapshot();
  try {
    const raw = window.localStorage.getItem(FALLBACK_KEY);
    if (!raw) return emptySnapshot();
    const value = JSON.parse(raw) as Partial<FallbackSnapshot>;
    return {
      sessions: Array.isArray(value.sessions)
        ? value.sessions.map((session) => ({ ...session, ownerId: session.ownerId }))
        : [],
      messages: Array.isArray(value.messages) ? value.messages : [],
      toolEvents: Array.isArray(value.toolEvents) ? value.toolEvents : [],
      evidence: Array.isArray(value.evidence) ? value.evidence : [],
      projects: Array.isArray(value.projects) ? value.projects : [],
      proposals: Array.isArray(value.proposals) ? value.proposals : [],
    };
  } catch {
    return emptySnapshot();
  }
};

const writeFallback = (snapshot: FallbackSnapshot): void => {
  if (typeof window === 'undefined') {
    throw new Error('[repository-chat] localStorage is unavailable for fallback persistence');
  }
  try {
    const previous = window.localStorage.getItem(FALLBACK_KEY);
    if (previous && !window.localStorage.getItem(PRE_WORKBENCH_BACKUP_KEY)) {
      // Preserve the first pre-workbench snapshot before any fallback mutation.
      const parsed = JSON.parse(previous) as Partial<FallbackSnapshot>;
      if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.proposals)) {
        window.localStorage.setItem(PRE_WORKBENCH_BACKUP_KEY, previous);
      }
    }
    window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(snapshot));
    notifyGlobalHistoryChanged();
  } catch {
    throw new Error('[repository-chat] unable to persist fallback snapshot');
  }
};

const openDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = window.indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = (event) => {
    const db = request.result;
    if (event.oldVersion === 1 && request.transaction) {
      const backup = db.createObjectStore('preWorkbenchBackup', { keyPath: 'id' });
      const transaction = request.transaction;
      for (const name of ['sessions', 'messages', 'toolEvents', 'evidence']) {
        if (!db.objectStoreNames.contains(name)) continue;
        const read = transaction.objectStore(name).getAll();
        read.onsuccess = () => backup.put({ id: name, records: read.result });
      }
    }
    if (!db.objectStoreNames.contains('sessions')) {
      const store = db.createObjectStore('sessions', { keyPath: 'id' });
      store.createIndex('repoId', 'repoId', { unique: false });
      store.createIndex('updatedAt', 'updatedAt', { unique: false });
    }
    if (!db.objectStoreNames.contains('messages')) {
      const store = db.createObjectStore('messages', { keyPath: 'id' });
      store.createIndex('sessionId', 'sessionId', { unique: false });
    }
    if (!db.objectStoreNames.contains('toolEvents')) {
      const store = db.createObjectStore('toolEvents', { keyPath: 'id' });
      store.createIndex('sessionId', 'sessionId', { unique: false });
      store.createIndex('messageId', 'messageId', { unique: false });
    }
    if (!db.objectStoreNames.contains('evidence')) {
      const store = db.createObjectStore('evidence', { keyPath: 'id' });
      store.createIndex('repoFullName', 'repoFullName', { unique: false });
    }
    if (!db.objectStoreNames.contains('projects')) {
      const store = db.createObjectStore('projects', { keyPath: 'id' });
      store.createIndex('ownerId', 'ownerId', { unique: false });
      store.createIndex('updatedAt', 'updatedAt', { unique: false });
    }
    if (!db.objectStoreNames.contains('proposals')) {
      const store = db.createObjectStore('proposals', { keyPath: 'id' });
      store.createIndex('ownerId', 'ownerId', { unique: false });
      store.createIndex('sessionId', 'sessionId', { unique: false });
      store.createIndex('updatedAt', 'updatedAt', { unique: false });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Unable to open repository chat IndexedDB'));
});

const requestValue = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
});

const runTransaction = async <T>(storeNames: StoreName | StoreName[], mode: IDBTransactionMode, operation: (stores: Record<StoreName, IDBObjectStore>) => Promise<T>): Promise<T> => {
  const db = await openDb();
  try {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const transaction = db.transaction(names, mode);
    const stores = Object.fromEntries(STORE_NAMES.map((name) => [name, transaction.objectStoreNames.contains(name) ? transaction.objectStore(name) : undefined])) as Record<StoreName, IDBObjectStore>;
    const value = await operation(stores);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Repository chat transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Repository chat transaction aborted'));
    });
    return value;
  } finally {
    db.close();
  }
};

const mergeById = <T extends { id: string }>(fallbackValues: T[], indexedDbValues: T[]): T[] => {
  return [...new Map([...fallbackValues, ...indexedDbValues].map((value) => [value.id, value])).values()];
};

const migrateIndexedDbSnapshotToFallback = async (): Promise<boolean> => {
  if (!canUseIndexedDb()) return false;
  try {
    const indexedDbSnapshot = await withTimeout(runTransaction([...STORE_NAMES], 'readonly', async (stores) => ({
      sessions: await requestValue(stores.sessions.getAll()) as RepositoryChatSession[],
      messages: await requestValue(stores.messages.getAll()) as RepositoryChatMessage[],
      toolEvents: await requestValue(stores.toolEvents.getAll()) as RepositoryChatToolEvent[],
      evidence: await requestValue(stores.evidence.getAll()) as ToolEvidence[],
      projects: await requestValue(stores.projects.getAll()) as WorkbenchProject[],
      proposals: await requestValue(stores.proposals.getAll()) as WorkbenchProposal[],
    })));
    const fallbackSnapshot = readFallback();
    writeFallback({
      sessions: mergeById(fallbackSnapshot.sessions, indexedDbSnapshot.sessions),
      messages: mergeById(fallbackSnapshot.messages, indexedDbSnapshot.messages),
      toolEvents: mergeById(fallbackSnapshot.toolEvents, indexedDbSnapshot.toolEvents),
      evidence: mergeById(fallbackSnapshot.evidence, indexedDbSnapshot.evidence),
      projects: mergeById(fallbackSnapshot.projects, indexedDbSnapshot.projects),
      proposals: mergeById(fallbackSnapshot.proposals, indexedDbSnapshot.proposals),
    });
    return true;
  } catch (error) {
    console.warn('[repository-chat] unable to migrate IndexedDB snapshot before fallback', error);
    return false;
  }
};

const transitionToFallbackStorage = async (): Promise<boolean> => {
  if (useFallbackStorage) return true;
  if (!canUseIndexedDb()) return enableFallbackStorage();
  if (!await migrateIndexedDbSnapshotToFallback()) return false;
  return enableFallbackStorage();
};

const fallbackList = <T extends { sessionId?: string; repoId?: number }>(store: keyof FallbackSnapshot, filter: (value: T) => boolean): T[] => {
  return (readFallback()[store] as unknown as T[]).filter(filter);
};

const byCreatedAt = <T extends { id: string; createdAt: string; role?: 'user' | 'assistant' | 'system' }>(left: T, right: T) => {
  const timestampOrder = left.createdAt.localeCompare(right.createdAt);
  if (timestampOrder !== 0) return timestampOrder;
  // Legacy turns may share a timestamp because their user and assistant records
  // were written concurrently. Preserve the conversational order on reload.
  const roleOrder = (role: T['role']) => role === 'user' ? 0 : role === 'assistant' ? 1 : 2;
  const byRole = roleOrder(left.role) - roleOrder(right.role);
  return byRole !== 0 ? byRole : left.id.localeCompare(right.id);
};
const byUpdatedAtDescending = <T extends { updatedAt: string }>(left: T, right: T) => right.updatedAt.localeCompare(left.updatedAt);
const normalizeRetentionDays = (value: number): number => {
  if (!Number.isFinite(value)) return 90;
  return Math.min(365, Math.max(1, Math.floor(value)));
};

const assertOwnerCompatible = (
  existingOwnerId: string | undefined,
  nextOwnerId: string | undefined,
  label: string,
): void => {
  if (existingOwnerId && existingOwnerId !== nextOwnerId) {
    throw new Error(`[repository-chat] cannot overwrite ${label} owned by another account`);
  }
};

type WorkbenchBackup = {
  schemaVersion: 1;
  ownerId: string;
  exportedAt: string;
  sessions: RepositoryChatSession[];
  messages: RepositoryChatMessage[];
  toolEvents: RepositoryChatToolEvent[];
  evidence: ToolEvidence[];
  projects: WorkbenchProject[];
  proposals: WorkbenchProposal[];
};

const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
const MAX_SESSIONS = 2_000;
const MAX_MESSAGES = 40_000;
const MAX_TOOL_EVENTS = 80_000;
const MAX_EVIDENCE = 40_000;
const MAX_PROJECTS = 1_000;
const MAX_PROPOSALS = 5_000;
const MAX_OPERATIONS_PER_PROPOSAL = 2_000;
const MAX_REPOSITORIES_PER_COLLECTION = 5_000;
const MAX_SEARCH_BATCHES = 200;
const MAX_CANDIDATES_PER_BATCH = 1_000;
const MAX_SHORT_STRING = 2_048;
const MAX_TEXT = 200_000;
const SECRET_KEY_PATTERN = /(?:token|secret|password|authorization|cookie|api[_-]?key)/i;

const BACKUP_KEYS = ['schemaVersion', 'ownerId', 'exportedAt', 'sessions', 'messages', 'toolEvents', 'evidence', 'projects', 'proposals'] as const;
const SESSION_KEYS = ['id', 'repoId', 'repoFullName', 'sourceRefSha', 'title', 'summary', 'modelConfigId', 'modelLabelAtTime', 'ownerId', 'kind', 'projectId', 'pinned', 'archived', 'deviceOnly', 'workbench', 'createdAt', 'updatedAt', 'deletedAt'] as const;
const MESSAGE_KEYS = ['id', 'sessionId', 'role', 'content', 'status', 'evidenceIds', 'missing', 'createdAt', 'answerPhase', 'quality', 'claims', 'coverage', 'researchSources', 'comparison'] as const;
const TOOL_EVENT_KEYS = ['id', 'sessionId', 'messageId', 'toolName', 'status', 'paramSummary', 'stage', 'round', 'detail', 'durationMs', 'resultSize', 'evidenceId', 'createdAt'] as const;
const EVIDENCE_KEYS = ['id', 'source', 'repoFullName', 'refSha', 'path', 'lineStart', 'lineEnd', 'url', 'contentHash', 'excerpt', 'retrievedAt'] as const;
const PROJECT_KEYS = ['id', 'ownerId', 'name', 'instructions', 'conclusions', 'repositories', 'selectedRepositoryNames', 'createdAt', 'updatedAt', 'deletedAt'] as const;
const PROPOSAL_KEYS = ['id', 'ownerId', 'sessionId', 'createdAt', 'updatedAt', 'operations', 'syncError', 'organization'] as const;
const OPERATION_KEYS = ['id', 'repository', 'kind', 'reason', 'before', 'after', 'selected', 'overrideLocked', 'status', 'error'] as const;
const EDITABLE_KEYS = ['custom_category', 'category_locked', 'custom_tags', 'custom_description'] as const;
const WORKBENCH_KEYS = ['scope', 'depth', 'selectedRepositories', 'requirements', 'searchBatches', 'localProject'] as const;
const REQUIREMENTS_KEYS = ['purpose', 'required', 'preferred', 'excluded', 'questions', 'queries'] as const;
const SEARCH_BATCH_KEYS = ['id', 'createdAt', 'requirements', 'candidates', 'queries', 'nextPage'] as const;
const CANDIDATE_KEYS = ['repository', 'summary', 'reasons', 'limitations', 'sources', 'status'] as const;
const REPOSITORY_KEYS = [
  'id', 'name', 'full_name', 'description', 'html_url', 'stargazers_count', 'forks_count', 'forks',
  'language', 'created_at', 'updated_at', 'pushed_at', 'starred_at', 'owner', 'topics', 'archived',
  'disabled', 'fork', 'is_template', 'open_issues_count', 'default_branch', 'ai_summary', 'ai_tags',
  'ai_platforms', 'analyzed_at', 'analysis_failed', 'analysis_error', 'subscribed_to_releases',
  'custom_description', 'custom_tags', 'custom_category', 'category_locked', 'last_edited',
  'vector_indexed_at', 'vector_indexed_license', 'last_release_fetch_time', 'has_fetched_releases',
  'license',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const assertRecord = (value: unknown, label: string, allowedKeys: readonly string[]): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(`[repository-chat] invalid workbench import: ${label} must be an object`);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (SECRET_KEY_PATTERN.test(key)) throw new Error(`[repository-chat] invalid workbench import: secret-like field ${label}.${key}`);
    if (!allowed.has(key)) throw new Error(`[repository-chat] invalid workbench import: unexpected field ${label}.${key}`);
  }
  return value;
};

const asString = (value: unknown, label: string, maxLength = MAX_SHORT_STRING): string => {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`[repository-chat] invalid workbench import: ${label} must be a bounded string`);
  }
  return value;
};

const asIdentifier = (value: unknown, label: string): string => {
  const text = asString(value, label);
  if (!text) throw new Error(`[repository-chat] invalid workbench import: ${label} must not be empty`);
  return text;
};

const asOptionalString = (value: unknown, label: string, maxLength = MAX_SHORT_STRING): string | undefined => {
  if (value === undefined) return undefined;
  return asString(value, label, maxLength);
};

const asNullableString = (value: unknown, label: string, maxLength = MAX_SHORT_STRING): string | null => {
  if (value === null) return null;
  return asString(value, label, maxLength);
};

const asOptionalNullableString = (value: unknown, label: string, maxLength = MAX_SHORT_STRING): string | null | undefined => {
  if (value === undefined) return undefined;
  return asNullableString(value, label, maxLength);
};

const asBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== 'boolean') throw new Error(`[repository-chat] invalid workbench import: ${label} must be a boolean`);
  return value;
};

const asOptionalBoolean = (value: unknown, label: string): boolean | undefined => {
  if (value === undefined) return undefined;
  return asBoolean(value, label);
};

const asNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`[repository-chat] invalid workbench import: ${label} must be a finite number`);
  return value;
};

const asOptionalNumber = (value: unknown, label: string): number | undefined => {
  if (value === undefined) return undefined;
  return asNumber(value, label);
};

const asEnum = <T extends string>(value: unknown, label: string, allowed: readonly T[]): T => {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`[repository-chat] invalid workbench import: invalid ${label}`);
  return value as T;
};

const asOptionalEnum = <T extends string>(value: unknown, label: string, allowed: readonly T[]): T | undefined => {
  if (value === undefined) return undefined;
  return asEnum(value, label, allowed);
};

const asIsoString = (value: unknown, label: string): string => {
  const text = asString(value, label, 64);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`[repository-chat] invalid workbench import: ${label} must be a date`);
  return text;
};

const asOptionalIsoString = (value: unknown, label: string): string | undefined => {
  if (value === undefined) return undefined;
  return asIsoString(value, label);
};

const asArray = (value: unknown, label: string, maxLength: number): unknown[] => {
  if (!Array.isArray(value) || value.length > maxLength) throw new Error(`[repository-chat] invalid workbench import: ${label} must be a bounded array`);
  return value;
};

const asStringArray = (value: unknown, label: string, maxLength = 5_000): string[] => {
  return asArray(value, label, maxLength).map((item, index) => asString(item, `${label}[${index}]`));
};

const asIdentifierArray = (value: unknown, label: string, maxLength = 5_000): string[] => {
  return asArray(value, label, maxLength).map((item, index) => asIdentifier(item, `${label}[${index}]`));
};

const assertUniqueIds = <T extends { id: string }>(values: T[], label: string): void => {
  if (new Set(values.map((value) => value.id)).size !== values.length) {
    throw new Error(`[repository-chat] invalid workbench import: duplicate ${label} ids`);
  }
};

const validateRepository = (value: unknown, label: string): Repository => {
  const record = assertRecord(value, label, REPOSITORY_KEYS);
  asNumber(record.id, `${label}.id`);
  asString(record.name, `${label}.name`);
  asString(record.full_name, `${label}.full_name`);
  if (record.description !== null) asOptionalString(record.description, `${label}.description`, MAX_TEXT);
  asString(record.html_url, `${label}.html_url`, MAX_TEXT);
  asNumber(record.stargazers_count, `${label}.stargazers_count`);
  asNumber(record.forks_count, `${label}.forks_count`);
  asNumber(record.forks, `${label}.forks`);
  if (record.language !== null) asOptionalString(record.language, `${label}.language`);
  asIsoString(record.created_at, `${label}.created_at`);
  asIsoString(record.updated_at, `${label}.updated_at`);
  asIsoString(record.pushed_at, `${label}.pushed_at`);
  asOptionalIsoString(record.starred_at, `${label}.starred_at`);
  const owner = assertRecord(record.owner, `${label}.owner`, ['login', 'avatar_url']);
  asString(owner.login, `${label}.owner.login`);
  asString(owner.avatar_url, `${label}.owner.avatar_url`, MAX_TEXT);
  asStringArray(record.topics, `${label}.topics`, 1_000);
  for (const key of ['archived', 'disabled', 'fork', 'is_template', 'analysis_failed', 'subscribed_to_releases', 'category_locked', 'has_fetched_releases'] as const) {
    asOptionalBoolean(record[key], `${label}.${key}`);
  }
  asOptionalNumber(record.open_issues_count, `${label}.open_issues_count`);
  for (const key of ['default_branch', 'ai_summary', 'analysis_error', 'custom_description', 'custom_category', 'last_edited', 'vector_indexed_at', 'last_release_fetch_time'] as const) {
    asOptionalString(record[key], `${label}.${key}`, MAX_TEXT);
  }
  asOptionalNullableString(record.vector_indexed_license, `${label}.vector_indexed_license`);
  asOptionalNullableString(record.license, `${label}.license`);
  if (record.ai_tags !== undefined) asStringArray(record.ai_tags, `${label}.ai_tags`, 5_000);
  if (record.ai_platforms !== undefined) asStringArray(record.ai_platforms, `${label}.ai_platforms`, 5_000);
  if (record.custom_tags !== undefined) asStringArray(record.custom_tags, `${label}.custom_tags`, 5_000);
  return record as unknown as Repository;
};

const validateRequirements = (value: unknown, label: string) => {
  const record = assertRecord(value, label, REQUIREMENTS_KEYS);
  asString(record.purpose, `${label}.purpose`, MAX_TEXT);
  for (const key of ['required', 'preferred', 'excluded', 'questions', 'queries'] as const) {
    asStringArray(record[key], `${label}.${key}`, 5_000);
  }
  return record;
};

const validateWorkbenchData = (value: unknown, label: string): WorkbenchSessionData => {
  const record = assertRecord(value, label, WORKBENCH_KEYS);
  asEnum(record.scope, `${label}.scope`, ['github', 'selected', 'project', 'library', 'local', 'mixed'] as const);
  if (record.localProject !== undefined) {
    const project = assertRecord(record.localProject, `${label}.localProject`, ['name', 'identity']);
    asString(project.name, `${label}.localProject.name`, 1_000);
    if (project.identity !== undefined) asString(project.identity, `${label}.localProject.identity`, 128);
  }
  asEnum(record.depth, `${label}.depth`, ['quick', 'standard', 'deep'] as const);
  asArray(record.selectedRepositories, `${label}.selectedRepositories`, MAX_REPOSITORIES_PER_COLLECTION)
    .forEach((repository, index) => validateRepository(repository, `${label}.selectedRepositories[${index}]`));
  if (record.requirements !== undefined) validateRequirements(record.requirements, `${label}.requirements`);
  asArray(record.searchBatches, `${label}.searchBatches`, MAX_SEARCH_BATCHES).forEach((batch, batchIndex) => {
    const batchLabel = `${label}.searchBatches[${batchIndex}]`;
    const batchRecord = assertRecord(batch, batchLabel, SEARCH_BATCH_KEYS);
    asIdentifier(batchRecord.id, `${batchLabel}.id`);
    asIsoString(batchRecord.createdAt, `${batchLabel}.createdAt`);
    validateRequirements(batchRecord.requirements, `${batchLabel}.requirements`);
    asArray(batchRecord.candidates, `${batchLabel}.candidates`, MAX_CANDIDATES_PER_BATCH).forEach((candidate, candidateIndex) => {
      const candidateLabel = `${batchLabel}.candidates[${candidateIndex}]`;
      const candidateRecord = assertRecord(candidate, candidateLabel, CANDIDATE_KEYS);
      validateRepository(candidateRecord.repository, `${candidateLabel}.repository`);
      asString(candidateRecord.summary, `${candidateLabel}.summary`, MAX_TEXT);
      asStringArray(candidateRecord.reasons, `${candidateLabel}.reasons`, 5_000);
      asStringArray(candidateRecord.limitations, `${candidateLabel}.limitations`, 5_000);
      asStringArray(candidateRecord.sources, `${candidateLabel}.sources`, 5_000);
      asEnum(candidateRecord.status, `${candidateLabel}.status`, ['candidate', 'verifying', 'verified', 'insufficient'] as const);
    });
    asStringArray(batchRecord.queries, `${batchLabel}.queries`, 5_000);
    asNumber(batchRecord.nextPage, `${batchLabel}.nextPage`);
  });
  return record as unknown as WorkbenchSessionData;
};

const validateSession = (value: unknown, label: string, ownerId: string): RepositoryChatSession => {
  const record = assertRecord(value, label, SESSION_KEYS);
  asIdentifier(record.id, `${label}.id`);
  asNumber(record.repoId, `${label}.repoId`);
  asString(record.repoFullName, `${label}.repoFullName`);
  asString(record.sourceRefSha, `${label}.sourceRefSha`);
  asString(record.title, `${label}.title`, MAX_TEXT);
  asOptionalString(record.summary, `${label}.summary`, MAX_TEXT);
  asOptionalNullableString(record.modelConfigId, `${label}.modelConfigId`);
  asOptionalString(record.modelLabelAtTime, `${label}.modelLabelAtTime`);
  if (asIdentifier(record.ownerId, `${label}.ownerId`) !== ownerId) throw new Error('[repository-chat] invalid workbench import: foreign session owner');
  asOptionalEnum(record.kind, `${label}.kind`, ['repository', 'workbench'] as const);
  asOptionalString(record.projectId, `${label}.projectId`);
  asOptionalBoolean(record.pinned, `${label}.pinned`);
  asOptionalBoolean(record.archived, `${label}.archived`);
  asOptionalBoolean(record.deviceOnly, `${label}.deviceOnly`);
  if (record.workbench !== undefined) validateWorkbenchData(record.workbench, `${label}.workbench`);
  asIsoString(record.createdAt, `${label}.createdAt`);
  asIsoString(record.updatedAt, `${label}.updatedAt`);
  asOptionalIsoString(record.deletedAt, `${label}.deletedAt`);
  return record as unknown as RepositoryChatSession;
};

const validateMessage = (value: unknown, label: string): RepositoryChatMessage => {
  const record = assertRecord(value, label, MESSAGE_KEYS);
  asIdentifier(record.id, `${label}.id`);
  asIdentifier(record.sessionId, `${label}.sessionId`);
  asEnum(record.role, `${label}.role`, ['user', 'assistant', 'system'] as const);
  asString(record.content, `${label}.content`, MAX_TEXT);
  asEnum(record.status, `${label}.status`, ['complete', 'streaming', 'error', 'aborted'] as const);
  asIdentifierArray(record.evidenceIds, `${label}.evidenceIds`, 5_000);
  if (record.missing !== undefined) asIdentifierArray(record.missing, `${label}.missing`, 32);
  asOptionalEnum(record.answerPhase, `${label}.answerPhase`, ['draft', 'reviewing', 'final'] as const);
  asOptionalEnum(record.quality, `${label}.quality`, ['model-reviewed', 'unreviewed'] as const);
  if (record.comparison !== undefined) asArray(record.comparison, `${label}.comparison`, 200).forEach(value => {
    const cell = assertRecord(value, `${label}.comparisonCell`, ['repository', 'requirement', 'status', 'evidenceId', 'quote']);
    asString(cell.repository, `${label}.comparison.repository`, 1_000);
    asString(cell.requirement, `${label}.comparison.requirement`, 1_000);
    asEnum(cell.status, `${label}.comparison.status`, ['supported', 'unsupported', 'unknown'] as const);
    asOptionalString(cell.evidenceId, `${label}.comparison.evidenceId`);
    asOptionalString(cell.quote, `${label}.comparison.quote`, 4_000);
    if (cell.status !== 'unknown' && (!cell.evidenceId || !cell.quote)) throw new Error('Comparison requires evidence');
  });
  if (record.researchSources !== undefined) asArray(record.researchSources, `${label}.researchSources`, 500).forEach(value => {
    const source = assertRecord(value, `${label}.researchSource`, ['repository', 'status', 'version', 'evidenceIds']);
    asString(source.repository, `${label}.researchSource.repository`, 1_000);
    asEnum(source.status, `${label}.researchSource.status`, ['complete', 'reused', 'changed', 'failed', 'pending'] as const);
    asOptionalString(source.version, `${label}.researchSource.version`, 1_000);
    asIdentifierArray(source.evidenceIds, `${label}.researchSource.evidenceIds`, 5_000);
  });
  if (record.answerPhase === 'final' && record.status !== 'complete') throw new Error('Final answer must be complete');
  if (record.status === 'complete' && (record.answerPhase === 'draft' || record.answerPhase === 'reviewing')) throw new Error('Draft answer cannot be complete');
  if (record.claims !== undefined) asArray(record.claims, `${label}.claims`, 100).forEach((value, index) => {
    const claim = assertRecord(value, `${label}.claims[${index}]`, ['text', 'evidenceId', 'quote']);
    asString(claim.text, `${label}.claim.text`, 2_000);
    asIdentifier(claim.evidenceId, `${label}.claim.evidenceId`);
    asString(claim.quote, `${label}.claim.quote`, 4_000);
  });
  if (record.coverage !== undefined) asArray(record.coverage, `${label}.coverage`, 32).forEach((value, index) => {
    const item = assertRecord(value, `${label}.coverage[${index}]`, ['requirement', 'status', 'answerExcerpt']);
    asString(item.requirement, `${label}.coverage.requirement`, 1_000);
    asEnum(item.status, `${label}.coverage.status`, ['answered', 'unknown'] as const);
    asString(item.answerExcerpt, `${label}.coverage.answerExcerpt`, 4_000);
  });
  asIsoString(record.createdAt, `${label}.createdAt`);
  return record as unknown as RepositoryChatMessage;
};

const validateToolEvent = (value: unknown, label: string): RepositoryChatToolEvent => {
  const record = assertRecord(value, label, TOOL_EVENT_KEYS);
  asIdentifier(record.id, `${label}.id`);
  asIdentifier(record.sessionId, `${label}.sessionId`);
  asIdentifier(record.messageId, `${label}.messageId`);
  asString(record.toolName, `${label}.toolName`);
  asEnum(record.status, `${label}.status`, ['pending', 'running', 'success', 'error'] as const);
  asString(record.paramSummary, `${label}.paramSummary`, MAX_TEXT);
  asOptionalEnum(record.stage, `${label}.stage`, ['understanding', 'context', 'planning', 'retrieval', 'verification', 'replanning', 'escalation', 'answer'] as const);
  asOptionalNumber(record.round, `${label}.round`);
  asOptionalString(record.detail, `${label}.detail`, MAX_TEXT);
  asOptionalNumber(record.durationMs, `${label}.durationMs`);
  asOptionalNumber(record.resultSize, `${label}.resultSize`);
  if (record.evidenceId !== undefined) asIdentifier(record.evidenceId, `${label}.evidenceId`);
  asIsoString(record.createdAt, `${label}.createdAt`);
  return record as unknown as RepositoryChatToolEvent;
};

const validateEvidence = (value: unknown, label: string): ToolEvidence => {
  const record = assertRecord(value, label, EVIDENCE_KEYS);
  asIdentifier(record.id, `${label}.id`);
  asEnum(record.source, `${label}.source`, ['github', 'existing-vector', 'web', 'local'] as const);
  asString(record.repoFullName, `${label}.repoFullName`);
  asOptionalString(record.refSha, `${label}.refSha`);
  asOptionalString(record.path, `${label}.path`, MAX_TEXT);
  asOptionalNumber(record.lineStart, `${label}.lineStart`);
  asOptionalNumber(record.lineEnd, `${label}.lineEnd`);
  asString(record.url, `${label}.url`, MAX_TEXT);
  asOptionalString(record.contentHash, `${label}.contentHash`);
  asString(record.excerpt, `${label}.excerpt`, MAX_TEXT);
  asIsoString(record.retrievedAt, `${label}.retrievedAt`);
  return record as unknown as ToolEvidence;
};

const validateProject = (value: unknown, label: string, ownerId: string): WorkbenchProject => {
  const record = assertRecord(value, label, PROJECT_KEYS);
  asIdentifier(record.id, `${label}.id`);
  if (asIdentifier(record.ownerId, `${label}.ownerId`) !== ownerId) throw new Error('[repository-chat] invalid workbench import: foreign project owner');
  asString(record.name, `${label}.name`, MAX_TEXT);
  asString(record.instructions, `${label}.instructions`, MAX_TEXT);
  asString(record.conclusions, `${label}.conclusions`, MAX_TEXT);
  asArray(record.repositories, `${label}.repositories`, MAX_REPOSITORIES_PER_COLLECTION)
    .forEach((repository, index) => validateRepository(repository, `${label}.repositories[${index}]`));
  if (record.selectedRepositoryNames !== undefined) {
    asStringArray(record.selectedRepositoryNames, `${label}.selectedRepositoryNames`, MAX_REPOSITORIES_PER_COLLECTION);
    if ((record.selectedRepositoryNames as string[]).some(name => !/^[\w.-]+\/[\w.-]+$/.test(name))) throw new Error('[repository-chat] invalid project repository name');
  }
  asIsoString(record.createdAt, `${label}.createdAt`);
  asIsoString(record.updatedAt, `${label}.updatedAt`);
  asOptionalIsoString(record.deletedAt, `${label}.deletedAt`);
  return record as unknown as WorkbenchProject;
};

const validateEditableFields = (value: unknown, label: string): void => {
  const record = assertRecord(value, label, EDITABLE_KEYS);
  asOptionalString(record.custom_category, `${label}.custom_category`, MAX_TEXT);
  asOptionalBoolean(record.category_locked, `${label}.category_locked`);
  if (record.custom_tags !== undefined) asStringArray(record.custom_tags, `${label}.custom_tags`, 5_000);
  asOptionalString(record.custom_description, `${label}.custom_description`, MAX_TEXT);
};

const validateProposal = (value: unknown, label: string, ownerId: string): WorkbenchProposal => {
  const record = assertRecord(value, label, PROPOSAL_KEYS);
  asIdentifier(record.id, `${label}.id`);
  if (asIdentifier(record.ownerId, `${label}.ownerId`) !== ownerId) throw new Error('[repository-chat] invalid workbench import: foreign proposal owner');
  asIdentifier(record.sessionId, `${label}.sessionId`);
  asIsoString(record.createdAt, `${label}.createdAt`);
  asIsoString(record.updatedAt, `${label}.updatedAt`);
  const operations = asArray(record.operations, `${label}.operations`, MAX_OPERATIONS_PER_PROPOSAL);
  const operationIds = new Set<string>();
  operations.forEach((operation, index) => {
    const operationLabel = `${label}.operations[${index}]`;
    const operationRecord = assertRecord(operation, operationLabel, OPERATION_KEYS);
    const id = asIdentifier(operationRecord.id, `${operationLabel}.id`);
    if (operationIds.has(id)) throw new Error(`[repository-chat] invalid workbench import: duplicate operation id ${id}`);
    operationIds.add(id);
    validateRepository(operationRecord.repository, `${operationLabel}.repository`);
    asEnum(operationRecord.kind, `${operationLabel}.kind`, ['update', 'unstar'] as const);
    asString(operationRecord.reason, `${operationLabel}.reason`, MAX_TEXT);
    validateEditableFields(operationRecord.before, `${operationLabel}.before`);
    validateEditableFields(operationRecord.after, `${operationLabel}.after`);
    asBoolean(operationRecord.selected, `${operationLabel}.selected`);
    asBoolean(operationRecord.overrideLocked, `${operationLabel}.overrideLocked`);
    asEnum(operationRecord.status, `${operationLabel}.status`, ['proposed', 'running', 'success', 'failed', 'unknown', 'conflict', 'restored'] as const);
    asOptionalString(operationRecord.error, `${operationLabel}.error`, MAX_TEXT);
  });
  asOptionalString(record.syncError, `${label}.syncError`, MAX_TEXT);
  if (record.organization !== undefined) organizationDraftSchema.parse(record.organization);
  return record as unknown as WorkbenchProposal;
};

const parseWorkbenchBackup = (ownerId: string, data: unknown): WorkbenchBackup => {
  asIdentifier(ownerId, 'ownerId');
  let parsed: unknown = data;
  if (typeof data === 'string') {
    if (data.length > MAX_BACKUP_BYTES) throw new Error('[repository-chat] invalid workbench import: backup is too large');
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      throw new Error('[repository-chat] invalid workbench import: malformed JSON');
    }
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(parsed);
  } catch {
    throw new Error('[repository-chat] invalid workbench import: backup is not serializable');
  }
  if (serialized.length > MAX_BACKUP_BYTES) throw new Error('[repository-chat] invalid workbench import: backup is too large');
  const record = assertRecord(parsed, 'backup', BACKUP_KEYS);
  if (record.schemaVersion !== 1) throw new Error('[repository-chat] invalid workbench import: unsupported schema version');
  if (asIdentifier(record.ownerId, 'backup.ownerId') !== ownerId) throw new Error('[repository-chat] invalid workbench import: backup belongs to another account');
  asIsoString(record.exportedAt, 'backup.exportedAt');
  const sessions = asArray(record.sessions, 'backup.sessions', MAX_SESSIONS).map((value, index) => validateSession(value, `backup.sessions[${index}]`, ownerId));
  const messages = asArray(record.messages, 'backup.messages', MAX_MESSAGES).map((value, index) => validateMessage(value, `backup.messages[${index}]`));
  const toolEvents = asArray(record.toolEvents, 'backup.toolEvents', MAX_TOOL_EVENTS).map((value, index) => validateToolEvent(value, `backup.toolEvents[${index}]`));
  const evidence = asArray(record.evidence, 'backup.evidence', MAX_EVIDENCE).map((value, index) => validateEvidence(value, `backup.evidence[${index}]`));
  const projects = asArray(record.projects, 'backup.projects', MAX_PROJECTS).map((value, index) => validateProject(value, `backup.projects[${index}]`, ownerId));
  const proposals = asArray(record.proposals, 'backup.proposals', MAX_PROPOSALS).map((value, index) => validateProposal(value, `backup.proposals[${index}]`, ownerId));
  assertUniqueIds(sessions, 'session');
  assertUniqueIds(messages, 'message');
  assertUniqueIds(toolEvents, 'tool event');
  assertUniqueIds(evidence, 'evidence');
  assertUniqueIds(projects, 'project');
  assertUniqueIds(proposals, 'proposal');
  const sessionIds = new Set(sessions.map((session) => session.id));
  const projectIds = new Set(projects.map((project) => project.id));
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const evidenceIds = new Set(evidence.map((item) => item.id));
  if (messages.some((message) => !sessionIds.has(message.sessionId))) throw new Error('[repository-chat] invalid workbench import: message references a missing session');
  if (toolEvents.some((event) => !sessionIds.has(event.sessionId))) throw new Error('[repository-chat] invalid workbench import: tool event references a missing session');
  if (sessions.some((session) => session.projectId && !projectIds.has(session.projectId))) {
    throw new Error('[repository-chat] invalid workbench import: session references a missing project');
  }
  if (messages.some((message) => message.evidenceIds.some((id) => !evidenceIds.has(id)))) {
    throw new Error('[repository-chat] invalid workbench import: message references missing evidence');
  }
  const evidenceById = new Map(evidence.map(item => [item.id, item]));
  if (messages.some(message => message.claims?.some(claim => !message.evidenceIds.includes(claim.evidenceId)
    || !evidenceById.get(claim.evidenceId)?.excerpt.includes(claim.quote) || !message.content.includes(claim.text))
    || message.coverage?.some(item => !message.content.includes(item.answerExcerpt))
    || message.comparison?.some(cell => cell.status !== 'unknown' && (!cell.evidenceId || !cell.quote
      || !message.evidenceIds.includes(cell.evidenceId)
      || evidenceById.get(cell.evidenceId)?.repoFullName !== cell.repository
      || !evidenceById.get(cell.evidenceId)?.excerpt.includes(cell.quote))))) {
    throw new Error('[repository-chat] invalid workbench import: answer review references missing content');
  }
  if (toolEvents.some((event) => event.evidenceId && !evidenceIds.has(event.evidenceId))) {
    throw new Error('[repository-chat] invalid workbench import: tool event references missing evidence');
  }
  if (toolEvents.some((event) => {
    const message = messageById.get(event.messageId);
    return !message || message.sessionId !== event.sessionId;
  })) {
    throw new Error('[repository-chat] invalid workbench import: tool event references a missing message');
  }
  return {
    schemaVersion: 1,
    ownerId,
    exportedAt: record.exportedAt as string,
    sessions,
    messages,
    toolEvents,
    evidence,
    projects,
    proposals,
  };
};

const readCompleteSnapshot = async (): Promise<FallbackSnapshot> => {
  if (useFallbackStorage || !canUseIndexedDb()) {
    enableFallbackStorage();
    return readFallback();
  }
  try {
    return await withTimeout(runTransaction([...STORE_NAMES], 'readonly', async (stores) => ({
      sessions: await requestValue(stores.sessions.getAll()) as RepositoryChatSession[],
      messages: await requestValue(stores.messages.getAll()) as RepositoryChatMessage[],
      toolEvents: await requestValue(stores.toolEvents.getAll()) as RepositoryChatToolEvent[],
      evidence: await requestValue(stores.evidence.getAll()) as ToolEvidence[],
      projects: await requestValue(stores.projects.getAll()) as WorkbenchProject[],
      proposals: await requestValue(stores.proposals.getAll()) as WorkbenchProposal[],
    })));
  } catch (error) {
    console.warn('[repository-chat] full snapshot read fell back to localStorage', error);
    if (!await transitionToFallbackStorage()) throw error;
    return readFallback();
  }
};

const nextAvailableId = (originalId: string, occupied: Set<string>): string => {
  if (!occupied.has(originalId)) {
    occupied.add(originalId);
    return originalId;
  }
  let suffix = 1;
  let candidate = `${originalId}-import-${suffix}`;
  while (occupied.has(candidate)) {
    suffix += 1;
    candidate = `${originalId}-import-${suffix}`;
  }
  occupied.add(candidate);
  return candidate;
};

const buildIdMap = <T extends { id: string }>(incoming: T[], existing: T[]): Map<string, string> => {
  const occupied = new Set(existing.map((value) => value.id));
  return new Map(incoming.map((value) => [value.id, nextAvailableId(value.id, occupied)]));
};

const remapImportedBackup = (backup: WorkbenchBackup, current: FallbackSnapshot): WorkbenchBackup => {
  const projectIds = buildIdMap(backup.projects, current.projects);
  const occupiedSessionIds = new Set(current.sessions.map((session) => session.id));
  const sessionIds = new Map(backup.sessions.map((session) => [
    session.id,
    nextAvailableId(session.id, occupiedSessionIds),
  ]));
  for (const proposal of backup.proposals) {
    if (!sessionIds.has(proposal.sessionId)) {
      sessionIds.set(proposal.sessionId, nextAvailableId(proposal.sessionId, occupiedSessionIds));
    }
  }
  const messageIds = buildIdMap(backup.messages, current.messages);
  const toolEventIds = buildIdMap(backup.toolEvents, current.toolEvents);
  const evidenceIds = buildIdMap(backup.evidence, current.evidence);
  const proposalIds = buildIdMap(backup.proposals, current.proposals);
  const sessions = backup.sessions.map((session) => ({
    ...session,
    id: sessionIds.get(session.id) ?? session.id,
    ...(session.projectId ? { projectId: projectIds.get(session.projectId) ?? session.projectId } : {}),
  }));
  const messages = backup.messages.map((message) => ({
    ...message,
    id: messageIds.get(message.id) ?? message.id,
    sessionId: sessionIds.get(message.sessionId) ?? message.sessionId,
    evidenceIds: message.evidenceIds.map((id) => evidenceIds.get(id) ?? id),
    claims: message.claims?.map(claim => ({ ...claim, evidenceId: evidenceIds.get(claim.evidenceId) ?? claim.evidenceId })),
    researchSources: message.researchSources?.map(source => ({ ...source,
      evidenceIds: source.evidenceIds.map(id => evidenceIds.get(id) ?? id) })),
    comparison: message.comparison?.map(cell => ({ ...cell,
      evidenceId: cell.evidenceId ? evidenceIds.get(cell.evidenceId) ?? cell.evidenceId : undefined })),
  }));
  const toolEvents = backup.toolEvents.map((event) => ({
    ...event,
    id: toolEventIds.get(event.id) ?? event.id,
    sessionId: sessionIds.get(event.sessionId) ?? event.sessionId,
    messageId: messageIds.get(event.messageId) ?? event.messageId,
    ...(event.evidenceId ? { evidenceId: evidenceIds.get(event.evidenceId) ?? event.evidenceId } : {}),
  }));
  const projects = backup.projects.map((project) => ({ ...project, id: projectIds.get(project.id) ?? project.id }));
  const proposals = backup.proposals.map((proposal) => ({
    ...proposal,
    ...(proposal.organization ? { organization: { ...proposal.organization, status: 'imported' as const, entries: proposal.organization.entries.map(entry => ({ ...entry, selected: false })) } } : {}),
    id: proposalIds.get(proposal.id) ?? proposal.id,
    sessionId: sessionIds.get(proposal.sessionId) ?? proposal.sessionId,
    operations: proposal.operations.map((operation) => ({
      ...operation,
      selected: false,
      status: 'restored' as const,
    })),
  }));
  return {
    ...backup,
    sessions,
    messages,
    toolEvents,
    evidence: backup.evidence.map((item) => ({ ...item, id: evidenceIds.get(item.id) ?? item.id })),
    projects,
    proposals,
  };
};

export const repositoryChatStorage = {
  /** Stable-ID projection from account-bound home sync. Unlike backup import, never remaps IDs. */
  async applyHomeProjection(ownerId: string, records: Array<{ collection: string; id: string; data: Record<string, unknown> | null; deleted?: boolean }>): Promise<void> {
    const merge = (snapshot: FallbackSnapshot): FallbackSnapshot => {
    const deleted = (collection: string) => new Set(records.filter(row => row.collection === collection && row.deleted).map(row => row.id));
    const ownedSessions = new Set(snapshot.sessions.filter(session => session.ownerId === ownerId && !session.deviceOnly && !session.workbench?.localProject && deleted('sessions').has(session.id)).map(session => session.id));
    const remoteSessions = records.filter(row => row.collection === 'sessions' && row.data && (!row.data.ownerId || String(row.data.ownerId) === ownerId));
    const remoteSessionIds = new Set(remoteSessions.map(row => row.id));
    const keys: Record<string, readonly string[]> = { sessions: SESSION_KEYS, messages: MESSAGE_KEYS, evidence: EVIDENCE_KEYS, projects: PROJECT_KEYS, proposals: PROPOSAL_KEYS };
    const pick = (collection: string, data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).filter(([key]) => keys[collection]?.includes(key)));
    const remote = (collection: string) => records.filter(row => row.collection === collection && row.data).map(row => ({ ...pick(collection, row.data!), id: row.id }));
    const projected: FallbackSnapshot = {
      sessions: [...snapshot.sessions.filter(row => !ownedSessions.has(row.id) && !remoteSessionIds.has(row.id)), ...remoteSessions.map(row => ({ ...pick('sessions', row.data!), id: row.id, ownerId }) as unknown as RepositoryChatSession)],
      messages: [...snapshot.messages.filter(row => !ownedSessions.has(row.sessionId) && !deleted('messages').has(row.id) && !records.some(item => item.collection === 'messages' && item.id === row.id)), ...remote('messages').filter(row => remoteSessionIds.has(String((row as Record<string, unknown>).sessionId))).map(row => ({ evidenceIds: [], ...row }) as unknown as RepositoryChatMessage)],
      toolEvents: snapshot.toolEvents,
      evidence: [...snapshot.evidence.filter(row => row.source === 'local' || !records.some(item => item.collection === 'evidence' && item.id === row.id)), ...remote('evidence') as unknown as ToolEvidence[]],
      projects: [...snapshot.projects.filter(row => row.ownerId !== ownerId || (!deleted('projects').has(row.id) && !records.some(item => item.collection === 'projects' && item.id === row.id))), ...remote('projects').map(row => ({ ...row, ownerId }) as unknown as WorkbenchProject)],
      // Desktop proposal schemas are stricter than remote proposals. Keep remote proposals visible in the home panel without corrupting desktop actions.
      proposals: [...snapshot.proposals.filter(row => row.ownerId !== ownerId || (!deleted('proposals').has(row.id) && !records.some(item => item.collection === 'proposals' && item.id === row.id))), ...remote('proposals').filter(row => Array.isArray((row as Record<string, unknown>).operations)).map(row => ({ ...row, ownerId }) as unknown as WorkbenchProposal)],
    };
      return projected;
    };
    if (useFallbackStorage || !canUseIndexedDb()) { writeFallback(merge(readFallback())); notifyGlobalHistoryChanged('home-projection'); return; }
    await runTransaction([...STORE_NAMES], 'readwrite', async stores => {
      const snapshot: FallbackSnapshot = {
        sessions: await requestValue(stores.sessions.getAll()) as RepositoryChatSession[],
        messages: await requestValue(stores.messages.getAll()) as RepositoryChatMessage[],
        toolEvents: await requestValue(stores.toolEvents.getAll()) as RepositoryChatToolEvent[],
        evidence: await requestValue(stores.evidence.getAll()) as ToolEvidence[],
        projects: await requestValue(stores.projects.getAll()) as WorkbenchProject[],
        proposals: await requestValue(stores.proposals.getAll()) as WorkbenchProposal[],
      };
      const projected = merge(snapshot);
      for (const name of STORE_NAMES) {
        await requestValue(stores[name].clear());
        await Promise.all(projected[name].map(row => requestValue(stores[name].put(row))));
      }
    });
    notifyGlobalHistoryChanged('home-projection');
  },
  async listSessionsByRepository(repoId: number): Promise<RepositoryChatSession[]> {
    const fallback = () => fallbackList<RepositoryChatSession>('sessions', (session) => session.repoId === repoId && !session.deletedAt).sort(byUpdatedAtDescending);
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('sessions', 'readonly', async (stores) => {
        const records = await requestValue(stores.sessions.index('repoId').getAll(repoId));
        return (records as RepositoryChatSession[]).filter((session) => !session.deletedAt).sort(byUpdatedAtDescending);
      }));
    } catch (error) {
      console.warn('[repository-chat] session list fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async listRecentSessions(limit = 50): Promise<RepositoryChatSession[]> {
    const count = Math.max(1, Math.floor(limit));
    const fallback = () => readFallback().sessions
      .filter((session) => !session.deletedAt)
      .sort(byUpdatedAtDescending)
      .slice(0, count);
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('sessions', 'readonly', async (stores) => {
        const records = await requestValue(stores.sessions.getAll()) as RepositoryChatSession[];
        return records.filter((session) => !session.deletedAt).sort(byUpdatedAtDescending).slice(0, count);
      }));
    } catch (error) {
      console.warn('[repository-chat] recent session list fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async getSession(sessionId: string): Promise<RepositoryChatSession | null> {
    const fallback = () => readFallback().sessions.find((session) => session.id === sessionId) ?? null;
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('sessions', 'readonly', async (stores) => {
        return (await requestValue(stores.sessions.get(sessionId)) as RepositoryChatSession | undefined) ?? null;
      }));
    } catch (error) {
      console.warn('[repository-chat] session read fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async saveSession(session: RepositoryChatSession): Promise<void> {
    const fallback = () => {
      const snapshot = readFallback();
      const index = snapshot.sessions.findIndex((item) => item.id === session.id);
      if (index >= 0) {
        assertOwnerCompatible(snapshot.sessions[index].ownerId, session.ownerId, `session ${session.id}`);
        snapshot.sessions[index] = session;
      }
      else snapshot.sessions.push(session);
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      await withTimeout(runTransaction('sessions', 'readwrite', async (stores) => {
        const existing = await requestValue(stores.sessions.get(session.id)) as RepositoryChatSession | undefined;
        if (existing) assertOwnerCompatible(existing.ownerId, session.ownerId, `session ${session.id}`);
        await requestValue(stores.sessions.put(session));
      }));
      notifyGlobalHistoryChanged();
    } catch (error) {
      console.warn('[repository-chat] session write fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
    }
  },

  async listWorkbenchSessions(
    ownerId: string,
    mode: 'active' | 'archived' | 'trash' | 'legacy' = 'active',
  ): Promise<RepositoryChatSession[]> {
    const matches = (session: RepositoryChatSession): boolean => {
      if (mode === 'legacy') return !session.ownerId && !session.deletedAt;
      if (session.ownerId !== ownerId) return false;
      if (mode === 'trash') return Boolean(session.deletedAt);
      if (session.deletedAt) return false;
      if (mode === 'archived') return session.archived === true;
      return session.archived !== true;
    };
    const fallback = () => readFallback().sessions.filter(matches).sort(byUpdatedAtDescending);
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('sessions', 'readonly', async (stores) => {
        const records = await requestValue(stores.sessions.getAll()) as RepositoryChatSession[];
        return records.filter(matches).sort(byUpdatedAtDescending);
      }));
    } catch (error) {
      console.warn('[repository-chat] workbench session list fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async listProjects(ownerId: string): Promise<WorkbenchProject[]> {
    const fallback = () => readFallback().projects
      .filter((project) => project.ownerId === ownerId && !project.deletedAt)
      .sort(byUpdatedAtDescending);
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('projects', 'readonly', async (stores) => {
        const records = await requestValue(stores.projects.index('ownerId').getAll(ownerId)) as WorkbenchProject[];
        return records.filter((project) => !project.deletedAt).sort(byUpdatedAtDescending);
      }));
    } catch (error) {
      console.warn('[repository-chat] project list fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async saveProject(project: WorkbenchProject): Promise<void> {
    const fallback = () => {
      const snapshot = readFallback();
      const index = snapshot.projects.findIndex((item) => item.id === project.id);
      if (index >= 0) {
        assertOwnerCompatible(snapshot.projects[index].ownerId, project.ownerId, `project ${project.id}`);
        snapshot.projects[index] = project;
      }
      else snapshot.projects.push(project);
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      await withTimeout(runTransaction('projects', 'readwrite', async (stores) => {
        const existing = await requestValue(stores.projects.get(project.id)) as WorkbenchProject | undefined;
        if (existing) assertOwnerCompatible(existing.ownerId, project.ownerId, `project ${project.id}`);
        await requestValue(stores.projects.put(project));
      }));
      notifyGlobalHistoryChanged();
    } catch (error) {
      console.warn('[repository-chat] project write fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
    }
  },

  async getProposal(id: string): Promise<WorkbenchProposal | null> {
    const fallback = () => readFallback().proposals.find((proposal) => proposal.id === id) ?? null;
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('proposals', 'readonly', async (stores) => {
        return (await requestValue(stores.proposals.get(id)) as WorkbenchProposal | undefined) ?? null;
      }));
    } catch (error) {
      console.warn('[repository-chat] proposal read fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async listProposals(ownerId: string, sessionId?: string): Promise<WorkbenchProposal[]> {
    const matches = (proposal: WorkbenchProposal) => proposal.ownerId === ownerId && (!sessionId || proposal.sessionId === sessionId);
    const fallback = () => readFallback().proposals.filter(matches).sort(byUpdatedAtDescending);
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('proposals', 'readonly', async (stores) => {
        const records = await requestValue(stores.proposals.index('ownerId').getAll(ownerId)) as WorkbenchProposal[];
        return records.filter(matches).sort(byUpdatedAtDescending);
      }));
    } catch (error) {
      console.warn('[repository-chat] proposal list fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async saveProposal(proposal: WorkbenchProposal): Promise<void> {
    const fallback = () => {
      const snapshot = readFallback();
      const index = snapshot.proposals.findIndex((item) => item.id === proposal.id);
      if (index >= 0) {
        assertOwnerCompatible(snapshot.proposals[index].ownerId, proposal.ownerId, `proposal ${proposal.id}`);
        snapshot.proposals[index] = proposal;
      }
      else snapshot.proposals.push(proposal);
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      await withTimeout(runTransaction('proposals', 'readwrite', async (stores) => {
        const existing = await requestValue(stores.proposals.get(proposal.id)) as WorkbenchProposal | undefined;
        if (existing) assertOwnerCompatible(existing.ownerId, proposal.ownerId, `proposal ${proposal.id}`);
        await requestValue(stores.proposals.put(proposal));
      }));
      notifyGlobalHistoryChanged();
    } catch (error) {
      console.warn('[repository-chat] proposal write fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
    }
  },

  async claimSession(sessionId: string, ownerId: string): Promise<RepositoryChatSession | null> {
    const fallback = () => {
      const snapshot = readFallback();
      const index = snapshot.sessions.findIndex((session) => session.id === sessionId);
      if (index < 0) return null;
      const session = snapshot.sessions[index];
      if (session.ownerId) return null;
      const claimed = { ...session, ownerId, kind: session.kind ?? (session.repoId ? 'repository' as const : 'workbench' as const) };
      snapshot.sessions[index] = claimed;
      writeFallback(snapshot);
      return claimed;
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      const result = await withTimeout(runTransaction('sessions', 'readwrite', async (stores) => {
        const session = await requestValue(stores.sessions.get(sessionId)) as RepositoryChatSession | undefined;
        if (!session) return { session: null, wrote: false };
        if (session.ownerId) return { session: null, wrote: false };
        const claimed = { ...session, ownerId, kind: session.kind ?? (session.repoId ? 'repository' as const : 'workbench' as const) };
        await requestValue(stores.sessions.put(claimed));
        return { session: claimed, wrote: true };
      }));
      if (result.wrote) notifyGlobalHistoryChanged();
      return result.session;
    } catch (error) {
      console.warn('[repository-chat] session claim fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async restoreSession(sessionId: string): Promise<RepositoryChatSession | null> {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    const restored: RepositoryChatSession = {
      ...session,
      updatedAt: new Date().toISOString(),
    };
    delete restored.deletedAt;
    await this.saveSession(restored);
    return restored;
  },

  async cleanupWorkbench(ownerId: string, retentionDays: number, activeSessionId?: string): Promise<void> {
    const snapshot = await readCompleteSnapshot();
    const now = Date.now();
    const retentionCutoff = now - normalizeRetentionDays(retentionDays) * 24 * 60 * 60 * 1000;
    const trashCutoff = now - TRASH_RETENTION_MS;
    const runningSessionIds = new Set(snapshot.proposals
      .filter((proposal) => proposal.ownerId === ownerId && (proposal.operations.some((operation) => operation.status === 'running')
        || (proposal.organization && ['generating', 'applying', 'restoring'].includes(proposal.organization.status))))
      .map((proposal) => proposal.sessionId));
    const ownedSessions = snapshot.sessions.filter((session) => session.ownerId === ownerId);
    const toTrash = ownedSessions.filter((session) => {
      if (session.deletedAt || session.archived || session.pinned || session.projectId) return false;
      if (session.id === activeSessionId || runningSessionIds.has(session.id)) return false;
      return Date.parse(session.updatedAt) < retentionCutoff;
    });
    const toPurge = ownedSessions.filter((session) => {
      if (!session.deletedAt || runningSessionIds.has(session.id)) return false;
      return Date.parse(session.deletedAt) < trashCutoff;
    });
    await Promise.all(toTrash.map((session) => this.softDeleteSession(session.id)));
    await Promise.all(toPurge.map((session) => this.permanentlyDeleteSession(session.id)));
  },

  async exportWorkbench(ownerId: string): Promise<unknown> {
    const snapshot = await readCompleteSnapshot();
    const localEvidenceIds = new Set(snapshot.evidence.filter(item => item.source === 'local').map(item => item.id));
    const localSessionIds = new Set(snapshot.messages.filter(message => message.evidenceIds.some(id => localEvidenceIds.has(id))).map(message => message.sessionId));
    snapshot.sessions.filter(session => session.deviceOnly || session.workbench?.localProject).forEach(session => localSessionIds.add(session.id));
    const sessions = snapshot.sessions.filter((session) => session.ownerId === ownerId && !session.deviceOnly
      && !session.workbench?.localProject && !localSessionIds.has(session.id));
    const sessionIds = new Set(sessions.map((session) => session.id));
    const messages = snapshot.messages.filter((message) => sessionIds.has(message.sessionId));
    const toolEvents = snapshot.toolEvents.filter((event) => sessionIds.has(event.sessionId));
    const evidenceIds = new Set([
      ...messages.flatMap((message) => message.evidenceIds),
      ...toolEvents.flatMap((event) => event.evidenceId ? [event.evidenceId] : []),
    ]);
    const backup: WorkbenchBackup = {
      schemaVersion: 1,
      ownerId,
      exportedAt: new Date().toISOString(),
      sessions,
      messages,
      toolEvents,
      evidence: snapshot.evidence.filter((item) => evidenceIds.has(item.id)),
      projects: snapshot.projects.filter((project) => project.ownerId === ownerId),
      proposals: snapshot.proposals.filter((proposal) => proposal.ownerId === ownerId && !localSessionIds.has(proposal.sessionId)),
    };
    return parseWorkbenchBackup(ownerId, backup);
  },

  async importWorkbench(ownerId: string, data: unknown): Promise<void> {
    const backup = parseWorkbenchBackup(ownerId, data);
    const importIntoFallback = () => {
      const snapshot = readFallback();
      const imported = remapImportedBackup(backup, snapshot);
      snapshot.sessions.push(...imported.sessions);
      snapshot.messages.push(...imported.messages);
      snapshot.toolEvents.push(...imported.toolEvents);
      snapshot.evidence.push(...imported.evidence);
      snapshot.projects.push(...imported.projects);
      snapshot.proposals.push(...imported.proposals);
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      importIntoFallback();
      return;
    }
    try {
      await withTimeout(runTransaction([...STORE_NAMES], 'readwrite', async (stores) => {
        const current: FallbackSnapshot = {
          sessions: await requestValue(stores.sessions.getAll()) as RepositoryChatSession[],
          messages: await requestValue(stores.messages.getAll()) as RepositoryChatMessage[],
          toolEvents: await requestValue(stores.toolEvents.getAll()) as RepositoryChatToolEvent[],
          evidence: await requestValue(stores.evidence.getAll()) as ToolEvidence[],
          projects: await requestValue(stores.projects.getAll()) as WorkbenchProject[],
          proposals: await requestValue(stores.proposals.getAll()) as WorkbenchProposal[],
        };
        const imported = remapImportedBackup(backup, current);
        await Promise.all(imported.sessions.map((session) => requestValue(stores.sessions.put(session))));
        await Promise.all(imported.messages.map((message) => requestValue(stores.messages.put(message))));
        await Promise.all(imported.toolEvents.map((event) => requestValue(stores.toolEvents.put(event))));
        await Promise.all(imported.evidence.map((item) => requestValue(stores.evidence.put(item))));
        await Promise.all(imported.projects.map((project) => requestValue(stores.projects.put(project))));
        await Promise.all(imported.proposals.map((proposal) => requestValue(stores.proposals.put(proposal))));
      }));
      notifyGlobalHistoryChanged();
    } catch (error) {
      console.warn('[repository-chat] workbench import fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      importIntoFallback();
    }
  },

  async purgeExpiredSessions(repoId: number, retainSessionDays: number): Promise<void> {
    const cutoff = Date.now() - normalizeRetentionDays(retainSessionDays) * 24 * 60 * 60 * 1000;
    const sessions = await this.listSessionsByRepository(repoId);
    await Promise.all(sessions
      .filter((session) => !session.pinned && !session.archived && !session.projectId && Date.parse(session.updatedAt) < cutoff)
      .map((session) => this.softDeleteSession(session.id)));
  },

  async softDeleteSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;
    await this.saveSession({
      ...session,
      ownerId: session.ownerId,
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  },

  async permanentlyDeleteSession(sessionId: string): Promise<void> {
    const fallback = () => {
      const snapshot = readFallback();
      snapshot.sessions = snapshot.sessions.filter((item) => item.id !== sessionId);
      const removedToolEvents = snapshot.toolEvents.filter((item) => item.sessionId === sessionId);
      const evidenceIds = new Set([
        ...snapshot.messages.filter((item) => item.sessionId === sessionId).flatMap((item) => item.evidenceIds),
        ...removedToolEvents.flatMap((event) => event.evidenceId ? [event.evidenceId] : []),
      ]);
      snapshot.messages = snapshot.messages.filter((item) => item.sessionId !== sessionId);
      snapshot.toolEvents = snapshot.toolEvents.filter((item) => item.sessionId !== sessionId);
      snapshot.evidence = snapshot.evidence.filter((item) => !evidenceIds.has(item.id));
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      await withTimeout(runTransaction(['sessions', 'messages', 'toolEvents', 'evidence'], 'readwrite', async (stores) => {
        const messages = await requestValue(stores.messages.index('sessionId').getAll(sessionId)) as RepositoryChatMessage[];
        await requestValue(stores.sessions.delete(sessionId));
        await Promise.all(messages.map((message) => requestValue(stores.messages.delete(message.id))));
        const toolEvents = await requestValue(stores.toolEvents.index('sessionId').getAll(sessionId)) as RepositoryChatToolEvent[];
        await Promise.all(toolEvents.map((event) => requestValue(stores.toolEvents.delete(event.id))));
        const evidenceIds = new Set([
          ...messages.flatMap((message) => message.evidenceIds),
          ...toolEvents.flatMap((event) => event.evidenceId ? [event.evidenceId] : []),
        ]);
        await Promise.all([...evidenceIds].map((id) => requestValue(stores.evidence.delete(id))));
      }));
      notifyGlobalHistoryChanged();
    } catch (error) {
      console.warn('[repository-chat] permanent deletion fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
    }
  },

  async listMessages(sessionId: string): Promise<RepositoryChatMessage[]> {
    const fallback = () => fallbackList<RepositoryChatMessage>('messages', (message) => message.sessionId === sessionId).sort(byCreatedAt);
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('messages', 'readonly', async (stores) => {
        return (await requestValue(stores.messages.index('sessionId').getAll(sessionId)) as RepositoryChatMessage[]).sort(byCreatedAt);
      }));
    } catch (error) {
      console.warn('[repository-chat] message list fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async saveMessage(message: RepositoryChatMessage): Promise<void> {
    const fallback = () => {
      const snapshot = readFallback();
      const index = snapshot.messages.findIndex((item) => item.id === message.id);
      if (index >= 0) snapshot.messages[index] = message;
      else snapshot.messages.push(message);
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      await withTimeout(runTransaction('messages', 'readwrite', async (stores) => {
        await requestValue(stores.messages.put(message));
      }));
      notifyGlobalHistoryChanged();
    } catch (error) {
      console.warn('[repository-chat] message write fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
    }
  },

  async permanentlyDeleteMessages(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    const messageIdSet = new Set(messageIds);
    const fallback = () => {
      const snapshot = readFallback();
      const removedToolEvents = snapshot.toolEvents.filter((event) => messageIdSet.has(event.messageId));
      const evidenceIds = new Set([
        ...snapshot.messages.filter((message) => messageIdSet.has(message.id)).flatMap((message) => message.evidenceIds),
        ...removedToolEvents.flatMap((event) => event.evidenceId ? [event.evidenceId] : []),
      ]);
      snapshot.messages = snapshot.messages.filter((message) => !messageIdSet.has(message.id));
      snapshot.toolEvents = snapshot.toolEvents.filter((event) => !messageIdSet.has(event.messageId));
      snapshot.evidence = snapshot.evidence.filter((evidence) => !evidenceIds.has(evidence.id));
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      await withTimeout(runTransaction(['messages', 'toolEvents', 'evidence'], 'readwrite', async (stores) => {
        const messages = (await Promise.all(messageIds.map(async (id) => await requestValue(stores.messages.get(id)) as RepositoryChatMessage | undefined))).filter((message): message is RepositoryChatMessage => Boolean(message));
        await Promise.all(messageIds.map((id) => requestValue(stores.messages.delete(id))));
        const toolEvents = (await Promise.all(messageIds.map(async (id) => await requestValue(stores.toolEvents.index('messageId').getAll(id)) as RepositoryChatToolEvent[]))).flat();
        await Promise.all(toolEvents.map((event) => requestValue(stores.toolEvents.delete(event.id))));
        const evidenceIds = new Set([
          ...messages.flatMap((message) => message.evidenceIds),
          ...toolEvents.flatMap((event) => event.evidenceId ? [event.evidenceId] : []),
        ]);
        await Promise.all([...evidenceIds].map((id) => requestValue(stores.evidence.delete(id))));
      }));
      notifyGlobalHistoryChanged();
    } catch (error) {
      console.warn('[repository-chat] message deletion fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
    }
  },

  async listToolEvents(sessionId: string): Promise<RepositoryChatToolEvent[]> {
    const fallback = () => fallbackList<RepositoryChatToolEvent>('toolEvents', (event) => event.sessionId === sessionId).sort(byCreatedAt);
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('toolEvents', 'readonly', async (stores) => {
        return (await requestValue(stores.toolEvents.index('sessionId').getAll(sessionId)) as RepositoryChatToolEvent[]).sort(byCreatedAt);
      }));
    } catch (error) {
      console.warn('[repository-chat] tool event list fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async saveToolEvent(event: RepositoryChatToolEvent): Promise<void> {
    const fallback = () => {
      const snapshot = readFallback();
      const index = snapshot.toolEvents.findIndex((item) => item.id === event.id);
      if (index >= 0) snapshot.toolEvents[index] = event;
      else snapshot.toolEvents.push(event);
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      await withTimeout(runTransaction('toolEvents', 'readwrite', async (stores) => {
        await requestValue(stores.toolEvents.put(event));
      }));
      notifyGlobalHistoryChanged();
    } catch (error) {
      console.warn('[repository-chat] tool event write fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
    }
  },

  async saveEvidence(evidence: ToolEvidence): Promise<void> {
    const fallback = () => {
      const snapshot = readFallback();
      const index = snapshot.evidence.findIndex((item) => item.id === evidence.id);
      if (index >= 0) snapshot.evidence[index] = evidence;
      else snapshot.evidence.push(evidence);
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      await withTimeout(runTransaction('evidence', 'readwrite', async (stores) => {
        await requestValue(stores.evidence.put(evidence));
      }));
      notifyGlobalHistoryChanged();
    } catch (error) {
      console.warn('[repository-chat] evidence write fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
    }
  },

  async listEvidence(ids: string[]): Promise<ToolEvidence[]> {
    const idSet = new Set(ids);
    const fallback = () => readFallback().evidence.filter((evidence) => idSet.has(evidence.id));
    if (ids.length === 0 || useFallbackStorage || !canUseIndexedDb()) {
      if (!canUseIndexedDb()) enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('evidence', 'readonly', async (stores) => {
        const values = await Promise.all(ids.map(async (id) => await requestValue(stores.evidence.get(id)) as ToolEvidence | undefined));
        return values.filter((value): value is ToolEvidence => Boolean(value));
      }));
    } catch (error) {
      console.warn('[repository-chat] evidence list fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },
};
