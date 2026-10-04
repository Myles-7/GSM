# GithubStarsManager 卡片视觉体系、微交互与动效质感全方位打磨分析

> **阶段 4～8 代码更新（2026-10-03）**：阶段 7 只依据实际 light/dark 截图给主仓库 grid 语言点加现有 token outline；list/共享文本默认不变，键盘详情、选择及两条 reduced-motion 验证通过。未重构共享详情/视觉体系。 详见 [连续开发交付报告](GSM_阶段4至8连续开发交付报告.md)。

> **本机范围**：仅 Windows 自用；保留现有主题/组件/账户行为，本轮只修订文档。用户反馈多个页面一次展示大量内容时有卡顿，视觉候选必须服从当前性能证据。

> **现状校准 / 修订说明（2026-10-03）**：本文已按当前代码与《GSM_优化方向可行性与架构改进综合分析报告》重新校准。原文中“另起一套卡片 token、整体替换 RepositoryCard、自造抽屉、为了折叠动画长期保留大量 DOM”的方案不再作为实施建议。后续视觉优化应复用现有 ui-card、主题圆角/阴影 token、Radix Sheet、用户与系统 reduced-motion 机制，若后续因实测残余 DOM 瓶颈接入虚拟化，再与该视图生命周期保持一致；本机路线不预先要求虚拟化。

## 1. 当前基线

GSM 已经具备一套可继续演进的视觉基础，当前问题主要是局部一致性与大列表性能边界，不是缺少设计系统。

| 领域 | 当前代码事实 | 修订后的结论 |
| --- | --- | --- |
| 卡片表面 | src/index.css 已有 .ui-card，统一使用 card、border、ui-radius-md、ui-shadow-card、ui-shadow-float | 不新增第二套 repository-card-modern 或 card-shadow 变量；优先收敛现有类 |
| 圆角/阴影 | tailwind.config.js 的 rounded-md/lg/xl 由 radius 驱动，shadow-subtle/elevated/dialog 由主题 token 驱动；主题 preset 还能覆盖 radius/shadow | 所有新视觉参数从现有 token 派生，避免固定 12px/8px 体系 |
| Reduced motion | 已同时存在用户选择 data-animation=reduced 与 OS prefers-reduced-motion | 新动效天然接受两层降级，不另造设置 |
| RepositoryCard | 已承载 selection、键盘、拖拽、插件 action、README/Release lazy overlay、多视图行为 | 不整体替换，只做样式和局部结构增量调整 |
| 详情面板 | RepositoryDetailsPanel 目前用 Dialog 模拟右侧全高面板；共享 ui/sheet.tsx 已基于 Radix Dialog 提供 overlay、focus、close 与 slide 动画 | 后续迁移到现有 Sheet，不自造 raw fixed drawer |
| Release 抽屉 | RepositoryReleaseSheet 已复用共享 Sheet | 作为详情类侧滑层的参考实现 |
| 网格列数 | RepositoryGrid 目前用 ResizeObserver 计算列数，初始 width 为 0 | 可优化首帧，但在虚拟化方案确定前不要引入第二套布局测量 |
| 分组加载 | RepositoryGroups.GroupBatch 每次增加 50 条，滚动后旧节点仍留在 DOM；collapsed 时直接卸载 | 这是批加载，不是真虚拟化；折叠动画必须服从未来虚拟化 DOM 生命周期 |

原文中仍值得保留的方向包括：统一 hover、边框、阴影和信息层级；提高亮色语言点的边界可见性；将详情交互收敛为真正的侧滑 Sheet；让 skeleton 更接近最终卡片几何；给分组折叠提供清晰视觉反馈。

## 2. 目标视觉架构

### 2.1 单一 token 来源

卡片视觉继续使用现有 radius、ui-radius-sm/md/lg、ui-shadow-card、ui-shadow-float、app-shadow-subtle/elevated/dialog。视觉评审若认为现有 hover elevation 过重，应修改这些 token 或 .ui-card 规则，使所有消费者同步受益，而不是在 RepositoryCard 内再定义一套固定阴影。

主题 preset 已支持 radius、shadowColor、shadowOpacity、shadow 等覆盖，因此任何固定圆角、固定阴影、固定深色微光都会绕开现有主题能力，后续不采用这种实现。

### 2.2 RepositoryCard 保持行为契约

