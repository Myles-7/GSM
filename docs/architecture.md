# 架构与数据流

GSM 把 GitHub 收藏转为可检索、可分类和可持续跟踪的项目库。主流程：连接 GitHub → 同步元数据 → 选择分析或整理范围 → 查看结果与证据 → 保存分类、订阅或导出。AI、向量 Worker 和后端均为可选集成。

## 目录职责

| 目录 | 职责 |
| --- | --- |
| `src/components/` | 共用视图、设置面板、UI 组件 |
| `src/features/` | 功能视图、hooks、纯应用操作与仓库探索 |
| `src/services/` | 网络访问、模型、任务、持久化及领域服务 |
| `src/store/` | Zustand slices、选择器、分类投影、迁移与分片存储 |
| `src/home/` | 桌面 workspace、同步副本、身份与数据库协调 |
| `src/lib/html-reading/` | HTML 快照、阅读状态与回传协议 |
| `src/plugins/` | 插件页面会话、能力桥和宿主快照 |
| `electron/` | 主进程、preload、可信 IPC、AGY、插件与本机功能 |
| `server/src/` | Express API、SQLite、同步、任务、代理与 MCP |
| `cloudflare-worker/` | 向量查询/写入服务与部署配置 |
| `scripts/` | 构建、检查、启动器与隔离诊断 |
| `registry/`、`examples/plugins/` | 插件注册表、schema 与示例 |
| `public/`、`build/`、`electron/assets/` | 浏览器静态资源、打包图标、托盘图标 |

视图调用 hooks，hooks 协调纯应用操作、服务和状态。纯应用操作不依赖 React、DOM、服务或 Store；业务服务不直接进入视图。约束由[分层 ADR](adr/0001-frontend-layering.md)、ESLint 和 `check:boundaries` 检查。

## 状态与持久化

Zustand 是偏好、仓库集合和活动视图的来源；分片持久化使用 IndexedDB。localStorage 故障回退以原子 envelope 保存权威标记，generation 防止旧标签页在清空后复写旧资料。

两套分类共用同一 Store，`useClassificationStore` 提供活动方案投影；写入捕获账号、方案与版本，防止异步完成后写入新目标。仓库元数据与方案内归属分开。仓库视图自行订阅列表、筛选和分类，应用壳只订阅导航、主题、语言与水合状态。

任务、工作台与探索结果按账号隔离。供应商执行结果和本地保存状态分别记录，取消、超时、部分完成不能伪装为成功；重试沿用 journal 和 checkpoint。

`src/home/` 协调客户端副本与后端 workspace、操作回执、版本冲突。后端 SQLite 独立存在，切换服务器或账号不能直接覆盖另一身份的资料。产品备份/恢复功能保留；删除源码备份不等于取消用户数据恢复。

## 网络与安全边界

GitHub 客户端通过 factory 统一应用 browser/backend/auto 路由。AI 服务接入 HTTP 模型与桌面 AGY，Electron 管理 AGY 队列、超时和调用注册表。远端仓库内容是不可信证据，不能改变宿主权限或指令。

Electron 启用 context isolation、sandbox 与 web security，IPC 校验受信主文档及主 frame。插件页面使用受限 origin/CSP 和能力桥；原生插件 Worker 运行 Node，不能把页面隔离误述为整个插件已隔离。

API 使用 Bearer `API_SECRET`，生产强制配置，默认仅监听 loopback。服务端凭据加密，密钥单独保留；MCP 使用独立访问控制。全栈静态服务中，缺失资源返回 404，只有页面导航进入 SPA fallback。

## 构建与发布

Vite 编译前端，tsc 编译后端，electron-builder 生成安装包。`build/` 是打包输入；`dist/`、`server/dist/`、`release/` 为忽略的输出。`cloudflare-worker/worker.js` 是必须提交并检查一致性的部署文件。

源码验收入口为 `npm run check`、完整前端/Electron 回归、服务端测试和 `build:all`。离线界面审查使用独立 origin 与合成身份，不能代替真实模型、邮箱、云端或手机验收。普通 push 不发布安装包，也不更新正在运行的 Windows 服务。
