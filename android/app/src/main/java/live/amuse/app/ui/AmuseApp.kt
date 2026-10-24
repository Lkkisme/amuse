package live.amuse.app.ui

import android.webkit.WebView
import android.view.View
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import live.amuse.app.R
import live.amuse.app.BuildConfig
import live.amuse.app.ServerAddress
import live.amuse.app.ui.theme.*

data class ShellState(
    val server: ServerAddress = ServerAddress.parse(ServerAddress.EXAMPLE),
    val configured: Boolean = false,
    val darkTheme: Boolean = false,
    val unlocked: Boolean = false,
    val pickerSuspended: Boolean = false,
    val pageSuspended: Boolean = false,
    val deviceLocked: Boolean = true,
    val cookiesReady: Boolean = false,
    val authenticating: Boolean = false,
    val deviceSecure: Boolean = false,
    val useDeviceUnlock: Boolean = false,
    val reusableSessionSupported: Boolean = true,
    val rememberedSession: Boolean = false,
    val pairedSession: Boolean = false,
    val settingsVisible: Boolean = false,
    val settingsError: String? = null,
    val notice: String? = null,
    val loading: Boolean = false,
    val progress: Int = 0,
    val connectionError: String? = null,
    val autoRetrySeconds: Int? = null,
    val automaticRetryInFlight: Boolean = false,
    val autoConnectTailscale: Boolean = true,
    val tailscaleInstalled: Boolean = false,
    val tailscaleStatus: String? = null,
    val canGoBack: Boolean = false,
    val webGeneration: Int = 0,
    val microphonePrompt: Boolean = false,
)

@Composable
fun AmuseApp(
    state: ShellState,
    createWebView: () -> WebView,
    releaseWebView: (WebView?) -> Unit,
    onUnlock: () -> Unit,
    onServerPin: () -> Unit,
    onLock: () -> Unit,
    onSettings: () -> Unit,
    onCloseSettings: () -> Unit,
    onSaveSettings: (String, Boolean, Boolean) -> Unit,
    onForget: () -> Unit,
    onRetry: () -> Unit,
    onOpenTailscale: () -> Unit,
    onBack: () -> Unit,
    onMicrophoneAllow: () -> Unit,
    onMicrophoneDeny: () -> Unit,
) {
    BackHandler((state.settingsVisible && state.configured) || (state.unlocked && state.canGoBack && !state.pageSuspended && !state.deviceLocked)) {
        if (state.settingsVisible) onCloseSettings() else onBack()
    }
    if (state.microphonePrompt) AlertDialog(onDismissRequest = onMicrophoneDeny,
        icon = { Icon(Icons.Outlined.Mic, null) }, title = { Text("允许使用麦克风？") },
        text = { Text("${state.server.host} 希望录制语音输入。首次使用还需要允许 Android 的麦克风权限。") },
        confirmButton = { TextButton(onClick = onMicrophoneAllow) { Text("允许") } },
        dismissButton = { TextButton(onClick = onMicrophoneDeny) { Text("暂不允许") } })
    Surface(color = MuseSurface, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
            if (state.settingsVisible) {
                SettingsScreen(state, onCloseSettings, onSaveSettings, onForget, onOpenTailscale)
            } else if (!state.unlocked && !state.pickerSuspended) {
                LockScreen(state, onUnlock, onServerPin, onSettings)
            } else {
                if (!state.pickerSuspended) Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    BrandMark(30.dp, 10.dp)
                    Text("Amuse", fontSize = 17.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 8.dp))
                    Spacer(Modifier.weight(1f))
                    val connected = !state.loading && state.connectionError == null
                    Box(Modifier.size(5.dp).background(if (connected) MuseGreen else MuseTextTertiary, CircleShape))
                    Text(if (state.connectionError != null) "连接中断" else if (state.loading) "连接中" else "你的电脑",
                        color = MuseTextSecondary, fontSize = 11.sp, modifier = Modifier.padding(start = 6.dp, end = 4.dp))
                    IconButton(onClick = onLock, enabled = !state.pageSuspended) { Icon(if (state.pairedSession) Icons.Outlined.Logout else Icons.Outlined.Lock,
                        if (state.pairedSession) "退出本机登录" else "锁定", Modifier.size(20.dp)) }
                    IconButton(onClick = onSettings, enabled = !state.pageSuspended) { Icon(Icons.Outlined.Settings, "连接设置", Modifier.size(20.dp)) }
                }
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    key(state.webGeneration) {
                        AndroidView(factory = { createWebView() }, modifier = Modifier.fillMaxSize(),
                            onReset = null, onRelease = { releaseWebView(it) },
                            update = { view ->
                                // The picker keeps its renderer only to retain the
                                // pending upload callback. A visual cover alone
                                // would still expose touches and accessibility.
                                val hidden = state.pickerSuspended || state.pageSuspended || state.deviceLocked
                                view.visibility = if (hidden) View.INVISIBLE else View.VISIBLE
                                view.isEnabled = !hidden
                                view.importantForAccessibility = if (hidden)
                                    View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS else View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
                                if (hidden) view.clearFocus()
                            })
                    }
                    if (state.pageSuspended || state.deviceLocked) {
                        Box(Modifier.fillMaxSize().background(MuseSurface), contentAlignment = Alignment.Center) {
                            Text(if (state.deviceLocked) "解锁手机后继续" else "返回 Amuse 后继续", color = MuseTextSecondary)
                        }
                    } else if (state.pickerSuspended) LockScreen(state, onUnlock, onServerPin, onSettings)
                    else {
                        if (state.loading && state.connectionError == null) LoadingScreen(state)
                        state.connectionError?.let { DisconnectedScreen(it, state, onRetry, onSettings, onOpenTailscale) }
                    }
                }
                state.notice?.let { Notice(it) }
            }
        }
    }
}

