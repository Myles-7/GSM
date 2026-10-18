# AGY 恢复与执行可靠性验收（2026-10-17）

依据 `agy-remaining-issues-analysis-20261017.md` 和用户批准的 `agy-recovery-execution-20261017.md`。全部由主对话实施，保留既有未提交修改；Store v17、独立 CLI、账号隔离、trusted IPC 及未知结果不自动重放不变。最终机器验收记录与清理回执见同名 JSON。

## 修复结果

- **调用与恢复**：主进程独立版本目录按调用原子写入；发送前持久化意图，返回 renderer 前保存终态，safeStorage 加密恢复正文、证据及提交快照。账号/session/sender 校验、requestId 去重、输入指纹和 retryOf 贯穿请求。损坏记录保留隔离标记并显示恢复错误，不能当普通未发送任务重跑。旧 active/in_flight 保守恢复为 unknown；明确 prepared 可安全继续，已消费结果映射完成。Task Center 与来源页共用恢复确认，成功 sibling 保留。
- **清理所有权**：maintenance 失败可重试，保留待清理路径；退出未确认的 generation、probe 和枚举均持有 suspect 容量。probe 取消、结果加密/落盘失败等异常转换也保留清理租约。退休 worker 清理失败继续保留 owner，恢复操作同时处理 worker 和 queue，不强行清空可疑进程容量。cleanup warning 不再被后续 phase 抹掉。
- **调度和配置**：手动 Organization 使用 interactive 公平调度，后台只用空闲容量。主队列 admission 前台180秒、后台30秒，到期明确返回未发送的 RESOURCE_DEFERRED；初始化20秒、模型时限、退出/终止各5秒分别计时。取消 renderer 无限 admission 重试及 AGY 外层全程 deadline。完整执行器/model/effort/text-v1 测试身份控制新调用；用户显式测试新 profile，健康旧 revision 在途请求继续。共享配置错误分类停止新派发，保留健康 sibling 保存。
- **仅保存恢复**：详情、订阅和 Organization 有效响应保留至业务保存、必要 Store flush 和消费回执完成；支持重启后仅重试保存与明确确认丢弃。详情复用原证据、原配置并核对账号/identity/pushed-at/语言/asset/lease。Organization 复用原 profile、步骤及完整输入指纹，用 staged snapshot、草稿 CAS 和 receipt 防止覆盖新编辑。回执丢失按摘要/版本幂等确认，不调用模型。
- **空间与可见性**：每账号50MiB，8MiB请求预留在成功后继续计入，直到消费/丢弃；并发预留计入上限，容量不足在调用前阻止。未消费正文不自动淘汰、不进入同步/任务导出/普通诊断；Organization 持久诊断仅保留 metadata。所有子项已 complete 但保存失败或仍有恢复结果的任务继续显示 attention，不受自动历史数量及时间清理影响。明确成功后本地 schema/长度拒收仍保持 providerOutcome=succeeded。

## 验证范围

| 范围 | 结果 |
|---|---|
| 完整前端 Vitest | 349个文件、3,737项通过，0失败/跳过 |
| 完整 Server Vitest | 44个文件、440项通过，0失败 |
| AGY Node tests | 80项通过；含100个独立CLI fixture进程与请求目录 |
| Electron/MCP/插件/WebDAV/Reading | 合计406项通过、1项平台跳过，0失败（包含上述AGY80项） |
| CI脚本、版本与桌面启动器 | 64项通过，0失败 |
| typecheck / lint / boundary / i18n / AI core / Reading / vector worker / plugin registry | 全部通过；新增正式验收脚本另通过ESLint |
| 生产前端、bundle budget与Server构建 | 通过；最终体积见JSON |
| 真实Electron44.4.5、production preload/IPC/supervisor | 17个实际fixture子进程、峰值5并发、两个账号worker、17个隔离请求目录；safeStorage重启恢复、staged commit、幂等ACK、unknown、重复request不调用、账号隔离、取消sibling存活通过；最终running/queued/suspect均0 |
| 停止资料副本 | Store17、372仓库、220任务；业务字段保留，无遗留in_flight/无owner运行状态；付费调用和未知重放均0 |
| 原始资料保护 | 14,302文件、331,064,341字节；文件清单及全部SHA256一致 |
| Windows x64 unpacked实际启动 | production main/preload/renderer、恢复IPC、iframe边界、版本0.8.4；打包源文件与最终dist逐字节比对，隔离profile及禁网fixture通过 |

完整记录只在各项退出码和输出核对通过后生成；最终产物为 `release/agy-recovery-20261017/win-unpacked/GitHub Stars Manager.exe`。版本仍为0.8.4，没有擅自变更发布版本；JSON记录最终app.asar、EXE与关键源码SHA256。日常沿用原GSM启动入口重新启动，即加载本轮主进程与dist修复；unpacked用于独立产物验收，未执行安装器或自动搬迁真实资料，不应据此假设不同启动入口必然使用同一profile。

## 复现入口与边界

正式回归包括 `electron/agyCallRegistry.test.js`、`electron/agyReliability.test.js`、`src/services/agyRecoveryPolicy.test.ts`、`repositoryDetailRecovery.test.ts`、`aiOrganizationResultRecovery.test.ts`、Journal和AGY client测试。组合入口为 `scripts/fixtures/reliability-agy-electron.cjs`、`agy-recovery-profile-electron.cjs` 和 `reliability-packaged-smoke.cjs`；每次须新隔离目录及停止资料副本，不能将fixture指向原profile。正式包只被复制用于注入contained entry；原始交付包未注入fixture。

验收期间发现并解决了三类测试设施问题：原生fixture未消费结果导致触及50MiB（改为真实消费节奏）；data-only esbuild fixture缺少Vite locale transform（数据fixture做等价空locale转换，真实翻译由packaged renderer验证）；一次4worker与build竞争时Vitest内部退出、JSON不完整（不计通过，最终独立3worker完整重跑3,737项）。这些不是生产问题发生率证据。

没有真实付费模型、真实provider延迟E2E、真实Star/WebDAV写入或生产profile测试写入。此包是未签名unpacked产物，未验证安装器、签名或自动更新。独立CLI启动成本仍存在；不承诺真实模型提速比例。构建保留既有第三方eval/chunk提示，bundle预算通过；这些门禁不等同于宣称整个依赖树无漏洞。package-lock与开发前checkpoint字节一致。

## 清理

成功验收后仅删除本轮 `output/agy-recovery-*` 原始日志、探针输出、资料副本、临时profile及复制测试包，移除本轮source checkpoint tag和builder调试文件。保留正式结果、回归/验收fixture、最终unpacked产物、原用户文件及运行中的GSMBackend。清理数量、路径及不存在检查以同名JSON的cleanup回执为准；不清理真实账号的待保存结果。
