const fs = require('node:fs');
const path = require('node:path');
const en = {
  setupTitle: 'Organize Your Library', instructionPlaceholder: 'Group by actual uses and technical domains. Prefer a few clear categories; create subgroups only where they are useful.',
  unavailable: 'Unavailable', modelStatus: 'Model Connection', modelReady: 'AGY Ready', modelNotReady: 'AGY Not Ready', detect: 'Detect', test: 'Test Connection', enable: 'Enable AGY',
  readinessHint: 'Detect and test your local AGY connection, then enable it explicitly.', desktopRequired: 'AGY requires the desktop app.', paused: 'Paused: Model Connection Needs Attention', checkpointHint: 'Completed results are saved. Fix the connection and resume; nothing is applied automatically.',
  pendingCount: '{{count}} pending', uncertainCount: '{{count}} need evidence', recentRepositories: 'Recent Repositories', resume: 'Retry Unresolved / Resume',
  adjustLocal: 'Adjust Selected Scheme', localAdjustmentPlaceholder: 'For example: combine AI writing and chat into AI applications; keep other categories unchanged.',
  cleanupToggle: 'Clean up replaced empty categories', cleanupCount: '{{count}} old categories to clean up', cleanupHint: 'Only empty replaced categories are removed or hidden. Categories still used by unresolved or unselected repositories stay. GitHub Lists are unchanged.',
  search: 'Search repositories or uses', selectedCount: '{{count}} selected', matchingCount: '{{count}} matching repositories', previous: 'Previous Page', next: 'Next Page',
  repositoryDetail: 'Repository Classification Details', back: 'Back', closeDetail: 'Close Details', currentLocation: 'Current Location', keepLocation: 'Keep Original Location',
  history: 'Previous Organization Draft', backToWizard: 'Back to Organization',
  sources: { analysis: 'Verified Analysis', document: 'Repository Documentation' },
  categoryPreview: 'Classification Preview', treeCount: '{{main}} main categories · {{sub}} subcategories', changeTargets: 'Change Targets',
  readmeQuality: 'README evidence · Quality first', unknown: 'Unknown',
  regenerate: 'Redesign Both Schemes', regenerateWarning: 'Regenerate both schemes for {{count}} repositories. Manual decisions and verified evidence are retained; this may make additional model requests. Live classifications are not changed.', confirmRegenerate: 'Confirm Redesign', cancel: 'Cancel',
  problems: { disabled: 'AGY is disabled. Detect, test and enable it above before resuming.', desktop: 'Open the desktop app to use AGY.', missing: 'Choose a configured model.', auth: 'Authentication failed. Check the model or GitHub credentials.', configuration: 'Model configuration is invalid. Check the model and endpoint.', connection: 'The connection failed after retries. Completed results are retained.', other: 'The model is not ready. Check its connection and configuration.' },
};
const zh = {
  setupTitle: '整理你的仓库', instructionPlaceholder: '按实际用途和技术方向整理，分类少而清晰；二级类别只在确有不同方向时建立。',
  unavailable: '暂不可用', modelStatus: '模型连接', modelReady: 'AGY 已就绪', modelNotReady: 'AGY 尚未就绪', detect: '检测', test: '测试连接', enable: '启用 AGY',
  readinessHint: '先检测并测试本机 AGY，测试通过后由你明确启用。', desktopRequired: 'AGY 需要在桌面端使用。', paused: '整理已暂停，需要修复模型连接', checkpointHint: '已完成结果保留；修复后继续原任务，不会自动应用分类。',
  pendingCount: '待处理 {{count}}', uncertainCount: '资料不足 {{count}}', recentRepositories: '最近处理的仓库', resume: '重试未解决项 / 继续',
  adjustLocal: '调整当前方案', localAdjustmentPlaceholder: '例如：把 AI 写作和 AI 聊天合成 AI 应用，其他不要动。',
  cleanupToggle: '清理被替代且已空的旧类别', cleanupCount: '将清理 {{count}} 个旧类别', cleanupHint: '只删除或隐藏已移空的旧类别；疑难项或未勾选仓库仍在使用的类别保留，不改动 GitHub Lists。',
  search: '搜索仓库或用途', selectedCount: '已选 {{count}} 项', matchingCount: '{{count}} 个匹配仓库', previous: '上一页', next: '下一页',
  repositoryDetail: '仓库归类详情', back: '返回', closeDetail: '关闭详情', currentLocation: '原位置', keepLocation: '保持原位置',
  history: '历史整理草案', backToWizard: '返回仓库整理',
  sources: { analysis: '已核实分析', document: '项目文档' },
  categoryPreview: '分类预览', treeCount: '{{main}} 个一级类别 · {{sub}} 个二级类别', changeTargets: '批量改目标',
  readmeQuality: 'README 取证 · 质量优先', unknown: '未知',
  regenerate: '重新设计两套方案', regenerateWarning: '重新生成 {{count}} 个仓库的两套草案；保留人工确定项及可复用证据，可能产生额外模型请求，不直接修改实际分类。', confirmRegenerate: '确认重新生成', cancel: '取消',
  problems: { disabled: 'AGY 尚未启用。请先在上方检测、测试并启用，再继续原任务。', desktop: '请在桌面端使用 AGY。', missing: '请选择已配置的模型。', auth: '鉴权失败，请检查模型或 GitHub 的凭据。', configuration: '模型配置无效，请检查模型名称和服务地址。', connection: '连接重试后仍失败，已完成结果已保留。', other: '模型尚未就绪，请检查连接和配置。' },
};
for (const language of fs.readdirSync('src/locales')) {
  const file = path.join('src/locales', language, 'repositories.json');
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.organizationUx = language === 'zh' || language === 'zh-TW' ? zh : en;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
