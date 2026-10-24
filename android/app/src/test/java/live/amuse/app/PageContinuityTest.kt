package live.amuse.app

import org.junit.Assert.*
import org.junit.Test

class PageContinuityTest {
    private val owner = PageContinuity.Context(true, false, true, true, true, false, false, false, false)

    @Test fun `only the normal paired passwordless renderer may survive an app switch`() {
        assertTrue(PageContinuity.retain(owner))
        for (other in listOf(owner.copy(paired = false), owner.copy(localUnlock = true), owner.copy(unlocked = false),
            owner.copy(sameOrigin = false), owner.copy(renderer = false), owner.copy(picker = true),
            owner.copy(authenticating = true), owner.copy(settings = true), owner.copy(permissionDialog = true))) {
            assertFalse(other.toString(), PageContinuity.retain(other))
            assertFalse(PageContinuity.reveal(other, foreground = true, deviceUnlocked = true))
        }
    }

    @Test fun `foreground before actual device unlock cannot reveal a retained page`() {
        assertFalse(PageContinuity.reveal(owner, foreground = true, deviceUnlocked = false))
        assertFalse(PageContinuity.reveal(owner, foreground = false, deviceUnlocked = true))
        assertTrue(PageContinuity.reveal(owner, foreground = true, deviceUnlocked = true))
        val tail = ServerAddress.parse("https://phone.tail123.ts.net")
        assertFalse(TailscaleConnection.allowed(tail, true, true, true, false, deviceUnlocked = false))
        assertTrue(TailscaleConnection.allowed(tail, true, true, true, false, deviceUnlocked = true))
    }

    @Test fun `retained transport failure is rearmed after pause without reviving old epoch timers`() {
        val recovery = ConnectionRecovery()
        val page = ConnectionRecovery.Page(7, "https://phone.tail123.ts.net")
        val failure = ConnectionRecovery.Failure(page, -8)
        recovery.beginPage(page)
        val canceled = recovery.failed(page, -8, true)!!
        recovery.cancel()
        assertFalse(recovery.claim(canceled, page, true))
        val resumed = recovery.resumeFailure(failure, page, true)!!
        assertEquals(2, resumed.delaySeconds)
        assertTrue(recovery.claim(resumed, page, true))
        assertNull(recovery.resumeFailure(failure, page.copy(generation = 8), true))
        assertNull(recovery.resumeFailure(failure, page.copy(origin = "https://other.example"), true))
    }

    @Test fun `resume never reloads a healthy page or a TLS HTTP authentication failure`() {
        val page = ConnectionRecovery.Page(1, "https://phone.tail123.ts.net")
        for (failure in listOf(null, ConnectionRecovery.Failure(page, null), ConnectionRecovery.Failure(page, -11),
            ConnectionRecovery.Failure(page, -4), ConnectionRecovery.Failure(page, 401), ConnectionRecovery.Failure(page, 503))) {
            val recovery = ConnectionRecovery()
            recovery.beginPage(page)
            recovery.cancel()
            assertNull(recovery.resumeFailure(failure, page, true))
            assertNull(recovery.wake(page, true))
        }
        val recovery = ConnectionRecovery()
        assertNull(recovery.resumeFailure(ConnectionRecovery.Failure(page, -6), page, false))
    }

    @Test fun `network changes on the same VPN identity coalesce until the last route signal`() {
        val changes = NetworkChangeDebounce()
        changes.begin(1)
        val first = changes.changed(1, "vpn:1:transport", "VPN,WIFI:validated")!!
        assertNull(changes.changed(1, "vpn:1:transport", "VPN,WIFI:validated"))
        val mobile = changes.changed(1, "vpn:1:transport", "VPN,CELLULAR:validated")!!
        val underlying = changes.changed(1, "physical:2:presence", "available")!!
        assertFalse(changes.claim(first, 1, true))
        assertFalse(changes.claim(mobile, 1, true))
        assertTrue(changes.claim(underlying, 1, true))
        assertFalse(changes.claim(underlying, 1, true))
    }

    @Test fun `removed network observers and locked foreground cannot notify a new page`() {
        val changes = NetworkChangeDebounce()
        changes.begin(1)
        val old = changes.changed(1, "route", "wifi")!!
        assertFalse(changes.claim(old, 1, false))
        changes.cancel()
        assertFalse(changes.claim(old, 1, true))
        changes.begin(2)
        assertNull(changes.changed(1, "route", "mobile"))
        assertFalse(changes.claim(old, 2, true))
        val current = changes.changed(2, "route", "mobile")!!
        assertTrue(changes.claim(current, 2, true))
    }
}
