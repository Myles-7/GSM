import type { TaskIssue, TaskProgress } from './model';

export function taskIssue(error: unknown, source?: TaskIssue['source']): TaskIssue {
  const result = classifyIssue(error);
  const message = error instanceof Error ? error.message : '';
  const code = message.match(/\bAGY_[A-Z_]+\b/)?.[0];
  return { ...result, ...(source ? { source } : {}), ...(code ? { code } : {}) };
}
function classifyIssue(error: unknown): TaskIssue {
  const e = error as { name?: string; message?: string; status?: number; retryAfterMs?: number; kind?: TaskIssue['kind'] };
  if (e?.kind) return e as TaskIssue;
  const message = e?.message || '';
  if (e?.name === 'TimeoutError' || /\bAGY_(?:TIMEOUT|INIT_TIMEOUT|QUEUE_TIMEOUT)\b/.test(message)) return { kind: 'timeout' };
  if (e?.name === 'AbortError' || message === 'Aborted' || /\bAGY_(?:CANCELED|SESSION_CHANGED)\b/.test(message)) return { kind: 'cancelled' };
  if (e?.status === 429 || e?.retryAfterMs || /rate[_ -]?limit/i.test(message)) {
    return { kind: 'rate-limit', retryAt: Date.now() + Math.max(e?.retryAfterMs || 60000, 1000) };
  }
  if ([401, 403].includes(e?.status ?? 0) || /unauthorized|authentication failed|invalid (?:api key|token)|(?:api key|token).*(?:expired|invalid|missing)|sign[ -]?in required|configure.*AI|AGY_(?:AUTH_REQUIRED|DISABLED|TEST_REQUIRED|PERMISSION_DENIED)\b/i.test(message)) return { kind: 'auth' };
  if (/No content.*AI service|\bAGY_(?:OUTPUT_LIMIT|INVALID_REQUEST|MODEL_EFFORT_CONFLICT|SCHEMA_INVALID|INVALID_PROTOCOL)\b/i.test(message)) return { kind: 'invalid' };
  if (e?.name === 'ZodError' || e?.name === 'SyntaxError' || /source|INVALID_|identity/i.test(message)) return { kind: 'invalid' };
  if (/storage|transaction|IndexedDB/i.test(message)) return { kind: 'storage' };
  if (e?.name === 'TypeError' || /network|fetch|API error|503|502|504/i.test(message)) return { kind: 'network' };
  return { kind: 'unknown' };
}
export function issueLabel(issue: TaskIssue, zh: boolean): string {
  const actions: Record<string, [string, string]> = {
    AGY_AUTH_REQUIRED: ['请在终端重新登录 AGY，再在设置中测试连接。', 'Sign in to AGY in a terminal, then test the connection in settings.'],
    AGY_DISABLED: ['AGY 未启用，请在设置中启用。', 'AGY is disabled. Enable it in settings.'],
    AGY_TEST_REQUIRED: ['程序绑定需要重新测试，请在设置中测试连接。', 'The executable binding needs a new connection test in settings.'],
    AGY_QUOTA_EXHAUSTED: ['AGY 额度不足；更换模型或重复重试不能保证恢复，请检查 CLI 账户额度。', 'AGY quota is exhausted. Check your CLI account quota before retrying.'],
    AGY_MODEL_EFFORT_CONFLICT: ['模型与 effort 不兼容，请调整本次重试参数。', 'Model and effort are incompatible. Adjust retry parameters.'],
    AGY_CONFIG_CHANGED: ['配置版本已失效，请重新选择当前配置。', 'The configuration version is unavailable. Select the current configuration.'],
    AGY_OUTPUT_LIMIT: ['回答超出应用长度限制，请缩小资料范围后重试。', 'The answer exceeded the application output limit. Reduce the source scope.'],
    AGY_INVALID_REQUEST: ['请求参数无效，请检查模型、effort 和 20–600 秒的超时。', 'Invalid request parameters. Check model, effort and a 20–600 second timeout.'],
  };
  if (issue.code && actions[issue.code]) return `${issue.code}: ${actions[issue.code][zh ? 0 : 1]}`;
  const labels: Record<TaskIssue['kind'], [string, string]> = {
    cancelled: ['已取消，已填写内容和已完成结果已保留。', 'Cancelled. Inputs and completed results are preserved.'],
    timeout: ['请求超时，已保留完成的内容，可重试。', 'Request timed out. Completed work is preserved; retry is available.'],
    'rate-limit': ['请求受限，请稍后重试。', 'Rate limited. Please retry later.'],
    auth: ['请检查 GitHub 登录和当前 AI 配置。', 'Check your GitHub login and active AI configuration.'],
    network: ['网络请求失败，请检查连接后重试。', 'Network request failed. Check the connection and retry.'],
    invalid: ['规则或返回数据无效，请检查条件或重新解析。', 'Invalid rules or response. Check the conditions or parse again.'],
    storage: ['本地保存失败，请重试。', 'Local storage failed. Please retry.'],
    unknown: ['操作未完成，请重试。', 'The operation did not complete. Please retry.'],
  };
  const label = labels[issue.kind][zh ? 0 : 1];
  const prefix = issue.source ? `${issue.source === 'github' ? 'GitHub' : issue.source === 'ai' ? 'AI' : zh ? '本地存储' : 'Local storage'}: ` : '';
  return prefix + (issue.retryAt ? `${label} ${zh ? '可重试时间' : 'Retry at'}: ${new Date(issue.retryAt).toLocaleTimeString()}` : label);
}
export function progressLabel(progress: TaskProgress, zh: boolean): string {
  const labels = { search: ['检索候选', 'Searching'], readme: ['读取 README', 'Reading README'], screen: ['AI 精筛', 'AI screening'], publish: ['保存结果', 'Publishing'] };
  return `${labels[progress.phase][zh ? 0 : 1]} ${progress.current}/${progress.total}`;
}
