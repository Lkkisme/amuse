# 本机运行

## 当前执行后端：Paseo / Codex

`Start-Amuse.ps1` 默认设置 `AMUSE_BACKEND=paseo`。手机和网页继续连接 Amuse 8081；
Amuse 通过已安装的 Paseo 客户端连接现有 6767 daemon，再由其原生 Codex app-server 调用本地 Swift。
连接设置在 `.local/paseo.json`，daemon 的本机认证由 Paseo 自己读取，不发送给网页或手机。
启动 Amuse 前需已有 Paseo 服务；连接失败不会回退到 Pi 或云端模型。

已有 Qwen / Qwen 多 agent 会话会出现在聊天列表，打开时读取原历史；新聊天默认使用现有 `qwen-multi` 配置。
模型、256K、推理力度、原生子代理、Shell、文件编辑、MCP 和执行提示词均由电脑 Paseo 的原配置提供。
新消息加入正在运行的同一会话时先保存在 Amuse 队列，等待其空闲再发送；不默认中断或 steer 原任务。
`paseo-bindings.json` 保存会话映射、待发送消息及旧 Amuse 历史迁移标记；原日志保留。
停止按钮只中断所选会话；删除手机会话入口只移除其 Amuse 镜像，不删除或停止电脑会话。
Paseo 中的其他会话修改会通过订阅／增量历史同步；关闭 Amuse 不会结束由 Paseo 托管的任务。
首次继续旧 Amuse 会话时，将其历史一次性交给新的 Codex 会话，后续直接使用 Codex 原上下文。

Settings 的 Backend 页显示实际后端；Pi 的模型／密钥选择在此模式下隐藏。
原 Amuse V5.2 文件与 Pi 配置保留，Paseo 模式不把旧 Pi 工具协议覆盖到 Codex 配置上。
Codex / Antigravity 订阅 CLI 是否可用，由现有 Qwen 配置和电脑上的官方 CLI 登录决定；Amuse 不复制其凭据。

### 本机 Browser 与同一页面控制

新增 Browser 路径使用本机原生 Edge，按需启动，最多同时打开 2 个浏览器，不需要 Docker。
实时页面经已登录的同源 `/live` 连接传送 JPEG；网页与 Android 壳显示相同的 Canvas 画面。
`/browser-view` 只返回画面类型和尺寸，不向手机提供 CDP 地址或浏览器工具凭据。
Android 客户端继续加载电脑提供的网页 UI，本次网页和后端接线无需重新安装 APK。

新建 Paseo 会话通过聊天专属的 `amuse_browser` MCP 工具访问这个实时页面。
已有 Paseo 会话使用 `D:\LocalAI\Amuse\AMUSE-BROWSER.cmd` 访问相同的 MCP 服务，不热重载旧会话的 MCP，
不重建其模型上下文，也不为添加浏览器工具中断原任务。首次发送新消息时，桥接层提供该聊天的 CLI 使用说明；
原有 Playwright MCP 的独立浏览器不会因此自动变成 Amuse 的实时页面，应使用此处的专属工具或 CLI。

```powershell
& 'D:\LocalAI\Amuse\AMUSE-BROWSER.cmd' --chat '<聊天ID>' list
& 'D:\LocalAI\Amuse\AMUSE-BROWSER.cmd' --chat '<聊天ID>' observe '<浏览器ID>'
& 'D:\LocalAI\Amuse\AMUSE-BROWSER.cmd' --chat '<聊天ID>' act '<浏览器ID>' --json-file 'D:\absolute\step.json'
```

CLI 还支持 `open <URL>`、`screenshot <浏览器ID>` 和 `finish <浏览器ID> <结果>`。
动作文件使用 JSON，例如 `{"kind":"type","text":"中文输入"}`；截图保存在 `.local/browser/observations/`，
命令只输出可供 `view_image` 读取的绝对路径，不把图像 base64 写入终端。
聊天专属凭据保存在 `D:\LocalAI\Amuse\.local\browser-mcp.json`，由服务端初始化，CLI 只读且不自动签发。
此凭据只授权对应聊天的 Browser 工具，不能代替网页登录 Cookie，也不发送给 Android 网页。

