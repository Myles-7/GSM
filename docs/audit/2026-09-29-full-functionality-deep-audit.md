# GSM 全功能深度可用性审查报告

> 审查日期：2026-09-29
> 审查分支：`codex/ai-repository-organization`
> 基线提交：`fb6f24e`
> 审查对象：当前工作树（包含未提交的 AI / Discovery / AGY / UI 等开发内容）
> 审查性质：只读审查 + 自动化验证 + 本地浏览器 smoke test；除本报告外未修改业务源码。

## 1. 结论摘要

当前项目的主要矛盾不是“缺少测试”，而是**功能增长速度已经超过账号生命周期、跨运行时契约和部署模型的统一速度**。本轮完整回归显示核心业务测试保护很强：前端 2091 个测试、Server 137 个测试、Electron MCP / AGY / Plugin 套件均通过；但当前工作树同时存在 TypeScript、ESLint 和 `git diff --check` 阻断，说明它还不是一个可直接合并或发布的状态。

用户所感知的“很多功能无法使用”可以归纳为四类根因：

1. **账号与后端同步模型不一致。** 前端已经支持按 GitHub user id 隔离 `accountWorkspaces`，后端 SQLite 仍是全局单工作区模型；登录/恢复流程又会在新账号身份正式写入 Store 之前拉取全局后端数据。复用同一个后端切换 GitHub 账号时，存在确定性的账号数据串用风险。
2. **后台生命周期不受登录态约束。** `App` 在显示 LoginScreen 之前已经启动 `useBackendLifecycle`，后端可用后会拉取数据并启动 5 秒轮询。真实浏览器 smoke test 已观察到未登录页面持续请求仓库、Release、AI/WebDAV/Embedding/Vector 配置和 settings。登出、账号切换和旧请求迟到提交因此成为高风险组合状态。
3. **部分入口“有 UI 但能力并不完整”。** Repository Chat 的 Web Tools 开关目前没有执行路径；远程 backend 模式生成的 MCP URL 使用前端 origin；Backend MCP 在当前 Vector Worker v2 下主动禁用向量工具；fullstack Compose 没有透传 `CSP_CONNECT_SRC`，自定义 browser-direct AI/Worker 会被 CSP 阻断。
4. **新的 Discovery / AI UI 仍处于未收口开发态。** 业务测试全绿，但当前 `typecheck` 有 7 个错误，`lint` 有 44 errors / 10 warnings，主要集中在新 Custom Discovery 和 AI Workbench UI；Custom Discovery 的取消语义还会把部分结果落盘。

此外，本轮还发现几项用户数据管理语义与实际实现不一致：Release“全部已读”失败时只回滚一半状态；“删除所有数据”漏删 Chat/Workbench 与 Custom Discovery 的独立 IndexedDB，并且没有重置所有已持久字段；WebDAV/JSON 备份也没有覆盖当前应用的全部用户数据。这些问题应按 data-safety 缺陷处理，而不是普通设置页 UI 问题。

因此，后续不建议先做大规模 UI 微调或继续增加 AI 入口。应先统一**账号 identity / sync generation / transaction / cancel semantics**，然后修正明确不可用的部署和 MCP 路径，最后再做架构拆分和性能优化。

---

## 2. 审查范围与方法

本轮重新核对了上一轮分析，不直接沿用旧结论。覆盖范围包括：

- React/Vite 前端启动、水合、登录、账号工作区、搜索、仓库、分类、Gist、Release、Fork、Discovery、AI Workbench、Repository Chat、设置和备份。
- Zustand persistence、IndexedDB/localStorage auth mirror、autoSync、后端恢复和多账号切换。
- AI provider 配置、流式回答、工具循环、Embedding、Vector Search、AGY CLI。
- Electron main/preload/IPC、Plugin Host、本地 MCP。
- Node Server、SQLite schema、Proxy、MCP、CSP、Docker Compose。
- Cloudflare Worker Vectorize v2。
- TypeScript、ESLint、边界/i18n/plugin/vector gate、单测、Server 测试、Electron 测试、生产构建、bundle budget、依赖审计。
- 本地 Vite 真实浏览器 smoke test 和 Network/Console 观测；未使用或读取用户真实 GitHub/AI/WebDAV 密钥，也没有执行会修改真实远端数据的业务动作。

当前工作树规模很大：`git status --porcelain` 有约 252 条记录；tracked diff 约 **132 files changed, +9082/-3318**。因此本报告描述的是当前开发快照，不等同于 `fb6f24e` 的干净提交状态。

---

## 3. 当前质量与发布基线

| 检查项 | 当前结果 | 判断 |
|---|---:|---|
| `npm run typecheck` | **失败** | 7 个 TS6133，集中在新 Custom Discovery 组件/测试 |
| `npm run lint` | **失败** | 44 errors / 10 warnings |
| `npm run check:boundaries` | 通过 | 规则本身仍有覆盖缺口，见 A-02 |
| `npm run check:i18n` | 通过 | 10 语言 gate 当前正常 |
| `npm run check:plugin-registry` | 通过 | Plugin registry 语义 gate 正常 |
| `npm run check:vector-worker` | 通过 | `worker.js` 与 TS source parity 正常 |
| 前端 Vitest | **186 files / 2091 tests 全过** | 业务回归基线很强 |
| Server Vitest | **20 files / 137 tests 全过** | 后端核心回归正常 |
| Electron MCP | **33/33** | 本地 MCP 契约正常 |
| Electron AGY | **37/37** | 隔离、队列、取消、协议测试覆盖较强 |
| Electron Plugin | **103 passed / 1 skipped** | 跳过为 Windows symlink 权限场景 |
| version script | **10/10** | 正常 |
| CI gate tests | **27/27** | gate 自身测试正常 |
| desktop launcher | **4/4** | 正常 |
| `npm run build` | 通过 | Vite 可以构建；构建不会替代 typecheck |
| `npm run check:bundle-size` | 通过 | legacy entry **1505.91 KiB < 3000 KiB** |
| Server `tsc` build | 通过 | 正常 |
| `git diff --check` | **失败** | `src/components/SearchBar.tsx` 整文件 CRLF/尾随空白噪声 |
| root production dependency audit | 0 vulnerabilities | 正常 |
| Server dependency audit | 1 moderate | `morgan@1.12.0` log injection advisory |
| Worker local install | **不完整** | `cloudflare-worker` 当前缺 wrangler/typescript/workers-types node_modules |

### 3.1 当前 TypeScript 阻断

`typecheck` 的 7 个错误集中在：

- `src/features/discovery/components/CustomChannelEditionPicker.tsx`：未使用 `React`。
- `src/features/discovery/components/CustomChannelEditor.tsx`：未使用 `React`、`Check`、`isMinStarsLimited`、`isMaxStarsLimited`。
- `src/features/discovery/components/CustomChannelUI.tsx`：未使用 `getEditionKey`。
- `src/features/discovery/custom/store.editions.test.ts`：未使用 mock。

这些问题不会阻止 Vite dev server 启动，但会阻止仓库定义的 TypeScript/CI 合格线，因此当前工作树不能视为 release-ready。

### 3.2 当前 ESLint 阻断

主要错误分布在：

- AI Workbench tests：大量 `@typescript-eslint/no-explicit-any`。
- `AIWorkbench.tsx`：Hook dependency warnings。
- `RequirementsEditor.tsx`：`no-useless-escape`。
- Custom Discovery 新组件/测试：unused / any。
- `src/utils/repoSearch.ts:167`：`no-explicit-any`。
- `useGistActions.ts`：effect cleanup 捕获 mutable ref 的 warning。

这说明当前新增功能已经通过行为测试，但代码门禁还没同步收口。

### 3.3 Node 测试环境

上一轮 Node 25 下 `localStorage.* is not a function` 导致大量假失败的问题已经**实质修复**：`src/test/setup.ts` 现在检测 Storage 方法能力并同时修补 `window/globalThis`，本轮在 Node 25.8.2 下 2091 个前端测试全部通过。

仍有两个工程问题：

- 测试期间反复出现 `--localstorage-file was provided without a valid path` Node warning。
- 仓库没有 `.nvmrc` / `.node-version` / package `engines` / Volta pin，而 CI 明确使用 Node 24。

建议固定 Node 24，避免本地与 CI 工具链继续漂移。

---

## 4. 真实浏览器 smoke test

本轮用当前工作树启动 Vite dev server，并在真实浏览器访问登录页。没有使用真实 GitHub token 或 AI key，也未提交写操作。

### 4.1 正向结果

- 应用可正常启动和完成 Zustand hydration。
- 登录页、已有后端恢复页可以渲染。
- 点击“现有数据”可以切换到通讯地址/API key 恢复表单。
- 浏览器 Console 未出现未捕获 JS 异常。

### 4.2 关键异常行为：未登录仍启动后端同步

`App.tsx` 在认证 gate 前调用 `useBackendLifecycle(hasHydrated)`；`useBackendLifecycle.ts:31-53` 只依赖 hydration，在 backend 可用后依次执行 auth restore、token sync、`syncFromBackend()` 和 `startAutoSync()`。

真实 Network 观测确认：登录/恢复页保持未登录状态时，应用仍每约 5 秒请求：

- `/api/repositories?limit=10000`
- `/api/releases?limit=10000`
- `/api/configs/ai?decrypt=true`
- `/api/configs/webdav?decrypt=true`
- `/api/configs/embedding?decrypt=true`
- `/api/configs/vector-search?decrypt=true`
- `/api/settings`

`autoSync.ts:810-813` 也明确固定 5 秒 polling。

这不是单纯性能问题。它证明“backend sync session”和“GitHub authenticated session”目前是两个没有统一 identity 的生命周期，会放大下面 P0/P1 数据一致性问题。

---

## 5. 功能可用性矩阵

| 功能域 | 当前判断 | 核心说明 |
|---|---|---|
| 应用启动 / 本地 UI | **基本可用** | Vite 可启动、Hydration 正常、无首屏 JS crash |
| GitHub Token 登录 | **基本可用，切账号高风险** | 单账号 happy path 有测试；多账号 + backend 模型冲突见 P0-01 |
| Backend 恢复登录 | **部分可用** | restore 有校验，但存在并发手动登录覆盖竞态；同步在 `setUser` 前发生 |
| Repository 列表/过滤 | **基本可用** | 自动化覆盖较强；SearchBar 当前 diff hygiene 很差 |
| AI 搜索 / 向量搜索 | **浏览器/桌面基本可用，环境相关** | 搜索取消已有 AbortController；Backend MCP vector 与 Worker v2 不等价 |
| GitHub Lists / 分类 | **基本可用，后端账号模型有风险** | 前端按账号保存，后端全局保存 |
| Stars / Lists 长任务 | **切账号时不安全** | `syncStars` / `pushCategoriesToLists` 缺少 session generation；A 的迟到结果可写入 B 当前 workspace |
| Release / Fork | **自动化层面可用** | 本轮未用真实账号做远端写/刷新 smoke test |
| Gist | **基本可用** | 新 generation/cancel 机制较上一轮改善；仍有 cleanup hook warning |
| Custom Discovery | **未收口 / 高风险** | 当前 typecheck/lint 阻断；取消仍可能 publish 部分结果 |
| AI Workbench | **核心流程有测试，边缘状态有缺口** | streaming message 原子性问题；复杂研究仍受预算限制 |
| Repository Chat | **基本可用，retry/regenerate 有数据丢失窗口** | Web Tools 开关当前无执行路径 |
| AGY CLI | **契约层面较健康** | 37/37；保存过程中取消存在磁盘/内存不一致窗口 |
| Plugin Host | **契约层面较健康** | 103 passed / 1 Windows symlink skip |
| Electron Local MCP | **大部分可用** | vector v2 支持；Gemini embedding error 可能泄漏 key |
| Backend/Docker MCP | **部分可用** | repository/keyword 可用；正常 Worker v2 下 vector tools 主动不可用 |
| 远程 Backend MCP 配置 | **存在直接不可用场景** | UI 生成 MCP URL 使用 frontend origin |
| Fullstack + 自定义 browser-direct AI/Worker | **存在直接不可用场景** | Compose 未透传 `CSP_CONNECT_SRC` |
| WebDAV / RPC / Proxy | **主要 contract 有测试** | credentials 本地明文持久化；Proxy SSRF 仍缺 DNS pin/redirect revalidation |
| Backend Auto Sync | **存在丢更新与停摆窗口** | 任一 slice 变化会全 shard 覆盖写；一次 push 失败后 dirty state 可阻断后续 pull 且没有自动重试 |
| 数据导出 / WebDAV 备份 | **不完整** | 多个已持久化域和独立 DB 不在备份范围内，不能视为完整灾备 |
| “删除所有数据” | **当前不完整** | 漏删 Chat/Workbench 与 Custom Discovery DB，且 Store reset 漏掉多个持久字段 |
| Cloudflare Worker 开发/部署 | **源码可验证，本机子项目未安装依赖** | parity gate 通过；当前 `cloudflare-worker` 目录不能直接运行 wrangler |

---

## 6. P0：数据完整性与账号隔离问题

### P0-01 · 前端多账号工作区与后端全局工作区模型冲突

**状态：本轮新确认，优先级最高。**

前端已经明确按 GitHub user id 隔离：

- `src/store/helpers/accountWorkspace.ts:247-267` 根据 account id park/restore workspace。
- `src/store/slices/authSlice.ts:8-20` 在 `setUser()` 时调用 `switchAccountWorkspace`。
- persistence v16 保存 `accountWorkspaces`。

但 Server schema 是全局表：

- `server/src/db/schema.ts` 的 `repositories`、`releases`、`ai_configs`、`webdav_configs`、`settings`、`embedding_configs`、`vector_search_configs` 都没有 `account_id` / `user_id` 维度。
- repository full sync 也是全表语义。

更关键的是 backend token setup 顺序：

1. `LoginScreen.tsx:217` `setupBackendGitHubToken(githubToken)`，验证 B 账号并把 token 写入 backend。
2. `LoginScreen.tsx:218` **先执行 `syncBackendData()`**。
3. `useLoginActions.ts:84-86` 的 `syncBackendData()` 实际是 `syncFromBackend({ force: true })`。
4. 直到 `LoginScreen.tsx:219-220` 才 `setGitHubToken()` / `setUser(B)`。

如果 backend 里仍是账号 A 的全局仓库，这次 pull 会先把 A 数据写入当前 live workspace。随后 `setUser(B)` 进入 `switchAccountWorkspace()`；`accountWorkspace.ts:259-263` 明确规定：从 logged-out 登录时，如果 live workspace 已经有数据，就**保留 live list**，不恢复 B 原本 parked workspace。

**结果：复用同一个 backend 在 A/B GitHub 账号之间切换时，B 可以继承 A 的 backend 数据；后续全量 push 又可能把 B 的状态覆盖回全局 backend。**

这会表现为：

- 登录成功但仓库/分类是另一个账号的数据。
- 切回账号后原工作区“不见了”或被后端状态覆盖。
- AI config、WebDAV、Embedding、Vector、分类/settings 同样没有后端账号命名空间。

**建议修复：**

短期必须在产品语义上二选一：

1. 明确 backend 是单 GitHub 账号实例：backend 记录 owner identity，切换到不同 GitHub user 时阻止自动 pull/push，并要求显式“重新绑定/替换后端工作区”；或
2. 真正实现多账号后端：所有同步表/setting/config 加 `account_id` namespace，API 从已验证 GitHub identity/绑定关系解析 account，而不是让客户端自由传 account id。

在完成其中一种之前，不应宣传“前端多账号 + 同一 backend 自动同步”为安全可用组合。

### P0-02 · autoSync 没有 auth/session generation，旧 pull 可跨账号提交

**状态：上一轮问题仍存在。**

`syncFromBackend()` 在 `autoSync.ts:293-302` 并行发起七类 fetch，但没有捕获：

- user id
- GitHub token identity
- backend API secret / backend URL identity
- monotonic auth generation

随后在多个 await 之后直接向 `useAppStore` 应用结果。代码处理了“fetch 期间本地仓库是否被编辑”，但这不是账号生命周期校验。

因此存在时序：

1. A 账号开始 backend pull。
2. 请求未返回时用户 logout / 登录 B / 更换 backend。
3. A 发出的旧请求返回。
4. 结果继续提交到 B 当前 live Store。

仓库其他业务已经出现 `useAuthSessionGeneration`，说明项目已经有正确方向；autoSync 尚未接入同一机制。

**建议修复：** 给每次 sync 捕获 immutable `SyncIdentity {authGeneration,userId,githubTokenHash,backendUrl,backendSecretGeneration}`，所有 await 后提交前执行 `isCurrent()`；logout、setUser、backend switch 必须 cancel/invalidate in-flight sync。

### P0-03 · logout 可触发空 full-sync；无 API_SECRET/dev backend 下可清空后端仓库

**状态：问题仍存在，但标准 Docker 部署的暴露面已经降低。**

触发链：

