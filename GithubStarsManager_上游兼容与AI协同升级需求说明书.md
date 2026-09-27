# GithubStarsManager 个人版：上游兼容与 AI 协同升级需求说明书

> 文档版本：V1.0  
> 文档目标：先解决“个人版长期持续吸收上游更新”这一最重要的问题，再逐步进行后续个性化功能开发。  
> 分析对象：`AmintaCCCP/GithubStarsManager`  
> 当前稳定基线：`v0.8.3`  
> 当前分析时间：2026-09-27  
> 当前 `main` 在稳定版发布后仍持续有同步、路由、批量 Star 等修改，因此本方案明确区分“稳定 Release”与“上游 main 开发态”。

---

# 1. 文档目的

本项目计划在 GithubStarsManager 基础上进行较大的个人化修改。

最大的长期风险不是“某个功能现在怎么实现”，而是：

> **个人修改越来越多以后，如何继续吸收 GithubStarsManager 官方更新，而不让项目逐渐变成一个无法升级的孤立 Fork。**

因此，在开始大规模个性化功能开发之前，必须优先建立一套稳定的：

- 上游跟踪机制；
- 个人修改隔离原则；
- 版本基线记录机制；
- AI 升级分析机制；
- 冲突风险判断机制；
- 数据迁移保护机制；
- 自动测试与人工验收机制；
- 升级失败回滚机制。

本阶段**不重点讨论搜索、收藏、AI 管理等业务功能优化**。

这些功能后续可以根据个人需求逐步开发。

当前阶段只有一个核心目标：

> **保证未来“敢改、能改、还能继续升级”。**

---

# 2. 当前上游项目的特点与风险判断

## 2.1 上游仍处于快速演进阶段

GithubStarsManager 当前并不是一个已经长期冻结的成熟项目。

从近期版本和提交可以看到，上游仍频繁调整：

- 前端架构；
- Store；
- Backend Sync；
- GitHub API 路由；
- 登录认证；
- Release；
- Plugin；
- Repository Q&A；
- Discovery；
- i18n；
- Electron；
- Docker；
- 数据持久化。

因此，个人版不能假设：

> “以后上游只是修几个 Bug，我简单 merge 一下就行。”

更现实的情况是：

> 上游某些模块未来还会继续重构。

所以个人版的设计必须以“持续变化的上游”为前提。

---

## 2.2 上游已经形成明确的架构规则

当前上游已经存在正式的：

`docs/adr/0001-frontend-layering.md`

该 ADR 对前端做了明确分层：

1. View；
2. Hook / ViewModel；
3. Application；
4. Service；
5. Store。

而且这不是单纯文档约定。

当前项目还通过：

- ESLint；
- `scripts/check-boundaries.cjs`；
- GitHub Actions CI；

实际强制执行这些规则。

因此个人开发不能采用：

> “只要能运行就随便放代码。”

个人功能必须尽量遵循上游已经建立的架构。

否则短期可以运行，长期每次升级都会变得更加困难。

---

## 2.3 上游明确要求只有一个持久化 Zustand Store

这是本次分析中最重要的结论之一。

上游 ADR 明确说明：

> Store 可以拆 Slice，但整个应用只有一个持久化 Store 和一套 persistence shell。

也就是说，不应该为了个人功能再建立第二套独立的持久化 Zustand Store。

原因是上游目前依赖统一的：

- `version`
- `partialize`
- `migrate`
- `merge`

来保证历史数据升级。

### 对个人版的影响

以后增加个人功能时：

**可以：**

- 新增独立 Feature；
- 新增独立 Hook；
- 新增独立 Service；
- 新增纯个人数据存储服务；
- 必要时增加 Store Slice。

**不建议：**

- 自己平行复制一套 `usePersonalStore` 并再做一套持久化；
- 绕开上游的迁移机制维护第二套核心状态。

如果个人数据不需要进入全局主 Store，优先使用独立的领域数据存储，并通过 Repository ID / `owner/repo` 与上游仓库数据关联。

