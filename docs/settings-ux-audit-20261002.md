# 设置页设计与功能审阅 · 2026-10-02

本次已在源码中完成重点重构，并通过开发页面截图与调用链审阅覆盖全部 16 个设置页。设计继续使用项目原有配色和控件，主要调整信息层级、默认展开范围、状态反馈及配置与实际执行的一致性。

## 用户提出的三处问题

### 仓库身份恢复有什么用

它用于修复历史仓库 ID 与分类、订阅、阅读记录等数据的关联。旧版本留下的标识或仓库名称变化，可能使同一个仓库的资料不能正确关联。名称相同也不能直接证明是同一个仓库，因此流程是先生成迁移预览、人工确认对应关系、再执行已确认映射。

它不是登录功能，也不是常规同步功能。没有历史关联异常时不需要使用。已从“通用”移到“数据管理”的折叠维护入口，并增加用途说明；有尚未处理的恢复日志时会自动展开，避免隐藏需要恢复的操作。

实现依据：[身份恢复组件](D:/桌面/GSM/src/components/settings/RepositoryIdentityMigrationPanel.tsx)、[数据管理](D:/桌面/GSM/src/components/settings/DataManagementPanel.tsx)。

### AI 配置重构

- AGY 与 API 服务使用同一个当前服务选择器，点击名称或单选框即可切换。选择由 `activeAIConfig` 持有，刷新后保留。
- 显示当前使用、未检测、检测通过、检测失败、未启用、配置不完整和程序未找到等状态。检测参数变化后，旧检测结果不再作为当前结果展示。AGY 的检测还核对可执行文件标识、模型与推理强度。
- AGY 配置默认收起，展开后首先呈现模型和全局并发。超时、队列、推理强度等放入高级参数。
- 原来的 13 组独立表单，改为 5 个批量任务的并发限制：仓库摘要、仓库详情、Gist 摘要、Release 摘要、发现订阅。其余功能默认共用全局参数。
- 已存在的特殊模型、推理强度、超时配置没有被静默删除。仅在存在时显示“历史特殊配置”，用户可逐项恢复全局默认；批量并发限制保留。
- API 的主要表单保留名称、接口类型、端点、密钥和模型；MiMo 保留必要的渠道选项。推理、工具调用与提示词折叠，当前 API 的批量并发单独呈现。
- 仓库问答保留独立模型选项，但默认折叠；关闭问答时，其配置控件禁用。

额外发现并修复了三个功能问题：API 的并发设置在部分调用链被固定为 1，另一些调用又可能自动升到 10；重新填写密钥后仍保留解密失败状态；草稿检测没有完整传递 MiMo 渠道和工具调用选项。现在相关批量执行遵守用户设置的上限，密钥替换可恢复配置可用性，草稿检测使用完整参数。AGY 即使检测结果过期，也允许停用已启用的服务。

并发的取舍：AGY 全局最大 5，API 批量任务最大 10。并发可能缩短等待时间，也会集中消耗额度并提高限流概率；它不能证明模型速度或总成本一定更优。API 上限约束相应批量任务，不能理解为账户中所有独立任务共享一个全局额度池。

状态的取舍：“检测通过”说明相应参数在检测时通过，不保证未来网络、登录和额度一直有效。API 检测结果目前保留在当前设置页会话内，重新进入页面后可重新检测。不可用的当前选择会明确提示，不自动替换为另一项可能产生费用的服务。

实现依据：[统一选择器](D:/桌面/GSM/src/components/settings/AIServiceSelector.tsx)、[AI 页面](D:/桌面/GSM/src/components/settings/AIConfigPanel.tsx)、[AGY 参数](D:/桌面/GSM/src/components/settings/AgyFeatureProfiles.tsx)、[并发计算](D:/桌面/GSM/src/services/agyProfiles.ts)。

### 手机 / Tailscale 后端同步退役

已移除设置页中的 Android/Tailscale 手机连接说明、迁移快照与初始化入口、任务及提案面板，并移除其孤立的桌面初始化辅助函数。

需要纠正一个容易混淆的前提：不用手机连接后端，不代表桌面不再使用后端资料同步。现有 `src/home/desktop.ts` 仍负责仓库、Release、分类、订阅、已读及工作台资料的同步投影；整套删除会破坏已连接桌面 workspace 的资料链路。因此保留桌面增量同步、待上传/冲突数量、立即同步及冲突版本选择。使用 v2 workspace 时，不再展示实际上都执行同一 flush 的旧“上传/下载”按钮。

另外修复了候选后端认证失败后未恢复旧密钥、同步失败未正确释放忙碌状态的问题，并阻止同时提交相反方向的同步。

本次没有操作主机上的 Tailscale、Windows 后端服务或真实数据库。历史部署文档已注明手机入口退役；如果桌面目前仍填写私人 HTTPS 地址，该网络连接本身仍可能依赖 Tailscale，需要与“页面入口删除”分开处理。离线 HTML 的移动阅读用途也与手机直连后端不同，继续保留。

## 16 个页面的审阅结果

