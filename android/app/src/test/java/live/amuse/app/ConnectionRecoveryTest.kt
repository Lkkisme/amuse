package live.amuse.app

import org.junit.Assert.*
import org.junit.Test

class ConnectionRecoveryTest {
    private val origin = "https://phone.tail123.ts.net"
    private val page = ConnectionRecovery.Page(1, origin)

    @Test fun `only recoverable document transport failures are retried`() {
        for (code in listOf(-2, -6, -7, -8)) assertTrue(ConnectionRecovery.retryable(code))
        for (code in listOf(null, -1, -3, -4, -5, -9, -10, -11, -12, -13, -14, -15, -16, 401, 503))
            assertFalse("code $code", ConnectionRecovery.retryable(code))
    }

    @Test fun `failed error-document finish retains capped backoff across replacement renderers`() {
        val recovery = ConnectionRecovery()
        var current = page
        recovery.beginPage(current)
        for (seconds in listOf(2, 4, 8, 15, 30, 30, 30)) {
            val retry = recovery.failed(current, -6, true)!!
            assertEquals(seconds, retry.delaySeconds)
            assertFalse(recovery.finished(current, failed = true))
            assertTrue(recovery.claim(retry, current, true))
            current = current.copy(generation = current.generation + 1)
            recovery.beginPage(current, preserveBackoff = true)
        }
        assertTrue(recovery.finished(current, failed = false))
        recovery.beginPage(current.copy(generation = 100))
        assertEquals(2, recovery.failed(current.copy(generation = 100), -8, true)!!.delaySeconds)
    }

    @Test fun `duplicate failure owns one ticket and recovery wake invalidates the old timer`() {
        val recovery = ConnectionRecovery()
        recovery.beginPage(page)
        val first = recovery.failed(page, -2, true)!!
        assertEquals(first, recovery.failed(page, -2, true))
        val immediate = recovery.wake(page, true)!!
        assertEquals(0, immediate.delaySeconds)
        assertFalse(recovery.claim(first, page, true))
        assertTrue(recovery.claim(immediate, page, true))
        assertFalse(recovery.claim(immediate, page, true))
        assertNull(recovery.wake(page, true))
    }

    @Test fun `pause lock settings destroy and stale generation cannot claim a late timer`() {
        val allowed = ConnectionRecovery.Gate(true, true, false, false, false, true, true)
        assertTrue(allowed.allowed)
        for (blocked in listOf(allowed.copy(foreground = false), allowed.copy(unlocked = false),
            allowed.copy(settings = true), allowed.copy(picker = true), allowed.copy(authenticating = true),
            allowed.copy(renderer = false), allowed.copy(error = false))) {
            val recovery = ConnectionRecovery()
            recovery.beginPage(page)
            val retry = recovery.failed(page, -8, allowed.allowed)!!
            assertFalse(recovery.claim(retry, page, blocked.allowed))
            assertNull(recovery.wake(page, blocked.allowed))
            recovery.cancel()
            assertFalse(recovery.claim(retry, page, true))
            assertNull(recovery.wake(page, true))
        }
        val recovery = ConnectionRecovery()
        recovery.beginPage(page)
        val old = recovery.failed(page, -7, true)!!
        val replacement = page.copy(generation = 2)
        recovery.beginPage(replacement)
        assertFalse(recovery.claim(old, replacement, true))
        assertNull(recovery.failed(page, -6, true))
        assertNull(recovery.wake(page.copy(origin = "https://other.ts.net"), true))
    }

    @Test fun `TLS HTTP login errors and healthy pages cannot be revived by network callbacks`() {
        for (terminal in listOf(null, -11, -4, 401, 503)) {
            val recovery = ConnectionRecovery()
            recovery.beginPage(page)
            val old = recovery.failed(page, -6, true)!!
            assertNull(recovery.failed(page, terminal, true))
            assertNull(recovery.wake(page, true))
            assertFalse(recovery.claim(old, page, true))
        }
        val recovery = ConnectionRecovery()
        recovery.beginPage(page)
        assertNull(recovery.wake(page, true))
        assertTrue(recovery.finished(page, failed = false))
        repeat(10) { assertNull(recovery.wake(page, true)) }
    }

    @Test fun `manual navigation resets retry delay and wrong-origin completion does not clear pending work`() {
        val recovery = ConnectionRecovery()
        recovery.beginPage(page)
        val first = recovery.failed(page, -6, true)!!
        assertFalse(recovery.finished(page.copy(origin = "https://other.example"), false))
        assertTrue(recovery.claim(first, page, true))
        recovery.beginPage(page.copy(generation = 2))
        assertEquals(2, recovery.failed(page.copy(generation = 2), -6, true)!!.delaySeconds)
    }
}
