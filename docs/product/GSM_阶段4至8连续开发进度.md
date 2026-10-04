# GSM 阶段 4～8 连续开发进度

日期：2026-10-03。本机 Windows 自用；按用户确定的范围逐个子任务交付，不自动提交或发布。

| 子任务 | 状态 | 交付与边界 |
| --- | --- | --- |
| 4A 应用版本来源 | 已实施，代码核对成立 | 沿用 package version，不重复开发 |
| 4B 导出覆盖 | 已实施、已验证 | 新增六个已有字段；实际恢复范围与导出范围分开说明 |
| 4C v1.1 codec/身份 | 已实施、已验证 | 旧 v1.0/v1.2 读取保留；缺身份显式确认；WebDAV 写出不变 |
| 4D 局部安全恢复 | 已实施、已验证 | 仓库/组织/所选偏好预览、journal/checkpoint/继续/撤回；兼容导入独立；Home 使用 v2/outbox |
| 5 搜索正确性/排序 | 已实施、已验证 | 七类 corpus 接入真实 Hook；候选并集与内存 session；显式排序优先；身份/配置/取消 guard |
| 6 启动 | 已实施一处、已复测 | 默认 accent 跳过 computed style 读取；100 仓库同条件 3 对样本，首屏机会 median 减少约 24～27 ms |
| 7 grid 可读性/焦点 | 已实施一处、已验证 | light/dark 实际截图后仅语言点加 token 边界；键盘详情/选择/两条 reduced-motion 通过 |
| 8 Windows 托盘/菜单/会话 | 已实施、契约及隔离状态验证 | 三态、菜单状态/minimizeToTray、最终 session-end；实际 Shell 点击及注销/重启/关机尚未验收 |

## 4B：字段完整性

原本地 JSON 已覆盖 Repository、Release、部分配置、分类、Discovery 与部分偏好，但遗漏子分类和顺序。此次沿用已有分类/UI 导出选项补六个已有字段，不新增领域 owner、业务写入、schema、依赖或后台任务。不覆盖 List 映射、聊天/HTML Reading 历史、Electron vault、backend SQLite 或整机数据。

回滚仅撤回六字段类型与 projection，不还原整份文件或用户其它修改。原始前镜像与日志在 `output/stages4-8`。

## 本轮完成边界

已明确实现全部处理；没有待产品决策，没有提交、发布或替换日常 dist。真实 Home 灾难恢复、实际 Windows 系统结束、全部主题和大列表剩余性能没有全面实机验收，不能列作已解决。

完整文件、owner/schema/scope、证据、测试、风险和局部回滚见 [阶段 4～8 交付报告](GSM_阶段4至8连续开发交付报告.md)。阶段 3 虚拟化、跨设备、全域备份、标签治理、Release 通知、启动投影及无关 HTML Reading 不进入本轮。其它启动候选证据不足，暂不实施。

本轮停止。后续性能任务优先复核 grid 初次几何读取和批挂载，不自动接入虚拟化。Windows 真实 Shell/系统结束使用交付报告中的手动步骤，不以模拟事件代替。
