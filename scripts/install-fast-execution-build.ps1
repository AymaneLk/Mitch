$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$taskOutputs = Join-Path $taskRoot 'outputs'
$taskSource = [IO.Path]::GetFullPath((Join-Path $taskOutputs 'fast-execution-build\Mitch-win32-x64'))
$taskInstall = [IO.Path]::GetFullPath((Join-Path $taskOutputs 'playback-fix-build\Mitch-win32-x64'))
$taskBaseline = Join-Path $taskOutputs 'general-engine-build\Mitch-win32-x64\resources\app.asar'
$taskHash = '93cd61b708f498b5ced310b4b71d1c0b98e337a653ca34ba25549635af8f9792'
$taskReport = Join-Path $taskRoot 'test-output\fast-execution-deployment.json'
$taskBackup = Join-Path $taskOutputs ('backups\before-fast-execution-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$taskExe = Join-Path $taskInstall 'Mitch.exe'
$taskElectron = Join-Path $taskRoot 'node_modules\electron\dist\electron.exe'
$taskRecord = @{status='starting';version='0.6.0-local.29';runtimeSha256=$taskHash;install=$taskInstall;backup=$taskBackup;checks=@()}
$taskClosed = $false
function Save-Stage([string]$stage) { $taskRecord.status=$stage; $taskRecord | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $taskReport }
function Run-Check([string]$name,[string]$exe,[string[]]$arguments,[int]$seconds=120) {
  Save-Stage $name
  $taskOut=Join-Path $taskRoot ('test-output\fast-v29-'+$name+'.out.txt')
  $taskErr=Join-Path $taskRoot ('test-output\fast-v29-'+$name+'.err.txt')
  $taskProbe=Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput $taskOut -RedirectStandardError $taskErr -PassThru
  $null=$taskProbe.Handle
  if (!$taskProbe.WaitForExit($seconds*1000)) {
    # Terminate only this test's verified process tree, never by executable name.
    & taskkill.exe /PID $taskProbe.Id /T /F | Out-Null
    throw ($name+' exceeded its deadline; installation was not started.')
  }
  if ($taskProbe.ExitCode -ne 0) { throw ($name+' failed with exit '+$taskProbe.ExitCode+'. Existing installation preserved.') }
  $taskRecord.checks += $name
}
function Assert-Live([string]$file,[int]$count) {
  $taskResult=Get-Content -LiteralPath (Join-Path $taskRoot ('test-output\'+$file)) -Raw | ConvertFrom-Json
  if ($taskResult.status -ne 'completed' -or @($taskResult.rows).Count -ne $count -or @($taskResult.rows | Where-Object { !$_.confirmed }).Count) { throw ('Independent readback failed: '+$file) }
}
function Stop-OwnedMitch {
  $taskAllowed=@($taskExe,(Join-Path $taskSource 'Mitch.exe'),(Join-Path (Split-Path (Split-Path $taskBaseline -Parent) -Parent) 'Mitch.exe'))
  foreach ($taskAllowedPath in $taskAllowed) {
    if (![IO.Path]::GetFullPath($taskAllowedPath).StartsWith($taskOutputs+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Process target is outside workspace outputs.' }
  }
  for($taskPass=0;$taskPass -lt 3;$taskPass++) {
    $taskStopped=0
    foreach($taskProcess in @(Get-Process -Name Mitch -ErrorAction SilentlyContinue)) {
      if($taskProcess.HasExited){continue}
      $taskPath=$taskProcess.Path
      if(!$taskPath){throw 'Cannot identify a running Mitch process; close Mitch before retrying.'}
      if($taskAllowed -notcontains [IO.Path]::GetFullPath($taskPath)){continue}
      try{$taskProcess.Kill()}catch{if(!$taskProcess.HasExited){throw}}
      if(!$taskProcess.WaitForExit(10000)){throw 'Mitch did not close.'}
      $taskStopped++
    }
    if(!$taskStopped){return}
  }
  throw 'Mitch restarted during shutdown.'
}
try {
  foreach($taskDirectory in @($taskSource,$taskInstall,$taskBackup)) {
    if(![IO.Path]::GetFullPath($taskDirectory).StartsWith($taskOutputs+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Deployment path is outside workspace outputs.'}
  }
  if((Get-Content (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version -ne $taskRecord.version){throw 'Unexpected source version.'}
  if((Get-FileHash (Join-Path $taskSource 'resources\app.asar')).Hash -ne $taskHash){throw 'Build changed after source verification.'}
  Stop-OwnedMitch
  $taskClosed=$true
  Run-Check 'smoke' (Join-Path $taskSource 'Mitch.exe') @('--smoke-test')
  Run-Check 'settings' (Join-Path $taskSource 'Mitch.exe') @('--smoke-test','--provider-settings-test')
  $env:MITCH_ENGINE_APP=Join-Path $taskSource 'resources\app.asar'
  $env:MITCH_RECOVERY_APP=$env:MITCH_ENGINE_APP
  Run-Check 'native-text' $taskElectron @('scripts/test-native-text.js')
  Run-Check 'native-recovery' $taskElectron @('scripts/test-native-plan-recovery.js')
  foreach($taskFile in @('native-text-live.json','native-plan-recovery-live.json')) {
    $taskResult=Get-Content (Join-Path $taskRoot ('test-output\'+$taskFile)) -Raw | ConvertFrom-Json
    if($taskResult.status -ne 'passed' -or !$taskResult.packaged -or $taskResult.runtimeSha256 -ne $taskHash){throw ('Packaged native check mismatch: '+$taskFile)}
  }
  $env:MITCH_BENCH_TASKS='multiple-fields,conditional-locked,cross-workspace'
  $env:MITCH_BENCHMARK_SOURCE=$taskBaseline
  Run-Check 'native-before' $taskElectron @('scripts/run-general-speed.js','--label=fast-v28-before') 300
  Assert-Live 'general-speed-fast-v28-before.json' 3
  $env:MITCH_BENCHMARK_SOURCE=Join-Path $taskSource 'resources\app.asar'
  Run-Check 'native-after' $taskElectron @('scripts/run-general-speed.js','--label=fast-v29-after') 300
  Assert-Live 'general-speed-fast-v29-after.json' 3
  $env:MITCH_BENCH_TASKS='unfamiliar-fields,unfamiliar-states,form-submit-transition'
  Run-Check 'browser-after' $taskElectron @('scripts/run-general-web-speed.js','--label=fast-v29-after') 300
  Assert-Live 'general-web-fast-v29-after.json' 3
  $taskSmoke=Get-Content (Join-Path $taskRoot 'test-output\smoke-result.json') -Raw | ConvertFrom-Json
  $taskSettings=Get-Content (Join-Path $taskRoot 'test-output\chatgpt-settings-result.json') -Raw | ConvertFrom-Json
  if($taskSmoke.status -ne 'passed' -or !$taskSmoke.packaged -or $taskSmoke.version -ne $taskRecord.version -or $taskSettings.status -ne 'passed' -or $taskSettings.version -ne $taskRecord.version){throw 'Packaged smoke/settings validation mismatch.'}
  Save-Stage 'installing'
  New-Item -ItemType Directory -Path $taskBackup | Out-Null
  Copy-Item -LiteralPath $taskExe -Destination (Join-Path $taskBackup 'Mitch.exe')
  Copy-Item -LiteralPath (Join-Path $taskInstall 'resources') -Destination (Join-Path $taskBackup 'resources') -Recurse
  Stop-OwnedMitch
  Copy-Item -LiteralPath (Join-Path $taskSource 'Mitch.exe') -Destination $taskExe -Force
  foreach($taskFile in Get-ChildItem -LiteralPath (Join-Path $taskSource 'resources') -Recurse -File) {
    $taskRelative=$taskFile.FullName.Substring((Join-Path $taskSource 'resources').Length+1)
    $taskDestination=[IO.Path]::GetFullPath((Join-Path (Join-Path $taskInstall 'resources') $taskRelative))
    if(!$taskDestination.StartsWith($taskInstall+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Resource escaped install directory.'}
    New-Item -ItemType Directory -Force -Path (Split-Path $taskDestination -Parent) | Out-Null
    Copy-Item -LiteralPath $taskFile.FullName -Destination $taskDestination -Force
  }
  if((Get-FileHash (Join-Path $taskInstall 'resources\app.asar')).Hash -ne $taskHash){throw 'Installed archive does not match the tested build.'}
  $taskStarted=Start-Process -FilePath $taskExe -ArgumentList @('--settings') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru
  $taskRecord.pid=$taskStarted.Id
  Save-Stage 'installed'
} catch {
  $taskRecord.error=$_.Exception.Message
  Save-Stage 'failed'
  if($taskClosed -and (Test-Path -LiteralPath $taskExe)){Start-Process -FilePath $taskExe -ArgumentList @('--settings') -WorkingDirectory $taskRoot -WindowStyle Hidden}
  throw
} finally {
  foreach($taskEnv in @('MITCH_ENGINE_APP','MITCH_RECOVERY_APP','MITCH_BENCH_TASKS','MITCH_BENCHMARK_SOURCE')){[Environment]::SetEnvironmentVariable($taskEnv,$null,'Process')}
}
