package live.amuse.app

import org.junit.Assert.*
import org.junit.Test

class WebPermissionPolicyTest {
    private val server = ServerAddress.parse("https://amuse.example.com:8443")
    private val audio = WebPermissionPolicy.AUDIO_CAPTURE

    @Test fun `only the configured secure origin may request microphone`() {
        assertTrue(WebPermissionPolicy.microphone(server, "https://amuse.example.com:8443/", listOf(audio)))
        for (origin in listOf("http://amuse.example.com:8443", "https://amuse.example.com", "https://attacker.example",
            "https://amuse.example.com.attacker.test:8443", "https://user@amuse.example.com:8443", "https://amuse.example.com:8443/path", "null", "file:///"))
            assertFalse(origin, WebPermissionPolicy.microphone(server, origin, listOf(audio)))
    }

    @Test fun `unknown camera empty mixed and future permissions are denied`() {
        for (resources in listOf(emptyList(), listOf("android.webkit.resource.VIDEO_CAPTURE"), listOf("future.resource"),
            listOf(audio, "android.webkit.resource.VIDEO_CAPTURE"), listOf(audio, audio)))
            assertFalse(WebPermissionPolicy.microphone(server, server.origin, resources))
    }
}
