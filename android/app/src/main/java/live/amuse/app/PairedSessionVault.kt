package live.amuse.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Owner-paired device login. No PIN or plaintext cookie is stored on disk. */
class PairedSessionVault(context: Context) {
    private val prefs = context.getSharedPreferences("amuse_paired_session_vault", Context.MODE_PRIVATE)
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val encoder = Base64.getEncoder()
    private val decoder = Base64.getDecoder()

    fun store(server: ServerAddress, cookie: String) = synchronized(lock) {
        require(SessionCookie.extract(cookie) == cookie) { "Invalid session cookie" }
        val key = if (keyStore.containsAlias(ALIAS)) keyStore.getKey(ALIAS, null) as SecretKey else {
            KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
                init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(256)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .setUserAuthenticationRequired(false)
                    .build())
            }.generateKey()
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key) }
        cipher.updateAAD(server.origin.toByteArray(Charsets.UTF_8))
        val plaintext = cookie.toByteArray(Charsets.UTF_8)
        val ciphertext = try { cipher.doFinal(plaintext) } finally { plaintext.fill(0) }
        check(prefs.edit().clear()
            .putString("origin", server.origin)
            .putString("nonce", encoder.encodeToString(cipher.iv))
            .putString("ciphertext", encoder.encodeToString(ciphertext))
            .commit()) { "Unable to persist paired session" }
    }

    fun open(server: ServerAddress): String? = synchronized(lock) {
        if (!hasSession(server)) return@synchronized null
        try {
            val nonce = decoder.decode(requireNotNull(prefs.getString("nonce", null)))
            val ciphertext = decoder.decode(requireNotNull(prefs.getString("ciphertext", null)))
            require(nonce.size == 12 && ciphertext.size >= 16)
            val key = keyStore.getKey(ALIAS, null) as SecretKey
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, nonce))
            }
            cipher.updateAAD(server.origin.toByteArray(Charsets.UTF_8))
            val plaintext = cipher.doFinal(ciphertext)
            try {
                val cookie = plaintext.toString(Charsets.UTF_8)
                require(SessionCookie.extract(cookie) == cookie)
                cookie
            } finally { plaintext.fill(0) }
        } catch (_: Exception) {
            // Invalidated or damaged local state requires owner pairing again.
            runCatching { clear() }
            null
        }
    }

    fun hasSession(server: ServerAddress): Boolean = synchronized(lock) {
        runCatching {
            prefs.getString("origin", null) == server.origin && prefs.contains("nonce") &&
                prefs.contains("ciphertext") && keyStore.containsAlias(ALIAS)
        }.getOrDefault(false)
    }

    fun clear() = synchronized(lock) {
        val cleared = prefs.edit().clear().commit()
        if (keyStore.containsAlias(ALIAS)) keyStore.deleteEntry(ALIAS)
        check(cleared) { "Unable to clear paired session" }
    }

    private companion object {
        const val ALIAS = "amuse_paired_session_aes_v1"
        val lock = Any()
    }
}
