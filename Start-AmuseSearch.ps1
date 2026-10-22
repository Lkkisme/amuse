[CmdletBinding()]
param(
    [string]$StateDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'Amuse-services/search'),
    [string]$DockerExe = 'docker.exe',
    [string]$DockerHost = '',
    [switch]$Start
)
$ErrorActionPreference = 'Stop'
$state = [IO.Path]::GetFullPath($StateDirectory)
$configDir = Join-Path $state 'config'
$cacheDir = Join-Path $state 'cache'
$logsDir = Join-Path $state 'logs'
foreach ($directory in @($state, $configDir, $cacheDir, $logsDir)) {
    [IO.Directory]::CreateDirectory($directory) | Out-Null
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
$settingsPath = Join-Path $configDir 'settings.yml'
if (-not (Test-Path -LiteralPath $settingsPath)) {
    $random = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($random) } finally { $rng.Dispose() }
    $secret = [BitConverter]::ToString($random).Replace('-', '').ToLowerInvariant()
    $settings = @"
use_default_settings:
  engines:
    keep_only:
      - google
      - bing
      - duckduckgo
      - brave
      - baidu
general:
  debug: false
  instance_name: Amuse local search
search:
  formats:
    - html
    - json
  default_lang: all
  autocomplete: ''
server:
  secret_key: '$secret'
  limiter: false
  public_instance: false
  image_proxy: false
outgoing:
  request_timeout: 8.0
engines:
  - name: google
    disabled: false
  - name: bing
    disabled: false
  - name: duckduckgo
    disabled: false
  - name: brave
    disabled: false
  - name: baidu
    disabled: false
"@
    [IO.File]::WriteAllText($settingsPath, $settings, $utf8)
}
$candidate = [ordered]@{ provider = 'searxng'; url = 'http://127.0.0.1:8889'; language = 'all'; maxResults = 8; timeoutMs = 20000 }
$candidatePath = Join-Path $state 'local-search.json'
if (-not (Test-Path -LiteralPath $candidatePath)) {
    [IO.File]::WriteAllText($candidatePath, ($candidate | ConvertTo-Json), $utf8)
}
if (-not $Start) {
    [pscustomobject]@{ prepared = $true; started = $false; state = $state; config = $candidatePath } | ConvertTo-Json
    return
}
$docker = (Get-Command $DockerExe -ErrorAction Stop).Source
$compose = Join-Path $PSScriptRoot 'compose.search.yaml'
if (-not (Test-Path -LiteralPath $compose)) { throw "Missing compose.search.yaml beside this script." }
function Invoke-SearchDocker {
    param([string[]]$DockerArguments, [int]$TimeoutSeconds = 45)
    $id = [guid]::NewGuid().ToString('N')
    $out = Join-Path $logsDir "$id.out.log"
    $err = Join-Path $logsDir "$id.err.log"
    $argsForDocker = @()
    if ($DockerHost) { $argsForDocker += @('--host', $DockerHost) }
    $argsForDocker += $DockerArguments
    # Windows CreateProcess quoting: paths may contain spaces, trailing slashes or quotes.
    $quoted = foreach ($argument in $argsForDocker) {
        '"' + [regex]::Replace([regex]::Replace($argument, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
    }
    $process = Start-Process -FilePath $docker -ArgumentList $quoted -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        # This is only the CLI process created here; never kill Docker or another container.
        Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
        throw "Docker command timed out; the existing daemon and containers were left running. Logs: $err"
    }
    $process.Refresh()
    if ($process.ExitCode -ne 0) { throw "Docker command failed ($($process.ExitCode)); inspect $err" }
    if (Test-Path -LiteralPath $out) { Get-Content -LiteralPath $out -Raw }
}
$previousState = [Environment]::GetEnvironmentVariable('AMUSE_SEARCH_STATE', 'Process')
try {
    $env:AMUSE_SEARCH_STATE = $state.Replace('\', '/')
    Invoke-SearchDocker -DockerArguments @('version', '--format', '{{.Server.Version}}') | Out-Null
    # Do not claim or replace a container owned by another project.
    $names = Invoke-SearchDocker -DockerArguments @('ps', '-a', '--format', '{{.Names}}')
    if (($names -split '\r?\n') -contains 'amuse-local-search') {
        $owner = (Invoke-SearchDocker -DockerArguments @('inspect', 'amuse-local-search', '--format', '{{index .Config.Labels "com.docker.compose.project"}}')).Trim()
        if ($owner -ne 'amuse-search') { throw 'amuse-local-search exists but is not owned by the amuse-search Compose project.' }
    }
    Invoke-SearchDocker -DockerArguments @('compose', '-f', $compose, 'config', '--quiet') | Out-Null
    Invoke-SearchDocker -DockerArguments @('compose', '-f', $compose, 'pull', 'search') -TimeoutSeconds 240 | Out-Null
    Invoke-SearchDocker -DockerArguments @('compose', '-f', $compose, 'up', '-d', '--no-deps', 'search') -TimeoutSeconds 90 | Out-Null
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8889/healthz' -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 1000
    }
    if (-not $ready) { throw 'Local search did not become healthy. Existing Amuse/Qwen processes were not restarted.' }
    [pscustomobject]@{ prepared = $true; started = $true; health = 'ok'; state = $state; config = $candidatePath; note = 'Health is not search acceptance: run a real Chinese search before activating the candidate config.' } | ConvertTo-Json
} finally {
    [Environment]::SetEnvironmentVariable('AMUSE_SEARCH_STATE', $previousState, 'Process')
}
