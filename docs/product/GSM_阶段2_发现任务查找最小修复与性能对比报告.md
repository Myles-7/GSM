# GSM 阶段 2：内置发现任务查找最小修复与性能对比

日期：2026-10-03。范围：本机 Windows；只修复内置发现结果的逐卡任务匹配，阶段 2 到此停止。

## 1. 结论和证据边界

已消除 `BuiltinRepositoryResults` 卡片任务匹配中的交叉扫描与重复 key 生成。相同匿名 1000 条 fixture、普通 production 各十次：无关任务更新的绘制机会代理中位数从 **336.4ms 降到 206.0ms**，整批展示从 **2666.7ms 降到 2211.4ms**。频道切换没有形成一致改善，不能把这一项修复描述为所有发现操作或多页面卡顿已解决。

CPU trace、旧实现上的失败断言和修复后的契约测试共同支持这一条计算链已被处理。仍有整批 React 渲染、store selector fanout、挂载和 layout/style 成本；不增加虚拟化、Worker 或其它修复。

这是匿名 fixture 的测量，不是实际账户规模、INP、FPS、p95 或稳定 SLA。真实日常数据、运行/失败任务占比、长正文/图片与真实 Home 活动仍可能改变热点分布。

## 2. 开始前核对与本次范围

重新阅读七份指导文档和[阶段 1 报告](GSM_阶段1_卡顿复现与性能基线报告.md)，核对报告的 JSON/CPU 证据、实际组件、analysis identity、任务 store、账户生命周期和现有测试。开始时 HEAD 仍为 `253b910852691f3cf0cc357246c6a31bfe1e77f6`；`src`、`electron`、package/lockfile 无差异，业务源码与阶段 1 基线一致。

原有七份文档的未提交修改，以及九个阶段 1 未跟踪交付文件全部保留。七份指导文档和本次使用的诊断源码哈希前后相同，见 [initial-hashes.json](/D:/桌面/GSM/output/render-performance/stage2-initial-hashes.json)。本轮业务文件修改前 SHA256 为 `D6895EBFE9CD12D814CC6EC2A4659C7B06D900D503F32B9649CCCEFF3A56CCF0`，修改后为 `8A7F79905ACB1992037DF737B0E31AED67FAFFC87F0FDF90F70D9EF3B6E9A4BD`；同一个 HEAD 不等于修改前后源码相同。

实施前已给出问题、证据、根因、文件、owner、非目标与对比方法。没有功能范围或交互取舍，因此没有新增产品决策。

| 本轮实际文件 | 修改内容 |
|---|---|
| [BuiltinRepositoryResults.tsx](/D:/桌面/GSM/src/features/discovery/components/BuiltinRepositoryResults.tsx:68) | 当前频道任务建立首匹配 Map；卡片 key 计算移出逐任务比较。6 行新增、3 行替换 |
| [BuiltinRepositoryResults.test.tsx](/D:/桌面/GSM/src/features/discovery/components/BuiltinRepositoryResults.test.tsx) | 新增 12 项组件契约测试 |
| 本报告 | 复现、数据、测试、残余风险与停止边界 |

原始报告、trace、CPU 归因、日志、构建与 [performance.patch](/D:/桌面/GSM/output/render-performance/stage2-performance.patch) 保存在忽略的 `output/render-performance`。没有修改阶段 1 脚本、日常 `dist`、服务、快捷方式或真实用户 profile。

文档校准：性能专项第 2.5 节的 `BuiltinRepositoryResults` 逐卡 `tasks.find()` 已不再是当前实现；阶段 1 第 5 节推荐的 task-key lookup 在本轮完成。其余宽订阅、失败任务交叉查找、整批分析投影与挂载候选仍成立。七份既有文档原样保留，由本报告记录这项现状变化；不能把其它候选标为已修复。

## 3. 根因、实现与数据 owner

原代码在每张卡片内执行：

```ts
tasks.find(t => t.key === analysisKey(repo, language, config))
```

