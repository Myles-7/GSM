# GSM 阶段 1：多页面卡顿复现与性能基线报告

日期：2026-10-03。范围：本机 Windows；只新增诊断设施与报告，不修改业务实现，不进入阶段 2。

## 1. 边界与测量方法

本报告的数字来自匿名、确定性 fixture，不能代表真实账户的数据量或所有日常操作。真实使用规模仍未知；100 / 500 / 1000 条为分层复现与压力对照，历史 62 仓库验收不用于否定当前问题。

使用项目已安装的 Electron、Vite、React 与 Codex 自带 Playwright。Vite API 直接构建到 `output/render-performance/<run>/build`，不执行会同步版本文件的 prebuild，不覆盖日常 `dist`。诊断插件只在内存中追加 bridge；Profiler、函数计时与几何读取计数只用于单独诊断构建，没有修改 `src` / `electron` / package 依赖。bridge 导入现有 helper 会影响诊断包的 chunk 拓扑，因此这里的首次 fixture 访问不能冒充日常冷启动结果。

普通 production 为 file-origin，窗口可见且聚焦、DevTools 关闭，内容视口固定 1200×800 CSS 像素。每个场景先做 3 次筛查，再对最慢的两个可重复内容展示场景各采 10 次。普通 production 不启用 Profiler / trace / 几何计数；profile 与 dev 分开记录。脚本检查聚焦与可见性，失焦样本令整轮失败。

`paintOpportunityMs` 从 renderer 标记起点开始，含自动化调度和操作，截止双 requestAnimationFrame；它是下一次绘制机会的代理值，**不是 INP，也不是精确像素呈现时间**。首次异步结果另记 `contentReadyMs`。随后名义 350ms 观察尾部覆盖现有 250ms 阅读位置保存 debounce，遇长任务可能延长，实际时长见 `observationMs`；尾部成本不重复加入代理值。持续滚动是 8 次 wheel、每次脚本等待 80ms，不能把这个总耗时和一次点击直接排名。分组目录跳转会伴随平滑滚动、渐进挂载，实际卡片数可能逐次增加，应一起查看。

Profiler `actualDuration` 仅表示 React render 工作；提交时间点 / 次数用于与 trace 对齐，不能当作完整 commit 耗时。Chromium `RunTask`、Layout、UpdateLayoutTree、Paint 采用 inclusive duration，存在嵌套，不能相加作为总成本。CPU 栈为采样估计，不是逐函数精确计时。异步 Home IDB / projection duration 含队列等待，同步序列化时间与异步等待也不能直接累加。

## 2. 隔离与 fixture

加载真实 main 之前，校验并设置独立的临时 `userData` 和 `sessionData`；只允许清理系统 temp 下直接子目录 `gsm-render-diag-*`。不读取、复制或注入真实用户 profile。每轮 finally 关闭诊断 Electron、Vite 并删除该临时 profile；原始 JSON、trace、截图和构建保留在忽略的 output 下，临时 profile 不提交。

虚构 GitHub account 为 `990001`，Home workspace 为 `gsm-diagnostic-offline-<规模>`；每个规模使用独立 Home IDB namespace，防止已有 mock 缓存污染下一档规模。现有存储 schema、账户与 workspace scope、业务 owner 均未改变。诊断数据只写临时 profile，采用现有 schema，不纳入业务备份、不新增迁移路径；重跑重新生成，退出清理。

fixture 每档 N 条仓库、2N 条 Release、N 条已完成的分析任务状态；两个分类、五个分组与未分组，80% 仓库属于分类 a；保存的自定义顺序逆序。两个自定义频道，两个历史期次各 N 条条目；legacy `analyses` 缺省。描述为中英混合固定短文本，重复 1–3 次，JS string length 为 60–180；头像为本地 data SVG，仓库 URL 为 `example.invalid`。自定义频道暂停，AI / autoAnalyze 关闭，无 provider 配置。改变任务状态仅更新 fixture store，不 enqueue、不执行分析。