下表中的“保留”表示审阅后没有进行整页重写，不表示已实测对应外部服务。所有页面都获得新的分组导航；侧栏支持按页面名称搜索、清空和无结果反馈。快速切页不再因旧动画锁而丢失点击。

| 页面 | 发现与处理 | 截图 |
| --- | --- | --- |
| 通用 | 身份迁移维护项与日常设置混杂，已移出。保留 GitHub Token、桌面启动/托盘、更新与反馈；Token 权限说明复用现有入口。 | [前](D:/桌面/GSM/output/playwright/settings/before/general.png) / [后](D:/桌面/GSM/output/playwright/settings/after/general.png) |
| 外观 | 主题、字体、语言分区已有完整结构，保留。字体和主题大量选项属于偏好选择，没有直接删减。 | [前](D:/桌面/GSM/output/playwright/settings/before/appearance.png) / [后](D:/桌面/GSM/output/playwright/settings/after/appearance.png) |
| 星标同步 | 保留“只同步 Stars”与“Stars + Lists”的范围选择，以及独立的分类推送操作。推送会改写同名 GitHub Lists，与拉取含义不同，不能合并成一个按钮。现有确认与进度继续保留。 | [前](D:/桌面/GSM/output/playwright/settings/before/starSync.png) / [后](D:/桌面/GSM/output/playwright/settings/after/starSync.png) |
| AI 配置 | 重构服务选择、状态、主要表单、高级参数、历史覆盖与批量并发，修复执行与配置不一致。 | [前](D:/桌面/GSM/output/playwright/settings/before/ai.png) / [后](D:/桌面/GSM/output/playwright/settings/after/ai.png) / [展开 AGY](D:/桌面/GSM/output/playwright/settings/after/ai-agy.png) / [API 表单](D:/桌面/GSM/output/playwright/settings/after/ai-api-form.png) |
| WebDAV | 空状态与添加入口清楚，保留独立配置页。与备份页分别负责“连接配置”和“使用连接”，没有强行合并。 | [前](D:/桌面/GSM/output/playwright/settings/before/webdav.png) / [后](D:/桌面/GSM/output/playwright/settings/after/webdav.png) |
| 备份恢复 | 未配置时原来只能看到不可用按钮，已加直接前往 WebDAV 的入口；备份与恢复互斥。恢复保留本机 AGY 绑定，导入的 AGY 描述不能自动启用。 | [前](D:/桌面/GSM/output/playwright/settings/before/backup.png) / [后](D:/桌面/GSM/output/playwright/settings/after/backup.png) |
| 后端同步 | 手机专属入口退役；保留桌面 workspace 的状态与冲突恢复。修复旧 URL/密钥回滚与同步互斥。 | [前](D:/桌面/GSM/output/playwright/settings/before/backend.png) / [后](D:/桌面/GSM/output/playwright/settings/after/backend.png) |
| 分类管理 | 默认分类较多，但已有编辑、隐藏、恢复、拖动及按钮排序，保留。大量自定义分类时可能仍需页内搜索；本次截图使用默认分类，没有把该情形宣称为已验证。 | [前](D:/桌面/GSM/output/playwright/settings/before/category.png) / [后](D:/桌面/GSM/output/playwright/settings/after/category.png) |
| 菜单管理 | 设置与仓库入口不能隐藏，避免用户丢失必要导航。其他菜单可隐藏，已有按钮排序作为拖动替代，保留。 | [前](D:/桌面/GSM/output/playwright/settings/before/menu.png) / [后](D:/桌面/GSM/output/playwright/settings/after/menu.png) |
| 数据管理 | 修复隐藏文件输入引起的横向溢出；身份恢复和选择性删除默认折叠。替换导入保留本机 AGY，清理 AI 配置明确为 API 配置，并修正计数与确认文案。 | [前](D:/桌面/GSM/output/playwright/settings/before/data.png) / [后](D:/桌面/GSM/output/playwright/settings/after/data.png) |
| 诊断日志 | 筛选项较密，但用于定位不同事件，保留现有搜索、分页与详情弹窗。完整日志采集会增加存储，并可能包含请求内容；既有采集开关保留。 | [前](D:/桌面/GSM/output/playwright/settings/before/logs.png) / [后](D:/桌面/GSM/output/playwright/settings/after/logs.png) |
| 网络设置 | 代理与 aria2 RPC 分属不同流量，应保留独立配置。关闭时收起表单的现有行为合理；补充审阅启用后的布局。 | [前](D:/桌面/GSM/output/playwright/settings/before/network.png) / [后](D:/桌面/GSM/output/playwright/settings/after/network.png) / [展开](D:/桌面/GSM/output/playwright/settings/after/network-expanded.png) |
| 向量搜索 | 原页同时暴露连接、索引内容、调优和删除命令，过长。保留连接与状态，索引内容、搜索参数和删除命令默认折叠。更换嵌入模型必须重建索引；HyDE/重排可能引入额外 AI 调用，不能仅按向量查询看成本。 | [前](D:/桌面/GSM/output/playwright/settings/before/vectorSearch.png) / [后](D:/桌面/GSM/output/playwright/settings/after/vectorSearch.png) |
| MCP | 保留服务状态、本地监听、Token 与主要接入配置；旧 SSE 协议的重复 JSON 默认折叠。模型服务与对外提供资料的 MCP 服务不是同一种配置，继续独立。 | [前](D:/桌面/GSM/output/playwright/settings/before/mcp.png) / [后](D:/桌面/GSM/output/playwright/settings/after/mcp.png) |
| 插件管理 | 本地插件、社区注册表与网页搜索端点职责明确，保留。Worker 插件属于受信任代码，既有权限与风险说明保留。截图脚本的注册表模拟响应已按真实协议修正。 | [前](D:/桌面/GSM/output/playwright/settings/before/plugins.png) / [后](D:/桌面/GSM/output/playwright/settings/after/plugins.png) |
| 每日 HTML | 原页超长，拆为内容范围、阅读样式、邮件发送、记录回传四个子页。切换保留未保存输入和同一个 controller；预览、导出与邮件仍使用同一设置来源。 | [前](D:/桌面/GSM/output/playwright/settings/before/htmlReading.png) / [后](D:/桌面/GSM/output/playwright/settings/after/htmlReading.png) / [样式](D:/桌面/GSM/output/playwright/settings/after/htmlReading-layout.png) / [邮件](D:/桌面/GSM/output/playwright/settings/after/htmlReading-mail.png) / [回传](D:/桌面/GSM/output/playwright/settings/after/htmlReading-records.png) |

