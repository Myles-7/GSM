# GSM 个人开发流与冷启动效率分析

> **阶段 4～8 代码更新（2026-10-03）**：阶段 6 已完成隔离生产启动 3 对基线/复测，仅默认 accent computed-style 读取修复；首个水合后绘制机会 median 减少 23.7/26.8 ms，不代表全部 UI 卡顿解决。其它启动候选未实施。 详见 [连续开发交付报告](GSM_阶段4至8连续开发交付报告.md)。

> **文档定位**：仅本机 Windows 的启动诊断与低风险优化；用户保留现有本机 Home，不新增跨设备能力。
> **范围决策（2026-10-03）**：Bootstrap Projection 不列为确定目标；本轮只改文档。
> **核心原则**：先建立可重复基线，再缩短真正的关键路径；Bootstrap 只做非权威投影，不制造第二套业务存储；优化不能改变首次使用和身份语义。

---

## 1. 现状校准 / 修订说明

原文正确识别了字体入口负担、i18n 首帧阻塞、完整 Zustand 水合屏障、IndexedDB 连接频繁创建以及开发 origin 漂移等问题，但有三类结论需要修正：

1. **不能再声称“所有主视图都没有 lazy loading”。** 当前 `App.tsx` 已对 Release、Fork、Settings、Discovery、Gist、AI Workbench 使用 `React.lazy`；Repository 内部的 README、详情/聊天等也已有部分懒加载。剩余问题主要是 feature 内部 chunk 边界和 Settings/Discovery 子模块的静态引用。
2. **不能把完整仓库数据复制成第二份 warm store。** 主 Zustand/IndexedDB 已是权威持久层，另造可写 warm cache 会引入新的迁移、一致性和身份问题。当前先使用既有 Loading/基础 shell；即使未来需要投影也不能变为可写业务 store。用户本轮没有选择建设 Bootstrap Projection。
3. **不能承诺未经测量的 FCP/LCP 绝对数字。** 当前仓库已经有若干 `performance.mark`，但没有稳定的 Electron cold/warm 启动基线。目标应先由 Phase 0 测量确定，再形成预算和回归阈值。

这份文档的最终方向是：

> **复用生产入口 + 当前问题采样 + 按证据优化 i18n/IDB/chunk/font + 首次使用语义不变。**

---

## 2. 当前启动链路：已经确认的事实

### 2.0 日常启动器已经修过，不再建设新 launcher

[P0.2.1 记录](../personal/upgrades/P0.2.1-desktop-startup.md)和[实际启动器](../../scripts/start-home-desktop.cjs)证实：日常快捷方式以 production 模式打开构建后的 `dist/index.html`，不启动 Vite，也不启动/等待临时 backend。后端 Windows 服务独立运行，应用水合后本地内容可用，Home 在后台初始化。

`http://127.0.0.1:5174` 仅为保留的开发来源，不能与 production file-origin 混用存储。日常修复不改原 userData、app identity 或入口，不再提出 stable/ephemeral/backend/devtools 启动器模式平台。

历史记录的 62 仓库与启动耗时是当时单次样本，不是当前数量或当前卡顿的反证；当前应重新复现。

### 2.1 React 挂载前仍有 i18n 阻塞

`src/main.tsx` 在 `createRoot()` 前执行：

```ts
await Promise.all([
  ensureLanguageLoaded(initialLanguage),
  ensureLanguageLoaded(FALLBACK_LANGUAGE),
]);
```

`src/i18n/index.ts` 当前定义 14 个 namespace，`ensureLanguageLoaded(language)` 会把该语言下所有已知 namespace 一次性动态加载。初始语言与 fallback 不同的时候，首屏前可能加载两组完整 namespace。

这意味着 `settings`、`plugins`、`chat`、`releases`、`services` 等非首屏资源仍可能参与 React mount 前的关键路径。

### 2.2 主 Store 仍有完整水合屏障

