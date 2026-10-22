param([switch]$Foreground, [switch]$Service)
$ErrorActionPreference = 'Stop'
if ($Foreground -and $Service) { throw 'Choose either foreground or the internal service host.' }
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

# A terminal tool may be inside a kill-on-close Windows job. A normal detached
# Start-Process still inherits that job and can disappear when the tool/app exits.
# Task Scheduler owns this one on-demand, current-user, non-elevated host instead.
# No trigger, password, automatic restart, or system-wide policy change is needed.
$amuseHash = [System.Security.Cryptography.SHA256]::Create()
try {
    $amuseIdentity = [System.BitConverter]::ToString($amuseHash.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($amuseRoot.ToUpperInvariant()))).Replace('-', '').Substring(0, 16).ToLowerInvariant()
} finally { $amuseHash.Dispose() }
$amuseTaskName = 'Amuse-Owner-' + $amuseIdentity
$amuseLogs = Join-Path $amuseLocal 'logs'
New-Item -ItemType Directory -Path $amuseLogs -Force | Out-Null
if (-not $Foreground -and -not $Service) {
    $amusePowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $amuseArguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $amuseRoot 'Start-Amuse.ps1') + '" -Service'
    $amuseDescription = 'Amuse owner runtime: ' + $amuseRoot
    $amuseWindowsIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $amuseCurrentUser = $amuseWindowsIdentity.Name
    $amuseCurrentSid = $amuseWindowsIdentity.User.Value
    $amusePriorTask = Get-ScheduledTask -TaskPath '\' -TaskName $amuseTaskName -ErrorAction SilentlyContinue
    if ($amusePriorTask) {
        # Get-ScheduledTask may shorten a local account to a display name that
        # cannot be translated unambiguously. The registered XML retains SID.
        [xml]$amusePriorXml = Export-ScheduledTask -TaskPath '\' -TaskName $amuseTaskName
        $amusePriorUser = $amusePriorXml.Task.Principals.Principal.UserId
        if ($amusePriorUser -notmatch '^S-\d-') {
            try { $amusePriorUser = ([System.Security.Principal.NTAccount]::new($amusePriorUser)).Translate([System.Security.Principal.SecurityIdentifier]).Value }
            catch { throw ('Cannot verify the owner of task ' + $amuseTaskName + '. No task was changed.') }
        }
        if ($amusePriorTask.Description -ne $amuseDescription -or $amusePriorTask.Actions.Count -ne 1 -or $amusePriorTask.Actions[0].Execute -ne $amusePowerShell -or $amusePriorTask.Actions[0].Arguments -ne $amuseArguments -or $amusePriorUser -ne $amuseCurrentSid) {
            throw ('Task name is already occupied by another definition: ' + $amuseTaskName + '. No task was changed.')
        }
        if ($amusePriorTask.State -eq 'Running') { throw 'The Amuse service host is already starting. Check its logs; no second host was started.' }
    }
    $amuseAction = New-ScheduledTaskAction -Execute $amusePowerShell -Argument $amuseArguments -WorkingDirectory $amuseRoot
    $amusePrincipal = New-ScheduledTaskPrincipal -UserId $amuseCurrentUser -LogonType Interactive -RunLevel Limited
    $amuseSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
    $amuseTask = New-ScheduledTask -Action $amuseAction -Principal $amusePrincipal -Settings $amuseSettings -Description $amuseDescription
    # Register only our root-derived name. Access denied is an error; never retry
    # with another account, stored credentials, or a higher run level.
    Register-ScheduledTask -TaskPath '\' -TaskName $amuseTaskName -InputObject $amuseTask -Force -ErrorAction Stop | Out-Null
    Start-ScheduledTask -TaskPath '\' -TaskName $amuseTaskName -ErrorAction Stop
    $amuseDeadline = (Get-Date).AddSeconds(90)
    do {
        Start-Sleep -Milliseconds 500
        if (Test-Path -LiteralPath $amusePidFile) {
            $amuseStarted = Get-Content -LiteralPath $amusePidFile -Raw | ConvertFrom-Json
            $amuseRunning = Get-CimInstance Win32_Process -Filter "ProcessId = $($amuseStarted.pid)" -ErrorAction SilentlyContinue
            $amuseReady = Get-NetTCPConnection -State Listen -LocalPort 8081 -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $amuseStarted.pid }
            if ($amuseRunning -and $amuseRunning.ExecutablePath -eq $amuseRuntime.node -and $amuseRunning.CommandLine.Contains($amuseRoot) -and $amuseReady) {
                Write-Output 'Amuse started: http://127.0.0.1:8081'
                Write-Output ('Logs: ' + $amuseLogs)
                exit 0
            }
        }
        $amuseHostState = Get-ScheduledTask -TaskPath '\' -TaskName $amuseTaskName
        if ($amuseHostState.State -ne 'Running') { throw ('The Amuse service host stopped before the API was ready. Check ' + (Join-Path $amuseLogs 'service-error.log')) }
    } while ((Get-Date) -lt $amuseDeadline)
    throw ('Amuse has not opened port 8081 within 90 seconds. The host was left running; check ' + $amuseLogs)
}

try {
& (Join-Path $amuseRoot 'Start-AmuseSandbox.ps1') -Root $amuseRoot
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
$amuseSandboxFile = Join-Path $amuseLocal 'sandbox.json'
if (Test-Path -LiteralPath $amuseSandboxFile) {
    $amuseSandbox = Get-Content -LiteralPath $amuseSandboxFile -Raw | ConvertFrom-Json
    $env:AMUSE_SANDBOX_URL = $amuseSandbox.url
    $env:AMUSE_SANDBOX_SUBNET = $amuseSandbox.subnet
}
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
$amuseProcess = Start-Process -FilePath $amuseRuntime.node -ArgumentList ('"' + (Join-Path $amuseRoot 'api\src\main.ts') + '"') -WorkingDirectory $amuseRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $amuseLogs 'stdout.log') -RedirectStandardError (Join-Path $amuseLogs 'stderr.log') -PassThru
$amusePidTemp = $amusePidFile + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
try {
    @{ pid = $amuseProcess.Id; node = $amuseRuntime.node; started = (Get-Date).ToUniversalTime().ToString('o'); hostPid = $PID; taskName = $amuseTaskName; launcher = 'scheduled-task' } | ConvertTo-Json | Set-Content -LiteralPath $amusePidTemp -Encoding utf8
    if (Test-Path -LiteralPath $amusePidFile) { [System.IO.File]::Replace($amusePidTemp, $amusePidFile, [NullString]::Value) }
    else { [System.IO.File]::Move($amusePidTemp, $amusePidFile) }
} catch {
    # A child without a recorded identity could not be stopped safely later.
    # Terminate only the process object we just created if recording fails.
    if (-not $amuseProcess.HasExited) { $amuseProcess.Kill() }
    throw
} finally {
    if (Test-Path -LiteralPath $amusePidTemp) { Remove-Item -LiteralPath $amusePidTemp }
}
# Keep the scheduler action alive for exactly this Node process. Stop-Amuse
# terminates the verified Node tree; this host then exits without restarting it.
$amuseProcess.WaitForExit()
exit $amuseProcess.ExitCode
} catch {
    if ($Service) {
        ((Get-Date).ToUniversalTime().ToString('o') + ' ' + $_.Exception.Message) | Add-Content -LiteralPath (Join-Path $amuseLogs 'service-error.log') -Encoding utf8
    }
    throw
}
