# GSM 内置发现结果订阅修复与性能复测

日期：2026-10-03（Asia/Shanghai）。本报告仅记录一次内置发现订阅修复与阶段 4、5 准备；不接入虚拟化、不修改搜索。用户随后授权继续下一子阶段，阶段 4A 版本来源修复另见独立交付报告。

## 1. 本次改动与根因

阶段 2 已消除逐卡 task.find/key 重复计算，但 `BuiltinRepositoryResults` 仍调用无 selector 的 `useCustomAnalysis()`。其它频道 issue、pause 或 task 改变也会通知当前结果组件，继而重跑全部 analyzedRepository、task Map、key 和卡片 render。当前 fixture 的一次无关 issue 更新并没有修改卡片内容，却触发上述批次。

本次复用已有 `zustand/react/shallow`：只订阅当前 `builtin:<channel>` 的任务数组，使用 shallow 比较成员引用与顺序；暂停订阅布尔值，issue 订阅当前频道值。相同成员/顺序的任务数组或其它频道更新不触发结果组件 render；当前任务替换、任务顺序、暂停和 issue 变化仍触发。

已核对真实 task writer：`updateItem` 用 map/spread 替换匹配记录，enqueue 创建新记录，cancel 复用 updateItem；账户生命周期清空 items、pausedChannels、issuesByChannel。当前实现符合成员引用变化契约。未来不能原地修改已发布的 task 对象后期待 shallow selector 检出。

### 实际文件与架构

- `src/features/discovery/components/BuiltinRepositoryResults.tsx`：移除完整 analysis 订阅，增加三个有消费语义的 selector；保留阶段 2 task Map、首匹配与顺序。
- 同目录 `BuiltinRepositoryResults.test.tsx`：在原 12 项契约上补 9 项，覆盖无关更新的 render 触发、空频道、当前暂停/issue/stage、顺序与账户清空。
- 本报告与 `GSM_阶段4_5开发准备与后续路线.md`：记录性能证据及只读开发准备。

任务事实 owner 仍为原 analysis store 与账户生命周期；task 数组是可重建的组件内派生状态，不新增可写 store、完整 Repository 副本、持久化、schema、迁移、依赖或后台任务。Home account/workspace、未确认操作、Home v2、兼容分析与现有业务 owner 不变。

明确不改：其它页面/视图、自定义发现、assets/data 订阅、逐卡 Star 成员查找、失败任务×repo 查找、legacy analysis lookup、Release、README effect、排序/阅读定位、选择/已读/采纳/详情/问答/分析请求、视觉、备份、搜索和 Electron 生命周期。

## 2. 基线、隔离与复现

开始时 HEAD 为 `253b910852691f3cf0cc357246c6a31bfe1e77f6`，目标业务组件 SHA256 与阶段 2 after 的 `8A7F79905ACB1992037DF737B0E31AED67FAFFC87F0FDF90F70D9EF3B6E9A4BD` 一致。已有七份指导文档、阶段 1 交付、阶段 2 组件与测试未提交修改全部保留。起始哈希及两个目标文件的 pre-image 存在 [subscription 输出目录](/D:/桌面/GSM/output/render-performance/subscription/initial-hashes.json)，不回退整个工作区。

沿用阶段 1 原 runner、fixture、main/network 护栏与 Profiler 插件。每档 N 仓库、2N Release、N 已完成分析任务、两个历史期次各 N 项、60–180 字符描述；虚构 account 990001 和各规模 workspace，独立临时 userData/sessionData。真实 Home/GitHub/AI/Star/任务执行/索引重建不可达；最终退出清理 profile，不用清数据、强制 GC 或 working-set trim 改善数字。

production Electron/file-origin，1200×800 CSS 视口、DPR 1.5、zoom 1、zh/zh-CN、light、可见且聚焦、DevTools 关闭。Windows x64、i7-14650HX、24 逻辑 CPU；Electron 44.4.5 / Chromium 152.0.7977.130、项目 0.8.4。外窗 1215×838。各轮运行时、fixture、首访问和原始样本在 report.json；不外推 macOS/Linux，也不拿 fixture 首访问当日常冷启动。

