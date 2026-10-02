# 个人功能清单

重建基线：P0.1.0，2026-09-27。上游父提交为 v0.8.3
`7e63b30774ec9b36e5c57441950a05b94a753fff`。这是根据源码比对重建的历史，
不是恢复丢失的原始提交历史。

| 功能 | 入口/实现 | 升级约束 |
| --- | --- | --- |
| 全页面中文翻译/恢复原文 | App、PageTranslationButton、usePageTranslation、pageTranslationClient | 固定 translate.js 4.0.0，动态 DOM/Portal 可翻译，跳过代码/敏感内容，不持久化译文 |
| 翻译偏好 | 原 Store 的 pageTranslationEnabled | P0.2.0 以 v17 保留个人偏好，继续清理退休字段，不恢复旧服务/按钮 |
| 桌面热更新 | scripts/dev-desktop.mjs、desktop-dev-address.mjs | 默认自动选端口；快捷方式显式固定原数据端口，占用时报错；Vite 就绪后启动 Electron |
| 开发地址 | electron/main.js 的 GSM_DEV_SERVER_URL | 保留环境变量和默认地址回退 |
| 本地启动/停止 | scripts/launch.mjs、stop.mjs、start-gsm.bat、stop-gsm.bat | 保留既有桌面快捷方式，不随意终止无关进程 |
| 个人图标 | public/app.ico | 保留 |
| API 路由兼容 | 三处仓库/发现 hooks 使用 API 工厂 | v0.8.4 采用上游统一实现，不保留重复补丁 |
| 工程约束 | eslint.config.js、check-boundaries.cjs | 保留组件访问服务边界、旧翻译模块移除规则 |

完整实现边界与隐私说明见 `translate-js-page-translation.md`。

## P0.1.1 迁移增量

- 批量 Star 新弹窗复用全页面翻译，不再阻塞选中或 Star。
- 后端 CSP 为翻译放行精确 Edge 来源，仍禁止 unsafe-eval。
- 过滤器规范化与个人翻译偏好兼容；正常加载、后端同步、旧备份导入均已验证。
- 上游网络路由/同步竞态修复完整保留；Docker 构建上下文排除个人数据与密钥。
- 交付启动时发现自动选端口会切换 IndexedDB 来源，补充开发启动器对
  `GSM_DEV_SERVER_URL` 的校验与精确端口绑定。原桌面快捷方式固定
  `http://127.0.0.1:5174`；未设置环境变量的命令行启动仍保留原自动选择行为。
- 详细门禁与已知限制见 `upgrades/v0.8.4.md`。

## P0.2.0 选择性增量

- 仅吸收 v0.8.5 的已选 #414–#422；#416 仅桌面。完整基线/package 仍为 0.8.4。
- 批量 Star 增 README 预览、账号最近 10 条原文历史、权限指引与错误分类；载入历史不自动 Star。
- Release 采用资产/正文链接匹配及“显示全部”，显式源码规则和跨过滤器 OR 保留。
- external JSON/RSS/Atom 频道与 AI Custom Discovery 并存；直连无凭据、有大小/数量/时间及取消限制，没有 CORS 代理。
- 插件 V1.4 opensPage、session 与原生输出完整接线；信息卡沿用个人 AI 确认、任务日志和净化输出。
- 外观菜单独立，向量索引操作独立；徽标只计算本地可确认待处理，不自动发 README 或 AI 请求。
- Store v17、明确身份 dry-run、持久迁移日志及跨库共同恢复；未确认名称匹配不自动合并。
- Workbench、Organization、AGY、HTML Reading、Custom Discovery、整页翻译、Home 与原桌面入口回归通过。原数据、真实远端和生产部署未自动操作。
- 实现、提交、实际 Electron 与未触及 lint 基线见 `upgrades/P0.2.0-validation.md` 和迁移账本。源码位于隔离分支，原启动入口尚未切换。
