# GSM 同步、任务与 AGY 可靠性验收（2026-10-17）

本轮完成用户批准的可靠性方案，沿用选择性迁移基线；没有 merge upstream v0.8.6，没有发布或替换正在运行的后端服务。所有开发由主对话完成。机器可读证据见同目录 `reliability-validation-20261017.json`。

## 实现

- Journal 采用独立任务记录、紧凑索引、activity 聚合和原子事务；迁移 marker 为权威，旧 blob 保留回滚能力。自动成功任务上限 200 条／7 天，未解决 attention 保留。无变化同步不建任务。
- AGY generation supervisor 复用已准备工作区，每个请求仍用独立 CLI 子进程和目录。cleanup 超时只隔离可疑进程的容量，健康请求继续；精确确认该进程关闭后恢复容量。移除 Organization 的 warm 1→2 限速及重复 admission，队列等待上限 30 秒。
- 保留 AGY Device 和 Server Provider；增量 executor/phase/commitStatus/providerOutcome/failureCode/capabilities 字段和明确 UI。任务详情显示 AGY 各请求阶段累计耗时，与任务总耗时分开；本地摘要／详情按批次确认持久化，保存失败不会伪装成模型失败。
- Server schema 6：生成结果先持久化，再提交；冲突保留结果。commit-preview 明确审阅后仅重试提交，不调用模型，不改变原始输入/hash；批任务冲突时停止推进。shutdown 保存 intent，安全阶段自动恢复，未知模型结果不自动重放。
- Remote cursor、水位、tombstone 和已知存活任务查询防止幽灵任务；requestId 回执先落盘，再确认 UI。事件合并写入，interrupted 事件有限保留，过期 cursor 返回 resync。
- Home 正常同步依赖 durable workspace binding；首次绑定／rotation 强验证，每日后台审计。网络审计失败不立即阻断 LAN，同账号验证变化会阻断。离线首次 activation 保留本地编辑并延后同步，不并行启动 legacy writer。
- Star 全量同步使用 3 页有界并发、进度和 checkpoint；限流返回 retryAt，不静默等待 reset。取消不被卡住的 speculative 请求拖延，删除旧 Star 前验证缺失项。

## 验证

| 检查 | 结果 |
|---|---|
| Root Vitest | 343 文件，3707 测试通过 |
| Server | 44 文件，440 测试通过 |
| Electron Node | 492 测试，491 通过，1 平台跳过 |
| 脚本 gates | 64 通过 |
| 类型、lint、root/server build | 通过 |
| boundaries、i18n、plugin registry、vector worker、HTML Reading | 通过 |
| Journal 压力 | 10,000 条历史单任务编辑只写 1 条；17,280 次无变化轮询模拟写 0 条任务 |
| AGY 实际进程 fixture | 100 个独立 CLI 进程／目录，峰值并发 5 |
| Native Electron／真实 preload／生产 supervisor | 17 个实际 fixture 子进程，2 个账号 generation；取消时 sibling 存活，目录清理，容量恢复 |
| Copied real profile | 369 仓库；账号 A-B-A、编辑、Reading、MCP、Marketplace fixture、两官方插件生命周期通过 |
| SQLite copies | 仓库 v3→6、实际 service v4→6；integrity/foreign keys、5 张业务表内容、密钥解密和幂等通过 |
| Windows unpacked packaged smoke | 独立 test entry，生产 main/preload、ASAR renderer、独立资料和 iframe 隔离通过；付费调用 0 |

原始桌面 profile 14,248 个文件、322,238,923 字节，验收后全部 SHA256 与入口基线一致。在线 SQLite 仅复制后迁移；运行中的 GSMBackend 未被停机或写入测试数据。轻 UI 操作没有完整 Store 序列化或 repository shard 写入；grid/list 写 7,513 字节，modal/settings 写 0。此测量是 fixture 中的双 rAF／flush，不是 INP 或线上延迟承诺。

安全审计：root runtime 5 low、无 moderate/high/critical；server/worker runtime 0。root 含开发依赖仍有既存 5 high／3 moderate／5 low，未以无关大版本升级强行消除。全工作树 `git diff --check` 有原有／行尾相关空白问题，未声称该检查为零；lint 与功能 gates 已通过。

## 验收范围与清理

这是本地源码验收，不是发布验收。未进行真实付费模型、真实 Star 写入或未知 WebDAV mutation；17,280 次轮询是加速模拟，并非真实运行 24 小时。打包 smoke 使用签名关闭的 unpacked 应用及受限测试入口，不等于签名 installer 安装／升级验收。

用户批准独立 CLI 调用方案，因为当前 CLI 没有可核实的 fresh-context/reset 或 requestId 回执能力。进程启动／初始化成本仍然存在；没有宣称实现跨请求 CLI 会话复用或量化真实 provider 提速。

已清理本轮 `output/reliability`、外部一致备份、复制资料、临时构建／原始日志及本轮 recovery tag；共移除本轮 61,407 个文件、1,799,683,462 字节；两个目录与 recovery tag 已核实不存在，详见 JSON 的 `cleanup`。保留源码、可重复 fixture 和本验收记录，保护此前用户文件及正常产品恢复数据。

可重复入口：`npx vitest run`、server 下 `npm test -- --run`、`node --test electron/*.test.js electron/plugins/*.test.js`、`scripts/fixtures/reliability-agy-electron.cjs`、`reliability-sqlite-smoke.mjs`、`reliability-packaged-smoke.cjs`。真实 profile fixture 必须提供新的已停止／一致资料副本；清理后旧副本路径不可复用。
