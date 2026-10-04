# GSM 阶段 4、5 开发准备与后续路线

日期：2026-10-03（Asia/Shanghai）。本机 Windows 自用；先交付开发准备，用户追加授权后阶段 4A 独立完成。这是准备时的历史状态；阶段 4B～8 后续已实施，当前范围与尚未实机验证项见 [连续开发交付报告](GSM_阶段4至8连续开发交付报告.md)。

## 1. 范围与阶段编号

采用最近对话的编号：阶段 3 是按条件启用一个视图的局部虚拟化，阶段 4 是本地备份，阶段 5 是搜索。总指导文档第 6 节原来的编号是候选队列，不能与最近阶段编号混用。

用户确认七份文档最终按现有本机范围完成：确定问题分步修复；按需候选先评估，有证据才实施；已经存在的能力以回归验证为主。标签治理、Release 后台通知、Bootstrap Projection、全域/整机备份、远程部署和跨设备能力不排期。

性能补充任务是收窄 `BuiltinRepositoryResults` 的 analysis 订阅；结果与残余瓶颈见本轮性能报告。它不等于虚拟化已经满足进入条件。阶段 3 仍需验证计算/宽订阅热点已处理、残余 DOM/layout/mount 主导，再由用户决定页面与视图。

## 2. 阶段 4：本地备份

### 4A：第一项开发已经确定——导出 appVersion 来源

- 状态：已完成，见 [4A 交付报告](GSM_阶段4A_本地备份版本来源修复报告.md)。以下保留修复前证据及范围。
- 修复前问题：`DataManagementPanel.tsx` 的 export metadata 硬编码 `appVersion: '0.4.0'`；根 package 为 `0.8.4`。备份 `version: '1.0'` 是格式版本，两者不能一起替换。
- 修改：复用 `GeneralPanel.tsx`、`DiagnosticLogsPanel.tsx` 已有的根 package JSON version 导入方式，仅替换本地导出的 appVersion。修改目标是 DataManagementPanel 和其测试。
- owner：根 package 是应用版本唯一来源；生成的文件只是只读导出，无新业务 owner、持久化 schema 或后台任务。
- 明确不改：JSON 格式版本、字段覆盖、现有导入/merge/replace、WebDAV、secret 选择、账户/Home 协议和 UI。
- 验收：实际导出 Blob 的 appVersion 等于 package version，格式版本仍是 1.0；旧格式与 Discovery-only 导入回归通过；未选 Discovery 不调用 exporter；导出失败不执行业务写入。类型检查、直接相关组件测试和 diff 检查各运行一次。
- 回滚：撤回 metadata 导入和替换，不清数据、不改历史文件。

### 字段与恢复调用链调查

| 数据 | 当前本地 JSON | WebDAV / helper | owner、scope 与后续边界 |
|---|---|---|---|
| Repository | 选中后直接导出当前仓库数组 | WebDAV 也覆盖；organization helper 正规化 membership | GitHub account；Home v2 激活后确认事实归 canonical records，未确认意图归 outbox；不能因可重取 metadata 删除用户整理成果 |
| 分类、顺序 | customCategories、默认覆盖、隐藏分类、categoryOrder | WebDAV 额外覆盖 subcategories、subcategoryOrder、repositoryOrder | account；涉及 Home 写入另校验 workspace；新增导出字段不代表旧本地 import 已支持恢复 |
| List mapping | categoryListIdMap 未出现在本地 ExportData 和字段清单 | Home organization 包含；incomingOrganizationSnapshot 当前白名单没有它 | 涉及 GitHub 身份，不能未核对就加入可移植白名单 |
| Release | releases、订阅、来源设置、readReleases | 两个介质都已有入口 | account/workspace；订阅和已读不是可随意清除的缓存 |
| 视觉/常用配置 | 部分 theme/preset/language/view 字段 | persistence 另有 themeTokens、repositoryCardFields 等 | 沿用现有偏好 owner；partialize 用于查漏，不直接整体导出 |
| AI 与连接配置 | backupAIConfig、includeKeysInBackup、旧掩码 | restoreAIConfigs、isRealSecret、WebDAV secret 检查已存在 | 保留历史用户选择；缺省/空值/掩码不是合法新 credential；不得默认激活缺凭据的新配置 |
| Discovery workspace | 独立 exporter/validator 与旧 runtime 字段共存 | WebDAV 复用同一 exporter/importer | account；独立 durable store，不等于所有个人历史已覆盖 |
| Workbench/chat/HTML Reading/Electron vault/backend SQLite | 本地 JSON 不完整覆盖 | 有各自能力，不应猜测跨域一致性 | 本机路线不扩展成整机恢复；明确 included/excluded |

