# GSM 本地 JSON 备份与兼容恢复分析

> **阶段 4～8 代码更新（2026-10-03）**：本地导出现在为 v1.1，已补子分类/顺序和选定偏好；仓库/组织/偏好有独立 journal 安全恢复，其它字段仍走兼容导入，WebDAV 写出未改。下文关于旧本地 v1.0/缺字段/候选协调器的描述是改动前基线，不能作为现状重复开发。 详见 [连续开发交付报告](GSM_阶段4至8连续开发交付报告.md)。

> **适用范围**：仅本机 Windows，自用；本地文件优先，保留已有 WebDAV 兼容。
> **用户决策（2026-10-03）**：不规划全域/整机备份、Device Profile 或跨设备产品。保留现有 Home backend 与 Home Sync v2。
> **目标**：先修本地导出版本/字段漂移，再按实际恢复范围收敛共享格式与校验；不先建设通用数据域框架。
> **交付状态**：本文是后续指导，本轮没有改变导出文件、恢复逻辑或数据。

---

## 1. 现状校准 / 修订说明

原文识别出了本地导出字段漂移、二级分类遗漏、密钥掩码覆盖风险和导入原子性不足等真实问题，但“单一 JSON = 完整备份”和“一次 `useAppStore.setState()` = 原子恢复”这两个结论与当前架构不一致，需要重定义。

当前代码至少同时存在以下事实：

- `DataManagementPanel.tsx` 仍维护本地 JSON `version: '1.0'` 的手工字段清单，并且应用版本来自硬编码常量，而不是 package/build metadata。
- `useBackupActions.ts` 的 WebDAV 路径使用 `version: '1.2'`，字段覆盖更完整，已包含 `subcategories`、`subcategoryOrder`、`repositoryOrder`，并复用 `incomingOrganizationSnapshot()` 与 `restoreAIConfigs()`。
- WebDAV restore 仍先写 Discovery workspace，再写 Zustand organization/release/config 等多个区域；部分后续恢复失败会记录 warning 并继续，因此它不是跨持久化域的原子事务。
- 主 Zustand store 只是一个持久化域。项目还存在 Discovery、Workbench、Home v2、repository chat、analysis assets、HTML Reading 等独立 IndexedDB/localStorage 数据，以及 Electron 本机配置、安全存储和后端 SQLite。
- Repository identity migration 已经实现了更适合作为恢复协调器参考的机制：账户作用域、writer gate、pre-image、journal、fingerprint、checkpoint、暂停 Home sync、失败恢复与续跑。
- Home v2 自己的 backup/import 已具有 schema 校验、GitHub account/workspace identity binding、大小限制、in-flight/unconfirmed task 拒绝，以及单个 IDB 内多 object store transaction。

已存在的保护也必须承认：本地入口已有 `isRealSecret()`，WebDAV 对 password/secret 检查 `!== '***'`，AI 配置共用 `restoreAIConfigs()`。这不等于所有字段和失败场景都已覆盖，但不能再把“没有 masked-secret 保护”当成当前事实。

本方向改为：**本地 JSON 的明确覆盖范围 + 一套必要的共享 projection/codec + 实际写入集合的安全恢复方案。**

本地与 WebDAV 是介质差异；新字段不应继续产生不同语义。但本地导出的一个修复不必等待 WebDAV 整体重构，更不必等待全域恢复协调器。

---

## 2. 最小产品边界：文件覆盖什么就明确写什么

### 2.1 默认优先保留的内容

| 内容 | 策略 | 注意事项 |
| --- | --- | --- |
| Repository 用户整理成果 | 备份重点 | stable identity、分类/子分类、锁定、描述、标签、AI 沉淀与顺序；不得只备 GitHub 可重取字段 |
| 分类与顺序 | 备份重点 | 保留稳定 ID 与引用；与 repositories 一起核对完整性 |
| Release 订阅、来源偏好、已读 | 沿用现有覆盖并校验 | 不把 loading/刷新状态当用户资产 |
| 主题、语言、常用视图配置 | 显式白名单 | `partialize` 仅用于查漏，不整体复制它的凭据与账户快照 |
| AI/Embedding 配置 | 明确所选范围 | 默认排除凭据；缺少必要 credential 的新配置不得自动激活 |
| Discovery workspace | 保留当前独立 exporter/validator 的兼容入口 | 这是已存在的独立域，不等于所有 Discovery/Workbench 历史已纳入 |
| WebDAV 历史文件 | 保留 v1.2 读取与已有恢复路径 | 涉及相同新字段时复用共享规则，不继续扩展另一套字段语义 |

### 2.2 不规划的内容与代价

不新增 Device Profile、全域/整机 archive、加密 secret package、跨账户 clone、插件私有数据迁移、后端服务安装迁移或 encryption key 托管。

**范围缩小有明确代价**：本地 JSON 不保证恢复全部 Workbench/chat/HTML Reading、后端 SQLite、Electron 安全存储或所有独立 DB 历史。界面和说明必须列出 included/excluded，不能把“单一文件”称为完整机器恢复方案。

