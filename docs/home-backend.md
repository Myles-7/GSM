# Windows 常驻家庭后端

此部署将 GSM 后端作为 Windows 服务运行。注销用户后服务继续运行，开机自动启动，异常退出由服务管理器重启。默认只监听 `127.0.0.1:3000`；通过 Tailscale Serve 提供仅 tailnet 可访问的 HTTPS。安装脚本不会安装 Tailscale、创建防火墙公网规则、配置路由器端口转发或开启 Funnel。

## 部署前准备

使用 Windows 10/11 或 Windows Server。准备来自官方发布渠道、经独立可信校验清单验证的 **WinSW 2.12.0** 可执行文件，以及一个仍在维护的 Node.js 22+ Windows 运行时。传入精确版本字符串（例如从所选发行版清单取得 `v22.x.y`，不要原样使用占位符）及各自 SHA-256。不要将本地计算结果当作来源真实性证明；先和官方可信清单核对。脚本不下载、不升级系统运行时。

后端依赖含 `better-sqlite3` 原生模块；必须在 Windows 上使用部署时**相同 Node 版本和架构**安装，不能从 Linux/macOS 复制 `node_modules`。在普通权限终端，将所选 Node 发行目录置于当前会话 PATH 首位，再构建：

```powershell
$env:PATH = 'C:\Tools\node-pinned;' + $env:PATH
node --version
npm --prefix server ci
npm --prefix server run build
npm --prefix server test
```

准备一个不在 `C:\ProgramData\GSM` 内的新发布目录，例如 `C:\GSM-artifacts\release-0.8.4`，其内容为：

```text
release-0.8.4/
  server/
    package.json             # 与应用版本同步的原始文件
    package-lock.json
    dist/                    # server 的 tsc 输出，包含 index.js 和 services/backups.js
    node_modules/            # 在 Windows + 同一 Node 下安装的生产依赖
```

可以复制上面的 `dist`、`package.json` 和 `package-lock.json` 到 staging 的 `server` 子目录，然后执行 `npm ci --omit=dev --prefix C:\GSM-artifacts\release-0.8.4\server`。不要把整个开发仓库、`.env`、数据库、密钥或源目录的 `data` 打包。发布目录不能含 junction/symlink。脚本只部署已经构建的发布产物，并用目标 Node 打开一个内存 SQLite 数据库，检查原生 ABI 是否匹配。

也可使用自动发布目录准备脚本（普通权限运行）：

```powershell
node scripts/home-backend/prepare-release.mjs `
  --output 'C:\GSM-artifacts\release-0.8.4' `
  --expected-node '<node --version 的精确版本>'
```

该脚本检查版本一致性、编译后端，仅复制 `dist` 与 npm 清单，以锁文件执行 `npm ci --omit=dev`，运行原生 SQLite 冒烟检查，并记录 Node 版本/架构/哈希及锁文件哈希。输出目录必须全新；只允许在 Windows 上准备。若 npm 不随 Node 位于标准目录，可传 `--npm-cli 'C:\Tools\node\node_modules\npm\bin\npm-cli.js'`。产物清单用于部署复核，不替代独立官方哈希来源。

## 安装和生命周期

管理员 PowerShell 中先预览，再去掉 `-WhatIf` 执行。`-WhatIf` 不安装或停止服务；真正执行时才完整检查产物和运行时。

```powershell
.\scripts\home-backend\service.ps1 -Action Install `
  -ReleasePath 'C:\GSM-artifacts\release-0.8.4' `
  -NodePath 'C:\Tools\node-pinned\node.exe' `
  -ExpectedNodeVersion 'v22.REPLACE.WITH-PATCH' `
  -NodeSha256 '<来自可信清单的64位SHA256>' `
  -WinSWPath 'C:\Tools\WinSW-x64.exe' `
  -WinSWSha256 '<来自可信清单的64位SHA256>' -WhatIf
```

所有脚本支持 `-WhatIf`。服务操作均限于 `GSMBackend` 且核对它的可执行路径，端口占用时报错，不终止占用端口的进程。

```powershell
.\scripts\home-backend\service.ps1 -Action Status
.\scripts\home-backend\service.ps1 -Action Stop
.\scripts\home-backend\service.ps1 -Action Start
.\scripts\home-backend\service.ps1 -Action Restart
.\scripts\home-backend\service.ps1 -Action Uninstall -WhatIf
```

