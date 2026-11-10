$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$taskOutputs=Join-Path $taskRoot 'outputs'
$taskInstall=Join-Path $taskOutputs 'playback-fix-build\Mitch-win32-x64'
$taskExe=Join-Path $taskInstall 'Mitch.exe'
$taskOldExe=Join-Path $taskOutputs 'general-engine-build\Mitch-win32-x64\Mitch.exe'
$taskReport=Join-Path $taskRoot 'test-output\desktop-session-deployment.json'
$taskRecord=Get-Content -LiteralPath $taskReport -Raw | ConvertFrom-Json
if($taskRecord.status -ne 'installed' -or (Get-FileHash (Join-Path $taskInstall 'resources\app.asar')).Hash -ne $taskRecord.runtimeSha256){throw 'The tested installation must exist before activation.'}
foreach($taskTarget in @($taskExe,$taskOldExe)){if(![IO.Path]::GetFullPath($taskTarget).StartsWith($taskOutputs+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Process target outside workspace outputs.'}}
for($taskPass=0;$taskPass -lt 3;$taskPass++){
 $taskStopped=0
 foreach($taskProcess in @(Get-Process -Name Mitch -ErrorAction SilentlyContinue)){
  if($taskProcess.HasExited){continue}
  if(!$taskProcess.Path){throw 'Cannot identify running Mitch.'}
  if(@($taskExe,$taskOldExe) -notcontains [IO.Path]::GetFullPath($taskProcess.Path)){continue}
  try{$taskProcess.Kill()}catch{if(!$taskProcess.HasExited){throw}}
  if(!$taskProcess.WaitForExit(10000)){throw 'Old Mitch did not exit.'};$taskStopped++
 }
 if(!$taskStopped){break}
}
$taskLinkPath=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Mitch.lnk'
if(Test-Path -LiteralPath $taskLinkPath){
 Copy-Item -LiteralPath $taskLinkPath -Destination (Join-Path $taskRecord.backup 'Mitch.lnk') -Force
 $taskShell=New-Object -ComObject WScript.Shell
 $taskLink=$taskShell.CreateShortcut($taskLinkPath)
 $taskLink.TargetPath=$taskExe;$taskLink.Arguments='';$taskLink.WorkingDirectory=$taskInstall;$taskLink.IconLocation=$taskExe+',0';$taskLink.Save()
}
$taskStarted=Start-Process -FilePath $taskExe -ArgumentList @('--settings') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 3
if($taskStarted.HasExited){throw 'The fixed Mitch exited immediately instead of remaining active.'}
if(!(Get-Process -Id $taskStarted.Id).Path.Equals($taskExe,[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected active executable.'}
$taskRecord.pid=$taskStarted.Id
$taskRecord | Add-Member -NotePropertyName activated -NotePropertyValue $true -Force
$taskRecord | Add-Member -NotePropertyName shortcut -NotePropertyValue $taskLinkPath -Force
$taskRecord | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $taskReport