只有确实需要参与主应用响应式状态时，再按上游现有 Store 规范增加 Slice。

---

# 3. 当前最容易产生升级冲突的区域

个人版应对不同上游文件设置不同风险等级。

---

## 3.1 一级高风险区域

以下模块应视为：

> **非必要不直接修改。**

### A. 持久化核心

包括：

- `src/store/persistence/options.ts`
- `src/store/schema.ts`
- Store migration
- `partialize`
- `merge`
- persistence version

原因：

这里直接决定用户数据能否正确升级。

一旦个人版和上游都修改同一套 migration，未来冲突不仅是代码冲突，还可能是：

> **用户数据损坏。**

---

### B. Backend Sync

包括：

- `src/services/autoSync.ts`
- Backend Repository 同步；
- Repository merge；
- sync fingerprint；
- full push / pull；
- 并发同步。

原因：

上游在 2026-09-26 附近连续修复多设备同步竞态，例如：

- Pull 过程中发生本地修改；
- Full Push 删除远端新项目；
- Pull 失败后仍继续排队 Push；
- 后端失败处理行为。

说明这一部分当前属于：

> **高复杂度 + 高频修改区域。**

个人版应该尽可能直接继承上游实现。

---

### C. GitHub API 路由与认证

包括：

- `src/services/githubApi.ts`
- `src/services/githubApiFactory.ts`
- `backendAdapter`
- Route Mode；
- Token validation；
- Browser Direct / Backend Proxy。

近期上游刚统一了 GitHub API Service 的创建方式，并通过 ESLint 禁止其他代码直接实例化 GitHub API Client。

因此个人版新增 GitHub 请求时必须继续遵循：

> 上游的 GitHub API Factory 和 Route Mode。

不能自己重新开一条“个人 GitHub API 通道”。

---

### D. Backend Database Schema

包括：

- `server/src/db/schema.ts`
- Repository 表；
- Settings；
- AI Config；
- Vector Config；
- 数据列升级。

个人功能如果直接向上游核心表不断增加字段：

> 未来上游数据库升级会明显增加冲突风险。

原则上个人数据应尽可能与上游核心 GitHub 数据解耦。

---

### E. Release / Version 元数据

当前上游以根：

`package.json`

中的版本作为应用版本唯一来源，并同步：

- root lockfile；
- `server/package.json`；
- server lockfile；
- `versions/version-info.xml`。

并且 CI 对版本与 Release 文件有专门限制。

因此个人版：

> **不应把自己的个人版本号直接混入上游版本系统。**

---

## 3.2 二级中风险区域

这些区域可以修改，但必须尽量控制范围：

- `useAppStore.ts`
- Store selectors；
- `src/types/index.ts`
- Repository Card；
- SearchBar；
- Settings；
- App Navigation；
- Discovery hooks；
- common Modal / Sheet；
- Electron main/preload；
- i18n 公共文件。

这些文件是很多功能共同经过的位置。

修改越多，将来发生重合越容易。

---

## 3.3 低风险区域

后续个人功能优先放在：

- 新增的 Feature 目录；
- 新增 Hook；
- 新增 Service；
- 新增独立 Component；
- 新增测试；
- `docs/personal/**`；
- 独立个人配置；
- 官方 Plugin 能承担的功能。

总体原则：

> **新增文件优先于修改旧文件。**

---

# 4. 个人版的核心开发原则

以后所有个性化开发都应遵循以下规则。

---

## P-01：优先新增，不优先修改

同一个功能如果可以：

- 新建 Feature；
- 新建 Hook；
- 新建 Component；
- 新建 Service；

就不要直接重写上游已有的大文件。

目标：

> 让个人功能尽量拥有自己的代码边界。

---

## P-02：每项个人功能都必须知道自己改了哪些上游文件

每个个人功能都应登记：

- 功能 ID；
- 功能名称；
- 目的；
- 新增文件；
- 修改的上游文件；
- 依赖的上游模块；
- 数据是否持久化；
- 是否涉及同步；
- 是否涉及认证；
- 是否涉及数据库；
- 对应测试；
- 升级时注意事项。

