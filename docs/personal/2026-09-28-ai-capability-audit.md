# GSM AI 功能完整性与场景适配审查

审查日期：2026-09-28。对象：当前工作区，包括尚未提交的修改与自定义发现频道代码。

## 一、结论

**功能覆盖已经比较广，但不能据此认定“所有 AI 功能完善、各场景都能优秀完成任务”。**

当前系统更适合“用户监督下的仓库整理、项目初筛、文档辅助问答”，尚不适合把输出直接当成全面代码审计、严格选型结论或不需要复核的自动决策。

主要瓶颈不是缺一个更强的模型，而是：

1. 检索证据覆盖不足，长文档和非典型源码布局容易遗漏。
2. “引用存在”与“引用能支持结论”没有完全区分。
3. 不同 AI 入口在取消、超时、限流、结构化修复与证据管理上标准不一致。
4. 向量索引缺乏完整的模型与内容失效机制。
5. 缺少真实模型、真实任务、可重复评分的效果评测，现有测试主要证明工程行为。

不提供主观的准确率或百分制总分：本轮没有真实模型评测数据，不应编造分数。

## 二、审查与验证边界

- 梳理所有 `new AIService` 调用入口，并检查核心服务、编排、状态写回、模型设置及相关测试。
- 重点覆盖摘要分类、详情分析、批量任务、Gist、Release、搜索/向量、单仓库问答、工具循环、研究工作台、分类整理、发现订阅、插件 AI。
- MCP 作为外部 AI 使用的数据入口，结合服务端与 Electron 测试检查；页面翻译、平台资产推荐单独区分，不误算为大模型功能。
- 未访问用户真实 API 密钥，未调用付费模型，未将真实私有仓库内容发送给外部模型。
- 未开展各厂商真实端点、浏览器/Electron 全链路交互、长期运行或生产规模压测。
- 本次只新增审查报告与 `output` 下复现材料，没有修改业务实现，也没有覆盖原有工作区改动。

验证结果：

| 验证 | 结果 | 解释 |
|---|---|---|
| `npm run typecheck` | 通过 | TypeScript 静态检查 |
| 默认 `npx vitest run` | 1662 通过、56 失败 | Node v25.8.2 下，主要是 `localStorage.clear is not a function` |
| 进程级 `NODE_OPTIONS=--no-experimental-webstorage` 后重跑 | 1718/1718 通过，162 个测试文件 | 上述失败是测试运行环境问题，不能当成 56 个产品缺陷 |
| `server` 下 `npm test -- --reporter=dot` | 128/128 通过，20 个文件 | 包括代理、MCP、配置与数据组织 |
| Electron MCP 定向测试 | 10/10 通过 | 不代表整个 Electron 测试集均已执行 |
| 审查补充测试 | 5/5 通过，见 `output/ai-audit.regression.test.ts` | 断言当前缺陷行为，用于复现，不是修复后验收测试 |

全量前端机器报告：[ai-audit-vitest.json](/D:/桌面/GSM/output/ai-audit-vitest.json)。

## 三、优先修复的问题

以下优先级是实施建议。P1 表示会影响结果正确性、数据可信度或敏感信息保护；P2 表示重要的覆盖、体验、性能与适配问题。

### F01 · P1 · 向量搜索旧请求可以覆盖新请求结果

位置：[useSearchActions.ts:311](/D:/桌面/GSM/src/features/repositories/hooks/useSearchActions.ts:311)、[useSearchActions.ts:365](/D:/桌面/GSM/src/features/repositories/hooks/useSearchActions.ts:365)。

新搜索确实会 abort 旧 controller，但向量分支的 embedding、Worker query、reranking 没有传入这个 signal；结果提交前也没有检查 controller 是否仍为当前请求。`finally` 的身份检查只保护 loading 状态，不保护结果。

**触发场景：** 先搜索 A，再搜索 B，B 先返回、A 后返回。A 仍可能执行 `setSearchResults` 和 `setSearchFilters`，把 B 覆盖掉。

改进：全链路共享 signal；每个异步阶段后检查取消；最终提交检查 requestId/controller；HyDE 子 controller 与主请求绑定。

验收：人为延迟 A，确保 B 返回后 A 不再影响结果、查询文本、阶段提示与分数缓存。

