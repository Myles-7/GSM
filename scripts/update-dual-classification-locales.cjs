const fs = require('node:fs');
const path = require('node:path');
const en = {
  steps: 'Organization steps', step1: 'Set Up', step2: 'Understand & Generate', step3: 'Review & Apply',
  library: 'Selected Library', repositories: 'repositories', purpose: 'Purpose & Use Cases', technology: 'Technical Domains & Stacks', purposeShort: 'Purpose', technologyShort: 'Technology',
  purposeScope: 'Application domains / concrete use cases', technologyScope: 'Technical domains / frameworks and infrastructure',
  advanced: 'Scope & Model', categoryManagement: 'Category Management', defaultInstruction: 'Understand every repository and design two independent classifications: purpose/use cases and technical domains/stacks. Reuse suitable existing categories. Leave uncertain items for review.',
  start: 'Understand & Generate', scheme: 'Classification scheme', applyScheme: 'Apply this scheme', coverage: 'Processed {{count}} / {{total}}', understood: 'Understood {{count}}', failed: 'Failed {{count}}',
  phase: { understanding: 'Understanding Repositories', structure: 'Designing Two Classification Trees', assignments: 'Verifying Memberships', review: 'Review Ready' },
  state: { pending: 'Pending', understood: 'Understood', insufficient: 'Insufficient evidence', 'read-failed': 'Read failed', failed: 'Failed' },
  filter: { all: 'All', move: 'Will Change', unchanged: 'Unchanged', insufficient: 'Needs Review', failed: 'Failed' },
  outcome: { complete: 'Draft complete', partial: 'Partially complete; review unresolved items', empty: 'No valid suggestions; review errors', unchanged: 'No changes needed' },
  previewCount: '{{categories}} main · {{groups}} subcategories · {{count}} repositories', all: 'All Suggestions', emptyStructure: 'No valid classification tree', noResults: 'No matching repositories',
  selectVisible: 'Select visible changes', bulkMain: 'Batch main target', bulkSub: 'Batch subgroup target', bulkApply: 'Set Selected Targets', evidence: 'Reason & Sources', needsEvidence: 'Insufficient evidence; original location retained', metadata: 'Repository facts',
  enrich: 'Read README & Retry', stageErrors: '{{count}} stage errors', refine: 'Adjust Draft', retryFailed: 'Retry Failed / Resume', apply: 'Confirm {{count}} Membership Changes', expand: 'Expand {{name}}', collapse: 'Collapse {{name}}',
};
const zh = {
  steps: '整理步骤', step1: '设置整理', step2: '理解与生成', step3: '检查并应用',
  library: '本次整理范围', repositories: '个仓库', purpose: '用途与使用场景', technology: '技术领域与技术栈', purposeShort: '用途', technologyShort: '技术',
  purposeScope: '应用领域 / 具体使用场景', technologyScope: '技术领域 / 框架与基础设施',
  advanced: '范围与模型', categoryManagement: '分类管理', defaultInstruction: '理解每个仓库，分别设计用途与使用场景、技术领域与技术栈两套独立分类。优先复用合理的已有分类；资料不足的项目保留待确认。',
  start: '开始理解并生成', scheme: '分类方案', applyScheme: '应用此方案', coverage: '已处理 {{count}} / {{total}}', understood: '已理解 {{count}}', failed: '失败 {{count}}',
  phase: { understanding: '逐仓理解', structure: '设计两套分类结构', assignments: '核实仓库归属', review: '待检查与确认' },
  state: { pending: '待处理', understood: '已理解', insufficient: '资料不足', 'read-failed': '读取失败', failed: '失败' },
  filter: { all: '全部', move: '将改变', unchanged: '保持不变', insufficient: '待确认', failed: '失败' },
  outcome: { complete: '草案已完成', partial: '部分完成，未解决项需确认', empty: '未生成有效建议，请检查错误', unchanged: '无需调整' },
  previewCount: '{{categories}} 个一级 · {{groups}} 个二级 · {{count}} 个仓库', all: '全部建议', emptyStructure: '未生成有效分类结构', noResults: '没有符合筛选的仓库',
  selectVisible: '选择可见变更', bulkMain: '批量一级目标', bulkSub: '批量二级目标', bulkApply: '修改选中目标', evidence: '理由与来源', needsEvidence: '资料不足，保留原位置', metadata: '仓库事实',
  enrich: '读取 README 后重试', stageErrors: '{{count}} 个阶段错误', refine: '调整草案', retryFailed: '仅重试失败项 / 续跑', apply: '确认应用 {{count}} 项归属变更', expand: '展开 {{name}}', collapse: '收起 {{name}}',
};
Object.assign(en, { structureReady: 'Tree ready', structurePending: 'Tree pending', assignments: 'Verified {{count}} / {{total}}', retireTitle: 'Replaced categories ({{count}})', retireWarning: 'Retain by default. Explicitly select empty sources to remove custom categories or retire builtins. All affected repositories must be resolved and selected; locked moves need individual authorization. Remote Lists remain unchanged.', applyStructure: 'Confirm {{count}} Moves & {{categories}} Category Retirements' });
Object.assign(zh, { structureReady: '结构已生成', structurePending: '结构待生成', assignments: '归属已核实 {{count}} / {{total}}', retireTitle: '被替代的旧分类（{{count}}）', retireWarning: '默认保留。勾选后，移空的自建分类删除，内置分类隐藏并退役。所有相关仓库必须解决并选中，跨一级的锁定项逐项授权；不更改远端 Lists。', applyStructure: '确认 {{count}} 项移动及 {{categories}} 项分类退役' });
for (const language of fs.readdirSync('src/locales')) {
  const file = path.join('src/locales', language, 'repositories.json');
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.aiOrganization.targetMain = language === 'zh' || language === 'zh-TW' ? '目标一级类别' : 'Main target';
  data.aiOrganization.targetSub = language === 'zh' || language === 'zh-TW' ? '目标二级类别' : 'Subgroup target';
  data.aiOrganization.select = data.aiOrganization.selectRepository;
  data.dualOrganization = language === 'zh' || language === 'zh-TW' ? zh : en;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
