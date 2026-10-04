# GSM 综合审查、开发与文件治理交付

日期：2026-10-03，Asia/Shanghai。对象：`D:\桌面\GSM` 当前工作树。实施依据为 [开发方案](../plans/2026-10-03-project-audit-development.md)。

## 结论与事实边界

本轮完成了可复现体验缺陷、异步阅读状态错误、重复查询和同步布局测量的修复，补齐桌面权限边界、容器监听配置、备份范围说明与默认测试入口，并实际执行文件治理。项目功能已很丰富，主要瓶颈是入口可达性、数据责任分散和规模增长；不需要为了“功能种类更多”重写应用或添加未经验证的新业务。

进入工作区时已有 HTML 阅读、仓库展示、搜索、备份、桌面窗口与性能诊断等未提交修改。本轮保留并在它们之上开发。原始差异位于 `output/project-audit-20261003/preexisting.patch` 与 `preexisting-status.txt`。本文“本轮新增”不把既有安全恢复、HTML 改造或搜索开发算成新成果。

**源码验收与运行版本是两个状态。** 前后端候选构建已通过，日常 `dist`、已注册 Windows 服务、真实账户数据库与桌面凭据未替换。个人版 P0.2.1 与 package 0.8.4 的版本信息保持不变；没有提交、推送、部署或发送邮件。不能据此称实际桌面程序或生产服务已经采用修复。

页面审查在独立 `127.0.0.1:5188` origin 上使用匿名 100 仓库、200 Release fixture。它能验证排版、导航和空配置流程，不能代表真实用户的摘要质量、网络延迟、模型回答或手机附件浏览器兼容性。

## 多维问题、修复与判断

| 方面 | 已确认现象与原因 | 本轮实现 | 验收与限制 |
| --- | --- | --- | --- |
| 使用体验 | 通用设置把词条 key 直接显示给用户；父级翻译函数默认命名空间错误 | 明确使用 settings 命名空间 | 中英文真实词库测试；页面不再出现 `generalPanel.account-token-hint` |
| 视觉与响应式 | 390px 更新说明和按钮挤在同一行 | 小屏纵向、宽屏并排，说明允许收缩换行 | 手机 DOM 检查：无重叠、无整页横向溢出；明暗截图 |
| 可访问性 | 设置有 tab 语义但缺少方向键/Home/End，多个标签进入 Tab 顺序 | 手动激活键盘模式；单一 Tab stop；面板可聚焦 | ArrowDown 只移焦点，Enter 才切换；Home/End、手机搜索与无结果回归 |
| 信息架构 | 手机设置标签多但不能搜索 | 增加搜索、清空与无结果提示 | 输入“备份”只显示备份标签；筛选不会隐式切换或提交当前表单 |
| 产品流程 | 备份恢复只引导 WebDAV，本地 JSON 功能藏在数据管理 | 新增本地备份入口和直达导航，区分本地与云端要求 | 桌面、手机都能无 WebDAV 进入导入/导出；没有执行恢复 |
| 数据需求 | 导出界面没有明确说明多数据库和独立存储不在 JSON 覆盖内 | 加入覆盖/排除项及安全恢复、兼容导入范围说明 | 说明在导出前可见；不宣称覆盖全应用 |
| 功能引导 | 工作台没有 AI 配置时缺少下一步说明 | 显示配置状态、直达 AI 设置并禁止无配置提交 | 返回工作台保留匿名问题草稿；未调用任何模型 |
| 状态一致性 | 阅读状态的迟到读取/写入可在切帖、关闭重开或换账号后串写 | 按帖子、连接和生命周期绑定异步结果；未加载版本前拒绝写入，抑制双击 | 人工延迟、换账号、重开、错误恢复、墓碑版本行为测试 |
| 本地读取性能 | 阅读状态每次复制整库再 find | 新增包含 tombstone 的按主键 getRecord | 测试确认没有 allRecords 扫描，保留冲突所需版本 |
| 渲染性能 | 仓库网格同步读取 DOM 宽度，初次挂载触发额外 render | CSS auto-fill 网格，去除宽度状态、ResizeObserver 与同步测量 | 1440/820/390 下三/二/一列；list 单列；单结果不拉满宽度 |
| 查询与订阅 | 每卡订阅整组 Release，再 filter+sort | 按不可变 Release 数组共享分组，仅计算实际请求仓库的最新版本 | 新旧时间、相同时间、无效日期、不变引用、按需解析测试；CPU 基准见后文 |
| 桌面安全 | 部分高权限 IPC 只验证窗口/主框架身份，缺少页面来源约束；主文档导航无统一拦截 | 统一可信页面与 IPC registrar，保护主框架导航/重定向，限制外链弹窗协议 | 所有接入模块拒绝外部主框架和子框架；拒绝其他端口、路径、query、凭据 URL；真实 Electron 导航尚未实机复测 |
| 部署可靠性 | 服务默认监听 127.0.0.1，split/fullstack 容器未覆盖 HOST | Docker runtime/Compose 显式 HOST=0.0.0.0；生产配置要求 API_SECRET；本机默认保持 loopback | 两份 Compose 配置通过；未启动容器或公开本机端口 |
| 依赖 | 生产依赖存在已发布告警 | 修复 DOMPurify、morgan、fast-uri、ip-address 和 brace-expansion 目标版本及锁文件 | 前后端生产审计 0；完整根审计仍有 5 个 high，不是全依赖零告警 |
| 工程治理 | 新窗口/诊断测试没有进入默认完整测试；旧截图脚本固定端口并可能读取真实后端 | 接入默认测试链；新增隔离匿名审查入口与白名单清理工具 | 完整链确实执行；旧脚本退休、文档归档、清理实际完成 |

