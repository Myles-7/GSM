# 项目文档入口

文档按用途查找；历史测试数量、服务状态和截图仅代表记录当日，不能作为当前运行程序已升级的依据。

## 当前使用与开发

- [开始使用](../开始使用.md)：个人交付版本与本机启动入口。
- [每日 HTML 阅读方案](html-reading-transition-plan.md)：当前手机阅读方向；Android APK 已退役。
- [HTML 阅读交付](html-reading-delivery.md)、[本轮改造](html-reading-redesign-20261003.md)、[阅读定制](html-reading-customization-20261003.md)、[间距调整](html-reading-spacing-20261003.md)。
- [后端说明](home-backend.md)：连接与数据责任；实际服务状态需现场核对。
- [架构决策](adr/0001-frontend-layering.md)、[脚本入口](../scripts/README.md)。

## 最新审查与实施

- [2026-10-04 源码集成与验证](personal/upgrades/2026-10-04-source-publication.md)：本轮源码 SHA、严格零警告检查、迁移兼容、恢复方法及未验收范围；不代表日常运行版本已替换。
- [2026-10-04 AI 体验开发方案](plans/2026-10-04-ai-ux-development.md)、[AI 功能审查交付报告](audit/2026-10-04-ai-ux-delivery.md)：各类 AI 功能、结果保留、失败/取消、搜索排序、桌面/手机截图、回归与治理。
- [2026-10-03 审查开发方案](plans/2026-10-03-project-audit-development.md)。
- [2026-10-03 综合交付报告](audit/2026-10-03-project-audit-delivery.md)：体验、截图、功能、产品、性能、数据与治理结果。
- [此前开发优化分析](audit/2026-10-03-development-optimization-guide.md)：同日早期快照；其中检查数字与问题状态以综合交付报告的实测为准。
- [产品分析与连续开发记录](product/)：专项分析与实施证据；路线建议不等于已实现功能。
- [个人交付记录](personal/README.md)：个人版本的变更与验收。

## 历史资料

- [已退役 Android 记录](archive/android-20260930/README.md)：保留诊断与协议修复依据，不用于当前安装。
- `mobile-*` 其他文档与旧审查仍是历史证据，涉及 APK、旧服务版本的内容不代表当前每日 HTML 方案。
- `superpowers/`、旧 `plans/` 和 `audit/` 按文内日期阅读；新工作先复现问题再采用结论。

清理规则：删除已被替代且无引用的临时脚本；归档仍有追溯价值的文档；不按文件时间自动删除源码、数据库、部署、备份或未提交工作。