### F02 · P1 · 更换嵌入模型或索引目标，不会自动使旧索引失效

位置：[configurationSlice.ts:68](/D:/桌面/GSM/src/store/slices/configurationSlice.ts:68)、[configurationSlice.ts:93](/D:/桌面/GSM/src/store/slices/configurationSlice.ts:93)、[vectorSearchService.ts:405](/D:/桌面/GSM/src/services/vectorSearchService.ts:405)。

嵌入配置更新只是合并字段；增量索引主要看分析时间、编辑时间、license 与格式版本，没有把 provider、model、dimensions、indexMode、Worker/index 身份作为同一个索引版本契约。

**影响：** 同维度模型切换可能继续用新查询向量搜索旧模型向量；切换 Worker 后，本地“已索引”时间仍可能导致增量任务跳过仓库。维度不同可能报错，同维度错误更隐蔽。

另外，`needsReindex` 不看 GitHub `pushed_at/updated_at`，README 模式也可能保留旧内容向量。这一时间戳遗漏已补充复现。

改进：持久化 embedding fingerprint 与内容 hash；查询前核对索引 manifest；不兼容时阻止混用并提示重建；新索引完整建立后再切换。

### F03 · P1 · 单仓库问答的源码适配范围过窄

位置：[repositoryChatService.ts:669](/D:/桌面/GSM/src/services/repositoryChatService.ts:669)。

源码白名单限制为 `src/app/server/packages/lib` 下的一部分扩展名。已复现以下路径被排除：

- `main.py`
- `cmd/server/main.go`
- `internal/auth/service.go`
- `src/main.cpp`
- `src/App.vue`
- `Sources/App.swift`

这不是模型能力问题：路径进不了工具候选集合，模型就读不到。Go 常见布局、根目录脚本、C/C++、Vue、Swift 等项目的实现分析会受明显限制。

改进：以文件树为授权边界，不以固定目录作为主要白名单；建立语言/框架文件识别；排除二进制和生成物；加入受预算控制的全文/符号搜索。

验收：覆盖 Python、Go、Rust、Java、C/C++、Vue、Swift、Flutter、monorepo 各类仓库，不允许因目录约定不同而静默丢失关键源码。

### F04 · P1 · “可核验引用”尚不等于“事实已经验证”

位置：[repositoryChatService.ts:391](/D:/桌面/GSM/src/services/repositoryChatService.ts:391)、[repositoryChatService.ts:423](/D:/桌面/GSM/src/services/repositoryChatService.ts:423)、[repositoryChatService.ts:499](/D:/桌面/GSM/src/services/repositoryChatService.ts:499)。

当前检查主要确认路径和行号位于已读取证据内，以及段落是否含至少一个有效引用；没有逐条判断断言是否被引用内容支持。

**已复现：** 唯一证据写的是“命令行计算器”，回答却写“支持分布式 GPU 训练”，只要附上该 README 的合法行号，剪枝验证仍保留这段内容。

改进：区分“来源定位有效”“来源支持断言”“证据覆盖完整”；关键能力、部署步骤、平台支持采用 claim-evidence 结构；拒绝把仅有引用的输出标记为完整验证。模型辅助核验也应被视为降低风险，而非保证正确。

多仓库回答更弱：主要检查 URL 是否在 allowlist，并在结尾补来源链接，不检查每个比较结论。见 [aiWorkbenchService.ts:659](/D:/桌面/GSM/src/services/aiWorkbenchService.ts:659)。

### F05 · P1 · 调试日志默认可能保存模型输入中的敏感正文

位置：[aiService.ts:355](/D:/桌面/GSM/src/services/aiService.ts:355)、[logSanitizer.ts:119](/D:/桌面/GSM/src/utils/logSanitizer.ts:119)。

AIService 默认未启用 payload 隐藏，debug 模式会记录请求正文；部分新入口显式使用 `redactDebugPayload=true`，但仓库问答、Gist、旧分析等入口没有统一采用。

脱敏器能处理敏感字段名和完整 token 字符串，但自然语言/源码片段中夹带的凭据不一定命中。补充测试使用假密钥确认：多行 `content` 内的 `API_KEY=...` 原样保留。

