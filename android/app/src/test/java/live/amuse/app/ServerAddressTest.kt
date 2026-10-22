package live.amuse.app

import org.junit.Assert.*
import org.junit.Test

class ServerAddressTest {
    @Test fun `normalizes an https origin and its default port`() {
        assertEquals("https://example.com", ServerAddress.parse(" https://EXAMPLE.com:443/ ").origin)
        assertEquals(ServerAddress.DEFAULT, ServerAddress.parse(ServerAddress.DEFAULT).origin)
    }

    @Test fun `session origin checks distinguish schemes hosts credentials and ports`() {
        val address = ServerAddress.parse(ServerAddress.DEFAULT)
        assertTrue(address.contains("${ServerAddress.DEFAULT}/rpc?chat=main"))
        for (url in listOf("http://lkk.tail988ed4.ts.net:8443", "https://lkk.tail988ed4.ts.net", "https://other.tail988ed4.ts.net:8443", "https://lkk.tail988ed4.ts.net.attacker.test:8443", "https://user@lkk.tail988ed4.ts.net:8443", "file:///etc/passwd")) {
            assertFalse(url, address.contains(url))
        }
    }

    @Test fun `configuration rejects non origins and embedded secrets`() {
        for (value in listOf("http://example.com", "file:///tmp/test", "javascript:alert(1)", "https://user:secret@example.com", "https://example.com/path", "https://example.com?token=a", "https://example.com#fragment", "https://example.com:0")) {
            assertThrows(value, IllegalArgumentException::class.java) { ServerAddress.parse(value) }
        }
    }

    @Test fun `cookie codec selects the opaque server session and restores secure attributes`() {
        val cookie = "amuse=0123456789abcdefghijklmnopqrstuv"
        assertEquals(cookie, SessionCookie.extract("other=ignore; $cookie; foo=bar"))
        assertEquals("$cookie; Path=/; Secure; HttpOnly; SameSite=Strict", SessionCookie.restoreHeader(cookie))
        assertNull(SessionCookie.extract("amuse=; Max-Age=0"))
        assertNull(SessionCookie.extract("amuse=bad\r\nInjected: value"))
        assertThrows(IllegalArgumentException::class.java) { SessionCookie.restoreHeader("$cookie; Domain=attacker.test") }
    }
}
