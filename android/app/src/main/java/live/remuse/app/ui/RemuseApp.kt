package live.remuse.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import live.remuse.app.R

/**
 * Root composable. The writer replaces this placeholder with the full navigation:
 * drawer + main chat feed + card system + settings, per docs/ui-spec.md.
 */
@Composable
fun RemuseApp() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text = stringResource(R.string.app_name))
    }
}
