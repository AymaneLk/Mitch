param([switch]$SkipMatched)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$taskElectron=Join-Path $taskRoot 'node_modules\electron\dist\electron.exe'
$taskRuns=@(
  @{label='release';flags=@()},
  @{label='extended';flags=@('--extended')},
  @{label='model-wording';flags=@('--model-wording')}
)
foreach($taskRun in $taskRuns){
  if($SkipMatched -and $taskRun.label -eq 'release'){continue}
  $taskStarted=Get-Date
  $taskArgs=@('scripts/run-real-web-benchmark.js',('--label='+$taskRun.label))+$taskRun.flags
  $taskProcess=Start-Process -FilePath $taskElectron -ArgumentList $taskArgs -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot ('test-output\real-web-'+$taskRun.label+'.stdout.log')) -RedirectStandardError (Join-Path $taskRoot ('test-output\real-web-'+$taskRun.label+'.stderr.log')) -PassThru
  $null=$taskProcess.Handle
  if(!$taskProcess.WaitForExit(360000)){throw ('Benchmark exceeded its suite deadline: '+$taskRun.label)}
  if($null -ne $taskProcess.ExitCode -and $taskProcess.ExitCode -ne 0){throw ('Benchmark process failed: '+$taskRun.label)}
  $taskResult=Get-Content (Join-Path $taskRoot ('test-output\real-web-'+$taskRun.label+'.json')) -Raw | ConvertFrom-Json
  if($taskResult.status -ne 'completed' -or [DateTime]::Parse($taskResult.at).ToUniversalTime() -lt $taskStarted.ToUniversalTime()){throw ('Benchmark report failed: '+$taskRun.label)}
}
