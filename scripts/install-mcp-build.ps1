$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$taskOutputs=Join-Path $taskRoot 'outputs'
$taskSource=Join-Path $taskOutputs 'mcp-build\Mitch-win32-x64'
$taskInstall=Join-Path $taskOutputs 'playback-fix-build\Mitch-win32-x64'
$taskBackup=Join-Path $taskOutputs ('backups\before-mcp-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
$taskHash='3622cd03005ec0fc88240bec75bb782b5c95a5f43302dd9278d25a9fd4af201c'
$taskRecord=@{status='starting';version='0.6.0-local.31';runtimeSha256=$taskHash;install=$taskInstall;backup=$taskBackup;checks=@()}
$taskReport=Join-Path $taskRoot 'test-output\mcp-deployment.json'
$taskClosed=$false
function Stage([string]$value){$taskRecord.status=$value;$taskRecord | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $taskReport}
function Check([string]$name,[string]$exe,[string[]]$arguments,[int]$seconds=120){
 Stage $name
 $taskProbe=Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot ('test-output\mcp-v31-'+$name+'.out.txt')) -RedirectStandardError (Join-Path $taskRoot ('test-output\mcp-v31-'+$name+'.err.txt')) -PassThru
 $null=$taskProbe.Handle
 if(!$taskProbe.WaitForExit($seconds*1000)){& taskkill.exe /PID $taskProbe.Id /T /F | Out-Null;throw ($name+' exceeded its deadline.')}
 if($taskProbe.ExitCode -ne 0){throw ($name+' failed with exit '+$taskProbe.ExitCode+'. Existing installation preserved.')}
 $taskRecord.checks+=$name
}
function Stop-OwnedMitch {
 $taskExe=Join-Path $taskInstall 'Mitch.exe'
 for($taskPass=0;$taskPass -lt 3;$taskPass++){
  $taskStopped=0
  foreach($taskProcess in @(Get-Process -Name Mitch -ErrorAction SilentlyContinue)){
   if($taskProcess.HasExited){continue}
   if(!$taskProcess.Path){throw 'Cannot identify a running Mitch process.'}
   if(![IO.Path]::GetFullPath($taskProcess.Path).Equals($taskExe,[StringComparison]::OrdinalIgnoreCase)){continue}
   try{$taskProcess.Kill()}catch{if(!$taskProcess.HasExited){throw}}
   if(!$taskProcess.WaitForExit(10000)){throw 'Mitch did not close.'};$taskStopped++
  }
  if(!$taskStopped){return}
 }
 throw 'Mitch restarted during shutdown.'
}
try{
 foreach($taskDir in @($taskSource,$taskInstall,$taskBackup)){if(![IO.Path]::GetFullPath($taskDir).StartsWith($taskOutputs+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected deployment path.'}}
 if((Get-FileHash (Join-Path $taskSource 'resources\app.asar')).Hash -ne $taskHash){throw 'The build changed.'}
 Check 'smoke' (Join-Path $taskSource 'Mitch.exe') @('--smoke-test')
 $taskSmoke=Get-Content (Join-Path $taskRoot 'test-output\smoke-result.json') -Raw | ConvertFrom-Json
 if($taskSmoke.status -ne 'passed' -or !$taskSmoke.packaged -or $taskSmoke.version -ne $taskRecord.version){throw 'Smoke version mismatch.'}
 Check 'mcp' (Join-Path $taskSource 'Mitch.exe') @('--smoke-test','--mcp-settings-test')
 $taskMcp=Get-Content (Join-Path $taskRoot 'test-output\mcp-packaged-result.json') -Raw | ConvertFrom-Json
 if($taskMcp.status -ne 'passed' -or !$taskMcp.packaged -or $taskMcp.version -ne $taskRecord.version){throw 'Packaged MCP checks failed.'}
 Stage 'installing'
 Stop-OwnedMitch
 $taskClosed=$true
 New-Item -ItemType Directory -Path $taskBackup | Out-Null
 Copy-Item -LiteralPath (Join-Path $taskInstall 'Mitch.exe') -Destination (Join-Path $taskBackup 'Mitch.exe')
 Copy-Item -LiteralPath (Join-Path $taskInstall 'resources') -Destination (Join-Path $taskBackup 'resources') -Recurse
 Copy-Item -LiteralPath (Join-Path $taskSource 'Mitch.exe') -Destination (Join-Path $taskInstall 'Mitch.exe') -Force
 foreach($taskFile in Get-ChildItem -LiteralPath (Join-Path $taskSource 'resources') -Recurse -File){
  $taskRelative=$taskFile.FullName.Substring((Join-Path $taskSource 'resources').Length+1)
  $taskDestination=[IO.Path]::GetFullPath((Join-Path (Join-Path $taskInstall 'resources') $taskRelative))
  if(!$taskDestination.StartsWith($taskInstall+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Resource escaped install directory.'}
  New-Item -ItemType Directory -Force -Path (Split-Path $taskDestination -Parent) | Out-Null
  Copy-Item -LiteralPath $taskFile.FullName -Destination $taskDestination -Force
 }
 if((Get-FileHash (Join-Path $taskInstall 'resources\app.asar')).Hash -ne $taskHash){throw 'Installed archive mismatch.'}
 Copy-Item -LiteralPath (Join-Path $taskRoot 'outputs\mcp-runtime\mcp-runtime.json') -Destination (Join-Path $env:APPDATA 'Pixie Windows Companion\mcp-runtime.json') -Force
 $taskStarted=Start-Process -FilePath (Join-Path $taskInstall 'Mitch.exe') -ArgumentList @('--settings') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru
 $taskRecord.pid=$taskStarted.Id;Stage 'installed'
}catch{
 $taskRecord.error=$_.Exception.Message;Stage 'failed'
 if($taskClosed){Start-Process -FilePath (Join-Path $taskInstall 'Mitch.exe') -ArgumentList @('--settings') -WorkingDirectory $taskRoot -WindowStyle Hidden}
 throw
}finally{
 foreach($taskEnv in @('MITCH_SESSION_APP','MITCH_SESSION_IDLE')){[Environment]::SetEnvironmentVariable($taskEnv,$null,'Process')}
}
