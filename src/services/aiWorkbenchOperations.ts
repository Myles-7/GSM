import { z } from 'zod';
import { getAllCategories } from '../store/helpers/categoryHelpers';
import { useAppStore } from '../store/useAppStore';
import type { Repository } from '../types';
import type {
  WorkbenchEditableFields,
  WorkbenchOperation,
  WorkbenchProposal,
} from '../types/aiWorkbench';
import { forceSyncToBackend } from './autoSync';
import { AIService } from './aiService';
import { createGitHubApiService } from './githubApiFactory';
import { repositoryChatStorage } from './repositoryChatStorage';

type ProposalStorage = typeof repositoryChatStorage & {
  saveProposal: (proposal: WorkbenchProposal) => Promise<void>;
  getProposal: (proposalId: string) => Promise<WorkbenchProposal | null>;
};

const proposalStorage = repositoryChatStorage as ProposalStorage;
const RESTORE_RUNNING_MARKER = '__workbench_restore_running__';
const RESTORE_UNKNOWN_PREFIX = 'Restore state is unknown: ';
const RESTORE_FAILED_PREFIX = 'Restore failed: ';
const RESTORE_CONFLICT_PREFIX = 'Restore conflict: ';

const proposedUpdateSchema = z.object({
  repositoryId: z.number().int(),
  reason: z.string().trim().min(1).max(500),
  categoryId: z.string().trim().min(1).max(160).optional(),
  customTags: z.array(z.string().trim().min(1).max(100)).max(20).nullable().optional(),
  customDescription: z.string().max(4000).nullable().optional(),
}).strict();

const proposedUpdatesSchema = z.object({
  operations: z.array(proposedUpdateSchema).max(100),
}).strict();

const cloneProposal = (proposal: WorkbenchProposal): WorkbenchProposal => {
  if (typeof structuredClone === 'function') return structuredClone(proposal);
  return {
    ...proposal,
    operations: proposal.operations.map((operation) => ({
      ...operation,
      repository: {
        ...operation.repository,
        owner: { ...operation.repository.owner },
        topics: [...operation.repository.topics],
        ...(operation.repository.ai_tags ? { ai_tags: [...operation.repository.ai_tags] } : {}),
        ...(operation.repository.ai_platforms ? { ai_platforms: [...operation.repository.ai_platforms] } : {}),
        ...(operation.repository.custom_tags ? { custom_tags: [...operation.repository.custom_tags] } : {}),
      },
      before: {
        ...operation.before,
        ...(operation.before.custom_tags ? { custom_tags: [...operation.before.custom_tags] } : {}),
      },
      after: {
        ...operation.after,
        ...(operation.after.custom_tags ? { custom_tags: [...operation.after.custom_tags] } : {}),
      },
    })),
  };
};

const now = () => new Date().toISOString();

const makeId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new DOMException('The operation was aborted', 'AbortError');
};

const snapshotEditable = (repository: Repository): WorkbenchEditableFields => ({
  custom_category: repository.custom_category,
  category_locked: repository.category_locked,
  custom_tags: repository.custom_tags ? [...repository.custom_tags] : repository.custom_tags,
  custom_description: repository.custom_description,
});

const sameStringArray = (left: string[] | undefined, right: string[] | undefined): boolean => {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
};

const sameEditable = (left: WorkbenchEditableFields, right: WorkbenchEditableFields): boolean => (
  left.custom_category === right.custom_category
  && left.category_locked === right.category_locked
  && left.custom_description === right.custom_description
  && sameStringArray(left.custom_tags, right.custom_tags)
);

const currentRepositoryFor = (operation: WorkbenchOperation): Repository | null => {
  const current = useAppStore.getState().repositories.find((repository) => repository.id === operation.repository.id);
  if (!current || current.full_name !== operation.repository.full_name) return null;
  return current;
};