同一 repo key 在每次任务比较时重新生成。`analysisKey` 沿用 `discoveryAnalysisIdentity`，包含 JSON 序列化和配置 fingerprint；频道任务数 T 与卡片数 N 同时增长时，匹配部分为 O(N×T)。阶段 1 普通 CPU trace 指向该回调，profiling 栈进一步展开到 key/JSON/fingerprint；任务为空的因素对照也支持这条链有成本，不能只凭代码形态宣布它是全部卡顿根因。

现在每次组件 render 从原 scoped `tasks` 构建 `Map<string, AnalysisItem>`，仅在 key 尚未存在时加入任务；卡片生成一次原 `analysisKey` 后 `get()`。匹配部分降为一次任务遍历和每仓库一次 key 生成/查找。Map 保留任务引用，不复制完整 repository 集合。

**保持原语义**：频道筛选、重复 key 首匹配、语言/配置/repo revision identity、queued/running/failed 与分析成功显示、任务排序和详情按 repo ID 查询均保留；waiting/done/cancelled 的原状态显示规则未改。失败筛选、重试、暂停/取消与 enqueue 路径没有修改。

**owner 不变**：任务运行状态仍归现有 `useCustomAnalysis.items` 与账户生命周期；分析资产和仓库事实仍由现有 owner 管理。Map 是组件内可重建的派生状态，每次 render 重建，任务重置后没有旧缓存；不增加持久化、schema/version、迁移、备份或清理协议，也不新增后台任务。现有 GitHub account/workspace、Home v2 与未确认操作、兼容分析路径均不改。

**明确不改**：analysis/data/assets 的订阅范围、`analyzedRepository`、失败任务×repo 检查、Star/频道成员查找、自定义发现、主仓库/Release/分组、排序/挂载批次/阅读定位、选择/已读/采纳/详情/问答/分析语义、搜索、备份、视觉、Electron 生命周期及依赖。

## 4. 相同 fixture 与复现方法

复用阶段 1 原脚本与匿名 fixture，无新诊断基础设施。每档 N 仓库、2N Release、N 已完成分析任务（属于 `builtin:trending`）、两个历史期次各 N 项、描述长度 60–180；AI/autoAnalyze 关闭。频道切换到 most-popular 时没有该频道匹配任务，不能把它视为与 trending 任务更新相同的纯查找负载。

隔离 account `990001`、workspace `gsm-diagnostic-offline-<规模>`、独立临时 userData/sessionData；mock Home 与网络/主进程拒绝护栏沿用阶段 1。不读取或写入真实账户存储，不调用真实 GitHub、AI、Star、分析调度或索引重建。所有本轮 profile 已退出清理。

环境前后核对相同：Windows x64、i7-14650HX、24 逻辑 CPU、34,075,090,944 bytes 物理内存；Electron 44.4.5、Chromium 152.0.7977.130、Electron Node 24.21.0、项目 0.8.4。production/file-origin，内容 1200×800 CSS、外窗 1215×838、DPR 1.5、zoom 1、zh/zh-CN、light；可见且聚焦、DevTools 关闭。采样期间未并行运行测试、构建或其它诊断。未锁定电源模式、温度和所有桌面进程，保留范围和跨轮次差异，不外推其它系统/机器。

操作与阶段 1 相同：主仓库→trending 整批展示；trending→most-popular；在已挂载 trending 中只更新其它频道 `issuesByChannel`（不运行任务）；保存中间条目后重新进入并恢复阅读位置。已访问页面的操作与首次 fixture 访问分开，报告不作冷启动结论。

`paintOpportunityMs` 是操作标记至双 rAF 的绘制机会代理，包含自动化调度，不是 INP/精确像素呈现时间。350ms 观察尾部可能因长任务延长；maxLongTask 来自该观察窗口，不重复加入代理耗时。trace 的 inclusive 事件和嵌套 CPU 栈不能直接相加，Chromium `Commit` 也不是 React Profiler 的完整提交耗时。

以下是实际执行命令；重采时须给 `--run` 新名字，避免覆盖证据。before 必须在隔离的基线源码副本中运行，保留阶段 1 诊断设施；不要回退当前工作区已有修改。after 在当前源码运行。runner 通过 Vite API 独立构建，跳过版本同步 prebuild，保留日常 dist。

