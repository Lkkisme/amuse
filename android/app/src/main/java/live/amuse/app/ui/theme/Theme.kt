package live.amuse.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

// Shared with web/src/index.css. CSS alpha-last colors are written ARGB here.
private val LightColors = lightColorScheme(
    primary = Color(0xFF0064D4), onPrimary = Color.White,
    primaryContainer = Color(0xFFEAF3FF), onPrimaryContainer = Color(0xFF111112),
    secondary = Color(0xFF0064D4), onSecondary = Color.White,
    secondaryContainer = Color(0xFFF3F4F5), onSecondaryContainer = Color(0xFF111112),
    tertiary = Color(0xFFC65323), onTertiary = Color.White,
    tertiaryContainer = Color(0xFFF3F4F5), onTertiaryContainer = Color(0xFF111112),
    background = Color(0xFFFCFCFC), onBackground = Color(0xFF111112),
    surface = Color.White, onSurface = Color(0xFF111112),
    surfaceVariant = Color(0xFFF3F4F5), onSurfaceVariant = Color(0x96000409),
    surfaceTint = Color.Transparent,
    surfaceDim = Color(0xFFF3F4F5), surfaceBright = Color.White,
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFF3F4F5),
    surfaceContainer = Color(0xFFF3F4F5), surfaceContainerHigh = Color(0xFFF3F4F5),
    surfaceContainerHighest = Color(0xFFF3F4F5),
    outline = Color(0x5E000711), outlineVariant = Color(0x1A000000),
    error = Color(0xFFC01F37), onError = Color.White,
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF1793FF), onPrimary = Color(0xFF111112),
    primaryContainer = Color(0xFF28292B), onPrimaryContainer = Color.White,
    secondary = Color(0xFF1793FF), onSecondary = Color(0xFF111112),
    secondaryContainer = Color(0xFF28292B), onSecondaryContainer = Color.White,
    tertiary = Color(0xFFF1916E), onTertiary = Color(0xFF111112),
    tertiaryContainer = Color(0xFF28292B), onTertiaryContainer = Color.White,
    background = Color(0xFF181819), onBackground = Color.White,
    surface = Color(0xFF28292B), onSurface = Color.White,
    surfaceVariant = Color(0xFF28292B), onSurfaceVariant = Color(0x87F2F7FF),
    surfaceTint = Color.Transparent,
    surfaceDim = Color(0xFF181819), surfaceBright = Color(0xFF28292B),
    surfaceContainerLowest = Color(0xFF181819), surfaceContainerLow = Color(0xFF28292B),
    surfaceContainer = Color(0xFF28292B), surfaceContainerHigh = Color(0xFF28292B),
    surfaceContainerHighest = Color(0xFF525456),
    outline = Color(0x61F1F6FF), outlineVariant = Color(0x1FFFFFFF),
    error = Color(0xFFFA4758), onError = Color(0xFF111112),
)

@Immutable
private data class MuseExtras(
    val green: Color,
    val orange: Color,
    val tertiaryText: Color,
    val avatarStart: Color,
    val avatarEnd: Color,
    val avatarText: Color,
)

private val LightExtras = MuseExtras(
    Color(0xFF008200), Color(0xFFC65323), Color(0x5E000711),
    Color(0xFFF4E9DA), Color(0xFFE0CBB0), Color(0xFF75583D),
)
private val DarkExtras = MuseExtras(
    Color(0xFF07B123), Color(0xFFF1916E), Color(0x61F1F6FF),
    Color(0xFF7A6650), Color(0xFF52443A), Color(0xFFF4E9DA),
)
private val LocalMuseExtras = staticCompositionLocalOf { LightExtras }

val MuseSurface: Color
    @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.background
val MuseSurfaceElevated: Color
    @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.surfaceVariant
val MuseCard: Color
    @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.surfaceVariant
val MuseTextPrimary: Color
    @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.onSurface
val MuseTextSecondary: Color
    @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.onSurfaceVariant
val MuseTextTertiary: Color
    @Composable @ReadOnlyComposable get() = LocalMuseExtras.current.tertiaryText
val MuseAccent: Color
    @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.primary
val MuseGreen: Color
    @Composable @ReadOnlyComposable get() = LocalMuseExtras.current.green
val MuseOrange: Color
    @Composable @ReadOnlyComposable get() = LocalMuseExtras.current.orange
val MuseRed: Color
    @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.error
val MuseAvatarStart: Color
    @Composable @ReadOnlyComposable get() = LocalMuseExtras.current.avatarStart
val MuseAvatarEnd: Color
    @Composable @ReadOnlyComposable get() = LocalMuseExtras.current.avatarEnd
val MuseAvatarText: Color
    @Composable @ReadOnlyComposable get() = LocalMuseExtras.current.avatarText

/** Native chrome follows the Web UI's explicit theme, with a system-theme launch default. */
@Composable
fun AmuseTheme(darkTheme: Boolean = false, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalMuseExtras provides if (darkTheme) DarkExtras else LightExtras) {
        MaterialTheme(colorScheme = if (darkTheme) DarkColors else LightColors, content = content)
    }
}
