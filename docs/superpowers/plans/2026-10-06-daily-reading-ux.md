# 每日阅读统一项目处理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans task-by-task. Preserve the existing working tree; do not commit unrelated changes.

**Goal:** 导入后在一个双栏页面浏览所有项目，并通过明确选择批量管理阅读状态、待处理状态和 GitHub Star。

**Architecture:** 复用现有回传校验、分析资产投影、IndexedDB 事务和持久 Star 批次。桌面处理信息独立于严格 v1/v2 回传格式；新增每日阅读视图与分组配置，旧设置入口仍可访问。

**Tech Stack:** React、TypeScript、Zustand、IndexedDB、Vitest、Electron。

---

## 确认范围与实施规则

- 主体是导入后的浏览与批量处理，导入步骤与设置简化为辅。
- 本次导入／全部待处理／收藏候选／已处理快捷范围；列表默认不勾选，每页40项，跨页选择保持，改变筛选不增加选择。
- 左列表显示用途、收藏状态、阅读与笔记标记；右侧显示完整有效分析与可保存笔记。无分析时显示已有描述，不调用模型。
- 批量已读／未读、兴趣／忽略／清除兴趣、加入／移除候选、处理／恢复、直接 Star。笔记逐项编辑，分类留在仓库功能。
- Star成功（包括核实已收藏并完成本地资料更新）及忽略自动处理；仅Github成功但本地失败保留待处理。明确恢复后不得又因旧忽略自动隐藏。
- 真正的新笔记、兴趣或候选变化恢复待处理；重复、同值、只改已读、位置不恢复。导入实际将兴趣变更为忽略时，完成处理并显示来源；手动恢复后导入相同忽略值不再次完成。
- 收藏状态已有资料＋手动刷新；未知不能当未收藏。批量Star仍实时查身份、数字ID、状态，响应丢失先核实，重启手动恢复。
- 简化首页提供导入、项目处理、生成／发送、设置；导入三步、两种输入并列选择、普通修改归组折叠、冲突重点展示。设置常用＋高级，保留旧值。

### Task 1: 桌面处理数据及回传事务

**Files:** `src/lib/html-reading/storage.ts`, `batch.ts`, new `workspace.ts`, `workspace.test.ts`, `candidates.ts`。

- [x] 建立账户内独立的 `projectSources`、`processing`、`starObservations`、`latestImport` 与版本备份；不改 `ReadingState`。
- [x] 原子导入两条路径：接受的项目操作记录来源；实际字段变更触发处理规则；收据、来源、状态同时提交。重复不改来源，不改变最近一次有效导入。
- [x] 提供 `readingProjectFingerprint(data,id)` 与 `updateReadingProjects(account,ids,patch,expected)`；原子验证所有选中项目，再只更新指定字段。
- [x] 测试迁移备份、隔离账户、重复／同值／读状态／新笔记再入列、忽略完成、手动恢复、并发修改回滚。

规则核心：
```ts
if (before.interest !== after.interest && after.interest === 'ignored') complete();
else if (before.note !== after.note || before.interest !== after.interest || before.candidate !== after.candidate) reopen();
// read 和 position 不改变处理状态
```

Run: `npx vitest run src/lib/html-reading`。Expected: 所有旧回传用例与新增处理用例通过。

### Task 2: 统一控制器及直接 Star

**Files:** `src/features/settings/hooks/useReadingProjects.ts`, `useReadingCandidates.ts`, `useHtmlReading.ts`, `src/services/readingStarBatch.ts` 及专项测试。

- [x] 所有阅读记录使用与桌面一致的分析投影；提供来源、状态时间、处理原因、确认指纹、最近导入范围及操作反馈。
- [x] 扩展显式 `selectionMode:'projects'` Star 批次，记录模式／确认指纹；旧候选批次保持兼容。确认取消不改候选或发请求。
- [x] 执行前与写入前重新校验。完成本地保存后按原指纹清候选与标为处理，迟到结果不能隐藏新导入的修改。
- [x] 手动状态刷新使用真实数字ID、当前账户及凭据校验；部分失败保留已有观测，离线不误标未收藏；不执行写请求。
- [x] 测试非候选直接Star、失联恢复、账号切换、并发导入、已收藏／本地失败／同步失败区别。

Run: `npx vitest run src/services/readingStarBatch.test.ts src/features/settings/hooks/useReadingProjects.test.ts`。

### Task 3: 项目浏览和批量处理界面

**Files:** new `src/components/reading/DailyReadingView.tsx`, `ReadingProjects.tsx`, `ReadingProjectDetail.tsx`、组件测试及中英文文案。

- [x] 快捷范围及数量、搜索与过滤、40项分页；选择与详情分开，批量栏显示跨页数量，可全选当前筛选结果和清空选择。
- [x] 已处理自动从日常列表移除；选择附近项目，保持列表滚动。右侧完整分析与笔记，失败保存保留草稿，切项目不静默丢失未保存笔记。
- [x] 批量Star一次确认完整清单（分页40）及当前账户；重用批次进度／停止／确认恢复／结果，执行中状态清楚。
- [x] 点击GitHub链接明确为外链；未知状态明确，刷新与写入分开；提供操作成功、失败与暂无记录的说明。

Run: 新组件测试；5000条隔离浏览器用例应每页40条，可搜索末条、跨页选择、直接确认取消无PUT。

### Task 4: 导入、设置及导航

**Files:** `HtmlReadingImport.tsx`, `HtmlReadingPanel.tsx`, `Header.tsx`, `App.tsx`, `types/index.ts`, 菜单配置迁移与中英文文案。

- [x] 引导式导入复用现有冲突与文件保护，输入只展开所选方式；概要与冲突优先，普通变化按项目归组。完成后进入本次项目处理。
- [x] 日常页无保存设置固定栏；配置打开时常用先显示，高级明确收起，不改变生效配置。
- [x] 增加每日阅读菜单与旧菜单配置补齐；设置入口导向每日阅读配置。切出返回尽量保留已有操作现场。
- [x] 类型、菜单迁移、导入旧测试、新页面及双语回归。

### Task 5: 验证和交付

**Files:** `scripts/test-daily-reading-ux.py`, `docs/daily-reading-ux-20261006.md`, `output/daily-reading-ux-20261006/`。

- [x] 单元／组件、全部前端和Electron回归、类型、lint、i18n、依赖边界。
- [x] 同一批5000条模拟数据对比图，双栏浏览、批量状态、处理／恢复、导入跳转、笔记与确认取消验证；不接触真实Github。
- [x] `npx vite build` 与 `npm run check:bundle-size`；现有启动方式加载根dist；生成可选独立桌面发布包，不安装／升级依赖。
- [x] 文档标明模拟验证与真实Star尚未验收，升级备份规则及从托盘退出后重新加载方式。

用户已授权实施，持续完成以上任务，不重复询问执行方式，不改真实收藏或发送邮件。


执行记录：已完成。最终结果、迁移与实际验收边界见 `docs/daily-reading-ux-20261006.md`。全量前端3399项、最终阅读专项337项、最终补充42项（有重叠）；真实GitHub与Gmail未执行。