## 截图分析与视觉取舍

证据目录：`output/project-audit-20261003/`。`ui-verification.json` 记录尺寸、布局、键盘和导航核查。

| 页面/场景 | 截图 | 判断 |
| --- | --- | --- |
| 设置桌面前后 | `settings-before-desktop.jpg` → `settings-after-desktop.jpg` | 翻译 key 泄漏属于可复现缺陷，已修；基础/内容/数据/诊断分组便于查找 |
| 设置手机前后 | `settings-before-mobile.jpg` → `settings-after-mobile.jpg`、`settings-after-mobile-dark.jpg`、`settings-after-mobile-full.jpg` | 搜索可达，上游说明换行正常；暗色人工检查不等于 WCAG 对比度认证 |
| 仓库宽度 | `repositories-after-desktop.jpg`、`repositories-after-tablet.jpg`、`repositories-after-mobile.jpg` | 网格列宽约 351.333/373/348px，无整页横向溢出 |
| 单结果与列表 | `repositories-after-single-result.jpg`、`repositories-after-list.jpg` | 单结果仍保留网格轨道；列表模式单列约 1086px |
| 本地备份 | `backup-local-entry-desktop.jpg`、`backup-local-entry-mobile.jpg`、`backup-scope-desktop.jpg`、`backup-scope-mobile.jpg` | 能发现入口并在导出前理解范围，不再把 WebDAV 当成本地文件前提 |
| AI 工作台 | `ai-overview-desktop.jpg` → `ai-overview-after-desktop.jpg`、`ai-overview-after-mobile.jpg` | 空配置现在有可执行下一步；桌面场景标题/长提示仍有截断、范围标签偏技术化，可继续打磨 |
| 每日 HTML 设置 | `html-settings-desktop.jpg` | 内容、样式、邮件、回传分区明确；高级字段仍多，后续需观察首次设置负担 |
| 发现 | `discovery-desktop.jpg` | 列表留白和信息密度属于设计取舍；缺少真实分析内容的 fixture 不能证明真实卡片同样空疏 |

仓库首屏同时包含分类、搜索、筛选、排序、同步和 AI 操作；手机标题区与分类入口占用一定高度。可考虑默认折叠空分类、提供阅读密度预设，并将不常用动作集中到菜单。不过用户已有自定义排序、分类、卡片显示字段，改动必须保留这些偏好，不能用视觉简化破坏操作能力。此部分属于后续产品假设，并非已证明的故障。

## 性能测量与成本