- `authSlice.ts:39-60` logout 会 park 当前 workspace，然后把 live repositories/releases/config 等切为空工作区。
- `autoSync.ts:770-806` 订阅这些引用变化，2 秒后执行 push。
- `pushToBackend():651-675` 从**当时 Store**读取 repositories 等并同步。
- `backendAdapter.syncRepositories()` 发送 `{repositories: [], isFullSync: true}`。
- `server/src/routes/repositories.ts:207-215` 对空 full-sync 执行 `DELETE FROM releases` + `DELETE FROM repositories`。

在标准 Compose 中，现在 `API_SECRET` 已经强制配置，logout 又会清本地 `backendApiSecret`，因此迟到 push 通常会 401；这是相较上一轮的重要缓解。

但 `server/src/middleware/auth.ts:14-21` 在直接运行且未设置 `API_SECRET` 时仍明确 fail-open，所以开发模式、裸跑 Server 或非标准部署仍可实际触发数据删除。

更根本的问题是：**logout 应当先停止/失效 sync session，再改变业务 workspace；不应该依赖“认证请求刚好失败”来避免删除数据。**

---

## 7. P1：生命周期、取消和持久化原子性

### P1-01 · 后端 auth restore 可覆盖并发手动登录

`autoSync.ts:197-202` 在 `backend.restoreAuth()` 返回后做了一次“当前仍为空 session”的检查，这是正确的；但之后 `206-207` 又 `await githubApi.getCurrentUser()`，并在 `209-210` 无第二次 identity 检查直接 `setGitHubToken/setUser`。

如果用户在 GitHub API 校验期间完成手动登录，旧 restore task 仍可覆盖新登录。

修复方式和 autoSync 相同：capture generation，最后 commit 前再次检查。

### P1-02 · 快速退出/崩溃存在“登出后旧登录复活”窗口

认证有两个持久层：IndexedDB 主 snapshot + synchronous auth mirror。

- `authSlice.logout()` 会同步清 auth mirror，然后通过 Store state change 等待正常 persistence。
- `storage.ts:127-141` 的主 snapshot 默认延迟约 1 秒写入。
- pagehide/beforeunload 虽然会 `flushPendingPersistSnapshot()`，但 `writePersistSnapshot()` 对 IndexedDB 是 fire-and-forget Promise，不等待落盘完成。
- `persistedState.ts:65-75` hydration 时规则是 **persisted IndexedDB credentials 优先于 auth mirror**。

因此在 logout 后、包含 null credentials 的新 snapshot 真正完成 IndexedDB 写入前，如果进程被强制结束/崩溃，旧 persisted snapshot 仍可能包含 user/token/backend secret。下次启动时空 mirror 不能覆盖旧 persisted credentials，旧会话可能重新出现。

建议：logout 对认证主 snapshot 做专用同步/可等待 tombstone 语义；hydration 遇到“mirror 明确已清除”的 generation/tombstone 时不能让旧 snapshot 获胜。

### P1-03 · Custom Discovery 取消后仍可能 publish 半成品

**状态：上一轮问题仍存在。**

`src/features/discovery/custom/runner.ts:165-172` 的外层 catch 为了保留已完成批次，把错误（包括 abort）转成 partial collection。`runChannels()` 在 `251` 收到结果后：

1. `254-260` 先执行 publish transaction，写 edition、cursor、recommended、lastRefresh。
2. `268` 才检查 `controller.signal.aborted`。

因此“停止任务”并不等于“不提交当前频道”。用户点击取消后仍可能看到新的推荐、游标前进或 lastRefresh 更新。

建议：把 timeout 与 user cancel 分开；user cancel 在 publish 前 `signal.throwIfAborted()` 并禁止 cursor/edition commit。若产品希望“保留已完成批次”，应显式保存为 `partial/canceled` checkpoint，不应伪装成一次正常 publish。

### P1-04 · AI Workbench 在 session patch 失败时可能永久留下 streaming message

`useAIWorkbench.ts:218-220` 顺序是：

1. 保存 user message。
2. 保存 `status: 'streaming'` 的 assistant reply。
3. `await patchSession(...)`。
4. 从下一行开始才进入负责终态保存的 `try/finally`。

如果第 3 步 storage/session patch 失败，reply 已落盘但不会进入 complete/error/aborted finalizer。重新加载历史后可能永久显示 streaming。

建议：将 message pair + session title patch 作为一个 storage transaction，或在任何持久化步骤之后都必须进入统一 finalizer/recovery。

### P1-05 · Repository Chat retry/regenerate 先永久删除旧回答再尝试发送

`useRepositoryChat.ts:357-373`：

- 先 `permanentlyDeleteMessages([lastUser.id,lastAssistant.id])`。
- UI 先移除旧 pair。
- 再 `send(lastUser.content, ...)`。

而 `send()` 自身有账号、配置、session 等前置 guard。若在删除与 send 之间账号/AI config/session 可用性变化，新发送可以不成立，但旧 pair 已不可恢复；关联 evidence/tool events 也会被删除。

建议改为 copy-on-write：先建立新 attempt，成功形成可持久化状态后再替换旧 attempt；或者保留 revision/history，不做 destructive retry。

### P1-06 · AGY 设置保存期间取消可导致“磁盘新值 / 内存旧值 / 调用方报取消”

`electron/agyDesktop.js:149-155` 先 `await persist(next, executable)`，之后才在 `!signal.aborted` 时更新内存 `prefs`。`agyQueue.js:32-34` 在 work 返回后又检查 signal，abort 会令调用方收到 `CANCELED`。

在 persist I/O 窗口取消时，可以产生：

- 磁盘已经写新 prefs。
- 内存保持旧 prefs。
- renderer 收到取消。

下一次重启又读取磁盘新值，用户会感到“刚才明明取消/失败了，重启后设置却变了”。

建议把 save 定义为不可中断的 atomic commit，或采用临时文件 + commit point，并明确 cancel 只对排队阶段有效。

### P1-DATA-01 · Release“全部已读”后端失败时回滚不完整

**状态：本轮新确认。**

`useReleaseTimelineActions.ts:110-123` 在点击“全部已读”时先乐观执行 `state.markAllReleasesAsRead()`，然后调用 backend；失败时 catch 只恢复 `readReleases` Set。

但 `timelineSlice.ts:242-256` 的 `markAllReleasesAsRead()` 同时还会修改每条 release：

- `release.is_read = true`
- 清空 `release.updated_asset_ids`

因此后端请求失败后会形成内部自相矛盾的状态：`readReleases` 被回滚，但 `releases[].is_read` 和资产更新 badge 已永久留在“已读”状态。之后 autoSync 还可能把这批错误的 `is_read=true` 再写向 backend。

**用户表现：** UI 提示“标记失败”，但部分未读/资产更新状态已经消失；刷新或后续同步后结果可能继续漂移。

建议在 optimistic update 前 snapshot 两个受影响 slice，catch 时完整回滚；更稳妥的是 Store 提供一个可返回 undo snapshot 的 command。

### P1-DATA-02 · “删除所有数据”没有真正删除所有应用数据

**状态：本轮新确认，High data-safety。**

`DataManagementPanel.tsx:338-377` 的 `clearAllStorage()` 只删除主 Zustand persistence key；`deleteAllData():1230+` 另外清理 Weekly/X/Telegram storage 和 X encrypted auth。

但至少两个当前核心独立数据库没有被删除：

- `repositoryChatStorage.ts:15-20` → `gsm-repository-chat-db`，包含 Repository Chat、Workbench sessions/messages/evidence/projects/proposals。
- `discovery/custom/storage.ts:3-8` → `gsm-custom-discovery`，包含自定义发现频道/edition/cache 等账号数据。

而 `deleteAllData()` 后面的 `useAppStore.setState()` 也只重置部分字段。它没有完整重置当前 persistence 已包含的 gists/starredGists、forks/readForks、Embedding、Vector、MCP、repositoryChatSettings、categoryListIdMap 等多个域。

由于 Zustand persistence 仍处于活动状态，清掉主 IDB 后再做“部分 setState”还可能把未清的内存字段重新写回主 persistence。随后页面 reload，并不能保证这些数据消失。

**用户表现：** 设置页显示“所有数据已删除”，重启后仍可能看到聊天/工作台历史、自定义 Discovery、Gist/Fork 或部分配置。

建议建立统一 `AppDataRegistry`：每个持久域注册 `clear/export/import/version`，Delete All 必须等待所有 registry entry 成功后才能提示成功和 reload。该行为需要真正 E2E 测试 IndexedDB database list/重新 hydration。

### P1-DATA-03 · WebDAV/JSON“备份”不是当前应用完整备份

**状态：本轮新确认，High data-safety。**

`useBackupActions.ts:72-103` 的 WebDAV backup 目前包含 repositories/releases/categories/order/AI/WebDAV/proxy/RPC/backend secret/release state 等，但没有覆盖当前 persistence 中的多项用户数据，例如：

- `gists` / `starredGists`
- `forks` / `readForks`
- `repositoryChatSettings`
- `categoryListIdMap`
- Embedding / Vector / MCP 等部分配置和状态
- `gsm-repository-chat-db` 中的 Chat / Workbench sessions、messages、evidence、projects、proposals
- `gsm-custom-discovery` 中的 Custom Discovery 数据

`DataManagementPanel.tsx:114-151,302-315` 的 JSON export schema/选项也只覆盖部分 Store 域，同样不是全量灾备。

如果产品文案把它称为“备份数据”或让用户依赖“覆盖所有当前数据”的恢复语义，那么恢复后会静默丢失上述域。

建议和 Delete All 共用同一 `AppDataRegistry` 与 versioned manifest；备份报告必须列出 included/excluded domains、数据条数和独立数据库版本，恢复前做 dry-run diff。

### P1-LIFE-01 · 探测不可达 backend 会把原本工作中的 backend 从内存清掉

**状态：本轮新确认。**

`useLoginActions.restoreBackendSession():42-56` 保存了 `previousUrl`，然后执行 `backend.init(candidate)`。错误 key 和 restore-failed 分支会重新 `init(previousUrl)`；但 **backend-unavailable 分支在 line 45 直接 return，没有恢复 previous URL**。

`backendAdapter.init():126-160` 探测失败会把 `_backendUrl = null`。

因此用户在登录页尝试一个暂时不可达/拼错的新 backend 地址后，当前进程里原本可用的 backend 也会丢失。随后 `syncTokenToBackend():32-40` 因 `!backend.isAvailable` 直接返回 `{ok:true}`，GitHub direct login 表面成功但 token/backend data 不再同步。

建议 candidate probe 使用临时局部结果，只有验证成功后才 commit `_backendUrl`；`init(candidate)` 不应通过“先破坏 current，再尝试恢复”的方式切换 endpoint。

### P1-SYNC-01 · autoSync 用“全局 dirty + 全 shard 覆盖写”，可跨设备覆盖并未修改的配置

**状态：本轮新增复核，High data-integrity。**

`autoSync.ts:651-675` 的一次 push 无论实际只改了哪个 slice，都会同时发送 repositories、releases、AI、WebDAV、Embedding、Vector 和 settings。与此同时，`server/src/routes/configs.ts:68-89` 的 config bulk sync 是“先 `DELETE` 全表、再按客户端 snapshot 重建”的 replace-all 语义。

本地变更检测却只有一个全局 `_hasPendingLocalChanges`。`syncFromBackend():263-271` 看到任意本地 dirty/debounce 就整轮不 pull；如果 pull 已经发出，期间又出现本地编辑，`311-340` 会优先保留本地状态并跳过同轮 AI/WebDAV/Embedding/Vector 等远端结果，然后安排后续 push。

因此存在稳定的 lost-update 时序：设备 B 更新 AI config；设备 A 还没拉到该变化时只编辑一个 repository；A 的 repo 变更令 pull 被抑制，但随后 push 会把 **A 的旧 AI config 一并 replace-all 写回 backend**，覆盖 B 的新配置。类似风险同样存在于 WebDAV/Embedding/Vector/settings shard。

建议把 dirty/push tracking 改为 per-shard revision，而不是一个全局布尔值；每个 shard 使用 backend revision/ETag/CAS 或 merge-aware mutation，只允许真正变更的 shard 写回。至少在 replace-all API 上增加 expected revision，冲突时先 pull/merge，不能 silent last-writer-wins。

### P1-SYNC-02 · 一次 backend push 失败后，auto-sync 可进入“既不重试也不再 pull”的停摆态

`pushToBackend():678-681,714-717` 在任一写入失败时会把 `_hasPendingLocalChanges=true`。`syncToBackend():620-627` 明确注释“失败留待后续 retry”，但循环条件只有 `_hasPendingPush || (succeeded && _hasPendingLocalChanges)`：一旦本次 `succeeded=false` 且没有新 pending push，函数就结束，也没有创建 retry timer。

之后每 5 秒的 `syncFromBackend()` 又会在 `263-271` 因 `_hasPendingLocalChanges` 直接 return。于是一次临时断网/5xx 后，客户端可能长期保持 dirty：既不自动重试 push，也不接受远端 pull，直到用户再次产生本地编辑、手动 force sync 或重启相关生命周期。

建议为失败写入建立带退避的 retry state，并区分 `dirty-local-shard` 与 `push-in-flight/failed`；pull 不应被一个永久 dirty flag 全局封死。

### P1-LIFE-02 · Settings“测试连接”失败只恢复 URL，不恢复候选 API secret

`useBackendSettingsActions.ts:95-120` 在探测前先执行 `state.setBackendApiSecret(secretInput || null)`。`authSlice.ts:33-38` 会立即把这个候选 secret 写入 sessionStorage、Store 和 localStorage auth mirror，主 persistence 也会随后保存。

如果 health/auth 校验失败，代码只 `backend.init(previousUrl)`，没有恢复此前的 backend secret。结果是：原 working URL 虽然回来了，但当前凭据已变成错误候选 key，后续请求会持续 401；reload 后错误 key 还可能从持久化恢复。

建议 candidate URL 与 secret 都使用临时 probe context；只有 health + auth 都成功后再一次性 commit URL/secret。失败时不得修改任何持久 credential。

### P1-LIFE-03 · backend.init 会清掉尚未发送的本地同步状态，也没有等待正在进行的 push

`autoSync.ts:63-73` 注册的 before-init hook 只 `await waitForInFlightSync()`（pull），随后直接清 `_hasPendingPush`、`_hasPendingLocalChanges` 和 2 秒 debounce timer；它没有等待 `_pushPromise`。

因此：

- 用户刚编辑完、本地 push 仍在 2 秒 debounce 内时点击 Test Connection/切 backend，timer 会被取消，dirty flag 也被清掉，这批改动可能从未发出；
- 若 push 已在进行，期间又产生 V2 edit，before-init 清掉 follow-up dirty/pending 后，当前 push 只携带旧 snapshot，新 edit 也可能没有后续发送机会。

backend 切换应先冻结新 mutation、等待当前 push drain，或把 pending shard snapshot 转移到新 generation；不能用“清 flag”代表已经同步完成。

### P1-GH-01 · Stars/Lists 拉取没有账号 generation，A 的迟到结果可写入 B

`useSearchActions.ts:519-613` 的 `syncStars()` 用调用开始时闭包中的 `githubToken` 创建 GitHub client，`await getAllStarredRepositories()` 后却在 `530` 读取**当前 Store** repositories，再在 `592` `setRepositories(finalRepositories)`，`593` 立即 `forceSyncToBackend()`。

函数没有像同文件 `keywordSearch():260-265` 那样在 await 后检查 `user.id/githubToken` 是否仍与启动时一致。若 A 的 Star/Lists 同步尚未返回时切到 B，A 的结果会和 B 当前 repo 合并，并写入 B workspace；Lists 模式还会根据 A 的 list 创建/映射当前 Store 分类，随后把污染状态推向 backend。

建议所有 GitHub 长任务统一使用 auth generation / captured user id/token fingerprint；每个远端 await 后、任何 Store/后端 commit 前都执行 stale check。

### P1-GH-02 · pushCategoriesToLists 同样缺少账号代次，迟到结果会污染当前 workspace 映射

`repositorySlice.ts:188-369` 在开始时只检查当前 token/user，然后经过 `getUserLists`、create/update list、resolve node ids、逐仓库更新等多次 await。整个过程没有重新验证账号 identity；最终 `:363` 无条件把 `nextCategoryListIdMap` 和完成状态写入**此刻的当前 Store**。

如果 A 开始 push 后用户切换到 B，远端写操作仍可能继续作用于 A（取决于传入的 `api`），但完成回调会把 A 的 list id 映射写进 B workspace。后续 B 的 Lists 操作就可能拿着错误的映射继续工作。

建议把 GitHub Lists push 建模为 account-scoped command：启动时捕获 `{generation,userId,tokenHash}`；账号切换立即 abort，所有远端写和最终 Store commit 都需要 identity guard。

### P2-DATA-01 · Stars + Lists pull 忽略隐藏的默认分类

`useSearchActions.ts:550-565` 注释说与 View 使用同样的 `getAllCategories` 四参口径，但实际第三参硬编码为 `[]`：

`getAllCategories(customCategories, language, [], defaultCategoryOverrides)`

`categoryHelpers.ts:35-43` 的第三参正是 `hiddenDefaultCategoryIds`。因此用户在本地隐藏某个默认分类后，Stars+Lists 同步仍会把该隐藏默认分类加入 list-name→category 解析集合，并可能重新把仓库映射到用户明确隐藏的分类语义中。

