const configurationCodes = new Set(['DISABLED', 'AUTH_REQUIRED', 'PERMISSION_DENIED', 'QUOTA_EXHAUSTED', 'BUDGET_LIMIT',
  'MODEL_EFFORT_CONFLICT', 'TEST_REQUIRED', 'NOT_FOUND', 'INVALID_MODEL', 'INVALID_EFFORT', 'EXECUTABLE_CHANGED',
  'CONFIG_CHANGED', 'SESSION_CHANGED', 'RECOVERY_CONTEXT_LIMIT', 'RECOVERY_STORAGE_FULL', 'RECOVERY_RECORD_CORRUPT', 'RECOVERY_ENCRYPTION_UNAVAILABLE', 'RECOVERY_WRITE_FAILED']);
export function describeAgyRecoveryError(message: string): string {
  const parts = [...new Set(message.split(/[;；]/).map(part => part.trim()).filter(Boolean))];
  if (parts.every(part => /^AGY_[A-Z_]+$/.test(part)) && (parts.length > 1 || parts.length === 1 && parts[0] !== message)) return [...new Set(parts.map(describeAgyRecoveryError))].join('\n');
  if (message === 'AGY_DISABLED') return 'AGY CLI 当前未启用，尚不能建立项目地图。请前往 AI 设置，完成“保存并测试”，再点击“启用并设为当前”；如果重新选择或更新了 CLI，需要重新测试。（AGY_DISABLED）';
  if (message === 'AGY_NOT_FOUND') return '当前 AGY 配置尚未绑定本机可执行程序，请前往 AI 设置检测或选择 AGY CLI。（AGY_NOT_FOUND）';
  if (message === 'AGY_DESKTOP_REQUIRED') return '当前页面没有 GSM 桌面 AGY 接口。请在桌面客户端使用 AGY CLI，或选择已配置的 HTTP 模型。（AGY_DESKTOP_REQUIRED）';
  if (message === 'AGY_TEST_REQUIRED') return '当前 AGY 程序或模型配置尚未通过连接测试，请前往 AI 设置执行“保存并测试”，通过后再启用。（AGY_TEST_REQUIRED）';
  if (message === 'AGY_SERVICE_UNAVAILABLE') return 'AGY 模型服务暂不可用或容量不足（如 503），不代表 CLI 未安装或登录失效。请稍后手动重试，或在设置中自行选择其他可用模型／思考强度。已发送请求的结果与计费可能未知，GSM 不会自动重发或切换模型。（AGY_SERVICE_UNAVAILABLE）';
  if (message === 'AGY_TIMEOUT') return 'AGY 已发送请求，但当前模型未在设定时间内完成。已完成的批次仍保留，可手动重试；请检查 AGY 模型服务状态，或在设置中自行选择更快的模型／较低思考强度。结果未知的调用不会自动重发。（AGY_TIMEOUT）';
  if (message === 'AGY_INIT_TIMEOUT') return 'AGY 独立进程初始化超时，尚未发送模型请求。请检查 CLI 启动和网络连接，然后手动重试。（AGY_INIT_TIMEOUT）';
  if (message === 'AGY_PROCESS_FAILED') return 'AGY 模型进程异常退出。其他成功批次已保留；请到 AI 任务中心核对该批次的请求记录。若结果不明，再次调用可能产生重复用量。（AGY_PROCESS_FAILED）';
  if (!message.includes('AGY_RECOVERY_STORAGE_FULL')) return message;
  return 'AGY 调用恢复区额度已满，本次任务已停止。请在 AI 任务中心处理待保存结果；若此前程序中断，请先保存其他工作并重启 GSM，以释放遗留调用的失效预留空间。不会自动删除结果或重新发送调用。（AGY_RECOVERY_STORAGE_FULL）';
}
export function classifyAgyError(error: unknown): 'configuration' | 'deferred' | 'unknown' | 'request' {
  const message = error instanceof Error ? error.message : String(error);
  const code = /^AGY_([A-Z_]+)(?:$|:)/.exec(message)?.[1] ?? (error as { code?: string })?.code;
  if (code && configurationCodes.has(code)) return 'configuration';
  if (code && ['RESOURCE_DEFERRED', 'BUSY', 'QUEUE_TIMEOUT'].includes(code)) return 'deferred';
  if (code && ['UNKNOWN_PROVIDER_OUTCOME', 'unknown_provider_outcome'].includes(code)) return 'unknown';
  return 'request';
}