普通 production 不启用几何计数或 Profiler。profile 构建单独采样，wrapper/函数计时增加诊断成本，其耗时不与普通 production 合并。普通 production 的 commits 空数组代表未启用采样，不能当成“没有 React commit”。

`paintOpportunityMs` 是双 rAF 绘制机会代理，包含自动化操作/调度，不是 INP、FPS 或像素呈现时间；滚动还包含八次 wheel 的 80ms 脚本等待。long task 取含名义 350ms 阅读 debounce 尾部的观察区间，不能再加到绘制代理；React actualDuration 是 render 时间，commitTime/次数用于定位，不是完整 commit 耗时。trace inclusive 栈/事件也不能直接相加。

### 与原采样计划的调整及失败记录

三档、五场景各三次 before/after 保留，用于展示、频道切换、无关更新、滚动和阅读恢复。原计划的 1000 条三场景各十次 before 长矩阵在第 9 次频道切换前因 `Diagnostic rAF stalled` 被护栏中止；保留 [failed-report.json](/D:/桌面/GSM/output/render-performance/subscription-before-repeat/failed-report.json) 与日志。它不是有效完整基线，18 条已记录样本也不拼入正式比较；rAF 超时不等于已经证实是遮挡或某个唯一根因。

根据用户要求减少测试浪费，改为对本次直接影响的 `builtin-task-unrelated` 在全新隔离进程中独立采十次 before/after；未重新执行整个失败长矩阵。展示/切换/滚动/恢复仅使用三档筛查，不宣称它们有十次稳定结论。另采三次 profile 对照，只有第 0 次启用 trace，所有 trace/profile 与普通 production 分列。

### 可复制命令

在项目根目录运行。所有 --run 名应替换为新名字；before 要用本轮修改前的隔离源码副本，不能 reset 当前工作区。runner 经 Vite API 构建到输出目录，跳过版本同步 prebuild，保留日常 dist。

```powershell
node scripts/diagnose-render-performance.cjs --mode=production --sizes=100,500,1000 --repetitions=3 --scenarios=builtin-show,builtin-channel,builtin-task-unrelated,builtin-scroll,builtin-anchor-restore --run=subscription-before-scales
node scripts/diagnose-render-performance.cjs --mode=production --sizes=1000 --repetitions=10 --scenarios=builtin-task-unrelated --run=subscription-before-target
node scripts/diagnose-render-performance.cjs --mode=profile --sizes=1000 --repetitions=3 --scenarios=builtin-task-unrelated --trace --run=subscription-before-profile
node scripts/diagnose-render-performance.cjs --mode=production --sizes=100,500,1000 --repetitions=3 --scenarios=builtin-show,builtin-channel,builtin-task-unrelated,builtin-scroll,builtin-anchor-restore --run=subscription-after-scales
node scripts/diagnose-render-performance.cjs --mode=production --sizes=1000 --repetitions=10 --scenarios=builtin-task-unrelated --run=subscription-after-target
node scripts/diagnose-render-performance.cjs --mode=profile --sizes=1000 --repetitions=3 --scenarios=builtin-task-unrelated --trace --run=subscription-after-profile
```

## 3. 性能结果

### 有效受控结果

采样过程中工作区出现 HTML Reading、详情及文本组件的并行修改。首批 before/after 的构建输入不一致，因此 `subscription-before/after-scales`、`-target`、`-profile` 只保留为探索资料，不能把其耗时差解释为本补丁的净收益。相关审计见 [build-source-hashes.json](/D:/桌面/GSM/output/render-performance/subscription/build-source-hashes.json)。

随后冻结公共源码和依赖引用，仅通过诊断 Vite plugin 切换目标组件 pre-image/修复版。普通 production 和 profile 各自对比，不混算。441 个业务 source-map 输入一致；override 的 source map 仍保留冻结后的目标源码，不能用它证明目标版本，另核验编译代码中的宽订阅与 selector 片段。证据见 [公共源码审计](/D:/桌面/GSM/output/render-performance/subscription/controlled-build-source-hashes.json)、[编译版本核验](/D:/桌面/GSM/output/render-performance/subscription/compiled-variant-evidence.json)。

