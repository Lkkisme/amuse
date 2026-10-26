package live.amuse.app

import java.net.URI

/** Android returns multi-select results in ClipData, including some single selections. */
object DocumentSelection {
    fun select(success: Boolean, clip: List<String>, single: String?): List<String>? {
        if (!success) return null
        val candidates = if (clip.isNotEmpty()) clip else listOfNotNull(single)
        return candidates.filter { value ->
            runCatching { URI(value).scheme == "content" }.getOrDefault(false)
        }.takeIf { it.isNotEmpty() }
    }
}

/** A canceled renderer can leave Android's picker open; its result must be drained
 * before a replacement page may launch another picker through the same launcher. */
class DocumentPickerVisit {
    private var launched: ConnectionRecovery.Page? = null

    fun start(page: ConnectionRecovery.Page): Boolean {
        if (launched != null) return false
        launched = page
        return true
    }

    fun finish(page: ConnectionRecovery.Page?): Boolean {
        val previous = launched
        launched = null
        return previous != null && previous == page
    }
}
