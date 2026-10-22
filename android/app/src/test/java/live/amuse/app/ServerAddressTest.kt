package live.amuse.app

import org.junit.Assert.*
import org.junit.Test

class ServerAddressTest {
    @Test fun `normalizes https origins ports and ipv6`() {
        assertEquals("https://amuse.example.com", ServerAddress.parse(" HTTPS://AMUSE.EXAMPLE.COM:443/ ").origin)
        assertEquals("https://[::1]:8443", ServerAddress.parse("https://[::1]:8443").origin)
        assertTrue(ServerAddress.parse("https://[::1]:8443").contains("https://[::1]:8443/rpc"))
    }

    @Test fun `same origin compares scheme host credentials and effective port`() {
        val server = ServerAddress.parse("https://amuse.example.com:8443")
        assertTrue(server.contains("https://AMUSE.example.com:8443/rpc?chat=main"))
        for (url in listOf("http://amuse.example.com:8443", "https://amuse.example.com", "https://other.example.com:8443",
            "https://amuse.example.com.attacker.test:8443", "https://user@amuse.example.com:8443", "file:///etc/passwd", "https://amuse.example.com:8443\\@attacker.test"))
            assertFalse(url, server.contains(url))
    }

    @Test fun `rejects paths embedded secrets malformed ports and non https`() {
        for (value in listOf("", "http://example.com", "file:///tmp/test", "javascript:alert(1)", "https://user:secret@example.com",
            "https://example.com/path", "https://example.com?token=a", "https://example.com#fragment", "https://example.com:0",
            "https://example.com:65536", "https://example.com:", "https://example.com:abc", "https://example.com\\@attacker.test"))
            assertThrows(value, IllegalArgumentException::class.java) { ServerAddress.parse(value) }
    }

    @Test fun `session codec accepts only an opaque amuse cookie`() {
        val cookie = "amuse=0123456789abcdefghijklmnopqrstuv"
        assertEquals(cookie, SessionCookie.extract("other=ignore; $cookie; foo=bar"))
        assertEquals("$cookie; Path=/; Secure; HttpOnly; SameSite=Strict", SessionCookie.restoreHeader(cookie))
        assertNull(SessionCookie.extract("amuse=; Max-Age=0"))
        assertNull(SessionCookie.extract("amuse=bad\r\nInjected: value"))
        assertThrows(IllegalArgumentException::class.java) { SessionCookie.restoreHeader("$cookie; Domain=attacker.test") }
    }
}