`createInitialState()` 默认：

```ts
repositories: [],
isAuthenticated: false,
hasHydrated: false,
```

`App.tsx` 在 `hasHydrated === false` 时返回全屏 Loading。只有 Zustand persist 的 `onRehydrateStorage` 完成后才 `setHasHydrated(true)`。

因此当前用户是否能看到真实应用 shell，仍取决于主 snapshot 的 IndexedDB read、JSON parse、migrate、normalize、merge 完成。

### 2.3 IndexedDB 主存储每次操作重新 open / close

`src/services/indexedDbStorage.ts` 的 `idbGet`、`idbSet`、`idbDelete` 都会调用 `openDb()`；transaction 完成后立即 `db.close()`。

这是一个可局部处理的固定开销，但是否解释当前卡顿仍需采样。该文件还承担 Zustand snapshot 的整体字符串读取/写入；如果实施连接复用，只在这里独立修改，不先改整个 persistence schema。

### 2.4 主 snapshot 已经有写入降噪，但仍是单个 JSON

`src/store/persistence/storage.ts` 已经做了：

- 1 秒 debounce；
- `requestIdleCallback`/timeout 后 stringify；
- pagehide/beforeunload/hidden 时 flush；
- stringify/write duration 与 bytes 的日志；
- 串行化 persist writes。

因此下一阶段不应再造一套“完整 warm store”来规避写入。更合理的是先量 snapshot bytes/parse/hydration，再决定是否需要长期拆 object store。

### 2.5 已有同步 auth mirror，不能扩展成完整业务真相源

`authStorage.ts` 已使用 localStorage 保存 auth mirror，用于 IndexedDB snapshot 缺少 credential 时的恢复兜底。

这套 mirror 有明确、狭窄职责。把完整 repositories、category tree 或完整 user state 继续复制进 localStorage，会把 fallback 机制变成第二个业务数据库。

### 2.6 App 已经有多处 lazy loading

当前 `App.tsx` 已 lazy：

- ReleaseTimeline；
- ForkTimeline；
- SettingsPanel；
- DiscoveryView；
- GistView；
- AIWorkbench。

Repository 相关代码也已经对 README modal、details、chat 等重交互做部分 dynamic import。

所以后续工作应聚焦：

- SettingsPanel 内部 heavy tab 是否仍通过 barrel 静态进入同一 chunk；
- Discovery feature 中 dynamic/static 反向引用导致的“看似 lazy 实际不能拆 chunk”；
- Repository 主路径中尚未访问就加载的重模块。

### 2.7 字体入口确实大，但不能直接等同于全部字体二进制首屏下载

`main.tsx` 当前静态 import 多组 fontsource family。它们会增加入口 CSS/module 和 build 产物，但浏览器具体下载哪些字体文件还取决于 `@font-face` 使用和浏览器策略。

因此字体优化要以 bundle report + Network/Performance trace 为证据，不能只根据 import 数量推导 FCP。

### 2.8 开发 origin 已有“固定即不漂移”的基础能力

`scripts/dev-desktop.mjs` 当前行为：

- 若提供合法 `GSM_DEV_SERVER_URL`，将其视为 pinned origin；
- pinned port 被占用时直接失败，不会自动换端口；
- 未固定时才从默认端口附近寻找可用端口；
- Electron 使用最终 `GSM_DEV_SERVER_URL` 打开 renderer。

这已经具备稳定 origin 的底层保证。后续需要做的是把团队/个人日常入口收敛到一个明确的 pinned origin，而不是再写一个与现有 launcher 竞争的新启动器。

---

## 3. 先区分启动慢与当前交互卡顿

用户已确认多个场景都有卡顿，重点是突然展示大量内容，包括发现页整批仓库；不应先归因为 hydration、字体或 IndexedDB。下一次任务记录触发操作、当前数量、production/dev、窗口大小、视图、Home/AI/同步活动，再用已有 marks 和 DevTools 采样。