正式场景：1000 仓库、2000 Release、1000 已完成任务、两个历史期次，内置发现保持 1000 卡片；更新另一频道 issue。普通 production 各十次，独立 profile 各三次。所有样本保持可见、聚焦，无真实调用/护栏错误。

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| production 绘制机会代理 median | 200.45 ms | 5.40 ms |
| production min～max | 191.80～220.00 ms | 3.70～8.60 ms |
| production 每次 long task 数 | 十次均为 1 | 十次均为 0 |
| production 最大 long task | 212 ms | 0 |
| 挂载卡片 / DOM 节点 | 1000 / 61434 | 1000 / 61434 |
| profile 每次结果组件 commit | 三次均为 1 | 三次均为 0 |
| profile 每次 analyzedRepository 调用 | 三次均为 1000 | 三次均为 0 |
| profile 代理 median / range | 224.40 / 222.50～290.10 ms | 5.40 / 4.50～8.50 ms |

原始 production：[before](/D:/桌面/GSM/output/render-performance/subscription-controlled4-before-production/report.json)、[after](/D:/桌面/GSM/output/render-performance/subscription-controlled3-after-production/report.json)。profile：[before](/D:/桌面/GSM/output/render-performance/subscription-controlled3-before-profile/report.json)、[after](/D:/桌面/GSM/output/render-performance/subscription-controlled3-after-profile/report.json)。完整汇总见 [controlled-comparison.json](/D:/桌面/GSM/output/render-performance/subscription/controlled-comparison.json)，包含全部样本、范围及 trace 引用，不计算稳定 p95。

第 0 次 profile trace 前后均无 Layout、UpdateLayoutTree、Paint；几何读取计数均为 0。旧构建结果 render actualDuration 为 252.4/190.6/190.5 ms，新构建没有结果组件 render。证实的根因是**无关频道通知触发结果批次派生与 React render**。Chromium Commit 事件不等于 React commit，inclusive RunTask 和异步尾部不可相加，本轮不据此推断总体 DOM 瓶颈已消失。

### 采样排除、复现与限制

`subscription-controlled3-before-production` 十次中有场景漂移，卡片数量不是始终 1000，整轮排除，不挑选其中正常样本。补采 `controlled4-before-production` 复用同一缓存 before build，计时前重新进入内置发现并断言 1000 卡片，计时后断言发现卡片 1000、主仓库卡片 0。after 十次原始数量均正确；它没有新增的 setup 护栏，因此两边准备步骤不同，差异位于计时区外，绝对耗时仍受预热/调度影响。Profiler 和契约测试提供独立的 render 触发证据。

另外两次受控 setup 失败（缺 server import、dist preflight）保留日志，未纳入指标；原失败长矩阵、探索矩阵也未拼接成正式样本。后续复现可在冻结目录运行 runner，使用新 run 名；普通 before cached build 命令：

```powershell
$env:GSM_DIAG_BEFORE = '1'
$env:GSM_DIAG_CACHED_BUILD = 'D:\桌面\GSM\output\render-performance\subscription-controlled3-before-production\build'
node output/render-performance/subscription/frozen-source/scripts/diagnose-render-performance.cjs --mode=production --sizes=1000 --repetitions=10 --scenarios=builtin-task-unrelated --run=subscription-recheck-before
Remove-Item Env:GSM_DIAG_BEFORE, Env:GSM_DIAG_CACHED_BUILD
```

after 使用相同 frozen runner、after cached build 和新 run 名；profile 使用 mode=profile 和对应 profile cached build。冻结输入清单在 subscription/frozen-hashes.json。output 是本机诊断资料，不提交临时 profile；无缓存构建时从冻结源码重新 Vite 构建，before override 路径见 runner，不对真实工作区 reset。

