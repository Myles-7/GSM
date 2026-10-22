import type { AITaskKind, AITaskRecord, CommitStatus, ProviderOutcome } from './aiTaskJournal';
import { taskDisplayState, taskError, taskIsTerminal } from './aiTaskJournal';

const kinds: Record<AITaskKind, [string, string]> = {
  exploration: ['项目地图探索', 'Project exploration'],
  summary: ['仓库摘要', 'Repository summaries'], details: ['仓库详情分析', 'Repository analysis'],
  gists: ['Gist 摘要', 'Gist summaries'], discovery: ['订阅检索', 'Subscription retrieval'],
  'discovery-analysis': ['订阅项目分析', 'Subscription project analysis'], plugins: ['插件任务', 'Plugin task'],
  organization: ['分类整理', 'Organization'], release: ['Release 摘要', 'Release summary'], search: ['AI 搜索', 'AI search'],
  chat: ['仓库问答', 'Repository chat'], research: ['工作台研究', 'Workbench research'], index: ['向量索引', 'Vector indexing'],
  refresh: ['数据刷新', 'Data refresh'], sync: ['数据同步', 'Data sync'], import: ['数据导入', 'Import'],
  export: ['数据导出', 'Export'], backup: ['数据备份', 'Backup'], restore: ['备份恢复', 'Restore'],
};
const states: Record<string, [string, string]> = {
  queued: ['排队中', 'Queued'], pending: ['待执行', 'Pending'], running: ['进行中', 'Running'],
  pausing: ['暂停中', 'Pausing'], paused: ['已暂停', 'Paused'], stopping: ['停止中', 'Stopping'],
  canceled: ['已取消', 'Canceled'], complete: ['已完成', 'Complete'], partial: ['部分完成', 'Partially complete'],
  failed: ['失败', 'Failed'], interrupted: ['已中断', 'Interrupted'], unconfirmed: ['提交待确认', 'Awaiting confirmation'],
  committing: ['正在提交', 'Committing'],
};
export const taskKindLabel = (kind: AITaskKind, zh: boolean) => kinds[kind][zh ? 0 : 1];
export const taskStateLabel = (state: string, zh: boolean) => states[state]?.[zh ? 0 : 1] ?? state;
const providerOutcomes: Record<ProviderOutcome, [string, string]> = {
  not_started: ['未调用', 'Not started'], in_flight: ['请求中', 'In progress'],
  succeeded: ['已成功', 'Succeeded'], failed: ['失败', 'Failed'], unknown: ['结果待核对', 'Outcome unknown'],
};
const commitStatuses: Record<CommitStatus, [string, string]> = {
  not_started: ['未保存', 'Not saved'], pending: ['等待保存', 'Pending save'],
  saved: ['已保存', 'Saved'], conflict: ['保存冲突', 'Save conflict'], failed: ['保存失败', 'Save failed'],
};
export const taskProviderOutcomeLabel = (outcome: ProviderOutcome, zh: boolean) => providerOutcomes[outcome][zh ? 0 : 1];
export const taskCommitStatusLabel = (status: CommitStatus | undefined, zh: boolean) => commitStatuses[status ?? 'not_started'][zh ? 0 : 1];
export const taskFailureLabel = (error: string, zh: boolean): string => {
  const codes: Record<string, [string, string]> = {
    AGY_TIMEOUT: ['模型响应超时，结果待核对', 'Model response timed out; outcome unknown'],
    AGY_RECOVERY_STORAGE_FULL: ['本机恢复区额度不足，请先在任务中心保存待处理结果；已有模型结果仍保留。', 'Recovery storage quota reached. Save pending results in Task Center; existing model results are retained.'],
    AGY_SERVICE_UNAVAILABLE: ['模型服务暂不可用或容量不足，请稍后手动继续；已发送请求的结果与用量待核对。', 'Model service unavailable or at capacity. Continue manually later; sent requests may have an unknown outcome or cost.'],
    AGY_RESOURCE_DEFERRED: ['执行资源繁忙，请稍后继续；本次请求未发送。', 'Execution capacity busy. Continue later; this request was not sent.'],
  };
  const parts = [...new Set(error.split(/[;；]\s*/))];
  return parts.map(part => codes[part]?.[zh ? 0 : 1] ?? part).join(zh ? '；' : '; ');
};
const phases: Record<string, [string, string]> = {
  search: ['检索', 'Searching'], readme: ['读取 README', 'Reading README'], reading: ['读取资料', 'Reading sources'],
  generating: ['生成回答', 'Generating answer'], generation: ['生成回答', 'Generating answer'],
  verification: ['复核回答', 'Reviewing answer'], reviewing: ['复核回答', 'Reviewing answer'],
  planning: ['规划研究', 'Planning research'], queued: ['等待执行', 'Queued'],
  publish: ['保存订阅结果', 'Saving subscription results'], screening: ['筛选候选项目', 'Screening candidates'],
  assessment: ['评估候选项目', 'Assessing candidates'], analyzing: ['分析项目', 'Analyzing projects'],
  embedding: ['生成向量', 'Generating embeddings'], indexing: ['构建索引', 'Building index'],
  committing: ['提交结果', 'Committing results'], collecting: ['收集证据', 'Collecting evidence'],
  retrieval: ['检索证据', 'Retrieving evidence'], evidence: ['收集证据', 'Collecting evidence'],
  answer: ['生成回答', 'Generating answer'], model: ['模型推理', 'Model inference'],
  requirements: ['整理需求', 'Preparing requirements'], overview: ['整理项目概览', 'Preparing project overview'],
  execution: ['执行整理', 'Applying organization'], restore: ['恢复资料', 'Restoring data'],
  saving: ['保存结果', 'Saving results'], completed: ['已完成', 'Complete'], resume: ['恢复任务', 'Resuming task'],
  queue_wait: ['等待执行槽位', 'Waiting for execution slot'], initializing: ['初始化执行器', 'Initializing executor'], cleanup: ['清理执行器', 'Cleaning up executor'], reconciling: ['核对远端状态', 'Reconciling remote state'],
};
export const taskPhaseLabel = (phase: string | undefined, zh: boolean) => phase ? phases[phase]?.[zh ? 0 : 1] ?? phase : (zh ? '未记录' : 'Not recorded');
export const taskExecutorLabel = (executor: AITaskRecord['executor'], zh: boolean) => executor === 'server-provider' ? (zh ? 'Server · Provider' : 'Server · Provider') : executor === 'agy-device' ? 'AGY · Device' : (zh ? '本机／同步任务' : 'Device / sync task');
export const taskOutcomeLabel = (task: AITaskRecord, zh: boolean) => {
  const timeouts = task.items.filter(item => /\bAGY_TIMEOUT\b/.test(item.error ?? '')).length;
  if (timeouts && !taskIsTerminal(task)) return zh ? `${taskStateLabel(task.state, zh)} · ${timeouts} 个子项超时` : `${taskStateLabel(task.state, zh)} · ${timeouts} item(s) timed out`;
  return task.commitStatus === 'conflict'
  ? (zh ? '分析完成，保存冲突' : 'Analysis complete; save conflict')
  : task.providerOutcome === 'unknown' ? (zh ? `${task.items.length > 1 ? '部分子项' : ''}模型结果未知` : `${task.items.length > 1 ? 'Some item' : 'Provider'} result unknown`)
    : task.state === 'interrupted' && task.items.some(item => item.state === 'complete')
      ? (zh ? '部分已完成，其余待处理' : 'Partially complete; remaining items pending') : taskStateLabel(taskDisplayState(task), zh);
};
export const taskTitle = (task: AITaskRecord, zh: boolean) => {
  const label = taskKindLabel(task.kind, zh);
  const title = task.title?.trim() ?? '';
  const prefix = kinds[task.kind].find(value => title === value || title.startsWith(`${value} · `));
  const detail = prefix ? title.slice(prefix.length).replace(/^ · /, '').trim() : title;
  return detail ? `${label} · ${detail}` : label;
};
export const taskTimerEnd = (task: AITaskRecord) => task.endedAt ?? (taskIsTerminal(task) ? task.updatedAt : undefined);
export function taskElapsed(task: AITaskRecord, at = Date.now()): string {
  if (!task.startedAt) return '—';
  const end = taskTimerEnd(task);
  const seconds = Math.max(0, Math.floor(((end ? Date.parse(end) : at) - Date.parse(task.startedAt)) / 1000));
  if (!Number.isFinite(seconds)) return '—';
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
export function taskReport(tasks: AITaskRecord[], format: 'json' | 'markdown', zh: boolean): string {
  // Conversation titles may be derived from the user's prompt.
  const conversations = new Set<AITaskKind>(['chat', 'research', 'organization']);
  const safe = tasks.map(task => ({ id: task.id, title: conversations.has(task.kind) ? taskKindLabel(task.kind, zh) : taskError(taskTitle(task, zh)), kind: task.kind, state: taskDisplayState(task),
    startedAt: task.startedAt, endedAt: task.endedAt, elapsed: taskElapsed(task), phase: task.phase ? taskError(taskPhaseLabel(task.phase, zh)) : undefined, executor: taskExecutorLabel(task.executor, zh), commitStatus: task.commitStatus, providerOutcome: task.providerOutcome, failureCode: task.failureCode, config: task.config,
    error: task.error ? taskError(task.error) : undefined, parentId: task.parentId, items: task.items.map(({ label, state, error, phase }, index) => ({ label: conversations.has(task.kind) ? `${taskKindLabel(task.kind, zh)} #${index + 1}` : taskError(label), state, error: error ? taskError(error) : undefined, phase: phase ? taskError(taskPhaseLabel(phase, zh)) : undefined })) }));
  if (format === 'json') return JSON.stringify(safe, null, 2);
  return safe.map(task => `## ${task.title}\n\n${taskStateLabel(task.state, zh)} · ${task.elapsed}\n\n${task.config ? JSON.stringify(task.config) : ''}\n\n${task.error ?? ''}\n\n`
    + task.items.map(item => `- ${item.label}: ${taskStateLabel(item.state, zh)}${item.error ? ` (${item.error})` : ''}`).join('\n')).join('\n\n');
}
