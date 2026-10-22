param([string]$Root = $PSScriptRoot)
$ErrorActionPreference = 'Stop'

function Invoke-AmuseSandboxDocker {
    param([string]$Executable, [string[]]$Arguments)
    # Windows PowerShell 5 turns a native stderr record into a terminating
    # NativeCommandError under ErrorActionPreference=Stop. Docker legitimately
    # writes progress (and the unavailable-daemon message) to that stream.
    # Run it without a shell, drain both pipes concurrently, then use ExitCode.
    $sandboxStart = New-Object System.Diagnostics.ProcessStartInfo
    $sandboxStart.FileName = $Executable
    $sandboxStart.UseShellExecute = $false
    $sandboxStart.CreateNoWindow = $true
    $sandboxStart.RedirectStandardOutput = $true
    $sandboxStart.RedirectStandardError = $true
    $sandboxStart.Arguments = (($Arguments | ForEach-Object {
        if ($_.Contains([char]0)) { throw 'Docker arguments cannot contain NUL.' }
        '"' + [regex]::Replace([regex]::Replace($_, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
    }) -join ' ')
    $sandboxProcess = New-Object System.Diagnostics.Process
    $sandboxProcess.StartInfo = $sandboxStart
    try {
        if (-not $sandboxProcess.Start()) { throw 'The Docker process could not be started.' }
        $sandboxOutput = $sandboxProcess.StandardOutput.ReadToEndAsync()
        $sandboxError = $sandboxProcess.StandardError.ReadToEndAsync()
        $sandboxProcess.WaitForExit()
        [pscustomobject]@{
            ExitCode = $sandboxProcess.ExitCode
            StandardOutput = $sandboxOutput.GetAwaiter().GetResult()
            StandardError = $sandboxError.GetAwaiter().GetResult()
        }
    } finally { $sandboxProcess.Dispose() }
}

$sandboxSettings = Join-Path $Root '.local\sandbox.json'
if (-not (Test-Path -LiteralPath $sandboxSettings)) { return }
$sandboxConfig = Get-Content -LiteralPath $sandboxSettings -Raw | ConvertFrom-Json
if (-not $sandboxConfig.docker) { throw 'The sandbox configuration needs its Docker executable path.' }
$sandboxDocker = $sandboxConfig.docker
$sandboxInfo = Invoke-AmuseSandboxDocker -Executable $sandboxDocker -Arguments @('info', '--format', '{{.ServerVersion}}')
if ($sandboxInfo.ExitCode -ne 0) {
    if ($sandboxConfig.backend) {
        # Portable Docker Desktop installations have no registered InstallLocation
        # for the GUI launcher. An explicit owner-configured official backend can
        # be hosted by the same persistent, non-elevated scheduler action instead.
        $sandboxBackend = [string]$sandboxConfig.backend
        if (-not [System.IO.Path]::IsPathRooted($sandboxBackend) -or ([System.IO.Path]::GetPathRoot($sandboxBackend)).Length -lt 3) {
            throw 'The optional Docker backend path must be absolute.'
        }
        if (-not (Test-Path -LiteralPath $sandboxBackend -PathType Leaf)) { throw 'The configured Docker backend executable does not exist.' }
        $sandboxLogs = Join-Path $Root '.local\logs'
        New-Item -ItemType Directory -Path $sandboxLogs -Force | Out-Null
        $sandboxLaunchStamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
        $sandboxBackendProcess = Start-Process -FilePath $sandboxBackend -WorkingDirectory (Split-Path -Parent $sandboxBackend) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $sandboxLogs ('docker-backend-' + $sandboxLaunchStamp + '.stdout.log')) -RedirectStandardError (Join-Path $sandboxLogs ('docker-backend-' + $sandboxLaunchStamp + '.stderr.log')) -PassThru
        Write-Output ('Started the configured Docker backend (PID ' + $sandboxBackendProcess.Id + ').')
    } else {
        if (-not $sandboxConfig.desktop) { throw 'Docker is not running; start Docker Desktop before Amuse.' }
        Start-Process -FilePath $sandboxConfig.desktop -WindowStyle Hidden | Out-Null
    }
    $sandboxDeadline = (Get-Date).AddSeconds(90)
    do {
        Start-Sleep -Seconds 2
        $sandboxInfo = Invoke-AmuseSandboxDocker -Executable $sandboxDocker -Arguments @('info', '--format', '{{.ServerVersion}}')
        if ($sandboxInfo.ExitCode -eq 0) { break }
    } while ((Get-Date) -lt $sandboxDeadline)
    if ($sandboxInfo.ExitCode -ne 0) { throw 'Docker Desktop is not ready; Amuse has not been restarted.' }
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
    $sandboxUp = Invoke-AmuseSandboxDocker -Executable $sandboxDocker -Arguments @('compose', '-f', (Join-Path $Root 'compose.sandbox.windows.yaml'), 'up', '-d', '--wait', '--wait-timeout', '60')
    if ($sandboxUp.StandardOutput) { Write-Output $sandboxUp.StandardOutput.TrimEnd() }
    if ($sandboxUp.StandardError) { Write-Output $sandboxUp.StandardError.TrimEnd() }
    if ($sandboxUp.ExitCode -ne 0) { throw 'The Amuse sandbox did not become ready.' }
}
finally {
    $env:AMUSE_WORKSPACE = $sandboxPreviousWorkspace
    $env:AMUSE_SANDBOX_SUBNET = $sandboxPreviousSubnet
}
