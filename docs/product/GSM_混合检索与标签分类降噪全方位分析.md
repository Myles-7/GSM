# GithubStarsManager 混合检索与标签分类降噪全方位分析（校准版）

> **阶段 4～8 代码更新（2026-10-03）**：阶段 5 已采用 exact/lexical/provider ID 并集与 Hook 内存 submitted session，SearchBar 后续 effect 不再以 vector scoreMap 硬过滤。默认相关性、显式排序覆盖及身份/配置取消 guard 已验证；标签治理未开发。下文硬过滤问题为改动前证据。 详见 [连续开发交付报告](GSM_阶段4至8连续开发交付报告.md)。

> **文档定位**：仅本机 Windows 的搜索正确性修复；保留现有语义配置，不扩展检索平台。
> **范围决策（2026-10-03）**：标签治理不列为确定目标，现有 user/List/topics 原文继续保护；本轮只改文档。
> **校准日期**：2026-10-03
> **代码基线**：当前工作区 `package.json` 版本 `0.8.4`，现有 `SearchBar` / `useSearchActions` / `AIService` / Vector Worker / Repository organization 实现
> **实施原则**：先修“相关结果被召回链路排除”的正确性问题，再优化排序；标签治理以来源保护、可逆 alias 和人工确认优先，不对用户或 GitHub List 标签做破坏性自动重写。

---

## 1. 现状校准 / 修订说明

原文抓住了两个真实方向：

1. 当前“向量有结果就只保留向量 TopK ID”的路径会丢失名称精确匹配、新同步但尚未建向量的仓库，以及 embedding 对短词/专有名词召回较弱时的本地强信号，因此需要真正的 hybrid recall。
2. 标签碎片需要治理，但“模糊字符串相似 → 自动合并所有标签”的方案会破坏用户明确输入的数据与 GitHub Lists 语义。

本版做以下修订：

- 删除原文中固定精度、固定标签缩减比例、固定效率增幅与固定超时等没有仓库基准支撑的绝对承诺。
- 删除“官方仓库置顶”的概念。GSM 没有可靠的“官方 owner”事实源；能做确定性保证的是 `owner/repo` exact `full_name` 的优先级，以及 exact `name` 作为高优先级候选层。
- 不再用“向量分数乘固定倍率”解决精确匹配，因为不同 embedding 模型、索引模式和 score 分布不可直接用一个魔法系数长期校准。
- hybrid 的核心改成 **deterministic exact tiers + lexical recall + vector recall 的并集**，再执行融合与可选语义重排。精确/词法结果不能因为不在向量 TopK 中被过滤掉。
- 保留现有语义能力：query expansion、AI selection、可选 HyDE、可选 semantic rerank。它们应按 query intent 和配置接入 hybrid pipeline，而不是被一个简单 RRF 函数整体替代。
- 搜索需要稳定的内存查询状态。当前 `vectorScoreMapRef` + `skipNextTextSearchRef` 是旁路协调；`SearchBar` effect 可能在 repository/filter 变化时覆盖结果。必要时以最小 query/identity/IDs/rank 会话解决，不建立新的持久化 search slice。
- 标签治理改为**来源感知**。`ai_tags`、用户手工 tag、GitHub List 名称、GitHub topics 不能被视为同一种可自动改写数据。
- 自动规范化只允许作用于 AI 生成标签，并且只能应用无损 normalization 与已经批准的 alias。用户标签和 GitHub List 标签默认保持原文。
- fuzzy / Levenshtein / prefix similarity 只能产生 suggestion，不能自动 merge。
- 标签来源模型、alias registry、聚类 Worker、治理 UI 和批量改写都不在本机确定路线内；只保留未来进入该方向时的安全边界。
- 若未来用户明确选择真正改写 AI tags，必须 preview/可撤销，reindex 需显式决定；当前不新增这条业务流程。

当前代码证据：

