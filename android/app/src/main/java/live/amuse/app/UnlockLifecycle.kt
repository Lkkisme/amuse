package live.amuse.app

/** A cookie callback belongs to one foreground visit and one configured origin. */
object UnlockLifecycle {
    data class Visit(val generation: Int, val origin: String)
    fun current(expected: Visit, actual: Visit, foreground: Boolean, deviceUnlocked: Boolean,
        configured: Boolean, cookiesReady: Boolean): Boolean =
        expected == actual && foreground && deviceUnlocked && configured && cookiesReady

    /** A late callback must never remove a newer session or the owner's active paired page. */
    fun clearStaleCookie(restoreOperation: Long, latestOperation: Long, localUnlock: Boolean, activePage: Boolean): Boolean =
        restoreOperation == latestOperation && localUnlock && !activePage
}