Chromium 仅允许诊断文件 / dev 本地资源；main 的 fetch、undici、http/https 与付费运行 / 外部服务 IPC 有拒绝护栏。Home 服务端为 renderer 内的确定性 mock，只有 health、capabilities、v2 snapshot / changes / operations，以及带虚构身份验证的只读空 tasks 响应。真实 Home / GitHub / AI / Star / 索引重建均不可达。Home operations 使用真实客户端 capture、IDB outbox 和 flush，但只向内存 mock 写入。未知端点、错误方法或禁止运行调用会使诊断失败。

诊断没有新增产品后台任务；保留原客户端的 cancellation、retry、前后台行为，仅在临时身份中观察。不测真实服务器延迟、真实 AI 或同步冲突恢复；相关已有回归用于契约保护，不是性能证据。

## 3. 调用链与文档校准

已按实际源码核对七份指导文档。既有七份文档的未提交修改原样保留，本轮只增加这份报告。

| 路径 | 实际链路 / 候选重复工作 | 本轮边界 |
|---|---|---|
| 主仓库 | App → RepositoriesView → RepositoryList 的整批 filter/sort → 非分组 50 条批次 / RepositoryGroups → RepositoryCard | 批加载不是 windowing；每卡 Release filter/sort 和 actions 的 repositories 订阅仍在 |
| 分类分组 | sections 逐组 filter，custom order 的 ID → members.find，GroupBatch 每组首批 50，目录 / geometry | 测试真实展开折叠与目录；不改排序、拖拽或几何算法 |
| 内置发现 | DiscoveryView allRepos → BuiltinRepositoryResults 整批 analyzedRepository / map → SubscriptionRepoCard → useDiscoveryRepoActions | 整个 analysis/data/assets 订阅、tasks.find、失败任务与 repo 交叉查找、逐卡 Star 成员 .some 均为候选 |
| 自定义发现 | CustomChannelUI 的 visibleCount slice → CustomChannelResults → CustomRepositoryBlock | 首批 50、追加 50；保存深度 / 期次恢复会影响每次挂载数量，fixture 每次明确重置 |
| 分析兼容 | analyzedRepository → findLegacyRepositoryAnalysisAsset → legacyAssets | 即使 analyses 缺省，仍先建 names Map 并遍历所有历史 edition.entries；计时见 4.3，不列为首要修复 |
| 阅读定位 | useDiscoveryReading / useChannelEditionReading → data-reading-key 扫描、getBoundingClientRect、ResizeObserver、250ms 保存 | 几何计数不能等同 layout 耗时；不改阅读位置语义 |
| Home | 领域引用变化 → desktopStoreRecords(current/previous) → captureTail JSON 比较 → IDB edit → sync → projectNow | 分类 selected 状态本身不满足业务引用变化，不应把所有分类卡顿归给 Home |

冷启动文档中的 hydration / 首帧 / backend marks 已保留采集，但本轮 fixture 会跳过首次配置，且 bridge 改变 chunk 拓扑，不对首次使用语义或日常冷启动作结论。备份的本地 v1.0 / WebDAV v1.2 差异、搜索精确召回与向量 fallback、标签来源保护仍是独立工作，本轮不改变它们、不运行付费查询或索引。卡片动效沿用当前组件与样式；Electron main 保持系统集成角色；Windows 测量不外推 macOS / Linux。

性能专项第 2.5 节当前候选覆盖结果投影、任务和成员查找；需要补充关注 `repositoryAnalysisAssets.ts` 的空 legacy lookup 历史遍历。这里先记录源码事实；是否构成主要热点，以后续 trace 与固定 fixture 对照为准。其余候选不能仅凭代码形态宣布是根因。

## 4. 采样结果与证据

### 4.1 环境与普通 production 基线

源码 HEAD：`253b910852691f3cf0cc357246c6a31bfe1e77f6`，项目版本 `0.8.4`。Windows x64，Intel Core i7-14650HX，24 个逻辑 CPU，物理内存 34,075,090,944 bytes。Electron 44.4.5 / Chromium 152.0.7977.130 / Electron Node 24.21.0；裸 Electron 的 appVersion 为 44.4.5，不是项目版本。内容 1200×800，DPR 1.5；复采记录外窗 1215×838、zoomFactor 1、中文 zh、浏览器 zh-CN、light 主题。三规模首轮记录了内容视口与 DPR，外窗/zoom/语言主题字段在后续复采中补齐。未锁定系统电源模式、温度或其它桌面进程，因此保留范围，不宣称稳定 SLA。

