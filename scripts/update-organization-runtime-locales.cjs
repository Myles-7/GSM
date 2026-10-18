const fs = require('node:fs');
const path = require('node:path');
const en = {
  title: 'Request Monitor', noRequests: 'No request in this run yet.', prepare: 'Prepare Library', coverage: 'Source coverage {{count}} / {{total}}',
  assignmentCounts: 'Verified {{verified}} / {{total}} · Failed {{failed}} · Pending {{pending}} · Uncertain {{uncertain}}',
  stage: { understanding: 'Understand', summary: 'Summarize', structure: 'Design Categories', assignments: 'Verify Membership', profile: 'Model Compatibility' },
  state: { queued: 'Queued', initializing: 'Initializing', running: 'Generating', cleanup: 'Cleaning Up', received: 'Validating', verified: 'Validated', failed: 'Failed', canceled: 'Stopped' },
  requestInfo: 'Attempt {{attempt}} · {{count}} repositories · {{chars}} input characters', lastOutput: 'Last output {{seconds}}s ago', waitingOutput: 'Waiting for public output',
  publicOutput: 'Public Output · Not Yet Applied', copy: 'Copy Redacted Diagnostics', retryBatch: 'Retry This Batch', recentOnly: 'Showing the most recent 100 requests', blocked: 'Pause Details',
  timing: 'Queue {{queue}}s · Init {{init}}s · Generate {{model}}s · Cleanup {{cleanup}}s', pending: 'Awaiting Verification',
};
const zh = {
  title: '请求明细', noRequests: '本轮尚未派发模型请求。', prepare: '准备全库资料', coverage: '资料覆盖 {{count}} / {{total}}',
  assignmentCounts: '已核实 {{verified}} / {{total}} · 失败 {{failed}} · 待处理 {{pending}} · 待确认 {{uncertain}}',
  stage: { understanding: '理解资料', summary: '汇总资料', structure: '设计分类', assignments: '核实归属', profile: '模型兼容验证' },
  state: { queued: '排队中', initializing: '初始化', running: '生成中', cleanup: '清理中', received: '校验中', verified: '已校验', failed: '失败', canceled: '已停止' },
  requestInfo: '第 {{attempt}} 次尝试 · {{count}} 个仓库 · 输入 {{chars}} 字符', lastOutput: '最近输出：{{seconds}} 秒前', waitingOutput: '等待公开输出',
  publicOutput: '公开输出 · 尚未应用', copy: '复制脱敏诊断', retryBatch: '重试此批', recentOnly: '仅显示最近 100 次请求', blocked: '暂停详情',
  timing: '排队 {{queue}} 秒 · 初始化 {{init}} 秒 · 生成 {{model}} 秒 · 清理 {{cleanup}} 秒', pending: '等待核实',
};
for (const language of fs.readdirSync('src/locales')) {
  const file = path.join('src/locales', language, 'repositories.json');
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, 'utf8')); const chinese = language.startsWith('zh');
  data.organizationRuntime = chinese ? zh : en;
  data.organizationRecovery = chinese ? {
    quarantined: 'AGY 执行器已隔离', recover: '恢复执行器',
    hint: '已停止派发。先恢复执行器，再主动继续原任务；恢复会确认本应用的进程已退出，不调用模型。仍失败时请正常退出桌面端后重启。',
    pending: '仍有本应用的进程未确认关闭，不能解除隔离。请等待清理，或正常退出桌面端后重启。',
    summary: '资料汇总：已处理 {{done}}/{{total}} 批 · 成功 {{success}} · 原资料回退 {{fallback}}', originalError: '最初触发错误：{{code}}',
  } : {
    quarantined: 'AGY Executor Quarantined', recover: 'Recover Executor',
    hint: 'Dispatch stopped. Recover the executor before manually resuming. Recovery confirms this app\'s processes have closed without calling the model. If recovery fails, exit and restart the desktop.',
    pending: 'An app-owned process has not confirmed closure. Isolation remains active. Wait for cleanup or exit and restart the desktop.',
    summary: 'Summaries: processed {{done}}/{{total}} · Successful {{success}} · Original-data fallback {{fallback}}', originalError: 'Original failure: {{code}}',
  };
  Object.assign(data.organizationUx.problems, chinese ? {
    io: '本地执行发生 I/O 错误，查看请求明细中的具体操作与错误码。', cleanup: '进程清理未确认，执行器已隔离。先恢复执行器，再主动继续；已保存结果保留。', other: '任务发生错误，查看具体错误码和请求明细。',
  } : { io: 'Local inference I/O error. Check the operation and code in request details.', cleanup: 'Process cleanup unconfirmed. Recover the quarantined executor before manually resuming; saved results are retained.', other: 'Task error. Check the error code and request details.' });
  data.organizationSpeed.quickHint = chinese ? '先用全库资料生成轻量草案；疑难项限量补充 README，仍不确定时保留原位置。' : 'Build a lightweight draft from the full library; read limited README evidence for uncertain items and otherwise retain original membership.';
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
