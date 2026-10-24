package live.amuse.app

import org.junit.Assert.*
import org.junit.Test

class ServerConfigurationTest {
    private val paired = ServerAddress.parse("https://owner.tail123.ts.net:8443")
    private val biometric = ServerAddress.parse("https://private.example.com")

    @Test fun `first install has no automatic target and explicit configuration wins over old vaults`() {
        assertNull(ServerConfiguration.resolve(null, null, null))
        assertEquals(ServerAddress.parse("https://new.example.com"),
            ServerConfiguration.resolve("https://new.example.com", paired, biometric))
        assertNull(ServerConfiguration.resolve("http://invalid.example.com", paired, biometric))
        assertNull(ServerConfiguration.resolve("", paired, biometric))
    }

    @Test fun `legacy origin migration preserves the existing pairing without changing the origin`() {
        assertEquals(paired, ServerConfiguration.resolve(null, paired, biometric))
        assertEquals(biometric, ServerConfiguration.resolve(null, null, biometric))
        assertEquals("https://owner.tail123.ts.net:8443", ServerConfiguration.resolve(null, paired, null)!!.origin)
    }
}
