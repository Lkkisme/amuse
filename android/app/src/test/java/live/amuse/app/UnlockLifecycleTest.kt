package live.amuse.app

import org.junit.Assert.*
import org.junit.Test

class UnlockLifecycleTest {
    private val visit = UnlockLifecycle.Visit(7, "https://owner.tail123.ts.net:8443")

    @Test fun `late unlock cannot activate another visit origin locked device or incomplete setup`() {
        assertTrue(UnlockLifecycle.current(visit, visit, true, true, true, true))
        assertFalse(UnlockLifecycle.current(visit, visit.copy(generation = 8), true, true, true, true))
        assertFalse(UnlockLifecycle.current(visit, visit.copy(origin = "https://other.example.com"), true, true, true, true))
        assertFalse(UnlockLifecycle.current(visit, visit, false, true, true, true))
        assertFalse(UnlockLifecycle.current(visit, visit, true, false, true, true))
        assertFalse(UnlockLifecycle.current(visit, visit, true, true, false, true))
        assertFalse(UnlockLifecycle.current(visit, visit, true, true, true, false))
    }

    @Test fun `stale biometric cookie cleanup cannot delete a newer restore or active owner page`() {
        assertTrue(UnlockLifecycle.clearStaleCookie(5, 5, localUnlock = true, activePage = false))
        assertFalse(UnlockLifecycle.clearStaleCookie(5, 6, localUnlock = true, activePage = false))
        assertFalse(UnlockLifecycle.clearStaleCookie(5, 5, localUnlock = false, activePage = false))
        assertFalse(UnlockLifecycle.clearStaleCookie(5, 5, localUnlock = true, activePage = true))
    }
}
