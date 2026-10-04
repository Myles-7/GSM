# GithubStarsManager 多页面大量内容卡顿、按需虚拟化与功耗分析

> **阶段 4～8 代码更新（2026-10-03）**：本轮阶段 4～8 未增加虚拟化/Worker/warm store。启动 trace 仍有 grid 几何读取及首批 50 卡挂载成本，不能把启动单点改善描述为 DOM 瓶颈已解决。 详见 [连续开发交付报告](GSM_阶段4至8连续开发交付报告.md)。

> **文档定位**：仅本机 Windows 的当前卡顿诊断、计算治理与按需虚拟化。
> **用户决策**：保留现有本机 Home；不扩展远程部署或跨设备同步。本轮只改文档。
> **校准日期**：2026-10-03
> **代码基线**：当前工作区 `package.json` 版本 `0.8.4` 及现有 Repository / Home Sync 实现
> **实施原则**：先消除便宜且确定的重复工作，再引入真正的 windowing；同步侧优先向 Home Sync v2 收敛，不继续扩张 legacy 全量轮询协议。

---

## 1. 现状校准 / 修订说明

原文对两个核心问题的判断仍然成立：

1. `RepositoryList.tsx` 与 `RepositoryGroups.tsx` 的“按批增加可见数量”只能降低首批挂载量，滚动到底后旧卡片仍然留在 DOM 中，因此它不是虚拟化。
2. 大量仓库同时挂载时，卡片级宽订阅、全量扫描、分组重复遍历会放大渲染成本，值得优先治理。

本版对原方案做以下校准：

- 删除原文中没有仓库基准夹具支持的固定 DOM 数量、内存占用、帧率与 Style Recalc 等绝对数字。它们只能通过当前版本、当前设备、当前数据集实测，不能作为已证实事实。
- 删除“虚拟化后 DOM 必然稳定在 15～25 张卡片”等绝对承诺。窗口大小取决于 viewport、列数、估算高度、overscan 与动态测量。
- 当前顺序为：**复现卡顿 → selector / index / group partition → 同条件复测 → 仅在残余 DOM 瓶颈成立时选择一个常用视图虚拟化**。不预先要求统一虚拟行模型或 list/grid/group 全覆盖。
- 不再把虚拟化描述为“新建一个组件即可无缝替换”。当前分组目录跳转、拖拽、卡片本地 Modal/Sheet 状态都依赖真实 DOM 或组件持续挂载，必须先改这些依赖。
- 同步侧不再把“给 legacy 7 个请求加 ETag”作为主路线。当前项目已有 Home Sync v2，且服务端明确把 v2 视为 canonical sync；保留当前 v2 主路径；只有实际复现旧入口的重复请求或双写问题才局部处理，不把所有 legacy 退役设为本机优化前置。
- 原文提出的 `COUNT + MAX(timestamp)` ETag 不能作为可靠变更协议：某些修改未必改变被选中的 timestamp，会产生漏变更风险。
- `@tanstack/react-virtual` 当前不在 `package.json` 依赖中。是否采用它，应在虚拟行模型与交互契约确定后再决定；本方案描述的是所需能力，不把某个库 API 当成既成事实。

当前代码证据：

