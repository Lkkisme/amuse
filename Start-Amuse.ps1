param([switch]$Foreground)
$ErrorActionPreference = 'Stop'
$amuseRoot = $PSScriptRoot
$amuseLocal = Join-Path $amuseRoot '.local'
$amuseRuntime = Get-Content -LiteralPath (Join-Path $amuseLocal 'runtime.json') -Raw | ConvertFrom-Json
$amusePidFile = Join-Path $amuseLocal 'process.json'
if (Test-Path -LiteralPath $amusePidFile) {
    $amuseSaved = Get-Content -LiteralPath $amusePidFile -Raw | ConvertFrom-Json
    $amuseExisting = Get-CimInstance Win32_Process -Filter "ProcessId = $($amuseSaved.pid)" -ErrorAction SilentlyContinue
    if ($amuseExisting -and $amuseExisting.ExecutablePath -eq $amuseRuntime.node -and $amuseExisting.CommandLine.Contains($amuseRoot)) {
        Write-Output 'Amuse is already running: http://127.0.0.1:8081'
        exit 0
    }
}
$amuseListener = Get-NetTCPConnection -State Listen -LocalPort 8081 -ErrorAction SilentlyContinue
if ($amuseListener) { throw 'Port 8081 is already occupied. No process was stopped.' }
$env:AMUSE_HOST = '127.0.0.1'
$env:AMUSE_PORT = '8081'
$amuseNetworkFile = Join-Path $amuseLocal 'network.json'
$env:AMUSE_PUBLIC_URL = if (Test-Path -LiteralPath $amuseNetworkFile) {
    (Get-Content -LiteralPath $amuseNetworkFile -Raw | ConvertFrom-Json).publicUrl
} else { 'http://127.0.0.1:8081' }
$env:AMUSE_JOURNAL = Join-Path $amuseLocal 'data\events.jsonl'
$env:AMUSE_WEB = Join-Path $amuseRoot 'web\dist'
$env:AMUSE_PI_MODELS = Join-Path $amuseLocal 'pi-models.json'
$env:AMUSE_SYSTEM_PROMPT = Join-Path $amuseLocal 'system-prompt.md'
$env:AMUSE_DESKTOP_CONFIG = Join-Path $amuseLocal 'desktop.json'
$env:AMUSE_BACKEND = 'paseo'
$env:AMUSE_PASEO_CONFIG = Join-Path $amuseLocal 'paseo.json'
$env:AMUSE_NATIVE_BROWSER_CONFIG = Join-Path $amuseLocal 'native-browser.json'
if (-not (Test-Path -LiteralPath $env:AMUSE_PASEO_CONFIG)) { throw 'Missing local Paseo connection configuration.' }
if (-not (Test-Path -LiteralPath $env:AMUSE_NATIVE_BROWSER_CONFIG)) { throw 'Missing native browser configuration.' }
$env:AMUSE_PI_MODEL = 'swift-local/sc117-swift-1.5-qwen3.8-flash-next-iq3_xxs'
$env:AMUSE_PI_BROWSER_MODEL = $env:AMUSE_PI_MODEL
$env:SWIFT_LOCAL_API_KEY = 'local-strata'
$env:AMUSE_PI_THINKING = 'medium'
$env:AMUSE_PI_OMIT_OUTPUT_LIMIT = '1'
if ($Foreground) {
    & $amuseRuntime.node (Join-Path $amuseRoot 'api\src\main.ts')
    exit $LASTEXITCODE
}
$amuseLogs = Join-Path $amuseLocal 'logs'
$amuseProcess = Start-Process -FilePath $amuseRuntime.node -ArgumentList ('"' + (Join-Path $amuseRoot 'api\src\main.ts') + '"') -WorkingDirectory $amuseRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $amuseLogs 'stdout.log') -RedirectStandardError (Join-Path $amuseLogs 'stderr.log') -PassThru
@{ pid = $amuseProcess.Id; node = $amuseRuntime.node; started = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $amusePidFile -Encoding utf8
Write-Output 'Amuse started: http://127.0.0.1:8081'
Write-Output ('Logs: ' + $amuseLogs)