建议直接传当前 `hiddenDefaultCategoryIds`，并补一个“隐藏默认分类 + GitHub 同名 List”回归测试。

---

## 8. P1/P2：直接导致功能不可用的配置和跨运行时分叉

### P1-07 · Backend MCP 在当前 Vector Worker v2 下没有向量工具

**状态：上一轮仍成立；这是有意 fail-closed，但对用户而言仍是功能缺口。**

当前 Cloudflare Worker 是 generation-aware protocol v2。Browser `VectorSearchService` 和 Electron local MCP 都会携带 scope / active index identity。

Server `server/src/mcp/provider.ts:262-279` 明确说明 backend schema 不持久化 `activeIndex`，因此默认返回：

`vector_index_identity_not_synced`

只有显式设置 `GSM_MCP_LEGACY_VECTOR_WORKER_URL` 才会进入 legacy v1 路径，而且 provider `:452-453` 会拒绝 protocol v2。

结果：

- Browser Vector Search：可用 v2。
- Electron Local MCP：可用 v2 scoped vector tools。
- Backend/Docker MCP：当前正常 v2 配置下两个 vector tools 不可用，其余 repository/keyword tools 可用。

这不应通过放宽校验解决。正确方案是把 vector generation identity 纳入 backend schema/sync contract。

### P1-08 · 远程 backend 模式复制出的 MCP URL 指向错误主机

`McpSettingsPanel.tsx:50-61`：

- Electron local MCP 使用 loopback，正确。
- backendMode 直接返回 `window.location.origin`，随后拼 `/mcp`。

但 `backendAdapter` 明确支持独立的远程 backend URL，例如静态前端运行在 `https://app.example`，backend 是 `https://api.example/api`。

这种模式下设置页给 Agent 复制的 MCP 地址会是 `https://app.example/mcp`，并非实际 backend MCP 地址，属于**配置 UI 直接生成不可用值**。

同源 nginx/fullstack 部署不受影响。

### P1-09 · fullstack Compose 不透传 `CSP_CONNECT_SRC`

Server `index.ts` 支持通过 `CSP_CONNECT_SRC` 给 CSP `connect-src` 增加自定义 AI / Vector Worker origin，README 也公开了该配置。

但 `docker-compose.fullstack.yml` 当前只传：

- `API_SECRET`
- `ENCRYPTION_KEY`

没有传 `CSP_CONNECT_SRC`。

因此 fullstack Compose 用户即使在 `.env` 配了 `CSP_CONNECT_SRC`，变量也不会进入容器。只要 route mode 需要浏览器直连自定义 AI provider 或自定义 Worker，浏览器会被 CSP 阻断，看起来就是“配置正确但请求完全不能用”。

### P2-01 · Repository Chat 的“外部 Web 搜索和抓取”开关是可见但当前不执行的能力

`repositoryChatSettings.enableWebTools` 当前只出现在：

- schema / defaults
- tests fixture
- `AIConfigPanel.tsx` UI toggle

本轮全树搜索没有发现 Repository Chat runtime 读取该值并执行 web search/fetch；UI 文案本身也写着当前版本不会调用。

这是“已知未实现”而非隐藏 bug，但它容易被用户理解为开启后能联网。建议在功能真正接通前禁用 checkbox 或改成明确的 Coming/Unavailable 状态，不应让可交互 toggle 保存一个无效配置。

### P2-02 · 无鉴权本地 OpenAI-compatible 文本服务不能以空 API key 配置

`AIConfigPanel.tsx:208-211` 保存配置时要求 `form.apiKey` 非空；连接测试同样要求。`isAIConfigAvailable()` 也要求 HTTP AI config 的 `apiKey` 非空。

因此本地无需鉴权的 OpenAI-compatible endpoint 也必须填写 dummy key 才能使用。技术上可以绕过，但这是明显的本地模型兼容性/UX 缺口。建议增加 auth mode：`none | bearer | custom`。

### P2-03 · Cloudflare Worker 子项目在当前工作区不能直接执行 wrangler

`cloudflare-worker` 的 source / generated worker parity gate 本轮通过，说明代码本身一致；但在该子目录执行 `npm ls --depth=0` 显示：

- `@cloudflare/workers-types` missing
- `typescript` missing
- `wrangler` missing

这主要是本机 workspace 没在子目录执行 install，不属于产品 runtime bug，但会让“进入目录直接 `npm run dev/deploy`”当前不可用。建议在开发文档/根脚本明确 bootstrap，或纳入 workspace 管理。

---

## 9. 安全审查

### SEC-01 · Gemini Embedding API key 可通过 MCP 错误字符串泄漏

**严重度：High。**

Server：

- `server/src/mcp/provider.ts:327-330` 把 Gemini key 放在 query：`?key=...`。
- 非 2xx 时 `:365` 构造 Error 时包含完整 `url`。
- `:475-478` 把 `err.message` 写入日志并作为 `reason` 返回。
- `server/src/services/logSanitizer.ts:87-95` 只在整个字符串本身以 `http://` / `https://` 开头时调用 URL redact；`Embedding API error ... (gemini https://...?key=...)` 不满足该条件。

Electron local MCP `electron/mcpLocalServer.js:133,170-174,239-243` 有同构路径。

触发条件：Gemini embedding + MCP 向量调用 + 上游返回非 2xx。MCP 客户端可能直接看到包含 key 的 `embedding_failed` reason，Server log 也可能写入。

建议：永远不要把 credential-bearing URL 拼进 Error；Gemini 改为在错误中只记录 sanitized origin/path + provider/status。所有 error boundary 再做一次 URL query redaction。

### SEC-02 · Server Proxy 严格 SSRF 校验没有 DNS pinning，也没有 redirect revalidation

**严重度：Medium（标准 Compose 下调用需要 API secret，风险已受限）。**

`proxyService.ts:83-115` 对 URL literal hostname、loopback、RFC1918、IPv6 local、IMDS 做了不错的过滤；但 `117-175` 把 URL 交给 axios 时：

- 没有 resolve hostname 并校验实际 IP。
- 没有 pin DNS result。
- 没有 `maxRedirects: 0` 或对每次 redirect 重新验证目标。

因此 DNS rebinding / public name→private IP / redirect→private target 仍可能绕过 literal hostname check。

Plugin Web Search 已经有 DNS pinning 思路，可以抽共享安全 transport，而不是维护两套标准。

### SEC-03 · 标准 Compose 已改为 fail-closed，但裸跑 Server 没有 API_SECRET 仍关闭鉴权

**上一轮关键问题部分修复。**

现在 `docker-compose.yml` 和 `docker-compose.fullstack.yml` 都使用 `${API_SECRET:?...}` 强制 secret，这是明显进步。

但 `server/src/middleware/auth.ts:14-21` 仍规定：没有 API_SECRET 就直接 `next()`；Server 启动只打印 warning。因此 `node dist/index.js`、自定义 systemd、手写 docker run 等部署若忘记 secret 并对外监听，`/api` 会 fail-open。

建议生产启动默认 fail-closed；只有显式 `ALLOW_UNAUTHENTICATED_LOCAL_DEV=1` 且 bind loopback 时允许无鉴权。

### SEC-04 · 多类长期 secret 明文持久化在前端设备存储

`appPersistenceOptions.partialize()` 持久化：

- GitHub token
- backend API secret
- AI configs / Embedding configs / Vector auth
- MCP bearer token
- WebDAV credentials
- proxy username/password
- RPC secret

GitHub/backend auth 还会镜像到 localStorage。Electron proxy config 也使用普通 JSON 持久化。X cookie 已经迁移到 Electron `safeStorage`，说明已有正确先例。

对于单机个人工具，这不是“远端泄漏”本身，但一旦发生同源 XSS、恶意本地进程、浏览器 profile 泄漏，credential blast radius 很大。建议逐步引入统一 secret vault：Electron 用 `safeStorage`，Web 模式至少把 secret 生命周期与可导出的业务 snapshot 分离。

### SEC-05 · Electron IPC 基础 sandbox 健康，但来源约束还可以收紧

正向项：BrowserWindow 已使用 `nodeIntegration=false`、`contextIsolation=true`、`sandbox=true`；AGY/Plugin 的很多危险参数也有严格 schema/权限测试。

残余：

- preload 暴露的 API surface 较大。
- 大量 IPC handler 未统一校验 sender URL/origin。
- `setWindowOpenHandler` 直接 `shell.openExternal(url)`，main process 没有 scheme allowlist。
- `will-frame-navigate` 主要保护子 frame，没有对应的统一 main-frame navigation policy。

这些目前属于 hardening，不是本轮已复现的利用链。

### SEC-06 · Auth middleware 在 50MB JSON parse 之后执行

`server/src/index.ts` 先 `express.json({limit:'50mb'})`，再 `app.use('/api', authMiddleware)`；nginx 多处 `client_max_body_size 100m`。因此未认证请求也会先消耗 body 接收/JSON parse CPU/内存再返回 401。

建议对绝大多数 `/api` 路径先做 header auth，再挂大 body parser；确实需要大 body 的 route 单独提高 limit。

---

## 10. 架构与可维护性复核

### A-01 · sibling-feature 边界相比上一轮已经增强

上一轮发现 Discovery 直接进入 Repositories feature internals。当前 `scripts/check-boundaries.cjs:183-199` 已新增 `checkSiblingFeatureImports()`，会拒绝 feature→sibling feature 的相对内部 import；本轮 gate 通过。

因此旧的“sibling feature 没有任何门禁”应标记为**已修复/显著改善**。

### A-02 · View→Service gate 仍是手写 service whitelist，存在真实漏检

`check-boundaries.cjs:33-47` 只列出一小组 `BANNED_COMPONENT_SERVICES`，并不是禁止所有业务 service。

当前 gate 通过的同时，生产 View 仍直接 import：

- `AITaskPanel.tsx` → `aiTaskJournal`
- `CodeSearchView.tsx` → `grepAppService`
- `DataManagementPanel.tsx` → xTweet/telegram business services（同时也直接使用多个 storage wrapper）
- `AgyLocalResearch.tsx` → `localResearch` / `agyClient`
- `PluginRegistrySection.tsx` → `pluginRegistryService`

这里需要按 ADR 0001 精确区分：`repositoryChatStorage`、`weeklyIssuesStorage`、`indexedDbStorage` 这类**纯本地域持久化 wrapper**已经被 ADR 明确定义为 infrastructure，View import 它们本身不是当前规则的业务层违规；logger/electronProxy 同样是 infrastructure carve-out。真正需要门禁的是 grep.app 远端调用、AGY/Local Research 编排、X/Telegram service、Plugin Registry bridge、以及同时承载 task control 的 `aiTaskJournal` 等业务能力。

因此 `check:boundaries` 通过不能解释为“View 层已彻底无业务 service”。应把规则改成**默认禁止 `src/components/** -> src/services/**`，只维护由 ADR 明确定义的极小 infrastructure allowlist**，而不是维护不断过期的 business-service denylist；如果未来 infrastructure 例外继续增长，最好把它们物理迁到 `src/infrastructure/**`，进一步减少分类歧义。

### A-03 · Store→Service 逆向依赖仍存在

当前仍可看到：

- `src/store/types.ts` import `GitHubListsApiService` concrete type。
- `src/store/schema.ts` import `vectorSearchService` / `vectorIndexIdentity`。
- auth slice import `autoSync.resetSyncHashes`。

这使 Store 不再是纯状态底层，而逐步知道 service/runtime 实现。建议把纯类型、normalizer、index-version constants 提升到 shared/domain contract；远端 IO orchestration 留在 hooks/services。

### A-04 · 跨运行时 MCP 仍是双轨实现

Electron local MCP 与 Server MCP 都实现 repository discovery/evidence/vector，但 vector generation identity 只在 browser/Electron 链路完整。这已经直接形成 P1-07 的能力不等价。

建议抽出运行时无关的 MCP domain contract：tool definitions、argument validation、repo projection、vector identity、error codes 共用；Server/Electron 只负责 transport/credential/storage adapter。

### A-05 · IPC contract 仍有多份手写来源

Electron main 注册 channel、preload expose API、renderer `electronProxy`/types 各自维护契约。AGY/Plugin/MCP 增长后同步修改成本越来越高。

建议建立一个 schema/type map 生成或静态约束 main/preload/renderer 三端。

### A-06 · God modules 仍是主要修改热点

重点仍包括：

- `src/services/aiService.ts`
- `src/services/githubApi.ts`
- `src/services/repositoryChatService.ts`
- `src/services/repositoryChatStorage.ts`
- `src/services/aiWorkbenchService.ts`
- `src/components/SearchBar.tsx`
- `src/components/settings/DataManagementPanel.tsx`
- `server/src/routes/proxy.ts`
- `electron/main.js`

建议保持现有 public facade，内部按 provider/transport/retrieval/evidence/persistence/command 拆分，避免大面积改调用方和加剧 upstream merge 冲突。

---

## 11. AI 能力复核

### 11.1 上一轮已改善的点

以下旧问题不应继续原样列为当前缺陷：

- **Workbench 多查询候选偏置**：现在有 `fuseQueryCandidates()`，并将验证目标扩展到 `verifyCount * 2`，失败验证不会直接吃掉全部成功名额。旧 F08 已明显改善。
- **Agent `ready_to_answer` 丢 missing**：当前主循环在遇到 `ready_to_answer` 时会调用 `dispatchToolCall()`，`missing` 能写入并传给 `synthesizeVerifiedAnswer()`。旧 F13 的这条逻辑已修。
- **Gist 账号/取消生命周期**：当前 `useGistActions` 已有 `analysisGeneration`、controller 集合和 identity 检查，较旧实现有明显加强。仍需处理 lint warning，但旧“完全没有生命周期控制”已经不成立。
- **Node localStorage 测试假失败**：已修，见 §3.3。

### 11.2 仍存在的能力边界

- Repository Chat Web Tools UI toggle 尚无 runtime。
- HTTP AI config 把 non-empty API key 当成可用性的必要条件。
- Workbench candidate verification 仍主要依赖 README；对 README 不可用项目会标记 insufficient，这是保守行为，但意味着它不是通用源码/官网深研工具。
- 多仓库研究有明确 batch/预算上限；本轮进一步复核 `aiWorkbenchService.ts:722-891` 后确认当前实现**已经显式生成 `coverage`、pending batches 与 per-repository missing**，最终 prompt 也要求说明未研究/不完整仓库。因此旧的“未向用户表示覆盖范围”不应再作为当前缺陷；后续应把这个 contract 保持为回归门禁。
- Backend MCP vector 不具备 v2 identity，是跨运行时能力缺口而不是模型问题。

---

## 12. 性能与资源使用

### PERF-01 · 构建体积仍偏大，但当前预算 gate 通过

本轮 `dist`：

- 630 files
- 总体约 **22.28 MiB**
- 159 font files，约 **2.93 MiB**
- legacy entry **1505.9 KiB**
- modern index **1288.9 KiB**
- syntax highlight `github.min` ~948 KiB
- Mermaid core ~694 KiB
- Cynefin ~679 KiB
- MarkdownRenderer ~394 KiB

这不是一次页面必然全量下载量，因为有 code splitting 和 modern/legacy 双构件；但资源面仍很大。

Vite 还警告 Custom Discovery 的 `store.ts` / `analysis.ts` 同时被 dynamic + static import，因此 `AITaskPanel` 中的 dynamic import **不会真正把这些模块切成独立 chunk**。

### PERF-02 · persistence 仍在主线程 stringify 整个大状态

`storage.ts:58` 对完整 persist value `JSON.stringify()`，然后才异步写 IndexedDB。代码自己已经有 >50ms 警告以及“large state stringify 导致 V8 JIT assertion”的历史注释。

随着 repositories、releases、accountWorkspaces、配置继续增长，多账号会进一步重复 snapshot 数据。建议：

- repository/release 等大集合独立 IDB store，按 account/shard 更新。
- Zustand persistence 只保存轻量 indexes/settings。
- 删掉 persisted snapshot 内的大量可再派生字段。

### PERF-03 · 5 秒全量 backend polling 成本过高

真实浏览器已经观察到未登录页也持续 poll 7 个 endpoint。单客户端约每分钟几十个 GET，加上部分 CORS preflight；多个窗口/设备会线性放大。

建议至少：

- 未认证/无 backend session 不 poll。
- document hidden 时退避。
- 最近无本地/远端变化时指数退避。
- 长期改 revision/ETag/stream event，而不是每 5 秒全 shard pull。

### PERF-04 · RepositoryGroups 等 grouped path 仍有 N×M 扫描

普通 RepositoryList 已使用 50 条增量渲染，这是正向优化；但 grouped view 仍有每组 filter / member lookup 类操作。千级 Star + 大量分类时需要实际 profile，再决定 memo index 或 virtualization。

---

## 13. 历史问题重新核对

