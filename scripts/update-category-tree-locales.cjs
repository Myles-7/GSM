const fs = require('node:fs');
const path = require('node:path');
const en = {
  allRepositories: 'All Repositories', unused: '{{count}} unused categories',
  create: 'New Category', createChild: 'New Subcategory', rename: 'Rename', merge: 'Merge Main Categories', withdraw: 'Withdraw Draft Change',
  actions: 'Actions for {{name}}', search: 'Search categories', addDraft: 'Add to Draft', mergeSource: 'Merge Source',
  empty: 'No categories yet. Add one manually or generate an organization draft.',
  mergeMapping: 'Retain original subgroups. The preview includes all source and target repositories, beyond page filters.',
  mapping: 'Original Subgroup Mapping', mergeImpact: '{{count}} affected repositories', redesign: 'Let AI Redesign These Subgroups', deferred: 'Deferred',
  manualAvailable: 'Manual edits do not require a model', reviewApply: 'Review and Apply', backPreview: 'Back to Preview',
  confirmTitle: 'Review Changes', confirmApply: 'Confirm Applicable Changes', eligible: '{{structures}} structure changes · {{assignments}} membership changes ready',
  deferredCount: '{{count}} changes deferred', conflictCount: '{{count}} conflicting membership changes skipped',
  confirmHint: 'Only the changes listed as applicable are written. Deferred merges remain in this draft. GitHub Lists and Stars are unchanged.',
  stale: 'The draft changed. Return to the preview and confirm the latest revision.', cleanup: 'Empty Replaced Categories', cleanupNames: 'Remove or hide empty categories: {{names}}',
  pendingSummary: '{{structures}} structure changes · {{assignments}} membership changes',
  legacyHint: 'This historical draft is shown with its original meaning. Explicitly continue into a new draft to edit it; successful writes are not repeated.', continueLegacy: 'Continue in a New Draft', legacySkipped: '{{count}} historical changes were not copied because their targets changed',
  icons: { folder: 'Folder', code: 'Development', brain: 'AI', book: 'Learning', wrench: 'Tools' },
  issues: { locked: 'Select every affected move and authorize locked repositories individually.', subgroupName: 'Subgroup names overlap. Rename a subgroup or explicitly map them to one target.', categoryName: 'The category name already exists. Choose a different name or an explicit merge.', membership: 'Affected memberships changed. Review a fresh merge preview.', structure: 'Classification structure changed. Refresh and confirm the latest draft.', targets: 'Resolve every affected repository target before completing this merge.', repository: 'Repository data changed. Review its target again.', dependency: 'Resolve the existing merge before adding a dependent merge.' },
};
const zh = {
  allRepositories: '全部仓库', unused: '未使用类别 {{count}}',
  create: '新增一级类别', createChild: '新增二级类别', rename: '改名', merge: '合并一级类别', withdraw: '撤回草案修改',
  actions: '{{name}}的分类操作', search: '搜索类别', addDraft: '加入草案', mergeSource: '合并来源',
  empty: '尚无分类，可手动新增，或让 AI 生成整理草案。',
  mergeMapping: '默认保留原二级分组。影响包含来源和目标下的全部仓库，不受页面筛选限制。',
  mapping: '原分组迁入映射', mergeImpact: '涉及 {{count}} 个仓库', redesign: '让 AI 重新设计这些二级分组', deferred: '暂缓',
  manualAvailable: '手动编辑无需模型', reviewApply: '检查并应用', backPreview: '返回预览',
  confirmTitle: '检查本次修改', confirmApply: '确认应用可执行修改', eligible: '可应用：{{structures}} 项结构修改 · {{assignments}} 项归属修改',
  deferredCount: '暂缓 {{count}} 项修改', conflictCount: '{{count}} 项归属冲突将跳过',
  confirmHint: '只应用上方可执行内容；暂缓的完整合并留在草案中，不自动拆分。不会改动 GitHub Lists 或收藏状态。',
  stale: '草案已改变，请返回预览并重新确认最新内容。', cleanup: '被替代的空分类', cleanupNames: '将删除或隐藏已空类别：{{names}}',
  pendingSummary: '待确认：{{structures}} 项结构修改 · {{assignments}} 项归属修改',
  legacyHint: '历史草案按原语义展示。明确接续后才建立新草案，已成功的操作不会再次执行。', continueLegacy: '接续为新草案', legacySkipped: '{{count}} 项历史修改的目标已变化，未复制到新草案',
  icons: { folder: '文件夹', code: '开发', brain: 'AI', book: '学习', wrench: '工具' },
  issues: { locked: '请勾选全部涉及的移动，并逐项授权锁定仓库；其他独立修改仍可先应用。', subgroupName: '二级分组重名，请改名或明确映射到同一分组后再合并。', categoryName: '类别名称已存在，请更换名称或明确选择合并。', membership: '涉及的仓库归属已改变，请重新检查合并预览。', structure: '分类结构已改变，请刷新草案并确认最新内容。', targets: '请先确定所有受影响仓库的目标，再完成整项合并。', repository: '仓库数据已改变，请重新检查目标。', dependency: '请先解决或撤回已有合并，再添加关联合并。' },
};
for (const language of fs.readdirSync('src/locales')) {
  const file = path.join('src/locales', language, 'repositories.json');
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.dualOrganization) delete data.dualOrganization.categoryManagement;
  data.categoryTree = language === 'zh' || language === 'zh-TW' ? zh : en;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