用户点击 Take control 后，服务端阻止代理对该浏览器继续输入或结束任务；Hand back 后才恢复代理操作。
手机输入也由服务端检查当前持有人，不能仅靠前端按钮决定权限。代理应等待交还控制，不通过其他工具绕过接管。
2026-10-21 已通过真实本机 Edge 和当前网页的端到端验收：本地 Qwen 调用 7 次 MCP 工具完成中文填写、点击、观察和结果记录；
网页接管后再次中文输入与点击，交还后同一 Codex 会话通过 Shell CLI 读到新内容并保留前轮记忆；手动 New browser 打开 Google 成功。
真实 Edge 自动测试同时验证持有者门禁、截图/实时 JPEG、过期坐标拒绝、跨聊天拒绝以及关闭后的进程回收。
多端观看共用一条浏览器画面流；已验证双端同时观看、关闭一端另一端继续收帧及全部断开后重新连接恢复。
本轮 USB 未连接，Android 真机触摸未重新验收；手机退出并重开 App 加载同一新版网页即可，无需安装新包。

下面有关 Pi 模型、`desktop_tools` 和 V5.2 全局提示词的说明适用于保留的 `AMUSE_BACKEND=pi` 路径。

运行 `Start-Amuse.ps1` 后打开 http://127.0.0.1:8081，首次访问设置自己的四位数字 PIN。
停止使用 `Stop-Amuse.ps1`。不添加开机自启。

模型使用本机已经运行的 Swift/Qwen，API 为 http://127.0.0.1:8080/v1。
本实例不更改 Strata 的模型、256K 上下文、采样或其他代理配置。
模型服务需要单独保持运行；模型繁忙时请求可能排队。

`.local/pi-models.json` 是 Pi 模型服务配置；`.local/data/models.json` 是界面里的模型选择，两者不同。
`AMUSE_PI_MODELS` 把自定义模型配置传给聊天、标题、后台任务、计划任务和可选浏览器代理。
本机凭据、聊天、日志及配置存储在被 Git 忽略的 `.local/`。

Windows 桌面工具通过 `.local/desktop.json` 中显式配置的本机 `windows-mcp` 子进程接入。
`desktop_tools` 列出实际可用的工具及参数，`desktop_call` 调用工具，并保留截图和文本结果。
该连接可以作用于当前 Windows 会话中的应用、文件、鼠标键盘和 PowerShell。
权限取决于运行账户与 Windows 会话；锁屏、UAC 安全桌面和需提升权限的界面不保证可操作。

本实例在 Windows 直接运行；当前原生 Browser 路径不依赖 Docker 浏览器池。
保留的 Pi 路径也可以通过本机桌面工具操作网站；原版 Docker / noVNC 浏览器池仍可另行配置。
Composio 应用连接仍需其自身配置。
桌面工具按调用串行执行；不同聊天仍共享同一桌面，应避免同时给出互相争用鼠标键盘的任务。

实例只监听本机回环地址；停止脚本只结束这个实例及其 MCP 子进程。

## 全局系统提示词

根据用户提供的 V5.2 文本整理的模板为 `prompts/owner-system-v5.2.md`。
实际加载的所有者配置为 `.local/system-prompt.md`，通过 `AMUSE_SYSTEM_PROMPT` 在启动时读取一次，
用于所有聊天、后台任务、计划任务和已配置的浏览器代理。仅用于生成聊天标题的辅助请求保留其标题格式。
启动日志记录加载内容的 SHA256。文件为空或无法读取时启动失败，不会静默忽略。

聊天、网页、工具结果及导入附件不能替换已加载的全局配置，应用没有修改系统提示词的 RPC。
配置文件放在工作区之外并设置只读属性。所有者更新方式：

```powershell
.\Set-AmusePrompt.ps1 -SourceFile 'C:\path\my-system-prompt.md'
.\Stop-Amuse.ps1
.\Start-Amuse.ps1
```

这是应用层配置保护。Windows MCP 的 PowerShell 与用户使用同一个 Windows 账户，
因此同账户程序仍能解除只读属性、改变文件或结束服务；无法声称操作系统级“只有人能改”。
严格隔离需要让代理使用独立的受限账户，并收窄其执行权限，不能同时授予同账户全部系统能力。

原文 Python 总线没有部署，提示词不宣称物理防注入、硬件熔断或占位符自动挂载。
该 Pi 提示词文件本身不自动连接其他 CLI；当前 Paseo 路径使用既有 Qwen 配置中的 CLI 能力，协作、计数与证据要求按实际接入能力执行。

## 手机接入

手机开启同一 Tailscale 网络后，访问 `.local/network.json` 中的 `publicUrl`。
Tailscale Serve 的独立 HTTPS 8443 端口转发至本机 8081；原有 HTTPS 443 的模型服务继续使用原配置。
网页版和本次开发的 Android 客户端连接同一个服务，聊天、文件和任务使用同一份服务器数据。
这是手机发送指令、电脑本地代理执行的链路；电脑、模型服务和 Amuse 需要保持运行。