`scripts/benchmark-release-lookup.cjs` 使用 Node v25.8.2；每场景 5 次预热，9 次新数组样本，交替新旧执行顺序。数组准备不计入时间，索引建立与候选筛选计入。结果对齐后才接受样本。原始值见 `release-lookup-benchmark.json`。

| 仓库 | Release | 查找卡片 | 旧 filter/sort 中位 ms | 新共享分组/惰性查询中位 ms |
| --- | --- | --- | --- | --- |
| 100 | 200 | 50 | 0.0772 | 0.0552 |
| 1,000 | 2,000 | 50 | 0.4275 | 0.0826 |
| 5,000 | 10,000 | 50 | 2.1519 | 0.4258 |

首次尝试对所有 Release 预解析日期，在大数据样本没有稳定收益，因而改为按需计算。5,000 仓库样本中，旧逻辑的过滤扫描为 500,000 次；新逻辑建立索引扫描 10,000 条，再查看显示仓库的 100 条候选。它需要额外 Map/分组引用，空间复杂度 O(Release 数量)；WeakMap 允许旧账户数组被回收，并依赖 Store 数组不可变约定。

这不是 React commit、DOM layout、滚动或端到端交互延迟基准。不能把约 1.73ms 的计算差异外推成“页面快五倍”，也不能宣称所有千级卡顿已解决。

现有仓库列表仍以 IntersectionObserver 累积增加 visibleCount，旧卡片不卸载；全局 Store 持久化、大集合投影和分类分组统计也可能成为更大的成本。建议下一阶段对 100/1,000/5,000 仓库固定工作负载采集 CPU、长任务、React commit、DOM 数量和峰值内存，再决定窗口化与持久化拆分。保留阅读锚点、可变高度、分组、拖拽、选择和键盘行为是必要成本。

候选构建的最大 legacy entry 为 **1882.44 KiB**，低于现有 3000 KiB 门槛；现代主入口约 1703.51 kB（gzip 507.10 kB），设置 chunk 约 408.79 kB（gzip 101.22 kB）。门槛通过不等于低端设备加载足够快。构建仍提示同模块同时静态/动态导入；这种动态 import 无法独立拆包，需追踪真实依赖图后治理。

## 功能与产品需求路线

现有范围包含仓库管理、分类/分组/排序、搜索与向量检索、Gist、发布/复刻、发现频道/期刊、AI 分析与工作台、本地工程研究、AGY、插件、WebDAV/Home 同步、本地恢复与每日 HTML 阅读。新增功能优先级应取决于用户完成任务的成功率，而不是页面数量。

| 后续事项 | 需求/实施方案 | 验收要求 | 优先级与成本 |
| --- | --- | --- | --- |
| 全应用数据清单 | 为每个 account/device/workspace 数据域登记版本、密钥、备份、恢复、删除责任；自动生成范围 UI | 所有应用数据库有登记；漏域不能显示“全部备份/全部删除成功” | P1；跨 Store、IndexedDB、Electron vault、SQLite，成本较高 |
| 全域恢复演练 | 先校验格式/身份/大小/依赖，停止写入，分域维护和回滚；SQLite 与加密密钥作为恢复单元 | 空机恢复、旧版本、断电、取消、部分失败、换账户、同步进行中都有演练 | P1；不宜扩展现有兼容导入后直接宣称原子恢复 |
| 开发依赖迁移 | 将 Tailwind 3 的扫描依赖风险与 Tailwind 4 迁移单独实施，核对 tokens、legacy targets、动画、暗色 | 完整 audit、构建预算与桌面/手机截图回归；不能只用 audit fix --force | P1；涉及样式/工具链和低版本浏览器兼容 |
| 全量窗口化 | 先固定规模基准，按仓库/发现布局分别引入窗口、overscan 与锚点模型 | 滚动后 DOM 数量有界，拖拽/选择/焦点/分组/返回阅读位置不回退 | P1；高于更换一个列表组件的成本 |
| 持久化和同步 | 收集大集合序列化/投影占比，再拆物理快照和记录级 delta；梳理 legacy 与 Home v2 责任 | 账户切换、离线 outbox、冲突和旧资料迁移不丢状态 | P1；需要跨服务边界测试 |
| AI 首次使用 | 在现有缺配置引导基础上，区分搜索/问结果/本地研究所需的模型、凭据与授权；完整显示场景含义 | 不配置不付费，草稿可恢复，模型无效或授权失效有明确恢复步骤 | P2；本轮只完成无配置路径 |
| 阅读/视觉密度 | 用真实长摘要与短摘要样本选择紧凑/舒适预设，减少标题截断和技术枚举标签 | 不丢正文，不覆盖个人卡片字段；手机触控与键盘都可达 | P2；需真实用户验证，偏好不能由 fixture 推断 |
| 可访问性与结构 | 增加焦点、表单标签、色彩、减少动画、错误恢复的自动检查；分解大型工作台与数据管理文件 | 先逐条验证 13 个现有 Lint warning 的实际行为，再改依赖数组或拆文件 | P2；避免格式重构掩盖状态问题 |
| 发布前实机验证 | Windows 实际窗口/托盘、Electron 导航、手机 HTML 附件、真实 SMTP/云同步、容器网络 | 使用隔离资料演练后确认实际运行版本及回滚方案 | 发布前必要；模拟测试不能替代 |