- [`src/components/RepositoryList.tsx`](../../src/components/RepositoryList.tsx) 使用 `visibleCount` + `slice(0, visibleCount)`。
- [`src/features/repositories/components/RepositoryGroups.tsx`](../../src/features/repositories/components/RepositoryGroups.tsx) 的 `GroupBatch` 以 50 为批次递增，并继续渲染 `slice(0, count)`。
- 同一 `RepositoryGroups` 使用 `headingRefs`、`getBoundingClientRect()` 和 `scrollIntoView()` 驱动分组目录定位；这些逻辑假定 heading 真实挂载。
- [`src/features/repositories/hooks/useRepositoryCardActions.ts`](../../src/features/repositories/hooks/useRepositoryCardActions.ts) 仍把完整 `repositories` 放进卡片级 Zustand selector，主要是给显式触发的 `findSimilar` 使用。
- [`src/components/RepositoryCard.tsx`](../../src/components/RepositoryCard.tsx) 每张卡订阅完整 `releases`，并在 render 派生最新 Release；同一组件还持有 edit / README / release sheet 等本地打开状态。
- [`src/services/autoSync.ts`](../../src/services/autoSync.ts) 的 legacy 路径仍有 5 秒 poll 和多 shard 并发 pull，但 `getDesktopHomeSync()` 激活时 `startAutoSync()` 直接 no-op，`syncFromBackend()` 也转为 `flushDesktopHome()`。
- [`src/home/sync.ts`](../../src/home/sync.ts) 已具备 visibility-aware 轮询、local change debounce、cursor changes、paged snapshot、operation push 与指数 backoff。
- [`server/src/routes/syncV2.ts`](../../server/src/routes/syncV2.ts) 明确声明 v2 为 canonical sync，并在 workspace 初始化后拦截受保护的 legacy 写路径。

---

## 2. 当前瓶颈：先把真正的重复工作拆掉

用户明确反馈当前使用存在卡顿，不能因 P0.2.1 历史验收只有 62 个仓库就降为“未来海量数据问题”。触发场景已确认：滚动、切换分类/分组、展开折叠都略卡，重点是多个页面突然展示大量内容，尤其发现页大量仓库。当前数量、最小复现步骤和活动任务仍需采样；以下代码形态是排查点，不是已证实根因。

先使用日常 production file-origin 和同条件匿名 fixture，对比主仓库与发现页整批展示、滚动、分类/分组/折叠；同时观察搜索/filter、resize、详情与 Home capture 是否触发额外工作。不要直接在用户原存储中注入压力数据或自动重建索引。

### 2.1 批加载只能控制首批挂载，不控制长期 DOM 上限

当前非分组列表：

```tsx
const [visibleCount, setVisibleCount] = useState(LOAD_BATCH);
const visibleRepositories = filteredRepositories.slice(0, visibleCount);
```

当前分组列表：

```tsx
const [count, setCount] = useState(BATCH);

<RepositoryGrid viewMode={viewMode}>
  {repositories.slice(0, count).map(renderRepository)}
</RepositoryGrid>
```

这两种方式都只会让挂载集合不断增长。它们可以继续作为小数据量路径或 virtualization 尚未启用时的退化方案，但不能承担大列表长期内存治理。

### 2.2 卡片级宽订阅应先缩小

`useRepositoryCardActions` 中的 `findSimilar` 只有在用户点击时才真正需要全量仓库候选，但当前 Hook 把完整 `repositories` 放在响应式 selector 中。更合适的边界是：

```ts
const findSimilar = useCallback(async () => {
  const currentRepositories = useAppStore.getState().repositories;
  // 在动作执行时读取，而不是让每张已挂载卡片持续订阅整个数组。
}, [/* 与 UI 状态直接相关的依赖 */]);
```

这里的目标不是“所有卡片都只能订阅一个字段”，而是把响应式依赖限制到**渲染当前卡片真正需要的状态**。显式命令需要的大对象可以在命令执行时读取。

### 2.3 Release 应一次建索引，不应每卡扫描全量数组

当前 `RepositoryCard` 逻辑：

```tsx
const cachedReleases = useAppStore((state) => state.releases);
const latestRelease = useMemo(
  () => cachedReleases
    ?.filter((release) => release.repository.id === repository.id)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0],
  [cachedReleases, repository.id],
);
```

随着卡片数与 Release 数同时增长，这会把同一份 `releases` 重复扫描很多次。建议在 Release 集合变化时只计算一次：

```ts
type LatestReleaseIndex = Map<number, Release>;
```

索引可以是 selector 派生值、store 外 memoized selector，或专门的只读 projection。关键约束：

- `releases` 才是事实源；index 是可重建派生数据。
- 同一 repo 只保留发布时间最新的 Release。
- 卡片只按自己的 `repository.id` 读取结果。
- 不为了这个索引再新增一份需要持久化和迁移的数据库状态。