以后 AI 升级时，不能只靠扫描全部 Git Diff 猜测。

必须有一份明确的：

> **Personal Feature Manifest**

告诉 AI：

> “这些改动为什么存在。”

---

## P-03：个人意图与具体实现分开记录

例如：

不要只记录：

> 修改了 `RepositoryCard.tsx` 第 200 行。

而应该记录：

> P-012：在 Repository Card 上展示个人项目状态。

因为未来上游可能完全重写 RepositoryCard。

升级时真正需要保留的是：

> “个人状态必须继续显示。”

而不是：

> “原来的第 200 行必须保留。”

这也是 AI 能够进行“语义迁移”的基础。

---

## P-04：尽量不扩展上游核心 Repository 类型

如果个人功能需要：

- Personal Note；
- Personal Status；
- Priority；
- Personal Collection；

不应默认直接向上游 `Repository` 类型不断增加字段。

更推荐：

> 使用独立 Personal Metadata，并通过 Repository ID / `full_name` 关联。

这样以后上游增加或调整 Repository 字段时，个人数据受影响更小。

只有确实属于 Github Repository 本身、并且需要进入上游全数据链路的字段，才考虑扩展核心 Repository。

---

## P-05：个人版本号和上游版本号分开

系统应同时记录：

### Upstream Version

例如：

`v0.8.3`

### Upstream Commit

例如：

`7e63b30`

### Personal Version

例如：

`P0.1.0`

最终展示可以类似：

> GithubStarsManager v0.8.3  
> Personal Build P0.1.0

个人版本信息单独存放。

**不要为了个人版本发布反复修改：**

- 上游 package version；
- server package version；
- `versions/version-info.xml`。

这样可以减少每次上游 Release 必然产生的版本冲突。

---

# 5. Git 分支与版本基线要求

本项目不采用：

> 下载 ZIP → 修改 → 下次再下载一个 ZIP → 让 AI 比两个目录。

必须使用完整 Git 历史。

---

## 5.1 必须保留两个 Remote

### origin

自己的个人 Fork。

### upstream

官方：

`AmintaCCCP/GithubStarsManager`

---

## 5.2 稳定开发分支

建议长期保持：

### `personal/main`

个人稳定版本。

这是日常真正使用的版本。

---

## 5.3 上游不需要复制成自己的开发分支

官方代码通过：

`upstream/main`

和 Upstream Tags 跟踪即可。

不需要日常在官方分支上做个人修改。

---

## 5.4 升级分支

每次升级必须创建独立分支，例如：

`upgrade/upstream-v0.8.4`

所有：

- AI 分析；
- 合并；
- 冲突修复；
- migration；
- 测试；

都在升级分支进行。

不能直接在 `personal/main` 上尝试升级。

---

## 5.5 功能分支

日常个人功能：

`feature/personal-xxx`

开发完成并验证后再进入 `personal/main`。

---

# 6. 上游版本跟踪策略

## 6.1 默认只跟正式 Release

个人稳定版默认跟踪：

> GithubStarsManager 正式 Release。

不建议每天将 `upstream/main` 的最新 Commit 合入个人版。

原因：

当前上游 `main` 在 Release 后仍会继续进入：

- 新功能；
- 临时修复；
- 重构；
- 后续修正。

逐 Commit 追踪会明显提高个人版不稳定性。

---

## 6.2 上游 main 的用途

`upstream/main` 主要用于：

- 查看未来变化；
- AI 提前分析；
- 判断某个 Bug 是否已经修复；
- 提前评估下一版本冲突；
- 必要时选择特定 Hotfix。

---

## 6.3 特殊 Hotfix

如果官方 Release 存在严重问题，而 `main` 已经修复：

允许单独吸收特定 Commit。

但必须记录：

- Commit；
- 原因；
- 是否预计下个 Release 会正式包含；
- 后续升级时是否应删除临时补丁。

---