- [`src/features/repositories/hooks/useSearchActions.ts`](../../src/features/repositories/hooks/useSearchActions.ts) 的向量分支在结果非空时构造 score map，然后执行 `repositories.filter(repo => scoreMap.has(String(repo.id)))`，把向量结果 ID 当成硬候选集。
- 同一 Hook 已经有可选 HyDE、vector query、可选 `searchRepositoriesWithSemanticReranking`；向量失败/为空后又走 `keywordSearch`。
- `keywordSearch` 并非单纯 substring：当 AI 配置可用时，会调用 [`AIService.searchRepositoriesWithSelection`](../../src/services/aiService.ts)，执行 query expansion / intent 解析、本地词法候选召回和 LLM 精选排序；失败再回退词法。
- [`src/utils/repoSearch.ts`](../../src/utils/repoSearch.ts) 的 `performBasicTextSearch` 当前是全字段文本拼接后按 query words 做 AND substring 过滤，没有“exact full_name / exact name / prefix / exact token”这样的确定性 tier。
- [`src/components/SearchBar.tsx`](../../src/components/SearchBar.tsx) 通过 `vectorScoreMapRef` 和 `skipNextTextSearchRef` 协调向量结果；当 repositories、filters 等变化时 effect 仍会重新执行向量 ID 过滤或 basic text search。
- `SearchBar` 的 realtime search 目前只匹配 `name/full_name includes`，与提交后的 basic/AI/vector 搜索又是另一套规则。
- `syncStars()` 的 GitHub Lists 路径会把 `list.name` 追加到 `repository.custom_tags`；因此 `custom_tags` 并不等价于“用户可随意自动规范化的自由标签”。
- [`src/store/helpers/repositoryOrganization.ts`](../../src/store/helpers/repositoryOrganization.ts) 的 category suggestion / membership 会消费 repository tag 等证据。自动改标签可能改变分类候选，因此 taxonomy 修改不是单纯显示层操作。

---

## 2. 当前搜索链路的问题在哪里

### 2.1 当前不是 hybrid search，而是“vector 优先、keyword fallback”

当前简化流程：

```text
query
  │
  ├─ vector enabled + ready
  │    ├─ optional HyDE
  │    ├─ embed
  │    ├─ vector topK / threshold
  │    ├─ 本地轻量加分
  │    ├─ 只保留 vector 返回的 repo IDs
  │    └─ optional LLM rerank
  │
  └─ vector empty / unavailable / failed
       └─ keywordSearch
            ├─ AI expansion + lexical candidates + LLM selection（有 AI config）
            └─ performBasicTextSearch（无 AI config / failure）
```

只要向量返回了一批结果，词法路径就不参与召回。这会产生结构性漏召回：

- `owner/repo` 完全匹配，但该仓库没有进入向量 TopK。
- 新同步仓库尚未建立向量。
- 短 token、缩写、库名对 embedding 的语义表达不稳定。
- indexMode 与用户输入关注点不同，例如 README-heavy index 对 repo 名称精确检索并不占优势。

修复重点是**召回集合**，不是先微调向量分数。

### 2.2 搜索状态有两套事实

当前至少有：

```text
store.searchFilters.query
store.searchResults
vectorScoreMapRef
skipNextTextSearchRef
SearchBar 本地 searchQuery
realtime name-only 结果
```

其中 `vectorScoreMapRef` 只存在于 Hook 生命周期内。repository 更新、筛选条件变化、分类切换时，`SearchBar` effect 会重新用仓库全集和现有 filters 计算结果。这会导致：

- 语义/融合排序被 basic text path 覆盖。
- AI 精选出的“相关子集”重新膨胀成 substring 命中集。
- vector-only ID 集合继续被当成搜索事实，无法表达 lexical + vector union。
- 同一 query 在 realtime、提交后和 filter 变化后的语义不一致。

因此 hybrid 改造必须同时改搜索状态模型。

---

## 3. 正确性目标：复用现有路径，补候选并集

推荐把搜索拆成四层：

```text
Query normalization / intent
        │
        ├──────── deterministic exact tiers
        ├──────── local lexical recall
        └──────── semantic recall
                   ├─ optional expansion / HyDE
                   └─ vector
        │
        ▼
Candidate union + provenance
        │
        ▼
Fusion / tier ordering
        │
        └─ optional LLM rerank on bounded candidates
        │
        ▼
SearchSession
        │
        ▼
Filters consume ordered candidate IDs
```

### 3.1 确定性 exact tiers

