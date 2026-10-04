# GSM 阶段 4～8 连续开发交付报告

日期：2026-10-03（Asia/Shanghai）。仅当前 Windows 本机。4A 核对成立，4B～8 按最小子任务实施并验证。未提交、发布、替换日常 dist；未修改真实用户数据、触发 Star/付费 AI/索引重建或执行注销、重启、关机。已有及并行 HTML Reading 等修改保留。

## 1. 本地备份：覆盖与局部安全恢复

根因是本地 JSON 遗漏已有子分类、组织顺序和部分偏好，旧导入跨多个 durable store 没有全文件原子提交。此次补六个字段，并将安全恢复与兼容导入拆为独立操作，不自动连跑。

新导出 v1.1 保留 version/exportDate/appVersion/data，增加 identity/included。appVersion 来自 package 0.8.4。账户业务要求 GitHub account 与 Home workspace 可确认；配置 Home 但尚未确认 workspace 时拒绝业务快照。导出固定开始身份，异步完成再次检查；纯全局偏好允许无账户，不能用于恢复账户业务。旧本地 v1.0、flat WebDAV v1.2 继续读取，缺身份显式确认；未知版本或现有身份不匹配拒绝。WebDAV 写出协议不变。

| 范围 | 导出覆盖 | 恢复边界 |
| --- | --- | --- |
| Repository | 原快照保留 | 安全恢复所选资料/归属，不操作真实 Star；同 ID/full_name 冲突拒绝 |
| 分类组织 | 原 customCategories/hiddenDefaultCategoryIds/defaultCategoryOverrides/categoryOrder；新增 subcategories/subcategoryOrder/repositoryOrder | 校验完整组织后正规化归属；merge 当前同 ID 优先，新 ID 追加；replace 只处理选中且实际存在的字段 |
| 偏好 | 原主题/语言/侧栏/Release 视图状态；新增 themeTokens/repositoryCardFields/repositoryViewMode | 明确选中后按备份恢复；fontScale 0.75～1.5 与现有 normalizer 一致 |
| Release/订阅/已读、Discovery、AI/WebDAV/连接配置、assetFilters/searchFilters | 既有选择保留 | 独立兼容导入；不承诺这些域的完整原子恢复 |
| List 映射、Workbench/chat 历史、HTML Reading、vault、backend SQLite、全机器文件 | 不新增覆盖 | 不恢复、不清空；组织操作不能使未选 List 映射悬空 |

absent 不参与；replace 的显式空集合仅清空该选中字段；非法 null 拒绝，合法空字符串保留。masked secret 不覆盖有效凭据，继续使用原配置 helper 和用户选择。导出覆盖与实际 roundtrip 支持分开说明。

Owner 仍为原 Store 持久化域或 Home canonical records/本地 projection，配置 owner 不变，没有第二业务库。计划/lookup 是可重建内存状态。

专用恢复 journal version=1，key=`gsm-local-backup-journal:<account>`，payload 绑定 account/workspace 和 Home namespace；每账户一个未完成恢复。只保存选中 pre-image/target、SHA-256、checkpoint、必要稳定 Home opId/baseVersion，不含凭据，不供业务查询/正常备份导出。坏 journal、越界 snapshot/operation、身份/fingerprint 漂移拒绝写入。无需迁移已有数据；完成/撤回后清 journal 和局部 Home marker。未完成时不能直接 reset/delete，应从 UI 继续/撤回。

流程：检查预览、活跃 writer、pending/inFlight/未确认操作 → 暂停/drain 同步 → journal 持久化/重读 → 既有 writer gate/Home maintenance lock → 局部 IDB 事务暂存所选 records/outbox → 更新 projection/偏好、flush、重读验证/checkpoint → 释放维护并恢复原 Home v2。保留其它 collections、组织未选字段和 canonical shadow；显示“本机已恢复，Home 待同步”，不称服务器原子恢复。

