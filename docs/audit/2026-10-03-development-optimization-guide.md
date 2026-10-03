# GSM 深度工程审计与开发优化指导

> 审计日期：2026-10-03
> 工作区：`/folder/GSM`
> 当前分支：`codex/selective-v0.8.5-p0.2.0`
> 审计时 HEAD：`51d9e67`
> 根包版本：`0.8.4`
> 说明：本报告基于**当前实时工作树**，其中存在未提交开发改动；因此行号只用于快速定位，长期应以文件名、符号名和测试名为准。

## 1. 文档用途

这份文档用于指导 GSM 后续开发，而不是单纯罗列代码味道。目标是回答五个问题：

1. 哪些问题会随着仓库规模、数据量、功能数量增加而迅速放大；
2. 哪些问题会造成数据丢失、安全边界失效、部署不可用或难以恢复；
3. 哪些历史架构已经有更好的替代实现，应当完成迁移而不是继续维护两套路径；
4. 哪些机制已经做得很好，应当成为全项目统一模式；
5. 后续 PR 应以什么验收标准判断“优化真正完成”，而不是只看功能能否运行。

本报告继承并更新 `docs/audit/2026-09-29-full-functionality-deep-audit.md` 的结论。9 月 29 日之后，Repository Identity、Home v2、WebDAV、Plugin、Discovery、桌面启动、任务系统等区域已有大量改动，所以旧报告不能直接作为当前待办。本文把结论分为：

- **仍存在**：当前代码中仍可直接复现或静态确认；
- **深化问题**：原问题已经部分治理，但底层增长风险仍在；
- **新发现**：本轮新增；
- **已形成良好模式**：不再列为问题，而是要求其他模块复用。

## 2. 当前工程基线

### 2.1 验证结果

本轮直接在当前工作树执行：

| 检查 | 当前结果 | 说明 |
|---|---|---|
| `npm run typecheck` | ✅ 通过 | 根 TypeScript build 无错误 |
| `npm run check:boundaries` | ✅ 通过 | 但现有规则存在覆盖模型缺陷，见 ARCH-02 |
| `npm run check:plugin-registry` | ✅ 通过 | 社区插件 registry 语义检查正常 |
| `npm run check:i18n` | ❌ 失败 | ja/es/pt-BR/ru/zh-TW/fr/de/ko 各缺 55 个 `chat:overview.*` key |
| `npm run lint` | ❌ 失败 | 当前输出 60 errors / 14 warnings；另有 `home-backend` 生成产物被错误纳入扫描 |
| `npx vitest run` | ✅ 通过 | 274 files / 2948 tests |
| `npm --prefix server test` | ✅ 通过 | 38 files / 358 tests |

测试体系本身已经相当强。当前最重要的问题不是“测试数量少”，而是**质量门禁不闭环**：lint/i18n 已红、server tests 未进入根 CI、Electron JS 没有实际 lint 规则、coverage 没有阈值。

### 2.2 前一轮生产构建基线

前一轮对同一项目执行不触发版本同步的 Vite production build 得到：

- 总产物约 `22.87 MiB`；
- JS 约 `18.99 MiB`；
- legacy JS 约 `9.72 MiB`；
- 232 个 legacy JS 与 231 个 modern JS；
- 159 个字体文件，约 `2.93 MiB`；
- 最大 modern entry 约 `1.48 MiB`；
- 最大 legacy entry 约 `1.69 MiB`。

这些数字不是当前发布承诺，而是后续 bundle 优化的量化起点。

## 3. 总体判断

GSM **不需要重写**。项目已经具备很多成熟基础：严格 TypeScript、大量真实行为测试、Electron `sandbox/contextIsolation`、Plugin Page/WebDAV trusted-frame 校验、Home v2 的 Outbox/Shadow/事务模型、Repository Identity maintenance barrier、Server SQLite 在线备份、AI rate limiter、任务恢复与账号隔离等。

现在最主要的工程矛盾是：

1. **新架构与旧架构长期并存**：Home sync v2 已经是增量协议，但 legacy `autoSync` 仍在做 5 秒全量同步；
2. **数据域已经分散到多个数据库，但管理能力仍是手写清单**：删除、备份、恢复无法保证覆盖所有域；
3. **全局 Store 和浏览器事件逐渐变成隐式 Service Locator / Event Bus**；
4. **规模控制仍依赖“先全部读出来，再在 JS 中筛选/序列化/比较”**；
5. **Electron/Server 已经有局部安全边界，但还没有统一 privileged boundary**；
6. **CI 的“存在”不等于“覆盖”**：Electron JS、server tests、a11y、coverage、容器可达性都存在空白；
7. **发布和恢复链路弱于运行时代码质量**：容器监听、迁移前备份、密钥恢复、签名与 provenance 需要补齐。

## 4. 优先级定义

- **P0**：可能造成远程代码获得桌面权限、数据不可恢复、标准部署不可用，或当前主质量门禁长期失真。应优先阻断新增风险。
- **P1**：会随着数据量/功能增长显著恶化，或是数据一致性、安全、运行可靠性的核心架构缺口。
- **P2**：明显影响维护成本、性能、UX、可访问性和长期扩展，应在完成 P0/P1 后系统治理。
- **P3**：供应链、开发体验、优化预算和未来能力，为长期工程化建设。

---

# 5. P0：必须优先处理

## SEC-01：建立统一 Electron Trusted Renderer Boundary

**状态：仍存在 / 高风险。**

当前 `electron/main.js` 创建窗口时已经正确设置：

- `nodeIntegration: false`；
- `contextIsolation: true`；
- `sandbox: true`；
- `webSecurity: true`。

但 `electron/main.js:289-300` 的 `will-frame-navigate` 对 `event.isMainFrame` 直接 `return`，没有阻止主文档跨源导航。同时 `electron/preload.js:3-83` 对任何主 frame 暴露完整 `electronAPI`。

以下高权限 IPC 当前没有统一验证 `event.senderFrame.url`：

- X Cookie：`x-auth:get/save/clear`；
- Proxy：`get-proxy/set-proxy/test-proxy`；
- Desktop prefs；
- MCP config/start/stop/snapshot；
- 部分 HTML Reading / AGY 调用只验证 window/mainFrame identity，没有验证当前 URL。

Plugin 与 WebDAV 已经有正确范例：

- `electron/plugins/pluginIpc.js` 的 `isTrustedPluginFrame()`；
- `electron/webdavIpc.js` 的 `isTrustedWebdavFrame()`。

### 根因

Electron 权限检查目前按功能零散实现，没有“主文档可信来源”这一统一 primitive。`contextIsolation` 和 `sandbox` 只能限制 renderer 本身，不能替代 IPC 调用方鉴权。

### 目标状态

抽出统一的：

```text
TrustedRendererPolicy
  ├─ production: exact file://.../dist/index.html
  ├─ development: exact configured loopback origin
  ├─ reject credentials / unexpected query / unexpected origin
  └─ isTrustedMainFrame(event)
```

所有 privileged handler 通过一个 registrar 注册，例如：

```text
registerTrustedIpc(channel, schema, handler)
```

同时主 frame navigation 只允许当前 app document 的合法 same-document 导航；外部 URL 走 `shell.openExternal`，不得替换主文档。

### 验收

- 恶意 HTTPS 主 frame 无法调用任何 X Auth / Proxy / MCP / Desktop / HTML Reading / AGY privileged IPC；
- `will-navigate` / `will-frame-navigate` 对未知主文档 URL 必须阻止；
- 开发 Vite loopback origin 正常工作；
- 所有 privileged channel 有 untrusted sender 和 subframe 测试；
- 新增 IPC 若不经过统一 registrar，CI 失败。