这项补丁没有减少挂载数量。大量内容首次展示、频道切换、滚动仍只有输入混杂的筛查资料，未完成干净的广泛净收益对照，不宣称整体卡顿解决。

## 4. 行为与检查

新增契约在修改前运行：8 failed、13 passed，共 21 项；失败均是无关更新仍触发 render 的断言。修复后 21/21 通过。日志 [contract-before.log](/D:/桌面/GSM/output/render-performance/subscription/contract-before.log)、[contract-after.log](/D:/桌面/GSM/output/render-performance/subscription/contract-after.log)。以每次父组件 render 必执行的每卡 analysisKey 次数观察批次，避免仅检查文本没变而漏掉重渲染；jsdom 耗时不作 UI 性能证据。

集中回归 8 文件、50 项通过：卡片无描述/weekly、分析、发现阅读、期次阅读、仓库操作及 Home 身份/发现投影。诊断脚本 15 项通过；fixture 类型检查通过；最终 `npm run typecheck` 通过。期间并行 HTML Reading 测试曾导致根类型检查失败，后续由该工作修复，本任务没有改动其文件。没有重复运行整个测试矩阵。

独立真实页面阅读完成条件补查：修复后第 500 项 `repo:800500` 恢复到 top=100，scrollY=113176.664，无关更新后保持；受控旧构建此轮 30 秒恢复超时。探索构建也出现过恢复超时，原因尚未确认，不能证明阅读普遍稳定或将其当作订阅收益。原始结果见 [controlled-reading-completion.json](/D:/桌面/GSM/output/render-performance/subscription/controlled-reading-completion.json)。既有阅读 Hook 回归已通过；本轮没有改阅读实现。

诊断 Vite 构建成功，跳过版本同步 prebuild；未覆盖日常 dist。本次目标文件的 `git diff --check` 和新增文件空白检查通过；全工作区检查报告并行修改的 `src/lib/html-reading/reader-runtime.txt:269` 与 `reader-style.txt:13` 文件末尾新增空行，本任务保留这些修改，没有代改。阶段 4A 的独立组件测试另记录，不计入本订阅测试数量。

## 5. 剩余风险、回滚与下一步

只消除了当前组件对无关 analysis 状态的批次 render。当前频道状态变化仍可能重渲染全部结果；selector 在 store 通知时仍有 O(T) filter/shallow 比较。data/assets 宽订阅、历史兼容 lookup、失败任务交叉查找、每卡 Store/README effects、整批 React 与 DOM/layout 成本没有在本轮处理。

真实账户规模、长正文/图片、运行或失败任务、真实 Home/backend 活动未由本轮匿名 fixture 覆盖；未锁定电源、温度和全部桌面进程。跨轮绝对耗时有明显变化，因此结论以目标的真实 render 触发消除与独立重复采样为主，不把整批展示的波动归为本补丁收益。

虚拟化进入条件 2（主要计算、重复扫描、宽订阅热点已处理）与条件 3（残余以 DOM/layout/mount 主导）仍未完整证明。大量节点不是自动接入依据。本轮不扩展虚拟化、不宣称所有卡顿已解决。

回滚只撤回本轮 selector 订阅补丁，保留原阶段 2 task Map 和其余用户修改；测试/报告可保留。无需数据/schema/同步回滚。pre-image 只用于核对或生成目标文件补丁，不覆盖后续用户编辑，不执行全工作区 reset。

用户随后授权继续下一阶段，阶段 4A 本地导出版本来源修复独立完成，见 [阶段 4A 报告](GSM_阶段4A_本地备份版本来源修复报告.md)。阶段 4 字段/codec/恢复和阶段 5 corpus/候选/查询状态的边界与待决策见 [准备报告](GSM_阶段4_5开发准备与后续路线.md)；本次不扩展实施。

文档现状更新：性能专项与阶段 1 报告中“Builtin 整个 analysis 订阅”已由本补丁替代；阶段 2 的下一项建议在此完成。其它宽订阅和算法候选仍成立。原七份文档保留，通过阶段报告说明漂移；不能将其其它候选标为已实现。
