$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$taskOutputs=Join-Path $taskRoot 'outputs'
$taskSource=Join-Path $taskOutputs 'desktop-session-build\Mitch-win32-x64'
$taskInstall=Join-Path $taskOutputs 'playback-fix-build\Mitch-win32-x64'
$taskBackup=Join-Path $taskOutputs ('backups\before-desktop-session-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
$taskHash='974767f21bce416f60bb87ae4ef41d937a954c7fe06e1d576c7654e1a274cec6'
$taskRecord=@{status='starting';version='0.6.0-local.30';runtimeSha256=$taskHash;install=$taskInstall;backup=$taskBackup;checks=@()}
$taskReport=Join-Path $taskRoot 'test-output\desktop-session-deployment.json'
$taskClosed=$false
function Stage([string]$value){$taskRecord.status=$value;$taskRecord | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $taskReport}
function Check([string]$name,[string]$exe,[string[]]$arguments,[int]$seconds=120){
 Stage $name
 $taskProbe=Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot ('test-output\session-v30-'+$name+'.out.txt')) -RedirectStandardError (Join-Path $taskRoot ('test-output\session-v30-'+$name+'.err.txt')) -PassThru
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
 $env:MITCH_SESSION_APP=Join-Path $taskSource 'resources\app.asar'
 $env:MITCH_SESSION_IDLE='0'
 Check 'lifecycle' (Join-Path $taskRoot 'node_modules\electron\dist\electron.exe') @('scripts/test-desktop-session.js') 390
 $taskLive=Get-Content (Join-Path $taskRoot 'test-output\desktop-session-live.json') -Raw | ConvertFrom-Json
 if($taskLive.status -ne 'passed' -or !$taskLive.packaged -or $taskLive.runtimeSha256 -ne $taskHash -or $taskLive.realClicks -ne 3 -or $taskLive.checks.Count -lt 5){throw 'Packaged lifecycle validation mismatch.'}
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
 $taskStarted=Start-Process -FilePath (Join-Path $taskInstall 'Mitch.exe') -ArgumentList @('--settings') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru
 $taskRecord.pid=$taskStarted.Id;Stage 'installed'
}catch{
 $taskRecord.error=$_.Exception.Message;Stage 'failed'
 if($taskClosed){Start-Process -FilePath (Join-Path $taskInstall 'Mitch.exe') -ArgumentList @('--settings') -WorkingDirectory $taskRoot -WindowStyle Hidden}
 throw
}finally{
 foreach($taskEnv in @('MITCH_SESSION_APP','MITCH_SESSION_IDLE')){[Environment]::SetEnvironmentVariable($taskEnv,$null,'Process')}
}
