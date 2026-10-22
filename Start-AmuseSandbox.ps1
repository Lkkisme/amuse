param([string]$Root = $PSScriptRoot)
$ErrorActionPreference = 'Stop'

function Invoke-AmuseSandboxDocker {
    param([string]$Executable, [string[]]$Arguments, [int]$TimeoutSeconds = 10)
    if ($TimeoutSeconds -lt 1 -or $TimeoutSeconds -gt 120) { throw 'Docker CLI timeout must be between 1 and 120 seconds.' }
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
        if (-not $sandboxProcess.WaitForExit($TimeoutSeconds * 1000)) {
            # This is only the CLI we created, not the daemon or its tree. A
            # timed-out info request does not prove that no backend is running.
            $sandboxProcess.Kill()
            $sandboxProcess.WaitForExit()
            throw [TimeoutException]::new('Docker CLI timed out; no replacement backend was started.')
        }
        [pscustomobject]@{
            ExitCode = $sandboxProcess.ExitCode
            StandardOutput = $sandboxOutput.GetAwaiter().GetResult()
            StandardError = $sandboxError.GetAwaiter().GetResult()
        }
    } finally { $sandboxProcess.Dispose() }
}

function Test-AmuseSandboxReady {
    param([string]$Address)
    $base = $null
    if (-not [Uri]::TryCreate($Address, [UriKind]::Absolute, [ref]$base) -or $base.Scheme -notin @('http', 'https') -or $base.UserInfo -or $base.Query -or $base.Fragment -or $base.AbsolutePath -ne '/') { throw 'The sandbox URL must be an absolute loopback HTTP(S) origin.' }
    $ip = $null
    $hostName = $base.DnsSafeHost.Trim('[', ']')
    if ($hostName -eq 'localhost') {
        # Do not let a DNS/hosts override turn an owner-only readiness command
        # into a request to an external service.
        $builder = [UriBuilder]::new($base); $builder.Host = '127.0.0.1'; $base = $builder.Uri
    } elseif (-not [Net.IPAddress]::TryParse($hostName, [ref]$ip) -or -not [Net.IPAddress]::IsLoopback($ip)) { throw 'The sandbox URL must use a loopback address.' }
    Add-Type -AssemblyName System.Net.Http
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.UseProxy = $false; $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(3)
    $client.MaxResponseContentBufferSize = 65536
    $health = $null; $response = $null; $content = $null
    try {
        $health = $client.GetAsync([Uri]::new($base, 'health')).GetAwaiter().GetResult()
        if ([int]$health.StatusCode -ne 200) { return $false }
        $content = [Net.Http.StringContent]::new('{"command":"printf AMUSE_SANDBOX_READY","timeout":2}', [Text.Encoding]::UTF8, 'application/json')
        $response = $client.PostAsync([Uri]::new($base, 'run'), $content).GetAwaiter().GetResult()
        if ([int]$response.StatusCode -ne 200) { return $false }
        $ran = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
        foreach ($field in @('output', 'cut', 'exitCode', 'signal', 'timedOut')) { if ($ran.PSObject.Properties.Name -notcontains $field) { return $false } }
        return $ran.output -ceq 'AMUSE_SANDBOX_READY' -and $ran.exitCode -eq 0 -and $ran.cut -eq 0 -and $null -eq $ran.signal -and $ran.timedOut -eq $false
    } catch { return $false }
    finally {
        if ($health) { $health.Dispose() }; if ($response) { $response.Dispose() }; if ($content) { $content.Dispose() }
        $client.Dispose(); $handler.Dispose()
    }
}

function Start-AmuseSandboxBackend {
    param([string]$Executable, [string]$WorkingDirectory, [string]$LogDirectory, [hashtable]$Environment = @{}, [string]$RuntimeNode = '')
    New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $outputPath = Join-Path $LogDirectory ('docker-backend-' + $stamp + '.stdout.log')
    $errorPath = Join-Path $LogDirectory ('docker-backend-' + $stamp + '.stderr.log')
    foreach ($name in $Environment.Keys) {
        if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$' -or ([string]$Environment[$name]).Contains([char]0)) { throw 'Invalid Docker backend environment entry.' }
    }
    if (-not $RuntimeNode) { $RuntimeNode = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '.local\runtime.json') -Raw | ConvertFrom-Json).node }
    # Node duplicates these open file descriptors into the child. There is no
    # anonymous stdout/stderr pipe or reader whose life depends on this host.
    $code = @'
import { openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
let output, errors;
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 65536) throw new Error('Backend launch configuration is too large');
  }
  const config = JSON.parse(input);
  output = openSync(config.output, 'ax', 0o600);
  errors = openSync(config.error, 'ax', 0o600);
  const child = spawn(config.executable, [], {
    cwd: config.cwd, env: { ...process.env, ...config.environment },
    detached: true, windowsHide: true, stdio: ['ignore', output, errors],
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  process.stdout.write(JSON.stringify({ pid: child.pid, launcherPid: process.pid }));
} catch (error) {
  process.stderr.write(String(error?.message ?? error));
  process.exitCode = 1;
} finally {
  if (output !== undefined) closeSync(output);
  if (errors !== undefined) closeSync(errors);
}
'@
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $RuntimeNode
    $start.WorkingDirectory = $WorkingDirectory
    $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $start.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
    $start.Arguments = ((@('--input-type=module', '-e', $code) | ForEach-Object {
        '"' + [regex]::Replace([regex]::Replace($_, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
    }) -join ' ')
    $launcher = New-Object System.Diagnostics.Process
    $launcher.StartInfo = $start
    try {
        if (-not $launcher.Start()) { throw 'The Docker backend launcher could not be started.' }
        $output = $launcher.StandardOutput.ReadToEndAsync(); $errors = $launcher.StandardError.ReadToEndAsync()
        # Profile overrides travel over stdin, not process-list-visible argv.
        $config = @{ executable = $Executable; cwd = $WorkingDirectory; output = $outputPath; error = $errorPath; environment = $Environment } | ConvertTo-Json -Depth 4 -Compress
        $bytes = [Text.Encoding]::UTF8.GetBytes($config)
        $launcher.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
        $launcher.StandardInput.Close()
        if (-not $launcher.WaitForExit(10000)) {
            $launcher.Kill(); $launcher.WaitForExit()
            throw 'Docker backend launch status is unknown after 10 seconds. No retry was attempted.'
        }
        if ($launcher.ExitCode -ne 0) { throw ('The configured Docker backend could not be started: ' + $errors.GetAwaiter().GetResult()) }
        $launched = $output.GetAwaiter().GetResult() | ConvertFrom-Json
        if (-not $launched.pid -or [int]$launched.pid -le 0) { throw 'The Docker backend launcher returned no process identity.' }
        [pscustomobject]@{ Pid = [int]$launched.pid; LauncherPid = [int]$launched.launcherPid; OutputPath = $outputPath; ErrorPath = $errorPath }
    } finally { $launcher.Dispose() }
}

$sandboxSettings = Join-Path $Root '.local\sandbox.json'
if (-not (Test-Path -LiteralPath $sandboxSettings)) { return }
$sandboxConfig = Get-Content -LiteralPath $sandboxSettings -Raw | ConvertFrom-Json
if ($sandboxConfig.url -and (Test-AmuseSandboxReady -Address ([string]$sandboxConfig.url))) {
    Write-Output 'Reusing the ready sandbox; Docker and running containers were left untouched.'
    return
}
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
        $sandboxRuntimeNode = (Get-Content -LiteralPath (Join-Path $Root '.local\runtime.json') -Raw | ConvertFrom-Json).node
        $sandboxBackendProcess = Start-AmuseSandboxBackend -Executable $sandboxBackend -WorkingDirectory (Split-Path -Parent $sandboxBackend) -LogDirectory (Join-Path $Root '.local\logs') -Environment $sandboxBackendEnvironment -RuntimeNode $sandboxRuntimeNode
        Write-Output ('Started the configured Docker backend (PID ' + $sandboxBackendProcess.Pid + ').')
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
    $sandboxUp = Invoke-AmuseSandboxDocker -Executable $sandboxDocker -Arguments @('compose', '-f', (Join-Path $Root 'compose.sandbox.windows.yaml'), 'up', '-d', '--wait', '--wait-timeout', '60') -TimeoutSeconds 75
    if ($sandboxUp.StandardOutput) { Write-Output $sandboxUp.StandardOutput.TrimEnd() }
    if ($sandboxUp.StandardError) { Write-Output $sandboxUp.StandardError.TrimEnd() }
    if ($sandboxUp.ExitCode -ne 0) { throw 'The Amuse sandbox did not become ready.' }
}
finally {
    $env:AMUSE_WORKSPACE = $sandboxPreviousWorkspace
    $env:AMUSE_SANDBOX_SUBNET = $sandboxPreviousSubnet
}