**边界：** 这是启用 debug 且输入本身含敏感内容时的本地日志风险；本轮没有证明真实密钥已泄露，也没有证明日志被外传。

改进：默认不记录 prompt/response 正文，记录长度、hash、耗时、错误码即可；需要正文诊断时明确授权、限时启用，且增加内嵌秘密扫描。

### F06 · P2 · README-first 在大型文档树上不一定成立

位置：[repositoryChatService.ts:531](/D:/桌面/GSM/src/services/repositoryChatService.ts:531)、[repositoryChatService.ts:688](/D:/桌面/GSM/src/services/repositoryChatService.ts:688)。

候选路径先排名并截断到 80，再进行根 README 优先排序。若其他匹配文档很多，README 在第一步已经被丢掉，后续排序无法救回。已用 100 个部署文档的合成文件树复现。

改进：在候选预算外固定保留根 README、主要 manifest 和关键部署文件；其他候选按问题排序；支持逐层扩展而不是只暴露一个静态 top-80。

### F07 · P2 · 多仓库“深度研究”实际上主要是 README 比较

位置：[aiWorkbenchService.ts:558](/D:/桌面/GSM/src/services/aiWorkbenchService.ts:558)。

多仓库路径按 quick/standard/deep 只取前 2/4/6 个仓库，各读 README 前 12000 字符；没有复用单仓库的源码、Issue、Release 取证流程。所选数量超过预算时服务层直接截断。

因此它适合“产品定位/文档能力概览”，不适合直接承担“实现差异、可靠性、真实兼容性、性能、完整迁移方案”等深度比较。

改进：先显示实际研究范围；逐仓库按照同一需求矩阵取证；输出每项需求的满足/不满足/未知与证据；预算不足时分批或要求缩小范围，不静默省略。

### F08 · P2 · 工作台搜索验证偏向第一条查询的前几个结果

位置：[aiWorkbenchService.ts:454](/D:/桌面/GSM/src/services/aiWorkbenchService.ts:454)。

多个搜索分支按顺序追加候选，验证时只取整个数组前 3/5/8 个。只要第一条查询命中足够多，后续查询引入的互补候选通常没有机会被验证。

改进：跨查询去重后做融合排序/分支配额；优先覆盖不同候选类别；验证失败后递补；用户应能对任意候选发起同标准验证。

同时工作台候选评估硬编码简体中文，并用汉字正则验证摘要，不能按其他界面语言输出。见 [aiWorkbenchService.ts:360](/D:/桌面/GSM/src/services/aiWorkbenchService.ts:360)。

### F09 · P2 · 旧摘要分析、详情分析与发现分析使用不同证据标准

位置：[aiService.ts:1737](/D:/桌面/GSM/src/services/aiService.ts:1737)、[repositoryDetailAnalysis.ts:24](/D:/桌面/GSM/src/services/repositoryDetailAnalysis.ts:24)、[aiAnalysisHelper.ts:43](/D:/桌面/GSM/src/services/aiAnalysisHelper.ts:43)。

旧摘要只看 README 前 2000 字符；详情分析看前 36000；发现语义筛选又主要使用前 12000。长 README 的徽章、赞助、目录可能占满旧分析预算；安装说明或核心能力出现在后面时被遗漏。

旧分析在 README 读取失败后继续用 metadata，并最终设置 `analysis_failed=false`，没有明确表达“仅元数据推断”。

旧平台提示还把 Swift→iOS、Kotlin/Gradle→Android、API→web 作为线索，容易混淆开发语言、产品形态、部署方式和支持的操作系统。

详情分析已经开始区分 `software_forms/deployment_modes/platforms`，方向正确；应统一到全部入口。未知字段留空，比根据语言猜平台更可靠。

### F10 · P2 · Gist 的生命周期控制落后于新的仓库分析

位置：[useGistActions.ts:118](/D:/桌面/GSM/src/features/gists/hooks/useGistActions.ts:118)、[useGistActions.ts:219](/D:/桌面/GSM/src/features/gists/hooks/useGistActions.ts:219)。

单条与批量 Gist 分析未传入 AbortSignal；批量按并发直接 `Promise.all`，没有复用共享 RPM/429 冷却，也没有暂停/继续任务接口。账户切换后的完成回写缺少与新详情任务同级别的身份检查。

