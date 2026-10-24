package live.amuse.app

import android.Manifest
import android.app.KeyguardManager
import android.content.ContentValues
import android.content.ComponentName
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.net.Uri
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.LinkProperties
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Environment
import android.os.SystemClock
import android.provider.MediaStore
import android.view.WindowManager
import android.util.Log
import android.webkit.*
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import kotlinx.coroutines.Job
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import live.amuse.app.ui.AmuseApp
import live.amuse.app.ui.ShellState
import live.amuse.app.ui.theme.AmuseTheme

/** Native, locally locked window onto the same server and UI used by desktop. */
class MainActivity : ComponentActivity() {
    private lateinit var vault: SessionVault
    private lateinit var pairedVault: PairedSessionVault
    private val preferences by lazy { getSharedPreferences("amuse_settings", MODE_PRIVATE) }
    private val cookies by lazy { CookieManager.getInstance() }
    private var state by mutableStateOf(ShellState())
    private var webView: WebView? = null
    private var captureJob: Job? = null
    private var promptCancellation: CancellationSignal? = null
    private var attempt = 0
    private var foreground = false
    private var lastCookie: String? = null
    private var cookieOperation = 0L
    private var pendingGrant: Pair<Int, String?>? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pausedCookie: String? = null
    private var pickedFiles: Array<Uri>? = null
    private var pickerReturned = false
    private var microphoneRequest: PermissionRequest? = null
    private var permissionDialogInFlight = false
    private var microphoneResult: Boolean? = null
    private val recovery = ConnectionRecovery()
    private var recoveryJob: Job? = null
    private var scheduledRetry: ConnectionRecovery.Retry? = null
    private var webEpoch = 0
    private var rebuildingForRetry = false
    private var nextLoadPreservesBackoff = false
    private val networkCallbacks = mutableListOf<ConnectivityManager.NetworkCallback>()
    private val networkChanges = NetworkChangeDebounce()
    private var networkObserverEpoch = 0
    private var networkChangeJob: Job? = null
    private var lastDocumentFailure: ConnectionRecovery.Failure? = null
    private var resumedVisible = false
    private var userPresentRegistered = false
    private val tailscaleRequests = TailscaleRequestGate()
    private val userPresent = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_USER_PRESENT -> resumeForegroundPage()
                Intent.ACTION_SCREEN_OFF -> suspendForSystemLock()
            }
        }
    }
    private val picker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val picked = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        val selection = picked?.filter { it.scheme == "content" }?.toTypedArray()
        if (state.pickerSuspended) {
            pickedFiles = selection
            pickerReturned = true
            resumePickerWithoutDeviceGate()
        } else {
            fileCallback?.onReceiveValue(selection)
            fileCallback = null
        }
    }
    private val recordAudio = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        permissionDialogInFlight = false
        if (foreground) finishMicrophonePermission(granted) else microphoneResult = granted
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // The owner explicitly allows screenshots and screen recordings.
        window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        Log.i("AmuseShell", "Activity created; screenPreview=${BuildConfig.SCREEN_PREVIEW}")
        WebView.setWebContentsDebuggingEnabled(false)
        vault = SessionVault(this)
        pairedVault = PairedSessionVault(this)
        val savedOrigin = preferences.getString("server", null)
        val configured = ServerConfiguration.resolve(savedOrigin, pairedVault.configuredServer(), vault.configuredServer())
        if (savedOrigin == null && configured != null) preferences.edit().putString("server", configured.origin).apply()
        val server = configured ?: ServerAddress.parse(ServerAddress.EXAMPLE)
        state = state.copy(server = server, configured = configured != null, settingsVisible = configured == null,
            deviceSecure = getSystemService(KeyguardManager::class.java).isDeviceSecure,
            useDeviceUnlock = preferences.getBoolean("device_unlock", false), reusableSessionSupported = Build.VERSION.SDK_INT >= 30,
            autoConnectTailscale = preferences.getBoolean("auto_connect_tailscale", true),
            darkTheme = preferences.getBoolean("dark_theme", false),
            pairedSession = pairedVault.hasSession(server),
            rememberedSession = vault.hasSession(server), deviceLocked = !deviceUnlocked())
        ContextCompat.registerReceiver(this, userPresent,
            IntentFilter(Intent.ACTION_USER_PRESENT).apply { addAction(Intent.ACTION_SCREEN_OFF) },
            ContextCompat.RECEIVER_NOT_EXPORTED)
        userPresentRegistered = true
        updateSystemBars()
        // Never load a page with cookies left after an abrupt process exit.
        clearActiveCookies {
            state = state.copy(cookiesReady = true)
            openSavedSessionIfNeeded()
        }
        setContent {
            AmuseTheme(darkTheme = state.darkTheme) {
                AmuseApp(state, createWebView = ::createWebView, releaseWebView = ::releaseWebView,
                    onUnlock = ::authenticate, onServerPin = ::useServerPin,
                    onLock = { if (state.pairedSession) forgetSession() else lockSession() },
                    onSettings = {
                        cancelRecovery()
                        if (state.pickerSuspended) {
                            lockSession()
                            state = state.copy(notice = "已取消本次文件选择。重新登录后可再次选择。")
                        }
                        state = state.copy(settingsVisible = true)
                    },
                    onCloseSettings = {
                        if (!state.configured) return@AmuseApp
                        state = state.copy(settingsVisible = false)
                        if (state.pairedSession && !state.useDeviceUnlock) openSavedSessionIfNeeded()
                    },
                    onSaveSettings = ::saveSettings, onForget = ::forgetSession, onRetry = ::retry,
                    onOpenTailscale = ::openTailscale,
                    onBack = { if (foreground && deviceUnlocked() && !state.pageSuspended)
                        webView?.let { if (it.canGoBack()) it.goBack() } },
                    onMicrophoneAllow = ::requestMicrophonePermission,
                    onMicrophoneDeny = ::denyMicrophonePermission)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        foreground = true
        resumeForegroundPage()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) resumeForegroundPage()
        else if (foreground && !deviceUnlocked()) suspendForSystemLock()
    }

    private fun deviceUnlocked(): Boolean = !getSystemService(KeyguardManager::class.java).isKeyguardLocked

    private fun continuityContext() = PageContinuity.Context(state.pairedSession, state.useDeviceUnlock, state.unlocked,
        webView?.url?.let(state.server::contains) == true, webView != null,
        state.pickerSuspended || fileCallback != null, state.authenticating || pendingGrant != null,
        state.settingsVisible, permissionDialogInFlight)

    private fun resumeForegroundPage() {
        if (!foreground) return
        val deviceReady = deviceUnlocked()
        state = state.copy(deviceLocked = !deviceReady)
        if (!deviceReady) { suspendForSystemLock(); return }
        if (resumedVisible) return
        resumedVisible = true
        refreshTailscaleAvailability()
        requestTailscaleConnection()
        observeNetwork()
        val secure = getSystemService(KeyguardManager::class.java).isDeviceSecure
        if (!secure && state.deviceSecure) vault.clear()
        state = state.copy(deviceSecure = secure, rememberedSession = vault.hasSession(state.server),
            pairedSession = pairedVault.hasSession(state.server))
        if (state.pageSuspended) {
            if (PageContinuity.reveal(continuityContext(), foreground, deviceReady)) {
                state = state.copy(pageSuspended = false)
                webView?.let { view ->
                    view.visibility = android.view.View.VISIBLE
                    view.isEnabled = true
                    view.importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
                    view.onResume()
                }
                startCapturingSession()
                signalPage(PageSignal.RESUME)
                rearmDocumentRecovery()
                Log.i("AmuseShell", "Paired page resumed")
            } else lockSession()
        } else if (!state.pickerSuspended) {
            webView?.onResume()
            signalPage(PageSignal.RESUME)
            rearmDocumentRecovery()
        }
        pendingGrant?.let { grant ->
            pendingGrant = null
            if (grant.first == attempt) finishUnlock(grant.second, grant.first)
        }
        microphoneResult?.let { granted ->
            microphoneResult = null
            finishMicrophonePermission(granted)
        }
        resumePickerWithoutDeviceGate()
        openSavedSessionIfNeeded()
    }

    override fun onPause() {
        stopObservingNetwork()
        cancelRecovery()
        resumedVisible = false
        if (permissionDialogInFlight) {
            // Preserve the requesting renderer only while Android's runtime
            // dialog is open. Recheck foreground, origin and request on return.
            webView?.onPause()
        } else {
            denyMicrophonePermission()
            if (fileCallback != null && state.unlocked) suspendForPicker()
            else if (!state.pickerSuspended) {
                if (PageContinuity.retain(continuityContext())) suspendPairedPage()
                else lockSession(cancelPrompt = false)
            }
            // Keep a system credential operation alive across its own dialog.
            if (promptCancellation == null) cancelAuthentication()
        }
        foreground = false
        super.onPause()
    }

    override fun onStop() {
        // A true background transition must not retain a microphone request.
        // Android's normal permission dialog pauses, rather than stops, us.
        if (microphoneRequest != null || permissionDialogInFlight) {
            denyMicrophonePermission()
            permissionDialogInFlight = false
            if (!state.pickerSuspended) {
                if (PageContinuity.retain(continuityContext())) suspendPairedPage()
                else lockSession(cancelPrompt = false)
            }
        }
        super.onStop()
    }

    override fun onDestroy() {
        stopObservingNetwork()
        cancelRecovery()
        if (userPresentRegistered) { unregisterReceiver(userPresent); userPresentRegistered = false }
        cancelAuthentication()
        denyMicrophonePermission()
        releaseWebView(webView)
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        super.onDestroy()
    }

    private fun suspendForSystemLock() {
        if (!foreground) return
        state = state.copy(deviceLocked = true)
        resumedVisible = false
        stopObservingNetwork()
        cancelRecovery()
        denyMicrophonePermission()
        // Even a system permission/picker flow must not expose an old page behind a locked device.
        signalPage(PageSignal.PAUSE)
        webView?.let { view ->
            view.clearFocus()
            view.visibility = android.view.View.INVISIBLE
            view.isEnabled = false
            view.importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            view.onPause()
        }
        if (state.unlocked && !state.pickerSuspended && !permissionDialogInFlight) {
            if (PageContinuity.retain(continuityContext())) suspendPairedPage()
            else lockSession(cancelPrompt = false)
        }
    }

    private fun suspendPairedPage() {
        captureSession()
        captureJob?.cancel()
        captureJob = null
        cancelRecovery()
        denyMicrophonePermission()
        if (!state.pageSuspended) signalPage(PageSignal.PAUSE)
        webView?.let { view ->
            view.clearFocus()
            view.visibility = android.view.View.INVISIBLE
            view.isEnabled = false
            view.importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            view.onPause()
        }
        state = state.copy(pageSuspended = true)
        Log.i("AmuseShell", "Paired page suspended")
    }

    private fun signalPage(signal: PageSignal) {
        val view = webView ?: return
        if (!state.unlocked || view.url?.let(state.server::contains) != true) return
        if (signal != PageSignal.PAUSE && (!foreground || !deviceUnlocked() || state.pageSuspended ||
                state.pickerSuspended || state.authenticating || state.settingsVisible)) return
        view.evaluateJavascript(signal.script, null)
    }

    private fun startCapturingSession() {
        captureJob?.cancel()
        captureJob = lifecycleScope.launch { while (isActive) { captureSession(); delay(1_200) } }
    }

    private fun rearmDocumentRecovery() {
        scheduleRecovery(recovery.resumeFailure(lastDocumentFailure, currentPage(), canRecover()))
    }

    private fun cancelAuthentication() {
        attempt++
        pendingGrant = null
        promptCancellation?.cancel()
        promptCancellation = null
        state = state.copy(authenticating = false)
    }

    private fun authenticate() {
        if (!state.configured || !foreground || !deviceUnlocked() || !state.cookiesReady || state.authenticating) return
        if ((!state.useDeviceUnlock && !state.pickerSuspended) || !state.deviceSecure) { useServerPin(); return }
        cancelAuthentication()
        val thisAttempt = attempt
        val server = state.server
        val pending = if (canRemember() && vault.hasSession(server)) runCatching { vault.prepare(server) }.getOrElse {
            vault.clear()
            state = state.copy(rememberedSession = false, notice = "本机密钥已变化，请解锁后重新输入服务器 PIN。")
            null
        } else null
        val builder = BiometricPrompt.Builder(this).setTitle("解锁 Amuse")
            .setSubtitle("验证这部手机，继续你的会话").setConfirmationRequired(false)
        if (Build.VERSION.SDK_INT >= 30) {
            val allowed = BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
            if (getSystemService(BiometricManager::class.java).canAuthenticate(allowed) != BiometricManager.BIOMETRIC_SUCCESS) {
                state = state.copy(notice = "系统解锁暂不可用。可重新输入服务器 PIN，或在手机设置中配置锁屏。")
                return
            }
            builder.setAllowedAuthenticators(allowed)
        } else {
            @Suppress("DEPRECATION")
            builder.setDeviceCredentialAllowed(true)
        }
        val cancellation = CancellationSignal()
        promptCancellation = cancellation
        state = state.copy(authenticating = true)
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                if (thisAttempt != attempt) return
                promptCancellation = null
                val cookie = try {
                    if (pending == null) pausedCookie else vault.open(pending,
                        requireNotNull(result.cryptoObject?.cipher) { "认证未解封会话密钥" }, server)
                } catch (_: Exception) {
                    vault.clear()
                    state = state.copy(authenticating = false, rememberedSession = false, notice = "保存的登录无法解锁，请重新输入服务器 PIN。")
                    return
                }
                if (foreground) finishUnlock(cookie, thisAttempt) else pendingGrant = thisAttempt to cookie
            }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                if (thisAttempt != attempt) return
                promptCancellation = null
                state = state.copy(authenticating = false, notice = when (errorCode) {
                    BiometricPrompt.BIOMETRIC_ERROR_CANCELED, BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED -> "已取消解锁。"
                    else -> errString.toString()
                })
            }
            override fun onAuthenticationFailed() {
                if (thisAttempt == attempt) state = state.copy(notice = "未识别，请重试或使用系统锁屏凭据。")
            }
        }
        runCatching {
            val prompt = builder.build()
            if (pending != null) prompt.authenticate(BiometricPrompt.CryptoObject(pending.cipher), cancellation, mainExecutor, callback)
            else prompt.authenticate(cancellation, mainExecutor, callback)
        }.onFailure {
            promptCancellation = null
            state = state.copy(authenticating = false, notice = "系统验证无法启动，可重新输入服务器 PIN。")
        }
    }

    private fun finishUnlock(cookie: String?, generation: Int) {
        val server = state.server
        val visit = UnlockLifecycle.Visit(generation, server.origin)
        fun current() = UnlockLifecycle.current(visit, UnlockLifecycle.Visit(attempt, state.server.origin),
            foreground, deviceUnlocked(), state.configured, state.cookiesReady)
        if (!current()) return
        state = state.copy(authenticating = true)
        clearActiveCookies { clearedOperation ->
            if (!current() || clearedOperation != cookieOperation) return@clearActiveCookies
            val ready = {
                if (current()) {
                    val resumePicker = state.pickerSuspended && webView != null
                    lastCookie = cookie
                    state = state.copy(unlocked = true, authenticating = false, notice = null, pageSuspended = false,
                        pickerSuspended = false, loading = !resumePicker, progress = if (resumePicker) 100 else 0,
                        connectionError = null, webGeneration = state.webGeneration + if (resumePicker) 0 else 1)
                    if (resumePicker) {
                        webView?.visibility = android.view.View.VISIBLE
                        webView?.isEnabled = true
                        webView?.importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
                        webView?.onResume()
                        signalPage(PageSignal.RESUME)
                        if (pickerReturned) {
                            fileCallback?.onReceiveValue(pickedFiles)
                            fileCallback = null
                            pickedFiles = null
                            pickerReturned = false
                        }
                        pausedCookie = null
                    }
                    startCapturingSession()
                }
            }
            if (cookie == null) ready()
            else {
                val restoringOperation = ++cookieOperation
                cookies.setCookie(server.home, SessionCookie.restoreHeader(cookie)) { accepted ->
                    if (!current() || restoringOperation != cookieOperation) {
                        if (UnlockLifecycle.clearStaleCookie(restoringOperation, cookieOperation,
                                state.useDeviceUnlock, state.unlocked)) clearActiveCookies()
                    } else if (accepted) ready()
                    else state = state.copy(authenticating = false, notice = "无法恢复登录，请使用服务器网页登录。")
                }
            }
        }
    }

    private fun useServerPin() {
        if (!state.configured || !foreground || !deviceUnlocked()) return
        if (state.pickerSuspended) lockSession()
        cancelAuthentication()
        vault.clear()
        pairedVault.clear()
        state = state.copy(rememberedSession = false, pairedSession = false)
        finishUnlock(null, attempt)
    }

    private fun canRemember() = state.deviceSecure && state.useDeviceUnlock && state.reusableSessionSupported

    private fun openSavedSessionIfNeeded() {
        // An owner-paired phone restores its encrypted device session. Others
        // go directly to the same server login as the web app.
        // Explicitly locking still leaves the lock page until the next resume.
        if (state.configured && foreground && deviceUnlocked() && state.cookiesReady && !state.useDeviceUnlock && !state.unlocked &&
            !state.pickerSuspended && !state.settingsVisible && !state.authenticating) {
            val cookie = if (state.pairedSession) pairedVault.open(state.server) else null
            if (state.pairedSession && cookie == null) state = state.copy(pairedSession = false,
                notice = "此手机的配对无法恢复，请通过 USB 重新配对。")
            finishUnlock(cookie, attempt)
        }
    }

    private fun resumePickerWithoutDeviceGate() {
        if (foreground && deviceUnlocked() && state.pickerSuspended && !state.useDeviceUnlock && !state.authenticating)
            finishUnlock(pausedCookie, attempt)
    }

    private fun captureSession() {
        if (!state.unlocked || !foreground || !deviceUnlocked() || state.pageSuspended) return
        syncPageAppearance()
        val cookie = SessionCookie.extract(cookies.getCookie(state.server.home))
        if (cookie == lastCookie) return
        if (cookie == null) {
            vault.clear()
            if (state.pairedSession) pairedVault.clear()
            lastCookie = null
            state = state.copy(rememberedSession = false, pairedSession = false)
            return
        }
        // WebView only needs a session cookie; the reusable copy is encrypted.
        cookieOperation++
        cookies.setCookie(state.server.home, SessionCookie.restoreHeader(cookie))
        if (state.pairedSession) runCatching { pairedVault.store(state.server, cookie) }
            .onFailure { state = state.copy(notice = "本次登录可用，但自动登录未能更新。可通过 USB 重新配对。") }
        if (canRemember()) runCatching { vault.store(state.server, cookie) }
            .onSuccess { state = state.copy(rememberedSession = true) }
            .onFailure { state = state.copy(notice = "本次登录可用，但未能安全保存。下次请重新输入服务器 PIN。") }
        lastCookie = cookie
    }

    private fun updateSystemBars() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !state.darkTheme
            isAppearanceLightNavigationBars = !state.darkTheme
        }
    }

    private fun syncPageAppearance() {
        val view = webView ?: return
        view.evaluateJavascript("document.documentElement.classList.contains('dark')") { value ->
            if (view !== webView || !state.unlocked || !foreground) return@evaluateJavascript
            val dark = value == "true"
            if (dark != state.darkTheme) {
                state = state.copy(darkTheme = dark)
                preferences.edit().putBoolean("dark_theme", dark).apply()
                updateSystemBars()
            }
        }
    }

    private fun pageDiagnostics(view: WebView, phase: String) {
        if (view !== webView || !foreground || !deviceUnlocked() || state.pageSuspended) return
        view.evaluateJavascript("JSON.stringify({ready:document.readyState,rootChildren:document.getElementById('root')?.childElementCount??-1,login:!!document.querySelector('.unlock-page'),chat:!!document.querySelector('input[placeholder=\"Message\"]'),width:innerWidth,height:innerHeight})") { status ->
            Log.i("AmuseShell", "Page structure ($phase): $status")
        }
    }

    private fun lockSession(cancelPrompt: Boolean = true) {
        cancelRecovery()
        denyMicrophonePermission()
        captureSession()
        captureJob?.cancel()
        captureJob = null
        if (cancelPrompt) cancelAuthentication()
        state = state.copy(unlocked = false, pickerSuspended = false, pageSuspended = false, loading = false)
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        pickedFiles = null
        pickerReturned = false
        pausedCookie = null
        releaseWebView(webView)
        lastCookie = null
        clearActiveCookies()
    }

    private fun suspendForPicker() {
        captureSession()
        signalPage(PageSignal.PAUSE)
        pausedCookie = SessionCookie.extract(cookies.getCookie(state.server.home))
        captureJob?.cancel()
        captureJob = null
        webView?.onPause()
        webView?.visibility = android.view.View.INVISIBLE
        webView?.isEnabled = false
        webView?.importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        webView?.clearFocus()
        state = state.copy(unlocked = false, pickerSuspended = true, loading = false,
            notice = "文件已由系统选择。返回后请验证本机身份，验证成功才会上传。")
        clearActiveCookies()
    }

    private fun forgetSession() {
        lockSession()
        vault.clear()
        pairedVault.clear()
        WebStorage.getInstance().deleteAllData()
        state = state.copy(rememberedSession = false, pairedSession = false, notice = "已清除此手机保存的登录。服务器中的聊天仍在。")
    }

    private fun saveSettings(address: String, deviceUnlock: Boolean, autoConnectTailscale: Boolean) {
        val server = try { ServerAddress.parse(address) } catch (error: IllegalArgumentException) {
            state = state.copy(settingsError = error.message); return
        }
        if (deviceUnlock && !state.deviceSecure) {
            state = state.copy(settingsError = "请先在 Android 设置中启用安全锁屏，再开启本机解锁。")
            return
        }
        if (server != state.server || deviceUnlock != state.useDeviceUnlock) forgetSession()
        cancelRecovery()
        preferences.edit().putString("server", server.origin).putBoolean("device_unlock", deviceUnlock)
            .putBoolean("auto_connect_tailscale", autoConnectTailscale).apply()
        state = state.copy(server = server, configured = true, useDeviceUnlock = deviceUnlock, autoConnectTailscale = autoConnectTailscale,
            settingsVisible = false, settingsError = null)
        openSavedSessionIfNeeded()
    }

    private fun retry() {
        if (!canRecover()) return
        requestTailscaleConnection()
        restartFailedPage(automatic = false)
    }

    private fun currentPage() = ConnectionRecovery.Page(webEpoch, state.server.origin)
    private fun canRecover() = ConnectionRecovery.Gate(foreground && deviceUnlocked() && !state.pageSuspended, state.unlocked, state.settingsVisible,
        state.pickerSuspended, state.authenticating, webView != null, state.connectionError != null).allowed

    private fun cancelRecovery() {
        recoveryJob?.cancel()
        recoveryJob = null
        scheduledRetry = null
        recovery.cancel()
        rebuildingForRetry = false
        nextLoadPreservesBackoff = false
        state = state.copy(autoRetrySeconds = null, automaticRetryInFlight = false)
    }

    private fun scheduleRecovery(retry: ConnectionRecovery.Retry?) {
        if (retry == null) return
        if (scheduledRetry == retry && recoveryJob?.isActive == true) return
        recoveryJob?.cancel()
        scheduledRetry = retry
        recoveryJob = lifecycleScope.launch {
            for (seconds in retry.delaySeconds downTo 1) {
                if (!canRecover() || currentPage() != retry.page) return@launch
                state = state.copy(autoRetrySeconds = seconds, automaticRetryInFlight = false)
                delay(1_000)
            }
            if (recovery.claim(retry, currentPage(), canRecover())) {
                recoveryJob = null
                scheduledRetry = null
                restartFailedPage(automatic = true)
            }
        }
    }

    private fun restartFailedPage(automatic: Boolean) {
        if (!canRecover()) return
        recoveryJob?.cancel()
        recoveryJob = null
        scheduledRetry = null
        rebuildingForRetry = true
        nextLoadPreservesBackoff = automatic
        // Recreate only a failed document. Old callbacks cannot clear the new page's error or pairing.
        webEpoch++
        releaseWebView(webView)
        state = state.copy(loading = true, progress = 0, autoRetrySeconds = null,
            automaticRetryInFlight = automatic, webGeneration = state.webGeneration + 1)
    }

    private fun observeNetwork() {
        if (networkCallbacks.isNotEmpty() || !foreground || !deviceUnlocked()) return
        val epoch = ++networkObserverEpoch
        networkChanges.begin(epoch)
        fun callback(source: String) = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = update(network, "presence", "available")
            override fun onLost(network: Network) = update(network, "presence", "lost")
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                // Only routing-relevant values: bandwidth/RSSI updates cannot keep defeating backoff.
                val transports = intArrayOf(NetworkCapabilities.TRANSPORT_CELLULAR, NetworkCapabilities.TRANSPORT_WIFI,
                    NetworkCapabilities.TRANSPORT_BLUETOOTH, NetworkCapabilities.TRANSPORT_ETHERNET, NetworkCapabilities.TRANSPORT_VPN)
                val fingerprint = transports.filter(capabilities::hasTransport).joinToString(",") + ":" +
                    capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) + ":" +
                    capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                update(network, "capabilities", fingerprint)
            }
            override fun onLinkPropertiesChanged(network: Network, properties: LinkProperties) {
                // Hashes stay in memory; no addresses, network identifiers or credentials are logged.
                update(network, "links", "${properties.interfaceName}:${properties.linkAddresses.hashCode()}:${properties.routes.hashCode()}:${properties.dnsServers.hashCode()}")
            }
            private fun update(network: Network, kind: String, fingerprint: String) {
                val registered = this
                runOnUiThread {
                    if (registered !in networkCallbacks || epoch != networkObserverEpoch || !foreground || !deviceUnlocked()) return@runOnUiThread
                    val ticket = networkChanges.changed(epoch, "$source:$network:$kind", fingerprint) ?: return@runOnUiThread
                    networkChangeJob?.cancel()
                    networkChangeJob = lifecycleScope.launch {
                        delay(300)
                        if (!networkChanges.claim(ticket, networkObserverEpoch, foreground && deviceUnlocked())) return@launch
                        // A notification is not proof of reachability. Healthy pages recover their channels without reload.
                        requestTailscaleConnection()
                        signalPage(PageSignal.NETWORK_CHANGE)
                        rearmDocumentRecovery()
                        scheduleRecovery(recovery.wake(currentPage(), canRecover()))
                    }
                }
            }
        }
        val connectivity = getSystemService(ConnectivityManager::class.java)
        val default = callback("default")
        runCatching { connectivity.registerDefaultNetworkCallback(default); networkCallbacks.add(default) }
        // A VPN can keep the same Network while its physical Wi-Fi/mobile route changes.
        val physical = callback("physical")
        runCatching {
            connectivity.registerNetworkCallback(NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN).build(), physical)
            networkCallbacks.add(physical)
        }
    }

    private fun stopObservingNetwork() {
        networkObserverEpoch++
        networkChangeJob?.cancel()
        networkChangeJob = null
        networkChanges.cancel()
        val removed = networkCallbacks.toList()
        networkCallbacks.clear()
        for (callback in removed)
            runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(callback) }
    }

    private fun refreshTailscaleAvailability() {
        state = state.copy(tailscaleInstalled = runCatching {
            packageManager.getLaunchIntentForPackage(TailscaleConnection.PACKAGE) != null
        }.getOrDefault(false))
    }

    private fun activeVpn(): Boolean? = runCatching {
        val connectivity = getSystemService(ConnectivityManager::class.java)
        val capabilities = connectivity.allNetworks.map { connectivity.getNetworkCapabilities(it) }
        if (capabilities.any { it == null }) null
        else capabilities.any { it!!.hasTransport(NetworkCapabilities.TRANSPORT_VPN) }
    }.getOrNull()

    private fun requestTailscaleConnection() {
        if (!state.configured || !state.autoConnectTailscale || !foreground || !deviceUnlocked() || state.settingsVisible || !TailscaleConnection.tailnet(state.server)) return
        if (!state.tailscaleInstalled) {
            state = state.copy(tailscaleStatus = "请先安装并登录 Tailscale，再返回 Amuse。")
            return
        }
        val vpn = activeVpn()
        if (vpn != false) {
            state = state.copy(tailscaleStatus = if (vpn == true)
                "手机已有 VPN 连接，Amuse 不会切换。若仍连不上，请打开 Tailscale 检查。"
                else "暂时无法确认 VPN 状态，请打开 Tailscale 检查连接。")
            return
        }
        if (!tailscaleRequests.claim(SystemClock.elapsedRealtime(), TailscaleConnection.allowed(state.server,
                state.autoConnectTailscale, foreground, state.tailscaleInstalled, vpn, deviceUnlocked()))) return
        val receiver = ComponentName(TailscaleConnection.PACKAGE, TailscaleConnection.RECEIVER)
        runCatching {
            val info = packageManager.getReceiverInfo(receiver, 0)
            check(info.exported && info.enabled && info.applicationInfo.enabled)
            sendBroadcast(Intent(TailscaleConnection.CONNECT).setComponent(receiver))
        }.onSuccess {
            // The official receiver owns VPN authorization; sending a request is not a successful connection.
            state = state.copy(tailscaleStatus = "已请求 Tailscale 连接。若首次授权或登录未完成，请打开 Tailscale。")
        }.onFailure {
            state = state.copy(tailscaleStatus = "请打开 Tailscale 完成连接，然后返回 Amuse。")
        }
    }

    private fun openTailscale() {
        if (!foreground || !deviceUnlocked() || !TailscaleConnection.tailnet(state.server)) return
        val intent = packageManager.getLaunchIntentForPackage(TailscaleConnection.PACKAGE)
        if (intent == null) {
            refreshTailscaleAvailability()
            state = state.copy(tailscaleStatus = "手机上未安装可打开的 Tailscale。")
            return
        }
        runCatching { startActivity(intent) }.onFailure {
            state = state.copy(tailscaleStatus = "无法打开 Tailscale，请从手机桌面打开。")
        }
    }

    private fun microphoneAllowed(request: PermissionRequest): Boolean =
        foreground && deviceUnlocked() && !state.pageSuspended && state.unlocked && !state.settingsVisible &&
            webView?.url?.let(state.server::contains) == true &&
            WebPermissionPolicy.microphone(state.server, request.origin.toString(), request.resources.toList())

    private fun offerMicrophone(request: PermissionRequest) {
        if (microphoneRequest != null || !microphoneAllowed(request)) { request.deny(); return }
        microphoneRequest = request
        state = state.copy(microphonePrompt = true)
    }

    private fun requestMicrophonePermission() {
        state = state.copy(microphonePrompt = false)
        val request = microphoneRequest ?: return
        if (!microphoneAllowed(request)) { denyMicrophonePermission(); return }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
            finishMicrophonePermission(true)
        else { permissionDialogInFlight = true; recordAudio.launch(Manifest.permission.RECORD_AUDIO) }
    }

    private fun finishMicrophonePermission(granted: Boolean) {
        val request = microphoneRequest ?: return
        microphoneRequest = null
        state = state.copy(microphonePrompt = false)
        if (granted && microphoneAllowed(request)) request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        else request.deny()
    }

    private fun denyMicrophonePermission() {
        microphoneRequest?.deny()
        microphoneRequest = null
        microphoneResult = null
        state = state.copy(microphonePrompt = false)
    }

    @Suppress("SetJavaScriptEnabled", "DEPRECATION")
    private fun createWebView(): WebView = WebView(this).apply {
        val page = ConnectionRecovery.Page(++webEpoch, state.server.origin)
        val recoveryLoad = rebuildingForRetry
        recovery.beginPage(page, preserveBackoff = nextLoadPreservesBackoff)
        rebuildingForRetry = false
        nextLoadPreservesBackoff = false
        lastDocumentFailure = null
        var navigationFailed = false
        val owner = this
        fun current(view: WebView) = view === webView && page == currentPage()
        webView = this
        Log.i("AmuseShell", "WebView created; unlocked=${state.unlocked}; picker=${state.pickerSuspended}")
        setBackgroundColor(if (state.darkTheme) Color.rgb(24, 24, 25) else Color.rgb(252, 252, 252))
        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            safeBrowsingEnabled = true
            mediaPlaybackRequiresUserGesture = true
            cacheMode = WebSettings.LOAD_NO_CACHE
            userAgentString = "$userAgentString AmuseAndroid/${BuildConfig.VERSION_NAME}"
        }
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(this, false)
        webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) { runOnUiThread {
                if (current(owner)) offerMicrophone(request) else request.deny()
            } }
            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (request === microphoneRequest) {
                    microphoneRequest = null
                    state = state.copy(microphonePrompt = false)
                }
            }
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                // Diagnostics identify a failing script without logging page
                // content, entered credentials, messages or session cookies.
                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR)
                    Log.w("AmuseShell", "Web script error at line ${message.lineNumber()}")
                return true
            }
            override fun onProgressChanged(view: WebView, progress: Int) { if (current(view)) state = state.copy(progress = progress) }
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                if (!current(view) || !this@MainActivity.foreground || !deviceUnlocked() || !state.unlocked ||
                    state.pageSuspended || state.settingsVisible) return false
                if (!state.deviceSecure && state.useDeviceUnlock) {
                    state = state.copy(notice = "请先为手机启用安全锁屏，以便从文件选择器安全返回并上传。")
                    callback.onReceiveValue(null)
                    return true
                }
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val accepted = params.acceptTypes.filter { it.contains('/') }.toTypedArray()
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = if (accepted.size == 1) accepted[0] else "*/*"
                    if (accepted.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, accepted)
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                }
                runCatching { picker.launch(intent) }.onFailure { fileCallback = null; callback.onReceiveValue(null) }
                return true
            }
        }
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (BuildConfig.SCREEN_PREVIEW) {
                    val category = when (request.url.path) {
                        "/" -> "document"
                        "/unlock" -> "connection-check"
                        "/rpc" -> "session-channel"
                        else -> if (request.url.path?.startsWith("/assets/") == true) "asset" else "other"
                    }
                    Log.i("AmuseShell", "Request: $category; sameOrigin=${state.server.contains(request.url.toString())}")
                }
                return null
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!current(view)) return true
                if (state.server.contains(request.url.toString())) return false
                if (request.isForMainFrame && request.hasGesture()) openExternal(request.url)
                return true
            }
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                if (!current(view)) return
                denyMicrophonePermission()
                Log.i("AmuseShell", "Page started; sameOrigin=${state.server.contains(url)}")
                if (!state.server.contains(url)) { view.stopLoading(); return }
                navigationFailed = false
                lastDocumentFailure = null
                recoveryJob?.cancel()
                recoveryJob = null
                scheduledRetry = null
                recovery.beginPage(page, preserveBackoff = true)
                state = state.copy(loading = true, progress = 0,
                    connectionError = if (recoveryLoad) state.connectionError else null)
            }
            override fun onPageFinished(view: WebView, url: String) {
                if (!current(view) || !state.server.contains(url)) return
                state = state.copy(loading = false, progress = 100, canGoBack = view.canGoBack())
                // WebView also finishes its own error document. Only a navigation without an error is success.
                if (recovery.finished(page, navigationFailed)) {
                    lastDocumentFailure = null
                    recoveryJob?.cancel()
                    recoveryJob = null
                    scheduledRetry = null
                    state = state.copy(connectionError = null, autoRetrySeconds = null, automaticRetryInFlight = false)
                }
                Log.i("AmuseShell", "Page finished; progress=${view.progress}; size=${view.width}x${view.height}")
                pageDiagnostics(view, "finished")
                view.postDelayed({ pageDiagnostics(view, "after-2s") }, 2_000)
                view.postDelayed({ pageDiagnostics(view, "after-12s") }, 12_000)
                captureSession()
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) Log.w("AmuseShell", "Page network error; code=${error.errorCode}")
                if (current(view) && request.isForMainFrame && state.server.contains(request.url.toString())) {
                    navigationFailed = true
                    lastDocumentFailure = ConnectionRecovery.Failure(page, error.errorCode)
                    connectionFailed("暂时连不上你的电脑。请确认电脑在线，并检查手机网络。")
                    val retry = recovery.failed(page, error.errorCode, canRecover())
                    if (retry == null) cancelRecovery() else scheduleRecovery(retry)
                }
            }
            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                if (current(view)) state = state.copy(canGoBack = view.canGoBack())
            }
            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (!current(view) || !state.server.contains(request.url.toString())) return
                if (BuildConfig.SCREEN_PREVIEW) Log.w("AmuseShell", "HTTP error; status=${response.statusCode}; mainFrame=${request.isForMainFrame}")
                if (response.statusCode == 401 && request.url.path == "/unlock" && state.pairedSession) {
                    lastDocumentFailure = null
                    cancelRecovery()
                    pairedVault.clear()
                    state = state.copy(pairedSession = false, notice = "此手机的登录已被电脑撤销，可通过 USB 重新配对。")
                }
                if (request.isForMainFrame) {
                    lastDocumentFailure = null
                    navigationFailed = true
                    cancelRecovery()
                    connectionFailed("服务器暂时无法打开页面（${response.statusCode}）。稍后重试。")
                }
            }
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                handler.cancel()
                if (current(view)) {
                    lastDocumentFailure = null
                    navigationFailed = true
                    cancelRecovery()
                    connectionFailed("无法验证服务器证书。请检查服务地址与手机时间，修复证书后再连接。")
                }
            }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                if (current(view)) {
                    lockSession()
                    state = state.copy(notice = "页面进程已退出，正在恢复连接。")
                    openSavedSessionIfNeeded()
                }
                return true
            }
        }
        setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            if (!this@MainActivity.foreground || !deviceUnlocked() || state.pageSuspended) return@setDownloadListener
            if (!state.server.contains(url)) { openExternal(Uri.parse(url)); return@setDownloadListener }
            download(url, userAgent, contentDisposition, mimeType)
        }
        loadUrl(state.server.home)
    }

    private fun connectionFailed(message: String) { state = state.copy(loading = false, connectionError = message) }

    private fun clearActiveCookies(onRemoved: (Long) -> Unit = {}) {
        val operation = ++cookieOperation
        cookies.removeAllCookies { cookies.flush(); onRemoved(operation) }
    }

    private fun download(url: String, userAgent: String, disposition: String?, mime: String?) {
        val server = state.server
        val session = cookies.getCookie(server.home)
        lifecycleScope.launch {
            state = state.copy(notice = "正在保存文件…")
            val result = runCatching { withContext(Dispatchers.IO) {
                var location = URL(url)
                var connection: HttpsURLConnection? = null
                var saved: Uri? = null
                try {
                    for (redirect in 0..5) {
                        check(server.contains(location.toString())) { "下载跳转到了其他服务" }
                        val current = (location.openConnection() as HttpsURLConnection).apply {
                            instanceFollowRedirects = false
                            connectTimeout = 15_000
                            readTimeout = 30_000
                            setRequestProperty("User-Agent", userAgent)
                            session?.let { setRequestProperty("Cookie", it) }
                        }
                        connection = current
                        if (current.responseCode in listOf(301, 302, 303, 307, 308)) {
                            val next = requireNotNull(current.getHeaderField("Location"))
                            location = URL(location, next)
                            current.disconnect()
                            connection = null
                            check(redirect < 5) { "下载跳转过多" }
                            continue
                        }
                        check(current.responseCode in 200..299) { "下载失败（${current.responseCode}）" }
                        val name = URLUtil.guessFileName(location.toString(), current.getHeaderField("Content-Disposition") ?: disposition,
                            current.contentType ?: mime).replace(Regex("[/\\\\]"), "_")
                        val values = ContentValues().apply {
                            put(MediaStore.Downloads.DISPLAY_NAME, name)
                            put(MediaStore.Downloads.MIME_TYPE, current.contentType?.substringBefore(';') ?: mime ?: "application/octet-stream")
                            put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Amuse")
                            put(MediaStore.Downloads.IS_PENDING, 1)
                        }
                        saved = requireNotNull(contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values))
                        requireNotNull(contentResolver.openOutputStream(saved)).use { output -> current.inputStream.use { it.copyTo(output) } }
                        contentResolver.update(saved, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
                        return@withContext name
                    }
                    error("无法打开下载")
                } catch (error: Throwable) {
                    saved?.let { contentResolver.delete(it, null, null) }
                    throw error
                } finally { connection?.disconnect() }
            } }
            state = state.copy(notice = result.fold({ "已保存到 下载/Amuse/$it" }, { "文件未保存，请检查连接后重试。" }))
        }
    }

    private fun openExternal(uri: Uri) {
        if (!foreground || !deviceUnlocked() || state.pageSuspended) return
        if (uri.scheme != "https" && uri.scheme != "http") return
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)) }
            .onFailure { state = state.copy(notice = "手机上没有可打开此链接的浏览器。") }
    }

    private fun releaseWebView(view: WebView?) {
        if (view == null || view !== webView) return
        if (rebuildingForRetry) {
            recoveryJob?.cancel()
            recoveryJob = null
            scheduledRetry = null
        } else cancelRecovery()
        webEpoch++
        lastDocumentFailure = null
        denyMicrophonePermission()
        Log.i("AmuseShell", "WebView released; unlocked=${state.unlocked}; picker=${state.pickerSuspended}")
        webView = null
        view.stopLoading()
        view.onPause()
        view.clearCache(true)
        view.removeAllViews()
        view.destroy()
    }
}
