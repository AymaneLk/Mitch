$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$taskApp=Join-Path $taskRoot 'outputs\playback-fix-build\Mitch-win32-x64\Mitch.exe'
$taskElectron=Join-Path $taskRoot 'node_modules\electron\dist\electron.exe'
$taskReport=Join-Path $taskRoot 'test-output\mcp-account-runner.json'
function Record([string]$status){@{status=$status;at=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath $taskReport}
try{
 Record 'closing_mitch'
 foreach($taskProcess in @(Get-CimInstance Win32_Process)){
  $taskOwnedMitch=$taskProcess.ExecutablePath -eq $taskApp -and $taskProcess.CommandLine -notmatch '--type='
  $taskOwnedImport=$taskProcess.ExecutablePath -eq $taskElectron -and $taskProcess.CommandLine -match 'scripts/configure-mcp-accounts.js'
  if($taskOwnedMitch -or $taskOwnedImport){& taskkill.exe /PID $taskProcess.ProcessId /T /F | Out-Null}
 }
 Record 'importing'
 $taskImport=Start-Process -FilePath $taskElectron -ArgumentList @('scripts/configure-mcp-accounts.js') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot 'test-output/mcp-import.out.txt') -RedirectStandardError (Join-Path $taskRoot 'test-output/mcp-import.err.txt') -Wait -PassThru
 if($taskImport.ExitCode -ne 0){throw 'Encrypted credential import failed; see the redacted import log.'}
 Record 'authorizing'
 $taskAuth=Start-Process -FilePath $taskElectron -ArgumentList @('scripts/authorize-mcp-accounts.js') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot 'test-output/mcp-authorize.out.txt') -RedirectStandardError (Join-Path $taskRoot 'test-output/mcp-authorize.err.txt') -Wait -PassThru
 if($taskAuth.ExitCode -ne 0){throw 'Account connection failed; see the redacted status report.'}
 Record 'finished'
}catch{@{status='failed';message=$_.Exception.Message}|ConvertTo-Json|Set-Content -LiteralPath $taskReport}
