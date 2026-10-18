# 当前任务失败修复验收（2026-10-17）

对应报告：`task-failure-analysis-20261017.md`。本轮全部由主对话完成；在既有未提交工作树上增量修复，没有合并 upstream、改变 Store v17 或重置原工作树。

## 修复结果

- **Home 阻塞**：同步边界仅投影 GSM 业务字段。仅对完全匹配的不可变 inFlight、HTTP 400 `PRIVATE_DATA_NOT_SYNCABLE`、含旧 `temp_clone_token` 的批次执行受控重建；保留更新的本地编辑、base version 和新旧 opId lineage。不改服务端隐私校验，不重建回执未知的批次。重复确定性拒绝聚合为同一 attention 任务。
- **同步回声**：已确认版本随后出现在 changes feed 时不再次写入记录或创建同步任务；真正的新版本仍推进 shadow/cursor。
- **容量调度**：主 AGY queue 唯一 admission，手动请求优先，三个及以上手动 producer 轮转；后台使用符合 feature cap 的剩余容量。手动批量详情统一为 interactive，自动 discovery 的 trigger/priority 明确为 automatic/background。30 秒阈值发出资源延后提示，已入队请求继续等待原调用；仅明确未入队且未发送的请求可重试 admission，取消仍有效。
- **输出校验**：prompt 与 schema 共用上限；仅合法数组成员可本地去重和截取，展示调整提示。非法成员、任意 JSON 修复和缺失命令证据不获豁免。校验诊断只保存字段路径/错误代码，不把原始响应片段放入任务日志。
- **本地响应恢复**：失败原文与当时实际 README 摘录独立保存在本机 IndexedDB，响应上限 96,000 字符、每账号 20 条、有效期 24 小时。详情面板提供编辑 JSON、重新校验和保存入口，无网络/模型调用；校验账号、仓库全名、pushed-at、语言与原证据，沿用资产 lease/版本及身份门禁。落盘成功后才清理本地修复 checkpoint。
- **退出与清理**：严格校验完成的 terminal artifact 可独立交付，清理状态另行报告。未确认退出的进程继续占用 suspect 容量及 request directory；取消竞态也不提前释放。晚到的非法协议帧、权限错误或取消不会被退出超时恢复吞掉。
- **任务语义**：逐项记录 phase、providerOutcome、commitStatus、failureCode、requestId、warning；成功 sibling 不覆盖未知结果，进度更新不清掉本地持久化失败。任务中心展示完成/失败/待执行/取消分布、停止原因和本地保存与远端同步的区别。详情批次遇到配置级不可用后停止新派发，保留健康 in-flight sibling 的结果。

## 验证证据

| 范围 | 结果 |
|---|---|
| 完整前端 Vitest | 346 个文件、3,722 项通过，0 失败 |
| 完整服务端 Vitest | 440 项通过，0 失败 |
| 完整 Electron/插件 Node tests | 499 项：498 通过、1 平台跳过，0 失败 |
| Home 专项（最后一次修正后） | 13 个文件、95 项通过 |
| TypeScript / ESLint / layering / i18n / AI core / HTML Reading boundaries | 通过 |
| 前端生产构建、bundle budget / 服务端构建 | 通过；最终入口 legacy 约 2,215.10 KiB，预算 3,000 KiB |
| 真实 Electron 44.4.5 preload + 生产 supervisor | 17 个实际 fixture 子进程、峰值并发 5、两个账号 generation；请求目录隔离、取消 sibling、账号切换、清理与容量恢复通过 |
| AGY 批量进程 fixture | 100 个独立 CLI fixture 进程/目录通过 |
| 停止资料副本 + 生产 HomeSync + 真实 sync router + SQLite 副本 | 原 326 条 outbox、325 条带旧 token 的仓库、2 条固定 inFlight；确定性拒绝 1 次后安全重建，326 条实际应用，剩余 0；AI 详情/个人描述一致，20 次后续轮询新增任务 0 |
| SQLite 一致副本 | 仓库 v3→v6、服务 v4→v6；integrity、foreign keys、五张业务表、各一份密文凭据解密与重复迁移通过 |
| 原始桌面资料保护 | 14,302 文件、331,064,341 字节；验收后全部 SHA256 与停止时基线一致 |

组合验收最初暴露“自己的已确认写入回传后多建任务”，修正后重新使用新资料/数据库副本通过。不是用既有通过数量推断组合路径正常。

## 运行环境与边界

实际 Windows `GSMBackend` 已更新到 `home-backend/releases/0.8.4-20261017203858140`，固定 Node v22.23.3。已核对安装源码哈希、运行路径、服务健康和实际 SQLite：schema v6、integrity/foreign keys 正常、五张业务表与升级前一致、八条历史服务器任务保留。

第一次部署后的核对脚本因 Windows PowerShell 原生命令传参失败而自动恢复旧服务；改为独立验证脚本后再部署成功。该失败 release 和本轮迁移备份在成功验证后清理；没有降低服务目录 ACL 来绕过权限。此前已有 releases、备份与用户文件保留。

桌面保持正常退出，新的 `dist` 已构建。**重新打开 GSM 后才会加载新主进程/renderer；原 profile 的旧阻塞批次在下一次正常同步收到确定性拒绝时自动修复。** 本轮没有测试性修改原桌面 profile、提交真实 Home 操作、真实 Star/WebDAV 写入或真实付费 AI 调用。历史失败任务未伪造为成功，也未自动重放未知调用。独立 CLI 的启动成本仍然存在，不承诺真实模型耗时改善比例。

可重复入口：Home/详情/Journal/AGY focused tests，`electron/agyQueue.test.js`、`agyRuntime.test.js`、`scripts/fixtures/reliability-agy-electron.cjs`。真实组合入口为 `task-failure-sync-server.cjs` 与 `task-failure-home-profile.cjs`；需要新的停止资料副本、SQLite 在线备份、同 Node 版本准备的 release，以及显式 scratch 路径，不能复用清理后的路径。

## 清理

仅移除本轮 scratch checkpoint、一致资料/数据库副本、准备 release、临时脚本/原始日志、fixture 输出、失败部署和本轮迁移备份。保留当前运行 release、最终生产构建、源码、可重复测试与本脱敏验收记录。最终数量及路径不存在检查见同名 JSON。
