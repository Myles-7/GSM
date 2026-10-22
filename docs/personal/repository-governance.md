# 仓库治理

个人仓库 Myles-7/GSM，上游 AmintaCCCP/GithubStarsManager。`personal/main` 是个人交付分支，`codex/*` 为开发分支；历史 `main` 不自动合并上游。应用版本保持 0.8.4，选择性集成不冒称完整升级。

合入前运行 `npm run check`、`npm run test:run`、服务端测试与类型检查、`npm run build:all`。CI 前端 Node 24，服务端原生依赖 Node 22。未执行的真实供应商、安装、手机和部署验证须明确列为限制。

源码、测试和维护文档共同提交，推送前审查 diff 与敏感信息，使用普通 push。普通分支推送不发布安装包或容器；个人仓库继承的上游发布工作流保持受限。

不提交数据库、密钥、本机部署、依赖、生成物、截图和报告。历史方案与源码恢复点通过 Git 查找，不在源码目录复制 backup/old/copy。产品数据备份和迁移功能保留；Git 无法恢复未备份的运行资料。

重新编译、提交和 push 不代表正在运行的 Windows 后端或另一台设备已经升级。
