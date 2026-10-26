package live.amuse.app

/** Pure policy shared by the WebView callback and JVM boundary tests. */
object WebPermissionPolicy {
    const val AUDIO_CAPTURE = "android.webkit.resource.AUDIO_CAPTURE"

    // A local confirmation belongs to the complete configured origin, not every
    // service on the hostname. Android's runtime grant is still checked separately.
    fun microphoneConsentKey(server: ServerAddress): String = "microphone_allowed:${server.origin}"

    // Do not accidentally grant future resources, video, MIDI or mixed requests.
    fun microphone(server: ServerAddress, origin: String, resources: List<String>): Boolean =
        runCatching { ServerAddress.parse(origin) == server }.getOrDefault(false) && resources == listOf(AUDIO_CAPTURE)
}
