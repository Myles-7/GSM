# 开发与治理脚本

从项目根目录执行。Node 使用与 CI 一致的受支持版本；最新验证机版本及限制见 [AI 体验交付报告](../docs/audit/2026-10-04-ai-ux-delivery.md)，综合治理背景见 [项目审查报告](../docs/audit/2026-10-03-project-audit-delivery.md)。

| 用途 | 命令 | 范围 |
| --- | --- | --- |
| 完整前端与 Electron 回归 | `npm run test:run` | Vitest、桌面窗口、插件、WebDAV、版本恢复、CI 护栏、启动器、HTML 阅读 |
| 后端回归 | `npm --prefix server test` | 服务端功能与协议测试 |
| 类型与静态检查 | `npm run typecheck`、`npm run lint` | 当前源码，不以旧 dist 为准 |
| 结构和词库 | `npm run check:boundaries`、`npm run check:i18n`、`npm run check:html-reading` | 层级、翻译和 HTML 模块边界 |
| 插件与向量 Worker | `npm run check:plugin-registry`、`npm run check:vector-worker` | 注册表与已生成 Worker 一致性 |
| 离线页面审查 | `npm run audit:ui` | 127.0.0.1:5187，严格占用检测，100 个匿名仓库与 200 个 Release；Ctrl+C 停止 |
| Release 查询基准 | `node scripts/benchmark-release-lookup.cjs` | 9 次纯 CPU 样本，不代表页面端到端延迟 |
| 清理预览 | `npm run clean:workspace` | 默认只读，列出固定白名单、哈希与字节 |
| 执行清理 | `npm run clean:workspace -- --apply` | 仅明确退役日志、截图、TS 增量缓存、Python 字节码；拒绝符号链接 |
| 隔离构建 | `node node_modules/vite/bin/vite.js build --outDir output/candidate-build` | 不覆盖日常 dist，不触发版本同步 |
| 候选包预算 | `node scripts/check-bundle-size.cjs output/candidate-build` | 指定实际候选目录；省略参数仍检查 dist |

离线审查端口可通过 `GSM_AUDIT_PORT` 指定；不能使用 3000、5173、5174。使用独立 origin 和 Vite 缓存；若该 origin 已有其他账户，入口会拒绝执行。页面外部请求由 fetch 护栏与 CSP 阻止，匿名后端交互使用 fixture，不调用付费模型。此工具仅用于本机调试，不应对局域网开放或用于发布。

AI 专项状态：`/?aiUx=overview` 展示 24 个合成候选、资料不足/失败状态和不可用配置；`/?aiUx=limit` 展示 126 个候选的发送前范围提示；`/?aiUx=empty` 展示空结果。它们只写匿名审查账号的设备状态；连接测试与发送按钮不能用于真实供应商验收。截图通过当前浏览器验收工具获取。`node node_modules/typescript/bin/tsc --project scripts/fixtures/render-performance.tsconfig.json --noEmit` 同时检查页面与 AI fixture。

`diagnose-startup.cjs`、`diagnose-render-performance.cjs` 及 `fixtures/` 保留作为专项诊断工具，按其参数与护栏使用。HTML、桌面、AGY、主题等专项脚本继续保留；不应把会访问真实服务的历史验证脚本当成匿名审查入口。

九个无引用、固定浏览器路径/端口的旧截图脚本已退役。原文件与 SHA-256 清单位于 `output/project-audit-20261003/retired-files/` 与 `file-governance.json`，已跟踪版本也可从 Git 历史恢复。清理工具不删除 `data/`、`home-backend/`、`output/`、`dist/`、`.git/` 或依赖目录；证据与部署保留时间需另行制定。
