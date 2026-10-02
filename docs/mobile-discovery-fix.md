# 手机发现能力恢复修复（2026-09-30）

## 诊断

用户截图出现“电脑后端尚未提供发现能力”且刷新禁用。当前真实电脑服务通过私人 HTTPS 返回 discovery.available=true，趋势请求 HTTP 200、3 个条目。手机此前只在启动时重新握手一次；如果首次握手因网络/Tailscale 尚未就绪失败，缓存中的旧能力不会随之后成功的业务同步更新。原提示也把能力未验证误述为后端需要升级。

## 修复

- 启动、网络恢复、回到前台与每 60 秒重新检查能力；同一时刻请求合并。
- Android 原生网络/前台事件同样触发能力检查。
- 不重建工作区数据库，不清空离线资料或待上传操作；验证同账户和工作区后更新能力及缓存。
- 发现页区分验证中、验证失败、已确认不支持；提供“重新验证发现能力”，不必退出或重建连接。
- 已确认协议/账户/工作区改变时拒绝覆盖，要求在设置重新连接。

## 验证与产物

- 定向组件/能力/依赖边界共 10 项通过；TypeScript、ESLint 通过。
- 浏览器复现旧能力 → 首次网络失败 → online → 自动恢复趋势列表；缓存更新，无页面错误。证据 browser-recovery.json 与 before/after-network-recovery.png。
- 真实 Tailscale HTTPS /capabilities 与趋势接口通过；live-trending.json。
- APK：output/mobile-discovery-fix/GSM-discovery-fix-debug.apk，io.github.gsm.personal.debug，8004 / 0.8.4-debug；与原应用同签名 a900bdb114d09bdd51da8e81f26f58ca64aebce59c636afd436e7795a16abd3f。
- SHA-256：F602E6D8EFAB073A200154A69BB62B141669B399C7516D125986E0AEB75303E7。

本次后端无需再升级；手机覆盖安装后打开 Tailscale 再进入发现，或点击重新验证。没有连接 Android 真机，设备覆盖安装/移动数据行为未实测。X 缺电脑凭据、Telegram 上游不可达仍是独立来源问题，不能由本次能力握手修复解决。