`network.json` 的公开回调地址在下次正常启动时加载；新增私网转发无需中断正在执行的任务。
只停止手机入口：`tailscale serve --https=8443 off`。该入口使用 Serve，仅面向 tailnet。

## 四位 PIN 与 Android

当前手机已通过 USB 配对，打开 App 自动恢复登录，不输入密码、PIN 或指纹。0.1.2 已验证完整结束进程后仍可自动进入聊天。
0.1.3 起按用户要求允许系统截图、录屏和最近任务预览，取消窗口的 FLAG_SECURE。
配对凭据使用 Android Keystore AES-GCM 加密保存并绑定 HTTPS 服务地址；不保存用户密码。
“清除本机登录”或顶部退出按钮会取消该手机的自动登录；更改服务器密码会撤销其服务器会话。
配对只在用户授权的本机操作中签发会话：`pairDeviceSession` 不存在 HTTP/RPC 入口，修改存储前需确认 Amuse 空闲并停止服务。
Android Receiver 要求发送者具有 `android.permission.DUMP`，通过已授权 ADB 显式发送；该权限也可能由系统或被显式授予权限的应用持有。
配对完成后删除本机临时明文传递文件，仅服务端会话哈希与手机加密副本保留。

原有密码继续有效；本次更新没有替用户更改密码。登录界面可切换到旧密码输入。
登录后在设置的 General → Security 中选择 Change four-digit PIN，验证原密码，输入并确认新 PIN。
更改后其他设备的旧登录会失效；聊天数据保留。PIN 支持点击、键盘和粘贴，第四位输入后自动提交。
服务端继续使用 scrypt 哈希、同源校验和登录限流，PIN 不以明文存储。

安装页为服务地址后的 `/install/index.html`，安装包为 `/downloads/amuse.apk`。
本次 APK 是本机开发并签名的个人版本，不是上游官方发行版。最低 Android 10。
默认服务地址已填写本机 Tailscale HTTPS 8443 地址，也可在客户端“连接与安全”中修改。
默认关闭本机指纹门禁，启动后直接显示服务器 PIN 登录页。首次使用服务器 PIN（或尚未迁移的旧密码）登录。
需要指纹时，可在原生“连接与安全”中主动开启本机安全解锁；Android 11 及以上可使用系统指纹/锁屏验证恢复登录。
对于未配对设备，Android 10 的系统验证仅作为本机门禁，每次打开仍需服务器 PIN；关闭本机解锁或未配置手机安全锁屏时不保存可复用的指纹登录。
USB 配对登录使用独立的加密存储，在 Android 10 及以上均可自动恢复。

客户端用原生壳承载相同的网页 UI，并提供原生锁屏、连接设置、加载、断线、文件选择与下载。
原生界面默认采用与网页相同的浅色、暖米色品牌和蓝色按钮；进入网页后跟随其主题选择。
原生 Browser 画面使用 Canvas JPEG，不加载 noVNC。保留的 RFB 浏览器池仅在打开对应画面时加载 noVNC，
其视频解码能力检测不会阻塞登录和聊天；加载超时可重试。
登录恢复副本经 AES-GCM 加密，其密钥由 Android Keystore 中每次需系统验证的私钥解封；指纹和 PIN 不上传到额外服务。
启用本机安全解锁时，离开应用自动锁定，文件选择器返回后也须验证。配对免密或关闭本机解锁时不弹出额外验证。
服务证书错误不会绕过。
指纹的实际识别由手机系统完成，仍需在用户手机上验收，不以本机编译和单元测试代替真机验证。

## 重新构建 APK

本机工具路径记录在 `.local/android-toolchain.json`，工具安装于 `D:\LocalAI\Android-Toolchain`。
运行 `Build-Android.ps1` 构建 release、对齐、签名并验证，产物为 `artifacts/android/Amuse.apk`，
同时复制到当前 `web/dist/downloads/amuse.apk`。只签已有产物可传 `-SkipBuild`。
重新构建网页会重建 `web/dist`，之后需再次运行 `Build-Android.ps1 -SkipBuild` 恢复 APK 下载文件。
签名密钥及其密码位于 `.local/signing/`，不提交 Git；后续兼容升级应保留同一签名密钥。
USB 视觉联调可用 `Build-Android.ps1 -ScreenPreview`：该版本增加诊断日志，单独保存到 `.local/verification/android-preview/`，
不会复制到网页下载目录。普通版和联调版均允许截图；签名脚本检查预览模式，防止把联调产物当作正常包发布。
