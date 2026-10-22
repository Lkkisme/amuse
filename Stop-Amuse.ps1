$ErrorActionPreference = 'Stop'
$amusePidFile = Join-Path $PSScriptRoot '.local\process.json'
if (!(Test-Path -LiteralPath $amusePidFile)) { Write-Output 'Amuse is not running.'; exit 0 }
$amuseSaved = Get-Content -LiteralPath $amusePidFile -Raw | ConvertFrom-Json
$amuseProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($amuseSaved.pid)" -ErrorAction SilentlyContinue
if ($amuseProcess) {
    if ($amuseProcess.ExecutablePath -ne $amuseSaved.node -or !$amuseProcess.CommandLine.Contains($PSScriptRoot)) { throw 'The saved PID belongs to a different process. Nothing was stopped.' }
    # Stop only this instance's descendants, including its Windows MCP subprocess.
    & taskkill.exe /PID $amuseSaved.pid /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Amuse could not be stopped.' }
}
Remove-Item -LiteralPath $amusePidFile
Write-Output 'Amuse stopped.'
