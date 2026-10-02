import type { TaskIssue, TaskProgress } from './model';

export function taskIssue(error: unknown): TaskIssue {
  const e = error as { name?: string; message?: string; status?: number; retryAfterMs?: number; kind?: TaskIssue['kind'] };
  if (e?.kind) return e as TaskIssue;
  const message = e?.message || '';
  if (e?.name === 'TimeoutError' || /\bAGY_(?:TIMEOUT|INIT_TIMEOUT|QUEUE_TIMEOUT)\b/.test(message)) return { kind: 'timeout' };
  if (e?.name === 'AbortError' || message === 'Aborted' || /\bAGY_(?:CANCELED|SESSION_CHANGED)\b/.test(message)) return { kind: 'cancelled' };
  if (e?.status === 429 || e?.retryAfterMs || /rate[_ -]?limit/i.test(message)) {
    return { kind: 'rate-limit', retryAt: Date.now() + Math.max(e?.retryAfterMs || 60000, 1000) };
  }
  if (e?.status === 401 || /token|sign in|configure.*AI|AI service|API key|AGY_(?:AUTH_REQUIRED|DISABLED|TEST_REQUIRED|PERMISSION_DENIED)/i.test(message)) return { kind: 'auth' };
  if (e?.name === 'ZodError' || e?.name === 'SyntaxError' || /source|INVALID_|identity/i.test(message)) return { kind: 'invalid' };
  if (/storage|transaction|IndexedDB/i.test(message)) return { kind: 'storage' };
  if (e?.name === 'TypeError' || /network|fetch|API error|503|502|504/i.test(message)) return { kind: 'network' };
  return { kind: 'unknown' };
}
export function issueLabel(issue: TaskIssue, zh: boolean): string {
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
  return issue.retryAt ? `${label} ${zh ? '可重试时间' : 'Retry at'}: ${new Date(issue.retryAt).toLocaleTimeString()}` : label;
}
export function progressLabel(progress: TaskProgress, zh: boolean): string {
  const labels = { search: ['检索候选', 'Searching'], readme: ['读取 README', 'Reading README'], screen: ['AI 精筛', 'AI screening'], publish: ['保存结果', 'Publishing'] };
  return `${labels[progress.phase][zh ? 0 : 1]} ${progress.current}/${progress.total}`;
}