---

## DATA-01：建立统一 App Data Registry，修复“删除全部数据”语义

**状态：新发现 / 高数据治理风险。**

`DataManagementPanel.deleteAllData()` 当前只显式清理：

- 主 Zustand/IndexedDB key；
- Weekly Issues；
- X Tweet；
- Telegram；
- Electron X Auth 凭据。

但项目实际还存在独立数据域：

- `gsm-repository-chat-db`：Repository Chat / Workbench sessions/messages/evidence/projects/proposals；
- `gsm-discovery-workspace`；
- `gsm-custom-discovery`；
- `github-stars-discovery-analysis`；
- `gsm-repository-analysis-assets`；
- `gsm-html-reading`；
- `gsm-home-v2-${namespace}`；
- AI task journal / research checkpoints / 多个 localStorage/sessionStorage key。

`clearAllStorage()` 只删除 `indexedDBStorage.removeItem('github-stars-manager')`，并不等价于删除这些独立 DB。

### 根因

每新增一个本地数据域，作者需要记得手工修改 Settings 的删除/导出/备份逻辑。项目没有一个机器可读的数据资产清单。

### 目标状态

新增 `AppDataRegistry`，每个数据域必须注册：

```ts
interface AppDataDomain {
  id: string;
  scope: 'account' | 'device' | 'workspace';
  containsSecrets: boolean;
  schemaVersion: number;
  quiesce?(): Promise<void>;
  export?(ctx): Promise<DomainBackup>;
  previewImport?(backup, ctx): Promise<Preview>;
  import?(backup, mode, ctx): Promise<void>;
  clear(ctx): Promise<void>;
  stats?(ctx): Promise<DataStats>;
}
```

Settings 的“删除全部”“导出”“WebDAV backup”“诊断存储占用”都只调用 Registry，不再知道具体 IndexedDB 名称。

### 验收

- 自动测试枚举所有 app-owned IndexedDB/localStorage/sessionStorage 数据域，并要求在 Registry 中登记；
- “删除全部数据”完成后重新启动，所有用户内容均为空；
- 任意一个域 clear 失败时，不提示“全部删除成功”；
- 新增数据库而未注册时 CI 失败。

---

## DATA-02：把 Restore 变成两阶段、可回滚的维护操作

**状态：仍存在 / 高数据一致性风险。**

`useBackupActions.restore()` 当前顺序是：

1. 下载 JSON；
2. `JSON.parse()`；
3. 先 `importDiscoveryWorkspaceBackup(..., 'replace')`；
4. 写 Zustand repositories/releases；
5. 再逐段恢复 release state、AI config、WebDAV、proxy、RPC、route mode、backend secret；
6. 多数域失败只增加 `restoreWarnings`；
7. 最终仍可能显示 restore success，并将 task 标为 `partial`。

`DataManagementPanel` 的导入也存在类似跨 IDB/Store 多阶段写入。

Home v2 的 `HomeDatabase.importBackup()` 已经展示了更好的模式：schema 验证、identity binding、20 MiB 限制、拒绝 in-flight/unconfirmed task、多个 object store 在同一 IDB transaction 中提交。

### 目标状态

新增 `RestoreCoordinator`：

1. **Preflight**：完整 parse、schema version、identity、size、domain inventory、secret policy；
2. **Prepare**：每个 domain 生成 mutation plan，不写真实状态；
3. **Quiesce**：进入 app-wide maintenance barrier，停止 sync/task/background writers 并 drain；
4. **Checkpoint**：生成 rollback snapshot/journal；
5. **Commit**：按 domain commit；
6. **Verify**：重新读取关键 invariants；
7. **Rollback**：任意不可接受失败回滚；
8. **Resume**：退出 maintenance，再重新启动 sync。

若某些非关键域允许 partial restore，必须在 backup manifest 显式声明 optional，而不是通过散落的 `try/catch` 决定。

### 验收

- 在任意 domain 注入失败，核心域恢复到 restore 前状态；
- restore 期间后台 sync/AI/task 不得重新写入旧数据；
- 账号切换立即中止 restore；
- backup version 不支持时，在任何写入发生前失败；
- UI 明确区分 `success` / `rolled-back` / `partial-optional` / `failed`。

---

## DEPLOY-01：修复 Docker 容器监听地址

**状态：新发现 / 高部署风险。**

`server/src/config.ts`：

```ts
host: process.env.HOST || '127.0.0.1'
```

`server/src/index.ts` 使用：

```ts
app.listen(config.port, config.host)
```

但当前：

- `docker-compose.yml` backend 没有设置 `HOST`；
- `docker-compose.fullstack.yml` 没有设置 `HOST`；
- `server/Dockerfile` 没有设置 `HOST`；
- `Dockerfile.fullstack` runtime 没有设置 `HOST`。

容器中的 `127.0.0.1` 只监听容器 loopback，不能满足 split frontend → `backend:3000`，也不能满足 host `-p 8080:3000` 访问 fullstack 服务。

### 目标状态

- 本机裸运行仍默认 `127.0.0.1`；
- Docker runtime 显式 `HOST=0.0.0.0`；
- 容器暴露依赖 `API_SECRET`、Docker network 与端口配置，而不是 loopback 偶然保护。

### 验收

- `docker compose up` 后 frontend 容器能访问 `backend:3000/api/health`；
- fullstack `localhost:8080/api/health` 可访问；
- 容器 healthcheck 实际通过；
- 无 `API_SECRET` 的 production container 启动失败。

---

## QUALITY-01：先恢复可信的绿色质量门禁

**状态：当前工作树直接失败。**

目前：

- lint：60 errors / 14 warnings；
- i18n：8 个 locale 各缺 55 key；
- Electron/script JS 的 ESLint rules 实际为空；
- `home-backend/` 被 Git 忽略但没有被 ESLint global ignore，导致本地发布产物被扫描；
- server 358 tests 当前通过，但根 `test:run` / CI 未强制执行 server tests。

### 目标状态

PR 必须先具备“可相信的红/绿信号”，再扩功能。

建议最小门禁：

```text
eslint source + electron + scripts --max-warnings=0
tsc
boundary checks
i18n parity/hardcoded copy
root vitest
electron node tests
server vitest
server build
bundle budget
container smoke
```

### 验收

- 主分支所有上述 gate 绿；
- Electron JS `--print-config` 不再是 `rules: {}`；
- `home-backend`, generated dist, output 等目录不进入 lint；
- server test 失败可以阻止 PR；
- warning 不再无限积累。

---

## DEV-01：统一 Node Toolchain 支持矩阵

当前运行环境存在跨 major 漂移：

- GitHub Actions CI：Node 24；
- `Dockerfile.fullstack` / `server/Dockerfile`：Node 22；
- 根 `@types/node`：`^26.3.0`；
- 仓库没有统一的 `engines` / `.node-version` / `.nvmrc` 作为开发入口约束。

这类漂移对纯 TS 代码不一定立即报错，但会影响：

- Node global/type surface；
- Vitest/jsdom 行为，例如当前大量 `--localstorage-file` warning；
- `better-sqlite3` 等 native dependency；
- ESM/module resolution；
- CI 与 Docker 中难复现的版本差异。

### 方向

明确支持矩阵，而不是所有地方各选一个版本。例如：

```text
development / CI primary: Node 24
production Docker: Node 24
@types/node: 24.x
optional compatibility job: Node 22（只有明确需要支持时保留）
```

