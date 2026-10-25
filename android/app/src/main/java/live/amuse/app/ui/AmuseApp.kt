package live.amuse.app.ui

import android.view.View
import android.webkit.WebView
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import live.amuse.app.BuildConfig
import live.amuse.app.R
import live.amuse.app.ServerAddress
import live.amuse.app.ui.theme.*

data class ShellState(
    val server: ServerAddress = ServerAddress.parse(ServerAddress.EXAMPLE),
    val configured: Boolean = false,
    val darkTheme: Boolean = false,
    val unlocked: Boolean = false,
    val pickerSuspended: Boolean = false,
    val cookiesReady: Boolean = false,
    val authenticating: Boolean = false,
    val deviceSecure: Boolean = false,
    val useDeviceUnlock: Boolean = false,
    val reusableSessionSupported: Boolean = true,
    val rememberedSession: Boolean = false,
    val settingsVisible: Boolean = false,
    val settingsError: String? = null,
    val notice: String? = null,
    val loading: Boolean = false,
    val progress: Int = 0,
    val connectionError: String? = null,
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
    onServerLogin: () -> Unit,
    onLock: () -> Unit,
    onSettings: () -> Unit,
    onCloseSettings: () -> Unit,
    onSaveSettings: (String, Boolean) -> Unit,
    onForget: () -> Unit,
    onRetry: () -> Unit,
    onBack: () -> Unit,
    onMicrophoneAllow: () -> Unit,
    onMicrophoneDeny: () -> Unit,
) {
    BackHandler(state.settingsVisible && state.configured || state.unlocked && state.canGoBack) {
        if (state.settingsVisible) onCloseSettings() else onBack()
    }
    if (state.microphonePrompt) AlertDialog(onDismissRequest = onMicrophoneDeny,
        icon = { Icon(painterResource(R.drawable.ic_mic), null) }, title = { Text("Use your microphone?") },
        text = { Text("${state.server.host} wants to record audio for voice input. Android may also ask for permission.") },
        confirmButton = { TextButton(onClick = onMicrophoneAllow) { Text("Allow") } },
        dismissButton = { TextButton(onClick = onMicrophoneDeny) { Text("Not now") } })
    Surface(color = MuseSurface, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
            when {
                state.settingsVisible -> SettingsScreen(state, onCloseSettings, onSaveSettings, onForget)
                !state.unlocked && !state.pickerSuspended -> LockScreen(state, onUnlock, onServerLogin, onSettings)
                else -> {
                    Row(Modifier.fillMaxWidth().height(50.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        BrandMark(28)
                        Text("Amuse", fontSize = 17.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 8.dp))
                        Spacer(Modifier.weight(1f))
                        Text(state.server.host, maxLines = 1, overflow = TextOverflow.Ellipsis, color = MuseTextSecondary,
                            fontSize = 11.sp, modifier = Modifier.widthIn(max = 140.dp))
                        if (state.useDeviceUnlock) IconButton(onClick = onLock) { Icon(painterResource(R.drawable.ic_lock), "Lock", Modifier.size(20.dp)) }
                        IconButton(onClick = onSettings) { Icon(painterResource(R.drawable.ic_server), "Server settings", Modifier.size(20.dp)) }
                    }
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                        key(state.webGeneration) {
                            AndroidView(factory = { createWebView() }, modifier = Modifier.fillMaxSize(),
                                onReset = null, onRelease = { releaseWebView(it) }, update = { view ->
                                    // the chat stays in sight behind the picker; it only takes no input until the picker closes
                                    view.visibility = View.VISIBLE
                                    view.isEnabled = !state.pickerSuspended
                                    view.importantForAccessibility = if (state.pickerSuspended)
                                        View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS else View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
                                    if (state.pickerSuspended) view.clearFocus()
                                })
                        }
                        when {
                            state.connectionError != null -> CenteredPanel {
                                Icon(painterResource(R.drawable.ic_wifi_off), null, Modifier.size(42.dp), tint = MuseTextSecondary)
                                Text("Let’s reconnect", fontSize = 25.sp)
                                Text(state.connectionError, color = MuseTextSecondary, textAlign = TextAlign.Center)
                                Button(onClick = onRetry) { Icon(painterResource(R.drawable.ic_refresh_cw), null); Text("Try again") }
                                TextButton(onClick = onSettings) { Text("Connection settings") }
                            }
                            state.loading -> CenteredPanel {
                                BrandMark(72)
                                Text("Connecting to Amuse", fontSize = 22.sp)
                                LinearProgressIndicator(progress = { state.progress / 100f }, modifier = Modifier.width(150.dp), drawStopIndicator = {})
                                Text(state.server.host, color = MuseTextSecondary, fontSize = 12.sp)
                            }
                        }
                    }
                    state.notice?.let { Notice(it) }
                }
            }
        }
    }
}

