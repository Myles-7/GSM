# 移动端桌面风格还原实施记录

依据用户批准方案，覆盖仓库、完整发现、AI 工作台/问答/整理。保留当前账户、离线队列、后端任务和 APK 应用身份。

## 基准

- 桌面仓库：CategorySidebar、SearchBar、RepositoryCard、RepositoryListPresentation；共享主题和 UI 控件。
- 桌面发现：DiscoveryView、DiscoverySidebar、自定义频道组件和来源设置。
- 桌面 AI：AIWorkbench、RequirementsEditor、AIOrganizationPanel、MarkdownRenderer。
- 当前移动独立深蓝页面替换为桌面主题；移动数据继续由 HomeSync 投影，不导入整个桌面 App。

## 工作项

- [x] 共享主题、移动导航、抽屉与返回键
- [x] 仓库、详情、README、分类及问答
- [x] 发现后端、前端和持久任务
- [x] AI 工作台、原位流式问答、整理审阅
- [x] 发现资料同步及迁移实现、独立测试
- [x] 类型/边界/功能/视觉验证、构建 APK
- [x] 部署前一致性备份；记录真机验收限制
- [x] 电脑服务实际升级（2026-09-30 已部署合并版本，健康与私人 HTTPS 检查通过）
- [x] 新桌面启动后的真实发现资料统计（1 个配置、3 个趋势历史、2 个来源订阅；无已生成期刊可验证）
- [ ] 真机覆盖安装、移动数据、键盘、锁屏与恢复验收

交付详情、测试证据与限制见 [mobile-parity-delivery.md](mobile-parity-delivery.md)。

开发使用现有 codex/ai-repository-organization 分支与当前工作区，因为既有功能和安装依赖尚未提交的代码。没有重置、暂存或提交用户已有改动。

手机设置与后续体验打磨记录见 [mobile-settings-delivery.md](mobile-settings-delivery.md)。

