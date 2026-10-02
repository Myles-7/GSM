import { z } from 'zod';
import { HomeApiError, type HomeApi } from './api';
import type { HomeDatabase } from './database';
import type { HomeTask } from './types';

export interface PendingTaskRequest extends Record<string, unknown> {
  requestId: string;
  workspaceId: string;
  githubUserId: number;
  configId?: string;
  kind: string;
  input: Record<string, unknown>;
}

type TaskIdentity = Pick<PendingTaskRequest, 'workspaceId' | 'githubUserId'>;
type TaskSubmissionContext = {
  api: Pick<HomeApi, 'request'>;
  db: Pick<HomeDatabase, 'metadata' | 'claimTaskRequest' | 'confirmTaskRequest'>;
  identity: TaskIdentity;
};

const requestSchema = z.object({
  requestId: z.string().min(1).max(150),
  workspaceId: z.string().min(1),
  githubUserId: z.number().int().positive().refine(Number.isSafeInteger),
  configId: z.string().min(1).optional(),
  kind: z.string().min(1).max(150),
  input: z.record(z.string(), z.unknown()),
}).strict();

const taskLabels: Record<string, string> = {
  summary: '仓库摘要', details: '仓库分析', classification: '仓库分类', chat: '对话',
  requirements: '需求整理', research: '研究', compare: '仓库比较', proposal: '变更建议',
  custom_discovery: '自定义发现', organization: '仓库整理', refresh_stars: 'Star 刷新',
};

/** Display only task context, never the saved prompt, credentials or API error body. */
export function pendingTaskLabel(request: PendingTaskRequest): string {
  const label = taskLabels[request.kind] ?? '后台';
  const channel = request.input.channelId;
  const session = request.input.sessionId;
  if (typeof channel === 'string') return `${label}（频道 ${channel.slice(0, 150)}）`;
  if (typeof session === 'string') return `${label}（对话 ${session.slice(0, 150)}）`;
  const repositories = request.input.repositories;
  if (Array.isArray(repositories) && repositories.length === 1 && typeof repositories[0] === 'string') {
    return `${label}（${repositories[0].slice(0, 150)}）`;
  }
  return label;
}