如果生产必须继续 Node 22，则 CI 必须增加 Node 22 runtime/build/test job，并把 `@types/node` 选择解释为有意行为。

### 验收

- 新 clone 后工具能明确提示应使用的 Node major；
- CI primary、Docker runtime、Node types 没有无说明的 major 分叉；
- native dependencies 在正式 runtime major 上构建和 smoke test。

---

# 6. P1：核心架构与可靠性

## SYNC-01：完成 legacy `autoSync` → canonical sync v2 迁移

**状态：深化问题。**

`src/services/autoSync.ts` 仍保留：

- `POLL_INTERVAL = 5000`；
- 每轮并发全量取 repositories/releases/AI/WebDAV/Embedding/Vector/settings；
- 对大对象做 `JSON.stringify` 指纹；
- Store 任意相关变化后 2 秒 debounce 整表 push；
- backend adapter 可一次拉 `limit=10000`。

与此同时，`src/home/sync.ts` + `src/home/database.ts` + `server/src/services/syncV2.ts` 已具备：

- durable outbox；
- cursor pull；
- operation idempotency；
- shadow version；
- conflict；
- snapshot；
- account/workspace identity；
- maintenance barrier。

### 方向

不要继续优化 legacy 全量 hash/poll。制定“哪些 collection 尚未进入 v2”的迁移表，逐域迁入，最终删除：

- full repository/release push；
- 5 秒全量 pull；
- `_lastHash`；
- 全局 `quickHash(JSON.stringify(...))`；
- 两套冲突/同步语义。

### 验收

- 常规单记录修改只产生 O(1) 或与变更量相关的网络/序列化成本；
- 空闲设备不再每 5 秒拉全量数据；
- 离线编辑、重启、重复 ACK、冲突、账号切换测试覆盖；
- legacy sync endpoint 使用量归零后再删除兼容代码。

---

## STORE-01：保持一个逻辑 Store，但拆分持久化物理快照

`src/store/persistence/options.ts` 将 repositories、releases、gists、分类、配置、UI、订阅等大量数据组成一个 persist snapshot；`src/store/persistence/storage.ts` 最终一次 `JSON.stringify(value)` 后写一个 IndexedDB value。

代码注释已经记录过数 MB discovery 对象在 Electron/V8/macOS 导致 JIT CHECK 崩溃的历史。

### 方向

ADR 可以继续维持一个逻辑 Zustand Store，但存储层改为：

```text
store-manifest
store-ui
store-auth-metadata
store-repositories
store-releases
store-config
store-organization
```

每个 shard：

- 独立 schema/version；
- dirty write；
- 独立 metrics；
- 独立迁移；
- 大实体优先 row-granular，而不是整个数组 JSON。

注意：当前 `storage.ts` 使用单例 `latestPersistName/latestPersistValue`，如果未来多 key 并行持久化，需要改成 per-key scheduler map，不能简单把一个 key 拆成多个 key 后复用现实现。

另外，不应依赖 `pagehide/beforeunload` 上的异步 IndexedDB write 作为唯一最后提交；浏览器/renderer 退出不保证等待 Promise。关键数据应在变更发生时已经进入 durable queue。

---

## DATA-03：Backup Manifest 必须与 Data Registry 自动对齐

当前 WebDAV backup `version: '1.2'` 手工组装字段；repository chat/workbench、HTML Reading 等独立域不在其中。手工导出与 WebDAV backup 的覆盖范围也不一致。

### 方向

Backup 使用版本化 manifest：

```json
{
  "format": "gsm-backup",
  "version": 2,
  "createdAt": "...",
  "identity": { "githubUserId": "...", "workspaceId": "..." },
  "domains": {
    "repositories": { "schemaVersion": 3, "required": true, "checksum": "..." },
    "repositoryChat": { "schemaVersion": 2, "required": false, "checksum": "..." }
  },
  "secrets": { "included": false }
}
```

CI 应比较 `AppDataRegistry` 与 Backup adapters：新增 durable domain 后，如果没有明确 `backup: included|excluded(reason)`，测试失败。

---

## DATA-04：Legacy `/sync/import` 必须明确 merge / replace 语义

当前 legacy server import 的多个集合主要是 upsert：备份里不存在的旧行不会自动删除，空数组也不一定表示“清空”。因此它不能被称为严格 snapshot restore。

### 方向

API 显式要求：

- `mode: merge`：只 upsert 输入内容；
- `mode: replace`：输入被视为完整 snapshot，缺失记录需要事务性删除；
- `mode: preview`：只给 diff/count/conflict。

不要通过“数组为空/字段缺失”隐式推导语义。

---

## DATA-05：Legacy Server Export/Import 的 Secret 语义在 fresh restore 下不闭合

`server/src/routes/sync.ts` 导出 AI/WebDAV config 时会正确删除 `api_key_encrypted` / `password_encrypted`，只保留 masked 信息，避免备份泄露 secret。

但 import 时的逻辑是“如果目标 DB 已存在同 ID config，就保留 existing encrypted secret；否则 existing secret 为 `null`”。与此同时 schema 定义：

- `ai_configs.api_key_encrypted TEXT NOT NULL`；
- `webdav_configs.password_encrypted TEXT NOT NULL`。

因此“从一份安全脱敏的 legacy export 恢复到全新空库”没有完整语义：既不能恢复 secret，又可能试图把 `null` 写入 NOT NULL 列。

### 方向

必须明确脱敏备份的 config 行是什么：

- 如果没有 secret，导入为 `disabled / credentialMissing` 的 inert config；或
- fresh restore 跳过该 config 并返回 structured warning；或
- secret 通过独立加密 secret package 恢复。

不要让 masked string 或 `null` 冒充有效 credential。

### 验收

- 空数据库导入安全脱敏 export 不发生 SQLite constraint error；
- 导入后缺 secret 的 AI/WebDAV config 不会被标为 active/available；
- 已有 DB merge 时可保留原 secret；
- export 永远不泄露 encrypted/plaintext secret。

---

## DATA-06：修复 Server 迁移前备份条件

`server/src/index.ts` 当前只有 `schema_version < 3` 才 `backupBeforeMigration()`，但 migrations 已经到 v4。

这意味着 v3 → v4 和未来 v4 → v5 不会自动产生 migration backup。

### 方向

从 migration registry 计算 `targetVersion`：

```text
if existingVersion < targetVersion:
  verified migration backup
  run migrations
```

禁止把具体版本 `3` 写死在启动流程。

---

## DATA-07：数据库备份与加密密钥必须形成一个恢复单元

Server 的 SQLite backup 本身设计良好：online backup、`integrity_check`、`.partial`、chmod、rename、rotation。

但 encrypted credentials 依赖 `data/.encryption-key` 或环境变量 `ENCRYPTION_KEY`。当前 DB backup 只保存 SQLite，scheduled backups 又位于同一个 `/app/data` volume。

因此存在两个恢复问题：

1. 整个 volume 丢失时，DB + backup + auto-generated key 一起丢；
2. 只拿 `.sqlite` 文件恢复但没有原 key，数据库结构正常，credentials 却不可解。

### 方向

- Backup manifest 记录 non-secret `keyId/fingerprint`；
- 文档要求加密密钥作为独立受保护恢复材料保存到 volume 外；
- 服务启动增加 encrypted sentinel 验证，错误 key 应在正式 listen 前显式失败；
- 提供正式 restore runbook/CLI，而不是只有未调用的 `restoreBackup()` helper。

