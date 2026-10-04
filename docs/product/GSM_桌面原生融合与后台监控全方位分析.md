# GithubStarsManager 本机 Windows 桌面融合与后台边界分析

> **阶段 4～8 代码更新（2026-10-03）**：阶段 8 已修 Windows 托盘三态、菜单状态/minimizeToTray 和最终 BrowserWindow session-end。Node 契约与隔离 native 窗口状态通过；真实 Shell 点击/注销/重启/关机尚未验收，不推断其它平台实机行为。 详见 [连续开发交付报告](GSM_阶段4至8连续开发交付报告.md)。

> **用户决策（2026-10-03）**：仅本机 Windows；保留现有本机 Home backend / Home Sync v2；Release 后台通知不列为确定目标。
> **当前方向**：保持生产 file-origin 入口与已有 desktop prefs，按实际问题修 Windows 窗口/托盘/退出；不扩展全平台适配、安装包或后台业务。
> **现状校准**：原方案中重复桌面偏好、独立 main Release truth、app 级 session-end、强制 GC/working-set trim 与无 benchmark 的内存承诺不采用。
> **本轮状态**：只修订文档，没有操作服务、托盘、快捷方式或用户数据。

## 0. 已交付的个人入口

[P0.2.1 记录](../personal/upgrades/P0.2.1-desktop-startup.md)与 [start-home-desktop.cjs](../../scripts/start-home-desktop.cjs)说明日常入口使用已有构建页面，不启动 Vite 或临时 backend，已有 Windows Home 服务独立运行。保留当前 app identity/userData/file-origin 与 5174 开发来源，不再次做通用启动器。

用户反馈多个页面大量内容突然展示时卡顿。这优先指向 renderer/派生计算/挂载等待采样路径，不能先归因于 Electron main 或后台内存。未测量的根因不作为事实。

## 1. 当前能力与真实缺口

### 1.1 已经实现，不应重复开发

桌面三项基础偏好已经完整存在于当前代码：

| 能力 | 当前实现 |
| --- | --- |
| 开机自启 autoLaunch | electron/desktopPrefs.js 默认值、electron/main.js applyAutoLaunch、IPC、preload、electronProxy、useDesktopActions、GeneralPanel 均已接入 |
| 关闭到托盘 closeToTray | desktopPrefs 持久化、BrowserWindow close 拦截、IPC 与 GeneralPanel UI 已实现 |
| 最小化到托盘 minimizeToTray | desktopPrefs 持久化、BrowserWindow minimize 拦截、IPC 与 GeneralPanel UI 已实现 |
| Linux autostart | desktopPrefs.js 已生成 XDG autostart desktop entry |
| 设置失败回滚 | autoLaunch 已有 OS apply 失败后的偏好回滚；前端 useDesktopActions 也有 optimistic rollback |

因此后续不能再创建另一套 desktop preferences schema 或另一组重复 UI。新增桌面能力应继续围绕 desktopPrefs.js、main.js、preload.js、electronProxy.ts 与 useDesktopActions 扩展。

当前 desktopPrefs.js 使用直接 writeFileSync。若未来把桌面偏好扩大为更重要的状态，可把持久化升级为同目录临时文件 + rename 的原子替换；本文不再声称它已经是原子持久化。

### 1.2 当前代码缺口与本机优先级

| 项目 | 已核对的代码 | 本机范围 |
| --- | --- | --- |
| 托盘 unfocused 窗口 | tray click 只判 isVisible，未聚焦窗口第一次点击会被 hide | 有实际影响时优先修三态 |
| 托盘菜单 | 静态“显示主窗口”，含 autoLaunch/closeToTray，漏 minimizeToTray | 沿用 desktopPrefs，局部补齐；不新建设置体系 |
| Windows session end | close-to-tray 拦截存在，未监听 BrowserWindow query-session-end/session-end | 属当前 OS 退出正确性候选，实机验收需注销/重启/关机 |
| Windows AUMID | 未调用 setAppUserModelId | 系统通知未排期，不作为当前必要修复 |
| builder 图标 | 配置引用不存在的 dist/vite.svg | 确实有错误；仅未来明确需要打包安装时处理，不影响现有 built-page 日常启动 |
| macOS activate | 只有窗口数为零才 createWindow，隐藏现有窗口不会恢复 | 保留已识别事实，不列本机任务，不新增 Dock/icns 适配 |
| Linux tray/autostart | 已有兼容代码 | 保留，未在本机实测，不安排新 Linux 适配 |