const checkRestoreLocalRepository = (operation: WorkbenchOperation): { existing: Repository | null; conflict?: string } => {
  const repositories = useAppStore.getState().repositories;
  const byFullName = repositories.find((repository) => repository.full_name === operation.repository.full_name) ?? null;
  const byId = repositories.find((repository) => repository.id === operation.repository.id) ?? null;
  if (byFullName && byFullName.id !== operation.repository.id) {
    return { existing: byFullName, conflict: 'A different repository now uses the original full name' };
  }
  if (byId && byId.full_name !== operation.repository.full_name) {
    return { existing: byId, conflict: 'A different repository now uses the original repository ID' };
  }
  const existing = byFullName ?? byId;
  if (existing && !sameEditable(snapshotEditable(existing), operation.before)) {
    return { existing, conflict: 'The local repository metadata no longer matches the pre-unstar snapshot' };
  }
  return { existing };
};

const repositoryParts = (repository: Repository): [string, string] => {
  const separator = repository.full_name.indexOf('/');
  if (separator <= 0 || separator === repository.full_name.length - 1) {
    throw new Error(`Invalid repository name: ${repository.full_name}`);
  }
  return [repository.full_name.slice(0, separator), repository.full_name.slice(separator + 1)];
};

const existingCategories = () => {
  const state = useAppStore.getState();
  return getAllCategories(
    state.customCategories,
    state.language,
    state.hiddenDefaultCategoryIds,
    state.defaultCategoryOverrides,
  ).filter((category) => category.id !== 'all');
};

const validateCategory = (value: string | undefined): boolean => (
  value === undefined || value === '' || existingCategories().some((category) => category.name === value)
);

const assertConfig = () => {
  const state = useAppStore.getState();
  const requestedIds = [state.repositoryChatSettings.chatConfigId, state.activeAIConfig]
    .filter((id): id is string => Boolean(id));
  const config = requestedIds
    .map((id) => state.aiConfigs.find((candidate) => candidate.id === id))
    .find((candidate) => Boolean(candidate));
  if (!config) throw new Error('No active AI configuration is available');
  return config;
};

const checkedGitHubAccount = async (expectedOwnerId?: string) => {
  const state = useAppStore.getState();
  if (!state.githubToken || !state.user) throw new Error('GitHub authentication is required');
  const expectedStoreUserId = String(state.user.id);
  const expectedStoreLogin = state.user.login;
  const api = createGitHubApiService(state.githubToken);
  const actualUser = await api.getCurrentUser();
  const latest = useAppStore.getState();
  if (latest.githubToken !== state.githubToken || String(latest.user?.id ?? '') !== expectedStoreUserId) {
    throw new Error('The active GitHub account changed during account verification');
  }
  const actualOwnerId = String(actualUser.id);
  if (actualOwnerId !== expectedStoreUserId || actualUser.login !== expectedStoreLogin) {
    throw new Error('The active GitHub token does not match the current local account');
  }
  if (expectedOwnerId !== undefined && actualOwnerId !== expectedOwnerId) {
    throw new Error('This workbench proposal belongs to a different GitHub account');
  }
  return { api, ownerId: actualOwnerId };
};