exact 信号不要和向量 score 混成一个“乘 3.5 倍”的浮点公式。它适合做稳定 tier：

```ts
type ExactTier =
  | 'full-name-exact'
  | 'name-exact'
  | 'name-or-full-name-prefix'
  | 'metadata-token-exact'
  | null;
```

建议优先级：

1. exact `full_name`：用户输入 `owner/repo` 时最强确定性信号。
2. exact `name`：例如查询 `express` 时所有 repo.name === `express` 都进入此 tier。
3. `name` / `full_name` prefix。
4. tags / topics / language 的 exact normalized token。
5. weighted lexical score。
6. vector rank / semantic score。

这里“tier 更高”表示它不会被低层召回结果挤出候选，并不意味着同 tier 内存在一个“官方仓库一定第一”的承诺。

### 3.2 本地 lexical recall 应升级为评分器，而不是只有 AND substring filter

先复用 `performBasicTextSearch` 和 AIService 已有词法逻辑，补 exact tier 与统一候选。只有 fixture 说明布尔匹配不足时才增加评分/evidence；下例为按需结构，不要求首期全部字段：

```ts
interface LexicalHit {
  repoId: number;
  score: number;
  exactTier: ExactTier;
  matchedFields: Array<
    'full_name' | 'name' | 'topics' | 'ai_tags' | 'custom_tags' |
    'language' | 'description' | 'ai_summary' | 'custom_description'
  >;
}
```

权重只需要满足清晰的相对关系，不要把未经验证的小数当作“最佳公式”。例如：

```text
full_name / name  >  tags/topics/language  >  summary/description
original query    >  AI-expanded terms
exact token       >  prefix                >  substring
```

`AIService` 已有 `scoreRepositoriesByKeywords` 和 query expansion 经验，可以复用或抽取评分逻辑，避免再创建第三套完全不同的 lexical scorer。

### 3.3 lexical 与 vector 必须做 union

核心数据结构：

```ts
interface CandidateEvidence {
  repoId: number;
  exactTier: ExactTier;
  lexicalRank?: number;
  lexicalScore?: number;
  vectorRank?: number;
  vectorScore?: number;
  sources: Array<'exact' | 'lexical' | 'vector'>;
}
```

候选构建：

```text
exact IDs
  UNION lexical top candidates
  UNION vector top candidates
```

不能再写：

```ts
repositories.filter(repo => vectorScoreMap.has(String(repo.id)))
```

作为 hybrid 的最终候选筛选条件。

### 3.4 exact tier 独立；复杂融合按评测需要引入

若需要融合词法与向量排名，可评估 RRF 等 rank-based 方法，避免直接比较不同尺度的 score。首期先保证 exact/lexical 不消失，保留已有语义顺序；评测没有证明必要时不增加融合调参平台。参考结构：

```text
先按 exact tier 分层
  -> 同层内融合 lexical rank + vector rank
  -> 必要时再加稳定次级信号
```

这样 exact `full_name` 不需要依赖任意 vector score multiplier 才能保住位置。

如果未来实验表明别的 fusion 更好，也可以替换；`SearchSession` 只需要保存最终 rank 与 evidence，不应把 UI 绑死在 RRF 公式上。

---

## 4. 保留语义扩展、HyDE 与 rerank，但按 query intent 调度

现有语义能力有价值，不应为了实现 hybrid 全部删掉。

### 4.1 短词 / 标识符查询

典型：

```text
trpc
k8s
owner/repo
react-query
sqlite
```

建议：

```text
立刻 exact + lexical
      │
      ├─ UI 可先展示本地结果
      │
      └─ vector ready 时并行查询
              │
              ▼
          union + fusion
```

这类 query 默认不必先等 LLM expansion/HyDE 才能开始搜索。exact/lexical 是强信号；HyDE 对非常短的 identifier 可能把意图扩得过宽。

### 4.2 自然语言查询

典型：

```text
适合离线优先同步的 CRDT 数据库
a local-first database for collaborative apps
支持 GPU 推理和 OpenAI API 兼容接口的服务
```

建议：

```text
local lexical initial recall
       │
       ├──────── query expansion / intent
       │
       └──────── optional HyDE -> vector
                          │
                          ▼
                    union + fusion
                          │
                          └─ optional LLM rerank bounded top candidates
```

