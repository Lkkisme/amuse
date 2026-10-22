param([Parameter(Mandatory=$true)][string]$SourceFile)
$ErrorActionPreference = 'Stop'
$amuseSource = (Resolve-Path -LiteralPath $SourceFile).Path
$amuseText = [System.IO.File]::ReadAllText($amuseSource, [System.Text.Encoding]::UTF8).Trim()
if (!$amuseText) { throw 'The system prompt must not be empty.' }
$amuseTarget = Join-Path $PSScriptRoot '.local\system-prompt.md'
if (Test-Path -LiteralPath $amuseTarget) { (Get-Item -LiteralPath $amuseTarget).IsReadOnly = $false }
try {
    [System.IO.File]::WriteAllText($amuseTarget, $amuseText + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
} finally {
    if (Test-Path -LiteralPath $amuseTarget) { (Get-Item -LiteralPath $amuseTarget).IsReadOnly = $true }
}
Write-Output 'Owner system prompt saved. Restart Amuse to load the new version.'