### 2.4 分组应一次 partition，再按 rank 排序

当前 `RepositoryGroups` 对每个 section 都执行：

```tsx
const members = repositories.filter(/* 当前 section */);
```

自定义顺序时又对 `repositoryOrder`、`members` 做重复查找。建议先构建：

```ts
type GroupPartition = Map<string, Repository[]>;
type RepositoryRank = Map<number, number>;
```

一次遍历把仓库分到 group，另一次把 `repositoryOrder` 变成 `id -> rank`。每个 group 只对自己的成员按 rank 排序。这样即使暂时不做 virtualization，也能减少 section × repositories 的重复过滤与 `find`。

---

### 2.5 发现页是独立热点，不能套用主仓库列表结论

已核对的调用链：

- [`DiscoveryView.tsx`](../../src/components/DiscoveryView.tsx) 用当前频道 `allRepos` 传给 [`BuiltinRepositoryResults.tsx`](../../src/features/discovery/components/BuiltinRepositoryResults.tsx)。后者每次 render 对整批 `items` 生成分析投影，并以 `repos.map()` 挂载全部 `SubscriptionRepoCard`，当前组件内没有 windowing。
- Builtin results 订阅整个 custom `data`、analysis store 和 analysis assets；卡片渲染逐项 `tasks.find()`，失败任务又用 `repos.some()` 交叉查找。一次内容批次或无关任务进度变化可能触发重派生，需 Profiler 确认实际次数/耗时。
- [`CustomChannelUI.tsx`](../../src/features/discovery/components/CustomChannelUI.tsx) 对 `visibleCount` 做 slice，属于渐进批量；[`CustomChannelResults.tsx`](../../src/features/discovery/components/CustomChannelResults.tsx) 仍订阅大域并派生传入候选。
- [`CustomRepositoryBlock.tsx`](../../src/features/discovery/components/CustomRepositoryBlock.tsx) 的 starred selector 对主 repositories 做 `some()`，每卡查其它频道 recommended；它不等于 RepositoryCard，主仓库 actions 的修复不会自动解决这里的扫描。
- [`useDiscoveryReading.ts`](../../src/features/discovery/hooks/useDiscoveryReading.ts) 的 `useReadingAnchor()` 使用 `[data-reading-key]` DOM 查找、几何信息和 layout shift 修正。若挂载策略变更，必须保留按账户/session/item identity 的阅读位置恢复，不能仅删除 anchor 逻辑来减少工作。

优先候选：一次构建 task key lookup/repo ID membership、让命中分析投影按真实输入变化更新、收窄结果域/进度订阅；只在实际热点上实施。索引只读派生，不持久化、不替代 Discovery/analysis owner，不触发重新分析或 embedding。

### 2.6 本轮排查不扩成全应用重写

主仓库和发现都进入复现范围，但一次只修一个证据明确的路径。先保留其它页面行为；出现同类热点后再复用 helper，不预建万能列表组件。外部文章/消息等结果类型只有复现受影响时才纳入，不能机械套用 repository row model。

---

## 3. 虚拟化的进入门槛

虚拟化属于**解决当前残余卡顿的候选方案**，不是为了支持未来数千仓库而预先建设的架构。

先确认：

1. 当前大量内容操作能稳定复现；采样区分整批派生、渲染/布局/挂载与查询/同步工作。
2. 实际热点上的宽订阅、Release/group 扫描或发现 task/repo/channel 交叉查找已处理。
3. 相同 fixture 复测后，DOM/内容挂载仍是主要瓶颈。
4. 给用户展示最小页面/视图范围、阅读定位/交互变化、依赖成本与验证计划，请用户决定是否接入。

仅当这些条件成立才选 virtualizer。`@tanstack/react-virtual` 目前未在依赖中，不因文档示例安装它。若查询 CPU、Home capture 或任务造成卡顿，先修对应热点；virtualizer 不能替代根因修复。

### 3.1 先对用户常用视图做最小验证