@Composable
private fun BrandMark(size: Int) {
    Box(Modifier.size(size.dp).background(Brush.linearGradient(listOf(MuseAvatarStart, MuseAvatarEnd)), RoundedCornerShape((size * .28).dp)),
        contentAlignment = Alignment.Center) {
        Icon(painterResource(R.drawable.ic_amuse), null, Modifier.fillMaxSize(.64f), tint = MuseAvatarText)
    }
}

@Composable
private fun CenteredPanel(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().background(MuseSurface).padding(28.dp), verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally, content = content)
}

@Composable
private fun LockScreen(state: ShellState, onUnlock: () -> Unit, onLogin: () -> Unit, onSettings: () -> Unit) {
    CenteredPanel {
        BrandMark(90)
        Text("Amuse", fontSize = 40.sp, fontWeight = FontWeight.Medium)
        Text("Your assistant, wherever you are", color = MuseTextSecondary, textAlign = TextAlign.Center)
        Text(state.server.host, color = MuseTextSecondary, fontSize = 12.sp)
        Button(onClick = onUnlock, enabled = state.cookiesReady && !state.authenticating && state.deviceSecure,
            shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth().height(54.dp)) {
            Icon(painterResource(R.drawable.ic_fingerprint), null); Spacer(Modifier.width(10.dp))
            Text(if (state.authenticating) "Unlocking…" else "Unlock with your device")
        }
        TextButton(onClick = onLogin, enabled = state.cookiesReady && !state.authenticating) { Text("Sign in to server instead") }
        TextButton(onClick = onSettings) { Text("Connection settings") }
        state.notice?.let { Notice(it) }
    }
}

@Composable
private fun SettingsScreen(state: ShellState, onBack: () -> Unit, onSave: (String, Boolean) -> Unit, onForget: () -> Unit) {
    var address by remember(state.server, state.configured) { mutableStateOf(if (state.configured) state.server.origin else "") }
    var unlock by remember(state.useDeviceUnlock) { mutableStateOf(state.useDeviceUnlock) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().height(58.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (state.configured) IconButton(onClick = onBack) { Icon(painterResource(R.drawable.ic_arrow_left), "Back") }
            Text(if (state.configured) "Connection & security" else "Welcome to Amuse", fontSize = 19.sp, modifier = Modifier.padding(start = 12.dp))
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
            BrandMark(70)
            Text("One assistant.\nAll your devices.", fontSize = 30.sp, lineHeight = 36.sp, fontWeight = FontWeight.Medium)
            Text("Connect to your own Amuse server to continue the same chats, files and tasks as the web app.", color = MuseTextSecondary, lineHeight = 22.sp)
            OutlinedTextField(value = address, onValueChange = { address = it }, singleLine = true,
                label = { Text("Server address") }, placeholder = { Text(ServerAddress.EXAMPLE) },
                leadingIcon = { Icon(painterResource(R.drawable.ic_lock_keyhole), null) }, shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth(),
                isError = state.settingsError != null,
                supportingText = { Text(state.settingsError ?: "HTTPS origin only. Keep your network or VPN connected if your server needs it.") })
            Surface(color = MuseSurfaceElevated, shape = RoundedCornerShape(18.dp)) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(painterResource(R.drawable.ic_fingerprint), null, Modifier.size(26.dp))
                        Text("Lock with your device", modifier = Modifier.weight(1f).padding(horizontal = 12.dp))
                        Switch(checked = unlock, onCheckedChange = { unlock = it })
                    }
                    Text(when {
                        !unlock -> "Use the server’s normal sign-in. Its session stays in this app until you sign out or the server revokes it."
                        !state.deviceSecure -> "Set up a fingerprint or secure screen lock in Android settings first."
                        !state.reusableSessionSupported -> "Android 10 can lock the app, but needs server sign-in again after reopening."
                        else -> "After your first server sign-in, Android protects its saved session. Leaving the app locks it."
                    }, color = MuseTextSecondary, fontSize = 12.sp, lineHeight = 19.sp)
                }
            }
            Button(onClick = { onSave(address, unlock) }, modifier = Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(15.dp)) {
                Text(if (state.configured) "Save connection" else "Connect to server")
            }
            if (state.configured) OutlinedButton(onClick = onForget, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                Icon(painterResource(R.drawable.ic_log_out), null); Spacer(Modifier.width(8.dp)); Text("Clear saved sign-in")
            }
            Text("Your server password and fingerprint data are never stored by the native app.\nAmuse for Android · ${BuildConfig.VERSION_NAME}",
                color = MuseTextSecondary, textAlign = TextAlign.Center, fontSize = 11.sp, modifier = Modifier.fillMaxWidth())
            state.notice?.let { Notice(it) }
        }
    }
}

@Composable
private fun Notice(message: String) {
    Surface(color = MuseSurfaceElevated, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().padding(12.dp)) {
        Text(message, color = MuseTextSecondary, fontSize = 12.sp, lineHeight = 18.sp, modifier = Modifier.padding(14.dp))
    }
}
