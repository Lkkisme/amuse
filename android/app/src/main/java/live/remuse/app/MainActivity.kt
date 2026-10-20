package live.remuse.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import live.remuse.app.ui.RemuseApp
import live.remuse.app.ui.theme.RemuseTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            RemuseTheme {
                RemuseApp()
            }
        }
    }
}
