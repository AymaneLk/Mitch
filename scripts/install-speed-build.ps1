$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$taskOutputs = Join-Path $taskRoot 'outputs'
$taskSource = [IO.Path]::GetFullPath((Join-Path $taskOutputs 'speed-build\Mitch-win32-x64'))
$taskInstall = [IO.Path]::GetFullPath((Join-Path $taskOutputs 'playback-fix-build\Mitch-win32-x64'))
$taskBackup = [IO.Path]::GetFullPath((Join-Path $taskOutputs ('backups\before-speed-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))))
$taskReport = Join-Path $taskRoot 'test-output\speed-deployment.json'
$taskRecord = @{status='starting';version='0.6.0-local.24';backup=$taskBackup;install=$taskInstall}
function Stop-InstalledMitch([string]$taskTargetExe) {
  # Re-enumerate after exit: Electron may have created a child after the first
  # snapshot. Never terminate an unidentified process just because of its name.
  for ($taskPass=0;$taskPass -lt 3;$taskPass++) {
    $taskStopped=0
    foreach ($taskProcess in @(Get-Process -Name Mitch -ErrorAction SilentlyContinue)) {
      try {
        if ($taskProcess.HasExited) { continue }
        $taskProcessPath=$null
        try { $taskProcessPath=$taskProcess.Path } catch {}
        if (!$taskProcessPath) {
          $taskProcessPath=(Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = '+$taskProcess.Id) -ErrorAction Stop).ExecutablePath
        }
        if (!$taskProcessPath) {
          if ($taskProcess.HasExited) { continue }
          throw ('Cannot verify the executable path of Mitch process '+$taskProcess.Id+'. Installation stopped before replacing files.')
        }
        if (![string]::Equals([IO.Path]::GetFullPath($taskProcessPath),$taskTargetExe,[StringComparison]::OrdinalIgnoreCase)) { continue }
        try { $taskProcess.Kill() } catch { if (!$taskProcess.HasExited) { throw } }
        if (!$taskProcess.WaitForExit(10000)) { throw ('Mitch process '+$taskProcess.Id+' did not exit. Installation stopped before replacing files.') }
        $taskStopped++
      } finally { $taskProcess.Dispose() }
    }
    if (!$taskStopped) { return }
  }
  throw 'Mitch kept starting new processes. Installation stopped before replacing files.'
}
function Copy-TestedFile([string]$taskFrom,[string]$taskTo) {
  # A terminated executable can retain a short-lived image-section/file lock.
  # Retry only Windows sharing/locking violations, never permission/path errors.
  for ($taskAttempt=0;$taskAttempt -lt 20;$taskAttempt++) {
    try { Copy-Item -LiteralPath $taskFrom -Destination $taskTo -Force -ErrorAction Stop;return }
    catch {
      $taskException=$_.Exception;$taskLocked=$false
      while ($taskException) {
        if (($taskException.HResult -band 65535) -in @(32,33)) { $taskLocked=$true;break }
        $taskException=$taskException.InnerException
      }
      if (!$taskLocked -or $taskAttempt -eq 19) { throw }
      Start-Sleep -Milliseconds 250
    }
  }
}
try {
  foreach ($taskDirectory in @($taskSource,$taskInstall,$taskBackup)) {
    if (!$taskDirectory.StartsWith($taskOutputs + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Deployment path is outside the workspace outputs.' }
  }
  if ((Get-Content (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version -ne $taskRecord.version) { throw 'Unexpected source version.' }
  if ((Get-FileHash (Join-Path $taskSource 'resources\app.asar')).Hash -ne '7B4CF133A53154CA1E98A81262A8ECC800335B48EB93AD718180075584F6D6B6') { throw 'The tested v24 build changed.' }
  $taskRecord.status='testing'
  $taskRecord | ConvertTo-Json | Set-Content -LiteralPath $taskReport
  foreach ($taskFlags in @(@('--smoke-test'),@('--smoke-test','--provider-settings-test'))) {
    $taskProbe=Start-Process -FilePath (Join-Path $taskSource 'Mitch.exe') -ArgumentList $taskFlags -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru
    if (!$taskProbe.WaitForExit(60000)) { Stop-Process -Id $taskProbe.Id -Force -ErrorAction SilentlyContinue;throw 'The packaged test did not finish within its deadline.' }
    $taskProbe.Refresh()
    if ($taskProbe.ExitCode -ne 0) { throw 'The packaged test failed; the existing installation was preserved.' }
  }
  $taskFolderCheck=Get-Content (Join-Path $taskRoot 'test-output\chatgpt-settings-result.json') -Raw | ConvertFrom-Json
  if ($taskFolderCheck.status -ne 'passed' -or $taskFolderCheck.version -ne $taskRecord.version) { throw 'The packaged ChatGPT settings check must pass before installation.' }
  $taskSmoke = Get-Content (Join-Path $taskRoot 'test-output\smoke-result.json') -Raw | ConvertFrom-Json
  if ($taskSmoke.status -ne 'passed' -or $taskSmoke.version -ne $taskRecord.version -or !$taskSmoke.packaged) { throw 'The packaged v24 smoke test must pass before installation.' }
  $taskExe = Join-Path $taskInstall 'Mitch.exe'
  New-Item -ItemType Directory -Path $taskBackup | Out-Null
  Copy-Item -LiteralPath $taskExe -Destination (Join-Path $taskBackup 'Mitch.exe')
  Copy-Item -LiteralPath (Join-Path $taskInstall 'resources') -Destination (Join-Path $taskBackup 'resources') -Recurse
  Stop-InstalledMitch $taskExe
  Copy-TestedFile (Join-Path $taskSource 'Mitch.exe') $taskExe
  foreach ($taskFile in Get-ChildItem -LiteralPath (Join-Path $taskSource 'resources') -File -Recurse) {
    $taskRelative = $taskFile.FullName.Substring((Join-Path $taskSource 'resources').Length + 1)
    $taskDestination = [IO.Path]::GetFullPath((Join-Path (Join-Path $taskInstall 'resources') $taskRelative))
    if (!$taskDestination.StartsWith($taskInstall + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Resource path left the installation.' }
    New-Item -ItemType Directory -Force -Path (Split-Path $taskDestination -Parent) | Out-Null
    Copy-TestedFile $taskFile.FullName $taskDestination
  }
  foreach ($taskRelative in @('Mitch.exe','resources\app.asar','resources\app.asar.unpacked\native-state-signals.ps1')) {
    if ((Get-FileHash (Join-Path $taskSource $taskRelative)).Hash -ne (Get-FileHash (Join-Path $taskInstall $taskRelative)).Hash) { throw 'Installed artifact differs from tested build.' }
  }
  $taskLaunched = Start-Process -FilePath $taskExe -ArgumentList @("--settings") -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru
  $taskRecord.status='installed';$taskRecord.pid=$taskLaunched.Id
} catch {
  $taskRecord.status='failed';$taskRecord.error=$_.Exception.Message
  throw
} finally {
  $taskRecord | ConvertTo-Json | Set-Content -LiteralPath $taskReport
}