---

## SYNC-02：控制 sync v2 snapshot / receipt / conflict 的长期增长

### Snapshot

`snapshotPage()` 首次调用会把全部 `sync_v2_records` 逐条复制到 `sync_v2_snapshot_rows`，每个 snapshot TTL 24h。当前没有每 workspace snapshot 数量或字节上限。

### Operation receipts

`sync_v2_operations` 为了 idempotency 永久写 `(client_id, op_id, digest, result)`，`pruneSyncHistory()` 不清理。

### Conflicts

`sync_v2_conflicts` 同样持续增长，没有明确 retention/resolve lifecycle。

### 方向

- 同 workspace 最多一个/有限个 active snapshot，重复请求复用；
- 为 snapshot 设总 row/byte budget；
- operation receipt 定义 replay window；超过窗口保留最小 high-watermark/tombstone；
- conflict 有 `resolved_at/status` 与 retention；
- diagnostics 输出各表 rows/bytes/oldest age。

---

## API-01：所有网络 JSON 必须从 `unknown` 进入 runtime schema

`backendAdapter.ts` 多处将 `res.json()` 直接断言为：

- `Repository[]`；
- `Release[]`；
- `AIConfig[]`；
- WebDAV/Embedding/Vector configs。

之后 `autoSync`/settings 直接写入 Store。TypeScript 断言对远端/旧版本响应没有保护作用。

### 规则

网络边界统一：

```text
Response -> unknown -> schema.safeParse -> domain DTO -> Store
```

解析失败必须产生明确 `PROTOCOL_INVALID`，不得把半合法对象写入状态。

优先复用现有 Home v2、Discovery、Plugin manifest 中已经使用的 Zod 模式。

---

## SEC-02：完善 Server SSRF 防线

`proxyService.validateUrl()` 当前可拒绝 URL 文本中的 literal loopback/private IP，但：

- 没有 DNS resolution 后的地址分类；
- Axios redirect target 未逐跳重新验证；
- hostname 可解析到私网；
- public → 30x → private 的目标未验证。

此外，saved AI config 使用 `allowPrivate=true` 是产品为本地模型提供的明确能力，但其权限边界应该和普通 proxy 分开。

### 方向

- strict mode：DNS resolve 所有 A/AAAA 并拒绝 private/link-local/loopback/IMDS；
- redirect：禁用自动 redirect 或每一跳重新验证；
- 对 DNS rebinding 做连接地址约束；
- “允许访问本地 AI”成为单独 admin capability + allowlist，不由拥有通用 API secret 自动获得；
- 保留 local Ollama 等合法用例，但让风险显式。

---

## DB-01：补齐外键与高频查询索引

### 外键

`releases.repo_id` 当前只是 `INTEGER NOT NULL`，没有 `REFERENCES repositories(id)`。虽然连接打开了 `PRAGMA foreign_keys=ON`，但这个字段没有 FK，因此仍可产生 orphan release。

### 索引

高频查询包括：

- releases：`repo_id` / `is_read` + `published_at DESC`；
- repositories：`stargazers_count DESC`；
- repository search：多个 `%LIKE%`；
- MCP latest release：`repo_id + published_at`。

当前几乎没有相应业务索引。

### 方向

先用生产规模 fixture + `EXPLAIN QUERY PLAN` 确认，再增加至少：

```sql
releases(repo_id, published_at DESC)
releases(is_read, published_at DESC)
repositories(stargazers_count DESC)
```

文本搜索应评估 FTS5，而不是为 `%LIKE%` 盲目建普通索引。

---

## PERF-01：Repository 列表从“累积加载”升级为真正窗口化

`RepositoryList` 的 50 条 batch 只是限制初始 render；IntersectionObserver 每次增加 `visibleCount`，滚过的旧卡片不会卸载。千级仓库后 DOM 数量仍持续增长。

同时：

- `RepositoryCard` 每张卡订阅整个 `releases`；
- 每张卡 `filter + sort` 找 latest release；
- CategorySidebar 对每个 category 重扫 repositories；
- RepositoryGroups 对 group/member/order 多次 filter/find。

### 方向

1. 真正 windowing/virtualization；
2. `latestReleaseByRepoId` 预索引；
3. 一次遍历构建 `reposByCategory` / `reposByGroup` / `repoById`；
4. 单实体 selector；
5. 性能基准以“10k repositories + 50k releases”作为压力 fixture，而不是等真实用户遇到卡顿。

---

## PERF-02：降低 App 根组件对大集合的订阅

`selectAppShellState` 包含 `repositories`、`searchResults`，`App.tsx` 根组件订阅后再把数组传入 Repository view。

单 repo 更新通常会生成新数组，因此根级 render 范围过大。

### 方向

App shell 只订阅：

- auth/hydration；
- currentView/navigation；
- theme/language。

repositories/search results 下沉到 repositories feature。中长期将大集合正规化为 entities + ids，UI 订阅单实体/小集合 ID。

---

## ARCH-01：减少 Store 作为 Service Locator

生产代码中约有 270 处 `useAppStore.getState()`。它已经被大量 service 当作全局配置/身份/数据 locator。

### 风险

- service 隐式依赖账号、route mode、token、配置；
- 单元测试必须 mock 全局 Store；
- 多账号/后台任务/并发上下文容易读到“当前”而不是“请求开始时”的身份；
- Browser/Electron/Server 共享纯逻辑困难。

### 方向

在 UI/application boundary 捕获 immutable request context：

```ts
type RequestContext = {
  accountId: string;
  githubToken: string;
  routeMode: RouteMode;
  backend: BackendClient;
  signal?: AbortSignal;
};
```

Service 显式接收 context/ports，不在执行中任意读取 global Store。

---

## ARCH-02：把 frontend boundary 从“黑名单”改成“允许模型”

ADR 规定 View 不直接调用业务 services，但 ESLint/check-boundaries 通过一个手工 `BANNED_COMPONENT_SERVICES` 数组维护禁用项。

新 service 增加后如果忘记加入数组，View 可以直接 import，规则仍绿。当前已有 `DataManagementPanel`、`AgyLocalResearch`、`PluginRegistrySection` 等直接调用不在黑名单中的业务 service。

### 方向

View 层改为：

- 默认禁止 `services/**`；
- 只 allowlist 明确 infrastructure；
- feature-local orchestration 进入 hooks/application；
- 每个新 service 不需要同步维护黑名单。

---

## ARCH-03：收敛 `window CustomEvent` 隐式事件总线

当前项目有大量字符串事件：

- `gsm:global-chat-history-changed`；
- `gsm:navigate-to-settings-tab`；
- `gsm:task-navigate`；
- `gsm:select-workbench-session`；
- `gsm:repository-sync-visual-state`；
- `gsm:html-reading-settings`；
- `gsm:custom-discovery-changed` 等。

监听方多处通过 `CustomEvent<...>` 手工强转 detail，缺少中央 contract。

### 方向

优先把导航、task、sync 状态改成明确 feature API/store。确实需要跨模块 event 的部分集中成：

```ts
type AppEventMap = {
  'chat-history-changed': { owner: string; source?: string };
  'navigate-settings': { tab: SettingsTab };
  ...
};
```

统一 `emitAppEvent/onAppEvent`，并在一个文件登记所有 persistent storage keys。

---

## ARCH-04：Home Desktop Chat/Discovery 捕获改为 record-level delta

`src/home/desktop.ts` 收到 Chat/Discovery changed event 后，会：

