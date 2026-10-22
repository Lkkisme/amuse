param([switch]$SkipBuild, [switch]$ScreenPreview)
$ErrorActionPreference = 'Stop'
$amuseRoot = $PSScriptRoot
$amuseTools = Get-Content -LiteralPath (Join-Path $amuseRoot '.local\android-toolchain.json') -Raw | ConvertFrom-Json
$amuseSavedEnvironment = @{}
foreach ($amuseName in @('JAVA_HOME','ANDROID_HOME','ANDROID_SDK_ROOT','ANDROID_USER_HOME','GRADLE_USER_HOME','AMUSE_SIGN_STOREPASS')) {
    $amuseSavedEnvironment[$amuseName] = [Environment]::GetEnvironmentVariable($amuseName, 'Process')
}
try {
    $env:JAVA_HOME = $amuseTools.javaHome
    $env:ANDROID_HOME = $amuseTools.sdkRoot
    $env:ANDROID_SDK_ROOT = $amuseTools.sdkRoot
    $env:ANDROID_USER_HOME = $amuseTools.androidUserHome
    $env:GRADLE_USER_HOME = $amuseTools.gradleUserHome
    if (!$SkipBuild) {
        $amusePreviewValue = $ScreenPreview.IsPresent.ToString().ToLowerInvariant()
        & $amuseTools.gradle -p (Join-Path $amuseRoot 'android') --no-daemon --max-workers=1 "-Pamuse.screenPreview=$amusePreviewValue" :app:assembleRelease
        if ($LASTEXITCODE -ne 0) { throw 'Android release build failed.' }
    }
    $amuseUnsigned = Join-Path $amuseRoot 'android\app\build\outputs\apk\release\app-release-unsigned.apk'
    if (!(Test-Path -LiteralPath $amuseUnsigned)) { throw 'The unsigned Android release APK is missing.' }
    $amuseBuildConfig = Join-Path $amuseRoot 'android\app\build\generated\source\buildConfig\release\live\amuse\app\BuildConfig.java'
    if (!(Test-Path -LiteralPath $amuseBuildConfig)) { throw 'Android build metadata is missing. Rebuild before signing.' }
    $amuseIsPreview = [IO.File]::ReadAllText($amuseBuildConfig) -match 'SCREEN_PREVIEW\s*=\s*true'
    if ($amuseIsPreview -ne $ScreenPreview.IsPresent) { throw 'The APK preview mode does not match the signing request. Rebuild with the intended mode.' }
    $amuseArtifacts = Join-Path $amuseRoot $(if ($ScreenPreview) { '.local\verification\android-preview' } else { 'artifacts\android' })
    New-Item -ItemType Directory -Path $amuseArtifacts -Force | Out-Null
    $amuseAligned = Join-Path $amuseArtifacts 'amuse-aligned.apk'
    $amuseApk = Join-Path $amuseArtifacts 'Amuse.apk'
    $amuseBuildTools = Join-Path $amuseTools.sdkRoot 'build-tools\35.0.0'
    & (Join-Path $amuseBuildTools 'zipalign.exe') -P 16 -f 4 $amuseUnsigned $amuseAligned
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
    $env:AMUSE_SIGN_STOREPASS = [IO.File]::ReadAllText((Join-Path $amuseRoot '.local\signing\storepass.txt'))
    & (Join-Path $amuseBuildTools 'apksigner.bat') sign --ks (Join-Path $amuseRoot '.local\signing\amuse-personal.jks') --ks-key-alias amuse-personal --ks-pass env:AMUSE_SIGN_STOREPASS --out $amuseApk $amuseAligned
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed.' }
    & (Join-Path $amuseBuildTools 'apksigner.bat') verify --verbose $amuseApk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    $amuseSha256 = (Get-FileHash -LiteralPath $amuseApk -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $amuseArtifacts 'Amuse.apk.sha256'), "$amuseSha256  Amuse.apk`n")
    if (!$ScreenPreview) {
        $amuseDownloads = Join-Path $amuseRoot 'web\dist\downloads'
        New-Item -ItemType Directory -Path $amuseDownloads -Force | Out-Null
        Copy-Item -LiteralPath $amuseApk -Destination (Join-Path $amuseDownloads 'amuse.apk') -Force
    }
    Write-Output ('Signed APK: ' + $amuseApk)
    Write-Output ('SHA256: ' + $amuseSha256)
}
finally {
    foreach ($amuseName in $amuseSavedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($amuseName, $amuseSavedEnvironment[$amuseName], 'Process')
    }
}