目标不是新增 ModernRepositoryCard，而是围绕当前 RepositoryCard 与 RepositoryListPresentation 做三类小改动：

1. 表面层继续使用 ui-card，减少 consumer 自己叠加的 shadow/radius。
2. 信息层级统一标题、owner、描述、更新时间、标签的 semantic token。
3. 交互层让 hover、selection、drag、expanded 等状态协调，避免 hover transform 覆盖 drag/selected 反馈。

视觉改动必须保留键盘进入与 focus ring、selection mode、drag/drop、插件 action、README / Release lazy overlay、list/grid 两种展示，以及现有相关测试覆盖的行为。

## 3. 动效规范

### 3.1 卡片 hover

现有 .ui-card 已有 150ms border/shadow transition。后续优先使用“border-color → shadow → 可选极轻位移”的顺序，不给每张卡片长期设置 will-change: transform。

只在 fine pointer 下考虑极轻位移，建议上限先控制在约 1px，并在拖拽态、selection 态、同步态关闭位移动画。原文建议的 2.5px 上浮与全卡长期 will-change 不再推荐：在数百或数千卡片场景中，它可能增加合成层、显存压力并影响拖拽手感。

是否新增 transform，应在当前常用列表上验证视觉收益与性能；不必等待虚拟化，但当前大量内容挂载时卡顿尚未解决，不先增加动效成本。

### 3.2 reduced motion

所有新增动效必须满足：

- 用户选择 reduced animation 时近乎即时；
- OS prefers-reduced-motion 时近乎即时；
- 功能状态仍通过边框、颜色、图标或文本表达，不能只靠位移动画；
- spinner 等真正表示任务仍在执行的功能性动画继续沿用当前例外策略。

只有当 JS 逻辑需要跳过测量、延迟或过渡阶段时，才额外读取 reduced-motion 状态；基础 CSS 动画不需要再造一套 hook。

### 3.3 详情 Sheet

如果详情容器确有样式/焦点一致性问题，可独立从“Dialog + 手工右侧定位”迁移到共享 Sheet，复用 Radix 已有 portal、overlay、focus、Escape/outside dismiss、标题与动画。当前 Dialog 本身不是性能问题的证明；不要仅为架构统一启动迁移。

迁移只改变容器原语，不借机重写 pinned、previous/next、README、analysis 等详情业务。RepositoryReleaseSheet 已经证明共享 Sheet 可承载实际业务，可直接作为实现参考。

## 4. 标签、语言点与元数据

### 4.1 颜色来源

普通 topic 使用 muted / muted-foreground；强调状态使用 primary、success、warning、destructive；自定义标签通过 border、ring 或 icon 表达差异，不复制固定 Indigo/Sky palette。

编程语言颜色可继续使用 GitHub 语言色，但亮色点应增加可见边界，例如使用 foreground 低透明度 ring。若未来需要按主题调整语言色，应集中到现有语言元数据 helper，而不是新增散落的组件级 palette。

### 4.2 信息层级

| 信息 | 建议 |
| --- | --- |
| 仓库名 | foreground + semibold，保持最强 |
| owner / secondary metadata | muted-foreground，弱于标题 |
| 描述 | 保持当前可读字号与稳定行高 |
| 更新时间、统计附注 | 使用较弱层级与 muted-foreground |
| 操作按钮 | 继续使用共享 Button 的 ghost/icon 变体 |

是否把某一行从 text-sm 改成 text-xs，要基于真实截图和可读性验证；本文不把未验证像素值当成硬指标。

## 5. Grid、分组折叠与 virtualization 协同

这里说明已有批加载限制与未来接入条件，不要求先实现 virtualizer 才能做局部视觉修复。

GroupBatch 当前只是 50 条一批的渐进挂载。用户继续滚动后，之前的卡片仍存在于 DOM。因此后续真正 virtualization 落地时，卡片和分组动效必须接受 offscreen row 会被卸载这一事实。

### 5.1 分组折叠

不采用“一律 CSS Grid 0fr → 1fr 并保留全部子 DOM”的方案。

| 场景 | 折叠策略 |
| --- | --- |
| 小分组、未启用 virtualization | 可用短暂 height/grid/opacity 动画 |
| 大分组或 virtualized group | 内容立即卸载，只动画 header chevron、border、opacity |
| reduced motion | 直接切换状态 |

“大分组”的阈值不预先拍脑袋写死，应由最终虚拟化实现和真实测量决定。