1. export 整个 Workbench/Custom Discovery；
2. 构建旧 Map；
3. 对每条 `JSON.stringify` 比较；
4. 生成 Home v2 edits。

历史量变大后，一条消息变化也触发整个域 export/diff。

### 方向

让 storage transaction 在成功提交时产生 typed mutation：

```text
{ collection, id, beforeVersion, data|null }
```

Home sync 直接消费 record delta，不再通过“全量导出后猜变化”。

---

# 7. P2：前端体验、可维护性和长期规模

## UI-01：ErrorBoundary 区分 app / feature / panel 恢复语义

`ErrorBoundary` 当前始终使用全屏 fallback，唯一主要恢复动作是 reload，但它同时被用于局部 Repository/Plugin/Discovery 子树。

### 方向

支持：

- `variant="app" | "feature" | "panel"`；
- `resetKey`；
- `onReset/onClose`；
- 局部 retry；
- sanitized diagnostic copy。

局部组件崩溃不应让整个应用失去导航上下文。

---

## A11Y-01：建立自动化 a11y gate，并统一 Tabs

项目已经有不少 `aria-*`，但没有 `eslint-plugin-jsx-a11y` / axe gate。

多个页面手写 `role=tab/aria-selected`，但没有完整 roving tabindex、Arrow/Home/End keyboard model。仓库已有 Radix Tabs，应该统一使用。

具体可访问性缺陷例子：`RepositoryCard` AI analysis error 的 HelpCircle 是 hover-only 自定义 tooltip，键盘与读屏无法可靠进入；同卡片的 description 已使用 Radix Tooltip，是可复用的正确模式。

### 验收

- key views 通过 axe smoke；
- tablist 只 active tab `tabIndex=0`；
- Arrow/Home/End 行为符合 ARIA Tabs；
- tooltip/popover 可通过 keyboard focus 打开；
- Dialog/Sheet close label 使用当前语言。

---

## I18N-01：停止 zh/en 二元 UI 分支

应用支持 10 locale，但仍有多处：

- `navigator.language.startsWith('zh') ? 中文 : English`；
- 局部 `txt/l()` helper；
- ErrorBoundary 只有 zh/en；
- HTML Reading 大量硬编码中文。

当前 i18n gate 已经因为 `chat:overview.*` 在 8 个 locale 缺 55 keys 而失败，说明多语言维护正进入规模拐点。

### 规则

- 所有 app-owned user-visible copy 必须进入 locale files；
- 只有外部内容/用户生成内容可绕开；
- 禁止新增 zh/en ternary；
- ErrorBoundary / startup / offline fallback 也必须使用 app locale 或最小 10-locale emergency dictionary。

---

## HTML-01：修复 HTML Reading 并发、账号 generation 与错误吞噬

`useHtmlReadingLifecycle.ts` 存在：

- `.catch(() => api.failed(...))`，如果 `failed()` 自己 reject，可能形成未处理 rejection；
- configure failure `.catch(() => {})` 完全静默。

`useHtmlReading` 还使用 React state `busy` 作为互斥，同一次 render 内双击可以同时通过；异步 save/verify/clear 晚返回时缺少 account generation guard。

### 方向

- ref-based mutex；
- operation generation + captured account；
- 可取消请求使用 AbortController；
- late result 必须先检查 generation/account；
- configure/send/failed 失败进入统一 logger + UI task state。

---

## NAV-01：建立中央 View/Navigation Runtime Contract

`currentView` 被持久化，Task target 的 `view` 只是 `z.string()`，随后 UI 会强转为合法 view；未知值最终可让 App `switch default` 返回 null。

### 方向

中央定义：

```ts
export const APP_VIEWS = [...] as const;
export const appViewSchema = z.enum(APP_VIEWS);
```

以下全部复用：

- Zustand state type；
- setter；
- persisted migration；
- task target；
- navigation events；
- deep links。

非法值回退到 `repositories`，不进入 UI state。

---

## IPC-01：Electron preload contract 单一来源

当前 `preload.js` 手写 exposed API，renderer 侧又在 `electronProxy.ts`、`desktopApi.ts`、`types/agy.ts` 等独立维护类型。

### 方向

至少建立可测试的 channel/contract registry；更理想是 schema 驱动生成 preload wrappers + renderer type。

关键 response 仍需 runtime parse，不能因为 IPC 在本机就只依赖 TS。

---

## PERF-03：Settings / Discovery 做 feature-level lazy loading

App 已 lazy Settings view，但 SettingsPanel 进入后会通过 barrel 静态加载大量 panel。Discovery 也有类似问题。

### 方向

- tab registry：每个重面板独立 dynamic import；
- 局部 Suspense/ErrorBoundary；
- hover/idle prefetch 可选；
- General tab 不应加载 AI/vector/plugin/HTML Reading runtime。

---

## PERF-04：清理“看似 lazy，实际静态引用”的 chunk 边界

Vite build 已明确报告若干模块同时被 dynamic 与 static import，例如：

- `repositoryChatStorage`；
- Discovery custom model/storage/store/analysis。

这种 dynamic import 不会产生真正独立 chunk。

### 方向

把 feature-independent types/schema/pure helpers 抽出，避免 lazy feature 的 runtime module 被 App/common service 静态反向引用。

---

## PERF-05：重新评估 Legacy Browser 构建

`vite.config.ts` 当前 targets 包括 Chrome 60 / Firefox 60 / Safari 12，并启用 modern polyfills，导致现代包之外再生成接近完整的一套 legacy JS。

### 方向

- Electron build：modern-only；
- Web build：按真实支持矩阵决定 targets；
- 若无需这些老浏览器，删除 legacy plugin 或显著提升 target；
- 分 Electron/Web build profiles，而不是一套最保守 bundle 服务所有平台。

---

## PERF-06：字体按主题/用户选择加载

`src/main.tsx` 当前静态 import 15 个 fontsource family，前一轮 build 产生 159 font files / 约 2.93 MiB。

默认启动只需要默认字体。其他字体应按主题选择 dynamic load，并允许缓存。

---

## ARCH-05：拆分 God Modules，但按职责拆，不按行数拆

当前大模块包括：

- `aiService.ts`：provider transport、SSE、retry、解析、领域 prompt；
- `githubApi.ts`：transport/rate limit/proxy + repo/gist/release/issues/workflow；
- `repositoryChatService.ts`：retrieval、evidence、prompt、answer validation；
- `DataManagementPanel.tsx`：数据域 orchestration + UI；
- `RepositoryCard.tsx` / `SearchBar.tsx` / `AIWorkbench.tsx`：多个用例与 UI 状态混合。

建议模块边界：

```text
transport /
protocol /
domain /
application /
storage /
ui /
```

先拆纯 parser/request builder/schema，再拆 orchestration，最后拆 UI。不要只把 2000 行切成五个 400 行文件但仍然互相引用所有内部状态。

---

## CORE-01：共享 AI/Embedding/MCP 纯协议 Core

Browser、Electron MCP、Server MCP 维护相似的：

- provider URL/body；
- embedding request/response parsing；
- MCP tool definitions/schema；
- repository evidence/stats projection。

### 方向

建立不依赖 DOM/Node/SDK 的纯 core package/module：

```text
request builder
response parser
tool JSON contract
projection/search predicates
error normalization
```

各 runtime 只注入 fetch、secret、storage、transport。

---

## DB-02：MCP 搜索/统计下推 SQLite

`server/src/mcp/provider.ts` 当前 `loadAllRepositories()` 最多读 50,000 rows，再用 JS filter/sort/stats。

### 方向

