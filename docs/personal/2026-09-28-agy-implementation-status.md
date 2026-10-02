# AGY CLI 自用接入交付记录

状态：Windows 桌面实验接入已打通。此记录取代此前“零工具隔离阻塞”的阶段记录；工具清单非空不再阻止启用。仍不宣称全部 AI 场景均已充分验证。

## 使用入口

重新启动桌面客户端，在“设置 → AI 配置 → AGY CLI”中：

1. 检测程序，必要时用原生文件选择器绑定本机程序。
2. 刷新模型，可沿用 CLI 默认模型；设置 effort、问答模式、超时、队列上限并保存。
3. 点击“测试回答”，通过后勾选实验模式并保存，点击“设为当前 AI”。
4. 本地项目研究在同一区域选择目录，查看资料范围，输入问题并开始。结果不自动保存或同步。

默认 effort 为 medium、单请求超时 180 秒、并发 1、等待队列 10。high/max 可能显著延长研究时间，不会自动改模型或回退收费 API。Embedding 仍需独立配置。

## 已交付

- Electron 主进程检测、模型列表、连接测试、生成、取消、队列、窗口/账户请求归属和退出清理。
- 每次独立会话、stdin 提示词、固定参数；不复制登录态，不修改用户全局 CLI 配置。
- 普通文本与流式文本统一进入 AIService，摘要、分类、Gist、Release、查询扩展、重排序、详情、发现与工作台使用统一提供商判断。
- 设置参数设备持久化；自动/手动后端同步仅投影 HTTP 配置，备份中的 CLI 描述失活，恢复需重新绑定。
- 模型模式读取有限文档后回答；研究模式复用现有证据循环；本地读取包含目录授权、忽略规则、相对路径、内容 hash 和取证时间。
- 回答复核检查原始要求、语言、格式、比较维度、否定事实、缺失项和支持引文。程序验证引文确实存在，不将模型复核等同于事实真值证明。
- 检索耗尽但已有证据时仍生成有依据的部分回答；不因中间核验超时直接丢弃全部资料。
- 多仓库逐仓库取证、共享时间预算、公平分配、明确覆盖和待处理批次，最后综合建议；单仓库不再被要求回答其他仓库的事实。

## 真实结果

仅使用合成资料与临时 Electron 配置，不使用用户私有代码或真实后端数据。

| 验证 | 结果 |
| --- | --- |
| 首轮 20 个业务样本 | 18 通过；本地/多仓库研究因耗时失败，原报告保留 |
| 本地研究定向复测 | 通过，约 107 秒；完整覆盖六项要求，missing 为空，来源 hash/引文校验通过 |
| 多仓库定向复测 | 通过，约 107 秒；两仓库均有来源，给出正确推荐与理由 |
| 合并样本记录 | 20 个样本均有通过记录；不是修改后整套重新运行，也不是复杂真实项目可靠率 |
| 设置端到端及最终复测 | 14 个模型；真实中文结构化回答和摘要；启用、当前 AI、重启持久化通过 |
| 10 种界面语言 | 1280/390 两种宽度，控件无截断；不代表每种语言均做内容效果评测 |
| 协议 | 中文文本、应用层 JSON、Unicode 流式、effort、取消通过 |
| CLI 原生 JSON Schema | 未通过，三次未返回预期 structured_output；生产路径使用 JSON 文本加应用校验 |

真实生成调用累计 **52/60**，逐次记录于 `output/agy-generation-ledger.jsonl`；可用 usage/耗时在 `output/agy-generation-usage.jsonl`，早期中断调用并非全部返回 usage，不把缺失记为零。没有继续重试不兼容的原生 Schema 协议。

结果文件：`output/agy-business-report.json`、`output/agy-business-retest-local-research.json`、`output/agy-business-retest-multi-repository.json`、`output/agy-settings/report.json`、`output/agy-protocol-report.json`、`output/agy-final-regression.log`、`output/agy-final-build.log`。