[完整基线 report.json](/D:/桌面/GSM/output/render-performance/baseline-validated-production/report.json) 包含 31 场景 × 3 规模 × 3 次 = **279 个有效样本**，每个样本记录实际仓库/Release 数、卡片数、DOM 数、长任务及前台状态；仓库数均与规模一致。禁止调用与 renderer errors 均为 0，所有样本 visible / focused；各规模 Home flush 的 pending 均为 0。下表单位 ms，采用 `median [min, max]`，没有计算 p95。

| 操作 | 100 条 | 500 条 | 1000 条 |
|---|---:|---:|---:|
| 主仓库 list 突然展示 | 75.6 [71.8,149.1] | 74.1 [69.9,74.5] | 70.0 [70.0,71.0] |
| 主仓库 grid 突然展示 | 77.7 [75.4,82.1] | 73.7 [73.1,76.9] | 75.9 [73.9,80.7] |
| list 切换多分组分类 | 121.5 [106.7,123.7] | 322.0 [320.1,384.9] | 334.7 [333.6,391.8] |
| grid 切换多分组分类 | 117.7 [113.4,119.3] | 350.5 [350.3,365.5] | 379.1 [356.8,382.2] |
| list 切回全部 | 59.6 [56.5,61.1] | 72.9 [65.0,75.9] | 73.5 [72.0,78.9] |
| grid 切回全部 | 65.3 [62.6,69.8] | 77.3 [76.8,79.3] | 75.1 [74.5,79.4] |
| list 分组折叠 | 32.6 [29.6,34.8] | 88.5 [83.2,88.8] | 89.5 [82.3,92.8] |
| list 分组展开 | 49.6 [47.5,52.4] | 127.0 [117.3,127.4] | 121.0 [118.9,124.4] |
| grid 分组折叠 | 33.9 [33.7,36.4] | 87.6 [86.3,90.8] | 93.5 [87.3,98.4] |
| grid 分组展开 | 43.6 [42.9,44.3] | 132.7 [129.9,138.2] | 140.3 [138.4,146.0] |
| 内置发现整批展示 | 186.0 [158.7,210.3] | 969.8 [961.0,1017.2] | 2727.5 [2618.0,2752.7] |
| 内置发现频道切换 | 114.5 [105.4,116.5] | 752.5 [751.6,754.7] | 2883.9 [2817.3,2900.9] |
| 内置发现追加 N/2→N | 85.2 [80.0,85.8] | 546.8 [546.0,579.8] | 1627.9 [1590.4,1638.4] |
| 内置发现无关任务状态更新 | 28.1 [26.2,46.0] | 124.9 [124.1,131.3] | 330.0 [317.1,332.6] |
| 内置发现单仓库更新 | 51.5 [40.0,56.7] | 226.2 [216.7,232.8] | 519.0 [195.7,529.3] |
| 内置发现阅读恢复 | 174.5 [158.8,179.4] | 955.3 [898.7,1123.1] | 2710.3 [2707.1,3102.9] |
| 自定义发现首批 50 | 56.4 [48.7,69.5] | 55.4 [49.2,63.5] | 57.6 [57.4,64.2] |
| 自定义发现追加 50→100 | 77.6 [76.8,78.7] | 70.2 [68.7,79.6] | 73.6 [72.9,77.2] |
| 自定义发现无关任务状态更新 | 20.4 [18.0,21.4] | 23.1 [22.9,25.2] | 26.2 [25.2,28.2] |
| 自定义发现阅读恢复（50 卡） | 41.1 [40.9,42.8] | 39.7 [38.8,42.2] | 41.2 [37.5,43.0] |
| 自定义发现期次切换（50 卡） | 90.5 [90.4,122.9] | 102.1 [96.9,123.8] | 96.8 [92.3,128.8] |
| 自定义→内置频道（整批 N 卡） | 88.9 [86.3,94.1] | 573.0 [551.7,618.7] | 2029.7 [1762.4,2182.1] |
| 主仓库单 Release 更新（50 卡） | 16.3 [15.0,18.1] | 17.0 [15.4,18.6] | 17.6 [15.9,36.2] |
| Home 关闭，主仓库更新（50 卡） | 28.1 [26.9,28.8] | 28.8 [27.4,29.2] | 39.0 [32.8,39.5] |
| mock Home 激活，同一更新（50 卡） | 30.3 [28.7,31.5] | 37.3 [32.7,38.1] | 46.6 [36.8,47.1] |