中断/重启后继续或撤回；派发前可以局部撤回，ACK/version/queued 内容漂移后拒绝盲目覆盖 canonical。派发后的固定请求、receipt、冲突恢复沿用 Home v2，不新增服务器协议或后台重试任务。Home 恢复需重新确认 capabilities；离线或 scope 不明时保持保护。

实际文件：`src/services/localBackup.ts`、`localBackupScope.ts`、`localBackupRestorePlan.ts`、`localBackupRestore.ts`、`localBackupRecoveryGate.ts`，三个对应测试；`src/components/settings/LocalBackupRestorePanel.tsx`、`DataManagementPanel.tsx/.test.tsx`；`src/home/database.ts`、`desktop.ts`；`src/services/repositoryIdentityGate.ts`；`src/store/useAppStore.ts`；`src/features/lifecycle/hooks/useBackendLifecycle.ts/.test.tsx`。

验证：codec legacy/current roundtrip、empty/null/absent、身份冲突、masked secret、实际导出与独立预览、Home 局部事务、checkpoint/应用保存中断、继续/撤回、pending 保留、账户切换、漂移、ACK 后禁止盲目撤回、journal 越界拒绝。使用 fake IDB 和 mock storage/provider，未在真实 Home/用户资料上试恢复。

## 2. 搜索：候选与提交状态

原 vector TopK/scoreMap 硬候选及 SearchBar 后续 effect 会丢失 exact/lexical/未索引仓库，筛选还会重设提交结果。现改为 exact full_name → exact name（同名 owner 全保留）→ 原 provider/rerank → lexical-only 的 ID 并集，从当前实体去重；不伪造 score、不扩大 rerank 输入。

现有 Hook 内存 session 保存提交查询 identity/provider IDs/排序模式。新提交恢复相关性，主动排序覆盖；custom 使用 repositoryOrder，facet 不重 provider 请求。实体更新读取当前 metadata/删除失效 ID。输入/空查询/新提交、账户/token/相关配置/语言变化使旧 session 失效，迟到结果不能提交；保留原取消、HyDE、threshold、降级、实时普通搜索和 IME。旧 refs 暂留兼容，但不再决定 SearchBar 候选。没有新 Store/数据库/完整仓库副本/依赖。

实际文件：`src/utils/submittedRepositorySearch.ts`、`src/utils/__fixtures__/submittedRepositorySearch.json`、`src/features/repositories/hooks/useSearchActions.ts/.test.tsx`、`src/components/SearchBar.tsx/.test.tsx`。

七仓库 corpus 接入实际 Hook，覆盖 exact owner/repo、exact name、同名 owner、未索引、vector unavailable、中文自然语言、semantic/rerank；实际 SearchBar 后续 effect、facets、显式/custom 排序、实体变化、取消/迟到、身份/配置/语言、空查询与现有 IME 回归通过。provider 全 mock，未调用付费服务或重建索引。这是正确性修复，未虚构搜索性能收益。

## 3. 启动：一处有 trace 证据的修复

复用匿名 data fixture、profile/network/main 护栏与 tracing。普通 production/file-origin，不加载完整 renderer 性能 fixture；100 仓库、200 Release、2 分类、5 分组，grid 首批 50 卡。1200×800 CSS px、DPR 1.5、窗口可见聚焦/DevTools 关闭；i7-14650HX、约 32 GiB、Electron 44.4.5/Chromium 152.0.7977.130。Home 为唯一隔离 loopback mock，禁止真实 API。

每组采 3 对相同业务数据的新 profile 首次进程与正常退出后的同 profile restart；另一次空 profile 首次使用。不是 OS 冷缓存实验；observer/trace 开销包含在样本，trace setup 另记。首屏 mark 是首个水合后绘制机会，不等于全部内容最终 paint。

六次前 trace 都把约 23～25 ms CPU 样本归因至 applyThemeTokens 的 computed style 读取。默认 accent 未使用该背景却仍读取。唯一补丁：仅自定义 accent 读取表面背景，保持 contrast/ring/偏好/首次使用语义。文件 `src/utils/themeTokens.ts/.test.ts`。