| 上一轮问题 | 本轮状态 | 说明 |
|---|---|---|
| Node 25 `localStorage` 导致 67 假失败 | **已修复** | 2091/2091 通过；仍有 Node warning 和版本未 pin |
| split Compose 允许空 `API_SECRET` | **已修复** | 两个 Compose 均使用 `${API_SECRET:?…}` |
| bare Server 无 secret fail-open | **仍存在** | 非标准部署仍需修 |
| autoSync logout 空 full-sync | **仍存在，标准 Compose 有认证缓解** | 根本生命周期问题未修 |
| autoSync 跨账号迟到 pull | **仍存在** | 未接 auth generation |
| auth restore 并发覆盖 | **仍存在** | `getCurrentUser()` 后无二次检查 |
| Custom Discovery cancel 仍 publish | **仍存在** | publish 在 aborted check 前 |
| Workbench stranded streaming message | **仍存在** | patchSession 位于 finalizer try 之前 |
| AGY save cancel 磁盘/内存分叉 | **仍存在** | persist 后才检查 signal |
| Chat retry/regenerate 先删历史 | **仍存在** | destructive retry |
| Backend MCP vector v2 identity 缺失 | **仍存在** | 有意 fail-closed，实际能力分叉 |
| View→Service boundary gate 漏检 | **仍存在，但 sibling-feature gate 已增强** | denylist 仍不能覆盖新 service |
| sibling feature internals 无门禁 | **已改善/修复** | 新增 `checkSiblingFeatureImports()` |
| SearchBar CRLF / `git diff --check` | **仍存在** | 当前整文件报告 trailing whitespace |
| Workbench 多查询候选验证偏置 | **明显改善** | query fusion + replacement verification |
| Agent `ready_to_answer` missing 丢失 | **已修复** | 现在经过 dispatcher |
| Gist 无取消/账号代次 | **显著改善** | generation + controllers 已加入 |
| `worker.js` 是重复人工实现 | **不是问题** | 是生成 artifact，有 parity gate |

---

## 14. 推荐修复顺序

### 阶段 0：先恢复可信开发基线

1. 修当前 7 个 typecheck errors。
2. 修当前 lint 44 errors / 10 warnings，至少让 CI 的 lint/typecheck 重新变绿。
3. 统一 `SearchBar.tsx` 行尾，恢复 `git diff --check`。
4. 固定 Node 24（`.nvmrc`/`.node-version` + package `engines`）。

这一阶段不改变产品行为，只是重新建立“失败就是回归”的信号质量。

### 阶段 1：账号/同步数据完整性

1. 定义 backend 是 single-account 还是 multi-account；不要继续保持当前混合语义。
2. 给 autoSync 引入统一 `SyncIdentity + generation + AbortController`。
3. login/backend restore 顺序改为：验证 identity → 建立账号上下文 → 再 pull 对应 namespace。
4. logout 先 invalidate/stop sync，再切空 workspace；禁止 auth-independent empty full-sync。
5. 给 logout persistence 增加 durable tombstone/generation，防 stale IDB credential 赢过已清 mirror。
6. backend candidate probe 改为先验证后 commit，失败不能破坏当前 working backend。
7. autoSync 从“全局 dirty + 全 shard replace-all”改为 per-shard dirty/revision；未修改 shard 不得被 stale snapshot 覆盖。
8. backend push 失败增加 bounded backoff retry/recovery，不能让 dirty flag 永久阻断 pull。
9. Test Connection 对 URL + API secret 做事务式 candidate probe，失败必须同时回滚且不得持久化候选 secret。
10. backend init/switch 必须 drain 或转移 pending push，不能直接清 debounce/dirty flag。
11. Stars/Lists 等 GitHub 长任务统一接入 auth generation；账号切换后所有旧任务停止远端后续写和本地 commit。

### 阶段 2：取消与事务语义

1. Custom Discovery：cancel 不 publish；partial checkpoint 显式建模。
2. Workbench：message + session patch 原子化/统一 finalizer。
3. Chat retry/regenerate：non-destructive revision。
4. AGY settings：明确 atomic commit point。
5. Release mark-all-read：完整 snapshot/rollback `readReleases + releases`。

### 阶段 2.5：数据管理语义

1. 建立统一 `AppDataRegistry`，让主 Store、Repository Chat/Workbench DB、Custom Discovery DB、Weekly/X/Telegram storage 都实现统一 `clear/export/import/version` contract。
2. 重写“删除所有数据”为 registry transaction，任何域未清理成功都不能提示成功。
3. WebDAV backup 与 JSON export 复用 registry manifest，明确 included/excluded domains，并覆盖 Gist/Fork/Chat/Workbench/Discovery/Embedding/Vector/MCP/categoryListIdMap 等当前数据。
4. 恢复流程先 dry-run + schema validation，再原子应用；恢复报告列出未支持域。

### 阶段 3：直接不可用的部署/协议路径

1. Backend schema 同步 Vector `activeIndex` identity，使 Server MCP 正常支持 Worker v2。
2. MCP Settings 使用实际 backend origin，不用 `window.location.origin` 猜测。
3. fullstack Compose 透传 `CSP_CONNECT_SRC`。
4. Web Tools 在实现前禁用 UI；实现后补真正的 tool permission/budget。
5. AI config 增加 `authMode:none`，正式支持无鉴权本地 endpoint。

### 阶段 4：安全收敛

1. 立即修 Gemini MCP error key leak。
2. Proxy 引入 DNS resolve + pin + redirect revalidation。
3. Server production auth 默认 fail-closed。
4. 逐步把长期 secret 从通用 Zustand snapshot 移到 secure vault。
5. 收紧 Electron external URL scheme 和 IPC sender policy。
6. 升级 `morgan` 到修复版本。

### 阶段 5：架构和性能

1. boundary gate 改成 default-deny service import + infra allowlist。
2. 去掉 Store→Service concrete imports。
3. MCP/IPC contract 单一来源。
4. 大 service 保持 facade，内部渐进拆分。
5. 拆 persistence shard，降低整状态 stringify。
6. 收敛字体、Markdown/Mermaid heavy chunks、无效 dynamic imports；大库再做 grouped virtualization/profile。

---

## 15. 必须补充的回归测试

当前测试数量很多，但缺少最重要的**组合状态**。建议把下面用例作为修复 PR 的硬 gate：

### 账号 / Sync

- A backend 数据存在 → logout → 登录 B：B 不得看到 A repo/config/settings。
- A pull in-flight → 登录 B → A response 到达：不得提交。
- A pull in-flight → backend URL/secret 切换：旧 response 不得提交。
- logout 后 2 秒内：不得发 empty full-sync。
- logout 后模拟 force-kill，再 hydration：旧 credential 不得复活。
- backend auth restore 在 `getCurrentUser()` pending 时手动登录 B：restore 不得覆盖 B。
- 当前 working backend 存在时探测一个不可达 candidate：失败后 working backend 必须保持可用。
- 设备 B 更新 AI/WebDAV 等 config，设备 A 只编辑 repo 且仍持有旧 config：A 的 push 不得覆盖 B 未被 A 修改的 shard。
- backend push 临时失败一次后，不产生新的本地编辑：客户端必须自动重试/恢复，并继续接受后续 pull，不能永久 dirty-blocked。
- Settings Test Connection 输入错误 API secret：失败后 previous URL、secret、sessionStorage/auth mirror/持久化都保持原 working 值。
- 本地 edit 已进入 2 秒 debounce 后立即 Test Connection/切 backend：edit 必须最终发送或显式保留为 pending，不能静默丢失。
- A 的 `syncStars` fetch pending 时切到 B：A 结果不得修改 B repositories/categories，也不得触发 B/backend force sync。
- A 的 `pushCategoriesToLists` 任一 await pending 时切到 B：A 任务应 abort，B 的 `categoryListIdMap`/进度状态不得被旧任务提交。

### Discovery / AI / Chat

- Custom Discovery 在 collect 完成部分 batch 后 cancel：不得写 edition/cursor/recommended/lastRefresh。
- Workbench `saveMessage(streaming)` 成功、`patchSession` 失败：恢复后不得有永久 streaming。
- Chat retry 删除前后模拟 AI config/account 失效：旧消息仍可恢复。
- AGY persist pending 时 cancel：磁盘/内存/返回状态必须一致。
- Release mark-all-read 的 backend 调用失败：`readReleases`、`releases[].is_read`、`updated_asset_ids` 全部恢复原值。
- Stars+Lists 同步时隐藏默认分类：同步后不得重新使用该隐藏分类。

### 数据管理 / 灾备

- “删除所有数据”后重新打开数据库并 reload：主 Store、Gist/Fork、Chat/Workbench、Custom Discovery、Weekly/X/Telegram、secret/config 均为空或回到安全默认值。
- 删除流程任一独立 DB 失败：UI 不得提示“所有数据已删除”。
- WebDAV/JSON backup round-trip：对每个注册 domain 做数量/hash 对比，不能只测 repositories/releases。
- 备份旧版本恢复：manifest 必须报告不支持/迁移的 domain，不能静默丢数据。

### MCP / 部署

- remote frontend origin ≠ backend origin：设置页生成的 MCP URL 必须命中 backend。
- fullstack Compose 注入 `CSP_CONNECT_SRC` 后 container env 和 CSP header 都包含 origin。
- Server MCP + Worker v2：vector tools 有 scoped generation identity，不得走 unscoped fallback。
- Gemini embedding 返回 4xx/5xx：response reason 和所有日志均不得包含 API key。
- Proxy DNS resolves to loopback/private 或 redirect 到 private：必须拒绝。

### 工程

- CI 运行 Node 24，本地版本文件同样 pin 24。
- `typecheck`、`lint`、`diff --check` 必须恢复为强制全绿。
- boundary fixture 增加“新建任意 `src/services/newBusinessService.ts` 后 View import 必须失败”，避免继续依赖 denylist 漏检。

---

## 16. 本轮没有做的破坏性/高成本验证

为了不修改用户真实数据或消耗真实额度，本轮没有：

- 使用真实 GitHub PAT 去 star/unstar、批量 Lists 写入或切换真实账号做破坏性验证。
- 调用真实付费 AI provider 做大规模 generation/eval。
- 重跑会消耗 AGY generation budget 的真实业务评测脚本。
- 写入真实 WebDAV、RPC downloader、Cloudflare Vectorize 资源。
- 改动用户现有 252 条工作树记录。

这些场景不能因此标记为“已验证可用”。报告中的判断分为代码/contract 已验证、真实浏览器只读已验证、以及需要真实环境 E2E 的边界。

---

## 17. 最终判断

项目不是需要推倒重来。当前测试体系、Electron sandbox、Plugin Host、AGY 隔离、Vector generation fail-closed、i18n/gate 等基础都已经相当扎实；这也是为什么 2000+ 测试能全绿。

但现在最关键的问题位于测试没有充分覆盖的边界：**账号 identity、backend namespace、异步生命周期、取消提交、跨运行时 capability parity**。这些问题会让用户遇到“按钮存在但不可用”“登录成功但数据不对”“取消了仍写入”“Docker 和 Electron 同名能力表现不同”等比普通 UI bug 更难理解的故障。

建议下一轮直接从 P0-01 ～ P0-03 开始修，不先扩展新功能。只要账号/同步生命周期收敛，后续 Discovery、AI Workbench、MCP 和多设备同步的很多异常都会一起变得更容易定位和验证。

---

## 18. 逐问题最优解决方案设计（结合当前代码）

本节不是把前文“建议修复”换一种说法，而是按当前仓库已有抽象、数据模型和运行时约束，给出可以真正落地的目标设计。这里优先选择**能同时消除一类问题**的方案，而不是在每个调用点追加一次性的 `if`、timeout 或 rollback。

### 18.0 先统一几个修复原则

后面的方案都建立在以下原则上：

1. **身份必须是显式数据，而不能靠“当前 Store 恰好是谁”推断。** 所有跨 `await` 的远端任务都必须绑定启动时的 account/session generation；所有 backend 数据都必须绑定明确 account namespace。
2. **探测和提交必须分离。** Backend URL、API secret、AI endpoint、Vector generation 等配置都应该先在 candidate context 中完成验证，成功后一次性 commit；验证失败不能先破坏当前 working state 再“尽量恢复”。
3. **取消语义必须有线性化 commit point。** 在 commit point 前取消 = 什么都不落盘；commit point 后 = 操作成功并返回成功，不能出现“磁盘已写但调用方收到 canceled”。
4. **同步必须按 shard/version 工作。** 当前“任一字段变动 → 全量推所有 shard”的设计是多设备覆盖的根源。目标状态是 dirty shard、remote revision、CAS/conflict 都显式化。
5. **异构持久化不能假装成一个事务。** Zustand snapshot、独立 IndexedDB、Electron safeStorage、WebDAV 无法组成真正 ACID transaction；Delete All / Restore 应采用可验证、幂等、可重试的 registry saga，并诚实报告部分完成状态。
6. **安全边界默认 fail-closed。** 身份未知、Vector generation 未知、Server secret 缺失、URL 解析不确定、IPC sender 不可信时，应拒绝而不是自动降级到“可能能用”。
7. **优先复用仓库已经证明有效的模式。** `useAuthSessionGeneration`、Repository Chat 的 multi-store IndexedDB transaction、Custom Discovery lease/revision、Vector generation staged publish、Electron `safeStorage` 都是现成的正确方向，应抽象复用而不是另造一套语义。

### 18.1 工程基线问题：TypeScript / ESLint / Node / diff hygiene

#### 18.1.1 对应 §3.1：7 个 TypeScript TS6133

**最优方案不是关掉 `noUnusedLocals`，而是把当前工作树恢复到“typecheck 是真实发布门禁”的状态。** 这些错误都属于新 Custom Discovery 开发中的未收口引用，应该直接删除未使用 import/local，而不是通过 `_unused`、全局 `skipLibCheck` 或降低 TS 严格度掩盖。

具体落点：

- `CustomChannelEditionPicker.tsx` 删除不需要的 `React` namespace import；当前 JSX runtime 已不要求它。
- `CustomChannelEditor.tsx` 删除未使用的 `React` / `Check`，并重新判断 `isMinStarsLimited` / `isMaxStarsLimited` 是“逻辑漏接”还是“历史残留”。如果 UI 原本应利用这两个变量控制 min/max star 状态，则应把它们接入真实 disabled/help copy，而不是简单删变量；只有确认产品逻辑不需要后才删除。
- `CustomChannelUI.tsx` 的 `getEditionKey` 同理：若 edition identity 应由 UI 使用，应补调用；若当前 identity 已由 Store 层处理，则删除 import。
- `store.editions.test.ts` 删除未使用 mock，测试只保留真实断言依赖。

修完后建议新增根脚本 `verify`，串行执行 `typecheck + lint + check:boundaries + check:i18n + check:plugin-registry + check:vector-worker + test:run + build`，让开发者本地有与 CI 同语义的一键入口。不要让 `vite build` 成功继续被误解为 TypeScript 合格。

#### 18.1.2 对应 §3.2：ESLint 44 errors / 10 warnings

这里要区分“测试便利写法”和“生产代码生命周期 warning”。推荐按类型修，而不是 blanket `eslint-disable`：

- 测试中的 `no-explicit-any`：建立 typed fixture builder / mock interface，例如从真实 service type 用 `Pick<>`、`MockedFunction<>` 推导，避免每个测试复制 `as any`。
- `AIWorkbench.tsx` hook dependency：不要为了消 warning 机械把巨大对象塞进 dependency array；先把稳定 command 用 `useCallback` / selector 拆出来，使 dependency 代表真正的输入边界。
- `useGistActions` mutable-ref cleanup warning：effect 创建时把当前 controller/ref 值捕获到局部常量，cleanup 只操作该次 effect 所属实例，避免 cleanup 误伤后续 generation。
- `RequirementsEditor` 的无意义 escape 和 `repoSearch.ts` 的 any 直接按类型事实收敛。

当 warning 清零后把 CI lint 改为 `eslint . --max-warnings=0`。这样 warning 不会长期堆积成下一轮“功能能跑、门禁不绿”的债务。

#### 18.1.3 对应 §3.3：Node 版本漂移与 `--localstorage-file` warning

当前 CI 明确用 Node 24，但根项目没有版本文件，且 `server/Dockerfile` / `Dockerfile.fullstack` 仍使用 Node 22，根 `@types/node` 又是 26.x。最优方案是把**开发、CI、Docker、类型定义**统一到同一 LTS major：

- 增加 `.nvmrc` 与 `.node-version`，内容固定 Node 24；
- 根 `package.json` 增加 `engines.node`（24.x）并把 `@types/node` 对齐 24 major；
- GitHub Actions 从版本文件读取 Node，而不是在 workflow 再写一份 `'24'`；
- `server/Dockerfile`、`Dockerfile.fullstack` 的 build/runtime base image 同步到 Node 24；
- 增加一个轻量 toolchain gate，输出并校验 Node major，使“本地 25 / CI 24 / Docker 22”这种三轨状态不能再次出现。

Node 25 的 `localStorage` 假失败已经由 `src/test/setup.ts` 修复，不应撤销该兼容层；版本 pin 的目的不是“靠旧 Node 绕过 bug”，而是让发布工具链可复现。

#### 18.1.4 对应历史项：`SearchBar.tsx` CRLF / `git diff --check`

最优方案是从仓库策略消灭行尾漂移，而不是只手工改一次 `SearchBar.tsx`：