主仓库普通首批每档 50 卡；分类 a 实际挂载 80 / 287 / 300 卡；内置发现整批为 100 / 500 / 1000 卡，DOM 为 6,534 / 30,934 / 61,434 个节点。自定义首批与期次每次重置为 50 卡，追加为 100 卡，不能把它的数字与内置 N 卡当成相同负载。

滚动与目录另看原始样本：八次滚轮 list median 为 738.9 / 751.4 / 750.8，grid 为 742.7 / 750.6 / 748.4，内置发现为 745.8 / 826.8 / 1052.7，自定义为 748.8 / 765.7 / 778.1；都含至少 640ms 脚本等待。初始 list 八次滚轮未达到追加边界，grid 达到 100 卡，不能称前者已覆盖 list 追加。目录跳转会继续触发 GroupBatch，卡数与滚动位置逐次变化，报告不将它排名为固定内容转换。

首次 fixture 访问单列为 794.0 / 1439.3 / 2948.7ms；包括固定 500ms 稳定等待与自动化 / 异步读取。后续各场景是已访问过页面的结果，首次数字不用于推断产品冷启动性能。

### 4.2 最慢场景复采

[整批展示与阅读恢复十次样本](/D:/桌面/GSM/output/render-performance/hotspots-repeat-production/report.json)：1000 条整批展示 median **2691.3**，范围 **2506.0–2864.7**，最大长任务 **2064ms**；阅读恢复 median **2984.8**，范围 **2534.1–3130.2**，最大长任务 **1959ms**。两者都为 1000 卡 / 61,434 DOM，禁止调用与页面错误为 0。[频道切换十次复采](/D:/桌面/GSM/output/render-performance/channel-repeat-production/report.json) median **2724.0**，范围 **2517.6–3097.4**，最大长任务 **2555ms**；1000 卡 / 61,430 DOM。最终筛查的最慢两项（频道 / 展示）均已各采十次，另保留阅读恢复十次，不把三项合成一种操作。

### 4.3 Profiler / trace、因素对照与滚动追加

[Profiler 36 条记录](/D:/桌面/GSM/output/render-performance/hotspots-profile/report.json)、[CPU source-map 归因](/D:/桌面/GSM/output/render-performance/hotspots-profile/cpu-attribution.json) 与各 `1000-<场景>-0.trace.json` 在同目录。每场景只有第 0 次启用 trace；第 1 / 2 次仍使用 profiling 构建，但没有 trace。下表为第 0 次诊断样本，**不可替换普通 production 基线**。render duration 只累加同一个结果域的 callbacks，未再加外层 App；非零 / 零 duration 提交均计入次数。timeline 为该 renderer 主线程整个 trace 的 inclusive events，覆盖操作与尾部、少量 tracing 调度，不是精确的互斥成本拆账。

| 1000 条诊断场景 | 结果域提交次数 / render duration 合计 | Layout / style / paint inclusive ms | 几何读取次数 |
|---|---:|---:|---:|
| 内置发现展示 | Builtin 7 / 2514.9ms | 87.7 / 141.6 / 7.3 | 4 |
| 内置发现频道 | Builtin 8 / 1520.2ms | 101.7 / 140.1 / 13.6 | 4 |
| 无关任务状态更新 | Builtin 2 / 764.1ms | 0 / 0 / 0 | 0 |
| 内置发现阅读恢复 | Builtin 7 / 2554.2ms | 见对应 trace | 4 |
| grid 分类（300 卡） | Groups 4 / 276.6ms | 128.0 / 62.9 / 25.0 | 106 |
| grid 分组展开（300 卡） | Groups 4 / 94.3ms | 8.6 / 13.6 / 43.2 | 47 |

