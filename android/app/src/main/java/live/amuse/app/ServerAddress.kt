package live.amuse.app

import java.net.URI
import java.util.Locale

/** Only an HTTPS origin can receive the server session, never an arbitrary page URL. */
@ConsistentCopyVisibility
data class ServerAddress private constructor(val origin: String, val host: String, val port: Int) {
    val home: String get() = "$origin/"

    fun contains(url: String): Boolean = runCatching {
        val uri = URI(url)
        uri.scheme.equals("https", ignoreCase = true) &&
            uri.rawUserInfo == null && uri.host.equals(host, ignoreCase = true) &&
            (if (uri.port == -1) 443 else uri.port) == port
    }.getOrDefault(false)

    companion object {
        // A placeholder, never a connection target before explicit setup.
        const val EXAMPLE = "https://amuse.example.com"

        fun parse(value: String): ServerAddress {
            val uri = runCatching { URI(value.trim()) }.getOrElse {
                throw IllegalArgumentException("Enter a complete HTTPS server address.")
            }
            require(uri.scheme.equals("https", ignoreCase = true)) { "The server address must use HTTPS." }
            require(uri.rawUserInfo == null && uri.host != null && uri.host.isNotBlank()) { "Use a host without a username or password." }
            require(uri.rawQuery == null && uri.rawFragment == null && (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/")) {
                "Enter only an origin and optional port, without a path, query or fragment."
            }
            require(!uri.rawAuthority.endsWith(":")) { "A port must not be empty." }
            require(uri.port == -1 || uri.port in 1..65535) { "The port must be between 1 and 65535." }
            val host = uri.host.lowercase(Locale.ROOT)
            val port = if (uri.port == -1) 443 else uri.port
            val authorityHost = if (host.contains(":") && !host.startsWith("[")) "[$host]" else host
            return ServerAddress("https://$authorityHost${if (port == 443) "" else ":$port"}", host, port)
        }
    }
}

/** Extract only Amuse's opaque session; passwords are never handled by native code. */
object SessionCookie {
    fun extract(header: String?): String? = header?.split(';')
        ?.map(String::trim)
        ?.firstOrNull { it.startsWith("amuse=") && it.substringAfter('=').matches(Regex("[A-Za-z0-9_%~-]{20,256}")) }

    fun restoreHeader(cookie: String): String {
        require(extract(cookie) == cookie && !cookie.contains(';')) { "Invalid session cookie" }
        // Session-only in WebView; the reusable copy is encrypted in SessionVault.
        return "$cookie; Path=/; Secure; HttpOnly; SameSite=Strict"
    }
}
