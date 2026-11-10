$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
@(Get-Process -Name Mitch -ErrorAction SilentlyContinue | Select-Object Id,Path,StartTime) | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $taskRoot 'test-output\running-mitch.json')