## 数据删除范围的额外发现

旧“删除所有数据”的实现只删除主 store 和特定频道缓存，不涵盖所有设备文件、工作台、HTML 阅读、插件及后端存储。因此不能作为完整个人数据擦除工具。已将名称改为“清空主资料并退出登录”，同时修正页面说明、确认说明和完成反馈。这次没有扩张其删除范围，也没有实际执行清理。

备份并不等于完整设备迁移：AGY 依赖本机可执行文件和登录，导出只是未绑定描述；邮件授权、插件安装与后端数据也有独立生命周期。恢复后的本机 AGY 保留，备份不能从另一台设备替换它的认证状态。

实现依据：[备份恢复](D:/桌面/GSM/src/features/settings/hooks/useBackupActions.ts)、[可移植配置恢复](D:/桌面/GSM/src/utils/aiConfig.ts)、[数据管理清理与导入](D:/桌面/GSM/src/components/settings/DataManagementPanel.tsx)。

## 验证与边界

截图使用真实 Chromium 渲染开发页面，隔离浏览器存储、测试账户及模拟桌面桥；外部请求全部拦截，没有调用真实 AI、发送邮件、操作真实个人资料或推送 GitHub Lists。AGY/API、WebDAV、代理、MCP 客户端、Cloudflare 与 SMTP 的真实连通性不在此测试结论内。后端已连接 workspace 和冲突处理由组件测试覆盖，截图中的后端处于未连接状态。

前后截图主题不同（前为深色，后主要为浅色），应比较结构和内容范围，不应把配色差异当成此次改动。测试账户头像为空，截图中的头像加载问题来自测试数据。

| 页面 | 原始全页截图高度 | 调整后默认高度 |
| --- | ---: | ---: |
| AI | 1854 px | 1000 px |
| 每日 HTML | 4277 px | 1511 px |
| 数据管理 | 2640 px | 1729 px |
| 向量搜索 | 2734 px | 2020 px |
| MCP | 1645 px | 1461 px |

以上是 1440×1000 视口下的隔离样本截图尺寸，包含应用导航和空白；数据页原始横向溢出使截图宽度扩到 1727 px，调整后为 1440 px。折叠与子页减少默认可见内容，不代表功能被删除或每种真实数据规模都会得到同样高度。

验证记录：

- 相关前端回归 187 项；AGY Electron 运行时 46 项。
- TypeScript、修改文件 ESLint、翻译键与十种语言资源检查、前端分层检查通过。
- Vite 生产构建与现有 bundle 预算检查通过。未生成或安装新的桌面安装包。
- 16 个设置页以及 AI 的 1280、1024、768、390 px 布局检查均无横向溢出，页面脚本错误为 0。另有深色 AI 截图。
- [浏览器检查记录](D:/桌面/GSM/output/playwright/settings/after/report.json)、[前端测试日志](D:/桌面/GSM/output/settings-regression.log)、[AGY 测试日志](D:/桌面/GSM/output/settings-agy-runtime.log)、[构建日志](D:/桌面/GSM/output/settings-build.log)。
- [复现截图脚本](D:/桌面/GSM/scripts/audit-settings.cjs)使用隔离 fixture，不读取真实凭据。默认连接本机 Vite 5173 端口，可通过 `GSM_PLAYWRIGHT_PATH` 指定 Playwright 包。

后续如要进行完整设备数据擦除、退出 Tailscale 或更换后端部署，应先明确设备独立存储和桌面连接的实际范围；这些属于持久化与部署迁移工作，不能由隐藏设置入口代替。