```powershell
node scripts/diagnose-render-performance.cjs --mode=production --sizes=100,500,1000 --repetitions=3 --scenarios=builtin-show,builtin-channel,builtin-task-unrelated,builtin-anchor-restore --run=stage2-before-scales
node scripts/diagnose-render-performance.cjs --mode=production --sizes=1000 --repetitions=10 --scenarios=builtin-show,builtin-channel,builtin-task-unrelated --run=stage2-before-repeat
node scripts/diagnose-render-performance.cjs --mode=production --sizes=100,500,1000 --repetitions=3 --scenarios=builtin-show,builtin-channel,builtin-task-unrelated,builtin-anchor-restore --run=stage2-after-scales
node scripts/diagnose-render-performance.cjs --mode=production --sizes=1000 --repetitions=10 --scenarios=builtin-show,builtin-channel,builtin-task-unrelated --run=stage2-after-repeat
node scripts/diagnose-render-performance.cjs --mode=production --sizes=1000 --repetitions=3 --trace --scenarios=builtin-show,builtin-task-unrelated --run=stage2-after-trace
node scripts/summarize-render-trace.cjs output/render-performance/stage2-after-trace/1000-builtin-task-unrelated-0.trace.json output/render-performance/stage2-after-trace/build
node scripts/summarize-render-trace.cjs output/render-performance/stage2-after-trace/1000-builtin-show-0.trace.json output/render-performance/stage2-after-trace/build
```

## 5. 普通 production 前后数据

五轮共 138 条有效记录。主对照 132 条未启用 trace/Profiler；额外 6 条诊断轮次中，两个场景各第 0 次启用 trace，另四条不合并到主表。原始记录全部保留，无样本排除或新增失败轮次；各轮规模矩阵、实际仓库、前台、身份和禁止调用检查通过，renderer errors/forbidden/main blocked 均为 0。

[三档 before](/D:/桌面/GSM/output/render-performance/stage2-before-scales/report.json)、[三档 after](/D:/桌面/GSM/output/render-performance/stage2-after-scales/report.json)、[十次 before](/D:/桌面/GSM/output/render-performance/stage2-before-repeat/report.json)、[十次 after](/D:/桌面/GSM/output/render-performance/stage2-after-repeat/report.json)、[汇总 comparison.json](/D:/桌面/GSM/output/render-performance/stage2-comparison.json)。before 两轮 index.html hash 相同，after 三轮 hash 相同；具体 hash 和运行环境在各 report 内。

单位 ms，格式为 median [min,max]，不计算 p95。

| 规模 / 操作（各 3 次） | before | after |
|---|---:|---:|
| 100 / 展示 | 199.2 [171.4,220.2] | 203.4 [167.8,214.3] |
| 100 / 频道 | 106.6 [101.9,110.1] | 108.5 [103.9,110.2] |
| 100 / 无关任务更新 | 23.9 [22.7,27.2] | 24.2 [21.5,26.5] |
| 100 / 阅读恢复 | 192.0 [179.2,196.1] | 195.7 [175.9,208.8] |
| 500 / 展示 | 1119.2 [1011.7,1147.4] | 951.2 [900.7,1049.7] |
| 500 / 频道 | 886.6 [842.2,919.9] | 798.3 [798.2,872.8] |
| 500 / 无关任务更新 | 132.0 [129.5,141.4] | 95.0 [94.4,103.0] |
| 500 / 阅读恢复 | 972.0 [967.8,1018.1] | 921.9 [872.8,963.9] |
| 1000 / 展示 | 2820.3 [2705.9,2851.3] | 2136.3 [2099.4,2188.3] |
| 1000 / 频道 | 3241.7 [3077.3,3503.6] | 2799.0 [2497.2,2961.9] |
| 1000 / 无关任务更新 | 353.9 [352.8,667.8] | 209.9 [187.6,224.3] |
| 1000 / 阅读恢复 | 2891.4 [2859.0,3400.5] | 2207.3 [2057.7,2415.9] |

