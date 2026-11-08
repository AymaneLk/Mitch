param([switch]$Stop)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $root 'vendor/local-ai/nemotron'
$record = Join-Path $runtime 'process.json'
if ($Stop) {
  if (!(Test-Path $record)) { return }
  $entry = Get-Content $record -Raw | ConvertFrom-Json
  $process = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
  if ($process) {
    if ($process.Path -ne [IO.Path]::GetFullPath($entry.path) -or $process.StartTime.ToUniversalTime().Ticks -ne ([DateTimeOffset]$entry.started).UtcDateTime.Ticks) { throw 'Tracked PID no longer identifies this trial; refusing to stop it.' }
    Stop-Process -Id $process.Id
    if (!$process.WaitForExit(5000)) { throw 'Trial process has not exited yet.' }
  }
  Remove-Item -LiteralPath $record
  return
}
if (Test-Path $record) {
  $entry = Get-Content $record -Raw | ConvertFrom-Json
  if (Get-Process -Id $entry.pid -ErrorAction SilentlyContinue) { throw 'Trial is already tracked; stop it before restarting.' }
}
$exe = Join-Path $runtime 'runtime/nemo-speech-0.3.0-windows-x86_64-cpu/bin/nemo-speech.exe'
if (!(Test-Path $exe) -or !(Test-Path (Join-Path $runtime 'nemotron-en-q8.gguf'))) { throw 'Run scripts/setup-nemotron.ps1 first.' }
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,22133)
try { $listener.Start() } finally { $listener.Stop() }
$logs = Join-Path $root 'test-output/asr-comparison'
New-Item -ItemType Directory -Force $logs | Out-Null
$process = Start-Process -FilePath $exe -ArgumentList @('serve','--host','127.0.0.1','--port','22133','--backend','cpu','--asr-model','vendor/local-ai/nemotron/nemotron-en-q8.gguf','--no-ui','--max-upload-mb','24') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'nemotron.out.log') -RedirectStandardError (Join-Path $logs 'nemotron.err.log') -PassThru
@{pid=$process.Id;path=[IO.Path]::GetFullPath($exe);started=$process.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content $record
Write-Host 'Trial starts at http://127.0.0.1:22133; wait for /health. Mitch still uses Qwen.'
