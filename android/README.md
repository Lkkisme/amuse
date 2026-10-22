# Amuse for Android

The Android application opens the existing Amuse web interface at
`https://lkk.tail988ed4.ts.net:8443`. It uses the same server, chat history,
files, settings and live updates as the desktop web client. The phone must be
able to reach that server, normally through the same Tailscale network.
The native connection settings accept a different HTTPS origin if needed.
Version 0.1.2 restores an owner-paired device session directly into chat, without
a password, PIN or biometric prompt. Unpaired devices start at the server PIN
page with local biometric unlock disabled by default. The user may enable it in Connection & Security. Native
surfaces start with the web light palette and follow the page's selected theme.
The optional noVNC viewer is loaded on demand so a hanging video-codec probe
cannot block sign-in or chat startup.

## Sign-in and local unlock

- Owner-authorized ADB pairing provisions a revocable opaque server session through
  the explicit `UsbPairingReceiver`, protected by the sender's `DUMP` permission.
  It cannot change the configured HTTPS origin. Pairing data is encrypted with an
  independent AndroidKeyStore AES-GCM key, origin-bound, without user authentication.
  Normal apps do not hold `DUMP`; system/privileged or explicitly ADB-granted apps
  may hold it. The pairing capability is not a public HTTP/RPC endpoint.
- Clearing local login removes the paired key and encrypted session. Changing the
  server credential revokes all server sessions, including paired devices.

- The four-digit server PIN is entered in the server's web interface. Native
  code never receives or stores the PIN, and never receives fingerprint data.
- On Android 11+, a reusable server session is sealed with AES-GCM. Its random
  encryption key is wrapped using an AndroidKeyStore RSA public key. Opening it
  requires a fresh system biometric/device-credential authentication through
  `BiometricPrompt.CryptoObject` and the matching non-exportable private key.
- The WebView exists only after unlocking. It receives a session-only cookie
  with `Secure`, `HttpOnly` and `SameSite=Strict`. Leaving the app destroys the
  page and removes its cookies; startup also removes cookies from an interrupted
  process before any page is loaded. Screenshots, recordings and recent-app
  previews are allowed at the owner's request (version 0.1.3+).
- File selection uses Android's document picker without storage/camera
  permissions. The page is paused behind the native lock screen while selecting;
  selected URIs are withheld until the user verifies their device identity when
  local biometric unlock is enabled. PIN-only and paired modes resume without that gate.
  The in-memory page is then resumed to finish the upload. A secure device lock
  is required for this flow. Choosing server-PIN sign-in instead cancels that
  upload and starts a fresh page.
- Android 10 supports the system unlock prompt but intentionally does not keep
  a reusable biometric session. Unpaired devices require server-PIN sign-in on
  reopening; owner-paired sessions use the independent AES vault on API 29+.
- Unpaired devices without a secure device lock, or with local unlock disabled,
  do not keep a reusable biometric session and require the server PIN on reopening.
- Clearing the phone's saved login removes its local key and session only;
  the server still retains its chats. The server can independently expire or
  revoke any session, in which case the web client asks for the PIN again.

The encrypted vault is separate from WebView's active cookie memory. This is a
local app lock, not fingerprint authentication to the server. Device-specific
biometric/Keystore behavior still requires testing on the user's own handset.

## Web and file boundaries

WebView keeps top-level navigation on the configured HTTPS origin. HTTP(S)
external links open in the phone's browser. File/content URL access, universal
file URL access, mixed content, third-party cookies and WebView debugging are
disabled. TLS certificate errors are rejected without a bypass. No JavaScript
native bridge or camera, broad-storage or notification permission is installed.

Version 0.1.4 supports the upstream Voice button: only the configured HTTPS
origin can request audio capture. Each request first asks for native confirmation,
then Android's `RECORD_AUDIO` permission if needed. The requesting WebView is kept
only across that system permission dialog; the grant is checked again on return
against the current foreground page and origin. Navigation, locking, backgrounding,
cancellation and renderer disposal reject pending requests. Camera, mixed-resource,
unknown-resource and off-origin requests are denied. The voice transcription
provider is still configured on the Amuse server. Paired automatic sign-in,
disabled-by-default biometric locking, screenshots and the existing signing key
are unchanged.

User-requested downloads use normal platform TLS validation and explicitly check
every redirect before sending the session cookie. Only the original origin is
accepted. Files are saved through MediaStore to `Downloads/Amuse`; failed writes
are removed. The app does not forward an authenticated download to an unchecked
external origin.

## Build

Versions: JDK 17, Gradle 8.9, AGP 8.7.3, Kotlin 2.0.21, Android SDK platform 35.
The application supports Android 10 / API 29 and later. The local build uses one
Gradle worker, a 768 MiB Java heap and an in-process Kotlin compiler. It does not
need an emulator or a connected phone.

Set `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `ANDROID_USER_HOME` and
`GRADLE_USER_HOME` to the installed toolchain directories, then run from this
directory:

```powershell
& 'D:\LocalAI\Android-Toolchain\gradle-8.9\bin\gradle.bat' --no-daemon --max-workers=1 assembleDebug testDebugUnitTest assembleRelease
```

The outputs are:

- `app/build/outputs/apk/debug/app-debug.apk` (debug-signed)
- `app/build/outputs/apk/release/app-release-unsigned.apk` (requires release signing)
- `app/build/reports/tests/testDebugUnitTest/index.html` (URL/cookie-boundary tests)

The repository's `Build-Android.ps1` performs the personal release build,
alignment, signing and signature verification with the locally configured
private signing key. Keep `.local/signing` outside version control and retain
the same key for subsequent APK updates.
For explicitly authorized USB visual debugging, `-ScreenPreview` creates a
separate diagnostic build under `.local/verification/android-preview`;
it never replaces the normal downloadable APK. All builds allow screenshots.

Official implementation references:
[Biometric authentication](https://developer.android.com/identity/sign-in/biometric-auth),
[WebView](https://developer.android.com/develop/ui/views/layout/webapps/webview),
[CookieManager](https://developer.android.com/reference/android/webkit/CookieManager).
