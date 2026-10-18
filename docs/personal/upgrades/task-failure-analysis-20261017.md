# 当前任务失败分析（2026-10-17）

本轮结论：失败记录来自至少五条不同故障链。当前最需要修复的是 Home 同步中不可同步字段导致的固定批次阻塞，以及多业务同时提交 AGY 请求时的排队失败。输出 schema 与 prompt 不一致、生成结果与进程退出耦合、批任务状态聚合不完整，则进一步增加了失败数量与诊断歧义。不能统一归因于模型慢、GitHub 不稳定或历史任务残留。

## 1. 取证范围与统计口径

- 时间：2026-10-17，北京时间。任务统计截至 19:51:47 的本地 IndexedDB 副本；之后原程序仍运行，数量可能继续变化。
- 原始资料只读：复制 file origin IndexedDB，在独立、隐藏且禁止网络请求的 Electron 中执行 readonly 事务。复制前后源文件 SHA256 一致，38 个文件、48,072,538 字节。这证明复制窗口内这些文件稳定，不等于生产应用已退出。
- 同时核对桌面 diagnostics、运行进程、Windows service 配置、实际 SQLite 和当前源码。没有重新调用 AI，没有重试真实同步，没有修改生产任务、仓库或配置。
- Journal v2 为当前统计来源。旧 blob 的 607 条记录是迁移回滚来源，不能与 v2 相加。
- 成功自动任务会按数量和时间裁剪，attention 长期保留。因此以下是保留的任务存量，不能据此计算所有调用的真实失败率。

| 状态 | 当前保留 | 10 月 17 日创建 |
|---|---:|---:|
| failed | 127 | 17 |
| partial | 12 | 8 |
| interrupted | 13 | 3 |
| complete | 45 | 1 |
| canceled | 13 | 1 |
| 合计 | 210 | 30 |

当前 failed/partial/interrupted 共 152 条，其中 83 条记录 `PRIVATE_DATA_NOT_SYNCABLE`。今天新建的 30 条中，9 条 sync 和 1 条 refresh 因该错误失败；7 条 discovery 失败、7 条 discovery-analysis 部分完成；6 条 details 则分别为 complete 1、partial 1、interrupted 3、canceled 1。今天的问题确实仍在发生。

## 2. P0：Home 同步被带 token 字段的固定批次阻塞

### 已确认的现场

- Home outbox 326 条：organization 1 条，repositories 325 条。
- 325 条 repository 数据全部带 `$.temp_clone_token`，类型 string、非 null；其中一条还带 `$.template_repository.temp_clone_token`。诊断只检查字段路径和类型，没有导出字段值。
- durable `inFlight` 保存的是两个操作：organization 和一条 repository；后者含禁用字段。
- 桌面日志反复出现 `/api/sync/v2/operations` POST HTTP 400，与 Journal 中的 `PRIVATE_DATA_NOT_SYNCABLE` 对应。
- 新 activity 聚合记录 runCount=8、changedCount=8、failureCount=8。这是该聚合开始记录后的计数，不是全部历史同步次数。

### 代码与因果链

`src/home/desktop.ts:28–37` 的 `desktopStoreRecords()` 对整个 repository 执行 `json(data)`。GitHub 原始对象中附带的额外字段因此进入同步记录。

`server/src/services/syncV2.ts:44–55` 的 `validateData()` 递归拒绝含 token、password、secret 等字段名。它按字段名拒绝，即使把值改为 null 也不能解决。

`src/home/database.ts:127–141` 的 `nextBatch()` 遇到已有 `inFlight` 会原样返回。`finishBatch()` 只有正常完成回执处理后才能解除固定批次；`src/home/sync.ts:120` 的 HTTP 400 则直接进入失败分支。因此无论后续积累多少编辑，下一次仍先重试同一个不合法批次。

这不是普通的临时网络错误。继续重试原数据不会成功；本地 AI 结果已保存也不代表已到达 Home 服务。

### 修复要求