- filters / pagination / sorting 下推 SQL；
- language/license/stats 用 GROUP BY；
- text search 用 FTS；
- tags 如果仍存 JSON，应评估独立 normalized tag table/FTS strategy；
- 只 select tool response 真正需要的列。

---

## DB-03：限制 legacy import 与大 JSON 的 event-loop 占用

`express.json({ limit: '50mb' })` 当前在 auth middleware 之前全局安装；legacy sync import 可接收大数组并在 better-sqlite3 同步 transaction 中逐条执行。

### 方向

- 全局 body limit 降低；
- 大导入 route 在认证之后单独配置 limit；
- 每集合 count、每字段 bytes、总 records 硬限制；
- 超限尽早 413/400；
- 大导入分批并报告进度；
- 建立 event-loop/health latency benchmark。

---

## CACHE-01：Repository Chat IndexedDB fallback 必须可恢复

`repositoryChatStorage` 一旦进入 fallback mode，会持久化 `FALLBACK_MODE_KEY=1`，之后使用 whole localStorage snapshot；当前没有健康 probe + 自动迁回 IndexedDB 的完整路径。

瞬时 IDB 故障不应永久把用户锁在容量更小、同步写入更重的 localStorage 模式。

### 验收

- 下一启动/定期 health probe 可检测 IDB 恢复；
- migrate-back 做 count/checksum parity；
- 成功后才清 fallback flag；
- 失败保持旧数据不丢。

---

## CACHE-02：所有本地缓存都需要真实物理 retention

Research checkpoint 当前主要是 load 时逻辑忽略 7 天旧值，但旧 key 仍可能长期占存储；每 key 又允许较大 payload。

原则：TTL 不应只决定“读不读”，还应决定“什么时候实际删除”。

为 checkpoint、task journal、analysis assets、discovery cache 定义：

- TTL；
- max items；
- max bytes；
- LRU/age prune；
- stats；
- manual clear。

---

## RELIABILITY-01：Weekly cursor 读取错误必须 fail-closed

Weekly storage 对 meta 读取异常会回退 DEFAULT，Service 可能把它当 first run，随后改变 deep cursor/historyComplete。X/Telegram 已经采用更安全的 fail-closed 模式。

### 原则

- `not found` 可以 default；
- `read error/corruption` 必须抛出并停止网络/游标推进；
- cursor/watermark 属于 correctness state，不是普通 cache。

---

## TASK-01：为 Task 主表、rejection、interrupted event 建 retention

Task runner 当前会 prune 一部分 events，但：

- task 主记录可长期增长；
- request rejection/idempotency 数据缺少完整 retention；
- interrupted event 不在部分现有 event prune 条件中。

### 方向

区分：

- user-visible terminal task payload；
- idempotency tombstone；
- resumable recent event；
- old diagnostics。

各自定义 retention，而不是永久保存整条 JSON。

---

# 8. 安全与隐私专项

## SEC-03：桌面 Secrets 统一进入 Secret Vault

当前已有正确实践：X Cookie 使用 Electron `safeStorage`。

但 GitHub token、backend API secret、proxy password、RPC secret 等仍有进入 Store/IndexedDB/localStorage 的路径。`authStorage.ts` 甚至维护含 GitHub token/backend secret 的 localStorage auth mirror。

### 方向

Desktop 建立 `SecretVault`：

- renderer Store 只保存 `configured/revision/id`；
- 真值在 main process `safeStorage`；
- IPC 尽量执行“使用 secret 的操作”，而不是把 secret 返回 renderer；
- Web 模式单独定义不可避免的风险与 session policy。

迁移时要保留兼容读取 → 写入 Vault → 验证 → 删除 plaintext mirror 的顺序。

---

## SEC-04：Electron / Nginx 静态模式补 CSP

Fullstack Express 已用 Helmet CSP，但：

- `index.html` 无 CSP meta；
- `nginx.conf.template` 没有 Content-Security-Policy；
- Electron 主 `loadFile` 没有统一 CSP response header。

应按实际依赖制定 `script-src/style-src/img-src/connect-src/font-src`，同时逐步减少 `unsafe-inline/eval` 依赖。

`i18n-jsautotranslate` build 会触发 eval warning，需要评估替换或严格隔离其加载路径。

---

## SEC-05：后端访问日志不得记录原始 query string

Morgan 当前记录 `:url`。Logger sanitizer 对“整个字符串是 URL”才能执行 query param redaction，但 morgan 行是：

```text
request-id GET /api/...?... 200 ...
```

因此搜索词、用户输入甚至 `token=...` 可能原样进入 ring buffer/stdout。

### 方向

- access log 默认只记录 pathname；或
- custom morgan token 先解析 URL，再按 allowlist 记录安全参数；
- 所有 raw `console.*` 生产调用逐步迁到 sanitized logger；
- lint 对普通业务代码启用 `no-console`，保留 logger/bootstrap allowlist。

---

## SEC-06：依赖漏洞治理进入 CI

前一轮 `npm audit --omit=dev` 发现：

- root：DOMPurify 间接 LOW，fix available；
- server：`fast-uri`、`ip-address`、`morgan` MODERATE，fix available。

不要以 `npm audit` 全量零漏洞作为唯一门禁，但应：

- high/critical 直接阻断；
- moderate 需要明确 expiry/owner；
- 对实际位于 SSRF/logging 路径的 moderate 提高优先级；
- Renovate/Dependabot 定期提交小批依赖升级。

---

# 9. 部署、备份与发布工程

## DEPLOY-02：Server Docker runtime 必须进入 production mode

`server/Dockerfile` runtime 没有 `NODE_ENV=production`。

影响：

- `config.ts` 的 production `API_SECRET` 强制不会生效；
- error handler 可能暴露 development diagnostics；
- 第三方库行为可能不是 production。

Fullstack Dockerfile 已设置 `NODE_ENV=production`，standalone backend 应对齐。

---

## DEPLOY-03：加入容器 Readiness/Healthcheck

Compose 当前只有 `restart: unless-stopped`，没有 healthcheck。

### 方向

- backend/fullstack `HEALTHCHECK` 调 `/api/health`；
- split frontend 依赖 backend healthy，而不只是 container started；
- release CI 启真实 Compose，等待 health，再从另一个网络 namespace 请求 API；
- 验证 graceful SIGTERM 与 SQLite backup/task drain。

---

## DEPLOY-04：建立正式数据库 Restore Runbook

Server 已有很好的 backup primitive，但 `restoreBackup()` 当前生产流程没有调用者。

正式恢复流程应固定：

1. 停止新请求/任务；
2. drain task + backup；
3. 关闭 SQLite；
4. verify source backup；
5. restore 到新路径；
6. verify restored DB + key fingerprint；
7. 原子切换；
8. 启动；
9. migration + health + credential decrypt smoke；
10. 保留原 DB 直到验收完成。

必须测试“坏 backup”“错误 key”“进程在替换中断”等失败路径。

---

## RELEASE-01：Release workflow 的 privileged Actions 固定 SHA

Docker workflows 已经有较好的 SHA pinning，但 desktop release job 仍存在使用 major tag 的第三方/官方 actions，同时拥有 `contents: write`。

所有可写 release path 应固定 immutable commit SHA，并通过 Dependabot 定期升级 SHA。

---

## RELEASE-02：Tagged Release 强制签名、checksum 与 provenance

当前 macOS 可以无正式证书时 ad-hoc，Windows 缺少强制签名链，Release 直接发布 exe/dmg/AppImage，缺少统一 checksum/provenance。

