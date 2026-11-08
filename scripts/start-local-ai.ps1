param([switch]$Stop)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $root 'vendor/local-ai'
$logs = Join-Path $runtime 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$pidFile = Join-Path $runtime 'processes.json'
if ($Stop) {
  if (Test-Path $pidFile) {
    foreach ($entry in (Get-Content $pidFile -Raw | ConvertFrom-Json)) {
      $process = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
      if ($process) {
        if ($process.Path -ne [IO.Path]::GetFullPath($entry.path) -or $process.StartTime.ToUniversalTime().Ticks -ne ([DateTimeOffset]$entry.started).UtcDateTime.Ticks) { throw 'Tracked PID no longer identifies this local service; refusing to stop it.' }
        & taskkill.exe /PID $entry.pid /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not stop the tracked local service.' }
        if (!$process.WaitForExit(5000)) { throw 'Local service has not exited yet.' }
      }
    }
    Remove-Item -LiteralPath $pidFile
  }
  exit
}
if (Test-Path $pidFile) {
  $running = @(Get-Content $pidFile -Raw | ConvertFrom-Json | Where-Object { Get-Process -Id $_.pid -ErrorAction SilentlyContinue })
  if ($running.Count) { throw 'Local services are already tracked. Use this script with -Stop before restarting.' }
}
foreach ($port in @(22130,22131,22132)) {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$port)
  try { $listener.Start() } finally { $listener.Stop() }
}
$entries = @()
$python = Join-Path $runtime 'venv/Scripts/python.exe'
if (!(Test-Path $python)) { throw 'Run scripts/setup-local-ai.ps1 before starting local services.' }
function Start-ServiceProcess($name,$executable,$arguments) {
  $process = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs "$name.out.log") -RedirectStandardError (Join-Path $logs "$name.err.log") -PassThru
  return [pscustomobject]@{name=$name;pid=$process.Id;path=[IO.Path]::GetFullPath($executable);started=$process.StartTime.ToUniversalTime().ToString('o')}
}
try {
  $server = Join-Path $runtime 'llama/llama-server.exe'
  $entries += Start-ServiceProcess 'chat' $server @('-m','vendor/local-ai/models/Qwen3.5-4B-Q4_K_M.gguf','--mmproj','vendor/local-ai/models/mmproj-F16.gguf','--host','127.0.0.1','--port','22130','--alias','mitch-local','--ctx-size','16384','--parallel','1','--gpu-layers','all','--flash-attn','on','--jinja','--no-webui','--cors-origins','http://127.0.0.1','--no-cors-credentials')
  $entries += Start-ServiceProcess 'asr' $server @('-m','vendor/local-ai/models/Qwen3-ASR-0.6B-Q8_0.gguf','--mmproj','vendor/local-ai/models/mmproj-Qwen3-ASR-0.6B-Q8_0.gguf','--host','127.0.0.1','--port','22131','--alias','mitch-asr','--chat-template-file','local_runtime/qwen-asr-english.jinja','--ctx-size','4096','--parallel','1','--gpu-layers','0','--no-mmproj-offload','--threads','6','--jinja','--no-webui','--cors-origins','http://127.0.0.1','--no-cors-credentials')
  $python = Join-Path $runtime 'venv/Scripts/python.exe'
  if (Test-Path $python) { $entries += Start-ServiceProcess 'speech' $python @('-m','uvicorn','local_runtime.speech:app','--host','127.0.0.1','--port','22132') }
} finally {
  ConvertTo-Json -InputObject @($entries) | Set-Content -LiteralPath $pidFile
}
$entries | Format-Table name,pid
Write-Host 'Services are loading. Logs: vendor/local-ai/logs. Check health before use.'