这些是有验收条件的后续开发范围，不是本轮已经实现的能力。本轮交付完成不等于上述长期技术债归零。

## 备份覆盖矩阵

| 数据域 | 当前 JSON 导出/恢复责任 |
| --- | --- |
| 仓库、分类/分组/排序、所选显示偏好 | 导出按勾选项；已有 1.1 安全恢复提供身份校验、预览与维护流程，本轮保留并回归 |
| Release、订阅、发现缓存/阅读工作区、所选 AI/WebDAV 配置与其他勾选项 | 导出按勾选项；其余字段为兼容导入，多存储可能部分成功，不承诺同一原子事务 |
| AI/WebDAV/代理/RPC/后端密钥 | 受“包含密钥”开关影响；默认脱敏资料不等于可在空机直接恢复认证 |
| GitHub 登录、Gist、复刻、工作台聊天、HTML 阅读设置/回传、邮件凭据、插件存储、向量索引 | 不属于此 JSON 导出的完整覆盖范围；工作台等有独立入口，不代表已整合备份 |
| 真实服务 SQLite 与加密密钥 | 服务侧独立恢复单元；本轮未读写真实数据库或演练生产恢复 |

## 安全与依赖结果

新 `electron/trustedRenderer.js` 同时校验窗口、主框架和入口 URL。生产只允许实际选定的 file 入口（允许 hash，拒绝额外 query）；开发只允许配置的 HTTP loopback 根入口和端口。X Auth、代理、MCP、桌面、插件、AGY、WebDAV、HTML 阅读注册均经过共享门禁。主文档导航/重定向拒绝非可信目标；外链弹窗仅允许 HTTP(S)/mailto 并使用系统应用打开。后台阅读调度也在发送生成事件前检查可信文档；AGY 迟到事件重新检查来源。

原有 plugin 页面自身权限策略继续保留。被阻止的导航不会令插件宿主永久卡在 navigating；性能诊断 fixture 的可信文档同步映射到它实际重定向加载的隔离候选文件，避免因新增门禁让基准功能失效。生产源码没有加入测试环境绕过开关。

生产审计：根与 server 均 0 vulnerabilities；server 完整审计也是 0。根完整审计仍返回 5 high：braces、chokidar、fast-glob、micromatch、tailwindcss，是同一开发文件匹配依赖链的传播，不是五个独立业务漏洞。详见 `final-audit-*.json`。npm 当前建议包含 Tailwind 大版本迁移，本轮未强制升级整套样式工具链。

此外，Electron 的沙箱、Markdown 清洗、插件隔离不能证明系统不存在其他漏洞。本轮没有完成全接口渗透测试、所有 SSRF 路径、凭据生命周期或多用户部署审计。

## 最终验证记录

