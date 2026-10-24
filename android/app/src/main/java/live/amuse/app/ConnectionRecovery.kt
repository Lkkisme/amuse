package live.amuse.app

/** Pure scheduling state. Android owns the timer and rechecks foreground/view identity before claiming it. */
class ConnectionRecovery {
    data class Page(val generation: Int, val origin: String)
    data class Retry(val page: Page, val serial: Long, val delaySeconds: Int)
    data class Gate(val foreground: Boolean, val unlocked: Boolean, val settings: Boolean,
        val picker: Boolean, val authenticating: Boolean, val renderer: Boolean, val error: Boolean) {
        val allowed: Boolean get() = foreground && unlocked && !settings && !picker && !authenticating && renderer && error
    }

    private var page: Page? = null
    private var failures = 0
    private var serial = 0L
    private var pending: Retry? = null

    fun beginPage(page: Page, preserveBackoff: Boolean = false) {
        invalidate()
        this.page = page
        if (!preserveBackoff) failures = 0
    }

    fun failed(page: Page, errorCode: Int?, eligible: Boolean): Retry? {
        if (this.page != page) return null
        if (!eligible || !retryable(errorCode)) {
            cancel()
            return null
        }
        // A WebView may report the same failed main document more than once.
        pending?.let { return it }
        val seconds = intArrayOf(2, 4, 8, 15, 30)[failures.coerceAtMost(4)]
        failures = (failures + 1).coerceAtMost(5)
        return Retry(page, ++serial, seconds).also { pending = it }
    }

    /** Connectivity is only a reason to try sooner, never evidence that the server is reachable. */
    fun wake(page: Page, eligible: Boolean): Retry? {
        val old = pending ?: return null
        if (this.page != page || old.page != page || !eligible) return null
        return old.copy(serial = ++serial, delaySeconds = 0).also { pending = it }
    }

    fun claim(retry: Retry, page: Page, eligible: Boolean): Boolean {
        if (!eligible || this.page != page || pending != retry) return false
        pending = null
        return true
    }

    fun finished(page: Page, failed: Boolean): Boolean {
        if (failed || this.page != page) return false
        cancel()
        return true
    }

    fun cancel() {
        invalidate()
        page = null
        failures = 0
    }

    private fun invalidate() { pending = null; serial++ }

    companion object {
        // WebViewClient: HOST_LOOKUP, CONNECT, IO, TIMEOUT. HTTP, TLS and authentication are excluded.
        fun retryable(errorCode: Int?): Boolean = errorCode in listOf(-2, -6, -7, -8)
    }
}

object TailscaleConnection {
    const val PACKAGE = "com.tailscale.ipn"
    const val RECEIVER = "com.tailscale.ipn.IPNReceiver"
    const val CONNECT = "com.tailscale.ipn.CONNECT_VPN"

    fun tailnet(server: ServerAddress): Boolean {
        if (server.host.endsWith(".ts.net")) return true
        val parts = server.host.split('.')
        if (parts.size != 4) return false
        val octets = parts.map { part -> part.toIntOrNull()?.takeIf { it in 0..255 && it.toString() == part } ?: return false }
        return octets[0] == 100 && octets[1] in 64..127
    }

    /** Unknown VPN state fails closed; a request never replaces any existing VPN. */
    fun allowed(server: ServerAddress, enabled: Boolean, foreground: Boolean, installed: Boolean, activeVpn: Boolean?): Boolean =
        enabled && foreground && installed && tailnet(server) && activeVpn == false
}

/** Survives Activity pauses: opening the VPN app must not cause a connect-broadcast loop. */
class TailscaleRequestGate(private val cooldownMillis: Long = 30_000) {
    private var lastRequestAt: Long? = null
    fun claim(now: Long, allowed: Boolean): Boolean {
        if (!allowed) return false
        if (lastRequestAt?.let { now >= it && now - it < cooldownMillis } == true) return false
        lastRequestAt = now
        return true
    }
}
