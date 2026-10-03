import type { AITaskKind, AITaskRecord } from './aiTaskJournal';
import { taskDisplayState, taskError } from './aiTaskJournal';

const kinds: Record<AITaskKind, [string, string]> = {
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
};
export const taskPhaseLabel = (phase: string | undefined, zh: boolean) => phase ? phases[phase]?.[zh ? 0 : 1] ?? phase : (zh ? '未记录' : 'Not recorded');
export const taskTitle = (task: AITaskRecord, zh: boolean) => task.title ? `${taskKindLabel(task.kind, zh)} · ${task.title}` : taskKindLabel(task.kind, zh);
export function taskElapsed(task: AITaskRecord, at = Date.now()): string {
  if (!task.startedAt) return '—';
  const seconds = Math.max(0, Math.floor(((task.endedAt ? Date.parse(task.endedAt) : at) - Date.parse(task.startedAt)) / 1000));
  if (!Number.isFinite(seconds)) return '—';
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
export function taskReport(tasks: AITaskRecord[], format: 'json' | 'markdown', zh: boolean): string {
  // Conversation titles may be derived from the user's prompt.
  const conversations = new Set<AITaskKind>(['chat', 'research', 'organization']);
  const safe = tasks.map(task => ({ id: task.id, title: conversations.has(task.kind) ? taskKindLabel(task.kind, zh) : taskError(taskTitle(task, zh)), kind: task.kind, state: taskDisplayState(task),
    startedAt: task.startedAt, endedAt: task.endedAt, elapsed: taskElapsed(task), phase: task.phase ? taskError(taskPhaseLabel(task.phase, zh)) : undefined, config: task.config,
    error: task.error ? taskError(task.error) : undefined, parentId: task.parentId, items: task.items.map(({ label, state, error, phase }, index) => ({ label: conversations.has(task.kind) ? `${taskKindLabel(task.kind, zh)} #${index + 1}` : taskError(label), state, error: error ? taskError(error) : undefined, phase: phase ? taskError(taskPhaseLabel(phase, zh)) : undefined })) }));
  if (format === 'json') return JSON.stringify(safe, null, 2);
  return safe.map(task => `## ${task.title}\n\n${taskStateLabel(task.state, zh)} · ${task.elapsed}\n\n${task.config ? JSON.stringify(task.config) : ''}\n\n${task.error ?? ''}\n\n`
    + task.items.map(item => `- ${item.label}: ${taskStateLabel(item.state, zh)}${item.error ? ` (${item.error})` : ''}`).join('\n')).join('\n\n');
}