# 7. Upstream Base：最重要的升级基线

每一个个人稳定版本都必须保存：

- `upstreamVersion`
- `upstreamCommit`
- `personalVersion`
- `personalCommit`
- `upgradeDate`

例如：

```text
Upstream Version: v0.8.3
Upstream Commit: 7e63b30
Personal Version: P0.1.0
Personal Commit: xxxxxxx
```

以后 AI 分析升级时，不能只比较：

> 当前 Personal vs 最新 Upstream。

而必须使用三方关系：

```text
              Base
             /    \
            /      \
     Personal      New Upstream
```

分别分析：

### Personal Delta

从 Base 到当前个人版：

> 我改了什么？

### Upstream Delta

从 Base 到目标上游版本：

> 官方改了什么？

然后分析两者：

> 哪里真正发生语义重叠？

---

# 8. 为什么不建议长期反复 Rebase Personal Main

如果个人修改越来越大，长期将整个 `personal/main`：

> Rebase 到每一个上游版本

会导致大量历史个人 Commit 反复重新播放。

一个早期冲突可能在多个个人 Commit 中不断重复出现。

因此本项目建议：

## 普通版本升级

采用：

> **Upgrade Branch + Upstream Merge + AI 语义解决冲突**

保留清晰升级历史。

---

## 大规模上游重构

采用：

> **Forward Port**

即：

1. 以新版上游为基础；
2. 根据 Personal Feature Manifest；
3. 一项一项重新迁移个人功能；
4. 不强求原来的代码实现必须继续存在。

目标是：

> 保留个人需求，而不是保留旧代码形状。

---

# 9. AI 协同升级系统的职责

AI 在升级中的定位不是：

> “看到 Git Conflict 就自动选 ours/theirs。”

AI 应该承担：

> **Semantic Upgrade Assistant（语义升级助手）**

---

## 9.1 AI 升级前必须读取的资料

AI 开始升级分析前必须获得：

### 上游资料

- 当前 Base Commit；
- 目标 Release；
- Release Notes；
- Base → Target Commit Diff；
- 相关 PR；
- 上游 ADR；
- 上游测试约束；
- 上游 migration 规则。

### 个人资料

- Personal Feature Manifest；
- Personal Architecture Notes；
- Personal Upgrade Rules；
- Base → Personal Diff；
- 个人测试；
- 上一次 Upgrade Report。

---

## 9.2 AI 不允许只分析发生 Git Conflict 的文件

很多真正危险的问题不会产生文本冲突。

例如：

个人版调用：

`某个旧 Service API`

上游没有修改个人文件，因此 Git 不会报冲突。

但上游已经改变了 Service 的行为。

代码可能：

> 可以编译，但逻辑已经错误。

因此 AI 必须检查两类冲突：

### Text Conflict

Git 能发现的文件级冲突。

### Semantic Conflict

Git 无法发现，但行为已经发生变化的冲突。

AI 升级的主要价值就在第二种。

---

# 10. AI 升级分析阶段

AI 必须先生成报告，再修改代码。

分析阶段原则：

> **Read Only First。**

---

## 10.1 上游变化分类

AI 应将上游变化分类为：

- Feature；
- Fix；
- Refactor；
- Data Migration；
- API Contract；
- Store；
- Backend；
- Database；
- Authentication；
- Network；
- Electron；
- Plugin API；
- Build / CI；
- Dependency；
- UI；
- i18n；
- Release Process。

---

## 10.2 个人影响分类

对每一个 Personal Feature 判断：

### None

无影响。

### Low

文件不重合，接口基本稳定。

### Medium

依赖上游发生变化，需要检查。

### High

个人和上游修改同一模块。

### Critical

涉及：

- 数据迁移；
- 同步；
- 认证；
- 数据库；
- 数据删除；
- 大规模架构变化。

---

# 11. Upgrade Report 必须包含的内容

每次升级必须生成：

`docs/personal/upgrades/<target-version>.md`

例如：

`docs/personal/upgrades/v0.8.4.md`

---