const isExplicitUnstarQuestion = (question: string): boolean => {
  const normalized = question.trim().toLowerCase();
  if (/\b(?:do not|don't|dont|never)\s+unstar\b/.test(normalized) || /(?:不要|别)\s*(?:取消收藏|取消星标|取消\s*star)/.test(question)) {
    return false;
  }
  return /\bunstar\b|\bremove\b[^.\n]{0,40}\bstarred\b|\bdelete\b[^.\n]{0,40}\bstarred\b|取消收藏|取消星标|移除收藏|删除收藏|取消\s*star|删除[^。\n]{0,40}(?:项目|仓库)/i.test(question);
};

const parseStructuredUpdates = (content: string) => {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI returned an invalid workbench proposal');
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  const result = proposedUpdatesSchema.safeParse(parsed);
  if (!result.success) throw new Error('AI returned a workbench proposal that did not match the required schema');
  return result.data.operations;
};

const buildUpdatePrompt = (
  question: string,
  repositories: Repository[],
  categories: Array<{ id: string; name: string }>,
): string => {
  const candidates = repositories.map((repository) => ({
    id: repository.id,
    fullName: repository.full_name,
    description: repository.description,
    topics: repository.topics,
    aiSummary: repository.ai_summary,
    aiTags: repository.ai_tags,
    customCategory: repository.custom_category,
    categoryLocked: repository.category_locked ?? false,
    customTags: repository.custom_tags,
    customDescription: repository.custom_description,
  }));
  return [
    `User request: ${question}`,
    `Existing categories: ${JSON.stringify(categories)}`,
    `Candidate repositories: ${JSON.stringify(candidates)}`,
    'Return one JSON object only with this shape:',
    '{"operations":[{"repositoryId":123,"reason":"brief reason","categoryId":"an existing category id","customTags":["tag"] or null,"customDescription":"text" or null}]}',
    'Rules:',
    '- repositoryId must be one of the candidate repository IDs. Never invent IDs or use list positions.',
    '- categoryId, when present, must exactly match one of the existing category IDs. Omit it to leave the category unchanged.',
    '- Only include personal metadata fields that should change. Omit a field to leave it unchanged; null clears that personal field.',
    '- Do not modify category lock state and do not propose GitHub star/unstar actions.',
    '- Omit repositories that need no personal metadata change.',
  ].join('\n');
};

const boundOperationPayload = (operation: WorkbenchOperation) => ({
  id: operation.id,
  repository: operation.repository,
  kind: operation.kind,
  reason: operation.reason,
  before: operation.before,
  after: operation.after,
  status: operation.status,
  error: operation.error,
});

const boundProposalPayload = (proposal: WorkbenchProposal) => ({
  id: proposal.id,
  ownerId: proposal.ownerId,
  sessionId: proposal.sessionId,
  createdAt: proposal.createdAt,
  updatedAt: proposal.updatedAt,
  syncError: proposal.syncError,
  operations: proposal.operations.map(boundOperationPayload),
});

const normalizeForComparison = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeForComparison);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, normalizeForComparison(child)]));
  }
  return value;
};

const samePayload = (left: unknown, right: unknown): boolean => (
  JSON.stringify(normalizeForComparison(left)) === JSON.stringify(normalizeForComparison(right))
);

const assertIncomingProposalIsBound = (incoming: WorkbenchProposal, persisted: WorkbenchProposal): void => {
  if (!samePayload(boundProposalPayload(incoming), boundProposalPayload(persisted))) {
    throw new Error('Workbench proposal payload was modified after it was created');
  }
};

const isRestoreJournalState = (operation: WorkbenchOperation): boolean => (
  operation.error === RESTORE_RUNNING_MARKER
  || operation.error?.startsWith(RESTORE_UNKNOWN_PREFIX) === true
  || operation.error?.startsWith(RESTORE_FAILED_PREFIX) === true
  || operation.error?.startsWith(RESTORE_CONFLICT_PREFIX) === true
);

const loadBoundProposal = async (incoming: WorkbenchProposal): Promise<WorkbenchProposal> => {
  if (typeof proposalStorage.getProposal !== 'function') {
    throw new Error('Workbench proposal storage is unavailable');
  }
  const persisted = await proposalStorage.getProposal(incoming.id);
  if (!persisted) throw new Error('Workbench proposal journal was not found');
  assertIncomingProposalIsBound(incoming, persisted);
  return {
    ...cloneProposal(persisted),
    operations: persisted.operations.map((operation, index) => ({
      ...operation,
      selected: incoming.operations[index].selected,
      overrideLocked: incoming.operations[index].overrideLocked,
    })),
  };
};

const saveProposal = async (proposal: WorkbenchProposal, onUpdate?: (proposal: WorkbenchProposal) => Promise<void>): Promise<void> => {
  if (typeof proposalStorage.saveProposal !== 'function') throw new Error('Workbench proposal storage is unavailable');
  proposal.updatedAt = now();
  await proposalStorage.saveProposal(cloneProposal(proposal));
  if (onUpdate) await onUpdate(cloneProposal(proposal));
};

const setOperation = (
  proposal: WorkbenchProposal,
  operationId: string,
  patch: Partial<Pick<WorkbenchOperation, 'status' | 'error'>>,
): WorkbenchOperation => {
  const operation = proposal.operations.find((candidate) => candidate.id === operationId);
  if (!operation) throw new Error(`Workbench operation ${operationId} was not found`);
  Object.assign(operation, patch);
  if (!('error' in patch)) delete operation.error;
  return operation;
};