这保留了当前 `AIService.searchRepositoriesWithSelection`、`generateHyDEQuery`、`searchRepositoriesWithSemanticReranking` 的价值。

### 4.3 expensive steps 必须有边界

原则：

- exact / lexical 永远本地可用，不因 AI/vector 失败消失。
- vector 是增强召回，不是唯一 gate。
- query expansion / HyDE 是增强语义表达，不应阻塞 identifier query 的第一版结果。
- LLM rerank 只看 bounded candidate set，不能把整个库直接送模型。
- 任一步失败都保留之前已经得到的候选与次序证据。
- 取消旧搜索继续沿用现有 AbortController / stale-check 机制。

超时数字应通过真实模型、网络和 UI 体验基线确定。文档不预设“3.5 秒一定正确”。

---

## 5. 最小内存查询状态：防止筛选覆盖结果

当前问题是“查询结果”与“UI 筛选”互相改写。可以在既有 hook/controller 中保存最小会话，例如 query/request ID、当前 account identity、候选 repo IDs 与 rank、完成/降级状态；语义分支更新同一个查询。

不持久化 SearchSession，不新增数据库、vector generation registry、完整 evidence 审计或独立实体框架。Repository 仍是业务事实，session 只是可重算的查询结果。

规则：

- facet filters 从当前候选读取最新 repo 实体，不重新执行另一套 basic search 来覆盖语义顺序。
- query 默认相关性顺序与用户显式 stars/custom 等排序应有清晰关系；要改变现有交互选择时先请用户决定。
- realtime 与提交搜索尽量共享便宜的 lexical 基础；semantic/HyDE/rerank 保留现有配置，不要求每次实时输入都发请求。
- 新请求取消旧请求，迟到结果不得覆盖新 query/新 account；账户、query、真正影响匹配的仓库字段变化应失效/重算。
- metadata 显示更新与 filters 不自动重跑昂贵 AI/vector 分支。

不要同时保存 candidate objects、IDs、rank、sources、多个 score maps 却没有明确消费者。只保存能解决当前问题的状态；旧 refs 在等价测试通过后再移除。

---

## 6. 最小模块改动

先在 `repoSearch.ts` 或相邻 helper 中增加纯函数 exact tier/候选 union，由 `useSearchActions.ts` 调用；`SearchBar.tsx` 消费稳定内存结果。复用 AIService、EmbeddingClient、VectorSearchService 与现有 AbortController/stale-check，不先建立七文件的新 search 子系统。

只有函数职责变得明显难维护时再拆文件，不借搜索修复改业务 owner、部署 Worker、升级 provider 或执行索引重建。

---

## 7. 标签治理：保留边界，不排期

### 7.1 当前数据来源事实

Repository 已有 `ai_tags`、`custom_tags`、`topics`。`applyListsToRepositories()` 会把 GitHub List 名称追加到 `custom_tags`，所以旧 custom tags 不能可靠区分用户输入与 Lists 来源；默认全部受保护。topics 是 GitHub 上游事实。

现有 `repositoryOrganization.ts` 的分类候选会消费这些证据，改 tag 可能影响分类，并非纯显示变更。

### 7.2 目前允许的简单处理

比较/搜索层可生成 normalized lookup key，保留 raw 值与来源字段；大小写、空白、separator 的匹配规则需测试概念边界。不要为了标签显示或查询 normalization 持久化第二套可编辑标签库。

不自动 fuzzy merge user/List/topic；AI tags 也不能依据字符串距离直接改为“同义词”。`container -> Docker`、`agent -> AI Agent` 等含义更强的映射不是通用事实。

### 7.3 明确未规划的功能

不新增 TagSource 持久化迁移、canonical alias registry、Taxonomy Worker、suggestion queue、治理 modal、批量 AI tag rewrite、undo history、Home taxonomy collection 或自动 reindex。

这些并非搜索 exact/lexical 正确性的前置依赖。先修搜索候选与结果状态即可，不把知识治理平台顺带带入本机路线。

### 7.4 如果用户未来明确需要

