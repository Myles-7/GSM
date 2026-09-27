# 个人版仓库与基线记录

记录日期：2026-09-27（Asia/Shanghai）。

## 当前迁移状态

已建立完整上游 Git 历史及两个 Remote，现有个人改动记录为 P0.1.0
（`20f861a5d8174db67ba4541c93158e6d9cf0bef4`），父提交是 v0.8.3。
恢复标签为 `recovery/pre-v0.8.4`。这属于根据源码差异重建历史，不是恢复原始个人提交。
v0.8.4 的固定目标、验收与交付结论以 `upgrades/v0.8.4.md` 和
`upstream-base.json` 为准；个人功能列表见 `features.md`。

以下段落保留为最初记录的历史上下文，其中 403、未初始化等限制已经解除，
不代表当前状态。

## 仓库身份

| 用途 | Remote 名称 | 标准 Git URL |
| --- | --- | --- |
| 官方上游 | `upstream` | `https://github.com/AmintaCCCP/GithubStarsManager.git` |
| 用户创建的个人仓库 | `origin` | `https://github.com/Myles-7/GSM.git` |

地址由用户提供。已移除官方网页 URL 中的 `utm_source` 参数，以及个人仓库链接末尾误包含的中文逗号。这里只记录个人仓库的用途，不推断 GitHub 平台上的 Fork 关系。

机器可读记录见 `upstream-base.json`。当前记录仅表示远端身份与观测结果，不代表本地 Git 配置已经完成。

## 已核实的远端状态

通过 `git ls-remote --symref` 核实：

| 引用 | 完整对象 ID |
| --- | --- |
| 官方 `refs/heads/main` | `6f509d6c65fd537538281b794a6fbdfdb233e8db` |
| 个人仓库 `refs/heads/main` | `6f509d6c65fd537538281b794a6fbdfdb233e8db` |
| 官方 `refs/tags/v0.8.3` 标签对象 | `925305e6ea9bfb126c8ad10ee563d24107070ab4` |
| 官方 `v0.8.3` 解引用后的提交 | `7e63b30774ec9b36e5c57441950a05b94a753fff` |

两个远端在核实时的默认分支都是 `main`，且分支头相同。远端分支可继续变化，后续操作必须重新获取并固定提交。

`v0.8.3` 标签已确认存在，但本次没有确认它是否为最新正式 Release，也没有确认本地源码与该提交完全一致。

## 本地状态与限制

- 本次操作前，本目录没有 `.git`，`git rev-parse --show-toplevel` 失败。
- 根 `package.json` 的版本标记为 `0.8.3`；该标记不足以确定源码来源提交。
- 尝试执行 `git init --initial-branch=personal/main` 时，权限审批服务返回 `403 Forbidden`，工具明确报告命令未执行。
- 尚未建立本地 Remote、下载完整历史、创建本地分支、暂存文件、提交或推送。
- `upstreamVersion`、`upstreamCommit`、`personalVersion` 和 `personalCommit` 暂保留为 `null`，避免将候选版本误当成已验证基线。
- 原需求说明书与已有源码保持不变。

## 权限恢复后的处理顺序

1. 重新检查本地 Git 状态；若期间用户已完成初始化，沿用已有配置，不重复初始化或覆盖 Remote。
2. 保留当前源码和需求文档，建立 Git 元数据，配置上述 `origin` 与 `upstream`。
3. 获取完整历史和官方标签，不使用浅克隆作为长期升级基础。
4. 在不覆盖工作区文件的前提下，将本地文件与候选提交比较，至少检查 `v0.8.3` 及已观测的 `main` 提交；必要时继续查找历史提交。
5. 若找到精确匹配，记录验证依据；若不能匹配，明确列出本地差异并标注来源不确定，不能直接宣称本地就是 `v0.8.3`。
6. 基于确认的历史建立或接续 `personal/main`，保留所有本地差异。不要用无关根提交替代上游历史。
7. 完成验证后更新机器可读基线；正式升级在独立 `upgrade/*` 分支进行。
8. 推送前确认待推送分支、差异及敏感文件。本轮不推送，不修改远端默认分支，不合入新的上游代码。

不要使用 `git reset --hard`、强制 checkout 或删除工作区文件来完成初始化。初始化权限受阻时，也不能通过替换 `.git` 路径等方式绕过审批。
