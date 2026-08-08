param([string]$Node = (Get-Command node).Source)
$ErrorActionPreference = 'Stop'
$Supervisor = Join-Path $PSScriptRoot 'supervisor.mjs'
& $Node $Supervisor
exit $LASTEXITCODE