| 1000 条 / 操作（各 10 次） | before | after | 最大长任务 before→after |
|---|---:|---:|---:|
| 整批展示 | 2666.7 [2537.9,2913.5] | 2211.4 [1923.2,2434.3] | 2102→1898 |
| 频道切换 | 2308.7 [2153.2,2710.9] | 2395.2 [2230.1,2748.7] | 2411→2295 |
| 无关任务更新 | 336.4 [325.3,679.1] | 206.0 [192.6,217.3] | 335→204 |

重点解读：无关任务更新在 500/1000 的三次对照与 1000 的十次对照中方向一致；100 条没有可辨认改善。1000 展示的两轮对照都下降，但仍为秒级。频道三次对照改善、十次却略慢（中位数约 +3.7%，范围重叠），不声称它获得稳定收益，也不能据此保证无回归；该场景的无任务频道、store 活动、整批挂载与环境波动仍需分别归因。保留所有样本，包括修改前任务更新 679.1ms 的高值。

前后逐场景、逐规模核对：卡片均为 N，展示/任务/阅读的 DOM 均为 6,534 / 30,934 / 61,434，频道为 6,530 / 30,930 / 61,430。没有用降低卡片数、丢失内容或任务为空来换取结果。阅读恢复的代理值包含重新进入/挂载，下降不能独立归为 anchor 算法优化。

## 6. 热点归因与残余挂载成本

[修改后 trace/report](/D:/桌面/GSM/output/render-performance/stage2-after-trace/report.json)、[任务 CPU](/D:/桌面/GSM/output/render-performance/stage2-after-trace/task-cpu.json)、[展示 CPU](/D:/桌面/GSM/output/render-performance/stage2-after-trace/show-cpu.json)。CPU source-map 仍采用阶段 1 parser：关联 renderer PID/Profile ID 的采样线程，裁切到操作 marks；各 inclusive 栈存在重叠。

| 任务更新 / 普通 production 诊断 | 阶段 1 原实现 | 阶段 2 修复后 |
|---|---:|---:|
| 第 0 次 trace 绘制代理 | 368.9ms | 257.4ms |
| 无 trace 的随后两次 | 336.6 / 321.8ms | 210.7 / 203.4ms |
| 逐卡 map 回调采样 | line 201 self/inclusive 140.8ms | line 206 self 无命中、inclusive 1.1ms |
| Layout / style / paint | 0 / 0 / 0 | 0 / 0 / 0 |
| legacyAssets sampled self | 20.5ms | 20.1ms |

原 trace 与 CPU 在 [阶段 1 任务 trace](/D:/桌面/GSM/output/render-performance/task-scroll-production-trace/1000-builtin-task-unrelated-0.trace.json) 和 [task-cpu.json](/D:/桌面/GSM/output/render-performance/task-scroll-production-trace/task-cpu.json)。这是单次 CPU 归因佐证，主性能结论使用上面的重复普通 production 数据。minified 函数可能内联；新回调 self 未命中不是“零成本”，不能把 140.8→1.1 当成精确逐函数收益百分比。旧 profiling 栈的 key/JSON/fingerprint 约 285ms inclusive 与其父回调嵌套，也不与本表相加。

**已证实**：本次重复任务匹配不再是主要 CPU 热点，任务更新总延迟下降；任务更新仍触发整批渲染，在无 layout/paint 时仍有约 200ms 停顿。修改后 CPU 栈仍有 RepositoryTextBlock、SubscriptionRepoCard、ReadmeModal、i18n 与 legacy 分析投影工作；本轮未改其订阅或算法。

**DOM/挂载残余仍存在**：1000 条展示 trace 的 Layout 87.1ms、UpdateLayoutTree 139.8ms、Paint 7.3ms；1000 卡 / 61,434 DOM 仍全部挂载，普通十次展示 median 2.21s，最大长任务 1.90s。展示 CPU 还采到 external-store selector self 475.8ms、DiscoveryView 回调 self 224.6ms、React 与卡片工作；这些不是互斥成本，也未做第二项隔离修复。不能断言 DOM 是唯一或最大的剩余成因，更不能据此直接进入虚拟化。