目标：

- macOS 正式 Developer ID + notarization；
- Windows code signing；
- Linux/所有资产至少发布 SHA256SUMS；
- CI provenance/attestation；
- tag release 缺签名 secret 时失败，而不是自动降级成“看起来成功”的发布。

---

# 10. 可访问性、国际化与交互契约

## UX-01：数值表单使用 string draft，不在输入过程中强制 Number/clamp

部分设置表单直接 `Number(input.value)` 或即时 clamp，导致用户暂时清空输入框时被转为 0/默认值，错误反馈也不统一。

推荐复用 Discovery Reading Settings 已有模式：

```text
string draft
 -> field validation
 -> aria-invalid / aria-describedby
 -> blur/submit parse
 -> domain number
```

---

## UX-02：Dialog/Sheet 默认关闭按钮必须 i18n

底层 Dialog/Sheet 默认 `closeLabel="Close"`，大量调用方没有覆盖。统一由 locale-aware primitive 提供 label，不要求每个业务 modal 手工记住传值。

---

## UX-03：未登录时不要安装账号级后台生命周期

`App.tsx` 在 auth return 之前调用 Custom Discovery 等 lifecycle；即使 account 为空，Custom Discovery 仍会创建 timer、BroadcastChannel 和 online/focus/visibility listeners。

建议拆：

```text
RootBootstrap
AuthenticatedShell
  ├─ Discovery lifecycle
  ├─ Workbench lifecycle
  ├─ account background jobs
```

登录创建一次，登出完整销毁。

---

# 11. 需要保留并推广的优秀模式

后续重构不要破坏以下已经正确的机制。

## 11.1 Home v2：durable outbox + shadow + transaction

`src/home/database.ts` 是当前项目最值得推广的数据一致性参考：

- outbox 与 records/shadow 同事务；
- freeze in-flight batch；
- opId 幂等；
- late ACK 不覆盖新 pending edit；
- conflict 明确；
- backup identity binding；
- import transaction；
- maintenance gate。

其他“需要离线写 + 后台同步”的域优先复用该模型。

## 11.2 Repository Identity maintenance barrier

Identity migration 已有 pause/drain/gate/journal/restore 思路。Backup Restore、Delete All、跨账号数据迁移都应该复用同一个 app-wide maintenance coordinator，而不是各自再做 `alive` boolean。

## 11.3 Plugin/WebDAV trusted frame 验证

这是 SEC-01 应复用的范例。统一后不要保留多个略有差异的 URL 判断器。

## 11.4 Electron `safeStorage` 凭据保存

X Cookie 和 HTML Reading mail credential 的加密存储表明桌面安全存储能力已经具备。SecretVault 不需要引入全新基础设施。

## 11.5 Server SQLite online backup

`db.backup()` + `integrity_check` + `.partial` + rename + retention 的实现值得保留，只需补齐 migration trigger、key 生命周期和 restore workflow。

## 11.6 Mutation unknown-outcome 处理

GitHub Lists 对 mutation timeout/502 不盲目 replay，而是区分查询可重试和 mutation 结果未知。这是所有外部写操作应继续遵守的规则。

---

# 12. 推荐目标架构

不建议大爆炸重写。目标是让现在已有的好机制成为默认路径。

```text
UI / View
  │
  ├─ feature hooks / controllers
  │    │
  │    ├─ application commands/use-cases
  │    │    ├─ immutable RequestContext
  │    │    ├─ typed App Events
  │    │    └─ maintenance coordinator
  │    │
  │    └─ domain selectors
  │
Domain / Protocol Core
  ├─ schemas + parsers
  ├─ pure search/projection
  ├─ AI/Embedding request builders
  └─ MCP tool contracts
  │
Ports
  ├─ GitHub
  ├─ Backend
  ├─ AI
  ├─ Sync v2
  ├─ SecretVault
  └─ AppDataRegistry
  │
Runtime adapters
  ├─ Browser
  ├─ Electron trusted IPC
  └─ Server / SQLite
```

### 关键原则

1. View 不知道业务 service；
2. Service 不任意读取全局 Store；
3. 外部数据先 runtime parse；
4. durable write 有事务/Outbox；
5. 大集合不在 UI/HTTP/MCP 层全量扫描；
6. secret 与普通状态分离；
7. 每个 durable data domain 自动参加 delete/backup/diagnostics；
8. 每个 privileged desktop capability 自动参加 origin validation。

---

# 13. 分阶段实施路线

## Phase A：先让工程信号可信

实施：

- QUALITY-01：lint/i18n/server CI；
- Electron/script ESLint；
- Node 版本矩阵固定；
- Docker HOST + NODE_ENV + health smoke；
- 将当前 test warning（act/localstorage）纳入降噪计划。

退出条件：主分支质量 gate 全绿，失败能阻止合并。

## Phase B：封住数据与安全高风险边界

实施：

- SEC-01 trusted renderer；
- SEC-02 DNS/redirect SSRF；
- DATA-01 AppDataRegistry；
- DATA-02 RestoreCoordinator + maintenance；
- DATA-05/06 migration backup + key restore；
- SEC-03 desktop SecretVault。

退出条件：任意账号切换、restore 注错、恶意 renderer、错误 key 都能 fail closed。

## Phase C：统一同步与持久化模型

实施：

- SYNC-01 legacy autoSync 迁移；
- STORE-01 persistence shard；
- SYNC-02 retention/budgets；
- ARCH-04 delta capture；
- TASK-01 / CACHE retention。

退出条件：常规变更成本与“变更量”相关，不与“全库大小”相关。

## Phase D：规模性能与 UI 架构

实施：

- PERF-01 virtualization/indexed selectors；
- PERF-02 root subscription 下沉；
- DB-01/02 query/index/FTS；
- PERF-03/04 lazy boundaries；
- ARCH-01/02/03/05 解耦。

退出条件：10k repo / 50k release / 大聊天历史 fixture 下交互与同步仍满足性能预算。

## Phase E：产品质量与发布可信度

实施：

- a11y automated gate；
- 10 locale 完整迁移；
- bundle/legacy/fonts；
- release signing/checksum/provenance；
- restore drill / disaster recovery test。

---

# 14. 建议的可量化工程预算

以下不是当前实测 SLA，而是建议先写进 benchmark 的**工程预算**，后续可根据真实设备数据调整。

## 14.1 前端

- Repository fixture：10,000 repos / 50,000 releases；
- 首屏只挂载 viewport 附近卡片，不因滚动到末尾保留全部 DOM；
- category/group 派生计算 O(N + C)，避免 O(N×C)；
- 单 repo 更新不触发所有 RepositoryCard 的 release scan；
- settings General 首开不加载 AI/vector/plugin 重模块。

## 14.2 Sync / Storage

- 单记录本地编辑不触发全 repositories JSON stringify；
- idle client 不做固定 5 秒全库 pull；
- sync history、task、cache、snapshot 都有 max rows/bytes/age；
- 100 次 snapshot 请求不使 DB 按 100×全量 records 线性增长。

## 14.3 Backend

- 10 万 repositories/releases fixture 下 `EXPLAIN QUERY PLAN` 命中目标索引；
- 最大合法 import 期间 `/api/health` 延迟有明确上限；
- MCP search/stats 不加载 50k full row object 后再 JS 筛选；
- request body 超限在业务 transaction 前拒绝。

## 14.4 Security

