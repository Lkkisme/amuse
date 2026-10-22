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
    val server: ServerAddress = ServerAddress.parse(ServerAddress.DEFAULT),
    val darkTheme: Boolean = false,
    val unlocked: Boolean = false,
    val pickerSuspended: Boolean = false,
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
    val canGoBack: Boolean = false,
    val webGeneration: Int = 0,
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
    onSaveSettings: (String, Boolean) -> Unit,
    onForget: () -> Unit,
    onRetry: () -> Unit,
    onBack: () -> Unit,
) {
    BackHandler(state.settingsVisible || (state.unlocked && state.canGoBack)) {
        if (state.settingsVisible) onCloseSettings() else onBack()
    }
    Surface(color = MuseSurface, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
            if (state.settingsVisible) {
                SettingsScreen(state, onCloseSettings, onSaveSettings, onForget)
            } else if (!state.unlocked && !state.pickerSuspended) {
                LockScreen(state, onUnlock, onServerPin, onSettings)
            } else {
                if (!state.pickerSuspended) Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    BrandMark(30.dp, 10.dp)
                    Text("Amuse", fontSize = 17.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 8.dp))
                    Spacer(Modifier.weight(1f))
                    Box(Modifier.size(5.dp).background(MuseGreen, CircleShape))
                    Text("你的电脑", color = MuseTextSecondary, fontSize = 11.sp, modifier = Modifier.padding(start = 6.dp, end = 4.dp))
                    IconButton(onClick = onLock) { Icon(if (state.pairedSession) Icons.Outlined.Logout else Icons.Outlined.Lock,
                        if (state.pairedSession) "退出本机登录" else "锁定", Modifier.size(20.dp)) }
                    IconButton(onClick = onSettings) { Icon(Icons.Outlined.Settings, "连接设置", Modifier.size(20.dp)) }
                }
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    key(state.webGeneration) {
                        AndroidView(factory = { createWebView() }, modifier = Modifier.fillMaxSize(),
                            onReset = null, onRelease = { releaseWebView(it) },
                            update = { view ->
                                // The picker keeps its renderer only to retain the
                                // pending upload callback. A visual cover alone
                                // would still expose touches and accessibility.
                                view.visibility = if (state.pickerSuspended) View.INVISIBLE else View.VISIBLE
                                view.isEnabled = !state.pickerSuspended
                                view.importantForAccessibility = if (state.pickerSuspended)
                                    View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS else View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
                                if (state.pickerSuspended) view.clearFocus()
                            })
                    }
                    if (state.pickerSuspended) LockScreen(state, onUnlock, onServerPin, onSettings)
                    else {
                        if (state.loading && state.connectionError == null) LoadingScreen(state)
                        state.connectionError?.let { DisconnectedScreen(it, state.server.host, onRetry, onSettings) }
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
                Text(if (state.authenticating) "正在验证…" else if (nativeUnlock) "指纹或设备解锁" else "输入服务器 PIN", fontSize = 15.sp)
            }
            if (nativeUnlock) TextButton(onClick = onPin, enabled = state.cookiesReady && !state.authenticating) { Text("重新输入服务器 PIN", color = MuseTextSecondary, fontSize = 12.sp) }
            Text(if (state.rememberedSession) "本机验证后，安全恢复已保存的登录。" else "首次连接需输入服务器的四位 PIN。",
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
private fun DisconnectedScreen(message: String, host: String, onRetry: () -> Unit, onSettings: () -> Unit) {
    Column(Modifier.fillMaxSize().background(MuseSurface).padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center) {
        Surface(shape = CircleShape, color = MuseSurfaceElevated) {
            Icon(Icons.Outlined.WifiOff, null, Modifier.padding(22.dp).size(32.dp), tint = MuseTextSecondary)
        }
        Text("等你的电脑回来", fontSize = 24.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 24.dp))
        Text(message, color = MuseTextSecondary, fontSize = 14.sp, lineHeight = 22.sp,
            textAlign = TextAlign.Center, modifier = Modifier.padding(top = 14.dp))
        Text(host, color = MuseTextSecondary, fontSize = 11.sp, modifier = Modifier.padding(top = 14.dp))
        Button(onClick = onRetry, shape = RoundedCornerShape(14.dp), modifier = Modifier.padding(top = 28.dp).height(48.dp)) {
            Icon(Icons.Outlined.Refresh, null, Modifier.size(20.dp)); Spacer(Modifier.width(8.dp)); Text("重新连接")
        }
        TextButton(onClick = onSettings) { Text("检查连接设置", color = MuseTextSecondary) }
    }
}

@Composable
private fun SettingsScreen(state: ShellState, onBack: () -> Unit, onSave: (String, Boolean) -> Unit, onForget: () -> Unit) {
    var server by remember(state.server) { mutableStateOf(state.server.origin) }
    var unlock by remember(state.useDeviceUnlock) { mutableStateOf(state.useDeviceUnlock) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().height(60.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.Outlined.ArrowBack, "返回") }
            Text("连接与安全", fontSize = 19.sp, fontWeight = FontWeight.Medium)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(24.dp)) {
            Text("你的电脑，始终是同一处", fontSize = 26.sp, lineHeight = 34.sp, fontWeight = FontWeight.Medium)
            Text("使用同一个 Amuse 服务，继续电脑上的聊天、文件和任务。", color = MuseTextSecondary,
                fontSize = 14.sp, lineHeight = 22.sp, modifier = Modifier.padding(top = 12.dp, bottom = 30.dp))
            Text("服务地址", fontSize = 13.sp, color = MuseTextSecondary)
            OutlinedTextField(value = server, onValueChange = { server = it }, singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp), shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                leadingIcon = { Icon(Icons.Outlined.Https, null) }, isError = state.settingsError != null,
                supportingText = { Text(state.settingsError ?: "填写 HTTPS 地址；手机和电脑需在同一 Tailscale 网络。") })
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
                        !state.deviceSecure -> "请先在手机设置中启用安全锁屏。当前每次打开都需要服务器 PIN。"
                        !unlock -> "关闭后不保留可复用登录，每次打开需输入服务器 PIN。"
                        !state.reusableSessionSupported -> "Android 10 支持系统门禁；每次打开仍需服务器 PIN。Android 11 及以上可安全恢复登录。"
                        else -> "首次使用服务器 PIN 登录；以后通过系统验证恢复登录。离开应用自动锁定。"
                    }, color = MuseTextSecondary, fontSize = 12.sp, lineHeight = 20.sp)
                }
            }
            Spacer(Modifier.height(24.dp))
            Button(onClick = { onSave(server, unlock) }, modifier = Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(15.dp)) {
                Text("保存设置", fontSize = 15.sp)
            }
            OutlinedButton(onClick = onForget, modifier = Modifier.fillMaxWidth().padding(top = 12.dp).height(50.dp), shape = RoundedCornerShape(15.dp)) {
                Icon(Icons.Outlined.Logout, null, Modifier.size(19.dp)); Spacer(Modifier.width(8.dp)); Text("清除本机登录")
            }
            Text("四位 PIN 用于服务器登录；指纹验证只在这部手机上完成。", color = MuseTextSecondary, fontSize = 11.sp,
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