@Composable
private fun BrandMark(size: Dp, radius: Dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).background(Brush.linearGradient(listOf(MuseAvatarStart, MuseAvatarEnd)), RoundedCornerShape(radius)),
        contentAlignment = Alignment.Center) {
        Icon(painterResource(R.drawable.ic_amuse), null, Modifier.fillMaxSize(0.64f), tint = MuseAvatarText)
    }
}

@Composable
private fun LockScreen(state: ShellState, onUnlock: () -> Unit, onPin: () -> Unit, onSettings: () -> Unit) {
    val glow = MuseAvatarStart.copy(alpha = 0.28f).compositeOver(MuseSurface)
    Column(Modifier.fillMaxSize().background(Brush.radialGradient(listOf(glow, MuseSurface), radius = 950f))) {
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.End) {
            IconButton(onClick = onSettings) { Icon(Icons.Outlined.Settings, "连接设置", tint = MuseTextSecondary) }
        }
        Column(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 28.dp), horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center) {
            BrandMark(104.dp, 30.dp)
            Spacer(Modifier.height(26.dp))
            Text("Amuse", fontSize = 40.sp, fontWeight = FontWeight.Medium, letterSpacing = (-1).sp)
            Text("你的助理，随身相伴", color = MuseTextSecondary, fontSize = 15.sp, modifier = Modifier.padding(top = 10.dp))
            Spacer(Modifier.height(36.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Shield, null, tint = MuseGreen, modifier = Modifier.size(16.dp))
                Text(" 私人连接 · 与电脑同步", color = MuseTextSecondary, fontSize = 12.sp)
            }
        }
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Surface(shape = RoundedCornerShape(16.dp), color = MuseSurfaceElevated, contentColor = MuseTextPrimary, modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Computer, null, tint = MuseTextSecondary, modifier = Modifier.size(22.dp))
                    Column(Modifier.padding(start = 12.dp).weight(1f)) {
                        Text("连接到你的电脑", fontSize = 13.sp)
                        Text(state.server.host, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            color = MuseTextSecondary, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
                    }
                    Icon(Icons.Outlined.Https, null, tint = MuseGreen, modifier = Modifier.size(18.dp))
                }
            }
            Spacer(Modifier.height(18.dp))
            val nativeUnlock = state.deviceSecure && state.useDeviceUnlock
            Button(onClick = if (nativeUnlock) onUnlock else onPin, enabled = state.cookiesReady && !state.authenticating,
                shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth().height(56.dp)) {
                Icon(if (nativeUnlock) Icons.Outlined.Fingerprint else Icons.Outlined.Dialpad, null, modifier = Modifier.size(23.dp))
                Spacer(Modifier.width(10.dp))
                Text(if (state.authenticating) "正在验证…" else if (nativeUnlock) "指纹或设备解锁" else "登录服务器", fontSize = 15.sp)
            }
            if (nativeUnlock) TextButton(onClick = onPin, enabled = state.cookiesReady && !state.authenticating) { Text("改用服务器登录", color = MuseTextSecondary, fontSize = 12.sp) }
            Text(if (state.rememberedSession) "本机验证后，安全恢复已保存的登录。" else "首次连接请使用服务器网页登录。",
                color = MuseTextTertiary, fontSize = 11.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 10.dp))
            state.notice?.let { Notice(it) }
        }
    }
}

