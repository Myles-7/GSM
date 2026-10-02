# 手机发现修复交付记录

日期：2026-09-30。最后实际服务检查：20:10（Asia/Shanghai）。

## 当前结论

代码修复、回归、隔离后端包验证及 APK 构建已完成。**实际电脑服务尚未升级，完整发布尚未完成。** Windows 在启动管理员升级时返回“用户取消操作”。没有停止原服务或改用其他服务绕过此操作。

当前 `GSMBackend` 仍运行 `home-backend/releases/0.8.4-20260930061742122/server`；HTTPS 健康接口返回 200，未认证能力请求返回 401，认证能力请求返回 200。发现能力没有 `stablePopular` / `publicReleases`。APK 保留真实能力检测，因此旧服务下两个新频道仍显示升级提示。

## 修复内容

- 增加按原请求 ID 查询任务回执的账户约束接口。手机进入页面不会自动重发任务；点击“恢复上次提交”先查回执，必要时使用相同请求 ID 和原始载荷恢复提交。
- 明确、可证明的提交拒绝才解除手机提交限制；断网、超时、内部错误、鉴权错误和请求冲突保留未确认请求。服务持久保存拒绝回执，避免旧请求迟到后又被接收。拒绝与创建均通过 SQLite 事务检查。
- 恢复前验证当前账户、工作区、任务输入和原请求。选中缓存任务不能替代后端确认，也不能清除另一账户的未确认提交。
- 自定义频道提供原位恢复入口；恢复后进入对应频道或会话，生成完成后打开期刊。生成日期不依赖 Android 的区域格式。
- 修复研究搜索在已明确拒绝后仍被旧草稿限制的问题；不确定提交仍保留原始输入和恢复记录。
- 趋势优先读取 GitHub 官方趋势页面，RSS 为备用；识别排名标题，避免广告、导航链接混入。仓库信息并行补充，有总时间限制，部分失败保留可用项目并提示。
- 热门发布展示实际 Release 标签、发布时间、说明和来源链接；包含候选搜索在内的整个请求受 60 秒预算约束。限流时停止新批次；全部读取失败返回错误，不将失败伪装为空结果。
- 最受欢迎使用持久稳定列表和游标，继续浏览追加并去重，保持既有顺序与位置；刷新才新建列表。手机发现读取可等待上述后端预算，仍支持取消。

未恢复已删除的手机入口；未修改桌面 AGY 选择。手机缓存、草稿及待上传修改继续保留。

## 发布文件

- APK：`output/discovery-repair/GSM-discovery-repair-debug.apk`
- 最终后端包：`output/home-backend/release-discovery-repair-final`
- 电脑升级入口：根目录 `GSM-升级电脑后端.cmd`
- 升级启动脚本：`.deployment-staging/launch-discovery-upgrade.ps1`
- 升级执行脚本：`.deployment-staging/upgrade-discovery-repair.ps1`

不要部署较早的 `release-discovery-repair` 包，它不包含最终的持久拒绝回执修复。

APK 已验证签名有效，与 `output/mobile-usability/GSM-mobile-usability-debug.apk` 的应用 ID 和证书相同：

| 项目 | 值 |
|---|---|
| applicationId | `io.github.gsm.personal.debug` |
| versionCode / versionName | `8004` / `0.8.4-debug` |
| minSdk / targetSdk | `29` / `36` |
| 证书 SHA-256 | `a900bdb114d09bdd51da8e81f26f58ca64aebce59c636afd436e7795a16abd3f` |
| APK SHA-256 | `6DA4DAAB23B15FCEA0C95023205D1EDCFE5823994BD3BDD8D1369EACFD7474EC` |

本文件为沿用既有证书的 debug APK，不是用户正式发布证书签名的 release APK。

## 自动验证

| 检查 | 结果 / 记录 |
|---|---|
| 前端完整 Vitest | 2303 / 2303；`output/discovery-repair/frontend-full.json` |
| 后端完整 Vitest | 280 / 280；`output/discovery-repair/backend-full.json` |
| 手机和 Home 子集 | 185 / 185（包含在前端总数内）；`mobile-home.json` |
| 类型检查 | 通过；`typecheck.log` |
| 依赖边界及共享 AI 核心边界 | 通过 |
| 修改文件 ESLint | 0 错误；5 条现有发现页面 Hook 依赖警告，未宣称全库无警告 |
| 最终生产后端包 | Node 22.23.3、原生 SQLite、HTTP 鉴权、能力、请求去重、明确拒绝、回执和账户隔离通过；`isolated-package.json` |
| 自定义恢复浏览器回归 | 页面无自动 POST；原载荷恢复；拒绝后解除限制；下一次生成可打开期刊；`recovery-browser.json` |
| 三页面布局 | 360 / 390 / 430 / 768 / 1024px，明暗主题，共 30 组无横向溢出 |
| 额外视口 | 大字号横屏 3 组；模拟键盘 1 组发送按钮可见 |
| 大数据浏览 | 5000 仓库、10000 消息；列表分段渲染，历史消息分页，README 位置恢复，热门列表追加与位置恢复 |
| 手机静态包及 Android Gradle | 构建成功；`mobile-build.log`、`android-build.log` |

布局记录位于 `output/mobile-usability/browser-report.json`。测试页面使用合成 API，不能当作实际 GitHub、DeepSeek 或真机验收。

最终回归修正了两处测试夹具：自动加载改变了旧的“点击加载更多”测试假设；jsdom 的 DOMException 不能只用 `instanceof Error` 判定。未因此改变生产 AGY 分析逻辑。

## 备份及升级

实际数据库通过 SQLite 在线一致性备份保存至 `.deployment-staging/pre-discovery-repair-20260930.sqlite`，完整性检查为 `ok`。记录位于 `output/discovery-repair/backup-report.json`。备份时有 62 个仓库、14 个会话、57 条消息，5 个已完成任务。备份不含加密密钥；恢复仍需现有独立密钥文件。

升级脚本使用最终后端包及固定 Node 22.23.3；保持现有地址、端口、账户、凭据和数据目录。运行根目录升级入口并在 Windows UAC 允许管理员操作。脚本结果位于 `.deployment-staging/discovery-repair-upgrade-result.json`；上次 UAC 取消，没有生成此结果。已有结果时应先检查，不盲目重复运行。

成功升级后还必须执行：

1. 核对服务运行目录、实际能力及业务数量；重新握手。
2. 用 `.deployment-staging/verify-discovery-live.mjs` 验证实际私人 HTTPS 鉴权、能力、回执和账户隔离。
3. 用 `.deployment-staging/probe-discovery-feeds.mjs` 检查趋势、真实 Release、热门游标及重试顺序、主题、搜索和周刊。
4. 对实际自定义频道仅进行一次明确生成验证；保留请求 ID，先查询回执，不反复新建任务或盲目恢复。

上述脚本使用固定 Node 运行；读取受保护服务凭据，不应复制凭据到手机包或业务导出中。

## 未验收

- 真实服务升级及升级后 HTTPS 各频道验证。
- 实际自定义频道 DeepSeek 生成、期刊同步。
- 手机覆盖安装、旧提交恢复、移动数据连接、系统返回、软键盘及锁屏恢复。ADB 当前没有连接设备。

因此本次状态是“修复及构建完成，部署待 UAC，真机待验收”，不能宣称手机上的所有发现频道已经恢复。
