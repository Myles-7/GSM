# GitHub Stars Vectorize Worker

极简 Cloudflare Worker，作为 Cloudflare Vectorize 的代理。前端负责 Embedding 生成，Worker 只负责向量的存/查/删。

## 前置条件

- [Cloudflare 账号](https://dash.cloudflare.com/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)
- 已登录 Wrangler (`wrangler login`)

## 首次部署

### 1. 创建 Vectorize 索引

索引维度必须与你选择的 Embedding 模型一致：

```bash
# OpenAI text-embedding-3-small (1536维)
npx wrangler vectorize create github-stars --dimensions=1536 --metric=cosine

# Ollama nomic-embed-text (768维)
npx wrangler vectorize create github-stars --dimensions=768 --metric=cosine

# Cohere embed-multilingual-v3.0 (1024维)
npx wrangler vectorize create github-stars --dimensions=1024 --metric=cosine

# Gemini text-embedding-004 (768维)
npx wrangler vectorize create github-stars --dimensions=768 --metric=cosine

# 硅基流动 BAAI/bge-large-zh-v1.5 (1024维)
npx wrangler vectorize create github-stars --dimensions=1024 --metric=cosine
```

### 2. 安装依赖

```bash
npm install
```

### 3. 设置认证令牌

```bash
wrangler secret put AUTH_TOKEN
# 输入一个安全的随机字符串，例如：openssl rand -hex 32
```

### 4. 部署

```bash
npm run deploy
```

部署成功后，Wrangler 会输出 Worker 的 URL，格式类似：
```text
https://github-stars-vectorize.<your-subdomain>.workers.dev
```

### 5. 在 App 中配置

在 GitHub Stars Manager 的 **设置 → 向量搜索** 中：
- **Worker 地址**: 填入上一步的 URL
- **认证 Token**: 填入你设置的 AUTH_TOKEN 值

### 6. 测试连接

在设置页点击 **测试 Worker 连接**，看到 "连接成功" 即可。

---

## 更新部署（代码变更后）

当你更新了 Worker 代码（例如从 GitHub 拉取了新版本），需要重新部署：

```bash
cd cloudflare-worker

# 如果依赖有变更（package.json 更新了）
npm install

# 重新部署
npm run deploy
```

> **注意**：更新部署**不需要**重新创建 Vectorize 索引，已有向量数据不受影响。

---

## 更换 Embedding 模型

**更换模型后必须重建索引，即使维度相同也不能混用。**

步骤：
1. 在 App 设置中更换 Embedding 模型
2. 如果维度不同，创建另一个索引，并通过另一个 Worker 地址绑定新索引；保留原索引及原 Worker，直到新索引验证成功：
   ```bash
   npx wrangler vectorize create github-stars-next --dimensions=1024 --metric=cosine
   ```
3. 保存 Embedding 和索引配置，再点击 **重建向量索引**。不兼容的配置不能执行增量索引。

## Identity Protocol v2

- `/status` advertises `protocolVersion: 2`. Upgrade both deployment variants before using the new client. Older clients (including legacy MCP consumers) receive a rebuild/upgrade error for unscoped requests; they cannot query mixed generations.
- Electron MCP now receives `activeIndex` and content settings over IPC, verifies the canonical identity/hash, checks Worker v2 and dimensions before embedding, and sends the generation scope for both vector tools. Restart Electron's main process after updating. Current identity-aware snapshots without an active generation require rebuilding; only old, unversioned snapshots without `activeIndex` retain the explicitly labeled `legacy_unverified` path. A failed scoped request never retries unscoped.
- Backend MCP does not yet persist/sync generation identity. It therefore reports `vector_index_identity_not_synced` and omits both vector tools by default, without making embedding or Worker calls. The eight keyword/repository/status tools remain available. Intentional use of an unchanged legacy index is possible only by setting `GSM_MCP_LEGACY_VECTOR_WORKER_URL` to that exact Worker URL and restarting the backend. Every legacy search checks `/status` before embedding, rejects v2/newer protocols and dimension mismatches, and labels successful results `legacy_unverified`. This opt-in cannot enable v2 querying or provide identity guarantees for old data. Do not use it with a changed model/index pair.
- The client persists `activeIndex` with a SHA-256 identity covering provider, endpoint, model, dimensions, content mode, README limit, text format and Worker target. API keys are not stored in this identity.
- Every request carries `{ scope: { namespace, identityHash, dimensions } }`. The Worker validates it, prefixes repository IDs with the generation namespace, and passes the namespace to Vectorize **before** nearest-neighbor selection. No metadata index setup is needed.
- Full rebuilds write to a fresh namespace. The active pointer and repository stamps change only after every upload and visibility check succeeds. Partial failure, cancellation or changed settings retain the previous pointer and vectors. No automatic deletion runs.
- `/verify` checks the final mutation against `describe().processedUpToMutation` and reads back every uploaded ID, identity, dimension and content hash. The client waits up to 30 polls. A concurrent writer can advance the watermark before it is observed; verification then conservatively times out rather than publishing an unverified stage.
- Compatible incremental refreshes update only changed content in the current generation. They are **not transactional**: successful same-identity writes may remain if a later batch fails; no generation switch or new stamps are published on failure, and retry rechecks the hashes.
- Unknown legacy identity requires an explicit full rebuild. Existing vectors and timestamps are never used to infer compatibility. Failed/excluded repositories are not copied into a new generation; their old vectors remain in the old namespace.
- `activeIndex` and repository content stamps persist locally. The existing backend config schema does not sync these new fields. A different device without an identity must rebuild; an older backend response cannot authorize an incompatible local query.
- Retained/abandoned generations consume storage. Cleanup is intentionally disabled because similarity sampling is not safe enumeration. Explicit administrative retention management is required; this change does not deploy or delete remote resources.

---

## 文件说明

| 文件 | 说明 |
|------|------|
| `src/index.ts` | Worker 源码（TypeScript，CLI 部署使用） |
| `worker.js` | 从 TypeScript 源码打包的 Dashboard 粘贴版本 |
| `wrangler.toml` | Wrangler 部署配置 |
| `package.json` | 依赖声明 |

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/upsert` | 批量写入向量 |
| POST | `/query` | 向量相似度查询 |
| POST | `/delete` | 删除指定向量 |
| POST | `/verify` | 验证 generation 写入可见性和内容哈希 |
| POST | `/cleanup` | 禁用，返回 409，不删除任何数据 |
| GET | `/status` | 获取索引状态 |

所有请求需要 `Authorization: Bearer <AUTH_TOKEN>` 头。

After changing the TypeScript Worker, regenerate the standalone Dashboard bundle from the repository root:

```bash
npm ci
npm run build:vector-worker
npm run check:vector-worker
```

The root lockfile pins the bundler. CI checks that the Dashboard bundle matches the
TypeScript source (ignoring CRLF/LF differences); include the regenerated
`worker.js` whenever the Worker source changes. Inside `cloudflare-worker`,
`npm run build` and `npm run check:bundle` use the same root tooling, so install
the root dependencies first. Wrangler deployment continues to use `src/index.ts`.

## 本地开发

```bash
npm run dev
```

## 常见 Embedding 模型维度参考

| 模型 | 维度 | 多语言 | 价格 |
|------|------|--------|------|
| OpenAI text-embedding-3-small | **1536** | ✅ | $0.02/M |
| OpenAI text-embedding-3-large | **3072** | ✅ | $0.13/M |
| Gemini text-embedding-004 | **768** | ✅ | 免费 |
| Cohere embed-multilingual-v3.0 | **1024** | ✅ | $0.1/M |
| Ollama nomic-embed-text | **768** | ✅ | 免费 |
| Ollama bge-m3 | **1024** | ✅ | 免费 |
| 硅基流动 BAAI/bge-large-zh-v1.5 | **1024** | ✅ | ¥0.5/M |