## 2. 桌面生命周期目标状态机

### 2.1 restoreMainWindow 作为唯一恢复入口

现有 restoreMainWindow 已经包含：

- destroyed / missing 时 createWindow；
- minimized 时 restore；
- hidden 时 show；
- 最后 focus。

本机 second-instance 与托盘左键恢复应继续复用这个入口。系统通知、macOS Dock 等只在未来明确需要时接入，不另写恢复状态机。

若未来需要修 macOS（当前不排期），其已识别修正原则为：

1. 若 mainWindow 存在且未销毁，直接 restoreMainWindow；
2. 只有 mainWindow 不存在时才 createWindow；
3. 不再用 BrowserWindow.getAllWindows().length === 0 判断“是否需要响应 Dock 点击”。

### 2.2 托盘三态行为

本机 Windows 托盘点击至少区分三种状态（Linux 未在本机验证）：

| 当前窗口状态 | 点击行为 |
| --- | --- |
| hidden 或 minimized | restore + show + focus |
| visible 但未 focused | focus / bring to front |
| visible 且 focused | 可 hide 到 tray |

macOS 单独遵循菜单栏习惯。当前 Tray 已设置 context menu，后续不应简单把 Windows 的“左键 toggle window”逻辑原样套到 macOS。macOS 可保持菜单为主，Dock activate 专门负责恢复窗口。

托盘右键菜单应动态计算：

- 显示主窗口 / 隐藏主窗口；
- 开机自动启动；
- 关闭时最小化到托盘；
- 最小化时隐藏到托盘；
- 退出。

不新增“立即检查 Release”或后台 monitor 菜单。现有前台 Release refresh 保留，不另做采集链路。

### 2.3 Windows query-session-end / session-end

原文建议 app.on('session-end') 不符合当前 Electron 生命周期位置。Windows 会话结束事件属于 BrowserWindow。

在创建 mainWindow 后应监听 query-session-end 与 session-end：

- query-session-end 到来时置 isQuitting = true；
- 不调用 preventDefault；
- session-end 再次保证 isQuitting = true；
- close handler 因 isQuitting 已为 true，不再执行 close-to-tray 拦截。

平台验证必须覆盖 Windows 注销、重启、关机三条路径，而不是只验证 app.quit。

### 2.4 second-instance

当前 second-instance 只 restoreMainWindow。短期这足以保证单实例唤醒；当系统通知、deep link 或文件关联需要携带目标时，再扩展 commandLine / additionalData 的解析。

当前仅保持已有单实例恢复，不新增导航协议或 target。未来明确需要携带导航目标时，先复用既有 task target，并单独评估必要的参数解析。

## 3. 打包与 AUMID：记录错误，但不作为日常优化前置

`electron-builder.yml` 的 appId 为 `com.github-stars-manager.app`，win/mac/dmg/linux 图标仍引用 `dist/vite.svg`。本轮文件核对：该 SVG 不存在，`build/icon.ico`、`build/icon.png`、`public/icon.png` 与当前 `dist/icon.png` 存在，`build/icon.icns` 不存在。

日常入口直接运行当前 Electron 与 built page，不走安装包发布，因此当前不生成 icns、不新增 Linux 产物、不改 builder/publish CI、不建设全平台 icon gate。

