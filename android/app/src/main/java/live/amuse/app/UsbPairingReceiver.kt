package live.amuse.app

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.util.Base64

/** Explicit owner provisioning via an Android DUMP-permission-protected broadcast. */
class UsbPairingReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        setResult(Activity.RESULT_CANCELED, "Pairing failed", null)
        if (intent.action != ACTION) return
        var paired: PairedSessionVault? = null
        var stored = false
        try {
            val preferences = context.getSharedPreferences("amuse_settings", Context.MODE_PRIVATE)
            val server = ServerAddress.parse(requireNotNull(preferences.getString("server", null)))
            // Provisioning cannot change the configured server, including its HTTPS port.
            require(intent.getStringExtra("serverOrigin") == server.origin)
            val token = requireNotNull(intent.getStringExtra("sessionToken"))
            require(Regex("[A-Za-z0-9_-]{43}").matches(token))
            val decoded = Base64.getUrlDecoder().decode(token)
            try {
                require(decoded.size == 32 && Base64.getUrlEncoder().withoutPadding().encodeToString(decoded) == token)
            } finally { decoded.fill(0) }
            val vault = PairedSessionVault(context)
            paired = vault
            vault.store(server, "amuse=$token")
            stored = true
            SessionVault(context).clear()
            check(preferences.edit().putBoolean("device_unlock", false).commit())
            setResult(Activity.RESULT_OK, "paired", null)
        } catch (_: Exception) {
            if (stored) runCatching { paired?.clear() }
            // Never expose a session, origin, exception detail, or intent extras in the result/logs.
            setResult(Activity.RESULT_CANCELED, "Pairing failed", null)
        }
    }

    companion object {
        const val ACTION = "live.amuse.app.USB_PAIR"
    }
}