Gist AI 搜索只把前 120 个候选交给模型，剩余项目直接追加，不能视为全库语义搜索。见 [aiService.ts:1431](/D:/桌面/GSM/src/services/aiService.ts:1431)。

改进：统一任务生命周期、账户快照和增量 patch 写回；大库先检索再重排；多文件 Gist 按文件类型和相关性分配内容预算。

### F11 · P2 · 请求预算与恢复策略没有全局统一

位置：[aiAnalysisOptimizer.ts:249](/D:/桌面/GSM/src/services/aiAnalysisOptimizer.ts:249)、[aiService.ts:1250](/D:/桌面/GSM/src/services/aiService.ts:1250)。

旧仓库分析内层最多 3 次格式重试，默认外层最多 4 次尝试；持续非法输出时理论上一个仓库可能触发 12 次模型请求。外层限流槽包住整个 `analyzeRepository`，不等于每次实际 HTTP 请求都计入 RPM。

配置错误等不可恢复错误也缺少统一分类；直连普通请求没有统一总 deadline，部分上层有超时、部分没有。详情任务、自定义发现、Gist、工作台又各有不同的排队和超时策略。

改进：以 provider/config 为维度统一每次请求的限流；区分 401/403/参数错误、429、5xx、格式错误；统一 total deadline、重试次数、token/费用预算与取消语义。

### F12 · P2 · 大规模分类整理的第一阶段仍是全量上下文

位置：[aiOrganizationService.ts:49](/D:/桌面/GSM/src/services/aiOrganizationService.ts:49)、[aiOrganizationWorkflow.ts:47](/D:/桌面/GSM/src/services/aiOrganizationWorkflow.ts:47)。

归类执行已经按 20 个仓库分批，但设计分类树的首个请求把当前范围内所有仓库 metadata 一次发送，部分字段还包含详细分析摘要；没有相应输入 token 预算。

几千个 Star 的“整理全部”可能先在结构设计阶段超上下文或成本失控，后续分批并不能解决这个前置问题。

改进：先聚合主题/已有分类/代表样本生成候选结构，再按批验证与增补；给新增分类总量、层级和命名建立全局约束。

值得保留：草案预览、账户隔离、分类锁、冲突检查、应用日志和恢复机制已经较完整，见 [aiOrganizationExecution.ts:73](/D:/桌面/GSM/src/services/aiOrganizationExecution.ts:73)。

### F13 · P2 · 原生工具循环存在取证完成状态丢失

位置：[agentToolLoop.ts:354](/D:/桌面/GSM/src/services/agentToolLoop.ts:354)、[agentToolLoop.ts:475](/D:/桌面/GSM/src/services/agentToolLoop.ts:475)。

`dispatchToolCall` 中为 `ready_to_answer` 实现了 missing 解析与 verification 事件；但主循环遇到同名工具时直接设置 ready 并 break，没有调用这段处理。因此模型承认的证据缺口不会沿这条分支被记录下来。

另一个边界是强制“文档证据先于一切其他来源”：对没有可读文档、只想查询最新 Release/Issue 的仓库，循环会拒绝可用的元信息来源。

改进：统一经过 completion dispatcher；把 missing 作为结构化状态传给回答阶段；README-first 应是合理默认，不应在文档不存在时成为阻断条件。

### F14 · P2 · 自定义发现的运行状态和模型切换仍有小缺口

位置：[analysis.ts:13](/D:/桌面/GSM/src/features/discovery/custom/analysis.ts:13)、[analysis.ts:56](/D:/桌面/GSM/src/features/discovery/custom/analysis.ts:56)、[analysis.ts:100](/D:/桌面/GSM/src/features/discovery/custom/analysis.ts:100)。

分析缓存 key 包括 repo、更新时间、语言、版本，但不包括模型/提示词身份。换模型后可能继续使用旧结果；可以保留缓存，但应明确标识生成来源并提供重新分析策略。

`claimAnalysis=false` 既可能代表已有结果，也可能代表别的执行者仍持有租约；当前一律把 UI item 标为 done。这会把“正在其他地方执行”误显示成完成。

值得保留：条件来源必须来自用户原话、required/excluded/preferred 分离、unknown 待核验、原文 quote 检查、账户与 revision 校验、租约和 deadline。语义证据设计比旧工作台评估更完整，应复用而不是重写一套。