- 所有 privileged IPC 都有 untrusted origin test；
- strict proxy 的 DNS/private/redirect 测试完整；
- desktop renderer 不持久化长期 secret 明文；
- access logs 不保留 query secret/search text；
- tagged release 可验证签名/checksum/provenance。

---

# 15. CI 目标矩阵

建议最终 PR pipeline 至少包括：

| Gate | 目标 |
|---|---|
| ESLint TS/TSX | 0 error / 0 warning |
| ESLint Electron/scripts JS | Node rules 真正启用 |
| TypeScript | root + server 通过 |
| Boundaries | View/service/application contract |
| i18n | 10 locale parity + hardcoded-copy gate |
| Root Vitest | 全部通过 |
| Electron Node tests | IPC/trusted-frame/AGY/plugin/WebDAV 等 |
| Server Vitest | 全部通过 |
| Coverage | critical services/hooks/store 渐进 threshold |
| Bundle | modern/legacy/font budget 分开 |
| Docker split smoke | frontend → backend healthy |
| Docker fullstack smoke | host → `/api/health` healthy |
| Migration | old DB fixture → target + backup + rollback |
| Backup/Restore | manifest + fault injection + wrong-key |
| A11y | axe + keyboard critical flows |
| Dependency | high/critical blocker，moderate 有 owner/expiry |
| Release | signed/checksum/attestation |

---

# 16. 后续开发的“禁止新增”规则

这些规则可以直接转成 CONTRIBUTING/ADR/CI：

1. 不新增 View → business service 直接 import；
2. 不新增网络 `res.json() as DomainType`；
3. 不新增长期 secret 到普通 Zustand persist/localStorage；
4. 不新增独立 IndexedDB/localStorage durable domain 而不登记 AppDataRegistry；
5. 不新增 raw `window.dispatchEvent(new CustomEvent('gsm:...'))`，必须走 typed event contract；
6. 不新增 service 内随意 `useAppStore.getState()`；
7. 不新增大集合 render-time 嵌套 filter/find；
8. 不新增依赖 unload 时异步写入作为唯一 durability 保证；
9. 不新增没有 size/count/TTL 的持久化队列、cache、history；
10. 不新增 privileged Electron IPC 而不验证 trusted renderer；
11. 不新增可写 release Action 使用浮动 major tag；
12. 不新增 user-visible zh/en ternary copy；
13. 不通过吞掉 Promise rejection 来“保持功能继续运行”；
14. 不把 partial restore 显示成普通成功；
15. 不继续扩展 legacy full-sync path；新同步能力进入 sync v2。

---

# 17. 建议拆成的开发 Epic

为了避免一个巨大重构 PR，建议拆成可独立验收的 Epic：

### Epic 1 — Trusted Desktop Host

SEC-01、IPC-01、SEC-04、SecretVault。

### Epic 2 — Data Lifecycle

DATA-01、DATA-02、DATA-03、DATA-04、DATA-05、DATA-06、DATA-07、正式 restore runbook。

### Epic 3 — Sync v2 Completion

SYNC-01、SYNC-02、ARCH-04、legacy endpoint retirement。

### Epic 4 — Storage Scale

STORE-01、CACHE-01、CACHE-02、TASK-01。

### Epic 5 — Repository Scale

PERF-01、PERF-02、DB-01、DB-02、FTS benchmark。

### Epic 6 — Layering & Contracts

ARCH-01、ARCH-02、ARCH-03、API-01、NAV-01、CORE-01。

### Epic 7 — UI Quality

UI-01、A11Y-01、I18N-01、HTML-01、UX-01/02/03。

### Epic 8 — Build & Delivery

PERF-03/04/05/06、DEPLOY-01/02/03、RELEASE-01/02。

每个 Epic 都应先加 measurement/contract test，再改实现；这样可以证明改造真正降低复杂度，而不是只移动代码。

---

# 18. 开发 Ticket 的统一模板

以后从本文拆 issue 时，建议固定包含：

```markdown
## Problem
具体触发条件、当前行为、为什么会随规模放大。

## Evidence
文件 / 函数 / 测试 / benchmark。

## Invariant
修复后必须永远成立的规则。

## Design
数据流、状态机、失败语义、兼容策略。

## Migration
旧数据/旧 API/旧配置怎么过渡。

## Validation
必须新增或修改哪些自动测试、故障注入、benchmark。

## Rollback
上线后如果失败，如何安全退回。
```

“减少 300 行代码”“拆成多个文件”本身不能作为完成标准。

---

# 19. 最值得先复用的代码参考

| 需求 | 推荐参考实现 |
|---|---|
| durable local edits | `src/home/database.ts` |
| sync state machine | `src/home/sync.ts` |
| identity maintenance | `src/services/repositoryIdentityMigration.ts` / `repositoryIdentityGate.ts` |
| runtime schema | Home/Discovery/Plugin manifest 的 Zod schemas |
| trusted Electron frame | `electron/plugins/pluginIpc.js`, `electron/webdavIpc.js` |
| desktop encrypted secret | X Auth / HTML Reading safeStorage |
| SQLite safe backup | `server/src/services/backups.ts` |
| unknown mutation outcome | GitHub Lists API tests/implementation |
| stale async account guard | Workbench/Discovery 中 generation + account checks |
| field-level accessible validation | Discovery Reading Settings |

---

# 20. 当前最关键的开发顺序

如果只能按顺序连续推进，推荐：

1. 恢复 lint + i18n + server CI，保证后续每次重构有可信反馈；
2. 修 Docker HOST/NODE_ENV，给部署链补真实 smoke；
3. 统一 Electron trusted-renderer guard；
4. 建 AppDataRegistry + RestoreCoordinator + app-wide maintenance；
5. 修 migration backup / encryption-key restore；
6. 完成 legacy autoSync → sync v2 的迁移设计与逐域退役；
7. 拆 Zustand persistence + durable delta；
8. Repository virtualization + selector/index；
9. Server DB index/FTS + MCP SQL pushdown；
10. 收敛 Store service locator、CustomEvent bus 和 network runtime schemas；
11. i18n/a11y/HtmlReading 并发与错误边界；
12. legacy bundle/fonts/lazy loading；
13. release signing/provenance/restore drill。

这条路径先建立可信门禁，再封安全和数据风险，随后消除“数据量越大全量工作越多”的结构，最后再做代码组织与产品体验优化，能最大限度降低重构期间的回归风险。

---

# 21. 审计结论

GSM 当前最大的优势是：**关键难题已经在局部被正确解决过**。Home v2 证明了项目能做可靠增量同步；Identity migration 证明了可以做 maintenance/journal/rollback；Plugin/WebDAV 证明了可以做 trusted renderer；safeStorage 证明了可以做桌面 Secret Vault；Server backup 证明了可以做可验证快照。

后续最有价值的工作不是引入更多独立机制，而是把这些已经成熟的模式提升为全项目基础设施，并逐步淘汰旧的全量同步、手工数据清单、黑名单式分层和全局隐式依赖。

当以下四个条件同时成立时，可以认为项目完成了下一阶段工程化升级：

1. **数据量增长时成本主要与变化量相关，而不是与全库大小相关；**
2. **任何持久化数据和 secret 都有清理、备份、恢复、迁移和容量策略；**
3. **任何远程/renderer 输入进入 privileged/domain state 前都有显式 runtime boundary；**
4. **CI 能真实覆盖 Browser、Electron、Server、Docker、数据迁移和 release 的关键契约。**

这比单纯追求更多测试、更小文件或更高类型覆盖更重要，也是 GSM 从功能丰富项目继续演进为长期可维护桌面/Web/Server 产品的关键路径。