最终离线回归：前端 **1970/1970**、后端 **137/137**、Electron MCP **33/33**、AGY **36/36**、插件 **103 通过/1 跳过**、版本脚本 **10/10**、CI gates **27/27**、桌面启动器 **4/4**。标准 `test:run`、类型检查、语言检查、分层检查和 Vite 构建通过。插件跳过项为当前 Windows 环境不允许创建符号链接的用例，不计为通过。全工作区 `git diff --check` 仍报告既有 SearchBar 行尾问题；未顺带格式化用户文件，本次主要修改文件的 CRLF-aware 检查通过。

## F01–F14 覆盖与边界

| 项目 | 已完成与剩余 |
| --- | --- |
| F01 | 搜索取消与代次校验、迟到提交保护 |
| F02 | 模型/维度/内容/目标身份、内容 hash、索引分代切换；失败保留旧代。上线需重新部署 Worker v2，未知旧身份需显式重建，未做真实云端迁移 |
| F03 | 扩展源码语言和目录覆盖、按相关性取证；没有新增通用代码语义搜索引擎 |
| F04 | 结构化要求/断言/引文复核；属于模型复核，不能证明不存在遗漏或语义错误 |
| F05 | 默认日志不记录提示与回答正文，保留耗时/长度/usage/错误分类 |
| F06 | 根 README 和关键配置优先保留、按章节读取 |
| F07 | 逐仓库固定 SHA 取证、比较综合、显式覆盖和批次；大规模多仓库仍受预算限制 |
| F08 | 跨查询候选融合、公平验证名额、失败递补、多语言输出 |
| F09 | 已区分引用定位与回答支持；摘要/详情/发现的完整统一证据状态仍未全部迁移 |
| F10 | CLI 请求归属/取消、搜索与 Gist 防迟到覆盖；所有 HTTP 入口的生命周期尚未完全统一 |
| F11 | 研究步骤请求预算与有界修复；仓库分析重试收敛；全产品的统一实际请求计数仍未全部完成 |
| F12 | 聚合/分层抽样、跨批新增分类校验、原子草案更新、保留人工修改与分类锁 |
| F13 | 完成动作保存 missing；无文档可保留其他元信息证据 |
| F14 | 缓存绑定模型/提示版本，租约等待可取消，过期配置不回写 |

AGY 研究目前主要覆盖仓库与授权本地文件。任意公开网页研究的完整端到端验收未完成，不标记为已验证。Windows 以外平台、安装包分发、真实云端 Worker 部署未验收。现有翻译依赖的 eval 构建警告仍在。

索引升级注意：Electron MCP 已适配分代查询。后端 MCP 尚未同步索引代次身份，默认明确报告 `vector_index_identity_not_synced` 并隐藏两个向量工具，其余工具继续可用；旧版 Worker 仅在显式配置 `GSM_MCP_LEGACY_VECTOR_WORKER_URL` 后可用，不能将该开关指向 v2。使用后端向量 MCP 的用户需先处理该兼容边界，不应直接升级 Worker 后假定全部 MCP 功能可用。

## 复测

```powershell
$env:NODE_OPTIONS='--no-experimental-webstorage'
npm run typecheck
npm run test:run
npm --prefix server test -- --reporter=dot
npm run check:i18n
npm run check:boundaries
npx vite build --outDir output/agy-final-build
```

Electron 真实评测还需可用的 Playwright、5173 开发服务器和已登录 AGY。以下命令会消耗累计生成预算，不应重复全量运行：

```powershell
node scripts/verify-agy-settings.cjs
node scripts/evaluate-agy-business.cjs --only=local-research --effort=medium
node scripts/evaluate-agy-business.cjs --only=multi-repository --effort=medium
```

未创建提交，未覆盖用户已有无关修改；没有自动购买额度或更改现有用户 AI 选择。保留实验标记。
