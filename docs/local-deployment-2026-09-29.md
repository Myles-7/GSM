# 本机安装记录（2026-09-29）

本记录补充[历史交付记录](personal/archive/android-native/android-home-delivery.md)，描述已完成的真实电脑部署。Android 原生路线已退役，手机继续通过网页使用；异网和整机重启验收仍单独记录，不以本机测试替代。

## 安装及启动

- 根目录：`D:\桌面\GSM\home-backend`。
- `GSMBackend`：Windows 自动启动服务，LocalService 身份；Node 22.23.3、WinSW 2.12.0；监听 `127.0.0.1:3000`。
- `Tailscale`：Windows 自动启动服务，已开启无人值守；程序位于 `home-backend\tailscale`。系统驱动和系统状态使用 Windows 标准目录。
- 私人 HTTPS：`https://desktop-fa8ec0s.tail79d912.ts.net`，Serve 转发至后端；仅 tailnet 可达，没有启用 Funnel。
- 桌面入口：项目根目录 `GSM-桌面端.lnk`。使用现有 Electron 和生产 dist；后台服务独立运行。这个入口仍依赖项目中的 node_modules、electron 和 dist，请勿删除这些目录。
- 桌面连接 `http://127.0.0.1:3000/api`；设备本地模型保留 AGY。后端 DeepSeek 模型使用已配置并实际验证可用的 `deepseek-flash`。
- 后端已移除 HTTP_PROXY/HTTPS_PROXY 和代理相关 NODE_OPTIONS，不依赖登录会话中的 Clash Party。
- 当前电源策略已经不自动睡眠，本次未修改系统电源设置。

## 手机填写

手机 Tailscale 登录与电脑相同的账户并连接。GSM 后端地址填上述私人 HTTPS 地址，访问密钥从本机 `.deployment-staging\mobile-connect.txt` 复制。该密钥是 GSM API_SECRET，不是 GitHub Token 或 DeepSeek API Key。

密钥不写入本文和 Git。部署目录、迁移备份和连接文件已被 Git 忽略。

## 迁移与备份

- 原始 `server\data` 保留。迁移前 SQLite 一致性备份：`.deployment-staging\pre-install.sqlite`。
- 真实 Electron IndexedDB/Local Storage 备份：`.deployment-staging\desktop-profile-preinstall`；各来源导出文件也保存在私有 staging 目录。
- 绑定 GitHub 账户 Myles-7（数字 ID 242546661）。首次导入 62 个仓库、10 个会话、48 条最终消息、2 个提案、2 个 Release；没有工作台项目。
- 账户来源不明的一个会话、未引用证据及未完成消息保留在本地，没有自动混入服务器。
- 两次部署自检额外生成 2 个会话、4 条消息；最终诊断为 12 个会话、52 条消息。
- 迁移后在线一致性备份：`.deployment-staging\post-install-20260929.sqlite`，SQLite integrity_check 为 ok。
- 服务每日/每周备份目录：`home-backend\data\backups`。同盘备份不能防御硬盘损坏。
- 恢复加密配置必须同时保留 `home-backend\keys\encryption.key`，以及私有 `credentials\backend.env`。勿将密钥提交 Git。恢复/升级程序见 `docs/home-backend.md`。

## 已验证

- 两个 Windows 服务均 Running、Automatic；GSM 服务重启成功，工作区及既有任务保留。
- 私人 HTTPS 健康接口 200；未鉴权能力接口 401；正确密钥能力接口 200，GitHub 账户验证成功。
- DeepSeek 官方模型接口 200；移除代理并重启服务后，新提交的真实需求理解任务 completed，无错误。
- 桌面 Electron 主窗口已成功打开；已检查文件来源与开发来源都保留 62 个仓库、原账户和 AGY 设备选择。未把进程启动检查当作全部桌面交互验收。
- 检查记录：`.deployment-staging\final-verification.json` 和 `service-finalized.json`，均不包含访问密钥。

## 仍需现场验证

手机关闭 Wi-Fi、通过移动数据访问；手机锁屏后取回任务；Windows 整机重启及注销后的实际连接。本次没有主动重启电脑或注销用户。正式签名 APK 和完整 Android 真机验收状态仍以交付报告为准。

## 服务维护

管理员 PowerShell 在项目根目录执行：

```powershell
.\scripts\home-backend\service.ps1 -Action Status -Root 'D:\桌面\GSM\home-backend'
.\scripts\home-backend\service.ps1 -Action Restart -Root 'D:\桌面\GSM\home-backend'
```

日志位于 `home-backend\logs`。不要移动安装根目录；服务注册和桌面快捷方式使用绝对路径。
