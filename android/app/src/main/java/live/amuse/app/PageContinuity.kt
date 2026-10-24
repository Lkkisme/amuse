package live.amuse.app

/** Only the owner's passwordless, origin-bound page may survive an ordinary app switch. */
object PageContinuity {
    data class Context(val paired: Boolean, val localUnlock: Boolean, val unlocked: Boolean,
        val sameOrigin: Boolean, val renderer: Boolean, val picker: Boolean, val authenticating: Boolean,
        val settings: Boolean, val permissionDialog: Boolean)

    fun retain(context: Context): Boolean = with(context) {
        paired && !localUnlock && unlocked && sameOrigin && renderer && !picker && !authenticating &&
            !settings && !permissionDialog
    }

    fun reveal(context: Context, foreground: Boolean, deviceUnlocked: Boolean): Boolean =
        foreground && deviceUnlocked && retain(context)
}

/** A callback burst becomes one trailing-edge notification; callbacks from a removed observer cannot fire it. */
class NetworkChangeDebounce {
    data class Ticket(val epoch: Int, val serial: Long)
    private var epoch = -1
    private var serial = 0L
    private val fingerprints = mutableMapOf<String, String>()
    private var pending: Ticket? = null

    fun begin(epoch: Int) { cancel(); this.epoch = epoch }
    fun changed(epoch: Int, key: String, fingerprint: String): Ticket? {
        if (this.epoch != epoch || fingerprints[key] == fingerprint) return null
        fingerprints[key] = fingerprint
        return Ticket(epoch, ++serial).also { pending = it }
    }
    fun claim(ticket: Ticket, epoch: Int, eligible: Boolean): Boolean {
        if (!eligible || this.epoch != epoch || pending != ticket) return false
        pending = null
        return true
    }
    fun cancel() { epoch = -1; pending = null; fingerprints.clear(); serial++ }
}

/** Fixed, one-way lifecycle notifications, with no page data or native bridge. */
enum class PageSignal(val script: String) {
    PAUSE("window.dispatchEvent(new Event('amuse:pause'));"),
    RESUME("window.dispatchEvent(new Event('amuse:resume'));"),
    NETWORK_CHANGE("window.dispatchEvent(new Event('amuse:network-change'));")
}