## 11.1 基本信息

包括：

- 当前 Personal Version；
- 当前 Base；
- 目标 Upstream Release；
- Target Commit；
- 分析时间。

---

## 11.2 上游摘要

回答：

- 上游主要新增了什么；
- 修复了什么；
- 重构了什么；
- 是否存在 Breaking Change；
- 是否存在数据迁移；
- 是否修改同步；
- 是否修改认证；
- 是否修改 Plugin API。

---

## 11.3 文件重叠

区分：

- 只有上游修改；
- 只有个人修改；
- 双方均修改。

---

## 11.4 语义影响

不能只列文件名。

必须说明：

> 上游变化为什么会影响个人功能。

---

## 11.5 功能级建议

例如：

| Personal Feature | 风险 | 原因 | 处理建议 |
|---|---|---|---|
| P-001 | Low | 独立 Feature | 直接保留 |
| P-004 | High | Repository Card 被上游重构 | 在新版 Card 上重新挂载 |
| P-009 | Critical | 修改 persistence | 先迁移数据结构 |

---

## 11.6 冲突解决原则

每个重要冲突必须记录：

- 选择上游；
- 选择个人；
- 合并两者；
- 删除个人旧实现；
- 重新实现。

不接受仅记录：

> “Conflict fixed。”

---

# 12. AI 修改代码时的决策优先级

遇到双方同时修改同一能力时，AI 必须按以下顺序判断：

## 第一优先级：采用上游新能力

如果上游已经正式实现个人版以前自己实现的能力：

> 优先使用上游。

然后只保留真正个人化的差异。

---

## 第二优先级：适配个人需求

如果上游实现了 80%，个人版多 20%：

不要继续维护两套完整实现。

应变成：

> 上游 80% + Personal Extension 20%。

---

## 第三优先级：重新迁移个人能力

如果上游结构变化很大：

> 不要为了保留旧代码而强行继续 Patch。

根据个人功能“目的”重新迁移。

---

## 最后才是保留旧个人实现

只有上游无法满足需求且重新适配成本不合理时，才继续维护独立实现。

---

# 13. 高风险区域的 AI 升级规则

## 13.1 Persistence

AI 不允许自行简单解决 migration 冲突。

涉及：

- version；
- migrate；
- partialize；
- merge；

必须：

1. 查看旧版本 migration；
2. 查看目标上游 migration；
3. 查看 Personal Data；
4. 检查历史 Snapshot；
5. 明确迁移顺序；
6. 运行旧数据升级测试。

---

## 13.2 Backend Sync

发生冲突时：

> 默认优先采用上游同步算法。

个人需求尽量放到同步前后边界，而不是修改同步核心状态机。

---

## 13.3 Authentication / Network

发生冲突时：

> 默认采用上游实现。

个人版不能随意恢复：

- 直接实例化 GitHubApiService；
- 绕过 Factory；
- 绕过 Route Mode；
- 自己保存 Token。

---

## 13.4 Database

数据库修改必须先：

- 备份；
- Copy 测试；
- Migration 验证。

AI 不得直接在唯一真实用户数据库上执行首次 migration。

---

# 14. 个人功能登记制度

新个人功能完成前必须新增 Feature Record。

建议存放：

`docs/personal/features/`

例如：

`P001-personal-library.md`

---

## Feature Record 至少包括

### ID

`P001`

### 功能目的

这个功能解决什么问题。

### 用户价值

为什么必须保留。

### 上游依赖

依赖哪些上游功能。

### Personal Owned Files

主要个人文件。

### Patched Upstream Files

修改了哪些上游已有文件。

### Data

是否新增持久化数据。

### Invariants

升级后必须保持什么行为。

### Tests

哪些测试证明功能还正常。

### Upgrade Notes

上游发生哪些变化时需要重点检查。

---

# 15. “个人修改热区”必须持续统计

每次个人开发后，应统计：

> 哪些上游文件被个人版本修改得最多。

如果某个上游文件不断被不同 Personal Feature 修改：

说明这个位置已经成为：