- 新增 `.gitattributes`，至少对 `*.ts` / `*.tsx` / `*.js` / `*.jsx` / `*.md` 固定 `text eol=lf`；
- 配合 `.editorconfig` 固定 `end_of_line = lf`、`trim_trailing_whitespace = true`；
- 只对当前已知文件做一次有边界的行尾归一化，不全仓 format，避免污染用户已有 250+ 条改动；
- CI 增加 `git diff --check`，使以后同类问题在 PR 阶段失败。

### 18.2 P0-01：前端多账号 vs 后端全局工作区

这是所有同步问题里最应该先改的数据模型。**长期最优解是后端真正 account-aware；短期 containment 才是强制 single-account。** 因为前端已经有 `accountWorkspaces`、用户也已经能切 GitHub 账号，长期继续维持“前端多账号、后端单账号”只会让更多配置域继续串用。

进一步回查 `accountWorkspace.ts` 后还需要把问题定义得更严格：当前前端 `AccountWorkspace` 只 park repositories/gists/releases/forks/category/list 等域，**AI/WebDAV/Embedding/Vector 等配置仍然是 live/global state**，但 autoSync 又会把这些配置推到 backend。因此“前端已经完全按账号隔离”也并不准确。修复时必须先定义一个唯一 `AccountScopedSyncState`：凡是会同步到账号 backend、且语义上属于某个 GitHub 工作区的数据，都进入 account scope；真正 instance/device-global 的 MCP、proxy、RPC、桌面 executable 等则明确进入 `ServerSettings/DeviceSettings`，不能继续混在同一个同步平面里。

推荐分两阶段落地：

**阶段 A：先阻止继续串账号。** Backend 记录当前绑定的 verified GitHub account id。登录新账号时，如果 backend 已绑定另一个 id，禁止自动 pull/push，UI 明确要求“切换/迁移 backend workspace”。这一步可以在数据库大迁移前先消除 P0 数据污染。

**阶段 B：正式引入多账号 backend schema。** 新增 `accounts` 表，例如保存 verified `github_user_id`、login、encrypted GitHub token、created/updated time，以及一个不可猜测的 opaque `workspace_key`；所有 account-scoped 同步表增加 `account_id`：repositories/releases/categories/AI/WebDAV/Embedding/Vector/account settings 等。`settings` 主键从 `key` 变成 `(account_id,key)`；客户端生成 id 的 config 表也必须把 account 纳入唯一约束。MCP service 配置、server proxy/RPC 等真正实例级数据则迁到独立 `server_settings`，不要为了“统一”错误地复制到每个 GitHub 账号。

账号绑定不能信任客户端随便传一个 numeric `account_id`。推荐新增 `/api/accounts/bind`：客户端提交 GitHub token，Server 自己调用 GitHub `/user` 验证，得到真实 numeric user id 后才存入 accounts，并返回 opaque `workspace_key`。此后同步请求携带例如 `X-GSM-Workspace` 的 binding，middleware 在 API_SECRET 认证之后解析成内部 account；GitHub proxy/auth restore 也从该 account 行读取 token，而不是读取全局 `settings.github_token`。这样客户端即使篡改一个公开 GitHub id，也不能跨 namespace 查询另一个账号。

现有数据库迁移尤其要避免“migration 时联网”。当前 `server/src/db/migrations.ts` 是同步 SQLite transaction，不应在 migration 里调用 GitHub。推荐把已有全局数据迁到一个 `legacy-unbound` workspace；下一次用户用已验证 token 连接时，UI 显式询问是否把 legacy workspace claim 给该账号，然后在一个 DB transaction 中把所有 legacy rows 绑定到 verified account id。**不要静默猜测历史数据属于哪个账号。**

登录顺序也要同步改为：`validate token → bind/resolve backend account → setAuthenticatedSession(user,token) → restore该 account workspace → pull该 namespace`。当前 `LoginScreen.tsx` 的“先 pull 再 setUser”必须删除。

验收标准：A/B 两账号可以在同一个 backend 共存；任意表查询都必须带 account context；切账号后 backend repo/config/settings 都不串；历史单账号数据库可以明确 claim 且不会静默丢数据。

### 18.3 P0-02：autoSync 缺少 session generation

现有 `useAuthSessionGeneration` 已经证明了 generation guard 的方向，但它是 React hook，`autoSync.ts` 这种 service 无法复用。最优方案是把“当前 session generation”提升成**非 React 的运行时事实**，hook 只做薄封装。

推荐把 generation 放到一个**非 React、非持久化的 process-wide `SessionContext`**，每次 `establishSession`、logout、token 替换都递增 `authEpoch`；Backend connection runtime 维护独立 `backendEpoch`，每次真正 activate 新 URL/secret/workspace binding 时递增。React 的 `useAuthSessionGeneration` 变成这个底层 epoch 的薄封装，而不是每个 hook 自己维护一套局部时钟。`SyncCoordinator` 捕获：

`SyncIdentity = { authEpoch, accountId, backendEpoch, workspaceKey, targetId }`

不需要保存 token hash；generation 本身就是“凭据是否还是同一代”的判断，避免把 token 衍生物扩散到日志和测试。

同时不要让 in-flight task 在每次 fetch 时重新读取全局可变的 `_backendUrl` / current secret。BackendAdapter 应能创建一个不可变 `ScopedBackendClient {baseUrl, credential, workspaceKey, epoch}`；一次 pull/push 捕获 client 后全程只使用它。否则旧任务即使带旧 generation，也可能在 backend switch 后把后半段请求意外发向新目标。

随后给 scoped client 的 fetch/sync 方法增加 `AbortSignal`，`SyncCoordinator` 为每一代维护 AbortController。logout、账号切换、backend activate 时先 `invalidate()`：epoch 递增并 abort 所有旧请求。**每一个 await 后、每一次 Store/后端副作用前仍要做 `isCurrent(identity)`，AbortController 只是尽快停止 IO，不是唯一正确性保证。** 同账号 logout→relogin 即使 user id/token 值刚好相同，epoch 也不同，因此旧请求仍会被拒绝。

这样 Fork/Discovery/Stars/autoSync 使用的是同一个会话时钟，不会出现“每个 feature 都认为自己当前”的多套真相。

### 18.4 P0-03：logout 空 full-sync

只靠“logout 清 secret，所以 push 多半 401”不是修复。目标设计应保证 logout 在语义上**根本不会产生业务数据同步事件**。

推荐把 logout 从 Store 内部动作拆成 lifecycle command：

1. `SyncCoordinator.invalidateAndStop()`：同步地取消 debounce、poll、in-flight pull/push 的后续 commit，并递增 generation；
2. park 当前 account workspace；
3. 清 user/token/backend credential mirror；
4. 把 live workspace 切为空；
5. 后续只有新 authenticated + bound account 建立后才重新 start sync。

这也能顺便消除 `authSlice.ts` 直接 import `autoSync.resetSyncHashes` 的 Store→Service 逆向依赖。

Server 端还应该再加第二道保险，但**不能简单禁止空数组**：真实 GitHub 账号完全可能合法拥有 0 个 Star。正确做法是让 destructive replace 必须同时具备已验证 account binding、当前 generation 和匹配的 `baseRevision`/CAS；只有来自该账号的完整、已验证 snapshot 才允许把 repository shard 替换为空。匿名 workspace、stale generation 或 revision 不匹配的空 snapshot 一律拒绝。长期普通 background sync 应走 per-shard revision/CAS，不再靠“空数组本身”判断删除是否合法。

### 18.5 P1-01：backend auth restore 覆盖并发手动登录

不要只在 `getCurrentUser()` 后再补第二个 `if`；更好的做法是把 login/restore 都放进一个 `AuthCoordinator`：每次 manual login 启动都会使旧 restore generation 失效。restore 捕获 auth generation，并在 `restoreAuth()`、`getCurrentUser()` 后都检查；最终通过单个 `setAuthenticatedSession({user,token})` 原子写入，而不是先 token 后 user 两次 Store mutation。

手动登录优先级高于后台 restore：一旦用户开始手动登录，当前 restore controller 立即 abort。这样 UI 不会出现“我刚登录 B，几百毫秒后又跳回 A”的竞争。

### 18.6 P1-02：logout 后旧 credential 复活

问题本质不是“IndexedDB 写得慢”，而是当前 hydration 无法区分“mirror 缺失”与“用户明确撤销凭据”。最优方案是把 auth mirror 从可删除缓存改成**带单调 revision 的显式 tombstone**。

建议 `AuthMirror` 改为：`{ revision, user, githubToken, backendApiSecret }`。任何 auth mutation 都先同步增加 revision 并写 localStorage；logout 不再 `removeItem`，而是同步写 `{revision:N,user:null,githubToken:null,backendApiSecret:null}`。Zustand persisted snapshot 同样保存 `authRevision`。

Hydration 比较 revision：

- mirror revision > IndexedDB revision：mirror 胜出，即使值全是 null；
- snapshot revision >= mirror revision：snapshot 可以胜出；
- 老版本没有 revision：迁移为 0。

这样 crash 发生在 IDB commit 前也不会让旧 snapshot 覆盖 logout tombstone。随后异步 persistence 只是把 durable snapshot 追到同一 revision，而不是承担“证明用户登出过”的唯一责任。

不要试图在 `beforeunload` 阻塞等待 IndexedDB；浏览器并不保证异步 unload 工作完成，正确模型必须允许写入来不及结束。

### 18.7 P1-LIFE-01 / P1-LIFE-02：backend candidate URL 与 secret 探测

这两条应该一起修。`backend.init()` 现在兼具“探测”和“修改全局连接”的职责，Settings 又会先 `setBackendApiSecret(candidate)`；这使失败恢复天然不完整。

推荐把 BackendAdapter 拆成两阶段 API：

- `probeConnection({url, secret, signal}) -> {ok, normalizedUrl, health, authStatus}`：**纯 candidate**，显式使用传入 secret 构造 header，不读写 Store/localStorage，也不改变 `_backendUrl`；
- `commitConnection(candidate)`：只有 probe 全部成功后才修改 `_backendUrl`、递增 `connectionGeneration`，调用 `rememberActiveUrl()`，再由 lifecycle 层一次性提交 backend secret。

startup auto-detect 也可以先 probe remembered/same-origin candidate，再 commit；不再需要“先 init candidate、失败后 init previous”的补偿模式。

Settings Test Connection 成功后才能写 secret；失败时 URL、sessionStorage、auth mirror、Zustand 都完全不变。登录页“现有数据”路径使用同一个 probe API，避免两个入口产生不同语义。

### 18.8 P1-LIFE-03：backend.init 丢 pending local edit

在引入两阶段 probe 后，**probe 根本不应该触发 autoSync before-init hook**。只有真正 commit 到另一个 backend connection 时才需要 sync handoff。

真正切换 backend 时，推荐 SyncCoordinator 进入 `switching`：冻结新的 remote commit，记录当前 `dirtyShards`，等待正在进行的 push 到一个可知的终态；无法完成的 dirty shard 保留在内存队列并绑定旧 backend generation。用户可以选择“等待同步后切换”或“保留本地改动并切换”；不能通过清 `_hasPendingLocalChanges` 表示它们已经处理。

如果必须立即切换，则旧 generation 的 pending 不能自动发送到新 backend；应该标记成“unsynced local changes from previous backend”，让用户显式决定是否把本地 snapshot 推到新 backend。这比静默丢 edit 或误推到另一台服务器都安全。

### 18.9 P1-SYNC-01：全局 dirty + 全 shard replace-all 导致跨设备覆盖

这是 autoSync 最需要结构性重写的地方。推荐引入**per-shard revision + optimistic concurrency**，而不是继续扩展 `_hasPendingLocalChanges`。

Server 新增 `sync_revisions(account_id, shard, revision, updated_at)`；每次某 shard 在同一 DB transaction 中成功写入时 revision +1。GET 返回 `{data, revision}`；写请求携带 `baseRevision`（或 HTTP `If-Match`），不匹配返回 409 和 current revision。

Shard 不应机械等于当前数据库表，而应按**必须原子一致的业务不变量**划分。例如可以定义：`organization = repositories + customCategories + hidden/default overrides + category/subcategory/repository order`，`releases`，`ai = configs + activeAIConfig`，`webdav = configs + activeWebDAVConfig`，`search = embedding configs + activeEmbeddingConfig + vector config/activeIndex`，以及较轻的 preferences shard。这样不会把原本需要一起变化的 repository/category organization 再拆出新的中间态。

客户端维护：

- `dirtyShards: Set<SyncShard>`；
- `remoteRevision[shard]`；
- `pushState[shard]` / retry metadata。

Store subscription 只把真正变化的 shard 标 dirty：repo edit 不再顺手 push AI/WebDAV/Vector。`pushToBackend()` 按 dirty shard 发请求；未修改 shard 绝不上传 stale snapshot。

对 AI/WebDAV/Embedding config，当前 Server bulk API 是 DELETE+重建，至少必须加 CAS；更好的长期形态是 item-level upsert/delete + revision。Repositories 仍可以保留 batch snapshot，但必须基于 revision 冲突检测；发生 409 时先 pull 该 shard，执行明确 merge，再由用户/规则决定冲突，而不是 last-writer-wins。

任何**旁路修改**同一数据的 Server route 也必须在相同 SQLite transaction 中 bump 对应 revision：例如 mark-all-releases-read、import/restore、旧 CRUD route、配置更新。否则 CAS 只看得到 Sync API 写入，却看不到这些旁路 mutation，会产生“revision 没变但数据已经变了”的盲区。前端 Settings 的手动 Push/Pull 也必须走 SyncCoordinator，而不能继续直接调用 adapter 绕过 revision。

客户端的 revision/last-ack 元数据应按 `(backendTarget, workspaceKey, shard)` 持久化，而不是继续一组全局 `_lastHash`；这样离线编辑或重启后仍知道自己是基于哪一个 backend/account revision 产生的修改。

这套 revision 必须按 P0-01 的 account namespace 分区，否则只是把“全局覆盖”变成“全局有版本的覆盖”。

### 18.10 P1-SYNC-02：push 失败后 auto-sync 停摆

当同步变成 per-shard 后，用显式 state machine 替代几个 boolean：`clean → dirty → pushing → clean/backoff/conflict/stopped`。失败 shard 进入 `backoff`，保留 dirty，不阻塞其他 clean shard 的 pull。

retry 采用 exponential backoff + jitter，例如 2s/5s/15s/30s/60s capped；网络重新 online、页面回到 visible、用户手动 Sync 时立即触发一次 retry。若响应带 `Retry-After`，优先服从服务端值。

当前 5 秒 poll 不应因为一个 shard dirty 就全局 return。clean shard 仍可拉取，dirty shard 若 remote revision 变化则进入 conflict，而不是静默覆盖。UI 最好显示“3 个本地改动待同步 / 上次失败原因”，让失败不是只写日志的隐形状态。

### 18.11 P1-GH-01 / P1-GH-02：Stars 与 Lists 长任务跨账号提交

不要为 `syncStars` 和 `pushCategoriesToLists` 各写一套 user/token compare。推荐抽共享的 `AccountTaskScope`：启动时捕获 `{authGeneration, accountId}` 并注册 AbortController；logout/切账号统一 abort。每个 GitHub await 后、任何 Store commit 前调用 `scope.assertCurrent()`。

`syncStars` 还要避免在请求返回后重新读取“当前 Store”作为 merge base。启动时捕获 A 的 workspace snapshot；若任务仍 current，再用 application command 把 A remote result merge 到 A live workspace。若已经切 B，则直接丢弃结果，不允许 `forceSyncToBackend()`。

`pushCategoriesToLists` 更复杂，因为账号切换前可能已经对 GitHub A 写了几个 list。远端已提交写无法可靠 rollback，也没有必要回滚——它们本来就是 A 的操作。账号切换后应立即停止后续写，且**绝不能把 A 的 `categoryListIdMap` 写进 B**；下次回到 A 时重新读取 Lists 即可重建映射。

同一 helper 可以替换 Fork/Discovery 当前各自私有 generation，最终形成一套全项目异步账号任务语义。

### 18.12 P2-DATA-01：Stars+Lists 忽略 hidden default categories

直接把 `hiddenDefaultCategoryIds` 填进第三参能修当前 bug，但最佳方案是删除“View 和 Sync 各自拼 `getAllCategories(...)` 参数”的重复知识。

新增纯 selector/helper，例如 `selectEffectiveCategories(state)` / `buildEffectiveCategorySnapshot(...)`，内部统一处理 language、custom、hidden defaults、overrides。Repository View、Stars+Lists pull、Lists push、AI categorization 都从这一个 contract 获取 category universe。这样以后增加新的 category visibility 规则时不会再次出现“注释说同源、实参却漂移”。

回归测试除了隐藏默认分类，还要覆盖语言切换、default override、custom category 同名冲突，确保 List name mapping 始终使用相同有效集合。

### 18.13 P1-03：Custom Discovery cancel 后仍 publish

这条不能只在 `runChannels()` 的 `transact()` 前多放一个 `if (signal.aborted) return`。原因是从检查到 IndexedDB transaction 真正执行 callback 之间仍有时间窗口；而 `collect()` 当前还会把 abort 吞成 partial result。正确方案必须让**取消成为 transaction 的无效条件**。

推荐分三层改：