卸载只移除服务注册，保留发布产物、数据、日志和密钥。再次安装时复用已有凭据和端口。更改端口时，停止服务，在私有 `backend.env` 中修改 `PORT`，再启动；不要只更改安装命令的 `-Port`。

默认路径布局如下，可用每次一致的 `-Root` 更改：

| 路径 | 内容与权限 |
| --- | --- |
| `%ProgramData%\GSM\service` | WinSW 和 XML；LocalService 只读 |
| `%ProgramData%\GSM\releases\版本-时间戳` | 独立发布和固定 Node；LocalService 只读 |
| `%ProgramData%\GSM\credentials\backend.env` | API_SECRET 和绝对路径；LocalService 只读 |
| `%ProgramData%\GSM\keys\encryption.key` | 独立加密密钥；LocalService 只读 |
| `%ProgramData%\GSM\data` | SQLite 和 backups；LocalService 可修改 |
| `%ProgramData%\GSM\logs` | 服务输出；LocalService 可修改，约 10 MiB/文件、保留 8 份 |

这些目录关闭继承 ACL，只授予 SYSTEM、Administrators 和 LocalService 必需权限。LocalService 是 Windows 共享低权限服务身份，并非每服务隔离账号。不要让不可信软件以此身份运行。安装不显示生成的 API_SECRET；在管理员编辑器内打开 `credentials\backend.env`，将密钥输入自己的客户端设置，不要粘贴到日志、聊天或截图。

独立后端 `NODE_ENV=production` 缺少 API_SECRET 时拒绝启动。`HOST` 默认 loopback。显式 `DATA_DIR` 和 `ENCRYPTION_KEY_FILE` 必须是绝对路径；开发环境未设置 DATA_DIR 时继续使用原有 `cwd/data`，保护旧部署兼容性。Node 的 `--env-file` 不覆盖已有系统环境变量，因此系统级 `API_SECRET`、`DB_PATH`、`HOST` 等同名变量应在部署前清理或与服务配置保持一致。

若迁入已有数据库，先停止旧进程，使用 SQLite 在线备份或完整干净关闭后的数据库，迁入 `data\data.db`，并将**原有对应加密密钥**保存到 `keys\encryption.key`。不要对旧密文生成新密钥。

## 更新和回退

用同样的构建过程准备新发布，然后运行：

```powershell
.\scripts\home-backend\service.ps1 -Action Update `
  -ReleasePath 'C:\GSM-artifacts\release-new' `
  -NodePath 'C:\Tools\node-pinned\node.exe' `
  -ExpectedNodeVersion '<精确版本>' -NodeSha256 '<可信SHA256>' -WhatIf
```

更新先验证新产物，再停止现有服务，更换服务 XML 并重启；不会改变凭据。原发布保留，旧 XML 保存为 `service\GSMBackend.xml.previous`。健康检查验证服务报告的实际 package 版本。启动或健康检查失败时不会自动回退数据库，以免在新 schema 上运行旧代码。停止服务，确定所需 migration backup，按照恢复流程生成新数据库；将旧 XML 恢复为当前 XML，并在私有 env 中选择恢复数据库后启动。不要在服务运行时复制/覆盖 live DB、`-wal` 或 `-shm`。

## Tailscale：无人值守和 HTTPS

使用官方签名 Windows 安装包安装 Tailscale，交互登录自己的 tailnet；按管理后台提示启用 HTTPS。管理员 PowerShell：

```powershell
.\scripts\home-backend\tailscale.ps1 -Port 3000 -WhatIf
.\scripts\home-backend\tailscale.ps1 -Port 3000
```

脚本显式启用 unattended 模式并执行 `tailscale serve --bg http://127.0.0.1:3000`。Serve 通过 tailnet 的 HTTPS 地址转发到 loopback，配置后台持久运行。**不要启用 Funnel**。按需用 Tailscale ACL/grants 限定访问设备与用户；保留 GSM API 认证。该脚本仅适合将该节点的默认 Serve HTTPS 入口交给 GSM；已有 Serve 路由时先运行 `tailscale serve status` 检查，避免改变其它应用入口。禁用时使用 `tailscale serve --https=443 off`（先确认这是 GSM 的 Serve 入口）。

如果需要同域网页，在发布产物中另外包含已经构建的前端目录，并在私有 env 中设置 `STATIC_DIR` 指向该目录的绝对路径。更新时相应更新路径；这不影响默认 API-only 部署。