const markOperation = async (
  proposal: WorkbenchProposal,
  operationId: string,
  patch: Partial<Pick<WorkbenchOperation, 'status' | 'error'>>,
  onUpdate: (proposal: WorkbenchProposal) => Promise<void>,
): Promise<WorkbenchOperation> => {
  const operation = setOperation(proposal, operationId, patch);
  await saveProposal(proposal, onUpdate);
  return operation;
};

const prepareOperation = async (
  proposal: WorkbenchProposal,
  operation: WorkbenchOperation,
  onUpdate: (proposal: WorkbenchProposal) => Promise<void>,
): Promise<boolean> => {
  try {
    await checkedGitHubAccount(proposal.ownerId);
  } catch (error) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: errorMessage(error) }, onUpdate);
    return false;
  }
  const current = currentRepositoryFor(operation);
  if (!current) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: 'Repository is no longer present in the expected local snapshot' }, onUpdate);
    return false;
  }
  if (!sameEditable(snapshotEditable(current), operation.before)) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: 'Repository personal metadata changed after this proposal was created' }, onUpdate);
    return false;
  }
  if (!validateCategory(operation.after.custom_category)) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: 'The proposed category no longer exists' }, onUpdate);
    return false;
  }
  const changesCategory = operation.before.custom_category !== operation.after.custom_category;
  if ((changesCategory || operation.kind === 'unstar') && current.category_locked && !operation.overrideLocked) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: 'The repository category is locked; an explicit lock override is required' }, onUpdate);
    return false;
  }
  if (operation.after.category_locked !== operation.before.category_locked) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: 'Workbench operations cannot change category lock state' }, onUpdate);
    return false;
  }
  return true;
};

const reconcileRunningExecution = async (
  proposal: WorkbenchProposal,
  operation: WorkbenchOperation,
  onUpdate: (proposal: WorkbenchProposal) => Promise<void>,
): Promise<'complete' | 'retry' | 'blocked'> => {
  if (isRestoreJournalState(operation)) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: 'A previous restore was interrupted; resume restore instead of executing this operation again' }, onUpdate);
    return 'blocked';
  }
  if (operation.kind === 'update') {
    const current = currentRepositoryFor(operation);
    if (!current) {
      await markOperation(proposal, operation.id, { status: 'conflict', error: 'Repository disappeared while reconciling an interrupted update' }, onUpdate);
      return 'blocked';
    }
    const snapshot = snapshotEditable(current);
    if (sameEditable(snapshot, operation.after)) {
      await markOperation(proposal, operation.id, { status: 'success' }, onUpdate);
      return 'complete';
    }
    if (sameEditable(snapshot, operation.before)) return 'retry';
    await markOperation(proposal, operation.id, { status: 'conflict', error: 'Repository metadata changed while an interrupted update was being reconciled' }, onUpdate);
    return 'blocked';
  }

  let account;
  try {
    account = await checkedGitHubAccount(proposal.ownerId);
  } catch (error) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: errorMessage(error) }, onUpdate);
    return 'blocked';
  }
  const [owner, name] = repositoryParts(operation.repository);
  let starred: boolean;
  try {
    starred = await account.api.isRepositoryStarred(owner, name);
  } catch (error) {
    await markOperation(proposal, operation.id, { status: 'unknown', error: `Unable to reconcile interrupted unstar: ${errorMessage(error)}` }, onUpdate);
    return 'blocked';
  }
  const current = currentRepositoryFor(operation);
  if (!starred) {
    if (current && !sameEditable(snapshotEditable(current), operation.before)) {
      await markOperation(proposal, operation.id, { status: 'conflict', error: 'GitHub is unstarred, but the local repository changed before reconciliation could remove it' }, onUpdate);
      return 'blocked';
    }
    if (current) useAppStore.getState().deleteRepository(current.id);
    await markOperation(proposal, operation.id, { status: 'success' }, onUpdate);
    return 'complete';
  }
  if (!current || !sameEditable(snapshotEditable(current), operation.before)) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: 'The repository changed while an interrupted unstar was being reconciled' }, onUpdate);
    return 'blocked';
  }
  return 'retry';
};

