# AGY 剩余可靠性问题审查（2026-10-17）

## 审查边界与结论

本次针对 `D:\桌面\GSM` 当前未提交工作树，HEAD 为 `6b30a966`。以 `task-failure-fixes-validation-20261017.md` 为上轮修复基线，检查实际代码、调用方和恢复入口。全部由主对话完成。

没有启动真实 AGY、调用付费模型、操作生产 profile、关闭正在使用的程序或修改产品源码。本次不是新一轮生产故障频次统计；不能将源码可达风险说成用户已经遭遇的事件，也不能把历史失败数量视为修复后新增失败。

上轮修复仍成立：普通 generation 的 cleanup timeout 不再主动 abort 全队列；主队列有 producer 公平调度；详情有效数组可受控裁剪；task journal 已按记录写入；无变化同步不再逐轮建任务。以下是这些修复尚未覆盖的边界。

当前确认的主要缺口是：重启恢复不能可靠识别已发送调用；worker 回收失败可持续污染后续请求；连接测试旁路了新的 cleanup lease；Organization 的优先级、排队期限和恢复入口尚未统一。没有证据支持把所有剩余问题归因于模型速度或 GitHub 网络，也没有本轮证据将其整体定为 P0。

## 1. P1：重启恢复及 Organization 入口仍可漏掉未知调用提醒

### 桌面重启路径——已复现

`src/services/aiTaskJournal.ts:117` 的 `mergeSaved()` 将非终态本地任务变成 `interrupted`，将 running 子项变成 pending，但原来的 `providerOutcome=in_flight` 被原样保留。

`src/components/tasks/TaskCenter.tsx:71` 只在 `providerOutcome=unknown` 或 `resume=new-provider-call` 时询问用户。`src/components/AITaskPanel.tsx:39` 的“继续未完成项”会选择这些恢复后的 pending 项。

隔离测试写入一条已经 sent、providerOutcome 为 in_flight 的任务，再重新加载 journal。结果为 interrupted + pending + in_flight；按 TaskCenter 的实际条件，重新调用不需要未知结果确认。

这不是启动即自动重放，但用户点击普通“继续”可能发起新调用，而上一调用是否完成、是否计费并未确认。任务主进程也没有一个能够跨 renderer 崩溃恢复的 durable request/result registry。

### Organization 来源页——静态调用链确认

`src/components/organization/OrganizationExecutionDetails.tsx:45` 直接调用 `c.retryBatch()` / `c.retry()`；`src/hooks/useAIOrganization.ts:155` 继续到生成流程，没有使用 TaskCenter 的 `allowNewCall()`。重试筛选依据 batch/fact 状态，未统一使用逐 request 的 provider outcome。

因此即使 TaskCenter 正确提示未知结果，来源页的“重试批次/继续”也未必提供等价提示。没有证据说明这是自动重放；问题在显式恢复入口语义不一致。

建议：恢复时把缺少终态回执的已发送调用转换为 unknown；所有恢复入口共享 request lineage 和确认规则。queue_wait / 明确未发送项仍允许安全恢复；已成功项只恢复提交，不重跑模型。

## 2. P1：worker 回收一次失败，可使后续请求持续失败——已复现

`electron/agyRuntime.js:233`：

```js
maintenance = maintenance.then(() => previous ? remove(previous) : undefined);
```

`prepare()` 在 `:237` 必须先 `await maintenance`。一旦删除目录失败，这个 Promise 保持 rejected，后续 recycle 继续接在 rejected promise 上，不能重新执行清理；新的 request 也会在 prepare 阶段立即失败。

fixture 为指定的独立临时 workspace 注入一次 EBUSY，随后恢复正常 fs.rm。两次后续 request 仍返回 EBUSY，runtime 调用数为 0。此时文件占用已经消失，失败仍然持续。

自动回收可在空闲、请求数量或生命周期阈值触发，回收异常被 `.catch(() => {})` 吞掉。`electron/agyDesktop.js:183` 附近的 recover 重置队列状态，却不修复已有 supervisor 的 rejected maintenance。

影响：一次 Windows 文件占用可能演变成该 supervisor 后续请求全部 IO_FAILED，用户误以为模型或网络持续故障。不能保证一次“恢复队列”按钮就能修复。

建议：显式维护可恢复的 worker health/maintenance 状态；失败时保留待清理路径，不丢失所有权；下一次启动重试清理或安全替换 supervisor。队列恢复必须同时核对 supervisor 状态。

## 3. P1：连接测试没有遵循 generation 的进程清理隔离——已复现

正常 generate 会将 runtime 的 `cleanupSettled` 交给 worker/queue，保留 suspect 容量及请求目录。但 `electron/agyDesktop.js:254` 的 probe 自行调用 runtime，只取 text/usage，并在 `:265` 无条件删除 cwd。

两种情况都已通过注入 runtime 复现：

