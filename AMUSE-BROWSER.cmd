@echo off
setlocal
set "AMUSE_BROWSER_ROOT=%~dp0"
set "AMUSE_BROWSER_NODE="
for /f "usebackq delims=" %%N in (`powershell.exe -NoProfile -NonInteractive -Command "try { $runtimeJson = Get-Content -LiteralPath (Join-Path $env:AMUSE_BROWSER_ROOT '.local\runtime.json') -Raw -ErrorAction Stop; (ConvertFrom-Json -InputObject $runtimeJson).node } catch { exit 1 }"`) do set "AMUSE_BROWSER_NODE=%%N"
if not defined AMUSE_BROWSER_NODE (
  echo Amuse Node runtime is not configured. 1>&2
  exit /b 1
)
if not exist "%AMUSE_BROWSER_NODE%" (
  echo Amuse Node runtime was not found. 1>&2
  exit /b 1
)
"%AMUSE_BROWSER_NODE%" "%AMUSE_BROWSER_ROOT%api\src\browser-cli.ts" %*
exit /b %errorlevel%