const executeUpdate = async (
  proposal: WorkbenchProposal,
  operation: WorkbenchOperation,
  onUpdate: (proposal: WorkbenchProposal) => Promise<void>,
): Promise<boolean> => {
  if (!await prepareOperation(proposal, operation, onUpdate)) return false;
  await markOperation(proposal, operation.id, { status: 'running' }, onUpdate);
  if (String(useAppStore.getState().user?.id ?? '') !== proposal.ownerId) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: 'Account changed before applying the update' }, onUpdate);
    return false;
  }
  const current = currentRepositoryFor(operation);
  if (!current || !sameEditable(snapshotEditable(current), operation.before)) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: 'Repository metadata changed immediately before the update was applied' }, onUpdate);
    return false;
  }
  useAppStore.getState().updateRepository({ ...current, ...operation.after, last_edited: now() });
  await markOperation(proposal, operation.id, { status: 'success' }, onUpdate);
  return true;
};

const executeUnstar = async (
  proposal: WorkbenchProposal,
  operation: WorkbenchOperation,
  signal: AbortSignal,
  onUpdate: (proposal: WorkbenchProposal) => Promise<void>,
): Promise<boolean> => {
  if (!await prepareOperation(proposal, operation, onUpdate)) return false;
  throwIfAborted(signal);
  const account = await checkedGitHubAccount(proposal.ownerId);
  const [owner, name] = repositoryParts(operation.repository);
  await markOperation(proposal, operation.id, { status: 'running' }, onUpdate);
  try {
    await account.api.unstarRepository(owner, name);
  } catch (requestError) {
    let starred: boolean;
    try {
      starred = await account.api.isRepositoryStarred(owner, name);
    } catch (reconcileError) {
      await markOperation(proposal, operation.id, {
        status: 'unknown',
        error: `Unstar request failed and GitHub state could not be verified: ${errorMessage(requestError)}; ${errorMessage(reconcileError)}`,
      }, onUpdate);
      return false;
    }
    if (starred) {
      await markOperation(proposal, operation.id, { status: 'failed', error: errorMessage(requestError) }, onUpdate);
      return false;
    }
  }

  const current = currentRepositoryFor(operation);
  if (String(useAppStore.getState().user?.id ?? '') !== proposal.ownerId
    || (current && !sameEditable(snapshotEditable(current), operation.before))) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: 'GitHub unstar succeeded, but the account or local metadata changed; local data was preserved' }, onUpdate);
    return false;
  }
  if (current) useAppStore.getState().deleteRepository(current.id);
  await markOperation(proposal, operation.id, { status: 'success' }, onUpdate);
  return true;
};

const syncBackendSeparately = async (
  proposal: WorkbenchProposal,
  onUpdate: (proposal: WorkbenchProposal) => Promise<void>,
): Promise<void> => {
  try {
    await forceSyncToBackend({ reportFailures: true });
    delete proposal.syncError;
  } catch (error) {
    proposal.syncError = errorMessage(error);
  }
  await saveProposal(proposal, onUpdate);
};

const repositoryWithoutOriginalStarredAt = (repository: Repository): Repository => {
  const restored = { ...repository };
  delete restored.starred_at;
  return restored;
};

const addRestoredRepository = (operation: WorkbenchOperation): void => {
  const restored = repositoryWithoutOriginalStarredAt(operation.repository);
  Object.assign(restored, operation.before);
  useAppStore.getState().setRepositories([...useAppStore.getState().repositories, restored], { allowEmpty: true });
};

