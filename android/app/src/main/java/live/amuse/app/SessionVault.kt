package live.amuse.app

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

/**
 * Persistent session copy: AES-GCM payload, with its random AES key wrapped by an
 * AndroidKeyStore RSA key. The private-key operation requires a fresh system
 * biometric/device-credential authentication and is executed via CryptoObject.
 * Android 10 deliberately uses no reusable vault: credential+crypto is API 30+.
 */
class SessionVault(context: Context) {
    private val prefs = context.getSharedPreferences("amuse_session_vault", Context.MODE_PRIVATE)
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val alias = "amuse_session_auth_v1"
    private val encoder = Base64.getEncoder()
    private val decoder = Base64.getDecoder()
    private val oaep = OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT)

    data class Pending(val cipher: Cipher, val wrapped: ByteArray, val iv: ByteArray, val payload: ByteArray, val origin: String)

    fun hasSession(server: ServerAddress): Boolean = prefs.getString("origin", null) == server.origin &&
        prefs.contains("payload") && Build.VERSION.SDK_INT >= 30 && keyStore.containsAlias(alias)

    /** Preserve a legacy configured origin without unsealing its biometric session. */
    fun configuredServer(): ServerAddress? = runCatching {
        val origin = prefs.getString("origin", null) ?: return@runCatching null
        ServerAddress.parse(origin).takeIf(::hasSession)
    }.getOrNull()

    @Synchronized
    fun store(server: ServerAddress, cookie: String) {
        check(Build.VERSION.SDK_INT >= 30)
        require(SessionCookie.extract(cookie) == cookie)
        if (!keyStore.containsAlias(alias)) {
            val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore")
            generator.initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(2048)
                .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
                .setUserAuthenticationRequired(true)
                .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
                .setInvalidatedByBiometricEnrollment(false)
                .build())
            generator.generateKeyPair()
        }
        // Exporting just the public key avoids requiring authentication to save a
        // newly issued cookie. The private key is never exported from Keystore.
        val publicKey = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(keyStore.getCertificate(alias).publicKey.encoded))
        val dataKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val aes = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, dataKey) }
        aes.updateAAD(server.origin.toByteArray(Charsets.UTF_8))
        val payload = aes.doFinal(cookie.toByteArray(Charsets.UTF_8))
        val rsa = Cipher.getInstance("RSA/ECB/OAEPPadding").apply { init(Cipher.ENCRYPT_MODE, publicKey, oaep) }
        val wrapped = rsa.doFinal(dataKey.encoded)
        check(prefs.edit()
            .putString("origin", server.origin)
            .putString("wrapped", encoder.encodeToString(wrapped))
            .putString("iv", encoder.encodeToString(aes.iv))
            .putString("payload", encoder.encodeToString(payload))
            .commit()) { "Unable to persist encrypted session" }
    }

    fun prepare(server: ServerAddress): Pending {
        check(hasSession(server))
        val privateKey = keyStore.getKey(alias, null) as PrivateKey
        val cipher = Cipher.getInstance("RSA/ECB/OAEPPadding").apply { init(Cipher.DECRYPT_MODE, privateKey, oaep) }
        return Pending(cipher,
            decoder.decode(requireNotNull(prefs.getString("wrapped", null))),
            decoder.decode(requireNotNull(prefs.getString("iv", null))),
            decoder.decode(requireNotNull(prefs.getString("payload", null))), server.origin)
    }

    fun open(pending: Pending, authenticatedCipher: Cipher, server: ServerAddress): String {
        check(server.origin == pending.origin)
        check(authenticatedCipher === pending.cipher) { "Authentication did not unlock this session operation" }
        val keyBytes = authenticatedCipher.doFinal(pending.wrapped)
        return try {
            val aes = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.DECRYPT_MODE, SecretKeySpec(keyBytes, "AES"), GCMParameterSpec(128, pending.iv))
            }
            aes.updateAAD(server.origin.toByteArray(Charsets.UTF_8))
            val cookie = aes.doFinal(pending.payload).toString(Charsets.UTF_8)
            require(SessionCookie.extract(cookie) == cookie)
            cookie
        } finally {
            keyBytes.fill(0)
        }
    }

    @Synchronized
    fun clear() {
        prefs.edit().clear().commit()
        if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
    }
}