| 指标（ms，median / min–max，n=3） | 前 | 后 |
| --- | --- | --- |
| 新 profile 首个水合后绘制机会 | 362.9 / 358.1–364.8 | 339.2 / 334.1–341.4 |
| 同 profile restart 绘制机会 | 362.5 / 359.7–388.9 | 335.7 / 331.5–382.5 |
| 新 profile hydration | 24.4 / 23.7–25.0 | 25.4 / 25.1–32.3 |
| restart hydration | 25.4 / 23.9–26.1 | 25.6 / 25.2–33.5 |
| mock Home 首次 ready | 703.0 / 689.3–709.3 | 650.6 / 639.0–661.5 |
| mock Home restart ready | 574.8 / 571.7–600.2 | 538.3 / 536.8–566.4 |

initial long task 前 217/224/227/221/221/220 ms，后 195/193/191/192/190/194 ms。首屏 median 减少 23.7/26.8 ms；样本少、restart 范围重叠，不宣称稳定 p95 或整体卡顿解决。空 profile 0 卡，187.1→189.5 ms，首次使用语义检查成立。app_state get 约 1～2 ms；Home ready 位于首屏后，不叠加到首屏。i18n/chunk/font 独立关键路径贡献未精确证实，不额外修改。

原始 `output/stages4-8/startup/baseline.json`、`startup-after/baseline.json` 及各 7 份 trace。新增 `scripts/diagnose-startup.cjs`、`scripts/fixtures/startup-electron.cjs`，仅扩展原 `render-performance-electron.cjs` 的精确 mock API 白名单。构建到 output，避开版本同步 prebuild，不覆盖日常 dist。

为排除并行源码漂移，对前后生产 source maps 中 669 个应用模块进行内容 hash 对照：只有 `utils/themeTokens.ts` 改变，没有新增/缺失模块；见 `output/stages4-8/startup-source-comparison.json`。无需重新执行性能矩阵。

仍有 grid 初次 getBoundingClientRect 约 83～85 ms CPU 采样及 50 卡批挂载，DOM/layout/挂载瓶颈仍存在。本轮不做第二项启动优化，不扩展虚拟化。

## 4. 主仓库 grid：语言点边界

light/dark 实际截图证实黄色语言点在白卡片上边界偏弱。只在 grid 传 optional outlinedLanguage，使用 muted-foreground/50 细 outline；原语言颜色、10px 布局尺寸、list/共享文本默认不变。不宣称所有主题或无障碍对比度全面达标。

文件：`src/components/RepositoryLanguageStars.tsx`、`RepositoryCard.tsx` 的一行 prop、`RepositoryCard.test.tsx`。保护原并行 Card 修改，不改详情组件或新建动效。

截图：`output/stages4-8/grid-before/{light,dark}.png`、`grid-after/{light,dark,keyboard-focus,os-reduced-motion,token-reduced-motion}.png`。`grid-after/visual.json` 记录实际 CSS、零 pageerror/禁止调用、键盘 Enter 开详情/Escape 关闭、选择往返、drag handle 存在，以及 OS reduce/真实持久化 token reduced 两路径，transition 均 0.00001s。生产检查未把 handle 存在冒充完整拖拽 E2E；现有菜单、触摸拖拽、README/lazy error 生命周期测试通过。

## 5. Windows 桌面：三个局部补丁

原托盘仅判断 visible，误隐藏未聚焦/最小化窗口；菜单静态且缺 minimizeToTray；没有最终 session-end 分支。`electron/main.js` 分别修三态（复用 restoreMainWindow）、状态菜单/偏好失败恢复、仅 Windows 最终 BrowserWindow session-end 设置 isQuitting。query 不阻止系统且不永久进入退出态；不主动 app.quit 绕过原 AGY，不改默认偏好/启动器/其它平台分支。