1. 返回有效结果，同时 cleanupSettled 尚未解决：probe 显示 SUCCESS，pool.suspect=0，cwd 已被删除。
2. 抛出附带 cleanupSettled 的 CLEANUP_TIMEOUT：probe 把异常转换成测试结果后正常返回，queue 看不到异常；pool.suspect=0，cwd 仍提前删除。

这不是声称真实进程已逃逸；fixture 没有启动 CLI。它证明 service adapter 会丢失清理租约，不再遵守正常 generation 的所有权规则。

`listModels()` 在 `:240` 也无条件删目录，需要连同模型枚举统一审查。普通全局 probe 失败还会禁用配置并取消 generation siblings；网络或清理类测试失败不应默认等同于配置已不可信。

建议：probe、模型枚举和 generation 共用同一套进程所有权/退出确认封装；测试的业务结果与清理状态分别返回；迟迟未退出者必须继续占容量。

## 4. P1：手动 Organization 仍是 background，排队与超时预算也不统一

### 手动任务优先级——静态确认

`src/services/aiOrganizationPipeline.ts:87` 固定使用：

```ts
forAgyFeature(configured, 'organization', 'background')
```

手动点击分类整理也走这条 pipeline。主队列 `electron/agyQueue.js:40` 始终优先符合条件的 interactive 请求。故手动详情、聊天等持续占满容量时，手动分类整理无法参加手动 producer 的公平轮转，反而与自动后台任务一起让路。

这是调用方优先级错误，不是旧 warmed 1→2 限制又出现。

### 等待期限——已复现局部行为，组合影响由调用链确认

- `agyQueue.js:84` 的 deferOnTimeout 只提示一次，然后保留 pending；没有后续终止期限。10ms 缩放阈值的 fixture 等待 80ms 后仍 pending，仅提示一次，取消仍有效。
- `src/services/agyClient.ts:148` 对明确未入队的 RESOURCE_DEFERRED 无限重试 admission。没有总等待期限，且等待者尚不计入 main queue 的 queued 数量。
- 主 Organization executor 在 `aiOrganizationExecutor.ts:110` 又用 `2 × model timeout + 10s` 限制整个调用。默认 180s 对应 370s，包含排队、初始化、模型和清理，不是纯模型预算。
- refinement / tree redesign 等路径在 `aiOrganizationRefinement.ts:116`、`aiOrganizationTreeRedesign.ts:27` 使用单倍配置时限，同样从排队之前开始。
- 隔离测试确认，organizationRequest 的外层 deadline 即使 work 仅本地等待、没有发送 provider 请求，也会到期。

结果：详情可能持续等容量，分类修改却因等待耗尽整个时限；同一个超时设置的含义因入口而异。任务看似模型超时，实际上可能未开始生成或生成预算被排队挤占。

本轮曾假设外层等待超时一定映射 UNKNOWN_PROVIDER_OUTCOME，测试否定了这个过强结论：当前 jsdom 路径直接得到 TimeoutError。保留“计时包含排队”的已验证结论，不把错误码映射推广到所有环境。

建议：手动 Organization 设 interactive；分别定义 admission、init、generation、cleanup 预算；总等待到期输出明确的未发送 deferred 状态。后台仅空闲运行是用户已批准策略，应保留。

## 5. P1：配置失效仍可能放大成整批失败——两段链路均已复现

`electron/agyDesktop.js:202` 的 save 和 `:320` 的 generate 只核对 probe 成功与 executable fingerprint，未核对已保存的完整 probe identity。设置面板虽然计算 probeMatches，但配置已经启用后，修改 model/effort 仍可直接点击“保存”保留 enabled。

fixture：先测试默认 model + medium，再保存 untested-model + max + enabled=true。保存成功，实际仍沿用旧 identity 的 SUCCESS probe。

另一方面，`useRepositoryDetailAnalysisJob.ts:174` 只将 DISABLED、AUTH_REQUIRED、PERMISSION_DENIED、QUOTA_EXHAUSTED、BUDGET_LIMIT 识别为停止新派发的配置错误。MODEL_EFFORT_CONFLICT、TEST_REQUIRED、NOT_FOUND、INVALID_MODEL 等没有覆盖。

单并发、4 个仓库 fixture 中，每次模拟 MODEL_EFFORT_CONFLICT，四个仓库仍全部尝试并失败。不是一个配置错误后停止剩余派发。

建议：完整 identity 决定新 revision 是否已测试；统一错误分类表，各批量入口共享 fatal/config/deferred/unknown 判断。保留旧 revision 下健康在途请求的既定设置，避免修复配置门禁时又引入全队列取消。

## 6. P1：桌面“已生成、保存失败”仍缺完整的 commit-only 恢复

这是静态流程确认，未在生产资料上制造磁盘故障。

- `repositoryDetailAnalysis.ts:79` 仅在输出解析/校验失败时保存 raw-response checkpoint。
- 普通生成成功在 `:103` 会清掉旧 checkpoint；此时调用方还没有完成保存。
- 调用方随后在 `useRepositoryDetailAnalysisJob.ts:146` 写 lease/details，再写 analysis asset，最后在 `:194` flush Store。
- 若第一段持久化失败，新有效响应可能仅在内存；若后续段失败，lease 中可能已有 details，但失败项重试仍走 force=true 的新模型调用，没有直接将已有 details 提交完成的入口。
- 如果 Store flush 失败而 items 已全部 complete，任务成为 partial，但 TaskCenter 的“重试失败项/继续未完成项”都不匹配；commit-only 按钮目前仅处理 commitStatus=conflict。