function parsedRequest(value: unknown): PendingTaskRequest | undefined {
  if (!requestSchema.safeParse(value).success) return undefined;
  const jsonValue = (item: unknown, depth = 0): boolean => {
    if (depth > 20) return false;
    if (item === null || item === undefined || typeof item === 'string' || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (Array.isArray(item)) return item.every(child => jsonValue(child, depth + 1));
    return typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype
      && Object.values(item).every(child => jsonValue(child, depth + 1));
  };
  if (!jsonValue(value)) return undefined;
  // Return the stored object, not a parsed copy: retries must retain the exact payload.
  return value as PendingTaskRequest;
}

export class PendingTaskRequestError extends Error {
  readonly request?: PendingTaskRequest;
  constructor(request?: unknown, message?: string, public readonly cause?: unknown) {
    const parsed = parsedRequest(request);
    super(message ?? `上一项${parsed ? pendingTaskLabel(parsed) : ''}任务尚未确认，请先恢复上次提交，避免重复运行。`);
    this.name = 'PendingTaskRequestError';
    this.request = parsed;
  }
}

function validateRequest(value: unknown, identity: TaskIdentity): PendingTaskRequest {
  const request = parsedRequest(value);
  if (!request) throw new PendingTaskRequestError(undefined, '未确认任务的本机记录格式无效，无法安全恢复；请检查原工作区的任务中心。');
  if (request.workspaceId !== identity.workspaceId || request.githubUserId !== identity.githubUserId) {
    throw new PendingTaskRequestError(request, '未确认任务属于其他账户或工作区，请连接原账户和工作区后恢复。');
  }
  return request;
}

export async function readPendingTaskRequest(context: TaskSubmissionContext): Promise<PendingTaskRequest | null> {
  const value = await context.db.metadata<unknown>('unconfirmedTask');
  return value === undefined ? null : validateRequest(value, context.identity);
}

function stableJson(value: unknown): string | undefined {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter(key => record[key] !== undefined).map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function taskReceipt(value: unknown, request: PendingTaskRequest): HomeTask {
  const task = value as Partial<HomeTask> & Partial<TaskIdentity> & { configId?: unknown } | null;
  const inputMatches = task?.input && Object.entries(request.input).every(([key, item]) =>
    item === undefined || stableJson(item) === stableJson(task.input![key]));
  if (!task || typeof task.id !== 'string' || !task.id || task.requestId !== request.requestId
    || task.kind !== request.kind || typeof task.status !== 'string' || !inputMatches
    || (task.workspaceId !== undefined && task.workspaceId !== request.workspaceId)
    || (task.githubUserId !== undefined && task.githubUserId !== request.githubUserId)
    || (task.configId !== undefined && request.configId !== undefined && task.configId !== request.configId)) {
    throw new PendingTaskRequestError(request, '电脑返回的任务与上次提交不一致，已保留原提交，请检查原工作区的任务中心。');
  }
  return task as HomeTask;
}

function uncertainSubmission(request: PendingTaskRequest, error: unknown): PendingTaskRequestError {
  if (error instanceof PendingTaskRequestError) return error;
  const guidance = error instanceof HomeApiError && [401, 403].includes(error.status)
    ? '请在连接设置重新验证访问密钥，再恢复上次提交。'
    : '请检查电脑连接，再恢复上次提交。';
  return new PendingTaskRequestError(request, `${pendingTaskLabel(request)}任务的提交结果尚未确认，已保留原提交。${guidance}`, error);
}

function isDefinitiveRejection(error: unknown): error is HomeApiError {
  if (!(error instanceof HomeApiError) || error.status < 400 || error.status >= 500
    || [401, 403].includes(error.status) || error.code === 'REQUEST_ID_CONFLICT') return false;
  return typeof error.body === 'object' && error.body !== null && 'accepted' in error.body
    && error.body.accepted === false;
}

const rejectionMessages: Record<string, string> = {
  INVALID_TASK: '任务参数无效，请检查频道内容、日期或所选仓库',
  INVALID_REPOSITORIES: '所选仓库格式无效或包含重复项',
  AI_CONFIG_REQUIRED: '请在电脑配置可用的 DeepSeek 模型，并在手机重新选择',
  AI_CONFIG_DECRYPT_FAILED: '电脑无法读取模型密钥，请在电脑重新保存模型配置',
  DEEPSEEK_ENDPOINT_REQUIRED: '请在电脑使用 DeepSeek 官方 HTTPS 地址',
  DEEPSEEK_MODEL_REQUIRED: '请在电脑填写有效的 DeepSeek 模型名称',
  DISCOVERY_CHANNEL_QUERY_REQUIRED: '请先填写自定义频道的发现要求',
  RESEARCH_QUERY_REQUIRED: '请先填写研究问题或选择仓库',
  REPOSITORY_EVIDENCE_REQUIRED: '请先选择此任务需要的仓库',
  RESEARCH_REPOSITORY_LIMIT: '此任务最多选择 4 个仓库',
  USER_MESSAGE_MISMATCH: '问题尚未与电脑同步，请先完成同步后重试',
  SESSION_TASK_ACTIVE: '此对话已有运行中的任务，请先查看任务中心',
  REFRESH_STARS_TASK_ACTIVE: '已有 Star 刷新任务运行中，请先查看任务中心',
};

async function dispatch(context: TaskSubmissionContext, request: PendingTaskRequest): Promise<HomeTask> {
  let receipt: unknown;
  try {
    receipt = await context.api.request<unknown>('/tasks', request);
  } catch (error) {
    // Only a backend guarantee that no task exists releases this exact request.
    // Network loss, auth failures and arbitrary 4xx/5xx replies remain uncertain.
    if (isDefinitiveRejection(error)) {
      await context.db.confirmTaskRequest(request.requestId);
      throw new HomeApiError(error.status, error.code, `电脑未接收任务：${rejectionMessages[error.code] ?? error.message}。已解除提交限制，可修改后重试。`, error.body);
    }
    throw uncertainSubmission(request, error);
  }
  try {
    const task = taskReceipt(receipt, request);
    await context.db.confirmTaskRequest(request.requestId);
    return task;
  } catch (error) {
    throw uncertainSubmission(request, error);
  }
}

/** Durably claim before dispatch; a different pending context requires explicit recovery. */
export async function submitTaskRequest(context: TaskSubmissionContext, value: PendingTaskRequest): Promise<HomeTask> {
  const request = validateRequest(value, context.identity);
  // Check existing metadata first so malformed/foreign records cannot be replayed.
  await readPendingTaskRequest(context);
  const claimed = validateRequest(await context.db.claimTaskRequest(request), context.identity);
  return dispatch(context, claimed);
}

async function lookup(context: TaskSubmissionContext, request: PendingTaskRequest): Promise<HomeTask | null> {
  const query = new URLSearchParams({ workspaceId: request.workspaceId, githubUserId: String(request.githubUserId) });
  try {
    const receipt = await context.api.request<unknown>(`/tasks/by-request/${encodeURIComponent(request.requestId)}?${query}`);
    const task = taskReceipt(receipt, request);
    await context.db.confirmTaskRequest(request.requestId);
    return task;
  } catch (error) {
    // A missing receipt cannot prove that an earlier HTTP request will never arrive.
    if (error instanceof HomeApiError && error.status === 404) return null;
    throw uncertainSubmission(request, error);
  }
}

/** Read-only server lookup is safe on mount; it never resubmits a paid task. */
export async function lookupPendingTaskRequest(context: TaskSubmissionContext): Promise<HomeTask | null> {
  const request = await readPendingTaskRequest(context);
  return request ? lookup(context, request) : null;
}

/** Called only for an explicit recovery action; POST replays the exact original ID. */
export async function recoverPendingTaskRequest(context: TaskSubmissionContext): Promise<HomeTask | null> {
  const request = await readPendingTaskRequest(context);
  if (!request) return null;
  const existing = await lookup(context, request);
  return existing ?? dispatch(context, request);
}