> **Personal Hotspot。**

此时不应继续无限 Patch。

应该考虑：

- 抽一个个人 Extension Point；
- 建立 Adapter；
- 将个人逻辑搬到独立 Feature；
- 向上游贡献通用扩展点。

目标：

> 降低双方共同修改同一文件的频率。

---

# 16. Patch Budget

为了控制长期维护成本，每个 Personal Feature 都应关注：

> **它修改了多少上游已有文件。**

建议：

### 理想

0～2 个上游文件。

### 可接受

3～5 个。

### 超过 5 个

需要重新评估：

> 是否可以增加一个更薄的扩展入口，再把大部分代码搬到个人 Feature。

Patch Budget 不是绝对禁止规则。

它的作用是：

> 在个人 Fork 逐渐失控之前尽早发现问题。

---

# 17. Upstream Protected Areas

建议建立个人项目自己的 Protected Areas 清单。

默认包括：

- persistence；
- autoSync；
- Repository merge；
- GitHub API Factory；
- Route Mode；
- Auth；
- Backend database core schema；
- version sync；
- Release feed；
- CI architecture guards。

修改这些区域必须在 Personal Feature Record 中说明原因。

AI 也不得在普通功能开发中为了“方便”擅自修改这些区域。

---

# 18. 个人数据升级保护

未来个人功能可能越来越多。

所以必须建立：

> **升级前恢复点。**

每次上游升级前：

1. 备份 Personal Data；
2. 备份 Backend SQLite；
3. 备份应用设置；
4. 记录当前 Personal Commit；
5. 建立 Git Tag。

如果升级失败：

> 可以完整返回原稳定版本。

---

# 19. 升级验证流程

AI 完成修改并不代表升级完成。

升级必须经过以下阶段。

---

## Gate 1：Architecture

执行上游已有架构检查：

- boundary check；
- ESLint。

要求：

> 个人代码不得破坏 ADR 0001。

---

## Gate 2：Type

运行 TypeScript 类型检查。

不得通过大量：

- `any`；
- ignore；
- eslint disable；

来“修掉”升级错误。

---

## Gate 3：Tests

运行上游现有测试。

重点包括：

- Store；
- persistence；
- Electron MCP；
- Plugin；
- version/update；
- CI contracts。

---

## Gate 4：Build

至少验证：

- Frontend Build；
- Backend Build。

如果本次修改涉及 Electron：

- Desktop Build / Smoke Test。

如果涉及 Docker：

- Docker Build / Startup Test。

---

## Gate 5：Personal Regression

运行 Personal Features 自己的回归测试。

---

## Gate 6：Data Migration

使用真实数据的副本验证：

- 启动；
- Hydration；
- 数据迁移；
- Backend Sync；
- Backup Restore。

---

## Gate 7：Manual Smoke Test

至少人工检查：

- 登录；
- Stars 加载；
- 搜索；
- 分类；
- AI 配置；
- Release；
- Settings；
- Backup；
- Personal Features。

---

# 20. 上游升级完成条件

只有同时满足以下条件，升级才能进入 `personal/main`：

- Upstream diff 已分析；
- Personal diff 已分析；
- Upgrade Report 已生成；
- 所有 High / Critical 项都有处理结论；
- Git Conflict 全部解决；
- Semantic Conflict 已检查；
- Architecture Gate 通过；
- Typecheck 通过；
- Tests 通过；
- Build 通过；
- Personal Regression 通过；
- 数据副本迁移测试通过；
- 人工 Smoke Test 通过；
- 回滚点已经存在。

---

# 21. 升级完成后的记录

成功升级后：

更新：

- Upstream Version；
- Upstream Base Commit；
- Personal Version；
- Personal Commit；
- Upgrade Report。

然后创建个人 Tag。

例如：

`personal-P0.4.0-upstream-v0.8.4`

这样半年后仍然能够知道：

> 每一个个人版本究竟建立在哪个官方版本之上。

---

# 22. AI 升级过程中禁止的行为

