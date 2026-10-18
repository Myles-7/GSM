const fs = require('node:fs');
const path = require('node:path');
const en = {
  depth: 'Evidence Depth', quick: 'Quick', deep: 'Deep', quickHint: 'Use existing analyses and metadata. No GitHub reading; uncertain results stay pending.',
  deepHint: 'Verify README evidence or reuse a current, sourced analysis. Read additional documentation only for uncertain items.',
  quickShort: 'Existing evidence · Quick', deepShort: 'README evidence · Deep', detailCount: '{{count}} detailed analyses', staleCount: '{{count}} outdated', pendingCount: '{{count}} without detailed analysis',
  concurrency: 'Task Concurrency', limit: 'Configured ceiling: {{count}}', inherit: 'Inherit · {{count}}', concurrencyHint: 'Applies to this task only. Raise the ceiling in AI settings; shared limits still apply.',
  reused: '{{count}} reused', cached: 'Reused', stale: 'Outdated Evidence', staleEvidence: 'Analysis from {{date}} does not match the current repository version.', existingAnalysis: 'Existing Analysis',
  active: '{{running}} model running · {{queued}} model queued · {{reading}} reading', effective: 'Effective concurrency {{count}} / {{limit}}', attempts: '{{count}} dispatched attempts',
  eta: 'Current stage: about {{count}} min remaining', globalPool: 'AGY global: {{running}} running · {{queued}} queued · {{limit}} capacity',
  onlyProblems: 'Needs Attention', understandingCoverage: 'Repository Understanding Coverage', deepenAll: 'Deep Review Entire Scope', deepenSelected: 'Deep Review {{count}} Selected', deepenOne: 'Deep Review This Repository', moreRows: 'Show {{count}} More',
  activity: { reading: 'Reading README', queued: 'Waiting for Model', understanding: 'Understanding' },
  deepenUnresolved: 'Deep Review {{count}} Visible Unresolved',
};
const zh = {
  depth: '资料深度', quick: '快速', deep: '深度', quickHint: '使用已有分析与仓库资料，不读取 GitHub；资料不足项保持待确认。',
  deepHint: '逐仓核对 README，可复用当前版本的可靠分析；疑难项再补充文档。',
  quickShort: '已有资料 · 快速整理', deepShort: 'README 取证 · 深度整理', detailCount: '详细分析 {{count}}', staleCount: '过期 {{count}}', pendingCount: '无详细分析 {{count}}',
  concurrency: '本次并发', limit: '配置上限：{{count}}', inherit: '继承配置 · {{count}}', concurrencyHint: '仅影响本次任务；提高上限请修改 AI 设置，仍受共享限额约束。',
  reused: '复用 {{count}}', cached: '已复用', stale: '过期资料', staleEvidence: '使用 {{date}} 的分析，与仓库当前版本不匹配。', existingAnalysis: '已有分析',
  active: '模型运行 {{running}} · 模型等待 {{queued}} · 读取 {{reading}}', effective: '有效并发 {{count}} / {{limit}}', attempts: '已派发 {{count}} 次尝试',
  eta: '当前阶段预计剩余约 {{count}} 分钟', globalPool: 'AGY 全局：运行 {{running}} · 等待 {{queued}} · 有效上限 {{limit}}',
  onlyProblems: '只看待处理问题', understandingCoverage: '仓库理解覆盖率', deepenAll: '全范围深度核实', deepenSelected: '深度核实选中 {{count}} 项', deepenOne: '深度核实此仓库', moreRows: '显示其余 {{count}} 项',
  activity: { reading: '读取 README', queued: '等待模型', understanding: '理解中' },
  deepenUnresolved: '深度核实可见待确认 {{count}} 项',
};
for (const language of fs.readdirSync('src/locales')) {
  const file = path.join('src/locales', language, 'repositories.json');
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.organizationSpeed = language === 'zh' || language === 'zh-TW' ? zh : en;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