`electron/desktopWindow.test.js` 用 AST/VM 执行实际 main 函数与事件绑定，配合原 desktopPrefs 共 13 项；覆盖三态、菜单/磁盘失败、query 后 close-to-tray、最终 end 不拦 close、保留 macOS/Linux 分支。没有写一份镜像实现。

`output/stages4-8/desktop-native/desktop.json` 记录 Windows 隔离 Electron native 状态：聚焦隐藏、隐藏恢复、未聚焦聚焦、最小化恢复通过；query prevented=false/quitting=false，最终 end prevented=false/quitting=true，护栏无禁止调用，临时 profile 清理。早期采样因 Chromium document.hasFocus 与 native focus 不同步超时，失败日志保留；最终以产品使用的 native 状态判断，不加时间猜测。

这只验证真实隔离窗口状态与 JS 发出的 tray/session 事件，未验证真实 Shell 鼠标或系统注销/关机，也不推断其它平台实机。安装 Electron 的 `.d.ts` 和官方 BrowserWindow 文档明确区分 query 与不可阻止的最终 end。

手动验收：在正常入口分别点聚焦/未聚焦/隐藏/最小化窗口的托盘，核对菜单与设置同步；保存其它工作后由用户决定是否验证系统结束/取消，以及取消后关闭仍到托盘。本轮没有执行系统操作。

## 6. 验证与复现

`final-related-tests.log`：11 文件 137 项通过；仅针对最后 journal guard/缩放边界复查 `4d-final-safety-tests.log`：2 文件 15 项通过。Home/identity `4d-home-guard-regression.log`：4 文件 51 项通过。Node `final-node-tests.log`：28 项通过。最终 `final-typecheck.log`、`final-fixture-typecheck.log` 通过。普通生产构建及 grid 两 profile 集成通过；Vite 有原 mixed static/dynamic import 提示，没有构建错误。不重复阶段 1/2 完整性能矩阵。

在项目根运行；更换新的 output 子目录，避免覆盖证据：

```powershell
node scripts/diagnose-startup.cjs --output output/stages4-8/startup-new
node scripts/diagnose-startup.cjs --visual-only --output output/stages4-8/grid-new
node scripts/diagnose-startup.cjs --desktop-only --reuse-build --build-dir output/stages4-8/grid-new/build --output output/stages4-8/desktop-new
npm run typecheck
npx tsc -p scripts/fixtures/render-performance.tsconfig.json --noEmit
node --test electron/desktopWindow.test.js electron/desktopPrefs.test.js scripts/diagnose-render-performance.test.cjs
```

默认 git diff --check 已执行；SearchBar 历史混合行尾与 autocrlf 让它误呈全文件变更/旧尾空格。未改 Git 配置或整文件归一化。其它文件正常 autocrlf、SearchBar 单次 `-c core.autocrlf=false`，用 cr-at-eol 分别检查真实 diff 通过（other-diff-check.log/search-diff-check.log）。新文件另查空白。没有通过覆盖并行修改换取检查通过。

## 7. 风险、回滚与停止

确定实现已处理；真实 Home 灾难恢复、真实 Windows Shell/系统结束、所有主题及剩余大列表性能未全面验收。compatibility import/WebDAV 仍可能部分成功；Home 离线需等待身份确认。真实资料未作 fixture。

备份回滚先检查 journal：未完成时以相同身份继续/撤回，不能删 checkpoint/pending 或用旧版本强写。已派发按 receipt/conflict 处理，不能旧快照覆盖 canonical。完成后仅撤本轮 codec/安全恢复/UI/gate 补丁，保留 4A 和他人修改。搜索撤 candidate helper/session/相应 SearchBar 补丁；启动撤条件 computed-style 读取；视觉撤 grid prop/outline；桌面三项独立撤回。无实体迁移或新数据库需要清理；诊断 output 不参与正常存储。

本轮停止。后续优先复核 grid 初次几何读取/批挂载，复用同 fixture 一次只修一处。未自动开始其它阶段、提交或发布。