AI 在升级过程中不得：

### 禁止 1

因为冲突麻烦，直接选择：

> Accept Ours 全部覆盖。

---

### 禁止 2

因为上游是新的，直接：

> Accept Theirs 全部覆盖。

---

### 禁止 3

为了通过编译：

- 删除 Personal Feature；
- 删除 migration；
- 删除测试；
- 大量加 `any`；
- 大量加 eslint disable。

---

### 禁止 4

未经分析直接修改：

- Auth；
- Sync；
- Persistence；
- Database；
- Encryption。

---

### 禁止 5

在唯一真实数据库上首次尝试 migration。

---

### 禁止 6

升级成功后不更新 Base Commit。

---

### 禁止 7

只看 Git Conflict，不检查 Semantic Conflict。

---

# 23. 推荐的 AI 升级工作模式

AI 升级分成四个阶段。

---

## Phase A：Analyze

只分析，不改代码。

输出 Upgrade Report。

---

## Phase B：Plan

根据风险排序制定迁移顺序。

推荐顺序：

1. Upstream Architecture；
2. Types / Contracts；
3. Persistence；
4. Backend / DB；
5. Service；
6. Store；
7. Hooks；
8. UI；
9. Personal Feature；
10. Tests。

---

## Phase C：Migrate

逐模块处理。

每处理一个重要 Personal Feature：

- 修复；
- 测试；
- 再继续下一个。

不建议一次性让 AI 修改几十个模块后才开始编译。

---

## Phase D：Verify

运行完整升级 Gate。

---

# 24. AI Upgrade Prompt 的固定要求

以后无论使用 Codex、Claude Code、Cursor 或其他 Coding Agent，都应该给它统一规则。

AI 必须理解：

> 目标不是让代码“合并成功”，而是让“最新版上游行为 + Personal Features”同时成立。

AI 每次升级至少回答：

1. 上游这次改变了什么？
2. 哪些是架构变化？
3. 哪些是数据变化？
4. 哪些 Personal Features 受影响？
5. Git 没报冲突但可能存在什么语义问题？
6. 哪些个人实现上游已经覆盖？
7. 哪些个人代码应该删除？
8. 哪些应该重新迁移？
9. 哪些 Protected Areas 被修改？
10. 如何验证没有数据损失？

---

# 25. 当前阶段需要先建立的文件

在正式大改之前，优先建立以下维护资料：

```text
docs/personal/
├─ README.md
├─ ARCHITECTURE.md
├─ UPGRADE_RULES.md
├─ PROTECTED_AREAS.md
├─ features/
└─ upgrades/
```

另外增加一份机器可读的个人版本基线信息。

至少保存：

- upstream version；
- upstream commit；
- personal version；
- personal commit。

---

# 26. 当前阶段的实施优先级

## P0-1：建立标准 Git Fork

如果当前只是下载了仓库文件：

> 第一件事是恢复为完整 Git 仓库工作流。

---

## P0-2：记录当前 Base

在开始第一处个人修改前，记录：

- 当前官方 Release；
- Commit；
- 当前 Personal HEAD。

---

## P0-3：建立 Personal Feature Manifest

以后每个个人功能必须登记。

---

## P0-4：建立 Protected Areas

先明确哪些上游核心模块尽量不碰。

---

## P0-5：复制上游 CI Gate

个人版必须至少保留：

- boundaries；
- lint；
- typecheck；
- tests；
- build。

不能为了个人开发方便关闭这些 Gate。

---

## P0-6：建立 Upgrade Branch 流程

所有上游升级都通过：

`upgrade/*`

进行。

---

## P0-7：建立 Upgrade Report 模板

让 AI 每次升级使用统一格式。

---

## P0-8：建立 Backup / Rollback

在第一次个人数据结构修改之前完成。

---

# 27. 第一阶段验收标准

本阶段不要求新增业务功能。

完成后必须满足：

### 版本可追踪

能够回答：

> 当前个人版基于上游哪个版本、哪个 Commit？

---

### 功能可追踪

