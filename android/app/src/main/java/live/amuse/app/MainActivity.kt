package live.amuse.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import live.amuse.app.ui.AmuseApp
import live.amuse.app.ui.theme.AmuseTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AmuseTheme {
                AmuseApp()
            }
        }
    }
}