1. `collect()` 区分“可保留的业务失败/整体 deadline”和“user/account/lease abort”。对于 `AbortError` 或 `session.signal.aborted` 必须重新抛出，不能进入 `return { edition, cursors }`。当前 `previewChannel()` 已经更接近正确的 cancellation rethrow 模式，可以把相同 helper 抽出来复用。
2. `runChannels()` 在拿到 collection 后先 `controller.signal.throwIfAborted()`，然后才进入 publish phase。
3. **最关键的是在 `transact(account, fresh => ...)` callback 内再次 `throwIfAborted()`**，并同时检查当前 account generation、lease owner、channel revision。因为 IndexedDB `get(account)` 完成之前可能发生 cancel；只在 transaction 外检查仍有 TOCTOU 窗口。

如果产品确实希望“15 分钟整体超时后保留已经完成的批次”，不要把 timeout 和 user cancel 用同一个 abort 结果表示。可以定义：

- `user_cancelled` / `account_changed` / `lease_lost`：禁止 edition/cursor/recommended/lastRefresh commit；
- `deadline_partial`：允许保存显式 `status:'partial_timeout'` 的 checkpoint，但不应伪装成正常完成；尤其 cursor 是否前进必须由产品规则显式决定。

`publish()` 现有的 lease owner、channel revision、paused 检查应保留，它们是很好的最后一道 fence，而不是被新的 generation 替代。

必须测试的取消点至少有：collect 中间、collect 刚返回、等待 IDB `get` 时、transaction callback 执行前、两个 channel 之间。断言 user cancel 后 edition/cursor/recommended/lastRefresh 都不变化。

### 18.14 P1-04：AI Workbench stranded streaming message

仅把 `patchSession()` 移进现在的 `try/finally` 还不够：浏览器/进程可以在 `saveMessage(streaming)` 已成功但 finalizer 还未执行时崩溃。最优解需要同时解决**同一轮开始时的原子持久化**和**崩溃后的恢复语义**。

`repositoryChatStorage.ts` 已有可等待完成的 multi-store `runTransaction()`，因此建议新增类似：

`beginTurn({ sessionId, ownerId, userMessage, assistantMessage, sessionPatch, turnId })`

在 IndexedDB 模式中使用一个 `sessions + messages` readwrite transaction 同时：

- 校验 session 仍存在且属于 owner；
- 写 user message；
- 写初始 assistant `streaming` message；
- 应用 title/updatedAt 等 session patch。

fallback localStorage 路径则在内存 snapshot 上完成同样变换后只写一次。只有 `beginTurn()` 整体成功，runtime 才开始模型调用。这样 `patchSession` 失败不会留下半轮消息。

同时给一轮对话增加稳定 `turnId` / attempt id。终态保存更新同一个 assistant record 为 `complete/error/aborted`。加载 session 时增加 crash recovery：若发现 `status:'streaming'`，但当前没有同 `turnId` 的活跃 `workbenchRuntime`，则把它恢复成 `aborted`/`interrupted`，附带“应用上次关闭时任务未完成”的可见说明。**不要自动重新调用模型**，否则 reload 会在用户不知情时重复计费/产生副作用。

测试应覆盖 beginTurn 任一步失败、IndexedDB transaction abort、fallback write 失败、模型期间 crash 后重新 hydrate，以及旧版本没有 `turnId` 的 streaming record 恢复。

### 18.15 P1-05：Repository Chat retry/regenerate 的 destructive retry

这里最好的语义不是“先确保 send 能跑再删除”，也不是“send 成功后再删”。`send()` 内部有多层降级和错误吸收，且 evidence/tool events 与旧消息绑定；任何 destructive replace 都会让失败恢复复杂。

推荐把 retry/regenerate 建模为**同一 turn 的 revision/attempt**：

- message 增加向后兼容的可选字段 `turnGroupId`、`revision`、`supersededAt`（旧记录默认 revision 0）；
- 点击 Retry/Regenerate 时保留旧 user/assistant/evidence/toolEvents，先进行 runtime admission 和新 attempt 的 `beginTurn()`；
- 新 attempt 失败时，旧成功/失败回答仍是可恢复历史，新失败 attempt 可以显示为另一 revision；
- 新 attempt 达到 terminal persisted state 后，再在一个 storage transaction 中把旧 assistant attempt 标记 `supersededAt`，UI 默认展示最新 revision，但允许查看历史版本。

evidence/tool events 必须归属具体 attempt，而不是在新回答成功前删除旧证据。这样“重新生成”自然支持比较回答，也解决当前 `permanentlyDeleteMessages()` 连带删 evidence 的不可逆风险。

如果暂时不想做完整 revision UI，最小安全版本也应保留旧 pair，成功后再**标记隐藏**而不是物理删除；后台 retention job 再清理 superseded records。不要以“先调用一个 canSend()”作为修复，因为 admission 到真正 `workbenchRuntime.run()` 之间仍可能发生并发状态变化。

### 18.16 P1-06：AGY save cancel 的 commit point

AGY 这里已有一个重要优势：`persist()` 使用 temp file + rename，本身已经接近原子文件提交。真正的问题是队列在 `work()` 返回后再次检查 signal，使“rename 已成功”仍可以被解释成 CANCELED。

最优语义是：**save 只在 commit point 前允许取消；一旦开始不可逆 commit，就必须完成并返回成功。**

推荐把 `persist()` 明确拆为 prepare/commit 语义，或至少在 rename 前做最后一次 `signal.throwIfAborted()`：

1. validate prefs；
2. 写 temp / fsync（可取消）；
3. 最后一处 cancel check；
4. rename = commit point；
5. 无论此后 signal 是否变为 aborted，都更新内存 `prefs = next`；
6. 返回新的 snapshot。

`AgyQueue.run()` 增加任务级 cancellation policy，例如 `{ cancellableWhileRunning:false }` 或更精确的 commit-aware callback。只给 save 采用该策略，不能把所有 AGY detect/research/read 操作都改成不可取消。队列中的未开始 save 仍然可以取消。

若 rename 失败则内存绝不能更新；若 rename 成功，则调用方绝不能收到 CANCELED。测试要精确注入 abort：temp write 前、temp write 后/rename 前、rename 后/内存赋值前，验证磁盘、内存、返回值三者线性一致。

### 18.17 P1-DATA-01：Release“全部已读”失败回滚不完整

这个操作没有必要为了即时视觉反馈承担复杂 optimistic rollback。**推荐改成 backend-first commit，再更新本地**：

- 请求开始时捕获当前要标记的 release id 集合；
- UI 用现有 `isMarkingAllRead` 显示 pending/禁用重复点击，但暂不修改 read state；
- backend 成功后，只对请求开始时捕获的 ids 执行本地 `markReleasesAsRead(ids)`，同步 `readReleases`、`release.is_read`、`updated_asset_ids`；
- 请求期间新刷新的 release 不应被误标为已读。

对于无 backend/local-only 模式，直接执行同一个本地 command 即可。这样失败时无需 rollback，也不会与后台 Release refresh 争夺整个 `releases` 数组。

如果产品坚持 optimistic UI，则也不能简单 snapshot 整个 `releases` 并 catch 后覆盖，因为请求期间可能有新 Release 或资产更新。应记录**每个目标 id 的 inverse delta**：原 `readReleases` membership、`is_read`、`updated_asset_ids`；失败时只在该 release 尚未被更晚 generation 修改的情况下恢复对应字段。

另外，在 optimistic command 未 settle 前 autoSync 不应把临时 `is_read=true` 当成普通本地业务修改推回 backend，否则 rollback 还没发生就可能形成二次写入。

### 18.18 P1-DATA-02：“删除所有数据”

最优解是建立统一 `AppDataRegistry`，但要明确：跨多个 IndexedDB、localStorage、Electron safeStorage 的清理**不可能是真正的单一 ACID transaction**。因此实现应是一个有 maintenance lock、可重试、可验证的 saga，而不是通过 try/catch 营造“原子删除”的假象。

建议每个持久域注册统一 contract：

`{ id, schemaVersion, scope, portability, export(), prepareImport(), commitImport(), clear(), verifyEmpty() }`

至少注册：

- Zustand 主 persistence（其字段清单来自统一 serializer，而不是手写第二份）；
- Repository Chat / Workbench DB；
- Custom Discovery DB；
- Weekly / X / Telegram 独立 storage；
- Electron X auth / future SecretVault；
- 其它 app-owned local/session storage keys。

删除流程必须先进入 `DataMaintenanceMode`：停止 autoSync、abort GitHub/Discovery/AI tasks、暂停 Zustand debounced persistence，避免刚清完 DB 又被内存 snapshot 回写。然后逐 domain 执行幂等 `clear()` 并记录结果。所有 domain 成功后，用 canonical initial-state factory 重置内存 Store，再**显式写入一个干净的新主 snapshot/auth tombstone**，最后 `verifyEmpty()` 后退出 maintenance mode/reload。

当前 `clearEncryptedXAuthViaDesktop()` 的失败被忽略，这与“删除所有数据”语义冲突。真正 Delete All 必须把失败列给用户；若某 device-only credential 无法清除，结果只能是“部分完成，需要重试”，不能提示成功。

`repositoryChatStorage` 应新增 `clearAll()`，同时清 IndexedDB 与 fallback keys；Custom Discovery storage 新增 `clearAll()/clearAccount()`，而不是让设置页知道数据库名字。这样数据域自己负责未来 schema/fallback 变化。

### 18.19 P1-DATA-03：WebDAV / JSON Backup 不完整

Backup 与 Delete All 应共用同一个 Registry，否则两者一定会再次漂移。推荐备份格式升级为 versioned manifest，例如：

`{ formatVersion, appVersion, account, exportedAt, secretsPolicy, domains:[{id,schemaVersion,count,checksum,payload}] }`

每个 domain 的 `export()` 决定自己的序列化和 portable 规则；主 Store serializer 与 Zustand `partialize` 共享字段定义，避免现在 persistence 有一份、JSON Export 一份、WebDAV Backup 又一份。

要明确区分：

- **portable backup**：默认不包含长期 secret、device-only local research grant、机器绑定 AGY executable 等；
- **device backup**：如果以后允许包含 secret，应使用用户单独提供的 passphrase 加密整个敏感 envelope，而不是把明文 API key 上传 WebDAV。不能把 WebDAV 账号本身的 password 当作备份加密密钥。

Restore 应先完成**全量 dry-run**：解析 manifest → 每域 schema validation → migration → owner/account 检查 → 引用完整性检查 → 展示 replace/merge diff。只有所有被选域都 prepare 成功后，才进入 maintenance mode 开始 commit。

跨 DB restore 仍无法完全原子，因此建议 restore 前自动生成一个本地 safety snapshot；逐域 commit 失败时报告已经成功/失败的域，并允许从 safety snapshot 恢复。老 v1.0/v1.2 backup 没有某个 domain 时，语义应是“该域不在备份中，保持当前值/明确提示”，**不能把缺失字段解释成空数组而清掉新版本数据**。

Repository Chat 已经有严格 owner/schema validation 的 `exportWorkbench/importWorkbench`，可以把它适配进 registry，而不是重写一套较弱的导入器。

### 18.20 P1-07：Backend MCP 与 Vector Worker v2 identity 不对等

当前 Server MCP fail-closed 是正确的安全选择，最优解绝不是把 `protocolVersion !== 1` 或 generation 检查删掉，而是把 Browser/Electron 已经具备的 **VectorIndexGeneration contract 真正同步到 backend**。

当前 renderer 的 `VectorSearchConfig.activeIndex` 已包含完整 `VectorIndexGeneration { identity, identityHash, namespace }`，`vectorIndexIdentity.ts` 也有 `normalizeVectorGeneration()` / `requireCompatibleVectorIndex()`；`useVectorSearchActions.ts` 采用“stage → verify query-visible → publish generation”的正确发布协议。Backend 应完整保留这一 invariant：

1. 把 `VectorIndexIdentity/Generation/Scope` 从 `src/services` 提升到 runtime-neutral shared contract（也作为 A-03/A-04 的第一步），Server/Electron/Renderer 共用校验规则和 `VECTOR_PROTOCOL_VERSION=2`。
2. `vector_search_configs` 增加 `active_index_json` 与 `index_protocol_version`（也可以拆 typed columns，但 JSON + 严格 validator 迁移成本更低）；PUT/GET/sync 必须包含并验证 generation。
3. Server MCP 在执行 embedding 前先用当前 embedding config + vector config 调等价的 `requireCompatibleVectorIndex()`；然后请求 Worker `/status`，要求 protocol v2、dimensions 与 active generation 一致。
4. `/query` 必须和 Electron 一样携带 `scope={identityHash,namespace,dimensions}`，返回 matches 后再验证 metadata identity，防止 Worker/namespace 错配。
5. 数据库 migration 对旧 row 的 `activeIndex` 留 `NULL`，表现为 `rebuild_required/vector_index_identity_not_synced`。**不能根据 vectorCount、dimensions、status_json 推导 generation**，因为这些值不能证明内容、模型、endpoint、mode 和目标 Worker 的身份。

还要同步修一个容易被遗漏的点：`autoSync.vectorSearchFingerprint()` 当前只 hash enabled/worker/auth/embedding/indexMode/search settings/format version，**没有 `activeIndex`**。即使 Server 开始持久化 generation，客户端也可能把远端 generation 变化判断为“没变”。fingerprint 必须加入 canonical active generation/protocol，且其 sync revision 应与 P1-SYNC-01 的 vector shard 一致。

Legacy `GSM_MCP_LEGACY_VECTOR_WORKER_URL` 可以保留一个兼容发布周期，但 UI/日志明确标记 unverified；当 backend v2 generation 已普及后删除 legacy unscoped query，而不是长期维护两套安全等级。

验收测试应做真正 contract round-trip：Browser rebuild 生成 generation → backend PUT/GET → Server MCP → Worker v2 query，scope 完全一致；模型/endpoint/dimensions/mode/readmeMaxChars/target/hash 任一变化都必须在 embedding/query 前 fail-closed。

### 18.21 P1-08：远程 backend 模式生成错误 MCP URL

组件不能继续猜“backend 就是当前页面 origin”。最优设计是让 backend connection 自己提供一个**MCP endpoint descriptor**。

推荐 Server `/api/mcp` status/config 在保持现有相对 endpoint 字段兼容的基础上，增加：

- `streamableHttp` / `sse` 的相对 path；
- 可选 `publicBaseUrl` 或 absolute endpoint，来源只能是显式部署配置 `PUBLIC_MCP_BASE_URL`，不能直接信任任意 `Host` / `X-Forwarded-Host` 拼 URL。

Renderer 在 backend mode 的解析顺序：

1. 有 server 声明的 `publicBaseUrl` → 使用它；
2. 否则以**当前已 commit 的 `backend.backendUrl`** 为基准，而不是 `window.location.origin`。由于 backend URL 是浏览器真正能访问的 public `/api` URL，可用统一 helper 把末尾 `/api` 替换为 MCP route base，同时保留反向代理 path prefix；
3. Electron standalone 继续使用 loopback local MCP。

这个 URL 构造 helper 应位于 backend/MCP adapter，不放在 `McpSettingsPanel.tsx`。组件只渲染 descriptor。

测试至少覆盖：SPA `https://app.example` + backend `https://api.example/api`、带 path prefix 的 `https://host/gsm/api`、fullstack same-origin、显式 `PUBLIC_MCP_BASE_URL` 反代覆盖。不要把 `window.location.origin` 的当前行为仅改成字符串 `replace('/api','')` 后继续散落在 UI。

### 18.22 P1-09：fullstack Compose 没有透传 `CSP_CONNECT_SRC`

这条应精准修 fullstack 模式。`docker-compose.fullstack.yml` 的 SPA 是由 Express/Helmet 服务，因此 `CSP_CONNECT_SRC` 必须进入 app container：

`CSP_CONNECT_SRC: ${CSP_CONNECT_SRC:-}`

如果上一条引入 `PUBLIC_MCP_BASE_URL`，也应一起列入 compose 和 `.env.example`，避免“Server 支持但官方部署入口传不进去”的同类漂移。

需要注意：split `docker-compose.yml` 的 SPA 是独立 nginx frontend 提供；仅把 `CSP_CONNECT_SRC` 传给 backend container **不会改变浏览器 document CSP**，所以不能把它伪装成 split 模式修复。若未来 split frontend 也要 CSP，应单独在 nginx template 建 CSP/env 机制。

`buildConnectSrc()` 最好进一步只接受合法 http/https **origin**：拒绝 credentials、path/query/hash 和诸如 `'unsafe-inline'` 之类 CSP token，避免一个环境变量意外扩大 policy grammar。

CI 增加 compose-config fixture：文档公开的 deployment env 变量必须能在官方 compose 渲染结果中出现；应用层测试设置 `CSP_CONNECT_SRC` 后检查 Helmet header 确实包含目标 origin。

### 18.23 P2-01：Repository Chat Web Tools toggle 是 no-op

这个问题的核心是**用户偏好和运行时能力没有分层**。一个持久化 boolean 不应该自动意味着系统存在对应 tool provider。

