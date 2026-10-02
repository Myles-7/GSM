# GSM 移动三页面交付记录

## 已实现

- 仓库、发现、AI 三入口，桌面语义主题、明暗/系统主题、Lucide 图标、抽屉、子页面与触摸布局。
- 仓库搜索、筛选、分类、渐进加载、批量操作、详情、README、结构化分析、版本与独立问答；保持离线队列和版本冲突保护。
- 发现内置频道、自定义频道编辑/生成/历史、X、Telegram、周刊、代码搜索及趋势历史；账户约束的后端接口托管凭据，错误状态分别呈现。
- AI 工作台、持久化草稿、项目/候选、原位任务流、聊天历史分页、任务取消/恢复、整理提案审阅和版本保护。
- 发现配置、订阅、已读及历史同步，桌面本地资料首次迁移和 X 凭据受控迁移；项目候选使用稳定名称跨设备保存。
- 后端新增 custom_discovery、organization 持久任务，研究项目参数在提交时固定快照。

## 交付文件

- APK：`output/mobile-parity/GSM-mobile-parity-debug.apk`
- 手机应用 ID：`io.github.gsm.personal.debug`；版本 `0.8.4-debug` / `8004`；最低 Android 10。
- APK SHA-256：`4BA6F8F03F565384A37797741367B6DCE4F30429CC9E5856206AB10719B28B00`
- 已用 apksigner 检查新旧 APK：证书 SHA-256 均为 `a900bdb114d09bdd51da8e81f26f58ca64aebce59c636afd436e7795a16abd3f`。应用身份相同，但实际手机覆盖安装仍待验证。
- 后端发布目录：`output/home-backend/release-mobile-parity`。
- 桌面与手机对比：`output/mobile-parity/comparison.html`，同目录包含全部截图。

本次延用调试签名，没有生成新的正式签名材料。

## 实际测试记录

| 检查 | 结果与证据 |
| --- | --- |
| 前端完整 Vitest | 2174 通过；frontend-full.json |
| 后端完整 Vitest | 214 通过；backend-full.json |
| 移动/同步针对性测试 | 56 通过；frontend-targeted.json |
| 最终 TypeScript | 通过；typecheck-final.log |
| 边界与体积检查 | 共享 AI 核心、前端依赖边界、移动不引入桌面 Store、桌面包预算通过 |
| 桌面与移动构建 | Vite 构建与 Capacitor 同步通过；移动使用固定 Node 22.23.3 |
| Android Gradle | Debug APK 构建成功；android-build.log |
| 独立后端发布包启动 | 空测试目录启动成功，健康 200、无鉴权 401、能力握手 200；release-smoke-report.json |
| 响应式浏览器 | 三页面 × 360/390/430/768/1024px × 明暗主题，共 30 组无横向溢出；browser-report.json |
| 大资料集 | 5000 仓库首次渲染 40、追加至 80；10000 消息首次 30、历史追加至 60 |
| 桌面基准 | 实际 React 桌面组件、独立模拟数据，1280px 明暗六张截图；desktop-baseline-report.json |

Node 26 的移动构建进程曾发生 libuv 退出断言；固定 Node 22.23.3 重建成功。浏览器测试使用模拟后端，不产生付费模型请求或实际 Star 操作。

## 部署与尚待验收

- 升级前已使用 SQLite backup API 保存 `.deployment-staging/pre-mobile-parity-20260930.sqlite`，完整性检查为 ok。备份为私有文件，不能提交 Git。
- 电脑服务升级启动被 Windows UAC 取消（系统返回“操作已被用户取消”），没有执行实际升级，旧服务保持运行。已准备 `.deployment-staging/upgrade-mobile-parity.ps1`；下次执行需接受 Windows 管理员授权。升级成功后运行 `.deployment-staging/verify-mobile-parity.mjs` 检查私人 HTTPS 和真实上游；该检查尚未运行。
- 真实桌面仍可能运行旧窗口；自动发现资料迁移要在新构建启动后执行。迁移逻辑已测试，真实资料迁移数量尚未确认。没有强制关闭用户窗口。
- X、Telegram 的真实服务网络可达性及 X 凭据状态，须以升级后的部署检查为准。页面和接口实现不代表这些上游在当前网络一定可用。
- 代码搜索使用 GitHub 搜索语法；不承诺桌面其他搜索提供方的正则语义。
- Android 真机覆盖安装、移动数据、软键盘、安全区域、返回键、锁屏后台任务及断线恢复尚未实测。浏览器截图不能替代这些结论。
- README 使用后端返回的提交与文件目录解析相对资源；缓存同时保存资源基址，兼容已有纯文本缓存。

所有修改保留在现有工作区，没有重置、暂存或提交用户原有改动。