未来若用户要求扩大个人历史覆盖，先展示遗漏数据域与恢复成本请用户决定；不自动启动全域框架。已有独立备份/同步能力保留，不因本轮文档瘦身删除。

---

## 3. 当前实现中的真实问题

### 3.1 两套 JSON 备份已经产生字段漂移

本地 v1.0 和 WebDAV v1.2 分别在 UI/hook 中手写字段。现有 v1.0 字段清单没有跟随 `appPersistenceOptions` 演进，容易遗漏：

- `subcategories` / `subcategoryOrder` / `repositoryOrder`；
- `categoryListIdMap`；
- `themeTokens` / `repositoryCardFields`；
- `repositoryChatSettings` 与 active configuration；
- 新增的账户 workspace 字段和未来 durable domain。

另一方面，当前本地导出还会混入 Discovery runtime 结果、分页状态、搜索过滤等不一定适合换机恢复的内容。

问题根因不是某几个字段漏写，而是**每个入口都自行定义 backup projection**。

### 3.2 “Store 一次提交”不是 durable atomicity

一次 `setState()` 可以让 React 观察到单次内存状态切换，但无法同时回滚：

- 独立 IndexedDB；
- Discovery workspace；
- Home v2；
- Workbench / repository chat；
- 后端 SQLite；
- 已经开始的 sync/task/background writer。

因此恢复设计不能把“UI 同一 tick 更新”当成数据原子性证明。

### 3.3 Replace / Merge 语义必须显式

恢复不能通过“字段缺失”“数组为空”推断用户意图。

- `merge`：只合并明确存在的输入；缺失字段表示“不参与本次操作”。
- `replace`：对声明为 complete snapshot 的域，以输入为完整事实；空数组可以明确表示“恢复为空”。
- `preview`：只产生 diff、冲突、需要 credential 的项和预计写入域，不修改真实状态。

特别要保留“空值”和“缺失”的区别。不能使用 `localValue || incomingValue` 之类写法，因为用户明确清空的空字符串、空集合会被误判为无值。

### 3.4 沿用现有 secret 保护，不增加 secret package

`***` 只表示旧格式的掩码，不能恢复为真实密钥。新格式默认省略 secret；必要时只标明 credential 已排除/缺失，不设计加密包、vault 引用或 key 管理产品。

同机 merge 保留当前合法 credential；新配置缺少 credential 时保持 inactive。空值/缺失/用户主动清空应分别定义，不能以统一 truthy 判断代替。保留历史 `includeKeysInBackup` 的兼容行为；不借本轮文档删除已存在的用户选择。

---

## 4. 建议的最小共享格式

### 4.1 小模块即可，不先建框架

需要共享代码时，在现有 services 附近放置少量 schema、projection、legacy adapter 与 codec；具体拆文件以实现可读性为准，不要求七个模块、插件式 domain adapter 或拓扑排序器。

Envelope 只需说明：format、schemaVersion、appVersion（package/build metadata）、createdAt、GitHub identity、涉及 Home 时的 workspace identity，以及本次文件包含哪些部分。字段版本在实施时确定，本文不伪造一个已发布的新格式版本。

不使用任意 `Record<string, unknown>` domain 注册协议来适配尚无需求的数据域。旧 v1.0/v1.2 只读适配，新导出使用共享字段定义；未知 future version 拒绝写入。

### 4.2 Projection 的来源

- Repository 复用现有 normalizer/schema，明确保留用户资产与 identity。
- Organization 复用 `incomingOrganizationSnapshot()`；校验 category/subcategory/repositoryOrder 引用。
- 配置复用 `backupAIConfig()` / `restoreAIConfigs()`；不复制 mask 处理代码。
- `appPersistenceOptions.partialize` 是核对字段是否遗漏的参考，不是直接导出全部字段的 API。
- Discovery 若被选择，调用现有 `exportDiscoveryWorkspaceBackup()` 与 validator，不直接扫描内部 object store。

共享的只有必要的格式与规则，不创建第二个业务数据 owner。本地格式稳定后，WebDAV 在相关维护时接入；读取旧文件的适配必须一直保留到证实可以退役。

---

## 5. 身份与空值语义不能因同机使用省略

- repositories、分类、GitHub List mapping、Release 用户状态按 GitHub account scope 校验。
- 恢复会触及 Home 时，还需固定 workspace scope；开始、每个写入阶段与完成前重新核对当前 identity。
- account/workspace mismatch 默认拒绝对应业务写入；跨账户结构克隆不在本机路线内。
- 旧文件可能没有账户身份。缺失不是匹配证明；先只读预览，说明来源不可自动验证，再由用户明确选择是否继续受支持的旧格式恢复。
- `merge` 的 absent 表示不参与；`replace` 的显式空集合可表示清空，但仅在声明完整覆盖的部分内生效。null、empty string、empty array 与 absent 分别验证。
- 不因为应用在一台电脑上运行，就假定只会有一个 GitHub 登录身份。