list 常用可先验证 list，grid/group 常用则针对实际布局做小原型，不因抽象上的先后顺序强迫用户换视图。不要一开始建全局 `RepositoryVirtualRow` 编译器、entity store 或 Worker。

只在分组 header、grid 分行与定位确实需要共享表示时，增加纯函数派生 row model；不持久化、不拥有第二份 repository 数据，不要求所有小列表同步切换实现。

---

## 4. 接入虚拟化时仍必须保护的交互

这些是进入该方案后的验收要求，不是当前全部必做的改造。

| 现有依赖 | 虚拟化后的必要处理 |
| --- | --- |
| group `headingRefs` / `scrollIntoView()` | 未挂载的 header 不能靠 DOM 定位；使用 group ID -> index/offset，仅为实际启用的视图实现 |
| 卡片局部 edit/README/Release overlay | 源卡片卸载时不能关闭 overlay；按 repoId 放到稳定宿主，详情页面层实现可参考 |
| modal 关闭后的焦点 | 优先回触发卡片；离屏则定位后恢复，已被过滤则回列表/控制项 |
| 发现阅读定位与候选任务 | 保留 reading key/anchor、频道切换、选中、详情/问答、已读、待核实/采纳和任务进度；不能因离屏变更事实或重复触发分析 |
| grid 列数 | row chunking 与实际布局必须使用同一列数算法，不并行维护 CSS/ResizeObserver/virtualizer 三套规则 |
| 动态高度 | 描述/摘要/语言/字段显隐影响高度；需测量，不能永久假定固定高度 |
| resize/filter/sort | repoId 阅读 anchor 与顺序保持可预测 |
| drag/drop 与键盘重排 | 明确 offscreen target、autoscroll、焦点与 drop 行为，不能静默丢操作 |

若方案要限制拖拽、关闭分组或让某些视图退回非虚拟化，先请用户决定。不能为降低技术成本暗改已有交互。

---

## 5. 当前性能任务拆分

| 子阶段 | 当前文件/调用链 | 验证 | 停止条件 |
| --- | --- | --- | --- |
| A：复现/采样 | 主仓库 List/Groups/Card；发现 View -> Builtin/CustomResults -> 对应 card、reading hooks；Home capture | 固定触发操作与 fixture，记录热点 | 证明卡顿在哪个路径，未修改用户事实 |
| B：去一个宽订阅 | useRepositoryCardActions 的 findSimilar 候选读取 | 触发时读最新 store；账户/取消/动作回归；commit 对比 | 无关仓库变化不再因该依赖唤醒所有卡片 |
| C：Release 派生索引 | RepositoryCard 的 releases filter/sort，现有 Release selector/helper | 集合变化统一派生，逐卡读取；保留最新判定与账户隔离 | 可测减少重复扫描，map 未持久化 |
| D：group partition/rank | RepositoryGroups 与 repositoryGroupOrder | 引用现有 orderedIds/replaceGroupOrder 语义；自定义顺序/折叠/DnD 回归 | 固定 fixture 消除 section×全量过滤与重复 find |
| E：发现低风险计算治理 | Builtin/CustomResults 的 task lookup、repo membership、分析投影与订阅 | 频道/analysis/account/selection/reading 契约 + 同 fixture 派生/commit 对比 | 减少整批重派生与交叉查找，不创建新 DB |
| F：仅必要的虚拟化 | 用户选定的页面/常用视图和必要的 overlay/导航/reading anchor | 上节交互 + 同条件 mounted DOM/long task/commit 对比 | 当前卡顿达到可用目标即停止，不自动扩展其它视图 |

一次只实现一个独立子阶段；B/C/D/E 根据实际热点选择，不因候选表全部存在就连续开发。性能变化必须有修改前后 fixture 对比；本轮只有文档校准，不宣称有性能提升。

---

## 6. 功耗治理：收敛到 Home Sync v2

### 6.1 legacy 5 秒轮询仍值得控制，但不是所有桌面场景的真实路径