若用户将来决定需要 Windows 安装包，再使用现有 `build/icon.ico` 并验证打包资源/应用身份；系统通知需要时再处理稳定 AUMID、快捷方式与 Action Center。开发态测试不能代替真实 Windows 安装包验收。其它平台资源必须在各自需求与环境下验证。

## 4. 现有 Release 链路保留，后台采集不排期

### 4.1 当前 Release domain 已经存在

当前代码已经具备一条完整的前台 Release 业务链：

- resolveReleaseSources 统一解析 starred subscription、Watch/custom sources；
- useReleaseTimelineActions 通过 getMultipleRepositoryReleases 获取 Release；
- includePreRelease=false 时，现有 GitHub API 实现会继续翻页寻找最新 stable release，而不是只看 per_page=1；
- 新 Release 按 release ID 判重后 addReleases；
- 已存在 Release 的正文/资产变化通过 upsertReleases 更新；
- 刷新前记录当前 account owner，返回后再次比较 user id 与 token，避免账户切换后串写；
- Home projection 已把 releases 与 releaseSubscriptions 纳入同步记录；
- server 已有 Release UPSERT；
- ReleaseTimeline 已有 useTaskTarget('releases', releaseId) 定位入口。

因此后台监控不能在 Electron main 里维护另一套 latest tag、release cursor、subscription list 与独立 release cache。

### 4.2 为什么原文的 main-process latest-tag monitor 不再采用

原方案存在四类一致性风险：

1. 只存 tag_name 不等于完整 Release 事实；通知点击时 timeline 可能还没有该 Release。
2. 两次轮询间出现多个 Release 时，单 latest tag 比较会丢事件。
3. 只请求 releases?per_page=1 会削弱当前“跳过 prerelease、继续找 stable”的既有语义。
4. main-process cache 与 Home Sync/server Release state 同时存在，会形成第二个业务真相源。

后台 monitor 的职责应是“生产符合现有 Release domain 的数据”，而不是拥有自己的 Release 模型。

## 5. 不新增后台 Release 产品

本机已存在 Home backend，不代表需要将它扩成 Release scheduler。用户本轮未选择后台通知，因此不新增检查水位、monitor subscriptions、ETag cache、轮询 timer、事件队列、notification IPC、系统通知或 credential vault 迁移。

现有前台 `resolveReleaseSources -> getMultipleRepositoryReleases -> add/upsertReleases -> Home projection` 保留，Electron main 仍只做系统集成。

若以后明确需要后台提醒，应另行让用户决定运行方式与频率，并复用同一 Release domain 和持久化路径；每个任务说明 account/workspace、取消、retry/backoff、隐藏行为、rate limit 与故障恢复。不能建设第二套 latest-tag/cursor/Release truth。

## 6. 保留分页与账户安全

现有 includePreRelease=false 会继续翻页寻找 stable，正文/资产更新通过 upsert；不要为本机性能把它改成 `per_page=1` 或只比较 tag_name。

请求完成前后保留 account owner/token/stale 校验，Home 按现有 account/workspace 同步。未来派生 Release lookup 只由领域集合重算，不持久化第二份业务状态。

## 7. 通知导航只作未来边界说明

当前 `useTaskTarget('releases', releaseId)` 和 pending-task-target 已有 owner 校验。若用户未来选择 Notification，必须先 ingest Release，再复用这个 target；renderer 未 ready 或 Release 尚不可见时需要受控等待，避免把一次找不到的目标永久丢弃。

当前不实现 ready queue、deep-link 协议、跨进程通知事件或安装包 Action Center 验证，也不把这些设为 tray/session-end 修复的依赖。

## 8. 后台资源治理

### 8.1 删除强制工作集修剪方案

不采用以下方案：

- PowerShell 调 System.GC；
- 修改 MinWorkingSet；
- 定时调用外部 shell 强制回收；
- 为 Electron 开启 expose-gc 并主动 GC；
- 宣称隐藏窗口后可以稳定从 200MB 降到 30MB/50MB。

