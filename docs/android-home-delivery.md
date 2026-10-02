# GSM 安卓与家庭后端交付记录

日期：2026-09-29。当前交付是可构建、可部署验收的代码和调试 APK，**尚未完成真实设备与家庭网络的全部验收**。工作保留在原工作区和分支，没有重置、提交或发布原有改动。

## 已实现的代码路径

| 范围 | 实现与入口 |
| --- | --- |
| 独立后端 | `server/src/index.ts`、`config.ts`；生产密钥必填、loopback 默认监听、显式数据路径、优雅停止、请求 ID |
| Windows 服务 | `scripts/home-backend/service.ps1`；WinSW LocalService、安装/更新/启停/状态/卸载、ACL、固定运行时校验、日志轮换；卸载保留数据 |
| 私网 HTTPS | `scripts/home-backend/tailscale.ps1`；显式 unattended + Serve；未执行安装或更改现有网络 |
| 可靠同步 | `server/src/services/syncV2.ts`、`routes/syncV2.ts`、`src/home/`；固定快照、增量游标、操作去重、版本冲突、墓碑、旧写入口阻断、同账户绑定 |
| 本地可靠性 | 同一 IndexedDB 中的缓存、服务器版本、操作队列和游标；请求发送前保存不可变批次；丢失确认安全重放；连续离线编辑保留原始基础版本；后台停止轮询、自动退避 |
| 迁移 | 桌面设置 → 后端 → 家庭电脑同步：先导出，再预览数量并确认初始化；手机不能从空数据初始化；聊天与工作台稳定 ID |
| 后台任务 | `taskRunner.ts`、`taskEvidence.ts`、`taskModel.ts`、`taskResearch.ts`；SQLite 队列、并发上限、流式事件、取消、检查点、可确定安全的重启恢复、未知模型调用人工恢复 |
| AI 范围 | 摘要、详情、分类建议、仓库问答、需求、研究、比较、提案；固定提交 GitHub 取证；共享纯核心辅助逻辑；AGY 仍走既有桌面路径 |
| 提案 | `taskProposals.ts`；明确选择和确认、提案与仓库版本校验、Star/unstar 效果台账、超时后先核对 GitHub 状态；手机与桌面均有审阅入口 |
| 手机产品 | `src/mobile/`；仓库/工作台/任务/设置、分类触摸编辑、批量摘要、问答、Release 订阅/已读、分页、离线状态和冲突入口 |
| 原生能力 | `android/`；Android 10 起、APK 内置资源、Keystore 凭据、禁止明文/应用备份、返回键、前后台/网络事件、系统分享、SAF 文档导入导出 |
| 运维 | SQLite 一致性备份和恢复工具；7 日/4 周轮换；`/api/health` 实际版本与协议；鉴权 `/api/diagnostics` 只返回计数与状态 |
| CI | `.github/workflows/build-android.yml`；类型与边界、前端相关测试、后端测试与构建、Android debug/持有者密钥 release |

## 产物与部署顺序

1. 调试 APK：`android/app/build/outputs/apk/debug/app-debug.apk`，包名 `io.github.gsm.personal.debug`。它使用调试签名，不能替代正式发布签名。
2. Windows 发布目录：`output/home-backend/release-0.8.4-node22`；版本与运行时哈希以该目录 `release-manifest.json` 为准。随本次构建准备的便携 Node 在 `output/home-backend/runtime/`，没有修改系统 Node。
3. 服务安装、Tailscale 配置、备份恢复：按 [home-backend.md](home-backend.md)。WinSW 二进制和可信哈希由安装参数显式提供。
4. APK 构建与正式签名：按 [android-home-status.md](android-home-status.md)。签名证书由应用所有者保管；缺少签名配置会失败，不退回调试证书。
5. 部署时先在电脑配置 GitHub 与 DeepSeek，备份 SQLite 和对应加密密钥，再从真实桌面运行环境导出聊天/工作台资料并初始化工作区。随后手机连接同一 tailnet 的 HTTPS 地址和 API_SECRET。

迁移后，纯 GitHub token 更新仍可执行，但后端必须先验证新 token 属于绑定账户；携带业务设置的旧全量写入仍被拒绝。模型配置使用独立配置 API；当前使用的模型不加入业务同步。

## 自动验证证据

- 根目录完整 Vitest：2,136 项通过，原始报告 `output/android-home-backend/frontend-tests-final.json`；此后新增回归由相关测试集单独验证，最终数量见更新记录。
- 服务端完整测试覆盖真实 SQLite、真实 Express 中间件、迁移、同步、任务、取消、恢复和提案效果台账；外部 GitHub/模型使用固定夹具，未发生付费调用或真实 Star 修改。
- 双客户端集成：`server/tests/integration/homeWorkspace.test.ts` 使用两个独立 IndexedDB 客户端及真实服务路由，验证丢失确认、冲突解决、任务幂等、消息与证据复制。
- 浏览器：`python scripts/test-mobile-browser.py`，合成 5,000 个仓库和 10,000 条历史消息；仓库初始渲染 40 条，消息初始渲染 30 条，加载更多分别为 80/60 条；验证搜索、分类、离线编辑、刷新保留与重新上传。报告及截图在 `output/android-home-backend/`。该耗时只描述本机浏览器和模拟 HTTP，不代表真机或移动网络速度。
- 桌面 production Vite 构建与包体积门禁、mobile production 构建、Capacitor sync、Gradle assembleDebug 通过。
- 全量 TypeScript、前端边界和共享核心边界检查通过；新增模块进行定向 ESLint。全仓库仍有原先其他功能相关 lint 问题，不能声明整个仓库 lint 已通过。
- 后端发布目录在独立临时数据目录进行真实生产启动、健康/鉴权和正常关闭冒烟；没有迁移用户当前数据库或安装系统服务。

