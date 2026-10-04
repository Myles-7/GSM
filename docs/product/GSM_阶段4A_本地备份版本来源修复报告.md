# GSM 阶段 4A：本地备份版本来源修复

> 后续状态（2026-10-03）：4A 的 package 版本来源继续成立；本地文件格式已由阶段 4C 升为 v1.1。本报告中的 v1.0 测试记录是 4A 当时的结果，当前恢复范围见 [阶段 4～8 交付报告](GSM_阶段4至8连续开发交付报告.md)。

日期：2026-10-03。用户在订阅修复收尾时授权继续下一阶段，本子阶段仅修导出应用版本来源。

## 问题与改动

本地 JSON 导出硬编码 `appVersion: '0.4.0'`，与根 package 的 `0.8.4` 不符。根因是导出 metadata 另维护一份常量，未随应用版本变化。

`src/components/settings/DataManagementPanel.tsx` 复用 GeneralPanel、DiagnosticLogsPanel 的根 package JSON version 导入方式，导出 `appVersion: version`。`DataManagementPanel.test.tsx` 在已有实际 Blob 内容断言中增加 appVersion 等于 package version、格式 version 保持 `1.0`。

应用版本 owner 仍是根 package；导出文件为只读快照，没有新增事实源、持久化 schema、依赖、后台任务或账户/workspace 写入。未改 package、backup format、字段、导入 merge/replace、secret、WebDAV、Home Sync v2 或兼容路径。

## 验证与风险

`npx vitest run src/components/settings/DataManagementPanel.test.tsx`：8 项通过，覆盖实际导出、未选 Discovery、workspace-only merge/replace、身份与非法记录拒绝、旧 Discovery 导入及恢复中账户切换。最终 TypeScript、本次目标文件的 `git diff --check` 通过。全工作区检查另报告并行 HTML Reading 两个 txt 文件末尾空行，未改动他人内容。日志在 `output/render-performance/subscription/backup-4a-tests.log`、`typecheck-closeout.log`。无构建工具链改动，不为这两行业务修改额外完整 build。

该修复只纠正 metadata，不扩大备份覆盖，也不证明跨库恢复原子性。子分类/顺序遗漏、masked secret、partial failure/recovery 等风险仍按准备报告独立处理；没有把现有 8 项回归冒充完整备份验收矩阵。

## 回滚与下一步

仅撤回 package version import 和 appVersion 替换；对应测试断言一起回滚即可。无需迁移或清除任何数据。保护订阅修复及其它用户未提交修改，不执行整文件/工作区 reset。

下一项建议为 4B 导出字段完整性调查与明确白名单；具体 included/excluded 和恢复支持边界先交由用户决定。阶段 5 仍按准备报告建立离线 correctness fixture，并在改变排序规则前询问。本次停止，不自动扩展字段或改搜索。