这证明整批展示包含多次结果域 render，也包含真实 DOM/layout 成本；无关任务更新可以在无 layout/paint 时制造长任务。不能因为几何调用少就宣布 querySelector / anchor 没成本，也不能因几何次数多就称全部为 forced layout。

诊断开销对照：profile 展示代理 median 3035.2ms，普通 production 十次 median 2691.3ms；profile 无 trace 的无关更新为 369.8 / 380.5ms，而第 0 次 trace 为 845.5ms，且该次有两个结果域提交，后两次只有一个。差异同时包含 tracing / profiling 与实际提交次数变化，不能给出通用“扣除开销”系数。

任务链证据相互独立：

- [普通 production 任务 trace](/D:/桌面/GSM/output/render-performance/task-scroll-production-trace/1000-builtin-task-unrelated-0.trace.json) 中代理 368.9ms，未开启 trace 的两次为 336.6 / 321.8ms；Layout / style / paint 均为 0。[普通 CPU 归因](/D:/桌面/GSM/output/render-performance/task-scroll-production-trace/task-cpu.json) 指向 `BuiltinRepositoryResults.tsx:201` 的 map 回调，采样 self 约 140.8ms。普通 minified 构建会内联 helper，不能把这一行的全部 self 精确等同某一个子函数。
- profiling 栈可展开到同文件 `tasks.find` 回调（约 285.9ms inclusive）及 `analysisIdentity.ts` 的 JSON / fingerprint 链（约 284.8ms inclusive）；两者嵌套，不能相加。空 legacyAssets 遍历约 41.2ms self；该次两轮 `analyzedRepository` 计时合计 53.6ms / 2000 次。
- 源码的 `tasks.find(t => t.key === analysisKey(repo, ...))` 把相同 repo key 放在逐任务比较内生成；它与逐 repo `.find` 的交叉查找共同形成 O(N×T) 工作。这个判断来自源码和 CPU / fixture 对照，不是仅凭 DOM 数猜测。

因素对照均为普通 production、相同 1000 卡 / 61,434 DOM、3 次，无 trace / Profiler：

| 唯一 fixture 因素 | 整批展示 median [min,max] ms | 无关更新 median [min,max] ms |
|---|---:|---:|
| 原 2 期历史、1000 已完成任务 | 2727.5 [2618.0,2752.7] | 330.0 [317.1,332.6] |
| [历史期次为 0](/D:/桌面/GSM/output/render-performance/history-zero-production/report.json)，任务保持 1000 | 2612.0 [2568.2,2888.7] | 328.4 [327.6,333.3] |
| [任务为 0](/D:/桌面/GSM/output/render-performance/tasks-zero-production/report.json)，历史保持 2 期 | 2345.5 [2270.3,2395.9] | 215.3 [200.1,220.5] |

没有任务时呈现的状态文字仍为空（原任务为 done 且无 ai_details），卡片 / DOM 数保持一致。该对照支持任务匹配链值得优先处理，但跨轮次系统状态未完全锁定；这里是改变诊断数据因素，不是修复后的性能提升承诺。历史为空没有显著改善无关更新总耗时，不将空 legacy 路径列为首要修复。任务为空仍有约 215ms 更新与秒级展示，证明剩余重渲染 / 挂载成本不能忽略。

[列表到达实际追加边界](/D:/桌面/GSM/output/render-performance/task-scroll-production-trace/report.json)：三次均 50→100 卡，起点 scrollY 0，6 次 wheel×2000px、每次等待 80ms，到达 scrollY 11172；代理 804.8（trace）/568.5/566.5ms，三次操作观察窗口均无 longtask。总时间含至少 480ms 脚本等待；这是固定短批次追加，不代表长时间累计到 1000 卡仍流畅。较早 profile 追加的后两次从 100→150 起步，保留原始记录但不纳入固定 50→100 基线。