## 15 项验收的实际状态

| 项目 | 本次证据 | 仍需现场验收 |
| --- | --- | --- |
| 异网连接 | HTTPS 校验、鉴权与 Serve 部署脚本 | 手机关闭 Wi-Fi 后连真实 tailnet |
| 运行独立 | 独立生产 Node 入口启动与关闭 | 安装服务后关闭 Electron、注销 Windows |
| 模型隔离 | 当前模型不进同步；手机仅选择后端 DeepSeek | 真实 AGY/DeepSeek 两端切换 |
| 完整同步 | 业务集合、聊天/证据集成与桌面投影测试 | 真实桌面数据导入数量、内容对照 |
| 离线恢复 | 不可变请求重放、浏览器离线编辑与重载 | APK 杀进程/系统回收/覆盖升级 |
| 冲突保护 | 同记录版本冲突、双客户端解决、连续离线编辑 | 真机两端同时编辑 |
| 锁定保护 | AI 写入版本与锁定规则测试 | 真实长任务期间人工锁定 |
| 后台执行 | 后端持久队列不依赖 SSE 连接 | 手机锁屏、真实 DeepSeek 完成 |
| 重启恢复 | 安全检查点自动续跑、未知调用中断、效果去重测试 | 服务管理器重启和机器重启 |
| 流式恢复 | SSE 解析、事件序号、过期快照、前端替换测试 | 移动网络切换 |
| 误账户保护 | API 密钥、数字账户 ID、旧协议写入、换 token 测试 | 用户真实账户配置 |
| 数据迁移 | 重复迁移、预览摘要、稳定 ID、备份测试 | 升级真实资料与 APK 覆盖安装 |
| 外部写入 | 显式确认与远端状态核对的模拟 API 测试 | 自己的测试仓库真实 Star/unstar |
| 恢复演练 | SQLite WAL 在线备份、完整性及新路径恢复测试 | 独立目标目录恢复真实加密配置 |
| 性能基线 | 5k 仓库/10k 消息 IDB 与浏览器分页 | Android 10 及较新真机的内存/滚动/输入 |

## 明确的限制

- 当前没有连接真实 Android 手机。本机模拟器此前启动失败，不能把浏览器视口测试当作 Android 生命周期测试。
- 正式签名 APK 尚未生成：需要所有者提供长期保存的签名证书与密码配置。不要把密码写入仓库或聊天。
- 本次未替用户登录 Tailscale、安装服务、改变电源策略、重启电脑或迁移真实数据库；这些按部署手册在目标电脑执行。
- 含本地目录/本地源码证据的桌面研究会话目前保守地留在桌面，不自动导出其标题/结论到手机；远程仓库会话和项目正常同步。
- 共享核心已抽离通用提示辅助、需求/证据质量等纯逻辑；服务端与 AGY 的全部编排还不是单一实现，不宣称二者研究质量完全相同。
- 工作台远程研究是受预算限制的代码/文档取证，不是远程桌面、任意目录执行或完整代码审计。
- WebDAV 仍是既有可选能力，当前自动 SQLite 备份保存在本机目录；没有新增自动把 SQLite 快照上传 WebDAV 的后台作业。同盘副本不是异机备份。
- Fork/Gist/完整发现频道/高级下载不属于首版手机适配；桌面原功能保留。

## 最终复核记录

- 服务端最终完整回归：**186/186**，`output/android-home-backend/backend-tests-final.json`。
- 最后表单并发与离线版本修复后的相关前端回归：**24/24**，`output/android-home-backend/targeted-tests-final.json`；完整前端前一轮 **2,136/2,136**，不将两轮数量重复累计。
- 最终 TypeScript 检查通过；本次新增同步/手机/任务模块定向 lint 通过。全仓库剩余 **39** 个 lint 错误分布于既有工作台、发现和搜索文件，清单在 `output/android-home-backend/lint-final.json`。
- `apksigner verify --verbose` 成功；包名 `io.github.gsm.personal.debug`，版本 `0.8.4-debug`，minSdk 29、targetSdk 36；APK SHA-256：`272824D27F149D8FA8E9693DAE3B3E6CD8A753A48267876A9679C5CE157319CA`。
- 固定运行时发布清单：`output/home-backend/release-0.8.4-node22/release-manifest.json`；隔离生产入口冒烟记录：`output/home-backend/smoke-node22-final-20260929/smoke-result.json`。

以上未验证项不能以单元测试通过代替，达到用户定义的最终完成标准须完成真实部署演练。

## 后续本机部署

2026-09-29 已完成真实 Windows 服务、Tailscale 私人 HTTPS、桌面资料迁移及 DeepSeek 任务验证。上文“未安装服务/未迁移真实资料”描述的是开发交付时状态，当前安装结果与仍未完成的现场验收详见 [本机安装记录](local-deployment-2026-09-29.md)。