const reconcileRunningRestore = async (
  proposal: WorkbenchProposal,
  operation: WorkbenchOperation,
  onUpdate: (proposal: WorkbenchProposal) => Promise<void>,
): Promise<'complete' | 'retry' | 'blocked'> => {
  if (!isRestoreJournalState(operation)) return 'blocked';
  if (operation.kind === 'update') {
    const current = currentRepositoryFor(operation);
    if (!current) {
      await markOperation(proposal, operation.id, { status: 'conflict', error: `${RESTORE_CONFLICT_PREFIX}Repository disappeared while restore was being reconciled` }, onUpdate);
      return 'blocked';
    }
    const snapshot = snapshotEditable(current);
    if (sameEditable(snapshot, operation.before)) {
      await markOperation(proposal, operation.id, { status: 'restored' }, onUpdate);
      return 'complete';
    }
    if (sameEditable(snapshot, operation.after)) {
      await markOperation(proposal, operation.id, { status: 'success' }, onUpdate);
      return 'retry';
    }
    await markOperation(proposal, operation.id, { status: 'conflict', error: `${RESTORE_CONFLICT_PREFIX}Repository metadata changed while restore was being reconciled` }, onUpdate);
    return 'blocked';
  }

  let account;
  try {
    account = await checkedGitHubAccount(proposal.ownerId);
  } catch (error) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: `${RESTORE_CONFLICT_PREFIX}${errorMessage(error)}` }, onUpdate);
    return 'blocked';
  }
  const local = checkRestoreLocalRepository(operation);
  if (local.conflict) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: `${RESTORE_CONFLICT_PREFIX}${local.conflict}` }, onUpdate);
    return 'blocked';
  }
  const [owner, name] = repositoryParts(operation.repository);
  let starred: boolean;
  try {
    starred = await account.api.isRepositoryStarred(owner, name);
  } catch (error) {
    await markOperation(proposal, operation.id, { status: 'unknown', error: `${RESTORE_UNKNOWN_PREFIX}${errorMessage(error)}` }, onUpdate);
    return 'blocked';
  }
  if (starred) {
    if (!local.existing) addRestoredRepository(operation);
    await markOperation(proposal, operation.id, { status: 'restored' }, onUpdate);
    return 'complete';
  }
  if (local.existing) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: `${RESTORE_CONFLICT_PREFIX}GitHub is unstarred but the repository unexpectedly exists locally during restore reconciliation` }, onUpdate);
    return 'blocked';
  }
  await markOperation(proposal, operation.id, { status: 'success' }, onUpdate);
  return 'retry';
};

const restoreUpdate = async (
  proposal: WorkbenchProposal,
  operation: WorkbenchOperation,
  onUpdate: (proposal: WorkbenchProposal) => Promise<void>,
): Promise<boolean> => {
  try {
    await checkedGitHubAccount(proposal.ownerId);
  } catch (error) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: `${RESTORE_CONFLICT_PREFIX}${errorMessage(error)}` }, onUpdate);
    return false;
  }
  const current = currentRepositoryFor(operation);
  if (!current || !sameEditable(snapshotEditable(current), operation.after)) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: `${RESTORE_CONFLICT_PREFIX}Repository metadata no longer matches the successful workbench update` }, onUpdate);
    return false;
  }
  await markOperation(proposal, operation.id, { status: 'running', error: RESTORE_RUNNING_MARKER }, onUpdate);
  const latest = currentRepositoryFor(operation);
  if (!latest || !sameEditable(snapshotEditable(latest), operation.after)) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: `${RESTORE_CONFLICT_PREFIX}Repository metadata changed immediately before restore` }, onUpdate);
    return false;
  }
  useAppStore.getState().updateRepository({ ...latest, ...operation.before, last_edited: now() });
  await markOperation(proposal, operation.id, { status: 'restored' }, onUpdate);
  return true;
};

const restoreUnstar = async (
  proposal: WorkbenchProposal,
  operation: WorkbenchOperation,
  signal: AbortSignal,
  onUpdate: (proposal: WorkbenchProposal) => Promise<void>,
): Promise<boolean> => {
  throwIfAborted(signal);
  let account;
  try {
    account = await checkedGitHubAccount(proposal.ownerId);
  } catch (error) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: `${RESTORE_CONFLICT_PREFIX}${errorMessage(error)}` }, onUpdate);
    return false;
  }
  const local = checkRestoreLocalRepository(operation);
  if (local.conflict) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: `${RESTORE_CONFLICT_PREFIX}${local.conflict}` }, onUpdate);
    return false;
  }
  const [owner, name] = repositoryParts(operation.repository);
  let alreadyStarred: boolean;
  try {
    alreadyStarred = await account.api.isRepositoryStarred(owner, name);
  } catch (error) {
    await markOperation(proposal, operation.id, { status: 'unknown', error: `${RESTORE_UNKNOWN_PREFIX}Unable to verify GitHub star state before restore: ${errorMessage(error)}` }, onUpdate);
    return false;
  }
  await markOperation(proposal, operation.id, { status: 'running', error: RESTORE_RUNNING_MARKER }, onUpdate);
  if (!alreadyStarred) {
    try {
      await account.api.starRepository(owner, name);
    } catch (requestError) {
      let starred: boolean;
      try {
        starred = await account.api.isRepositoryStarred(owner, name);
      } catch (reconcileError) {
        await markOperation(proposal, operation.id, {
          status: 'unknown',
          error: `${RESTORE_UNKNOWN_PREFIX}Star request failed and GitHub state could not be verified: ${errorMessage(requestError)}; ${errorMessage(reconcileError)}`,
        }, onUpdate);
        return false;
      }
      if (!starred) {
        await markOperation(proposal, operation.id, { status: 'failed', error: `${RESTORE_FAILED_PREFIX}${errorMessage(requestError)}` }, onUpdate);
        return false;
      }
    }
  }

  const latest = checkRestoreLocalRepository(operation);
  if (String(useAppStore.getState().user?.id ?? '') !== proposal.ownerId) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: `${RESTORE_CONFLICT_PREFIX}Account changed after GitHub star; local data was preserved` }, onUpdate);
    return false;
  }
  if (latest.conflict) {
    await markOperation(proposal, operation.id, { status: 'conflict', error: `${RESTORE_CONFLICT_PREFIX}GitHub star was restored, but ${latest.conflict.toLowerCase()}` }, onUpdate);
    return false;
  }
  if (!latest.existing) {
    addRestoredRepository(operation);
  }
  await markOperation(proposal, operation.id, { status: 'restored' }, onUpdate);
  return true;
};

