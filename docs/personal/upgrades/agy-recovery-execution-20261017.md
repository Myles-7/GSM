# AGY 恢复与执行可靠性：执行计划

依据：`agy-remaining-issues-analysis-20261017.md` 与用户批准方案。主对话实施，保留全部已有修改；Store v17、安全边界、独立 CLI、未知调用不自动重放保持不变。

## 阶段与验收

- [x] A1 调用记录与恢复：主进程逐记录原子持久化、safeStorage 正文、发送前意图、终态先落盘、账号隔离、请求去重、共享恢复判断。
- [x] A2 清理所有权：可重试 maintenance，suspect 容量不强清，generation/probe/models 统一租约，警告不被 phase 覆盖。
- [x] A3 调度与配置：interactive Organization；前台 admission 180s、后台30s，与 init20s/model/cleanup5s 分离；完整 profile 显式测试门禁；共享配置错误停止派发。
- [x] A4 仅保存恢复：详情/订阅/Organization 保留结果至业务提交及回执完成；每账号50MiB并发预留；原上下文与身份/lease/版本校验；仅保存和明确丢弃入口。
- [x] A5 验收交付：正式回归、隔离 Electron+CLI fixture、资料副本、前端/server/Electron全量、typecheck/lint/boundary/security/build、实际产物版本、仅清理本轮临时资产。

## 执行约束

每阶段开始重读本计划和审查报告并检查 callers。先将复现转正式测试。未经证实未发送的旧运行任务保守标 unknown；成功结果不得因 schema/长度拒收改 unknown。新调用使用新requestId并记录retryOf。持久化结果正文不进入同步/导出/诊断。safeStorage不可用或持久化失败必须在发送前阻止请求，不降级明文。模型/effort需用户显式测试；timeout/concurrency不使测试失效，健康旧在途请求不取消。

备份：source-only recovery tag `recovery/agy-recovery-20261017`，使用独立index保存全部非ignored文件，不改变用户index。验收成功后删除此tag和本轮临时文件。未进行真实付费调用或远端写操作。

## 最终交付

A1–A5完成。验收和清理以`agy-recovery-validation-20261017.md`及同名JSON为准；checkpoint tag已在成功后移除。原启动入口重启加载修复；unpacked未执行安装或真实profile迁移。