## 四、各功能的适用边界

下面的“可用”是基于代码与现有测试的工程判断，不代表已测得真实模型准确率。

| 功能/场景 | 当前判断 | 主要改进 |
|---|---|---|
| 单仓库短摘要、标签 | 基本可用，适合快速浏览 | 去掉固定前 2000 字符偏差；标识证据不足 |
| 批量摘要与分类 | 有暂停/继续、限流基础 | 统一真实请求预算、失败分类与超时 |
| 仓库详情、快速上手 | 比旧摘要完善 | 章节检索、字段级证据、结构化输出修复 |
| Gist 摘要 | 简短、少文件场景可用 | 多文件内容分配、取消/暂停、账户与限流 |
| Release 摘要 | 通俗概览可用 | 专门抽取 breaking changes、迁移步骤、影响版本；长日志分段 |
| 普通 AI 搜索 | 小库较合适，大库依赖词法召回 | 提升候选召回；不要把空结果当成全库不存在 |
| 向量搜索与相似仓库 | 架构已有基础，但应先修 F01/F02 | 版本化索引、混合检索、阈值校准、取消 |
| README/docs 使用问答 | 当前问答链较适合的场景 | 内容定位与引用语义支持度 |
| 复杂源码/架构分析 | 尚不能跨语言普遍胜任 | 路径/语言扩展、代码搜索、调用关系取证 |
| Issue 故障排查、Release 研究 | 已有工具，但覆盖有限 | 查询改写、多个 Issue 查询、后续评论与版本匹配 |
| 无文档项目或外部官网为主的项目 | 不完善 | 无文档降级；外部文档安全取证；避免空开关 |
| 工作台 GitHub 项目选型 | 可初筛，不能当完整验证报告 | 多分支公平验证、需求证据矩阵 |
| 多仓库深度比较 | 目前更接近 README 概览 | 实际执行逐仓库研究；不静默截断 |
| AI 全库分类整理 | 操作安全框架较成熟 | 大上下文拆分、标签稳定性、跨批一致性 |
| 自然语言发现订阅 | 规则/证据约束较好 | 证据覆盖、缓存来源、状态准确性与费用控制 |
| 插件 AI | 有能力授权和逐次确认 | provider 预算与隐私政策统一 |
| MCP 外部 Agent 接入 | 只读工具与协议测试基础较好 | 明示 freshness、缓存边界；外部 Agent 的最终结论仍需评估 |

补充边界：

- `enableWebTools` 有设置项，但本轮未发现执行 web search/fetch 的问答链路；UI 文字也说明当前版本尚不调用。它不能算已实现的联网取证能力。见 [AIConfigPanel.tsx:867](/D:/桌面/GSM/src/components/settings/AIConfigPanel.tsx:867)。
- 页面翻译走独立 Edge 翻译客户端，并固定 English→简体中文，不是用户配置的大模型能力。见 [pageTranslationClient.ts:25](/D:/桌面/GSM/src/services/pageTranslationClient.ts:25)。
- 资产平台匹配、健康事实展示中的确定性规则不应一概宣传为“AI 已验证”；规则推荐与模型结论应有明确标识。

## 五、模型、运行环境与语言适配

### 1. 从“协议名称”升级到“已探测能力”

当前连接测试只是发送“回复 OK”并判断是否有文本，不能证明 JSON、流式、工具调用或长上下文任务可用。见 [aiService.ts:1975](/D:/桌面/GSM/src/services/aiService.ts:1975)。

建议连接测试输出能力矩阵：纯文本、JSON schema、SSE、取消、工具调用、长输入、推理参数。缓存结果时绑定 provider、endpoint、model 和适配器版本。

Chat Completions、Responses、Claude、Gemini 不应共享未经验证的参数映射；当前代码对 `max_tokens`、`temperature`、`reasoning` 的处理需要补真实端点契约测试。本轮没有真实端点验证，不把某个具体厂商/模型判为已经实测不兼容。

原生工具循环只启用 OpenAI chat 风格的一组协议，其他协议可以走编排式循环，这是“有降级路径”，不是所有模型都有同等 Agent 能力。见 [aiCapabilities.ts:9](/D:/桌面/GSM/src/constants/aiCapabilities.ts:9)。