export async function proposeWorkbenchOperations(input: {
  question: string;
  sessionId: string;
  signal: AbortSignal;
}): Promise<WorkbenchProposal> {
  const question = input.question.trim();
  if (!question) throw new Error('A workbench question is required');
  throwIfAborted(input.signal);
  const { ownerId } = await checkedGitHubAccount();
  throwIfAborted(input.signal);
  const state = useAppStore.getState();
  if (!state.user || String(state.user.id) !== ownerId) {
    throw new Error('The active GitHub account changed while the workbench proposal was being prepared');
  }
  if (state.repositories.length === 0) throw new Error('The current repository library is empty');
  const config = assertConfig();

  const library = state.repositories.map((repository) => ({
    ...repository,
    owner: { ...repository.owner },
    topics: [...repository.topics],
    ...(repository.custom_tags ? { custom_tags: [...repository.custom_tags] } : {}),
  }));
  const ai = new AIService(config, state.language);
  const candidates = await ai.searchRepositoriesWithSelection(library, question, { signal: input.signal });
  throwIfAborted(input.signal);
  const candidateIds = new Set(candidates.map((repository) => repository.id));
  const unstarMode = isExplicitUnstarQuestion(question);
  const operations: WorkbenchOperation[] = [];

  if (unstarMode) {
    for (const repository of candidates) {
      const before = snapshotEditable(repository);
      operations.push({
        id: makeId('workbench-op'),
        repository,
        kind: 'unstar',
        reason: `Matches the explicit unstar request: ${question.slice(0, 300)}`,
        before,
        after: { ...before, custom_tags: before.custom_tags ? [...before.custom_tags] : before.custom_tags },
        selected: false,
        overrideLocked: false,
        status: 'proposed',
      });
    }
  } else if (candidates.length > 0) {
    const categories = existingCategories().map((category) => ({ id: category.id, name: category.name }));
    const categoriesById = new Map(categories.map((category) => [category.id, category]));
    const content = await ai.generateChatText({
      system: 'You propose safe edits to personal repository metadata. Return only the requested JSON object. Repository IDs and category IDs are strict allowlists. Never propose GitHub star or unstar actions and never change category lock state.',
      user: buildUpdatePrompt(question, candidates, categories),
      temperature: 0.1,
      maxTokens: 4000,
      signal: input.signal,
    });
    const suggestions = parseStructuredUpdates(content);
    const seen = new Set<number>();
    const byId = new Map(candidates.map((repository) => [repository.id, repository]));
    for (const suggestion of suggestions) {
      if (seen.has(suggestion.repositoryId)) {
        throw new Error(`AI returned duplicate operations for repository ${suggestion.repositoryId}`);
      }
      if (!candidateIds.has(suggestion.repositoryId)) {
        throw new Error(`AI returned an operation for unavailable repository ${suggestion.repositoryId}`);
      }
      const repository = byId.get(suggestion.repositoryId);
      if (!repository) throw new Error(`AI returned an unknown repository ${suggestion.repositoryId}`);
      seen.add(suggestion.repositoryId);
      const before = snapshotEditable(repository);
      const after: WorkbenchEditableFields = {
        ...before,
        custom_tags: before.custom_tags ? [...before.custom_tags] : before.custom_tags,
      };
      if ('categoryId' in suggestion) {
        const category = categoriesById.get(suggestion.categoryId!);
        if (!category) throw new Error(`AI returned an unavailable category ID: ${suggestion.categoryId}`);
        after.custom_category = category.name;
      }
      if ('customTags' in suggestion) {
        after.custom_tags = suggestion.customTags === null
          ? undefined
          : [...new Set((suggestion.customTags ?? []).map((tag) => tag.trim()).filter(Boolean))];
      }
      if ('customDescription' in suggestion) {
        after.custom_description = suggestion.customDescription === null ? undefined : suggestion.customDescription;
      }
      after.category_locked = before.category_locked;
      if (sameEditable(before, after)) continue;
      const changesCategory = before.custom_category !== after.custom_category;
      operations.push({
        id: makeId('workbench-op'),
        repository,
        kind: 'update',
        reason: suggestion.reason,
        before,
        after,
        selected: !(changesCategory && repository.category_locked),
        overrideLocked: false,
        status: 'proposed',
      });
    }
  }

  const createdAt = now();
  const proposal: WorkbenchProposal = {
    id: makeId('workbench-proposal'),
    ownerId,
    sessionId: input.sessionId,
    createdAt,
    updatedAt: createdAt,
    operations,
  };
  await saveProposal(proposal);
  return cloneProposal(proposal);
}

