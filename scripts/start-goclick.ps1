param([switch]$Stop)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskRuntime = Join-Path $taskRoot 'vendor/goclick'
$taskPython = Join-Path $taskRuntime 'venv/Scripts/python.exe'
$taskPidFile = Join-Path $taskRuntime 'process.json'
if (Test-Path -LiteralPath $taskPidFile) {
  $entry = Get-Content -LiteralPath $taskPidFile -Raw | ConvertFrom-Json
  $process = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
  if ($process) {
    if ($process.Path -ne [IO.Path]::GetFullPath($entry.path) -or $process.StartTime.ToUniversalTime().Ticks -ne ([DateTimeOffset]$entry.started).UtcDateTime.Ticks) { throw 'Tracked PID identity changed; refusing to modify the process.' }
    if (!$Stop) { Write-Host 'GoClick CPU service is already running.'; exit }
    & taskkill.exe /PID $entry.pid /T /F | Out-Null
    if ($LASTEXITCODE -ne 0 -or !$process.WaitForExit(5000)) { throw 'Could not stop GoClick.' }
  }
  Remove-Item -LiteralPath $taskPidFile
}
if ($Stop) { exit }
if (!(Test-Path -LiteralPath $taskPython)) { throw 'Run scripts/setup-goclick.ps1 first.' }
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,22135)
try { $listener.Start() } finally { $listener.Stop() }
$taskLogs = Join-Path $taskRuntime 'logs'
New-Item -ItemType Directory -Force -Path $taskLogs | Out-Null
$process = Start-Process -FilePath $taskPython -ArgumentList @('-m','local_runtime.goclick') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLogs 'server.out.log') -RedirectStandardError (Join-Path $taskLogs 'server.err.log') -PassThru
@{pid=$process.Id;path=[IO.Path]::GetFullPath($taskPython);started=$process.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $taskPidFile
Write-Host 'GoClick is loading on CPU at http://127.0.0.1:22135. Qwen and the GPU remain unused.'