能够回答：

> 这个个人功能为什么存在，它修改了哪些上游文件？

---

### 升级可分析

给 AI：

- Base；
- Personal；
- New Upstream；

AI 可以生成结构化升级报告。

---

### 风险可识别

能够自动或半自动识别：

- 同文件修改；
- Persistence 修改；
- Sync 修改；
- Auth 修改；
- DB 修改；
- API Contract 修改。

---

### 升级可隔离

升级失败不会影响当前稳定 `personal/main`。

---

### 数据可回滚

升级失败可以恢复：

- 代码；
- 用户数据；
- Backend DB；
- 设置。

---

### 上游 CI 不被破坏

个人代码仍然遵守上游架构规则。

---

# 28. 最终维护模型

本项目长期维护应形成：

```text
                 GithubStarsManager Upstream
                           │
                           │ Official Release
                           ▼
                    New Upstream Version
                           │
                           ▼
                   AI Analyze Upstream
                           │
            ┌──────────────┴──────────────┐
            │                             │
            ▼                             ▼
    Upstream Delta                  Personal Delta
            │                             │
            └──────────────┬──────────────┘
                           ▼
                  Semantic Impact Report
                           │
                           ▼
                upgrade/upstream-vX
                           │
                           ▼
             AI-assisted Feature Migration
                           │
                           ▼
         Architecture / Test / Build / Data Gates
                           │
                           ▼
                    Manual Verification
                           │
                           ▼
                     personal/main
                           │
                           ▼
                  New Upstream Base
```

---

# 29. 最重要的长期原则

## 原则一

> **保留个人需求，不执着保留个人旧代码。**

---

## 原则二

> **上游能解决的问题，逐步回归上游。**

---

## 原则三

> **个人代码越独立，上游升级越容易。**

---

## 原则四

> **数据兼容优先于代码合并漂亮。**

---

## 原则五

> **AI 的价值是理解双方“为什么改”，而不是替代 Git 的三方合并。**

---

## 原则六

> **升级的成功标准不是“没有 Conflict”，而是“上游新能力、个人功能和用户数据都正确”。**

---

# 30. 当前分析结论

根据 GithubStarsManager 当前版本的实际架构，个人版后续大规模开发最应该先避免以下错误：

1. 不保留 Upstream Git 历史；
2. 直接下载 ZIP 后长期修改；
3. 每天追 `upstream/main`；
4. 个人版反复改上游版本号；
5. 建第二套持久化 Zustand Store；
6. 把所有个人字段都塞进核心 `Repository`；
7. 深改 `autoSync`；
8. 绕过 GitHub API Factory；
9. 为了个人功能关闭上游 Boundary / CI Gate；
10. 每次升级只处理 Git Conflict；
11. 不记录 Base Commit；
12. 让 AI 不读个人功能说明就直接 Merge；
13. 在真实唯一数据上测试 migration；
14. 大版本重构时仍强行 Rebase 所有历史 Commit。

只要先把这些规则落实，再开始后续个人功能开发，即使未来个人修改量很大，升级成本也会保持在一个可管理范围。

---

# 31. 分析依据

本说明书主要基于当前 GithubStarsManager 以下实际结构与近期变化：

- `docs/adr/0001-frontend-layering.md`
- `.github/workflows/ci.yml`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `scripts/check-boundaries.cjs`
- `eslint.config.js`
- `src/store/useAppStore.ts`
- `src/store/schema.ts`
- `src/store/persistence/options.ts`
- `src/services/autoSync.ts`
- `src/services/githubApiFactory.ts`
- `server/src/db/schema.ts`
- `scripts/update-version.cjs`
- `docs/plugins/v1-development.md`
- `versions/version-info.xml`
- v0.8.0 ～ v0.8.3 Release 变化
- v0.8.3 发布后 `main` 中关于 Backend Sync、GitHub Route、CSP、Batch Star Import 等后续提交

后续每次准备进行大规模个人开发或重大上游升级时，都应重新检查这些核心约束是否发生变化。
