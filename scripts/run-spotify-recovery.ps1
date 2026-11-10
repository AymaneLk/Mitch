$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$taskApp=Join-Path $taskRoot 'outputs\playback-fix-build\Mitch-win32-x64\Mitch.exe'
$taskReport=Join-Path $taskRoot 'test-output\spotify-recovery-runner.json'
function Record([string]$status){@{status=$status;at=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath $taskReport}
try{
 Record 'closing_mitch'
 foreach($taskProcess in @(Get-CimInstance Win32_Process)){
  if($taskProcess.ExecutablePath -eq $taskApp -and $taskProcess.CommandLine -notmatch '--type='){& taskkill.exe /PID $taskProcess.ProcessId /T /F | Out-Null}
 }
 Record 'testing'
 $taskProbe=Start-Process -FilePath (Join-Path $taskRoot 'node_modules\electron\dist\electron.exe') -ArgumentList @('.','--spotify-mcp-test') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot 'test-output/spotify-recovery.out.txt') -RedirectStandardError (Join-Path $taskRoot 'test-output/spotify-recovery.err.txt') -PassThru
 $null=$taskProbe.Handle
 if(!$taskProbe.WaitForExit(120000)){& taskkill.exe /PID $taskProbe.Id /T /F | Out-Null;throw 'Playback test exceeded its deadline.'}
 if($taskProbe.ExitCode -ne 0){throw 'Playback test failed; see the report.'}
 $taskLive=Get-Content (Join-Path $taskRoot 'test-output/spotify-recovery-live.json') -Raw | ConvertFrom-Json
 if($taskLive.status -ne 'passed'){throw ('Playback verification failed: '+$taskLive.message)}
 Record 'finished'
}catch{@{status='failed';message=$_.Exception.Message}|ConvertTo-Json|Set-Content -LiteralPath $taskReport}
