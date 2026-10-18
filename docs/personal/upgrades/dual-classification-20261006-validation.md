# 双分类开发分支验收记录

日期：2026-10-06。分支：`codex/dual-classification-20261006`。

## 结论

代码和离线/隔离界面检查通过；真实模型质量验证未通过，不宣称全部验收完成。不合入个人主分支、不推送、不生成安装包、不自动应用真实账号分类。保留当前其他线程的每日阅读改动，不混入其提交。

## 已通过门禁

| 检查 | 本轮实际结果 |
| --- | --- |
| 前端全量 Vitest | 315 个文件，3423 项通过 |
| 后端全量 Vitest | 41 个文件，376 项通过 |
| `npm run typecheck` | 通过 |
| `npm run lint` | 全仓检查通过，0 warnings |
| i18n / boundaries / plugin-registry | 全部通过 |
| 前端构建及 bundle budget | 通过；legacy 入口 2020.23 KiB，限制 3000 KiB |
| 后端构建 | 通过 |
| Electron MCP | 43 项通过 |
| Electron AGY | 47 项通过 |
| Electron 插件 | 127 项通过，1 项既有跳过，0 失败 |
| Electron WebDAV | 50 项通过 |
| 版本流程 | 10 项通过 |
| CI 检查脚本 | 44 项通过 |
| 桌面启动器 | 10 项通过 |
| Electron 每日阅读相关回归 | 37 项通过 |
| 隔离 Electron 界面 | 两方案生成/应用/恢复/浏览、部分完成、错误、120 仓库、退役预览及末项滚动通过；0 pageerror |
| SQLite 备份复核 | `integrity_check=ok`，62 仓库；只读副本 |

Vitest 使用 `NODE_OPTIONS=--no-experimental-webstorage` 和 `--maxWorkers=4`。前端全量日志中的故意模拟 README lazy chunk 失败属于通过的异常恢复用例，不是未处理的验收失败。构建仍有 translate.js 第三方 eval 及既有分块警告，本轮没有增加 `unsafe-eval` 或放宽 CSP。

`git diff --check` 采用 `cr-at-eol` 检查：仓库 `.gitattributes` 明确对 SearchBar 保留既有混合换行；不为消除 CRLF 提示引入整文件换行改动。

## 重点回归

- 旧分类迁移幂等、账号隔离、用途/技术不互相覆盖；旧备份、部分目的方案上传及普通元数据更新保留技术数据。
- JSON 合并/替换和模拟桌面 DAV 上传/下载往返；工作台 v3 双方案、v3 明确单方案及旧 v1/v2 的导入为禁用执行的历史。
- 全量覆盖、批次输入预算、遗漏/重复/非法 ID、无有效事实、合法空结构、资料不足、读取失败、限流重试、鉴权暂停、停止/迟到响应及请求预算上限。
- 高级分类创建/改名/合并绑定技术方案，旧记录绑定用途；工作台技术提案的应用/恢复不修改用途归属。
- 草案确认失效、锁定授权、范围外成员变化、恢复冲突、本地应用成功但同步失败、同步重试不重放写入及重启只读取检查点。
- 新草案清除旧筛选及手机页签；重新核实失败清除旧选中建议，避免显示和执行过期成功结果。

## 界面证据

截图目录：`D:\GSM-backups\dual-classification-20261006\ui-smoke`。

- `setup-desktop.png`、`setup-mobile.png`：范围、双分类目标及高级设置。
- `progress-desktop.png`：明确理解覆盖及各方案进度。
- `purpose-review-desktop.png`、`technology-review-desktop.png`、`technology-review-mobile.png`、`technology-tree-mobile.png`：两方案预览、长名称、关联目标与窄屏切换。
- `applied-desktop.png`、`restored-desktop.png`：逐项结果和恢复。
- `purpose-browse.png`、`technology-browse.png`：日常侧栏方案切换。
- `partial-review-desktop.png`、`partial-review-mobile.png`、`error-review-desktop.png`、`error-review-mobile.png`：部分完成、无有效建议及明确错误，不自动应用失败项。
- `bulk-review-desktop.png`、`bulk-review-mobile.png`、`retirement-preview-desktop.png`、`bulk-last-repository.png`：120 仓库、退役预览及最后一项可达。

桌面 1600×1000、窄屏 390×844。窄屏弹窗测量 y=16..828、h=812，主按钮和关闭入口可见，没有页面横向溢出。截图先等待布局稳定；最终固定模拟网络响应验收，保留真实 AIService 文本提取逻辑，主进程及 Chromium 外部网络仍被测试护栏禁止。

同目录的 `failure.png` 保留了测试桩版本不一致的诊断现场，不属于通过场景，也不作为真实网络或模型根因证据。

## 未通过与未验证

真实 `deepseek-flash` 模型以最多 5 个仓库执行过 10 次请求：理解为 0、两方案未就绪，未应用。旧探针只保留错误阶段而未记录足够细节，不能定位实际模型/网络/格式根因。已改善下一次探针的脱敏记录；原额度耗尽后没有继续调用模型。

高级分类管理的旧 AI 结构建议仍使用有限概览，不等同于新的全库逐仓管线；手动结构管理已按方案执行。没有额外真实 DAV 服务、长期数千仓库性能和翻译服务网络验收。

## 保护与使用

- 初始恢复标签：`recovery/pre-dual-classification-20261006`，基线 `6b30a96`。
- 外部恢复目录：`D:\GSM-backups\dual-classification-20261006`，包括 Git bundle、初始工作区差异、SQLite 一致性副本、独立密钥和桌面配置。续办最终差异另存，注明包括其他线程未提交的工作区内容。
- 5174 仍由另一项目占用，未终止或挪用。隔离 Vite 预览为 `http://127.0.0.1:5198`，这是不同 IndexedDB 来源，不搬迁或清空原来源数据。
- 原桌面入口和应用身份保持。当前代码留在开发分支，未经真实模型质量门禁不进行本地主分支合并。
- 已运行的验收进程均结束，只有用于预览的 Vite 服务保留。没有任何真实收藏写入，也没有后台续跑模型任务。