短期最优修复：在 Web Tools provider 真正存在前，把 checkbox 改成 disabled/unavailable 状态并显示 reason；旧持久数据里 `enableWebTools:true` 应迁移/normalize 为 false，或至少 runtime 永远计算 `effective=false`。不能继续允许用户打开一个无效果的开关。

长期实现时引入 capability descriptor，例如：

`webTools: { available:boolean, reason?:string, providers?:string[] }`

真正生效条件是 `userPreference && runtimeCapability.available`。把 effective capability 作为 `RepositoryChatTurnInput` 的显式字段，工具注册器根据它决定是否暴露 `web_search` / `fetch_url`，而不是让 prompt 自己“知道有互联网”。

Web 证据必须进入现有 evidence/tool-event 模型，并继续遵守 untrusted-content、预算、引用和 cancellation 规则；HTTP fetch 要复用 SEC-02 的安全 transport，不能为了实现 toggle 直接在 renderer/server 放一个任意 URL `fetch()`。

### 18.24 P2-02：无鉴权 OpenAI-compatible endpoint

不能只把 `AIConfigPanel` 的 `!form.apiKey` 校验删掉。当前 `aiService.ts` 多条 streaming/non-streaming/tool path 和 Server proxy 都会按 provider 构造 Authorization；UI 放行空 key 后，运行时仍可能发送 `Bearer `、把 config 判 unavailable 或在 backend bulk sync 中被跳过。

推荐给 HTTP AI 配置增加显式 auth contract：

`authMode: 'bearer' | 'none' | 'custom'`

以及仅 custom 使用的 `authHeaderName?`；低迁移成本下继续复用 `apiKey` 字段作为 secret value。老配置没有 `authMode` 时 migration/default 为 `bearer`，保持行为兼容。第一阶段只给 `openai-compatible` 暴露 none/custom，内置 OpenAI/Claude/Gemini 等仍使用 provider 固定认证，避免用户错误关闭必要认证。

然后新增唯一的 `buildAIAuthHeaders(config)` / `requiresAISecret(config)`：Browser direct 的普通请求、stream、tool call，Backend proxy inline config、连接测试、availability guard、autoSync validation 全部复用。`none` 必须**完全不发送 Authorization**；`custom` 的 header name 需要 RFC token 校验并拒绝 Host/Cookie/Content-Length/Connection 等危险 header，同时日志按 secret 字段脱敏。

Server `ai_configs` 增加 `auth_mode` / `auth_header_name`，bulk replace、sync/export/import、proxy route 都 round-trip；`requiresSecret=false` 不能只根据 apiType 硬编码，而要由 auth mode 决定。空 key 的 none 配置不能被当成 decrypt_failed，也不能从 backend merge 时“保留旧 bearer key”。

必须覆盖：UI save/test 无 key、Browser direct stream/non-stream/tool、Backend proxy、旧配置 migration、custom header validation，以及确认 none 模式的网络请求没有 Authorization。

### 18.25 P2-03：Cloudflare Worker 子项目本地 bootstrap 不完整

当前 `cloudflare-worker/package.json` 本身声明了 wrangler/typescript/workers-types，问题是 root `npm ci` 不会安装这个独立 package。这里不需要把它误诊成 runtime bug，也不建议只把几项 devDependency 重复搬到根项目。

低风险最优方案是在根项目提供清晰 wrapper：

- `worker:install` → `npm ci --prefix cloudflare-worker`；
- `worker:dev` / `worker:deploy` → `npm --prefix cloudflare-worker run ...`；
- Worker 专用 CI job 在需要 typecheck/dev/deploy contract 时先执行子目录 `npm ci`；
- 文档统一使用 local wrangler，不要求全局安装。

`check:vector-worker` 继续负责 generated `worker.js` 与 TS source parity，它不能代替 Worker dependency/bootstrap 验证。

如果未来要转 npm workspaces，应该把 root/server/cloudflare-worker 一次性设计成一致 monorepo，而不是只把 Worker 半迁移进去，造成 lockfile/install 语义更复杂。当前独立 package-lock 的模式可以保留，只需让 root workflow 明确知道它存在。

### 18.26 SEC-01：Gemini Embedding key 经 MCP error 泄漏

这里应优先修**错误的产生位置**，而不是只增强日志 sanitizer。只要 `Error.message` 里已经含真实 `?key=...`，它可能从任何一个未来日志/UI/telemetry 边界再次泄漏。

推荐抽一个 Server/Electron 共用语义的 embedding request/error mapper：

- credential-bearing URL 只存在于 request object 的局部变量，永远不插入异常文本；
- upstream 非 2xx 转成结构化错误，例如 `{code:'embedding_upstream_error', provider:'gemini', status:429, endpointOrigin:'https://generativelanguage.googleapis.com'}`；
- 对 MCP client 的 `reason` 只返回稳定 code + provider/status + 可公开说明，不返回原始 URL；
- upstream body 最多保留短 sanitized excerpt，并再次清洗 `key/api_key/token/Authorization` 等字段。

如果 Gemini API/当前 SDK 支持把 key 放到 header，可优先采用 header，减少 URL 在代理/access log 中传播；但**不能把“换成 header”当成唯一安全保障**，错误路径仍必须 credential-free。

`logSanitizer.ts` 继续加强作为 defense-in-depth：不仅处理“整个字符串就是 URL”，还应扫描字符串中的 URL substring 并对 query params 做 redaction。Electron `mcpLocalServer.js` 也必须使用同一错误规范，避免 Server 修了、桌面端继续泄漏。

回归测试用一个故意在 4xx response body 中回显 key 的 fake Gemini upstream，断言：Error、logger payload、MCP `reason`、renderer-visible message 全部不含原 secret 或 URL-encoded secret。**只修 sanitizer、不修异常源头是不完整方案。**

### 18.27 SEC-02：Proxy SSRF 的 DNS rebinding / redirect 绕过

“先 `dns.lookup()` 检查一次，然后仍让 Axios 自己解析 hostname”仍然存在 TOCTOU；最佳方案必须让**实际建立 socket 的请求使用已经验证的地址**。

建议提取 `safeTransport`，至少支持两种明确 policy：`strictPublic` 与显式允许私网的受控模式。`strictPublic` 的流程：

1. parse URL，拒绝非 http/https、userinfo、IMDS 等永远禁止目标；
2. resolve 全部 A/AAAA；若解析集合中出现 loopback/private/link-local/metadata 地址，直接拒绝该 hostname，而不是“挑一个 public IP 继续”，避免 resolver 顺序/rebinding；
3. 从验证后的 public 地址中选择并通过 custom `lookup`/Agent **pin 到实际 socket**，同时保留原 hostname 作为 HTTP Host 和 TLS SNI；
4. 禁用 Axios 自动 redirect（`maxRedirects:0`），最多手动跟随 3～5 跳；每一跳重新 parse → resolve → validate → pin；
5. 跨 origin redirect 时剥离 Authorization/Cookie/Proxy-Authorization 等敏感 header；
6. 同时限制 timeout、最大响应 body、最大 request body，避免把 SSRF 修成内存 DoS。

项目的 Plugin Web Search 已经有 BlockList/custom DNS lookup 思路，可以把它提升为共享 transport，而不是 Server/Plugin 各自维护一套近似规则。

HTTP/SOCKS outbound proxy 是额外难点：如果真正的 destination DNS 由用户配置的 proxy 解析，应用端无法证明 pinning 生效。`strictPublic` 模式下应禁止与“不受控远程代理解析”组合，或者实现能把已 pin IP 交给代理但仍保留 Host/SNI 的专用 transport；不能继续声称已经防 DNS rebinding。

测试需要 mock DNS：public→private rebinding、同一 hostname 混合 public/private A/AAAA、redirect 到 127.0.0.1/IPv6 local/IMDS、跨 origin auth stripping，以及正常 public redirect 链。

### 18.28 SEC-03：裸跑 Server 无 `API_SECRET` fail-open

鉴权是否开启不应该由 middleware 每个请求临时猜。推荐在启动阶段建立不可违反的配置 invariant：

- 增加 `HOST`，明确监听地址；
- 增加名称足够醒目的 `ALLOW_UNAUTHENTICATED_LOCAL_DEV=1`；
- 若没有 `API_SECRET`，只有同时满足“显式 dev flag + HOST 是 loopback”才允许启动；
- `HOST=0.0.0.0/[::]` 或其它网络地址 + no secret 必须在 `listen()` 前直接 throw/exit；
- `app.listen(config.port, config.host)`，不再依赖 Node 默认 broad bind。

`authMiddleware` 接受已经验证好的 auth mode；正常模式下没有 secret 是配置错误，而不是 `next()`。`/api/health` 可继续公共，但其它 `/api` 必须一致。

标准 Compose 当前已经强制 API_SECRET，这是正确模式，应保留；README 对“空 secret = dev mode”的描述需要改成显式 local-dev opt-in。测试覆盖：无 secret 网络启动失败、显式 loopback dev 成功、dev flag + network bind 仍失败、正常 secret auth timing-safe compare 保持不变。

### 18.29 SEC-04：长期 secret 明文持久化

这一项不能通过“把 localStorage 换成 IndexedDB”解决；对于 Web 页面，同源 XSS 能读取两者。目标设计应该先按运行环境区分威胁模型，再统一一个 `SecretVault / SecretRef` contract。

**Electron：** 复用已有 X auth 的 `safeStorage` 模式。Main process 管理加密 vault，文件以 0600/临时文件+rename 持久化；renderer Store 只保存 `SecretRef`/presence metadata，不拿长期明文。proxy-config.json 里的 username/password 也迁进去。Preload 只暴露按用途 set/clear/test 的窄 API，而不是“dump 全 vault”。

**Backend route mode：** AI/WebDAV/Embedding/Vector/GitHub 等 provider secret 尽量只保存在 Server AES-GCM encrypted DB，renderer 保存 config id 和 `secretStatus`，调用时走 backend proxy；GET sync 默认只返回 masked/presence，除非明确的安全迁移流程需要解密。

**纯 Browser-direct：** 没有 OS keystore。默认建议 secret 只保留 session/runtime；若提供“记住凭据”，UI 必须明确它仍受同源脚本读取风险。若做 passphrase-encrypted vault，派生密钥必须来自用户输入且不与 ciphertext 一起永久保存；单纯 WebCrypto + 同位置保存 encryption key 没有安全收益。

迁移必须 crash-safe：读取 legacy plaintext → 写加密 vault → 重新读回验证 → persistence schema 写 SecretRef + migration marker → 最后才删除 plaintext。整个过程幂等，绝不能先删旧 secret 再尝试写 vault。

这个改动会改变 ADR 0001 §135 的“backendApiSecret 三处持久化”既有 contract，因此必须**先更新 ADR**，说明新的 threat model、fallback 和 migration；不能悄悄破坏被测试冻结的 persistence contract。

Backup Registry 默认排除 secret；如果用户显式导出 secret，走 §18.19 的独立加密 envelope，而不是重新把 vault 内容展开成明文 JSON。

### 18.30 SEC-05：Electron IPC / external URL / navigation policy

当前 sandbox/contextIsolation/nodeIntegration 配置应该保留。下一步不是继续零散地给几个 handler 加判断，而是建立统一 trusted-renderer boundary。

建议 centralize：

- `isTrustedMainFrame(event)`：`event.sender === mainWindow.webContents`、`senderFrame` 是 main frame，并验证 frame 当前 URL 属于允许的 renderer origin/path（dev 精确 Vite origin；prod 精确 packaged scheme/path）；
- `registerTrustedHandle(channel, schema, handler)`：所有 privileged `ipcMain.handle/on` 通过统一 wrapper 做 sender + 参数 schema validation；
- `safeOpenExternal(url)`：明确 allowlist `https:`，如产品确需 email 再显式加入 `mailto:`；拒绝 `file:`, `javascript:`, `data:`, app/custom schemes；
- main-frame `will-navigate/will-redirect` 默认阻止离开 trusted renderer；当前只保护 subframe 的策略要补齐。

Preload 继续暴露**命名能力方法**，不要为了减少代码改成 `invoke(channel,args)` 通用桥。这样即使 renderer 被注入，也只能调用显式 surface。

AGY/Plugin 已经有一部分 main-frame/参数验证模式，可以抽成统一 helper。测试要创建 untrusted/subframe sender，验证 MCP/plugin/proxy/AGY 等 privileged IPC 全拒绝，并测试恶意 external scheme 和主 frame 导航。

这项最好与 A-05 的 IPC contract single source 同一阶段完成：安全 policy 成为 channel manifest 的字段，而不是另外维护一份名单。

### 18.31 SEC-06：50MB JSON parser 在 Auth 之前

Express middleware 顺序应改成“无需 body 的安全边界在前，解析器在后”而不是简单把一个大 parser 上下移动：

1. 挂 `/api/health`，无需 JSON parser；
2. `app.use('/api', authMiddleware)`；
3. `/api` 默认使用小 body limit，例如 1～2MB；
4. 只有确实需要大 snapshot/import 的**已鉴权 route**单独挂 50MB parser，并把 nginx 对应 path limit 对齐；
5. 对有 `Content-Length` 的明显超限请求可在 parser 前直接 413；streamed/chunked 仍由 parser/transport limit 执行。

MCP routes 有自己的 token/auth，继续独立处理，不要错误地套 `/api` secret。

测试重点不是“最后返回了 401”，而是证明 unauthenticated 50MB JSON 不进入 JSON parser；普通 authenticated endpoint 超小限额返回 413，而合法 bulk route 可以在它自己的上限内工作。仅依赖 nginx 不够，因为裸跑 Server 仍存在。

### 18.32 Server dependency audit：`morgan@1.12.0`

这项不是架构问题，最佳处理是小而独立的 dependency PR：升级到 advisory 已修复版本，更新 `server/package-lock.json`，跑 Server tests/build/audit。因为问题类型是 log injection，还应顺便确认自定义 `morganLoggerStream` / structured logger 不把未清理 CR/LF 重新拼成伪日志行。

不要用 audit ignore 长期压住 moderate；如果上游暂时没有兼容修复版本，应写带到期日和 advisory id 的例外，而不是无期限 suppress。

### 18.33 A-01 / A-02：把已成功的 sibling gate 扩展成结构化层级门禁

A-01 本身已经改善，不需要“再修一次”。它更有价值的作用是作为 A-02 的设计样板：`checkSiblingFeatureImports()` 不是记一张“禁止 import 的具体模块名”列表，而是根据**结构关系**判断 sibling internals，因此新文件名也自动受约束。

A-02 应采用同样思路。当前 `BANNED_COMPONENT_SERVICES` 是按名字枚举 business service，任何新 `grepFooService` 都可以绕过。目标规则应为：

`View -> src/services/**` **默认拒绝**，只有 ADR 明确分类为 infrastructure 的精确路径可以通过。

allowlist 必须小且基于能力边界，而不是为了让当前 CI 过而不断追加。现有 ADR 明确允许 logger、electronProxy/isElectron、indexedDbStorage 和纯 domain persistence wrapper；真正拥有远端 IO、Store mutation、task orchestration 的模块必须在 hook/controller 后面。

实现上最好把 layer policy 抽成一个共享 descriptor，由 ESLint config 和 `check-boundaries.cjs` 共用，避免现在两份名单漂移。仓库已经有 `ts-morph` dev dependency，可以逐步把 regex scanner 升级为解析 import/dynamic import 后做 resolved-path 分类；即使暂时继续 regex，也应按 resolved target directory + allowlist 判定，而不是 basename denylist。

迁移顺序很重要：先把现存真正的 business imports（`grepAppService`、`localResearch/agyClient`、xTweet/telegram orchestration、plugin registry 等）迁到对应 feature hook，再打开 default-deny；否则一次规则 PR 会混入大量行为重构。CI fixture 必须创建一个**从未出现在名单中的新 service 名**并验证 View import 失败，证明规则不会再次因命名漂移失效。

### 18.34 A-03：Store→Service 逆向依赖

这类依赖不能用 `import type` 当成“已经解耦”。只要 Store 的公共类型依赖 concrete service type，底层 state contract 仍然知道 IO 实现。

推荐分别处理三类现有逆向：

- `GitHubListsApiService`：把 slice 中的 Lists 远端 orchestration 移到 `features/repositories/hooks` 或 command service；若纯算法需要能力对象，只依赖定义在 domain/shared 的最小 `GitHubListsPort` interface，不依赖具体 class。
- Vector identity：`VectorIndexIdentity/Generation` 本身是纯 domain contract，应从 `src/services/vectorIndexIdentity.ts` 提升到 `src/domain`/`src/contracts`；Store normalizer 只依赖纯 validator/constants，不依赖 VectorSearchService runtime。
- `authSlice -> autoSync.resetSyncHashes`：按 §18.3/18.4 由 Auth/SyncCoordinator 处理 lifecycle，Store logout 只做状态 transition，不主动调用 service。

这样 Store 可以恢复成“state + pure/local actions”的稳定底层。也会让单元测试不需要为了构造 Store 去 mock backend/autoSync，实现真正的依赖方向，而不只是把 import 绕成 type-only。

### 18.35 A-04：Server MCP / Electron MCP 双轨实现

不建议把整个 Server MCP 或 Electron MCP 强行合并成一个巨大跨运行时模块，因为 SQLite、Electron snapshot、credential transport 天生不同。应该共享的是**domain contract 与纯逻辑**，运行时 adapter 保持分离。