本轮没有新增 Profiler 构建对比；复用阶段 1 的多次 render 归因，新增普通 production CPU/layout trace 验证选中的计算链。没有拿 Chromium Commit 事件、jsdom 耗时或采样 self 无命中替代完整 React commit 时间/FPS。Home capture、真实网络、后台冲突与功耗不属于本次性能结论。

## 7. 测试、检查与回滚

- 新组件测试在旧实现上：11 项行为通过，仅 key 次数断言失败（三个仓库 7 次，要求 3 次）。修复后 12/12 通过，日志 [before](/D:/桌面/GSM/output/render-performance/stage2-contract-before.log) / [after](/D:/桌面/GSM/output/render-performance/stage2-contract-after.log)。覆盖首匹配/频道/缺失任务、六种状态、语言/model/prompt/revision、任务更新和账户 runtime 清空、reading key/order、选择/详情前后导航/问答、分析请求与确认。
- 对应 Vitest：16 文件、113 测试通过。覆盖新增组件、SubscriptionRepoCard weekly/noDescription、CustomRepositoryBlock、discovery repo actions、reading/edition/entry loading、custom analysis、analysis assets/import/star、Home desktop/identity/sync/discovery。真实 task/asset owner 的晚到结果与账户保护由既有领域回归验证，组件 mock 不冒充完整账户生命周期。日志 [regression-tests.log](/D:/桌面/GSM/output/render-performance/stage2-regression-tests.log)。
- `npm.cmd run typecheck` 通过；`tsc --project scripts/fixtures/render-performance.tsconfig.json` 通过。日志 [typecheck](/D:/桌面/GSM/output/render-performance/stage2-typecheck.log) / [fixture](/D:/桌面/GSM/output/render-performance/stage2-fixture-typecheck.log)。
- `node --test scripts/diagnose-render-performance.test.cjs`：15/15 通过，日志 [diagnostic-tests.log](/D:/桌面/GSM/output/render-performance/stage2-diagnostic-tests.log)。
- 五次隔离 production Vite 构建及真实 Electron 页面 fixture 集成通过；138 条样本的环境、护栏、规模、DOM/前台完整性复核通过。无需额外执行会改版本/日常 dist 的 `npm run build`。
- `git diff --check` 及新增文件 no-index whitespace 检查通过；七份指导文档和诊断源码哈希核对不变，业务 diff 仅目标组件；无残留诊断 temp profile。既有 Node localstorage 与 Vite eval/chunk 提示未导致失败。

回滚只需还原目标组件的 task Map 与卡片查询这一个补丁；新增测试/报告可保留作为证据。没有 durable state 迁移、清库、账户数据恢复或 Home 协议回滚步骤。不可用全工作区 reset/revert 覆盖原有七份文档与阶段 1 交付。

## 8. 残余风险与下一项建议

首匹配 Map 增加 O(T) 短期引用空间，并在每次 render 重建；没有全局缓存和失效协议。任务很少/为空时收益有限，卡片仍生成一次 key；100 条对照未显著改善。失败任务×repo.some、完整分析投影、其它成员查找与宽订阅仍可能在真实数据中占用更多时间。

真实账户规模、运行/失败任务、长正文、图片、真实 Home 活动与系统电源/温度未固定；macOS/Linux 未实测。匿名 fixture 的收益不能直接保证日常每次操作。频道切换收益不一致是保留的风险，不隐去反向样本。

下一次只建议先选择一项：**收窄 BuiltinRepositoryResults 对 analysis store 的订阅，避免其它频道 issues 更新引起整批结果 render**。本轮的真实操作和零 layout 的残余 200ms 为它提供直接证据；候选仍是同组件及其契约测试。保持任务 items/current-channel pause/issue/status 的真实更新、资产/配置/账户重置及所有阅读/动作语义，再用相同 `builtin-task-unrelated` fixture 验证 render 触发与耗时。它尚未实现，不能顺带扩大为所有卡片/发现订阅重构。

阶段 2 的目标——一项可独立回滚的、有证据的最小修复及前后验证——已完成。当前卡顿尚未整体解决；不自动执行下一项修复或阶段 3。
