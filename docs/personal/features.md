# 个人功能清单

重建基线：P0.1.0，2026-09-27。上游父提交为 v0.8.3
`7e63b30774ec9b36e5c57441950a05b94a753fff`。这是根据源码比对重建的历史，
不是恢复丢失的原始提交历史。

| 功能 | 入口/实现 | 升级约束 |
| --- | --- | --- |
| 全页面中文翻译/恢复原文 | App、PageTranslationButton、usePageTranslation、pageTranslationClient | 固定 translate.js 4.0.0，动态 DOM/Portal 可翻译，跳过代码/敏感内容，不持久化译文 |
| 翻译偏好 | 原 Store 的 pageTranslationEnabled | 保留现有版本 16，清理旧翻译字段，不恢复旧服务/按钮 |
| 桌面热更新 | scripts/dev-desktop.mjs | 自动选端口，Vite 就绪后启动 Electron，不要求打安装包 |
| 开发地址 | electron/main.js 的 GSM_DEV_SERVER_URL | 保留环境变量和默认地址回退 |
| 本地启动/停止 | scripts/launch.mjs、stop.mjs、start-gsm.bat、stop-gsm.bat | 保留既有桌面快捷方式，不随意终止无关进程 |
| 个人图标 | public/app.ico | 保留 |
| API 路由兼容 | 三处仓库/发现 hooks 使用 API 工厂 | v0.8.4 采用上游统一实现，不保留重复补丁 |
| 工程约束 | eslint.config.js、check-boundaries.cjs | 保留组件访问服务边界、旧翻译模块移除规则 |

完整实现边界与隐私说明见 `translate-js-page-translation.md`。