不能简单宣称所有结果都会丢失：asset/lease 可能已经持久化。确切缺陷是“已有结果如何完成剩余提交”没有形成统一可恢复协议，UI 可能只有重新分析或无可用恢复按钮。

建议：在 provider 成功到业务发布之间引入 durable result checkpoint，逐项记录提交进度，提供 retry-save；仅在确认所需持久化完成后清理。磁盘完全不可写时必须承认保存失败，不伪造 durable 成功。

## 7. P2：错误呈现仍会同时漏报和误报——均已复现

### 清理警告被抹掉

runtime 发出 cleanup warning 后，`agyDesktop.js:345` 的 finally 再发 cleanup。`agyClient.ts:104` 每次进入非 queue_wait 阶段都会设置 warning=undefined。注入 sent→cleanup→warning(CLEANUP_TIMEOUT)→cleanup，最终子项 warning 消失。

影响：本次结果可能已交付，但 suspect 仍占容量；用户看不到导致有效容量降低的警告。

### 已知成功响应被标为未知

`agyClient.ts:156` 对 `result.ok` 但超出本地字符上限的结果抛 AGY_OUTPUT_LIMIT；`:176` 只依据 sent 和少量错误白名单决定 unknown。

fixture 返回明确成功的 4,001 字符结果，本地上限 4,000，最终变成 providerOutcome=unknown，而 provider 已经明确成功返回。响应也未到达详情层的可修复 checkpoint。

建议：把 provider terminal outcome、业务 validation outcome、cleanup outcome 分开；警告保留到明确解决。未收到终态才是 unknown，应用拒收完整结果应是 succeeded + validation_failed。

## 8. P2：Organization diagnostics 仍整块重写，并保留失败响应正文

`src/services/aiOrganizationRunEvents.ts:33` 每次 persist 读取整个 owner 诊断 JSON，合并后 `:40` 整块写回；`:57` 每次 endedAt 更新都会触发，received→verified/failed 会多次触发保存。

其保留策略有界：七天、每 owner 持久化最多 10MiB，失败 output 每条最多 16KiB；不能把它说成旧 journal 的无限增长。内存 rows 则按 proposal 存放，每 proposal 500 条，但没有全局 proposal 数量上限或账号切换清理。

仍然存在两个待优化点：

- 大失败历史下，完成一个请求仍需读、解析、合并、重编码整块诊断记录；本次未做真实机器卡顿归因。
- 失败正文默认落盘，使用独立 redactOrganizationOutput，且复制 trace 没有再经过统一 sanitizer/deep-redact。这里的“执行详情正文”应与普通 metadata-only 诊断明确区分；不能把当前日志保留理解为完全不存模型内容。

建议：trace 按 request 存储，限制全局内存；普通诊断只保留 metadata。需要本地响应恢复时使用专用、有范围和有效期的存储，导出统一再次脱敏。

## 已知约束与优先顺序

AGY 仍是长驻调度 supervisor + 每请求独立 CLI 进程和 request directory。真实 CLI 的启动/初始化成本没有消失，这是此前用户批准的隔离方案，不应当作本次新发现的回归。没有 fresh-context/reset 回执能力证据前，不建议为了速度复用同一模型会话。

建议依次处理：

1. 重启/所有入口的 unknown 恢复协议；worker maintenance 恢复；probe cleanup lease。
2. 手动 Organization 优先级与统一阶段预算；配置 identity 和 fatal 分类。
3. 桌面 durable result + commit-only 恢复；警告及 outcome 呈现。
4. Organization diagnostics 增量写入、内存上限与正文留存策略。

本轮无需重新推翻 Store 或重写所有调度代码；问题主要在不同入口没有复用同一套生命周期与恢复约束。

## 本轮验证和清理

- 新建临时 Node 探针，5 个断言场景确认：无终止排队期限、旧 probe 放行新模型、成功 probe 丢失清理租约、失败 probe 丢失清理租约、一次目录回收失败持续污染 worker。
- 临时 Vitest：2 文件、5 项通过，验证已发送任务重启分类、纯等待消耗外层 deadline、清理警告丢失、成功响应误标 unknown、配置冲突继续派发 4 项。
- 既有 AGY client / Organization reliability / scheduling：3 文件、12 项通过。
- 既有 Electron queue/runtime/desktop/IPC/protocol：5 个测试文件命令通过。
- 这些临时测试断言的是“当前缺陷可重现”，通过不代表缺陷已修复。没有运行全量发布 gates，也没有新部署。
- 临时探针使用合成内容和独立临时目录；临时测试、探针及目录在完成后删除，只保留本审查报告。产品源码未修改。