| 检查 | 实际结果 |
| --- | --- |
| `npm run test:run` | 退出 0；前端 288 文件 / 3,126 测试通过；后续 Node/Electron 套件 340 通过、1 跳过 |
| `npm --prefix server test` | 38 文件 / 358 测试通过 |
| 类型 | `npm run typecheck` 通过；新增测试中误用的 Testing Library exact 参数已修正并复测 |
| Lint | 0 errors / 13 warnings；主要为既有工作台 effect、Gist cleanup ref 和 Fast Refresh 导出 |
| 模块/翻译/插件/Worker/HTML 边界 | 五个检查均退出 0 |
| 前端候选构建 | Vite 成功；直接输出独立目录，没有触发 prebuild 版本同步 |
| 后端候选构建 | tsc 成功，独立 server-build 目录 |
| Bundle budget | 指定候选目录检查，通过；不是检查日常旧 dist |
| Compose | split 与 fullstack 的 `config --quiet` 通过；无容器运行验证 |
| 代码差异格式 | `git diff --check` 通过；清理 SearchBar 原有尾部空格，保留逻辑 |
| UI | 三尺寸仓库布局、单结果、list、手机明暗设置、键盘、搜索、备份/AI 跳转和草稿保留，截图与 JSON 记录 |
| 治理工具 | 白名单清理、数据保护与 junction 拒绝测试通过；执行后 dry-run 为 0 |

本机 Node v25.8.2；server Vitest 声明的受支持 major 与该版本不一致，CI 分别使用 Node 24/22。因此本机通过不等于已在 CI 的运行时实测。首次完整链的一个版本恢复子进程异常退出，单独重跑和最终完整链均通过；保留了 `retest-update-version.log`，没有删除失败信息来制造首次成功。插件符号链接测试有 1 个因 Windows EPERM 跳过，不能称全部符号链接实机检查完成。

审查服务早期出现一次 Node stack overflow；另一次 HMR 报 backend 初始化循环引用，整页重载后恢复。最终使用独立 Vite cache 入口完成截图；不把早期空白页当成修复成功，也不把此现象外推成生产构建必然失败。后续应在受支持 Node 上独立复现开发 HMR 链路。

候选产物：`output/project-audit-20261003/build/`、`server-build/`。完整日志、审计 JSON、基准、截图、差异备份与治理清单位于同一证据目录。

## 文件治理结果

1. 退休 9 个无当前引用、硬编码浏览器/端口或可能读取真实后端的旧截图脚本：`capture_ai_active_chat.py`、`capture_ai_details.py`、`capture_all_pages_fresh.py`、`capture_chat_messages.py`、`capture_custom_discovery_full.py`、`capture_discovery_audit.py`、`capture_repo_screenshots.py`、`deep_audit_screenshots.py`、`test_modal.py`。活动 scripts 已删除，原文件和哈希保存在 `retired-files/scripts/`；Git 历史也可恢复。
2. 归档 3 份 Android 发现记录至 `docs/archive/android-20260930/`，保留原文并新增退役说明。没有删除仍有数据/协议依据的历史证据，也没有把文中旧“服务未升级”当成今天的状态。
3. 实际清理固定白名单的 **11 个文件，174,226 bytes**：4 个 Android 日志、旧桌面输出日志、scratch 截图、2 个 TS 增量缓存和 Python 字节码。清理前逐项复制并校验哈希，执行后候选数量为 0。TS/Python 缓存随后重新生成属于正常现象。
4. 新增 `docs/README.md`、`scripts/README.md`，更新开始使用入口；增加 Python 缓存忽略规则。治理工具默认 dry-run，必须显式 `--apply`，拒绝符号链接与执行间变化。
5. `file-governance.json`、`cleanup-preview-final.json`、`cleanup-applied.json`、`cleanup-after.json` 保存路径、原因、字节与 SHA-256。运行资料、后端部署、数据库、证据目录、原始未提交开发和日常构建未按“过期”批量删除。

旧产品分析、其他 mobile 历史资料和可用专项脚本仍保留，并由文档入口标明时点。它们是否删除应依据引用与恢复价值，而不是修改日期；本轮不通过清空 output 或数据库来夸大磁盘节省。