Home 单独看 [profile 样本与 homeBySize](/D:/桌面/GSM/output/render-performance/hotspots-profile/report.json)：该轮因此前追加，主仓库挂载 100 卡，不能与普通 50 卡直接扣差；Home off/on 在本轮彼此同负载。第 0 次更新同步调用 desktopStoreRecords 两次共 7.5ms，IDB edit 一次 13.5ms（异步 elapsed）。最后一次两个 serialization 为 4.1 / 3.8ms，IDB edit 25.6ms；一个 projection elapsed 228.9ms 起点跨越这次操作并等待 capture，不能全归给该更新或当 CPU 时间。显式 flush 5.8ms、pending=0，mock operations handler 最后 0.1ms，仅为内存响应成本。CPU 栈分别采到 desktop.ts 的 json 与 capture 比较；Home 关闭时内置发现秒级停顿仍成立，当前证据不支持把它当唯一或主要成因。后台冲突、退避、长时间隐藏行为没有测量结论。

[dev 辅助结果](/D:/桌面/GSM/output/render-performance/auxiliary-dev-validated/report.json)：grid 分类 median 857.0 [834.2,871.2]ms，无关任务更新 981.8 [977.8,1020.8]ms。开发 React / StrictMode 和诊断开销另列，不用于 production 验收；该轮启动有两次 health 探测被资源护栏拦截（5197/api、localhost:3000/api），没有到达真实服务，禁止业务调用 / 页面错误仍为 0。

### 4.4 已证实热点、候选与未确认项

**已证实**：内置发现整批 N 卡挂载和多次结果域 render 可重复产生秒级停顿；无关 analysis store 更新也会触发整批结果 render。任务匹配中的重复 key 生成 / 交叉查找在 CPU 栈与任务因素对照中均有证据。分类一次挂载多个分组首批，300 卡切换有 React、style 与 layout 工作，不能只检查非分组 RepositoryList。

**仍为候选**：空 legacy 历史遍历（有 CPU 成本，当前总延迟对照收益不足以优先）；失败任务×repo.some（fixture 无失败任务，未触发）；逐卡 Star 成员扫描与 repository-array 变化后的生命周期 / 分析资产刷新（尚未单独控制）；每卡 Release 扫描（50 卡单更新尚未形成同级瓶颈）；分组 partition / 自定义 order find 的重复计算（源码成立，但尚未隔离其占比）。展示 CPU 另有外部 store selector、closed ReadmeModal 订阅等成本，不能未经对照再指定为唯一根因。

**未确认**：真实账户规模与最小日常触发、真实 Home 网络/后台任务成本、长时累计挂载到更大 DOM 后的滚动、AI 长正文/图片/Markdown、运行中或失败任务、多种主题/缩放、外部消息/文章页面、搜索调用链、实际内存/功耗/FPS，以及 macOS/Linux。阅读恢复测到只有 4 次几何读取，但其总成本包含重新挂载和异步 workspace restore，不能把 2.98s 全归为 anchor 查找。固定三档不会证明所有页面已覆盖，更不能宣称卡顿已解决。

### 4.5 失败轮次与排除

`smoke-production` 仅单次设施检查，旧卡计数范围过宽；`baseline-production` 因 custom saved depth 影响下一次追加控制失败；`baseline-v2-production` 因前台 rAF 停滞中止；`baseline-final-production` 因只读 tasks endpoint 缺少 mock 未通过最终护栏，而且 Home namespace 曾复用。均保留为排错记录，不进入正式基线。改为固定深度、前台超时、独立 Home workspace 后完整重采，并核对实际 repositoryCount。

`auxiliary-dev` 0 样本，因诊断 const 包装在模块初始化顺序中产生 TDZ 失败；改为可提升的函数包装，增加模块早期引用测试，再以 `auxiliary-dev-validated` 重采。业务源码未修改。CPU parser 另用测试保护：renderer main thread 选择、跨 sampler thread 的 ProfileChunk 关联、剔除操作 marks 外的 tracing setup / tail；CPU 归因文件来自修正后的 parser。失败输出不被删除或改写成成功报告。

## 5. 验证与下一阶段建议

只推荐一项：**在 BuiltinRepositoryResults 内一次构建当前频道的 task-key lookup，每个 repo 只生成一次 analysisKey，再查对应任务**。复用现有 analysisKey / task owner，不新增持久化 index；保留 `.find` 的首个匹配语义，避免 Map 后写覆盖重复 key 导致状态改变。

