package live.amuse.app

import java.net.URI

/** Only an HTTPS origin can receive the server session, never an arbitrary page URL. */
data class ServerAddress private constructor(val origin: String, val host: String, val port: Int) {
    val home: String get() = "$origin/"

    fun contains(url: String): Boolean = runCatching {
        val uri = URI(url)
        uri.scheme.equals("https", ignoreCase = true) &&
            uri.rawUserInfo == null && uri.host.equals(host, ignoreCase = true) &&
            (if (uri.port == -1) 443 else uri.port) == port
    }.getOrDefault(false)

    companion object {
        const val DEFAULT = "https://lkk.tail988ed4.ts.net:8443"

        fun parse(value: String): ServerAddress {
            val uri = runCatching { URI(value.trim()) }.getOrElse {
                throw IllegalArgumentException("请输入完整的 HTTPS 服务地址。")
            }
            require(uri.scheme.equals("https", ignoreCase = true)) { "服务地址必须使用 HTTPS。" }
            require(uri.rawUserInfo == null && uri.host != null && uri.host.isNotBlank()) { "地址中不能包含用户名或密码。" }
            require(uri.rawQuery == null && uri.rawFragment == null && (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/")) {
                "只填写服务地址和端口，不要附加页面路径、参数或片段。"
            }
            require(uri.port == -1 || uri.port in 1..65535) { "端口必须介于 1 与 65535。" }
            val host = uri.host.lowercase()
            val port = if (uri.port == -1) 443 else uri.port
            val authorityHost = if (host.contains(":") && !host.startsWith("[")) "[$host]" else host
            return ServerAddress("https://$authorityHost${if (port == 443) "" else ":$port"}", host, port)
        }
    }
}

/** Extract only Amuse's opaque session; PIN values are never handled by native code. */
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