本地导入实际链路：文件解析及预览 → 选择 merge/replace → Discovery identity/record validator → 若选中则独立 workspace importer → 再检查 account → Repository/Release/config/组织等一系列领域动作与 setState。组织/仓库动作可能触发 Home capture → IDB outbox → backend。现有上层检查不等于整个文件所有业务字段均有 account/workspace binding。

WebDAV v1.2 在 Discovery 导入后调用 incomingOrganizationSnapshot，再执行多个恢复区域；一些区域异常记录 warning 后继续。它仍有 partial failure，不能描述为 durable atomic restore。本轮只读核对，没有运行真实导入或网络恢复。

### 后续独立子阶段与安全边界

1. **4B 导出完整性**：先选择用户资产白名单，补分类/子分类/顺序等确定遗漏，使用同一 organization fixture 核对引用与 included/excluded。保持导出只读；若旧 importer 未恢复新字段，应明确标注，不能宣称 roundtrip 已完成。
2. **4C 必要共享 codec**：只共享现有选中字段的 projection、schema 和 legacy adapter，不建 Registry。新 envelope/version 在此阶段单独确定；legacy v1.0/v1.2 继续读取，unknown future version 拒绝写入；定义 account/Home workspace、null/empty/absent 和 secret 语义。
3. **4D 实际恢复修复**：先确认参与者和 commit 点，再复用身份迁移的 gate/pre-image/journal/checkpoint/fingerprint 思想。覆盖进程中断、部分写入、Home outbox/未确认操作与账户切换。安全边界未就绪时只提供导出/预览，不扩大破坏性 replace。

4B/4C/4D 不是本轮实现授权。新增 journal 若被选择，必须另说明 owner、schema/version、account/workspace key、敏感数据与备份策略、迁移、成功清理、中断恢复；不能用内存 setState 代替跨库事务。

后续验收矩阵：legacy adapter、current-format roundtrip、empty/null/absent、account/workspace mismatch、masked secret、partial failure/recovery。4A 不改变这些协议，只运行相关既有回归；新增协议的失败注入留在真正修改该协议的阶段。

## 3. 阶段 5：搜索

### 已核对的当前调用链

`SearchBar` → `useSearchActions.aiSearch` → 现有 prepareQuery/identity guard → 可选 HyDE → embedding → vector query → 非空时只保留 scoreMap 命中的本地 ID → 可选 rerank → applyFilters → setSearchResults。向量失败或为空再进入 keyword/AI selection/lexical fallback。

`SearchBar` 的后续 effect 仍按 vectorScoreMapRef 的 ID 重建候选并按 score 排序；仅修改 submit 数组不足以保护新候选。skipNextTextSearchRef 只跳过一次，不能解决后续 filter/repository 变化。basic text search 当前是字段文本拼接后的 AND substring，实时输入另以名称 includes 匹配。

确定问题是向量硬候选集会排除 exact/lexical-only 仓库；不是缺少另一个搜索数据库，也不是需要先治理标签。query、结果 IDs/rank 只应由现有 controller 管理为内存派生状态。Repository、现有 provider、vector compatibility guard、AbortController/stale-check 和语义配置仍沿用原 owner。

### 确定性 corpus

本轮离线数据与原始观察保存在 `output/render-performance/subscription/search-corpus.json` 和 `search-corpus-baseline.json`。文件是诊断资料，不写用户存储；不调用 AI/vector provider。以下表格给出可重建的全部输入规则：ID/name/full_name 一一对应；除表格覆盖外，使用相同固定日期、空标签与中性 GitHub metadata，不使用真实凭据或个人仓库。

| ID | full_name | description | language | 索引 mock |
|---|---|---|---|---|
| 101 | atlas/ui-kit | Accessible component library | TypeScript | 不命中 exact 场景 TopK |
| 102 | nova/ui-kit | Theme component collection | JavaScript | 不命中 exact 场景 TopK |
| 103 | atlas/ui-kit-tools | Tooling for component packages | TypeScript | exact 场景仅返回此项，score 0.95 |
| 104 | fresh/offline-sync | 离线同步工具，断网时同步数据 | Rust | lexical/unindexed 场景不命中；中文自然语言场景命中 |
| 105 | meadow/message-hub | Event relay for collaborative applications | TypeScript | semantic 场景命中，score 0.92 |
| 106 | field/dashboard | Cloud dashboard toolkit | JavaScript | semantic 场景命中，score 0.80 |
| 107 | atlas/stream-client | Streaming client with reconnect support | TypeScript | lexical-only 场景不命中 |