建议抽 `mcp-domain`：

- tool descriptor / input schema / stable error codes；
- repository projection、filter/search/evidence formatting 纯函数；
- Vector generation/scope/protocol contract；
- tool capability descriptor。

Server adapter 提供 SQLite/account-scoped repository source、server embedding/safeTransport；Electron adapter 提供 renderer snapshot、local credential bridge。两者调用同一个 domain executor 或至少同一组 pure functions。

Electron 仍是 CJS、Server/前端是 ESM，因此 contract 包要么提供 dual ESM/CJS build，要么从 TS source 生成两个小 artifact，并像 `worker.js` 一样增加 parity gate。不要为了“共享”让 Electron runtime 动态加载前端 bundle。

最适合的第一刀是 P1-07：先把 vector identity + vector tool args/results 抽出并让 Server/Electron 共用；确认模式稳定后再迁 repository/evidence tools。CI 用同一组 fixture 对两个 adapter 输入同样数据，比较 tool list、schema、filter/error semantics。

### 18.36 A-05：IPC contract 多份手写来源

最佳方案是“single manifest + typed wrapper”，不是只再增加一份 `.d.ts`。TypeScript 声明如果不参与 runtime validation，main/preload 仍可以漂移。

建议定义 IPC contract registry，每个 channel 包含：

`{ name, inputSchema, outputSchema, senderPolicy, privilege }`

schema 可直接用项目已有 zod。Main 通过 `registerTrustedHandle(contract, handler)` 注册，自动做 SEC-05 的 trusted sender + input validation；Preload 根据 contract 暴露仍然**命名明确**的方法；Renderer TS type 从同一 contract 推导。

不要暴露通用 `window.electronAPI.invoke(channel, args)`，否则 contract 虽统一，preload 的 capability boundary 反而被打穿。

迁移可以从 MCP/desktop/proxy 开始，再到 Plugin/AGY。AGY 当前分组注册方式已经是较好的局部范例。CI 扫描 `ipcMain.handle/on` 与 `ipcRenderer.invoke/send`，凡是出现未注册 literal channel 就失败；这样新增 IPC 不会再次绕过 schema/sender policy。

### 18.37 A-06：God modules

这里最危险的“修复”是一次大规模 move/rename。当前工作树已经高度活跃，大爆炸重构会同时改变 import、测试、行为与 upstream merge surface，几乎无法判断回归来自哪里。

推荐 strangler/refactor-in-place：保留现有 facade/export，先写 characterization tests，再逐个抽内部 seam：

- `aiService`：provider request builder → auth/transport → stream parser → retry/rate limit → domain prompts；
- `githubApi`：transport/auth → repositories/stars/lists/content/releases；
- `repositoryChatService`：turn orchestration → evidence retrieval → tool loop → synthesis；
- `repositoryChatStorage`：IDB adapter → schema/migration → message/session/evidence repositories → backup adapter；
- `aiWorkbenchService`：plan/research/proposal runner；
- `DataManagementPanel`：UI 留在 component，所有 registry/delete/restore orchestration 移到 settings hook/application service；
- `server/routes/proxy.ts`：按 GitHub/AI/WebDAV/RPC route 拆薄 controller，共用 SEC-02 `safeTransport`；
- `electron/main.js`：window/navigation、trusted IPC、proxy config、MCP host、plugin host、tray 分模块。

优先抽**安全 seam**而不是按行数最大模块排序：safeTransport、trusted IPC、SecretVault、SyncCoordinator 先成为稳定接口，后续拆大文件自然围绕它们进行。

每个 PR 要求“public facade 行为不变 + tests 先移动/补齐，再移动实现”，避免重构 PR 同时改变业务语义。

### 18.38 PERF-01：bundle / 字体 / heavy chunks

当前 bundle budget 通过，所以目标不是为了数字好看随便调 `manualChunks`，而是减少真实 initial-path 下载/parse 成本。

最先应处理字体：`src/main.tsx:17-31` 静态 import 了约 15 个 Fontsource family，注释写“load on demand”，但静态 import 会把对应 CSS/font assets 全纳入构建。Theme preset 应改为 `ensureThemeFont(themePreset)`：默认主题使用 system/default family；只有选中的 preset 动态加载其 family。为了避免 hydration FOUT，可以在 bootstrap 从轻量 persisted theme id 先决定需要加载哪个 family，但不应启动时加载全部字体。

第二个高收益点是浏览器兼容目标。`vite.config.ts` 的 legacy targets 包含 Chrome 60 / Firefox 60 / Safari 12，并启用 modern polyfills。应先定义真实 supported-browser matrix：如果公开 Web 产品不再支持这些版本，就提升 target/减少 legacy；Electron build 更可以使用独立 modern-only config，不需要为 Chromium 44 时代浏览器生成兼容层。不能为了减包盲删 legacy，必须先有兼容政策。

第三是模块图：`AITaskPanel` 动态 import Discovery store/analysis，但这些模块在其它路径有 static import，所以不会真正 split。为 task panel 暴露一个轻量 `discoveryTaskController`，不要让它 import 整个分析 graph。Markdown/Mermaid 当前已有部分 lazy 结构；进一步把 highlight.js 改成 core + 明确注册常用语言，或仅在 fenced code block 出现时加载 highlighter。

Bundle gate 应从“legacy entry < 3MB”升级成多预算：initial modern JS、initial legacy JS、font total、Markdown/Mermaid/highlighter 等 named async chunk。这样以后不会通过把代码从一个大 chunk 挪到另一个大 chunk“作弊”。

### 18.39 PERF-02：主线程 stringify 整个 persistence snapshot

`requestIdleCallback` 或把 JSON.stringify 放 Worker 只能缓解 jank，不能解决 pagehide 时还需要复制整个 accountWorkspaces 的根问题。尤其 parked account 本身就重复持有 repositories/releases/gists/forks，大账号越多，单 blob 越大。

推荐两阶段迁移：

**第一阶段低风险优化：** IndexedDB 主路径不要先把完整 snapshot 变成 string；给 storage adapter 增加 structured-clone object 写入，让浏览器 IDB 直接存结构化对象。只有 fallback localStorage 才 JSON.stringify。这样先消除正常 IDB 路径最明显的同步 stringify。

**第二阶段目标结构：** 保留 ADR 要求的“一个 Zustand persisted shell”，但这个 shell 只持久化轻量 preferences、account metadata、auth revision、各 domain version/refs。大型 account-scoped entity 放入 IndexedDB object stores，按 `(accountId, entityId)` 存 repositories/releases/gists/forks 等。Store 仍可以在运行时组合成当前 UI 所需数组，并不意味着引入第二个 Zustand store。

legacy migration 必须 crash-safe：在一个新 DB/version transaction 中复制 current + parked account arrays → 验证 entity/count marker → 写新 shell version → 最后才从 legacy blob 移除大数组；中断后可幂等重跑。full replace 某 account 的 repositories 使用 account-scoped IDB transaction clear+put，保持 membership 原子。

这一阶段会改变 ADR 0001 §107“一个 persistence shell”的实现细节但不必破坏其核心原则；应更新 ADR 明确“一个 Zustand shell ≠ 所有业务大对象必须一个 JSON blob”。

### 18.40 PERF-03：5 秒全 shard polling

PERF-03 与 P1-SYNC-01 实际上应该做成**同一个协议升级**，否则会写两套同步基础设施。

短期客户端先做：只有 authenticated + bound backend account 才启动；页面 hidden/offline 暂停；focus/online/local edit 唤醒；无变化时指数退避并加 jitter；dirty shard 只 push 自己，失败独立 retry。

Server 增加与 CAS 共用的 `sync_revisions`。客户端轮询一个很小的 `/api/sync/revisions`，支持 ETag/`If-None-Match`：没有任何变化返回 304；有变化只返回 changed shard/revision，再 fetch 对应 shard。每个 shard GET 也可带 ETag。

更长期如果需要即时多设备更新，可以用 SSE/WebSocket 发送“revision changed”提示，但 SSE **只能是 hint**：断线重连仍以 durable revision 为事实来源，不能让 event stream 成为唯一同步日志。

客户端只有在某 shard 数据完整 apply 成功后才推进 `lastAppliedRevision`；否则下轮必须继续拉。这个原则能防“请求成功但 Store commit 被 generation guard 拒绝”时误认为已经同步。

### 18.41 PERF-04：RepositoryGroups N×M 扫描

先修数据结构，再讨论 virtualization。当前每个 section 都 `repositories.filter()`，ungrouped 路径内还有 `groups.some()`；customSort 又对 ordered id 做 `members.find()`，每次 render 成本会随着 group/repo 数相乘。

在 `useMemo` 中单次构造一个 index：

- `repoById: Map<number,Repository>`；
- `validGroupIds: Set<string>`；
- `buckets: Map<groupId|null, Repository[]>`，遍历 repositories 一次分桶；
- custom order 建 `orderRank` Map 或按 repositoryOrder 只遍历一次生成 ordered buckets。

render 时 section 直接取 bucket，不再 filter/find；drag/drop、add-existing 查询也复用 `repoById` 和 bucket，而不是重新 `repositories.some/find/filter`。

现有 50 条分批渲染是正向优化，先保留。完成 O(N+G) index 后用 1k/10k repo fixture profile DOM/render；只有 DOM 节点本身仍是瓶颈时，再把 expanded sections flatten 成 rows 做 virtualization 或 `content-visibility`。如果直接在现有 O(G×N) 计算外套 virtualization，每次 state change 仍然先付完分组计算成本，收益有限。

### 18.42 §11.2：AI Workbench 的证据能力边界

当前 candidate verification 在 `aiWorkbenchService.ts:335-423` 明确以 repository metadata + README 为证据，README 缺失就给 `insufficient`，这其实是**保守且可解释的行为**，比没有证据仍让模型“猜一个 verified”安全。问题不应通过“README 失败时让模型凭常识判断”来解决。

如果产品希望把 Workbench 从“README 级候选验证”升级成真正的 repository research，推荐把 verification source 改为分层 evidence policy：

1. Metadata 用于候选召回，不足以产生强 verified claim；
2. README/docs 是第一层低成本证据；
3. 当 README 缺失、或 requirement 明确涉及实现/API/部署时，复用 Repository Chat 已有的 read-documentation → read-code/evidence gate 机制，读取少量相关文件；
4. Release/Issue 只在 requirement 涉及版本、已知问题、兼容性时启用；
5. 每个 candidate 保存 `evidenceKinds`、source refs、unresolved requirements，verified 必须满足最小证据策略，而不是“模型说 verified”。

这不等于让 discovery 阶段无限深研所有候选。搜索仍维持 `verifyCount` 预算，必要时为 README-insufficient candidate 只允许一次有限 escalation，并把成本/覆盖显示给用户。

多仓库 research 的 coverage contract 当前已经存在：`coverage.requested/completed`、pending batches、per-repo missing 会进入最终输出。最优方案是把它固定成 schema/UI contract和测试，而不是重新实现：所有 final answer 必须能追溯到 completed repository；pending/incomplete 不能出现在“已验证比较结论”里；达到预算时允许返回 partial answer，但 coverage 不能被模型文本省略。

### 18.43 已修/已改善历史问题：要转成“不允许回退”的门禁

历史问题里已经修复或明显改善的部分不需要再次改业务逻辑，但应该把修复机制固化成 regression invariant，否则后续重构可能重新引入：

- Node Storage shim：保留 Node 25+ 能力检测测试，但发布工具链仍按 §18.1.3 pin Node 24；
- Compose `API_SECRET`：保留 `${API_SECRET:?…}`，并与 SEC-03 的 Server 启动 fail-closed 双重保护；
- sibling-feature gate：保留并用它作为 A-02 structural default-deny 的范式；
- Workbench `fuseQueryCandidates()`：增加多 query 交错候选 regression，避免未来为了排序重构重新产生第一 query 偏置；
- `ready_to_answer` missing propagation：测试必须断言 dispatcher 的 missing 最终出现在 synthesis/coverage；
- Gist generation/cancel：账号切换/abort 后旧 result 不提交的 deferred-promise test 保留；
- generated `worker.js`：继续由 `check:vector-worker` 保证 source/artifact parity，不要把生成文件重新变成人工双维护。

这些项目应该从“修复 backlog”移到 CI contract；报告中标记为已修并不代表可以删除其测试/门禁。

### 18.44 推荐实施依赖顺序：按“先阻止数据继续错，再升级协议”拆 PR

前文 §14 给了优先级；结合具体实现后，最安全的工程顺序还需要考虑**新旧客户端/Server 混跑**，否则账号 namespace 和 sync CAS 在 rollout 途中本身会产生数据破坏。

**第 0 组：恢复可信门禁。** 先修 typecheck/lint/diff hygiene，统一 Node 24。业务语义不动，但之后每个修复 PR 才有可信的红/绿信号。

**第 1 组：立即安全暴露面。** SEC-01 credential-free errors、SEC-06 auth-before-parser、SEC-03 fail-closed startup 可以独立、小范围先落。它们不依赖账号 schema 重构，不应等大架构。

**第 2 组：Server additive v2 account/sync protocol。** 先增加 accounts/workspace binding、account-scoped schema、`sync_revisions`、v2 scoped GET/PUT/CAS 和 capabilities endpoint；旧 unscoped API 暂时只允许 legacy single-account 模式。新 Server 不应一发布就让旧 client 全坏。

**第 3 组：Client session foundation。** 加 versioned auth journal、process-wide auth/backend epoch、atomic `establishSession`、完整 `AccountScopedSyncState`。此时先不替换全部 autoSync，但建立之后所有异步任务共享的 identity primitive。

**第 4 组：Backend connection lifecycle。** 将 `backend.init` 拆为 pure probe + immutable scoped client + activate；登录/Settings 都迁移。完成后删除 `beforeInit` 清 dirty flag 的旧语义。

**第 5 组：SyncCoordinator v2。** 用 per-target/per-shard localVersion + revision/CAS + retry/conflict 替换 autoSync globals。手动 Push/Pull、Stars completion、Release mutation、import 等凡是修改同步 shard 的入口都必须走同一 revision discipline；不能留“旁路写数据库却不 bump revision”的 API。

**第 6 组：账号长任务与事务语义。** Stars/Lists、Custom Discovery、Workbench、Chat retry、Release mark-all、AGY commit 迁到统一 generation/transaction/commit-point 模式。

**第 7 组：数据 Registry / SecretVault。** 先做 maintenance barrier + AppDataRegistry，再重写 Delete/Backup/Restore。Electron SecretVault 建议在 SEC-05 trusted IPC 基础完成后接入，避免新 vault API 又暴露在旧 IPC 边界上。

**第 8 组：MCP/跨运行时 contract。** 提升 vector/MCP shared contracts，做 backend activeIndex v2、endpoint descriptor/CSP deployment。旧 backend 没 capabilities 时，新 client 必须降级到**明确 single-account pinning**并禁止跨账号 auto-sync，而不是偷偷用旧全局协议。

**第 9 组：架构/性能渐进收口。** View boundary、Store 解耦、god-module strangler、persistence sharding、bundle/font、RepositoryGroups index。不要为了“先把架构变漂亮”而推迟前面的数据完整性和安全修复。

新旧协议兼容有一个硬规则：一旦一个 Server 实例已经创建第二个 account namespace，就必须拒绝旧 unscoped destructive sync（例如返回 `WORKSPACE_REQUIRED`）。否则旧 client 可以绕过 v2 scope 再次覆盖全局/错误 workspace。

### 18.45 修复完成的验收定义

这轮问题很多，不能以“单测数又增加了”作为完成标准。建议把 release acceptance 定义成五个可观察 invariant：

1. **Identity isolation**：任何旧账号/旧 backend/旧 generation 的 async result 都不能修改当前账号 Store，也不能向当前 backend 发后续 mutation；Server A/B account 数据隔离用同 id 数据故意碰撞测试仍互不影响。
2. **Data durability**：logout/delete/restore/cancel/crash 后，重启得到的状态与最后一个已确认 commit point 一致；不存在“UI 说失败/取消，但磁盘或 backend 已偷偷改变”的分叉。
3. **Sync convergence**：两个设备修改不同 shard 不互相覆盖；同 shard revision 冲突得到显式 409/conflict 而非 last-writer-wins；暂时网络故障会自动恢复而不永久 dirty-blocked。
4. **Capability parity/clarity**：UI 只展示 runtime 真有的能力；Backend/Electron 同名 MCP vector 使用同一个 v2 identity contract；部署生成的 URL/CSP 与实际 endpoint 一致。
5. **Security boundary**：credential 不进入 error/log；未认证请求在大 body parse 前被拒绝；private redirect/DNS rebinding 被实际 socket pinning 阻止；Electron privileged IPC 只接受 trusted main frame。

完成以上语义回归后，再要求所有现有 gate 一并全绿：TypeScript、ESLint `--max-warnings=0`、boundary/i18n/plugin/vector checks、前端/Server/Electron 全测试、build、bundle budgets、dependency audit、report-independent `git diff --check`。这样“功能能不能用”与“CI 是否绿”才会重新指向同一个质量结论。
