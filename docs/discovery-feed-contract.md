# 手机发现接口与边界

所有接口沿用后端 API secret 验证，以及 `workspaceId`、`githubUserId` 的同账户校验。凭据保存在后端，响应不含凭据。

`GET /api/capabilities` 的 `discovery.features` 明确声明 `{ stablePopular: true, publicReleases: true }`。手机分别验证这些标志才启用保存的热门列表接口与真实 Release 频道；旧后端缺少相应标志时，不应把旧搜索实现呈现为这些新功能。

## 最受欢迎

`GET /api/discovery/popular` 首次参数为 `workspaceId`、`githubUserId`、`perPage`（默认 30，最多 100）、可选 `language`、`topic`。显式刷新不传 `feedId`，创建新的浏览列表。恢复或追加传原来的 `feedId` 和服务器返回的 `nextAfter` 作为 `after`；省略的筛选和分页参数自动取保存的会话参数，显式提供的参数必须与首次完全一致。恢复首屏除身份参数外只需传 `feedId`，包括带语言、主题、非默认分页的列表。

响应包含 `items`（GitHub repository）、`feedId`、`nextAfter`（不透明字符串或 null）、`hasMore`、`total_count`（已保存去重仓库数）、`incomplete_results`、`source: github-search-star-buckets`、`coverage` 和可选 `warning`。`coverage` 明确最低 1001 Star、每搜索桶最多 1000 条、是否截断相同 Star 的过大桶，以及 append-only 快照策略。

仓库 JSON、已有顺序、分桶进度和不透明游标持久化在 SQLite；追加不会刷新已看到的仓库数据。重复请求不会新增重复仓库 ID，服务重启可以继续。分桶搜索最多每请求四次，因此允许 `items: []` 且 `hasMore: true`；客户端保留并使用新游标。上游限流返回 `warning: DISCOVERY_RATE_LIMITED`，已保存的结果和成功检查点仍可恢复。

搜索按 Star 范围拆分，使不同桶可超过单次 GitHub 搜索的 1000 条限制；无法进一步拆分的同 Star 大桶只读十页，并明确标记截断。每浏览会话最多 5000 次上游搜索，达到保护上限标记不完整。GitHub 搜索变化、搜索超时及大桶仍可能造成覆盖缺失，这不是全 GitHub 无限列表。

## 热门发布

`GET /api/discovery/repositories?kind=hot-release` 查询实际公开 Release。每个 `items` 仓库附带 `release: { id, tagName, name, publishedAt, body, htmlUrl, prerelease }`，草稿不会展示；发布时间取 `published_at`。

候选范围为最近更新的、超过 1000 Star 的仓库，可带语言和主题筛选。每候选页最多 30 仓库，每仓库检查最多五个 Release，展示其中发布时间最新的公开版本。`coverage` 明确候选查询、页码、数量、失败数量，以及 `globalReleaseFeed: false`；这是限定候选中的发布内容，不是 GitHub 全量发布。单个仓库失败保留其余真实 Release，并通过 `warning` 和 `incomplete_results` 标明缺失。

响应的 `hasMore` 与 `nextPage` 明确后续候选页是否可用；前端应使用 `hasMore` 控制加载更多。候选页最多 33 页，候选范围最多 990 仓库，`total_count` 也按此上限限制（它是候选数，不是实际 Release 数）。第 33 页的 `hasMore` 必定为 false、`nextPage` 为 null。

## 发现仓库 AI 分析

未收藏仓库可以直接创建 `kind: details` 任务，`input.repositories: [full_name]`。任务结果持久保留 `result.repository` 元数据、`result.data` 结构化详情和 `result.evidence`；`result.repositoryWrite.status: snapshot` 表示只保存任务结果，没有加入业务仓库或执行 Star。

已经存在的业务仓库只有提供 `expectedVersions` 才应用 AI 字段；详情同一次有效模型结果中的非空 `summary` 同时更新 `ai_summary`。版本冲突和既有 AI 覆盖保护继续生效。缺失或空摘要不会清除已有摘要。

GitHub 边界依据：[Search REST API](https://docs.github.com/en/rest/search/search)、[Releases REST API](https://docs.github.com/en/rest/releases/releases)。
