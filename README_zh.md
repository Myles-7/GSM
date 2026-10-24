# GitHub Stars Manager 个人版

本地优先的 GitHub 收藏管理工具：同步 Stars、双方案分类、语义搜索、Release 订阅、仓库问答、项目地图探索、AI 工作台与离线 HTML 阅读。桌面版支持 Electron、AGY CLI 和本地插件；界面支持简体中文和英语。

[English](README.md) · [文档入口](docs/README.md) · [架构与数据边界](docs/architecture.md)

当前应用版本保持 **0.8.4**，选择性集成部分上游改动，不代表完整升级到上游 0.8.5。上游安装包和更新 feed 不包含全部个人功能。

## 开发与构建

使用 Node.js **22.12+**。CI 前端使用 Node 24，SQLite 服务端使用 Node 22；优先使用这两个 LTS 版本。原生依赖必须在实际运行的 Node 版本、系统和架构下安装。

```sh
npm ci
npm run dev
```

打开 Vite 输出的本机地址并配置 GitHub token。AI、向量搜索、WebDAV 和远程下载均可按需配置。联网功能会向配置的服务发送相应内容，本地存储并不代表完全离线处理。

```sh
npm run dev:desktop       # Electron + 独立开发服务器
npm run build             # 重新编译前端到 dist/
npm run electron          # 启动已编译桌面界面
npm run build:desktop     # Windows 上生成安装包，不自动发布
```

已有 Windows 快捷方式通过 `scripts/start-home-desktop.cjs` 加载 `dist/`。修改源码后须重新构建，详见[开始使用](开始使用.md)。

## 可选后端

Express/SQLite 提供跨设备同步、持久任务、API 代理、加密凭据和 MCP。客户端资料与后端数据库是独立存储，不能以源码提交代替资料备份。

```sh
npm ci --prefix server
npm --prefix server run dev
```

默认监听 `127.0.0.1:3000`。配置 `API_SECRET` 后再连接客户端；生产环境缺少它会拒绝启动。变量见[配置示例](server/.env.example)。程序不自动读取 `.env`；编译后可用 `node --env-file=/绝对路径/backend.env server/dist/index.js` 加载配置。迁移数据库时必须保留原加密密钥。

[Docker 部署](DOCKER_zh.md) · [Windows 服务](docs/home-backend.md) · [向量 Worker](cloudflare-worker/README.md)

## 验证

```sh
npm run check
npm run test:run
npm --prefix server test
npm --prefix server run typecheck
npm run build:all
npm run format:check
```

`check` 覆盖 lint、类型、审查 fixture、模块边界、生产模块可达性、中英文词库、插件注册表、Worker 和文档链接。`npm run check:unused` 可单独检查脱离应用入口的模块。仓库没有全局格式化器，`format:check` 检查 diff 中的空白错误，不批量改写无关文件。

自动测试使用合成账号和隔离存储，不能据此宣称真实 GitHub/AI/SMTP 或手机已验收。Electron 原生冒烟和安装包验证需要桌面环境，更多入口见[脚本说明](scripts/README.md)。

## 维护约定

视图通过功能 hooks 调用服务；Zustand 管理应用状态，IndexedDB 保存按账号隔离的资料。Electron 校验 IPC 来源，插件页面使用能力桥；原生插件 Worker 可运行 Node 代码，只安装可信插件。

不提交密钥、数据库、本机部署、依赖、构建、安装包和诊断输出。日常 push 仅运行 CI，不发布安装包，见[仓库治理](docs/personal/repository-governance.md)。

`main` 是默认分支和唯一长期主分支，临时开发分支通过检查并合入后删除。个人容器发布需要在 `main` 上显式执行手动工作流。

基于 [AmintaCCCP/GithubStarsManager](https://github.com/AmintaCCCP/GithubStarsManager)，采用 [MIT](LICENSE) 许可。
