import { isAIToolCallUnsupportedError, supportsChatToolCalls } from './aiService';
import {
  runEvidenceDrivenRepositoryChatTurn,
  runModelRepositoryChatTurn,
  resolveTurnLimits,
  type RepositoryChatTurnInput,
  type RepositoryChatTurnResult,
} from './repositoryChatService';
import { runToolLoopRepositoryChatTurn } from './agentToolLoop';
import { isAgyConfig } from '../utils/aiConfig';
import { withDeadline } from '../utils/requestDeadline';
import { bindFileCacheIdentity } from './pinnedFileCache';
import { runTrackedTask } from './taskExecution';

/**
 * 仓库问答的执行入口：按设置与 AI 配置能力在两个执行循环间分派。
 * 独立成模块以保持依赖单向——repositoryChatService（编排式循环与共享
 * 取证底座）与 agentToolLoop（受控工具循环）互不引用。
 */

/** 后端代理通道不保留 AIToolCallUnsupportedError 类型：以 4xx 配置类状态码兜底识别端点拒绝。 */
const isEndpointRejectionError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const carrier = error as { status?: unknown; statusCode?: unknown };
  const status = carrier.status ?? carrier.statusCode;
  return status === 400 || status === 404 || status === 422;
};

const dispatchTurn = async (input: RepositoryChatTurnInput): Promise<RepositoryChatTurnResult> => {
  if (isAgyConfig(input.aiConfig) && input.aiConfig.agyMode === 'model') return runModelRepositoryChatTurn(input);
  // 受控工具循环（实验性）：仅在设置开启、AI 配置协议族支持且用户显式勾选
  // “支持工具调用”时启用；端点不支持工具调用时本轮自动落回编排式循环。
  if (!input.localSource && input.enableAgentToolLoop && supportsChatToolCalls(input.aiConfig)) {
    try {
      return await runToolLoopRepositoryChatTurn(input);
    } catch (error) {
      if (input.signal?.aborted) throw error;
      if (!isAIToolCallUnsupportedError(error) && !isEndpointRejectionError(error)) throw error;
    }
  }
  return await runEvidenceDrivenRepositoryChatTurn(input);
};

export const runRepositoryChatTurn = async (input: RepositoryChatTurnInput): Promise<RepositoryChatTurnResult> => {
  bindFileCacheIdentity(JSON.stringify([input.session.ownerId, input.githubToken]));
  const startedAt = Date.now();
  const deadlineAt = Math.min(input.deadlineAt ?? Infinity, startedAt + resolveTurnLimits(input).budget.maxDurationMs);
  const duration = Math.max(0, deadlineAt - startedAt);
  return runTrackedTask({ owner: input.session.ownerId ?? '', kind: 'chat', label: input.repository.full_name,
    signal: input.signal, config: input.aiConfig, metadata: { title: input.repository.full_name,
      target: { view: 'repositories', id: input.session.id } } }, (taskSignal, task) => withDeadline(signal => dispatchTurn({
    ...input, signal, deadlineAt,
    retrievalDeadlineAt: Math.min(input.retrievalDeadlineAt ?? Infinity, input.evidenceOnly ? deadlineAt : startedAt + duration * 0.6),
    onAnswerChunk: input.onAnswerChunk ? text => { if (!signal.aborted) input.onAnswerChunk?.(text); } : undefined,
    onAnswerEvent: input.onAnswerEvent ? event => { if (!signal.aborted) input.onAnswerEvent?.(event); } : undefined,
    onToolEvent: event => { if (!signal.aborted) { task.metadata({ phase: event.stage }); input.onToolEvent?.(event); } },
  }), duration, taskSignal));
};
