# Android 与家庭后端交付状态（2026-09-29）

> 归档说明（2026-10-02）：此处 APK/Capacitor 构建方式属于已退役原生路线，不再作为 P0.2.0 交付入口。保留历史记录与安全文件，不恢复移动端专用工程。

## 构建方式

Android 应用使用 Capacitor 8、独立移动端入口 `src/mobile/main.tsx` 和 `vite.mobile.config.ts`。`node scripts/build-mobile.mjs` 编译 `dist-mobile/mobile.html`，重命名为 Capacitor 所需的 `index.html`，然后调用本地 Capacitor CLI 同步 Android 工程，不通过 npx 自动下载未锁定版本。

Windows 上使用 JDK 21 和 Android SDK：

```powershell
npm ci
.\scripts\android-build.ps1 -Variant Debug `
  -JavaHome 'D:\Android\Android_studio\jbr' `
  -SdkRoot 'D:\Android\sdk'
```

也可设置 `JAVA_HOME` 与 `ANDROID_HOME`，省略对应参数。脚本在 `android/local.properties` 写入本机 SDK 路径，该文件不提交 Git。显式参数适合已有环境变量指向失效目录的机器。已经完成 web build 和 cap sync 后，可加 `-SkipWebBuild`。

如果网络必须经过代理，Java/Gradle 不自动读取 `HTTPS_PROXY`；可在当前构建终端通过 `JAVA_TOOL_OPTIONS` 设置 `-Dhttps.proxyHost=<主机> -Dhttps.proxyPort=<端口> -Dhttp.proxyHost=<主机> -Dhttp.proxyPort=<端口>`。不要把本机代理地址提交到 Gradle 配置，不要关闭 TLS 或下载校验。

Debug APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`，应用 ID 为 `io.github.gsm.personal.debug`；它使用 Android 工具自动管理的调试证书，只用于测试。正式应用 ID 为 `io.github.gsm.personal`，可以和 debug 包并存。应用版本从根 package.json 读取。

## 正式签名

正式构建必须由应用所有者提供长期保管的签名密钥。不会自动生成正式证书，不会回退到 debug 签名，不会在缺少密钥时产出冒充正式版的 APK。

只在当前终端会话设置以下环境变量，再执行 `android-build.ps1 -Variant Release`：

- `GSM_ANDROID_KEYSTORE`：所有者自己的 keystore 绝对路径。
- `GSM_ANDROID_PASSWORD`：keystore 密码。
- `GSM_ANDROID_ALIAS`：私钥 alias。
- `GSM_ANDROID_KEY_PASSWORD`：私钥密码。

不要把凭据写入命令历史、Gradle 文件或仓库，不要把 keystore 放在工程目录；使用本机密码管理器或 CI Secret 注入。丢失正式签名密钥会影响未来原包覆盖升级，必须独立加密备份。Release APK 位于 `android/app/build/outputs/apk/release`。没有签名材料时，脚本和 Gradle 的 release task 都明确失败。

## CI

`.github/workflows/build-android.yml` 在相关 PR 构建 debug APK，也支持手动选择 debug 或 release。固定使用 Ubuntu 24.04、Java 21；Gradle 8.14.3 下载带官方 SHA-256 校验。APK 作为 GitHub Actions artifact 保留 14 天，不上传商店或公开发布。

手动 release 需要仓库 Secrets：`GSM_ANDROID_KEYSTORE_BASE64`、`GSM_ANDROID_PASSWORD`、`GSM_ANDROID_ALIAS`、`GSM_ANDROID_KEY_PASSWORD`。CI 在临时目录按限制权限解码 keystore，构建结束后删除；任一 secret 缺失均失败。PR debug 路径不读取签名 secrets。

## 首次连接家庭后端

按 `docs/home-backend.md` 在 Windows 主机安装常驻 GSM 服务，确认 loopback 健康检查，再显式启用 Tailscale unattended 和 Serve。Android 手机加入同一 tailnet，通过 Serve HTTPS 域名连接服务，并在移动应用连接页填写后端 API_SECRET。不要填写电脑的 localhost，不要使用未加密公网 HTTP，不需要路由器端口转发。

服务凭据、Tailscale 登录和正式 Android 签名必须由实际部署者提供；仓库构建不会替用户创建账号、服务或公网暴露。测试使用用户自有主机和设备。

## 本次验证

- 移动端 Vite production 构建和 Capacitor Android sync 成功。
- 最终 Windows 后端生产目录为 `output/home-backend/release-0.8.4-node22`，固定 Node v22.23.3/x64；官方便携归档 SHA-256 校验、SQLite 原生 ABI 加载和真实生产入口隔离启动/鉴权/关闭冒烟通过。此前 Node 25 构建目录只是中间验证产物。
- 本机 Java 为 21.0.10；最终 Gradle `assembleDebug` 成功，APK 为 `android/app/build/outputs/apk/debug/app-debug.apk`。
- 5,000 个仓库、10,000 条消息的浏览器视口交互检查通过；初始仓库/消息 DOM 分别限制为 40/30 条，离线编辑重载后可上传。
- 未安装 Windows 服务，未更改 Tailscale 配置，未创建正式签名密钥，未发布 APK。

Android APK 安装到真实手机、首次 HTTPS 连接、返回键/键盘/分享、断网重连、后台恢复，以及 Windows 注销/重启后的远程可用性仍需设备验收。网页构建成功不能替代这些测试。

完整实现范围、测试证据、15 项验收状态与已知限制见 [android-home-delivery.md](android-home-delivery.md)。
