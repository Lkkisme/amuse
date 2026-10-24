package live.amuse.app

import org.junit.Assert.*
import org.junit.Test

class TailscaleConnectionTest {
    private val tail = ServerAddress.parse("https://phone.tail123.ts.net:8443")

    @Test fun `only tailnet host labels and exact CGNAT IPv4 range are recognized`() {
        for (host in listOf("PHONE.TAIL123.TS.NET", "100.64.0.0", "100.127.255.255", "100.68.255.111"))
            assertTrue(host, TailscaleConnection.tailnet(ServerAddress.parse("https://$host")))
        for (host in listOf("example.com", "ts.net", "not-ts.net", "phone.ts.net.attacker.test",
            "100.63.255.255", "100.128.0.0", "101.64.0.1", "100.64.0.256", "100.64.1", "100.064.0.1", "[::1]")) {
            val parsed = runCatching { ServerAddress.parse("https://$host") }.getOrNull()
            if (parsed != null) assertFalse(host, TailscaleConnection.tailnet(parsed))
        }
    }

    @Test fun `any active VPN and unknown VPN state prevent a connect request`() {
        assertTrue(TailscaleConnection.allowed(tail, true, true, true, false))
        for (vpn in listOf(true, null)) assertFalse(TailscaleConnection.allowed(tail, true, true, true, vpn))
        assertFalse(TailscaleConnection.allowed(tail, false, true, true, false))
        assertFalse(TailscaleConnection.allowed(tail, true, false, true, false))
        assertFalse(TailscaleConnection.allowed(tail, true, true, false, false))
        assertFalse(TailscaleConnection.allowed(ServerAddress.parse("https://example.com"), true, true, true, false))
    }

    @Test fun `foreground resumes and manual retry cannot flood the official receiver`() {
        val gate = TailscaleRequestGate()
        assertFalse(gate.claim(1_000, false))
        assertTrue(gate.claim(1_000, true))
        assertFalse(gate.claim(1_000, true))
        assertFalse(gate.claim(2_000, true))
        assertFalse(gate.claim(30_999, true))
        assertTrue(gate.claim(31_000, true))
        assertFalse(gate.claim(60_999, true))
        assertTrue(gate.claim(61_000, true))
    }
}