先记录三类时间：store hydration、首个可操作页面、Home 后台就绪。按 trace 增加真正缺失的时间点，不要求一开始建立 process-to-search 全套遥测。

固定一个能复现问题的匿名 fixture；可加中/大压力场景，但不强制每个小修复都跑 cold/warm × 100/1000/5000 全矩阵。需要作性能结论时，以相同机器/数据/入口/场景多次比较并记录采样方法。历史单次日志不是可比 baseline。

已有 `gsm:store-hydration-start`、`gsm:store-hydrated`、`gsm:first-hydrated-frame`、backend initialize 和 Home initialized marks 应优先复用。

---

## 4. 保持现有启动状态边界

本机路线不引入 Bootstrap Projection，也不复制最近仓库预览、auth-present 或完整 warm store。现有 loading 与 theme 基础呈现可以做无持久化的小调整，但只有复现说明它值得改才实施。

权威 hydration 完成前不开放仓库编辑、搜索写回、同步、恢复或账户提交；真实 token/user 不从视觉占位推断。保持现有 auth mirror 的狭窄兼容职责，不扩成 repository/category 缓存。

如果用户未来明确需要水合前预览，应重新决定收益与维护成本。届时 projection 必须非权威、可丢弃、无 token、带身份/schema 校验，不能 merge 回主 store；这只是边界说明，不是当前待办。

---

## 5. i18n：仅在 trace 证明阻塞时缩小加载粒度

### 5.1 当前问题

现在 `ensureLanguageLoaded(language)` 以“语言”为加载粒度，把该语言全部 14 namespace 装入后才继续。

### 5.2 按需目标 API

建议把加载粒度降到 namespace：

```ts
ensureNamespacesLoaded(language, namespaces)
```

个人版 UI 仅中英，历史资源保留兼容，不做新的多语言扩展。若 React mount 前的资源装载是热点，critical set 从当前首屏组件依赖确认，初始候选：

```ts
['common', 'app', 'login', 'repositories']
```

不要把该列表写成永久常量后不再核对。CI/测试应确保首屏同步访问的 key 都在 critical set 中。

### 5.3 需要补的机制

- loaded key 应按 `language + namespace` 记录；
- 增加 in-flight Promise 去重，避免并发 view/prefetch 重复 import；
- fallback namespace 与 active language namespace 同样按需；
- view boundary 在进入 Settings/Discovery/Release 前加载对应 namespace；
- hover/idle prefetch 可作为后续优化，不是正确性依赖。

### 5.4 验收

- 首屏不显示 raw i18n key；
- 首次切换到 lazy view 时有局部 fallback，不阻塞整个应用；
- 快速语言切换仍遵守现有 sequence guard，旧请求不能覆盖新语言；
- 相同 namespace 并发请求只触发一次 module load。

---

## 6. IndexedDB Connection Reuse：独立候选，先证明收益

### 6.1 当前问题

主 Zustand storage 每个 get/set/delete 都执行 `indexedDB.open()`，transaction 后 close。

### 6.2 有证据后的小范围实现

保持 `StateStorage` 外部 API 不变，只在 `indexedDbStorage.ts` 内建立连接生命周期：

```ts
let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = openDatabase();
  return dbPromise;
}
```

实际实现必须处理：

- `versionchange`：主动 close，并把缓存 promise 清空；
- open error：清空失败 promise，允许后续重试；
- 页面 teardown：无需为每个 transaction close；
- upgrade path：仍由单一 `onupgradeneeded` 创建 object store；
- timeout/fallback：保留当前 IndexedDB -> localStorage fallback 语义。

### 6.3 范围控制

若进入连接复用任务，只改主 Zustand storage。项目中的 Discovery、Home、repositoryChat、analysis assets 等独立 DB 各有生命周期，不应为了“统一连接池”一次性重写。

