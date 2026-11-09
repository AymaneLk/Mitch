$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$taskOutputs=Join-Path $taskRoot 'outputs'
$taskSource=[IO.Path]::GetFullPath((Join-Path $taskOutputs 'folder-build\Mitch-win32-x64'))
$taskInstall=[IO.Path]::GetFullPath((Join-Path $taskOutputs 'playback-fix-build\Mitch-win32-x64'))
$taskReport=Join-Path $taskRoot 'test-output\folder-deployment.json'
$taskRecord=Get-Content -LiteralPath $taskReport -Raw | ConvertFrom-Json
try {
  if($taskRecord.version -ne '0.6.0-local.22' -or $taskRecord.status -ne 'failed'){throw 'This recovery only completes the failed v22 install.'}
  foreach($taskPath in @($taskSource,$taskInstall,[IO.Path]::GetFullPath($taskRecord.backup))){if(!$taskPath.StartsWith($taskOutputs+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Recovery path outside workspace outputs.'}}
  if((Get-FileHash (Join-Path $taskSource 'resources\app.asar')).Hash -ne '532FC79DD3137DE5FE1B5C4CBCC18740185FB083E829E9C0D7B56BF7E7B0C7F2'){throw 'The tested build changed.'}
  foreach($taskCheck in @('smoke-result.json','folder-packaged-integration.json')){
    $taskResult=Get-Content (Join-Path $taskRoot ('test-output\'+$taskCheck)) -Raw | ConvertFrom-Json
    if($taskResult.status -ne 'passed' -or !$taskResult.packaged -or $taskResult.version -ne $taskRecord.version){throw 'The packaged checks must pass.'}
  }
  if(@(Get-Process -Name Mitch -ErrorAction SilentlyContinue).Count){throw 'Mitch is still running; no files were replaced.'}
  foreach($taskRelative in @('Mitch.exe','resources\app.asar')){
    if((Get-FileHash (Join-Path $taskInstall $taskRelative)).Hash -ne (Get-FileHash (Join-Path $taskRecord.backup $taskRelative)).Hash){throw 'The current install differs from its preserved backup.'}
  }
  $taskFiles=@(Get-Item (Join-Path $taskSource 'Mitch.exe'))+@(Get-ChildItem (Join-Path $taskSource 'resources') -File -Recurse)
  foreach($taskFile in $taskFiles){
    $taskRelative=$taskFile.FullName.Substring($taskSource.Length+1)
    $taskDestination=[IO.Path]::GetFullPath((Join-Path $taskInstall $taskRelative))
    if(!$taskDestination.StartsWith($taskInstall+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Resource path outside installation.'}
    New-Item -ItemType Directory -Force -Path (Split-Path $taskDestination -Parent) | Out-Null
    Copy-Item -LiteralPath $taskFile.FullName -Destination $taskDestination -Force
    if((Get-FileHash $taskFile.FullName).Hash -ne (Get-FileHash $taskDestination).Hash){throw 'Installed file failed verification.'}
  }
  $taskRecord.status='ready_to_start';$taskRecord.error=$null
  $taskRecord | ConvertTo-Json | Set-Content -LiteralPath $taskReport
  Write-Output 'All installed files match the tested final build.'
  $taskLaunched=Start-Process -FilePath (Join-Path $taskInstall 'Mitch.exe') -WorkingDirectory $taskRoot -WindowStyle Hidden -Verb RunAs -PassThru
  $taskRecord.status='installed';$taskRecord | Add-Member -NotePropertyName pid -NotePropertyValue $taskLaunched.Id -Force
} catch {
  $taskRecord.status='failed';$taskRecord.error=$_.Exception.Message
  throw
} finally {
  $taskRecord | ConvertTo-Json | Set-Content -LiteralPath $taskReport
}