## 服务账号与网络代理

LocalService 不继承登录用户的浏览器代理、用户环境变量、登录会话启动的 Clash 等工具，也不能使用你的用户凭据访问网络共享。GitHub/AI 出站访问应配置 GSM 的后端代理设置或机器层面持续运行的代理。若代理仅在用户登录时启动，注销后 GSM 虽然运行，联网任务仍可能失败。优先让代理作为独立服务运行，并核对监听地址、认证与权限；不要为了代理把 GSM 改成管理员账号。

新任务执行器与账户校验使用 Node 原生 `fetch`，不会自动使用旧 Axios 路由的界面代理配置。对本次固定的 Node 22.23.3，`node --help` 已确认支持 `--use-env-proxy`：需要 HTTP(S) 代理时，在私有服务 env 中设置 `NODE_OPTIONS=--use-env-proxy`、`HTTPS_PROXY`、`HTTP_PROXY` 和 `NO_PROXY=localhost,127.0.0.1`，再重启服务。代理密码只留在受 ACL 保护的 env；先验证代理在注销后仍能运行，不在源码或日志中记录。

## 备份、密钥和恢复演练

后端启动时检查备份计划，此后每小时检查：每个 UTC 日期最多建立一份 daily，每个 UTC 周建立一份 weekly。使用 SQLite 在线 backup API，包括已提交 WAL 内容；完整性检查成功后才将 `.partial` 原子改名为 `.sqlite`。保留最近 **7 个 daily、4 个 weekly**；迁移前独立 migration 快照保留 4 个。关机期间不补造历史备份；恢复运行后生成当日/当周快照。备份失败记录错误；迁移前备份失败必须阻止迁移。

数据库备份位于 `data\backups`，**不包含密钥**。把 `keys\encryption.key` 和 API 凭据单独放入加密离线保险库，限制访问；再将数据库备份复制到独立磁盘或受控备份目标。相同磁盘上的快照不能防磁盘损坏。恢复旧数据库需要创建它时使用的加密密钥。

恢复工具只写入全新文件，不覆盖 live DB，并在复制前后运行 SQLite `integrity_check`。先停服务，再执行：

```powershell
.\scripts\home-backend\service.ps1 -Action Stop
.\scripts\home-backend\restore.ps1 `
  -Backup 'C:\ProgramData\GSM\data\backups\daily-<实际文件名>.sqlite' `
  -Destination 'C:\ProgramData\GSM\data\restore-drill.db' -WhatIf
# 检查参数后去掉 -WhatIf 重复执行。
```

用管理员编辑器在 `credentials\backend.env` 中将 `DB_PATH` 设置为 `"C:/ProgramData/GSM/data/restore-drill.db"`，核对 ENCRYPTION_KEY_FILE 对应正确密钥，再启动服务。检查仓库数量、设置读取、一个已加密配置解密，以及同步/任务行为。保留原数据库及其 WAL/SHM 为一个整体，直到演练通过；不要只复制仍在使用的 data.db。

## 验收清单

1. `Status` 显示 Running、Automatic、LocalService；`http://127.0.0.1:3000/api/health` 返回正确版本。
2. 未携带 API_SECRET 的受保护 API 返回拒绝访问；正确密钥可访问。
3. 从另一台 tailnet 设备使用 Serve HTTPS 域名访问，未授权设备无法访问；局域网 IP 的 3000 端口不监听。
4. 建立一个测试任务后关闭桌面端并注销 Windows，另一设备仍可查询任务状态；重启机器后同样验证。
5. 备份目录有可验证快照，恢复演练读取原数据和加密配置成功。
6. 占用端口时启动应明确失败且不杀死占用者；错误版本/哈希应在停旧服务前失败。

本仓库的自动测试覆盖真实 SQLite WAL 备份、7/4 保留策略、完整性拒绝和禁止覆盖；PowerShell 语法与 WhatIf 可以无安装验证。SCM 服务安装、注销/重启、Tailscale 和离机恢复需要在目标 Windows 主机按此清单验收。

官方参考：WinSW 仓库 `v2.12.0/doc/xmlConfigFile.md`、Tailscale 文档 “Run unattended”、`tailscale serve` CLI、SQLite “Online Backup API”。部署者应在所选固定版本的官方文档中复核相关选项。
