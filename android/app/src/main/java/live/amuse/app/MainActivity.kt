package live.amuse.app

import android.app.KeyguardManager
import android.content.ContentValues
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Environment
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
    private var pendingGrant: Pair<Int, String?>? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pausedCookie: String? = null
    private var pickedFiles: Array<Uri>? = null
    private var pickerReturned = false
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // The owner explicitly allows screenshots and screen recordings.
        window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        Log.i("AmuseShell", "Activity created; screenPreview=${BuildConfig.SCREEN_PREVIEW}")
        WebView.setWebContentsDebuggingEnabled(false)
        vault = SessionVault(this)
        pairedVault = PairedSessionVault(this)
        val server = runCatching { ServerAddress.parse(preferences.getString("server", ServerAddress.DEFAULT)!!) }
            .getOrElse { ServerAddress.parse(ServerAddress.DEFAULT) }
        state = state.copy(server = server, deviceSecure = getSystemService(KeyguardManager::class.java).isDeviceSecure,
            useDeviceUnlock = preferences.getBoolean("device_unlock", false), reusableSessionSupported = Build.VERSION.SDK_INT >= 30,
            darkTheme = preferences.getBoolean("dark_theme", false),
            pairedSession = pairedVault.hasSession(server),
            rememberedSession = vault.hasSession(server))
        updateSystemBars()
        // Never load a page with cookies left after an abrupt process exit.
        cookies.removeAllCookies {
            cookies.flush()
            state = state.copy(cookiesReady = true)
            openSavedSessionIfNeeded()
        }
        setContent {
            AmuseTheme(darkTheme = state.darkTheme) {
                AmuseApp(state, createWebView = ::createWebView, releaseWebView = ::releaseWebView,
                    onUnlock = ::authenticate, onServerPin = ::useServerPin,
                    onLock = { if (state.pairedSession) forgetSession() else lockSession() },
                    onSettings = {
                        if (state.pickerSuspended) {
                            lockSession()
                            state = state.copy(notice = "已取消本次文件选择。重新登录后可再次选择。")
                        }
                        state = state.copy(settingsVisible = true)
                    },
                    onCloseSettings = { state = state.copy(settingsVisible = false) },
                    onSaveSettings = ::saveSettings, onForget = ::forgetSession, onRetry = ::retry,
                    onBack = { webView?.let { if (it.canGoBack()) it.goBack() } })
            }
        }
    }

    override fun onResume() {
        super.onResume()
        foreground = true
        val secure = getSystemService(KeyguardManager::class.java).isDeviceSecure
        if (!secure && state.deviceSecure) vault.clear()
        state = state.copy(deviceSecure = secure, rememberedSession = vault.hasSession(state.server),
            pairedSession = pairedVault.hasSession(state.server))
        pendingGrant?.let { grant ->
            pendingGrant = null
            if (grant.first == attempt) finishUnlock(grant.second, grant.first)
        }
        resumePickerWithoutDeviceGate()
        openSavedSessionIfNeeded()
    }

    override fun onPause() {
        if (fileCallback != null && state.unlocked) suspendForPicker()
        else if (!state.pickerSuspended) lockSession(cancelPrompt = false)
        // A native prompt may hand off to the system credential screen. Keep
        // that operation alive, but invalidate an unfinished cookie restoration.
        if (promptCancellation == null) cancelAuthentication()
        foreground = false
        super.onPause()
    }

    override fun onDestroy() {
        cancelAuthentication()
        releaseWebView(webView)
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        super.onDestroy()
    }

    private fun cancelAuthentication() {
        attempt++
        pendingGrant = null
        promptCancellation?.cancel()
        promptCancellation = null
        state = state.copy(authenticating = false)
    }

    private fun authenticate() {
        if (!state.cookiesReady || state.authenticating) return
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
        if (generation != attempt || !foreground) return
        state = state.copy(authenticating = true)
        cookies.removeAllCookies {
            if (generation != attempt || !foreground) return@removeAllCookies
            val ready = {
                if (generation == attempt && foreground) {
                    val resumePicker = state.pickerSuspended && webView != null
                    lastCookie = cookie
                    state = state.copy(unlocked = true, authenticating = false, notice = null,
                        pickerSuspended = false, loading = !resumePicker, progress = if (resumePicker) 100 else 0,
                        connectionError = null, webGeneration = state.webGeneration + if (resumePicker) 0 else 1)
                    if (resumePicker) {
                        webView?.onResume()
                        if (pickerReturned) {
                            fileCallback?.onReceiveValue(pickedFiles)
                            fileCallback = null
                            pickedFiles = null
                            pickerReturned = false
                        }
                        pausedCookie = null
                    }
                    captureJob?.cancel()
                    captureJob = lifecycleScope.launch { while (isActive) { captureSession(); delay(1_200) } }
                }
            }
            if (cookie == null) ready()
            else cookies.setCookie(state.server.home, SessionCookie.restoreHeader(cookie)) { accepted ->
                if (accepted) ready() else state = state.copy(authenticating = false, notice = "无法恢复登录，请使用服务器 PIN。")
            }
        }
    }

    private fun useServerPin() {
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
        if (foreground && state.cookiesReady && !state.useDeviceUnlock && !state.unlocked &&
            !state.pickerSuspended && !state.settingsVisible && !state.authenticating) {
            val cookie = if (state.pairedSession) pairedVault.open(state.server) else null
            if (state.pairedSession && cookie == null) state = state.copy(pairedSession = false,
                notice = "此手机的配对无法恢复，请通过 USB 重新配对。")
            finishUnlock(cookie, attempt)
        }
    }

    private fun resumePickerWithoutDeviceGate() {
        if (foreground && state.pickerSuspended && !state.useDeviceUnlock && !state.authenticating)
            finishUnlock(pausedCookie, attempt)
    }

    private fun captureSession() {
        if (!state.unlocked || !foreground) return
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
        if (view !== webView) return
        view.evaluateJavascript("JSON.stringify({ready:document.readyState,rootChildren:document.getElementById('root')?.childElementCount??-1,login:!!document.querySelector('.unlock-page'),chat:!!document.querySelector('input[placeholder=\"Message\"]'),width:innerWidth,height:innerHeight})") { status ->
            Log.i("AmuseShell", "Page structure ($phase): $status")
        }
    }

    private fun lockSession(cancelPrompt: Boolean = true) {
        captureSession()
        captureJob?.cancel()
        captureJob = null
        if (cancelPrompt) cancelAuthentication()
        state = state.copy(unlocked = false, pickerSuspended = false, loading = false)
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        pickedFiles = null
        pickerReturned = false
        pausedCookie = null
        releaseWebView(webView)
        lastCookie = null
        cookies.removeAllCookies { cookies.flush() }
    }

    private fun suspendForPicker() {
        captureSession()
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
        cookies.removeAllCookies { cookies.flush() }
    }

    private fun forgetSession() {
        lockSession()
        vault.clear()
        pairedVault.clear()
        WebStorage.getInstance().deleteAllData()
        state = state.copy(rememberedSession = false, pairedSession = false, notice = "已清除此手机保存的登录。服务器中的聊天仍在。")
    }

    private fun saveSettings(address: String, deviceUnlock: Boolean) {
        val server = try { ServerAddress.parse(address) } catch (error: IllegalArgumentException) {
            state = state.copy(settingsError = error.message); return
        }
        if (server != state.server || deviceUnlock != state.useDeviceUnlock) forgetSession()
        preferences.edit().putString("server", server.origin).putBoolean("device_unlock", deviceUnlock).apply()
        state = state.copy(server = server, useDeviceUnlock = deviceUnlock, settingsVisible = false, settingsError = null)
    }

    private fun retry() {
        state = state.copy(connectionError = null, loading = true, progress = 0)
        webView?.loadUrl(state.server.home)
    }

    @Suppress("SetJavaScriptEnabled", "DEPRECATION")
    private fun createWebView(): WebView = WebView(this).apply {
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
            userAgentString = "$userAgentString AmuseAndroid/0.1"
        }
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(this, false)
        webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                // Diagnostics identify a failing script without logging page
                // content, entered credentials, messages or session cookies.
                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR)
                    Log.w("AmuseShell", "Web script error at line ${message.lineNumber()}")
                return true
            }
            override fun onProgressChanged(view: WebView, progress: Int) { if (view === webView) state = state.copy(progress = progress) }
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                if (view !== webView || !state.unlocked) return false
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
                if (state.server.contains(request.url.toString())) return false
                if (request.isForMainFrame) openExternal(request.url)
                return true
            }
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                if (view !== webView) return
                Log.i("AmuseShell", "Page started; sameOrigin=${state.server.contains(url)}")
                if (!state.server.contains(url)) { view.stopLoading(); return }
                state = state.copy(loading = true, progress = 0, connectionError = null)
            }
            override fun onPageFinished(view: WebView, url: String) {
                if (view !== webView || !state.server.contains(url)) return
                state = state.copy(loading = false, progress = 100, canGoBack = view.canGoBack())
                Log.i("AmuseShell", "Page finished; progress=${view.progress}; size=${view.width}x${view.height}")
                pageDiagnostics(view, "finished")
                view.postDelayed({ pageDiagnostics(view, "after-2s") }, 2_000)
                view.postDelayed({ pageDiagnostics(view, "after-12s") }, 12_000)
                captureSession()
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) Log.w("AmuseShell", "Page network error; code=${error.errorCode}")
                if (view === webView && request.isForMainFrame) connectionFailed("暂时连不上你的电脑。请确认电脑在线，并且手机已连接 Tailscale。")
            }
            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (BuildConfig.SCREEN_PREVIEW) Log.w("AmuseShell", "HTTP error; status=${response.statusCode}; mainFrame=${request.isForMainFrame}")
                if (response.statusCode == 401 && request.url.path == "/unlock" && state.pairedSession) {
                    pairedVault.clear()
                    state = state.copy(pairedSession = false, notice = "此手机的登录已被电脑撤销，可通过 USB 重新配对。")
                }
                if (view === webView && request.isForMainFrame) connectionFailed("服务器暂时无法打开页面（${response.statusCode}）。稍后重试。")
            }
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                handler.cancel()
                if (view === webView) connectionFailed("无法验证服务器证书。请检查服务地址与手机时间，修复证书后再连接。")
            }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                if (view === webView) { lockSession(); state = state.copy(notice = "页面进程已退出，请重新解锁连接。") }
                return true
            }
        }
        setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            if (!state.server.contains(url)) { openExternal(Uri.parse(url)); return@setDownloadListener }
            download(url, userAgent, contentDisposition, mimeType)
        }
        loadUrl(state.server.home)
    }

    private fun connectionFailed(message: String) { state = state.copy(loading = false, connectionError = message) }

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
        if (uri.scheme != "https" && uri.scheme != "http") return
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)) }
            .onFailure { state = state.copy(notice = "手机上没有可打开此链接的浏览器。") }
    }

    private fun releaseWebView(view: WebView?) {
        if (view == null || view !== webView) return
        Log.i("AmuseShell", "WebView released; unlocked=${state.unlocked}; picker=${state.pickerSuspended}")
        webView = null
        view.stopLoading()
        view.onPause()
        view.clearCache(true)
        view.removeAllViews()
        view.destroy()
    }
}
