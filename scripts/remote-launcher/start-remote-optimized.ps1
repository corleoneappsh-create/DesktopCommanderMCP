param(
  [string]$Node = (Get-Command node).Source,
  [string]$Entry = (Join-Path $PSScriptRoot '..\..\dist\index.js'),
  [string]$Log = (Join-Path $PSScriptRoot 'desktop-commander-remote.log'),
  [int]$RetrySeconds = 5
)

$ErrorActionPreference = 'Stop'
while ($true) {
  & $Node $Entry remote --persist-session >> $Log 2>&1
  $exitCode = $LASTEXITCODE
  "$(Get-Date -Format o) EXIT code=$exitCode; retrying in $RetrySeconds seconds" >> $Log
  Start-Sleep -Seconds $RetrySeconds
}