候选修改文件为 `src/features/discovery/components/BuiltinRepositoryResults.tsx`，以及对应新增组件测试 `BuiltinRepositoryResults.test.tsx`；必要时复用现有 custom analysis 测试 fixture。这个子阶段只消除一条重复计算链，易于单独回滚。此时不同时收窄全域订阅、不改 CustomResults / 卡片 / 关闭 Modal、不改 failed task 逻辑、不改分组与 Release、不改挂载批次或阅读恢复。先比较相同 100/500/1000、相同任务和历史的普通 production；再跑 1000 展示 / 频道十次、无关任务更新、普通 CPU trace。不得拿 tasks=0 对照当作代码修复后的数字。

功能验证需覆盖：当前频道与其它频道任务、缺失任务、重复 key 的首个匹配、语言 / config key、queued / running / failed / done 状态、selected / detail / chat、账户切换与阅读恢复；继续运行现有 custom analysis / discovery action / reading 回归、typecheck 和 diff check。相同 fixture 的 CPU / longtask 与 render 应减少，mounted DOM 与业务结果应一致。它可能只削减部分停顿；完成这个最小修复并复测后，再由用户决定是否处理剩余重渲染或挂载问题。本报告不授权或实施该修复。

## 6. 可重复命令、文件与验证

在本机 PowerShell、项目根目录运行；每轮独立临时 profile，运行时保持诊断窗口前台，等待各条命令正常结束，不与 build / tests 或其它诊断轮次并行。`--run` 使用新名字保留上一轮证据。Playwright 默认使用本机 Codex 缓存；其它安装位置可通过 `GSM_PLAYWRIGHT_PATH` 指向已经存在的安装，不自动安装依赖。

```powershell
Set-Location 'D:\桌面\GSM'
node scripts/diagnose-render-performance.cjs --mode=production --sizes=100,500,1000 --repetitions=3 --run=baseline-repeat
node scripts/diagnose-render-performance.cjs --mode=production --sizes=1000 --repetitions=10 --scenarios=builtin-show,builtin-channel,builtin-anchor-restore --run=hotspots-repeat
node scripts/diagnose-render-performance.cjs --mode=profile --sizes=1000 --repetitions=3 --trace --scenarios=builtin-show,builtin-channel,builtin-anchor-restore,builtin-task-unrelated,builtin-repo-update,builtin-scroll,repo-grid-category,group-grid-expand,repo-release-update,home-off-repo-update,home-on-repo-update --run=profile-repeat
node scripts/diagnose-render-performance.cjs --mode=production --sizes=1000 --repetitions=3 --trace --scenarios=builtin-task-unrelated,repo-list-append-scroll --run=task-scroll-repeat
node scripts/diagnose-render-performance.cjs --mode=production --sizes=1000 --repetitions=3 --history=0 --scenarios=builtin-show,builtin-task-unrelated --run=history-zero-repeat
node scripts/diagnose-render-performance.cjs --mode=production --sizes=1000 --repetitions=3 --tasks=0 --scenarios=builtin-show,builtin-task-unrelated --run=tasks-zero-repeat
node scripts/diagnose-render-performance.cjs --mode=dev --sizes=1000 --repetitions=3 --scenarios=builtin-task-unrelated,repo-grid-category --run=dev-repeat
node scripts/summarize-render-trace.cjs output/render-performance/task-scroll-repeat/1000-builtin-task-unrelated-0.trace.json output/render-performance/task-scroll-repeat/build
```

scenarios 操作定义在 runner / renderer bridge：主仓库 show 为 []→fixture，category 为 all→a，all 为 a→all，分组为 g0 折叠/展开与末项目录、自定义逆序；builtin 为主仓库→trending、channel 为 trending→most-popular、append 为 N/2→N、anchor 为中间项目恢复；custom 为固定 50 首批 / 加载更多、固定上一期、项目 25 anchor；custom-channel 实际是 custom→builtin 的跨频道转换，不代表测过两个都有内容的 custom→custom。repo/Release 更新只改一条描述/标题，task-unrelated 只更新其它频道 issue，不运行任务。