1. 在客户端同步边界建立明确的业务数据 projection；不把临时认证字段和嵌套原始对象无条件带入 Home。
2. 保留服务端隐私拒绝规则。不能放宽 token 校验来恢复同步。
3. 对已有 outbox/inFlight 增加受控修复路径。先验证这是在应用操作前确定性拒绝的批次，再重建安全操作并保留请求 lineage；不能直接修改任何回执未知的不可变批次。
4. 将确定性数据拒绝与可重试网络错误分开，避免重复制造同一原因的 attention 任务；保留聚合次数和最近错误。

旧 release 的 `server/dist/services/syncV2.js:39–55,197–198` 也有相同字段校验和批次应用前校验。当前新版同样会拒绝，因此只升级服务不能修好这条链。

## 3. P0：30 秒 admission 与多个持续提交者不匹配

### 已确认的现场

- 今天手动 details 的失败子项中，42 条明确为 `AGY_QUEUE_TIMEOUT`。
- 同期七轮自动 discovery-analysis 共 70 个子项，38 完成、32 因 `AGY_QUEUE_TIMEOUT` 失败。
- 七轮 discovery 任务自己的错误列表同样含多个 `AGY_QUEUE_TIMEOUT`，有的还含模型超时。这里是一条任务聚合多个错误，不能当作一条 provider 调用。
- 自动轮次约在 18:03、18:18、18:34、18:49、19:04、19:20、19:36，持续与手动详情批量工作重叠。

### 当前调度组合

- `electron/agyDesktop.js:349` 给 generation queue 固定 `waitMs: 30000`。
- `electron/agyQueue.js:36–48,70–83` 在 capacity 满时排队，并在 deadline 到期直接 reject。interactive/background 按 3:1 选择请求，但没有按业务 producer 为批任务分配公平份额。
- 手动详情一次可启动最多五个 worker；自动详情 `src/features/discovery/custom/analysis.ts:213,219–259` 也可启动最多五个并分析十个仓库。
- `src/features/discovery/custom/modelScheduler.ts:38–42` 的 AGY 分支直接交给 main queue；`useCustomDiscoveryLifecycle.ts:43–51` 每分钟检查、到期每十五分钟尝试，没有与手动详情占用协调。
- 已占用 slot 的请求通常持续几十秒。新的请求即使完全健康，也可能等不到三十秒内的可用 slot。

本轮重新运行无模型、无网络的缩放复现：capacity=5，十个请求同时提交，每个工作 300ms，admission=80ms。结果五个工作启动并完成，另外五个 `QUEUE_TIMEOUT`，queue 没有 quarantined、provider 没有失败。它证明正常饱和即可产生该错误；缩放时间不代表真实 provider 延迟。

`agyQueue` 的 timeout 降容、rate-limit cooldown、suspect capacity 隔离也可能扩大等待，但现场没有持续 pool trace，不能断言某一失败时刻实际降到了几个 slot。

### 修复要求

保留 main queue 为唯一 admission 控制器，同时增加业务 producer 背压和公平调度。未发送的 admission 超时应归为资源延后，而非模型失败；取消仍必须立即有效。手动批量期间如何延后自动 AI 需要明确产品策略。仅把三十秒改回十分钟会隐藏拥堵，不能解决持续提交者之间的竞争。

这里也暴露了上轮实现的组合缺口：去掉外层重复 scheduler 是合理方向，但固定三十秒 admission 没有配合 producer 调整，真实并行工作会被错误结束。

## 4. P1：模型输出限制没有完整传给模型

### 已确认的现场

19:44:36–19:51:15 的 details 批次 36 条：31 完成、5 失败。四条因 `platforms` 超过 10 项被拒绝，一条因 JSON 字符串包含非法控制字符被拒绝。该批所有请求累计 queue wait 仅约 1.8 秒，因此不能用排队解释这五条失败。

今天手动 details 的 schema/JSON 失败子项共 13 条：platforms 9、features 1、quickstart 1、JSON 2。它们来自多个批次，可能包含同一仓库的再次尝试，不能当作十三个唯一仓库。

### 代码与因果链

