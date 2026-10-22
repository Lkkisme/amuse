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

function Start-AmuseSandboxBackend {
    param([string]$Executable, [string]$WorkingDirectory, [string]$LogDirectory, [hashtable]$Environment = @{})
    New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $outputPath = Join-Path $LogDirectory ('docker-backend-' + $stamp + '.stdout.log')
    $errorPath = Join-Path $LogDirectory ('docker-backend-' + $stamp + '.stderr.log')
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $Executable
    $start.WorkingDirectory = $WorkingDirectory
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    # An optional profile bridge is confined to this child; the scheduler host's
    # environment and the machine/user environment remain unchanged.
    foreach ($name in $Environment.Keys) {
        if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$' -or ([string]$Environment[$name]).Contains([char]0)) { throw 'Invalid Docker backend environment entry.' }
        $start.EnvironmentVariables[$name] = [string]$Environment[$name]
    }
    $backend = New-Object System.Diagnostics.Process
    $backend.StartInfo = $start
    $output = $null
    $errors = $null
    try {
        $output = [System.IO.FileStream]::new($outputPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read, 1, $true)
        $errors = [System.IO.FileStream]::new($errorPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read, 1, $true)
        if (-not $backend.Start()) { throw 'The configured Docker backend could not be started.' }
        # Native async copies need no PowerShell callbacks/runspace. The owner
        # host retains this object so pipes remain drained for the daemon life.
        [pscustomobject]@{
            Process = $backend
            Output = $output
            Errors = $errors
            OutputCopy = $backend.StandardOutput.BaseStream.CopyToAsync($output)
            ErrorCopy = $backend.StandardError.BaseStream.CopyToAsync($errors)
            OutputPath = $outputPath
            ErrorPath = $errorPath
        }
    } catch {
        if ($output) { $output.Dispose() }
        if ($errors) { $errors.Dispose() }
        $backend.Dispose()
        throw
    }
}

$sandboxSettings = Join-Path $Root '.local\sandbox.json'
if (-not (Test-Path -LiteralPath $sandboxSettings)) { return }
$sandboxConfig = Get-Content -LiteralPath $sandboxSettings -Raw | ConvertFrom-Json
if (-not $sandboxConfig.docker) { throw 'The sandbox configuration needs its Docker executable path.' }
$sandboxDocker = $sandboxConfig.docker
$sandboxInfo = Invoke-AmuseSandboxDocker -Executable $sandboxDocker -Arguments @('info', '--format', '{{.ServerVersion}}')
if ($sandboxInfo.ExitCode -ne 0) {
    if ($sandboxConfig.backend) {
        # Installations with missing registration or an explicit owner launcher
        # can use an owner-configured official backend, hosted by the same
        # persistent, non-elevated scheduler action. Normal installs keep the GUI.
        $sandboxBackend = [string]$sandboxConfig.backend
        if (-not [System.IO.Path]::IsPathRooted($sandboxBackend) -or ([System.IO.Path]::GetPathRoot($sandboxBackend)).Length -lt 3) {
            throw 'The optional Docker backend path must be absolute.'
        }
        if (-not (Test-Path -LiteralPath $sandboxBackend -PathType Leaf)) { throw 'The configured Docker backend executable does not exist.' }
        $sandboxBackendEnvironment = @{}
        if ($sandboxConfig.backendEnvironment) { foreach ($entry in $sandboxConfig.backendEnvironment.PSObject.Properties) { $sandboxBackendEnvironment[$entry.Name] = [string]$entry.Value } }
        $sandboxBackendLifetime = Start-AmuseSandboxBackend -Executable $sandboxBackend -WorkingDirectory (Split-Path -Parent $sandboxBackend) -LogDirectory (Join-Path $Root '.local\logs') -Environment $sandboxBackendEnvironment
        if (-not (Get-Variable -Name AmuseSandboxBackendLifetimes -Scope Global -ErrorAction SilentlyContinue)) { $global:AmuseSandboxBackendLifetimes = @() }
        $global:AmuseSandboxBackendLifetimes += $sandboxBackendLifetime
        Write-Output ('Started the configured Docker backend (PID ' + $sandboxBackendLifetime.Process.Id + ').')
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