| case | query / 操作 | 预期契约；排序未定处不伪造期望 |
|---|---|---|
| exact-full-name | atlas/ui-kit；vector=[103] | 101 必含，精确层先于无精确匹配候选 |
| exact-name / same-name-owners | ui-kit；vector=[103] | 101、102 均必含；不猜测官方 owner，同名层内部不预设 winner |
| lexical-only | stream；vector=[105] | 107 与 105 均可进入候选，不以 TopK 排除 107 |
| unindexed-Chinese | 离线同步；vector=[105] | 104 保留；不自动建立向量 |
| vector-outage | atlas/ui-kit；mock query 抛 unavailable | 本地 101 保留，降级有标识，不继续无限重试 |
| Chinese-natural-language | 断网时同步数据；vector=[104,105] | 本地/向量候选可用；保留已有自然语言配置 |
| semantic-query | tools for live updates；vector=[105,106] | 本地无字面匹配时仍保留向量候选；若启用 mock rerank，[106,105] 应能被当前查询持有 |
| filter | 完成 exact-name 后筛 TypeScript | 101 保留、102 排除；取消筛选可恢复，不能重跑另一套候选覆盖结果 |
| sort | 对上述候选选择 stars/custom | 使用同一候选；相关性与用户显式排序的优先关系先由用户决定 |
| cancel-late-result | 延迟 A，再完成 B，再返回 A | 最终只显示 B，不由迟到 A 覆盖 |
| account-switch | 延迟查询期间切换虚构账户 | 旧账户结果不得提交给新账户；沿用 account/token guard |
| repository-update | 改显示 metadata；另改匹配字段 | 前者不重新请求 provider；后者需要失效/重算，不能保留已删除 ID |
| empty-query | 空串及空白 | 恢复当前 facets 范围，不残留旧向量候选 |
| IME | compositionstart/update/end | 预编辑不发送昂贵请求；结束后沿现有 debounce/提交语义 |

corpus 是待实现契约，不能用纯数据校验或 mock 候选算式声称实际 UI 已通过。原始 baseline 区分当前纯 lexical helper 的真实输出与源码向量硬过滤的复算；filter/sort/cancel/identity/IME 仍需未来实际 Hook 与组件集成。

### 独立开发范围与待决策

1. **5A correctness fixture**：将 corpus 接到现有 repoSearch/useSearchActions/SearchBar 测试。记录当前失败路径，不引入新搜索平台或付费调用。
2. **5B 候选与 exact**：最小 pure helper 构建 exact/lexical/vector IDs 并集并去重；同时处理 SearchBar 会重新丢弃候选的实际路径。保留已有 expansion、HyDE、AI selection、rerank 的配置、取消与降级。
3. **5C 查询/筛选状态**：在现有 Hook/controller 收敛必要 query/request identity、candidate IDs/rank；facet 从当前 Repository 实体筛选，不重跑昂贵语义分支。旧 refs 只有等价测试通过后才移除，不保存完整仓库副本，不持久化 session。

真正实施前向用户给出具体排序选项：默认相关性下 exact tiers 优先、显式 stars/custom 覆盖全候选排序；或 exact tiers 始终置顶、显式排序仅作用于层内。实时与提交搜索规则扩大也需明确交互影响。本轮不替用户默认修改这些行为。

## 4. 余下专项与停止规则

| 阶段 | 本机完成方式 | 非前置/不实施内容 |
|---|---|---|
| 3 局部虚拟化 | 先通过三项进入条件，再让用户选一个页面/视图及依赖与交互范围 | 不默认 list，不建立通用虚拟行平台，不同时改 grid/group/发现 |
| 6 冷启动 | 独立冷/暖启动基线；有证据再修一处 IDB/i18n/chunk/font | 不拿本次 bridge 访问当冷启动，不改首次使用语义，不新增 warm store/Bootstrap Projection |
| 7 视觉/动效 | 实际截图、对比度、focus/selection/drag/overlay 与两层 reduced-motion；有需要才选一项 | 不重写 RepositoryCard，不为了动画保留大 DOM，不新增长期 will-change |
| 8 Windows | 验证托盘三态、现有菜单与 BrowserWindow session end；一次一个修复 | 不做新后台 Release domain、安装包/通知链路或其它平台扩展；注销/重启/关机实机验证需单独安排 |

总纲的当前要求是沿用唯一业务 owner、account/Home workspace scope、Home v2、数据迁移兼容与未确认操作。文档里的候选表不是全部自动开发授权。每次独立修复完成并直接相关验证通过后停止；后续开始前再次核对 git status 和实际代码。

效率原则：必要的 fixture 对照与受影响契约一次完成；没有新修改、失败或疑点时不重复全量测试，不因文档列出大量候选就扩大工程范围。