legacy `autoSync.ts` 目前会：

```text
每 5 秒触发 syncFromBackend
  -> fetchRepositories
  -> fetchReleases
  -> fetchAIConfigs
  -> fetchWebDAVConfigs
  -> fetchEmbeddingConfigs
  -> fetchVectorSearchConfig
  -> fetchSettings
```

这条路径的问题是高频拉取多个完整 shard，尤其在 backend 内容没有变化时仍会发生网络与序列化工作。

但当 desktop Home Sync 已激活时：

- `startAutoSync()` 直接返回空 unsubscribe；
- `syncFromBackend()` 调用 `flushDesktopHome()` 后返回；
- `forceSyncToBackend()` 最终也走 Home Sync 路径。

因此不能把当前所有本机后台功耗都归因于 legacy polling。先确认实际激活路径；保留 v2 主方向，不自动启动所有旧入口迁移或协议退役。

### 6.2 Home Sync v2 已具备应复用的机制

`src/home/sync.ts` 当前已经有：

- 页面隐藏时跳过自动 poll。
- local edit 2 秒 debounce。
- `online` / `visibilitychange` 唤醒。
- cursor-based `changes`。
- 固定边界的 paged snapshot。
- operation batch + acknowledgement / conflict。
- 失败指数 backoff，认证错误停止自动重试。

服务端 v2 还具备 workspace-bound identity 与 canonical record/changes 存储。

因此推荐的同步演进顺序：

```text
业务写入 / 跨设备同步
        │
        ├── Home backend 可用 → Home Sync v2（主路径）
        │
        └── 仍需 legacy 的场景 → 最小维护 + 逐步迁移
```

### 6.3 不扩大 legacy ETag 协议

原文建议给多个 legacy endpoint 增加 ETag/304。HTTP conditional request 本身可以减少响应体，但它不应成为 GSM 下一代同步协议。

不推荐：

```text
repositories ETag
releases ETag
ai-config ETag
webdav ETag
embedding ETag
vector-config ETag
settings ETag
```

这会继续维护 shard 级变更语义，还要处理跨 shard 一致性、hash 成本和缓存失效。

如果某个 legacy GET 因兼容性必须长期保留，可以局部使用可靠 revision/ETag 做带宽优化；但不能用 `COUNT + MAX(timestamp)` 代替真正 revision/change feed，也不要把“304”当成解决同步功耗的核心设计。

### 6.4 本机功耗只根据实测处理

v2 不是“已无功耗问题”。当前可见时 15 秒检查，网络请求还受 pending、nextAutomaticSync/backoff 控制；Home capture 也会比较领域变化。若隐藏/空闲卡顿或唤醒异常，记录实际请求、long task 与 main/renderer CPU，再调整当前路径。

不规划 SSE/long-poll/server push、新同步协议、移动端弱网、多设备 batch 平台或统一调度器。不新增 legacy ETag 体系；不把改变 polling cadence 当成必然降低电量的证据。

---

## 7. 本机维护的依赖边界

```text
当前复现 -> 找到热点 -> 一个最小修复 -> 相同 fixture 复测
                                       -> 已够用：停止
                                       -> DOM 残余热点：提请用户选择虚拟化范围
```

保留现有 Home v2 和 legacy guard；发现实际双写/重复轮询时再按调用入口修复。旧兼容路径的退役要有可达性与数据迁移证明，不能作为本轮文档简化的附带工作。

---

## 8. 风险与保护措施