---

## 6. 恢复只协调实际写入的参与者

### 6.1 先识别调用链

本地 import 也可能调用独立 Discovery importer，并因 Zustand 订阅触发 Home capture、outbox 和 backend 写入。文件来源是本地，不代表它是单库操作。

若只修导出，可直接交付 schema/projection/codec 与只读 preview，不启动 destructive restore。若要修改 restore，则必须列出实际参与 store、后台 writer 与 durable commit 点。

### 6.2 保留恢复约束，去掉万能框架

针对实际选中的参与集合设计：

```text
decode/validate -> identity + diff preview
 -> 暂停相关 writer / drain 已有同步
 -> durable journal + pre-image/checkpoint
 -> 按既有依赖顺序写入并 checkpoint
 -> 重读关键 invariants
 -> success resume；failure recovery/rollback
```

复用 `repositoryIdentityMigration.ts` 的 gate/journal/fingerprint 思想，但它是特定身份迁移协议，不能未经验证直接当任意 backup coordinator。尤其要覆盖进程中断后恢复、Home outbox 与未确认操作；单个内存 `setState()` 不构成 durable commit。

只为真实参与者写具体步骤，不先建设 `AppDataRegistry`、自动 adapter 发现、通用依赖图、任意 required/optional domain manifest、全应用 maintenance 平台。文档表和局部类型已经能表达范围时就使用它们。

现有 restore 的 partial-warning 行为是已知限制，不能标成 atomic。新恢复安全边界未就绪时，不扩大替换范围，也不删除旧兼容路径。

---

## 7. 可独立交付的候选子阶段

| 子阶段 | 修改候选 | 明确不改 | 验证 |
| --- | --- | --- | --- |
| A：版本来源 | DataManagementPanel 的 export metadata、既有 build/version 来源 | schema 大迁移、UI、WebDAV restore | 导出 appVersion 与 package 一致；旧文件仍可读 |
| B：导出字段查漏 | 本地 projection、分类/顺序 helper、对应 fixture | 全域备份、破坏性恢复、secret 包 | 分类引用与二级分类/顺序 roundtrip；无业务写入 |
| C：最小共享 codec | 必要 schema/adapter、两个入口相关字段 | 通用 Registry、同步协议 | v1.0/v1.2 adapter、current-format roundtrip、空值/secret/identity |
| D：有明确需要的恢复修复 | 本次实际参与的 store/helper/Home 边界 | 不选择的用户历史域 | failure injection、journal 恢复/rollback、账户切换 |

一次只执行一行，不把 A～D 打包成一个实现阶段。阶段 B 的导出修复不能冒充恢复链路已经支持所有新增字段。

---

## 8. 数据清单与架构变化要求

本机维护先使用文档清单：字段/域、owner、版本、GitHub/workspace scope、secret policy、included/excluded、导入/清理入口。不要自动增加机器可读 Registry 与 CI 完备性门槛。

如果引入新 journal，它是维护元数据，必须说明 schema/version、account/workspace key、pre-image 是否含敏感数据、完成后的保留/删除策略和中断后的恢复入口。不让正常业务查询从 journal 读取事实，不把 checkpoint 变为第二份可编辑 store。

新的跨存储恢复不是为扩展预留的复杂化，而是选中写入范围的必要正确性成本；如果不接受这一成本，就保持导出/只读预览阶段，不宣称提供安全全量 replace。

---

## 9. 验收与现有测试

现有入口/域测试：

- `src/components/settings/DataManagementPanel.test.tsx`。
- `src/features/settings/hooks/useBackupActions.test.tsx`。
- `src/services/discoveryWorkspaceBackup.test.ts`。
- `src/home/database.test.ts`、`src/home/desktop.identity.test.ts`。
- `src/services/repositoryIdentityMigration.test.ts`。
- `electron/webdavIpc.test.js`。

它们证明各自现有契约，不证明未来共享新格式或跨库 restore 已实现。

实现涉及备份/迁移时至少验证 legacy adapter、current version roundtrip、empty/null/absent、account/workspace mismatch、masked secret、partial failure/recovery。导出阶段的失败应留下原状态、没有业务写入；恢复阶段则需 durable checkpoint/recovery 与账户切换注入。另运行 typecheck、对应集成测试和 `git diff --check`，无需为单个 metadata 修复建立整机 benchmark。

---

## 10. 当前限制与下一步

当前仍存在本地 v1.0 字段漂移与硬编码 `0.4.0`，WebDAV v1.2 覆盖较多但 restore 有 partial-warning、跨 store 协调不足。已存在 secret 保护和 Discovery/Home 校验不能被重复实现，也不能被夸大为全局保障。

下一步只推荐本地导出版本/字段的一个独立修复；实际开始前再核对代码与用户要备份的资产。全域/整机恢复与通用 coordinator 不排期。