这些做法不能解决真实对象存活、DOM 过量或缓存过量问题，还可能带来重新换入、抖动、安全软件拦截和平台差异。

### 8.2 当前大量内容卡顿的优先级

1. 在主仓库与发现等实际受影响页面采样，区分派生计算、重复扫描、React commit、布局与挂载。
2. 缩小宽订阅、Release N×M 与分组/发现重复查找；避免无关任务进度更新重派生整批结果。
3. 同条件复测；仅剩 DOM 瓶颈时由用户决定虚拟化范围。
4. 如隐藏/空闲仍有问题，检查现有视觉 timer、Home 请求和缓存生命周期；不默认新增后台调度平台。
5. CPU/内存按 main、renderer、GPU 分别观察，记录窗口状态与采样时长，让 Chromium/OS 正常管理工作集。

只写实测变化，不预先承诺绝对 MB 数。本机多页面突然挂载卡顿也不能靠 trim main PID 的工作集解决。

## 9. 独立候选任务

| 候选 | 触发条件 | 范围 | 验证 |
| --- | --- | --- | --- |
| Windows tray 三态 | 复现未聚焦点击被隐藏 | 既有 main/restoreMainWindow | visible-focused/unfocused、hidden、minimized、second instance |
| tray 菜单补齐 | 实际菜单操作需要 | 既有 desktopPrefs/IPC | prefs 单一来源、apply 失败回滚、菜单反映当前状态 |
| Windows session-end | 退出路径正确性修复 | BrowserWindow 事件与 close handler | 单元/VM 路径 + 真实注销/重启/关机；未实测标明 |
| 当前资源诊断 | 大量内容/隐藏后问题 | renderer 与既有状态路径 | 相同 fixture 比较，先算法/订阅，再按需 windowing |

一次只做一个子阶段；不顺带添加 AUMID、installers、macOS/Linux、通知或 Release scheduler。本轮未开始任何实现。

## 10. 风险与现有验证

- 账户切换：保留现有请求完成检查与 Home identity；不能把后台/跨进程结果写进新账户。
- 退出生命周期：纯 helper/VM 测试不能模拟完整 Windows 会话结束；需要实机时应明确影响和未验证项。
- 平台差异：Windows tray 规则不外推 macOS menu bar；Linux tray 可用性也不由本机证明。
- Release 分叉：性能改动不能削弱 stable/prerelease 分页、body/assets upsert 和单仓失败隔离。
- 应用身份：保留 file-origin/userData，生产与开发数据不混合；builder 错误不等于当前启动器失效。

现有测试可复用 `electron/desktopPrefs.test.js`、`scripts/start-home-desktop.test.cjs`、`scripts/desktop-dev-address.test.mjs`、`src/components/settings/GeneralPanel.desktop.test.tsx`、`src/services/githubApi.test.ts`、`src/components/ReleaseTimeline.test.tsx` 与 Home 测试。它们覆盖各自契约，不能冒充所有 Windows session-end 或真实系统通知验收。

涉及 Electron 修改时运行对应 Node/IPC、前端 typecheck/集成、`git diff --check`；只有打包改动才需 build/installer。平台结论明确标 Windows 实测、静态检查或未验证，不要求为本机任务执行 macOS/Linux 测试。

## 11. 本机验收边界

当前 Windows 任务只验收实际修改的 close/minimize/tray/second-instance/exit 行为及偏好回滚。用户/OS reduced-motion 与大量内容 renderer 性能由对应专项覆盖，不把后台内存绝对值设为交付指标。

macOS/Linux 保留代码兼容，当前未实机验证；Dock activate 与缺 icns 仅留作已知问题，不能列为 Windows P0。系统通知、AUMID、后台 Release 与多平台打包均无当前验收任务。

## 12. 下一步

大量内容展示卡顿先按列表/发现专项定位；Windows 生命周期问题另做可独立回滚的小修复。保留已交付入口、desktop prefs 与本机 Home，不以本轮文档简化启动平台迁移或后台业务开发。