@Composable
private fun LoadingScreen(state: ShellState) {
    val animation = rememberInfiniteTransition(label = "connection")
    val opacity by animation.animateFloat(0.35f, 1f, infiniteRepeatable(tween(1_100), RepeatMode.Reverse), label = "glow")
    Column(Modifier.fillMaxSize().background(MuseSurface).padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center) {
        BrandMark(90.dp, 26.dp, Modifier.alpha(opacity))
        Spacer(Modifier.height(24.dp))
        Text("正在连接你的电脑", fontSize = 19.sp, fontWeight = FontWeight.Medium)
        Text("会话与电脑上的 Amuse 保持同步", color = MuseTextSecondary, fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp))
        LinearProgressIndicator(progress = { (state.progress / 100f).coerceIn(0f, 1f) },
            modifier = Modifier.padding(top = 30.dp).width(140.dp).height(2.dp), color = MuseAccent, trackColor = MuseCard,
            drawStopIndicator = {})
        Text(state.server.host, color = MuseTextSecondary, fontSize = 11.sp, modifier = Modifier.padding(top = 18.dp))
    }
}

@Composable
private fun DisconnectedScreen(message: String, state: ShellState, onRetry: () -> Unit, onSettings: () -> Unit, onOpenTailscale: () -> Unit) {
    Column(Modifier.fillMaxSize().background(MuseSurface).verticalScroll(rememberScrollState()).padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center) {
        Surface(shape = CircleShape, color = MuseSurfaceElevated) {
            Icon(Icons.Outlined.WifiOff, null, Modifier.padding(22.dp).size(32.dp), tint = MuseTextSecondary)
        }
        Text("等你的电脑回来", fontSize = 24.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 24.dp))
        Text(message, color = MuseTextSecondary, fontSize = 14.sp, lineHeight = 22.sp,
            textAlign = TextAlign.Center, modifier = Modifier.padding(top = 14.dp))
        Text(state.server.host, color = MuseTextSecondary, fontSize = 11.sp, modifier = Modifier.padding(top = 14.dp))
        val retryStatus = if (state.loading) "正在重新连接…" else state.autoRetrySeconds?.let { "将在 $it 秒后自动重试" }
        retryStatus?.let { Text(it, color = MuseTextSecondary, fontSize = 12.sp, modifier = Modifier.padding(top = 12.dp)) }
        if (state.tailscaleInstalled && live.amuse.app.TailscaleConnection.tailnet(state.server)) {
            state.tailscaleStatus?.let { Text(it, color = MuseTextSecondary, fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 12.dp)) }
            TextButton(onClick = onOpenTailscale) { Text("打开 Tailscale") }
        }
        Button(onClick = onRetry, enabled = !state.loading, shape = RoundedCornerShape(14.dp), modifier = Modifier.padding(top = 18.dp).height(48.dp)) {
            Icon(Icons.Outlined.Refresh, null, Modifier.size(20.dp)); Spacer(Modifier.width(8.dp)); Text("重新连接")
        }
        TextButton(onClick = onSettings) { Text("检查连接设置", color = MuseTextSecondary) }
    }
}