### 2. 本地模型

设置页和多个任务入口强制要求非空 API key，实际无鉴权的本地兼容服务也需要占位值。见 [AIConfigPanel.tsx:207](/D:/桌面/GSM/src/components/settings/AIConfigPanel.tsx:207)。

应支持显式鉴权模式 none/bearer/custom；允许本机无 key；远程 HTTP 仍需保留安全限制。小模型应有更小批次、较窄 schema、一次有边界的修复与保守拒答策略。

### 3. 直连、Electron、后端代理

至少分别验证阻塞和 SSE、取消、429/Retry-After、代理断开、上游慢响应。当前存在后端 fallback，并不能据此推断所有传输模式一致。费用与超时应以一次用户任务的总预算为准。

### 4. 多语言

主要摘要功能已有输出语言指令，但工作台候选验证仍硬编码简体中文；不少 Agent 自定义提示只分 zh/非 zh；关键词与文件路径启发式主要偏中英。

应把“用户输出语言”和“检索语言”分开：用户用日文提问，仍可用英文搜索代码/Issue，但答案保持日文。用跨语言检索样本验证，不只检查 locale key 完整性。

### 5. 结构化数据与来源版本

统一 JSON 解析/校验/有限修复，而不是各服务各自提取代码围栏。不同环节可以继续使用不同 schema，但错误语义应一致。

证据记录应包括 repo、commit/ref、path、行号、hash、retrievedAt；对实时 Release/Issue 单独标明取证时间，不与固定源码 SHA 混为一个版本。

## 六、建议实施顺序

### 第一阶段：修正结果可信度与时序

1. F01 搜索竞态，确保旧任务永不覆盖新任务。
2. F02 索引 fingerprint 与查询前一致性检查。
3. F05 debug 默认不保留敏感正文。
4. F03/F06 路径覆盖与 README 保留。
5. F04 清晰区分来源有效和事实成立。
6. 统一无证据/部分证据/完全覆盖的状态，不把 metadata-only 包装成完整分析。

### 第二阶段：统一任务与取证底座

1. 建立共享请求执行器：deadline、取消、限流、重试、usage、账户与任务身份。
2. 旧摘要、详情、Gist、发现、工作台共用证据提取组件；优先按章节和问题选取，而不是简单前缀裁剪。
3. 建立 claim-evidence 输出模型，优先覆盖平台、功能条件、部署步骤、breaking changes。
4. 工作台逐仓库研究后聚合；分类树按聚合与增量生成。
5. 保留现有草案确认、冲突检测、操作日志和恢复机制。

### 第三阶段：用效果评测决定是否“优秀”

建议先建立约 100 个固定用例，分成已知答案与真实开放任务，维护独立留出集：

- 摘要/分类 15：短 README、长徽章区、多产品、无文档、名称误导。
- 检索 20：中英跨语言、否定条件、冷门仓库、千级库、同维度换模型。
- 单仓库问答 20：安装、参数、架构、根目录脚本、Go/C++/Vue/Swift、README 与源码冲突。
- 多仓库选型 15：不同硬性需求、缺证据、低热度正确候选、超过预算数量。
- Gist/Release 10：多文件、超长日志、breaking change、空内容、敏感正文。
- 生命周期/对抗 20：提示注入、取消、账号切换、429、断网、上下文超限、伪造引用。

分开统计：检索 Recall@K/nDCG、硬性条件误满足率、来源支持率、任务完成率、合理拒答率、P50/P95 耗时、每任务请求数/token/成本、取消后写回次数。

建议的硬性验收线：不跨账户写回、不提交过期任务、不混用不兼容向量索引、不执行未确认的写操作、无证据时不得标记为已验证。这些是建议标准，不是当前已实现的保证。

## 七、最终判断

**值得继续完善，现有架构并非需要推倒重来。** 固定 SHA 取证、引用定位、结构化 schema、草案确认、账户隔离、冲突检测、回滚以及发现订阅的逐条件证据机制，都已有可复用基础。

最有效的下一步不是继续堆 AI 按钮，而是先把搜索时序、索引一致性、证据覆盖和验证口径统一，再用真实模型评测决定默认模型、任务预算与自动化程度。