- `src/utils/repositoryDetailsSchema.ts:4–19` 限制 platforms 最多 10、features/scenarios 最多 30、quickstart 最多 20，并严格校验类型和字段。
- `src/services/repositoryDetailAnalysis.ts:32–41` 的 prompt 写了平台单项长度，但没有传递这些完整数量上限。
- `repositoryDetailAnalysis.ts:50` 直接 `JSON.parse` 后 `schema.parse`。一个列表多一项就让整个结果无法写入；这条路径没有保留可供本地修复的失败响应 checkpoint。

因此“模型已成功返回”与“业务分析成功”并不相同。schema 失败后当前只能再次生成或人工处理，可能增加重复调用成本；不能据记录推算实际重复收费。

### 修复要求

先让 schema 与输出指令共用约束来源，明确所有数组、文本和枚举限制。对无效响应提供受控的本地 checkpoint、验证诊断和单独修复入口。是否允许在不调用模型的情况下对超长数组去重、截断，应由用户确认；不能擅自放宽安全校验、修复任意 JSON 或改变命令证据验证。

## 5. P1：结果已经返回，进程退出仍可使结果交付失败

今天至少一条手动详情子项明确记录 `AGY_PROCESS_EXIT_TIMEOUT`，并非全部都是排队超时。

`electron/agyRuntime.js:167–171` 已观察到 `parser.result` 后启动退出等待；未在 cleanupTimeoutMs 内 close 就设置 `PROCESS_EXIT_TIMEOUT`。后续 close 分支优先 `finish(failure)`，已有结果无法返回。`src/services/agyClient.ts:159–164` 又把已 sent 且非明确拒绝的异常归为 `unknown_provider_outcome`。

这说明上轮 cleanup 故障域隔离只避免了中断健康 sibling，还没有完成“validated terminal artifact 与 process cleanup 解耦”。此处不能通过简单吞掉退出错误解决：需要先保存并验证完成结果，再独立报告清理状态和隔离可疑进程容量；半截 stdout 不能被当作成功。

## 6. P1：批任务聚合状态丢失了子项差异

以下为今天手动详情任务，编号只取任务 ID 的末六位，时间为北京时间：

| 创建—结束/最后更新 | 编号 | 总数 | 完成 | 失败 | 未执行/取消 | 任务状态 |
|---|---|---:|---:|---:|---:|---|
| 18:03:08—18:05:17 | 410404 | 325 | 6 | 6 | 313 取消 | canceled |
| 18:06:22—18:07:56 | ebeab9 | 6 | 6 | 0 | 0 | complete |
| 18:08:58—18:10:00 | 0846c6 | 317 | 5 | 0 | 312 待处理 | interrupted |
| 18:11:45—18:50:06 | b9747e | 312 | 177 | 16 | 119 待处理 | interrupted |
| 19:05:33—19:29:51 | 39ce21 | 135 | 99 | 29 | 7 待处理 | interrupted |
| 19:44:36—19:51:15 | 474b76 | 36 | 31 | 5 | 0 | partial |

批次间可能有重试重叠，不能相加推算唯一仓库或调用次数。

- `aiTaskJournal.ts:191` 的默认 finish 只要还有 pending/running，就优先 interrupted；已完成并保存的 177 或 99 条仍可能被整体“中断”标签遮住。
- `agyClient.ts:103–105` 将 task 级 unknown 保持为粘性状态，这是为避免误重放，但没有对应的 item 级 providerOutcome，无法区分哪个子项未知、哪个只是没被发送。
- 同一任务可能显示 `providerOutcome=succeeded`，同时保留旧 `failureCode=AGY_QUEUE_TIMEOUT`；它们描述不同子调用，但 UI 没有解释。
- details 的 `commitStatus=saved` 表示已完成部分的本地持久化，不代表全批成功，也不代表 Home 已同步。
- `useRepositoryDetailAnalysisJob.ts:55–60` 的页面 stop 没有先记录 journal stopping；journal 默认终态依赖该标记。卸载和账号变化也会停止工作，但没有完整 durable stopReason。因此不能由 interrupted 反推出某次一定是 provider 故障，或一定是用户点了停止。
- discovery 的部分结果已 publish，但其任务 commitStatus 仍可能是 not_started，说明新协议尚未覆盖全部生产路径。