### 5.2 Grid 首帧

RepositoryGrid 当前 width=0 会先得到 1 列。可以提供合理 CSS fallback 减少首帧抖动，但最终只应有一个列数权威。不要同时维护 CSS auto-fill、ResizeObserver 和 virtualizer 三套列数/measurement 规则。

如果未来 virtualizer 需要固定 column measurement，应让它接管宽度到列数的计算，RepositoryGrid 只负责呈现。

## 6. Skeleton 与加载反馈

原文“几何对齐 skeleton”方向保留，但不建议大量卡片同时无限 shimmer：

- 首屏只渲染接近视口容量的 skeleton；
- virtualized list 只让 viewport/overscan 内占位参与动画；
- reduced motion 下使用静态 muted 占位；
- skeleton 高度来自最终 layout 或可测量结构，不长期维护独立固定高度常量；
- 已有数据刷新时优先保留旧内容并显示局部 pending 状态，避免整页 skeleton 闪回。

## 7. 本机可独立选择的小任务

用户当前主要反馈大量内容呈现时卡顿，先按性能专项定位；视觉精修不是这次卡顿的替代方案。

| 候选 | 范围 | 验证/退出条件 |
| --- | --- | --- |
| 局部视觉收敛 | 一次处理 surface/层级/语言点等一项；沿用 ui-card 与 token | 实际 light/dark/常用 preset 截图、可读性、focus/selection/drag 回归 |
| 详情容器 | 只有现有 Dialog/侧栏确有一致性问题才迁移共享 Sheet | pinned、previous/next、README、analysis、嵌套 modal 与焦点保持 |
| 折叠/skeleton | 先减少无意义动画与避免保存大 DOM | 大内容切换无明显新增 long task，两条 reduced-motion 路径通过 |
| 虚拟化兼容 | 仅实际决定接入的视图 | overlay/anchor、列数、离屏卸载与必要 placeholder 行为 |

不强制搭建 100/500/1000 全主题 GPU 基线矩阵、额外设计系统或新动效框架。性能结论使用本次同条件 fixture；纯颜色/层级改动以截图和交互验证为主。

## 8. 依赖与风险

复用现有 token、Radix Sheet/Button/Card 即可；局部视觉任务不依赖 virtualizer 选型或全面 state 改造。若共享 Card 也用于发现结果，则验证该消费者，不能假设主仓库页通过就覆盖其它布局。

1. 阴影/transform 在大量已挂载内容下可能增加绘制成本。
2. RepositoryCard 隐含行为多，整块重写容易造成 selection/drag/overlay 回归。
3. Sheet 迁移不能削弱 pinned、nested modal 与 opener 焦点行为。
4. 大组为动画保留 DOM 会增加当前挂载成本；不应为了流畅外观隐藏实际卡顿。
5. 固定颜色/圆角/阴影会绕过主题 preset。

## 9. 验收指标

- light/dark 与主题 preset 下，卡片 surface、radius、shadow 均来自现有 token，无第二套固定视觉变量；
- keyboard focus、selection、drag、README、Release、详情等既有行为回归通过；
- user reduced-motion 与 OS reduced-motion 下，新增非必要位移动画均被关闭；
- 详情迁移后，focus trap、Escape、outside dismiss、focus restore 与共享 Sheet 契约一致；
- 进入 virtualization 阶段后，折叠大组不会因为动画保留全部子 DOM；
- 性能报告同时记录改动前后数据集、机器/平台、窗口尺寸、DOM 数量和采样方法；没有测量就不写“提升 X% / 稳定 60 FPS”结论；
- 对比度使用真实主题背景测量，不凭颜色名称判断。

## 10. 明确非目标

- 不整体替换 RepositoryCard；
- 不新建平行的卡片 token、shadow、radius 体系；
- 不自造 raw fixed drawer；
- 不为了折叠动画永久保留大分组 DOM；
- 不在每张卡片上长期 will-change；
- 不并行维护第二套 grid measurement；按实际启用的布局保留唯一规则；
- 不用未经测量的 FPS、内存或“质感提升百分比”作为既成结果。

本机方向是：在现有设计系统上做独立的小改动，优先解决实际大量内容呈现卡顿；动效遵守 reduced-motion 和当前挂载成本，虚拟化仅在实际选择接入时成为约束。本轮不开始视觉实现。
