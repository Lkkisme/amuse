package live.amuse.app

import org.junit.Assert.*
import org.junit.Test

class DocumentSelectionTest {
    @Test fun `ClipData preserves multi selection and takes precedence over data`() {
        val clip = listOf("content://documents/one", "content://documents/two")
        assertEquals(clip, DocumentSelection.select(true, clip, "content://documents/ignored"))
        assertEquals(clip.take(1), DocumentSelection.select(true, clip.take(1), null))
    }

    @Test fun `single data is accepted when ClipData is absent`() {
        assertEquals(listOf("content://documents/single"), DocumentSelection.select(true, emptyList(), "content://documents/single"))
    }

    @Test fun `cancel and empty result never produce an upload`() {
        assertNull(DocumentSelection.select(false, listOf("content://documents/one"), "content://documents/two"))
        assertNull(DocumentSelection.select(true, emptyList(), null))
    }

    @Test fun `only granted content URIs pass even when mixed with other schemes`() {
        assertEquals(listOf("content://documents/valid"), DocumentSelection.select(true,
            listOf("file:///private/token", "https://external.test/file", "content://documents/valid", "bad URI"), null))
        assertNull(DocumentSelection.select(true, listOf("file:///private/token"), "content://documents/not-a-fallback"))
    }

    @Test fun `obsolete Android picker must return before a replacement renderer can launch`() {
        val visit = DocumentPickerVisit()
        val original = ConnectionRecovery.Page(1, "https://amuse.example.com")
        val replacement = ConnectionRecovery.Page(2, original.origin)
        assertTrue(visit.start(original))
        assertFalse(visit.start(replacement))
        assertFalse(visit.finish(replacement))
        assertTrue(visit.start(replacement))
        assertTrue(visit.finish(replacement))
        assertFalse(visit.finish(replacement))
    }

    @Test fun `canceled callback cannot deliver a late result across server change`() {
        val visit = DocumentPickerVisit()
        val original = ConnectionRecovery.Page(1, "https://amuse.example.com")
        assertTrue(visit.start(original))
        assertFalse(visit.finish(null))
        val otherOrigin = ConnectionRecovery.Page(1, "https://other.example.com")
        assertTrue(visit.start(otherOrigin))
        assertFalse(visit.finish(original))
    }
}
