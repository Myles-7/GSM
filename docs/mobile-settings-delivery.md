# GSM 手机设置与三页面体验交付记录

## 本轮实现

- 分组设置首页与独立子页：外观阅读、连接账户、同步冲突、AI 偏好、仓库管理、发现管理、本机数据和诊断。
- 默认紧凑仓库列表，筛选标签、常用筛选、最近浏览、分类标签管理、逐条版本保护的批量修改、README/分析阅读工具。
- Star 刷新为不消耗模型额度的后端持久任务；完整分页成功后才判断取消 Star，保留人工资料，支持取消、检查点恢复和 20 秒上游超时。
- 发现频道各自保留条件、缓存、分页及浏览位置；明确错误状态，折叠帖子、期刊历史、加入研究反馈。
- AI 搜索项目/会话、草稿、按批加载候选与整理范围；阅读历史时不强制跟随，提案状态筛选和结果统计。
- 仓库分析按桌面真实类型组织概览、使用与部署、维护，完整呈现摘要、标签、命令、来源及过时状态；嵌套对象不再丢内容。
- AI 发现期刊按照桌面候选评估呈现推荐理由、核实状态、待核实项、筛选依据及已有仓库分析；证据缺失明确提示。

## 数据保护

偏好、保存筛选、最近浏览留在本机；分类/标签/频道沿用增量同步和基础版本。备份保持 version 1 兼容，排除凭据和可重建缓存，导入预览不写资料，正式恢复保留当前待上传队列；恢复期间与正在执行的同步互斥。缓存清理保留业务资料、草稿、恢复任务与凭据。未知冲突字段在高级详情中展示，并脱敏。

## 已部署结果

- Windows GSMBackend 已于 2026-09-30 升级成功，服务 Running，仍通过私人 Tailscale HTTPS 访问。
- 发布目录：output/home-backend/release-mobile-settings-final。
- 升级前 SQLite 一致性备份：私有 .deployment-staging/pre-mobile-settings-20260930.sqlite，integrity_check=ok。
- 空目录独立发布包：健康 200、无鉴权 401、能力 200，包含 refresh_stars / custom_discovery / organization。
- 实际私人 HTTPS：健康 200、无鉴权 401、能力 200；真实 GitHub 发现 200。
- 实际 Star 刷新完成：fetched=62、updated=62、added=0、unstarred=0，不调用模型。
- 已备份关闭状态的桌面 profile，并启动更新后的桌面。当前后端可见 1 个发现配置、3 个趋势历史、2 个来源订阅，以及 62 仓库、12 会话、52 消息；没有已生成自定义期刊可验证迁移。
- X 实际检查返回 X_CREDENTIAL_REQUIRED（409），电脑尚未配置；Telegram 返回 DISCOVERY_UPSTREAM_UNAVAILABLE（502）。这些来源尚未通过真实使用验收。

## 测试与产物

- 最终前端完整测试 2211/2211 通过；settings-frontend-release.json。仓库与发现分析包含真实类型、旧 JSON、证据缺失和过时状态回归。
- 后端完整测试 226 通过，包含分页失败、取消、恢复、并发编辑及请求/正文超时。
- 类型、ESLint、共享核心/前端边界和桌面包体积检查通过。
- 浏览器 5000 仓库/10000 消息保持分段渲染；三页面 5 宽度×明暗主题及设置子页无横向溢出。模拟 API 不替代真实设备验收。
- 截图与对比页：output/mobile-settings/comparison.html；AI 分析和来源另有专门截图。

## 待验收

未连接 Android 真机，覆盖安装、移动数据、软键盘、系统字体放大、系统返回、锁屏与重新进入需独立实测。延用现有调试应用身份及签名，不生成新的正式签名证书。不开发订阅中心、Fork、Gist、远程凭据管理或 WebDAV。

## APK 发布信息

APK：output/mobile-settings/GSM-mobile-settings-debug.apk；应用 ID io.github.gsm.personal.debug，版本 0.8.4-debug（8004），最低 Android 10 / target 36。apksigner 验证通过，新旧证书 SHA-256 均为 a900bdb114d09bdd51da8e81f26f58ca64aebce59c636afd436e7795a16abd3f。APK SHA-256：1B5A5FD9B49C75D1E5B79A3A58C28CA4C7D39EDBF360448E0F2350E203426477。身份与签名一致，可进行覆盖安装；真机结果仍待验证。

