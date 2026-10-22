param([string]$Root = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$sandboxSettings = Join-Path $Root '.local\sandbox.json'
if (-not (Test-Path -LiteralPath $sandboxSettings)) { return }
$sandboxConfig = Get-Content -LiteralPath $sandboxSettings -Raw | ConvertFrom-Json
if (-not $sandboxConfig.docker) { throw 'The sandbox configuration needs its Docker executable path.' }
$sandboxDocker = $sandboxConfig.docker
& $sandboxDocker info --format '{{.ServerVersion}}' *> $null
if ($LASTEXITCODE -ne 0) {
    if (-not $sandboxConfig.desktop) { throw 'Docker is not running; start Docker Desktop before Amuse.' }
    Start-Process -FilePath $sandboxConfig.desktop -WindowStyle Hidden | Out-Null
    $sandboxDeadline = (Get-Date).AddSeconds(90)
    do {
        Start-Sleep -Seconds 2
        & $sandboxDocker info --format '{{.ServerVersion}}' *> $null
        if ($LASTEXITCODE -eq 0) { break }
    } while ((Get-Date) -lt $sandboxDeadline)
    if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not ready; Amuse has not been restarted.' }
}
$sandboxWorkspace = Join-Path $Root '.local\data\workspace'
foreach ($sandboxFolder in @('', 'memory', 'user', 'skills')) {
    New-Item -ItemType Directory -Path (Join-Path $sandboxWorkspace $sandboxFolder) -Force | Out-Null
}
$sandboxPreviousWorkspace = $env:AMUSE_WORKSPACE
$sandboxPreviousSubnet = $env:AMUSE_SANDBOX_SUBNET
try {
    $env:AMUSE_WORKSPACE = $sandboxWorkspace
    $env:AMUSE_SANDBOX_SUBNET = $sandboxConfig.subnet
    & $sandboxDocker compose -f (Join-Path $Root 'compose.sandbox.windows.yaml') up -d --wait --wait-timeout 60
    if ($LASTEXITCODE -ne 0) { throw 'The Amuse sandbox did not become ready.' }
}
finally {
    $env:AMUSE_WORKSPACE = $sandboxPreviousWorkspace
    $env:AMUSE_SANDBOX_SUBNET = $sandboxPreviousSubnet
}