HomeDatabase 已缓存连接，但当前 open failure/versionchange 后没有完整的缓存 promise reset；可参考其单 DB 事务边界，不能机械复制连接生命周期并假定所有重试场景已覆盖。本轮不顺带修改 HomeDatabase。

如果后续 trace 证明某个独立 DB 的 open/close 也是热点，再按该域单独处理。

---

## 7. Hydration 反馈：不新增缓存、不跳过首次使用

`App.tsx` 在未水合时返回 Loading 是现状。若用户的卡顿在日常滚动/分类中发生，去掉启动 loading 不能解决该问题，应先检查列表路径。

若启动采样确实说明反馈不足，可以只改 Loading 的背景/skeleton 与首屏布局，让现有 theme 和静态结构更稳定；不新增可持久化仓库预览或鉴权镜像，也不在未水合时启用业务操作。

水合完成后正常从现有 Zustand/领域状态渲染，不将临时占位数据 merge 入 store。任何新首屏设计需要先明确可见状态与禁用操作，且保留新用户同步范围选择。

---

## 8. Lazy Loading：修 chunk 边界，不重做已经完成的工作

### 8.1 已经完成的部分

App 级 view lazy 已覆盖多个重页面，Repository 也已有部分重模态 lazy。因此不需要建立新的“全应用 lazy 改造项目”。

### 8.2 真正剩余的对象

优先检查：

1. **SettingsPanel**：General tab 是否仍静态带入 AI/vector/plugin/HTML Reading 等 heavy runtime。
2. **Discovery**：custom model/storage/analysis 模块是否同时被 static/dynamic import，使 Vite 无法拆 chunk。
3. **Repository 主路径**：只有用户点击才需要的 README/chat/details/批量工具是否仍有静态依赖链。
4. **Plugin**：schema/types 与 runtime host 分离，避免 common path 反向拉入完整插件实现。

### 8.3 判断标准

只对 build graph / bundle report 证明存在入口收益的模块做拆分。不要为了文件名里出现 `lazy` 就认为 chunk 已经独立，也不要把很小的组件切成大量请求。

---

## 9. 字体：按 trace 决定优先级

### 9.1 确认事实

`main.tsx` 当前静态 import 多个 fontsource family，build 产物里会产生大量字体资源。

### 9.2 目标方向

- 默认 shell 使用稳定 system/fallback stack；
- 当前 theme/preset 实际需要的自托管字体优先加载；
- 其他字体在用户选择对应 preset 时动态加载；
- 已加载字体允许浏览器缓存，不重复下载；
- 验证 FOIT/FOUT 和 layout shift。

### 9.3 不做未经验证的推断

“15 个 import”不等于“15 套字体二进制首帧全部下载”。是否把字体改造列为 P0，要看 Network trace、bundle report 和真实 first render 对比。

---

## 10. 保持两种既有来源，不再扩展启动器

- 日常：已有快捷方式 -> production built page / file-origin。
- 开发：保留 `http://127.0.0.1:5174` 与现有 pinned-origin 校验；占用时 fail fast，不静默跳 origin。
- 不将开发存储搬到 production，也不清空任何一侧 profile 来解决“数据消失”。

`scripts/dev-desktop.mjs` 与 `desktop-dev-address.mjs` 已具备 pinned origin 与非法地址拒绝；`start-home-desktop.cjs` 已具备生产构建缺失时报错、第二实例正常唤醒等行为。维护现有入口即可，不新增 stable/ephemeral/backend/devtools 模式或跨平台 launcher。

对应测试为 `scripts/desktop-dev-address.test.mjs` 与 `scripts/start-home-desktop.test.cjs`。

---

## 11. 保留首次使用产品语义

### 11.1 `SyncModeChoiceModal` 不是性能开关

当前 `createInitialState()`：

```ts
syncMode: 'stars',
syncModeConfigured: false,
```

`SyncModeChoiceModal` 在未配置时打开，让用户选择只同步 Stars 或 Stars + Lists。