| 实际新增文件 | 用途 |
|---|---|
| [diagnose-render-performance.cjs](/D:/桌面/GSM/scripts/diagnose-render-performance.cjs) | 隔离构建、Electron 操作、采样与 report |
| [diagnose-render-performance.test.cjs](/D:/桌面/GSM/scripts/diagnose-render-performance.test.cjs) | 15 个诊断确定性 / 护栏 / 解析测试 |
| [render-performance-data.ts](/D:/桌面/GSM/scripts/fixtures/render-performance-data.ts) | 确定性匿名 fixture |
| [render-performance-renderer.ts](/D:/桌面/GSM/scripts/fixtures/render-performance-renderer.ts) | 只被诊断构建加载的真实 store / Home bridge |
| [render-performance-electron.cjs](/D:/桌面/GSM/scripts/fixtures/render-performance-electron.cjs) | main 加载前隔离 profile 与拒绝调用 |
| [render-performance-guards.cjs](/D:/桌面/GSM/scripts/fixtures/render-performance-guards.cjs) | 路径 / 资源 / 样本统计校验 |
| [render-performance.tsconfig.json](/D:/桌面/GSM/scripts/fixtures/render-performance.tsconfig.json) | fixture 独立类型检查入口 |
| [summarize-render-trace.cjs](/D:/桌面/GSM/scripts/summarize-render-trace.cjs) | 主线程 CPU 采样 source-map 归因 |
| 本报告 | 基线、限制、下一项最小建议 |

架构变化仅是隔离诊断入口：没有产品事实 owner、存储格式、API、协议、状态订阅、算法、视觉或依赖变化，没有 warm store / Worker / virtualizer / 通用遥测；原有七份文档未在本阶段进一步修改。output 是忽略的本机诊断产物，不提交临时 profile。

验证结果：

- `npm.cmd run typecheck` 通过；fixture 专项 `tsc --project scripts/fixtures/render-performance.tsconfig.json` 通过。
- `node --test scripts/diagnose-render-performance.test.cjs`：15 / 15 通过；包含身份一致性、非法规模、清理路径拒绝、网络/IPC拒绝、失败清理 helper、采样完整性校验、Profiler 内存变换、dev 模块初始化、CPU thread / interval 与 sourcemap。完整矩阵检查拒绝遗漏/重复/失焦/非有限数/错误仓库规模，并已对 8 轮原始记录全部复核通过。
- Vitest 21 文件 / 162 测试通过，覆盖 RepositoryList / contract、RepositoryCard / actions、Groups / order、SubscriptionRepoCard、CustomRepositoryBlock、discovery actions / analysis / reading / edition / entry loading、analysis assets / import / star、Home desktop / identity / sync / discovery。日志：[regression-tests.log](/D:/桌面/GSM/output/render-performance/regression-tests.log)。这是回归契约，不把 jsdom 耗时作为 UI 性能数字。
- production / profiling 直接 Vite 构建与真实 Electron 页面 fixture 集成通过；dev 5197 辅助集成修正后通过。8 个完成轮次共 369 条记录；profile 列表追加 2 条起点变化的记录不用于固定条件比较。正式三规模基线单列 279 条。所有完成轮次身份 / 前台 / 禁止业务调用 / 页面错误检查通过；dev 的两次启动 health 探测被拦截，普通 production / profile 资源拦截数为 0。[最终 harness smoke](/D:/桌面/GSM/output/render-performance/final-harness-smoke/report.json) 另有 1 条功能集成记录，验证最终矩阵护栏与 fixture 描述 min/max 元数据，不加入性能基线。当前 temp 下没有残留 `gsm-render-diag-*` profile。
- `git diff --check` 通过；9 个新增文件另外用 no-index check 对空文件检查，无空白错误（no-index 的差异退出码 1 不等于空白错误）。业务源码 / Electron / package 文件无 diff。原有文档只有既有 LF→CRLF 提示，测试有 Node localstorage 路径提示，Vite 有既有 eval / chunk 警告，均无失败。

本阶段到此停止。已建立匿名 fixture 基线并定位热点，未宣称解决卡顿；下一阶段只建议前述 task-key lookup，需用户另行决定是否开始。