export async function executeWorkbenchProposal(
  incoming: WorkbenchProposal,
  signal: AbortSignal,
  onUpdate: (proposal: WorkbenchProposal) => Promise<void>,
): Promise<WorkbenchProposal> {
  throwIfAborted(signal);
  const proposal = await loadBoundProposal(incoming);
  await checkedGitHubAccount(proposal.ownerId);
  await saveProposal(proposal, onUpdate);
  let localChanged = false;

  for (const operation of proposal.operations) {
    throwIfAborted(signal);
    if (!operation.selected || operation.status === 'success' || operation.status === 'restored') continue;
    if (isRestoreJournalState(operation)) continue;
    if (operation.status === 'running' || operation.status === 'unknown') {
      const outcome = await reconcileRunningExecution(proposal, operation, onUpdate);
      if (outcome === 'complete') {
        localChanged = true;
        continue;
      }
      if (outcome === 'blocked') continue;
    }
    const changed = operation.kind === 'update'
      ? await executeUpdate(proposal, operation, onUpdate)
      : await executeUnstar(proposal, operation, signal, onUpdate);
    localChanged = localChanged || changed;
  }

  if (localChanged) await syncBackendSeparately(proposal, onUpdate);
  return cloneProposal(proposal);
}

export async function restoreWorkbenchProposal(
  incoming: WorkbenchProposal,
  signal: AbortSignal,
  onUpdate: (proposal: WorkbenchProposal) => Promise<void>,
): Promise<WorkbenchProposal> {
  throwIfAborted(signal);
  const proposal = await loadBoundProposal(incoming);
  await checkedGitHubAccount(proposal.ownerId);
  await saveProposal(proposal, onUpdate);
  let localChanged = false;

  for (const operation of proposal.operations) {
    throwIfAborted(signal);
    if (!operation.selected || operation.status === 'restored') continue;
    if (isRestoreJournalState(operation)) {
      const outcome = await reconcileRunningRestore(proposal, operation, onUpdate);
      if (outcome === 'complete') {
        localChanged = true;
        continue;
      }
      if (outcome === 'blocked') continue;
    }
    if (operation.status !== 'success') continue;
    const changed = operation.kind === 'update'
      ? await restoreUpdate(proposal, operation, onUpdate)
      : await restoreUnstar(proposal, operation, signal, onUpdate);
    localChanged = localChanged || changed;
  }

  if (localChanged) await syncBackendSeparately(proposal, onUpdate);
  return cloneProposal(proposal);
}