重新展示收益与成本请用户决定。届时必须区分：suggestion 是可重建派生状态，用户批准的 alias 是账户配置事实；Repository 标签仍由原 owner 写入。真正改历史 AI tags 前预览影响与分类变化、保存 before/pre-image、可撤销；跨 durable store 修改需 journal/checkpoint/recovery。

Worker 只有在建议计算仍有实测主线程瓶颈时评估；先消除 pairwise O(T²) 和 render 内重复扫描。向量 reindex 是有网络/embedding 成本的独立显式任务，不能伪装为标签应用已经同步完成。上述约束不构成当前功能授权。

---

## 8. 当前搜索与标签的连接

搜索可直接消费现有 ai_tags/custom_tags/topics，不需要先迁移来源模型。比较层 normalization 不改变用户原标签，也不重置 category_locked、category_id 或手工分类。

如果未来需要用户自定义搜索 alias，先明确范围和实际需求，不以“标签碎片可能增长”为由预先持久化 registry。

---

## 9. 独立候选子阶段

| 子阶段 | 目的 | 修改候选 | 不改 |
| --- | --- | --- | --- |
| A：correctness fixture | 固定必含 ID、exact 优先、outage/未索引/中文/语义预期 | repoSearch/useSearchActions/SearchBar 对应测试 | 不调用付费模型或改变索引 |
| B：候选与 exact 小修复 | vector 非空时仍保留 lexical-only/exact | repoSearch/helper、useSearchActions | 不实现 taxonomy，不升级语义能力 |
| C：查询与筛选状态 | filters 不覆盖融合结果与语义顺序 | 现有 hook/controller 与 SearchBar | 不持久化 session、不新建搜索平台 |

一次只实施一个子阶段。阶段 B 不能仅修一次 submit 后的数组而忽略 SearchBar 后续 effect；需要对实际调用链验证，必要的最小状态修复可以纳入同一可回滚任务。此处没有授权本轮实现。

---

## 10. 风险与验证

| 风险 | 保护措施 |
| --- | --- |
| exact name 被猜成官方仓库 | 同名不同 owner 均保留，不判断官方身份；full_name exact 为稳定强信号 |
| 用魔法倍率校准不可比分数 | exact tier 独立；融合方法由 fixture 证明，不承诺最佳权重 |
| AI/vector 延迟或失败 | 本地结果可用；保留取消/迟到检查，沿用现有配置 |
| effect 覆盖语义结果 | filters 消费当前候选，不再次执行另一套搜索 |
| account/index 配置变化 | 请求 identity/stale-check 与现有 vector compatibility guard 保留 |
| normalization 改变概念 | 仅 comparison key，保留原值；验证缩写/专有词/同名边界 |
| 为解决卡顿扩大重构 | profiling 区分查询 CPU、render 与 provider latency，一次一个修复 |

搜索实现至少验证：exact owner/repo、exact repo name、同名不同 owner、未 vector indexed repo、vector unavailable、中文自然语言、semantic query；补新搜索取消旧请求、账户切换、filter/sort、空 query 与 IME。用确定性 fixture/mock 标注期望，不从几个演示词推断整体 precision/recall。

现有测试：`src/features/repositories/hooks/useSearchActions.test.tsx`、`src/components/SearchBar.test.tsx`、`src/utils/repoSearch.test.ts`。它们仍主要保护现有 vector-first/fallback 和 UI 行为，不证明本文候选 union 已实现；新正确性 fixture 在相应实现任务中补充。

另运行 typecheck、对应组件集成与 `git diff --check`。若声称查询性能改善，用同一数据/query fixture 前后比较；provider/网络耗时与本地算法耗时分别记录。

---

## 11. 下一步与非目标

保留已有 expansion、HyDE、AI selection、semantic rerank 的配置和降级能力，但不新增更重语义编排、调参平台或强制请求。必要的 exact/lexical 候选修复与内存会话优先于标签治理。

不判断“官方仓库”，不自动合并用户/List/topics，不建可写标签数据库，不触发批量 embedding，不为了未来扩展迁移所有 tag provenance。

下一步按独立搜索正确性任务核对候选与 effect 调用链；如果当前卡顿主要发生在搜索，先对同一 fixture 采样，再选最小修复。本轮结束后不自动开始实现。
