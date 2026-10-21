package live.amuse.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Values read visually from the Muse reference screenshots (docs/ui-spec.md).
val MuseSurface = Color(0xFF101010)
val MuseSurfaceElevated = Color(0xFF1A1A1A)
val MuseCard = Color(0xFF222222)
val MuseTextPrimary = Color(0xFFF2F2F2)
val MuseTextSecondary = Color(0xFF9E9E9E)
val MuseAccent = Color(0xFFE8E8E8)
val MuseGreen = Color(0xFF34A853)
val MuseOrange = Color(0xFFF29900)
val MuseRed = Color(0xFFEA4335)

private val MuseColors = darkColorScheme(
    primary = MuseAccent,
    onPrimary = Color.Black,
    background = MuseSurface,
    onBackground = MuseTextPrimary,
    surface = MuseSurface,
    onSurface = MuseTextPrimary,
    surfaceVariant = MuseCard,
    onSurfaceVariant = MuseTextSecondary,
    error = MuseRed,
)

@Composable
fun AmuseTheme(content: @Composable () -> Unit) {
    // Muse is dark-first; follow the system only for light fallback in the future.
    if (isSystemInDarkTheme()) {
        MaterialTheme(colorScheme = MuseColors, content = content)
    } else {
        MaterialTheme(colorScheme = MuseColors, content = content)
    }
}