不能为了少一个 modal 就把 `syncModeConfigured` 默认改成 `true`。这会改变第一次使用的产品语义，并可能让用户不知道 Lists 能力存在。

### 11.2 可优化展示方式，但要保持选择语义

如果基线证明它影响首屏体验，可考虑：

- shell 先出现，modal 稍后在 authoritative hydration 后显示；
- 将其设计成非空白屏式 onboarding；
- 明确默认值，但仍要求用户确认；
- 设置页始终可重新选择。

验收必须确认：新用户仍能看到并理解同步范围选择，旧用户不会重复弹出。

### 11.3 首次登录与 credential 恢复

真实 token、user 和 account workspace 仍由 authoritative hydration 决定，不通过预览或占位推断登录状态。已有 auth mirror 保持狭窄兼容职责。

---

## 12. 独立子阶段与进入条件

| 候选任务 | 进入条件 | 范围 | 退出条件 |
| --- | --- | --- | --- |
| 当前复现与采样 | 用户已反馈卡顿 | 复用 marks，区分启动/渲染/查询/后台，不修改数据 | 得到同条件可重复场景与具体热点 |
| IDB 连接复用 | open/close 在当前场景有可观测成本 | 仅 indexedDbStorage，保持 API/schema/fallback | versionchange、失败重试、移除/串行写与 fallback 通过，固定 fixture 对比 |
| i18n namespace/dedupe | mount 前装载是热点 | 现有中英 loader 与 view 依赖 | 不显示 raw key，语言切换序列保护与并发去重通过 |
| 重 chunk 按需加载 | bundle graph 证明主路径引用未使用的重模块 | 只拆一个 feature 边界 | build/chunk 变化可解释，第一次访问有 fallback/error boundary |
| 当前 preset 字体加载 | Network/布局 trace 证明值得改 | 现有字体入口与 preset 映射 | 保留主题字体能力，FOIT/FOUT/CLS 与切换回归通过 |

一次只选一个有证据的任务，不能把表当成全部必须实施的阶段。当前启动已够用时可以停止；本轮不排 Bootstrap Projection、分 object store、全应用遥测或 CI 性能预算平台。

---

## 13. 风险与验证

现有验证入口：`src/App.startup.test.tsx`、`src/features/lifecycle/hooks/useBackendLifecycle.test.tsx`、`src/i18n/languages.test.ts`、`src/store/persistence/authStorage.test.ts`、`src/store/useAppStore.test.ts` 与两份启动器 Node 测试。

未来新增连接复用或 namespace loader 时，补相应故障/并发测试；不能声称当前已经有这些新实现的覆盖。测试关注真实失败路径与产品语义，不机械复制代码。

必须保留：

- IDB/localStorage 迁移与失败兜底；缓存失败 promise 要 reset，versionchange 要关闭旧连接并可重新 open。
- 中英入口和旧资源/API 兼容，语言切换只应用最后一次请求。
- 首次 `syncModeConfigured=false` 与同步范围选择语义。
- backend 慢/不可用不阻止本地首屏；Home 已确认与未确认数据的边界。
- dev/production origin、原 userData 与应用身份。

验证按改动运行 typecheck、单元/启动集成与 `git diff --check`；chunk/font 改动才需 build，性能实现变更才需相同 fixture 前后采样。只验收本机 Windows，不从本机耗时推出其它硬件或 OS 结论。

---

## 14. 明确排除与下一步

不建立第二份 repositories/category warm 数据库，不做 Bootstrap Projection，不再造 launcher，不重做已存在 view lazy，不删除历史语言/字体/凭据兼容，不为了性能确认首次选择，不一次改所有独立 IDB。

下一步先按列表/发现专项定位整批内容展示、滚动、分类/折叠的共同触发；若采样另发现生产启动瓶颈，再从本篇选择一个有证据的小阶段。本轮文档修改后不自动启动实现。