| 风险 | 触发点 | 保护措施 |
| --- | --- | --- |
| 滚动跳动 | 动态高度、列数变化 | 稳定 row key、实际测量、repoId scroll anchor |
| Overlay 意外关闭 | 源卡片被 virtualizer 卸载 | overlay 提升到稳定宿主、repoId 驱动 |
| 分组目录失效 | header 未挂载 | group key -> virtual index，active group 从 virtual range 推导 |
| 拖拽目标缺失 | offscreen group/card 不存在 DOM | drag overlay、autoscroll、显式 drop 规则 |
| 筛选后排序丢失 | row model 重建 | 只从当前 filtered/ordered repo ids 构建 rows，保持单一顺序事实源 |
| resize 后定位漂移 | grid 列数变化 | row 重建前后使用 repo anchor 恢复 |
| selector 优化读到旧数据 | callback 捕获旧数组 | 命令执行时 `getState()` 读取最新 store |
| Release index 变成第二事实源 | 把 map 持久化/同步 | index 仅派生、可丢弃重建 |
| v2/legacy 双写冲突 | 同一业务同时经过两套同步 | workspace 启用 v2 后继续执行现有 guard，迁移按入口逐项收敛 |
| 为性能过早牺牲交互 | 一次改 virtualization + drag + overlays | 分阶段独立验收；按用户常用视图选择范围，改变交互先请用户决定 |

---

## 9. 验收按本次子阶段限定

### 9.1 当前计算治理

使用实际规模或可复现匿名 fixture，在相同 Windows 机器、production/dev、窗口与视图下采样。按热点比较 commit、扫描次数/耗时、long task、mounted cards；滚动问题再采 frame/DOM，后台问题再采请求/CPU。不要为每个小修复强制全指标仪表盘。

- findSimilar 保持最新候选、账户和取消语义，减少无关宽订阅。
- Release map 是派生 lookup，保留当前 latest-release 展示，集合变化才统一重算。
- group partition/rank 保持自定义顺序、未分组、折叠、键盘与拖拽契约。
- 发现页比较整批首次展示、追加批次、任务进度更新、频道切换和滚动定位；实际 provider 请求用 fixture/mock 隔离，保留分析资产、已读/采纳状态与阅读 anchor。
- 不通过删除用户数据、已读状态或 outbox 缩短测量。

### 9.2 仅在实施虚拟化时

在用户选择的视图验证离屏卸载、overlay 保持、远处分组跳转、动态高度、resize anchor、filter/sort、selection/bulk/DnD。挂载数量应由 viewport/overscan 决定；具体阈值与收益根据前后数据，不承诺固定 FPS/MB 或固定卡片数量。

### 9.3 仅在涉及同步时

确认 v2 激活不再启动 legacy 5 秒 poll，保留 account/workspace 和未确认操作；offline/hidden/auth failure/reconnect/cursor expired 无紧密重试。不要从 Node/mock 测试推断真实 Windows hidden renderer 的功耗。

现有测试可复用：RepositoryGroups/group order/card actions/Card、Home sync/desktop 与服务端 homeWorkspace；发现使用 SubscriptionRepoCard 的 weekly/noDescription、CustomRepositoryBlock、useDiscoveryEntryLoading、useDiscoveryReading/useChannelEditionReading、custom analysis 测试。当前没有 BuiltinRepositoryResults 的整批挂载性能基准，相应优化时补真实路径的组件 fixture/集成，不能以主仓库测试冒充覆盖。`home/performance.test.ts` 仅验证 5000 repo/10000 message 增量正确性，不能替代 UI benchmark。

修改后运行 typecheck、相关单元/集成、必要时 build/fixture 与 `git diff --check`。

---

## 10. 明确非目标

- 不为假设中的数千仓库预先实现全视图虚拟化或统一虚拟行平台。
- 不改 RepositoryCard 视觉来混淆性能收益，不新建业务 store 或第二份 repositories warm 数据。
- 不做 server-side repository pagination、normalized entity store、统一 Worker 平台或深层持久化拆分。
- 不扩展 legacy ETag，不新增远程/跨设备同步传输，不无证据删除兼容逻辑。
- 不使用 GC、working-set trim、MinWorkingSet，不承诺固定功耗下降比例。

---

## 11. 下一步

优先对主仓库和发现页突然展示大量内容做同条件复现，给出热点证据，再选 B/C/D/E 中一个必要的小修复。只有残余 DOM 瓶颈成立才讨论虚拟化；需改变交互时由用户决定。达到当前可用目标就停止，本轮不自动开始代码实现。