修复应补 item 级 phase、providerOutcome、commitStatus、stopReason 和 request lineage，任务级按分布聚合；区分“失败”“未执行”“结果未知”“已保存”“尚未同步”。未知调用仍不得自动重放，也不应因一条未知而重跑整批成功项目。

## 7. 版本差异、性能与验收边界

### 服务版本确有落后，但不是统一根因

Windows service 配置 `home-backend/service/GSMBackend.xml:3–5` 指向 `releases/0.8.4-20261002170919345`，服务进程启动于 10 月 16 日 20:19:55。当前桌面 Electron 于 10 月 17 日 18:02:27 从仓库启动。

实际服务 SQLite 的 ai_tasks 仍缺新版 executor/commit/provider/lineage 字段。服务端只有八条任务，六条 completed、两条 interrupted，均为九月底历史任务，不是今天大量本地失败的主体。当前源码更新不代表运行服务已更新，后续必须分开验收并部署。

历史记录还包含大量 AGY_DISABLED 和五条 HTTP 402 余额不足错误；它们不能当作今天 AGY 的同一个故障。配置失效后仍逐个推进批任务会放大历史错误量，应在配置级不可用时暂停该批而非反复失败全队列。

### 当前慢并非都来自进程初始化

完整成功的六条批次墙钟约 94 秒；各调用累计 initializing 37.4 秒、generating 302.8 秒、cleanup 7.5 秒。最后 36 条批次墙钟约 399 秒；累计 initializing 223.1 秒、generating 1582.0 秒、cleanup 60.2 秒。这些是并行请求阶段累计，不能相加当成用户等待时间。

独立 CLI 的初始化成本仍在，但现场 model/generating 阶段更大；需要同时处理调度、模型延迟和输出验收。usage 是 CLI 报告的计数，不等同于账单，未据此估算费用。

### 上轮验收遗漏

上轮通过的测试证明了 fixture 和局部不变量；copied-profile smoke 没有真实网络同步，AGY fixture 也没有模拟多个业务持续补充请求以及真实 provider 输出分布。它们没有覆盖本次的原始 repository token 字段、固定 inFlight 的 HTTP 400、后台订阅与手动批次竞争，以及超长平台列表。

因此上一轮“完成可靠性方案”的结论范围过宽。实现和测试已落地，但这些生产组合路径仍未闭环，不能以已有测试数量否定现场失败。

## 8. 建议修复顺序与决策点

1. **同步解阻**：客户端数据 projection、真实已拒绝批次的安全修复、确定性错误聚合；测试必须覆盖嵌套 temp_clone_token 与已有 inFlight，不降低服务端安全要求。
2. **调度闭环**：producer 背压/公平份额、未发送请求资源延后、手动批次与自动订阅协调。需要决策：手动批次期间是否允许后台 AI 只在空闲容量运行，自动发现的非 AI 数据刷新可继续。
3. **降低已生成结果损失**：统一 prompt/schema，保留受限失败响应 checkpoint，拆分 terminal artifact 与进程退出。需要决策：超长数组采用显式本地裁剪，还是保留原结果并要求用户确认修复。
4. **完善逐项状态和恢复**：记录 stopReason、逐项未知结果、局部保存与远端同步状态，只处理必要子项，不自动重放未知结果。
5. **部署与真实组合验收**：修复后更新后台 release，核对启动目录和 schema；在隔离副本/可控 fixture 覆盖 400 阻塞恢复、多个 producer 长延迟竞争、无效输出、结果后进程挂起、正常停止/重启。真实付费调用或外部写入另行授权。

本轮交付为分析，没有修改产品源码或生产状态。永久记录仅保留本报告与同名脱敏聚合证据 JSON。已删除本轮临时 IndexedDB 副本、探针和探针运行缓存：111 个文件、42 个目录、58,995,371 字节，核实临时目录不存在。未清理其他阶段或用户自行创建的资料。