@Composable
private fun SettingsScreen(state: ShellState, onBack: () -> Unit, onSave: (String, Boolean, Boolean) -> Unit, onForget: () -> Unit, onOpenTailscale: () -> Unit) {
    var server by remember(state.server, state.configured) { mutableStateOf(if (state.configured) state.server.origin else "") }
    var unlock by remember(state.useDeviceUnlock) { mutableStateOf(state.useDeviceUnlock) }
    var autoConnect by remember(state.autoConnectTailscale) { mutableStateOf(state.autoConnectTailscale) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().height(60.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (state.configured) IconButton(onClick = onBack) { Icon(Icons.Outlined.ArrowBack, "返回") }
            Text(if (state.configured) "连接与安全" else "欢迎使用 Amuse", fontSize = 19.sp, fontWeight = FontWeight.Medium)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(24.dp)) {
            Text("你的电脑，始终是同一处", fontSize = 26.sp, lineHeight = 34.sp, fontWeight = FontWeight.Medium)
            Text("使用同一个 Amuse 服务，继续电脑上的聊天、文件和任务。", color = MuseTextSecondary,
                fontSize = 14.sp, lineHeight = 22.sp, modifier = Modifier.padding(top = 12.dp, bottom = 30.dp))
            Text("服务地址", fontSize = 13.sp, color = MuseTextSecondary)
            OutlinedTextField(value = server, onValueChange = { server = it }, singleLine = true,
                placeholder = { Text(ServerAddress.EXAMPLE) },
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp), shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                leadingIcon = { Icon(Icons.Outlined.Https, null) }, isError = state.settingsError != null,
                supportingText = { Text(state.settingsError ?: "填写你的 HTTPS 服务地址；若通过私人网络访问，请保持相应 VPN 连接。") })
            Spacer(Modifier.height(26.dp))
            Surface(shape = RoundedCornerShape(18.dp), color = MuseSurfaceElevated, contentColor = MuseTextPrimary) {
                Column(Modifier.padding(18.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Fingerprint, null, Modifier.size(26.dp), tint = MuseTextSecondary)
                        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                            Text("本机安全解锁", fontSize = 15.sp)
                            Text("使用指纹或系统锁屏凭据", color = MuseTextSecondary, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
                        }
                        Switch(checked = unlock, onCheckedChange = { unlock = it })
                    }
                    HorizontalDivider(Modifier.padding(vertical = 18.dp), color = MaterialTheme.colorScheme.outlineVariant)
                    Text(when {
                        state.pairedSession -> "此手机已与电脑配对，打开即可继续，无需密码或指纹。清除本机登录可取消自动登录。"
                        !state.deviceSecure -> "请先在手机设置中启用安全锁屏。服务器登录由网页处理。"
                        !unlock -> "关闭后使用服务器登录；已配对的手机可安全恢复免密会话。"
                        !state.reusableSessionSupported -> "Android 10 支持系统门禁；重开后需服务器登录。Android 11 及以上可安全恢复登录。"
                        else -> "首次通过服务器网页登录；以后通过系统验证恢复登录。离开应用自动锁定。"
                    }, color = MuseTextSecondary, fontSize = 12.sp, lineHeight = 20.sp)
                }
            }
            Spacer(Modifier.height(20.dp))
            Surface(shape = RoundedCornerShape(18.dp), color = MuseSurfaceElevated, contentColor = MuseTextPrimary) {
                Column(Modifier.padding(18.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.VpnKey, null, Modifier.size(26.dp), tint = MuseTextSecondary)
                        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                            Text("Tailscale 自动连接", fontSize = 15.sp)
                            Text("打开 Amuse 时连接你的私人网络", color = MuseTextSecondary, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
                        }
                        Switch(checked = autoConnect, onCheckedChange = { autoConnect = it })
                    }
                    Text("仅用于 Tailscale 地址；沿用 Tailscale 已有登录和系统授权。手机已有 VPN 时不会切换，请打开 Tailscale 检查。",
                        color = MuseTextSecondary, fontSize = 12.sp, lineHeight = 20.sp, modifier = Modifier.padding(top = 14.dp))
                    if (state.tailscaleInstalled && live.amuse.app.TailscaleConnection.tailnet(state.server))
                        TextButton(onClick = onOpenTailscale) { Text("打开 Tailscale") }
                }
            }
            Spacer(Modifier.height(24.dp))
            Button(onClick = { onSave(server, unlock, autoConnect) }, modifier = Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(15.dp)) {
                Text(if (state.configured) "保存设置" else "连接服务器", fontSize = 15.sp)
            }
            if (state.configured) OutlinedButton(onClick = onForget, modifier = Modifier.fillMaxWidth().padding(top = 12.dp).height(50.dp), shape = RoundedCornerShape(15.dp)) {
                Icon(Icons.Outlined.Logout, null, Modifier.size(19.dp)); Spacer(Modifier.width(8.dp)); Text("清除本机登录")
            }
            Text("服务器密码由网页处理；指纹验证只在这部手机上完成。", color = MuseTextSecondary, fontSize = 11.sp,
                textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 24.dp))
            Text("Amuse for Android · ${BuildConfig.VERSION_NAME}", color = MuseTextSecondary, fontSize = 11.sp,
                textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
            state.notice?.let { Notice(it) }
        }
    }
}

@Composable
private fun Notice(text: String) {
    Surface(color = MuseSurfaceElevated, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().padding(12.dp)) {
        Text(text, fontSize = 12.sp, lineHeight = 18.sp, color = MuseTextSecondary, modifier = Modifier.padding(14.dp))
    }
}
