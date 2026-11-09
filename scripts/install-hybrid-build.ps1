$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$taskOutputs = Join-Path $taskRoot 'outputs'
$taskSource = [IO.Path]::GetFullPath((Join-Path $taskOutputs 'hybrid-build\Mitch-win32-x64'))
$taskInstall = [IO.Path]::GetFullPath((Join-Path $taskOutputs 'playback-fix-build\Mitch-win32-x64'))
$taskBackup = [IO.Path]::GetFullPath((Join-Path $taskOutputs ('backups\before-hybrid-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))))
$taskReport = Join-Path $taskRoot 'test-output\hybrid-deployment.json'
$taskRecord = @{status='starting';version='0.6.0-local.20';backup=$taskBackup;install=$taskInstall}
try {
  foreach ($taskDirectory in @($taskSource,$taskInstall,$taskBackup)) {
    if (!$taskDirectory.StartsWith($taskOutputs + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Deployment path is outside the workspace outputs.' }
  }
  if ((Get-Content (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version -ne $taskRecord.version) { throw 'Unexpected source version.' }
  $taskSmoke = Get-Content (Join-Path $taskRoot 'test-output\smoke-result.json') -Raw | ConvertFrom-Json
  if ($taskSmoke.status -ne 'passed' -or $taskSmoke.version -ne $taskRecord.version -or !$taskSmoke.packaged) { throw 'The packaged v20 smoke test must pass before installation.' }
  $taskExe = Join-Path $taskInstall 'Mitch.exe'
  New-Item -ItemType Directory -Path $taskBackup | Out-Null
  Copy-Item -LiteralPath $taskExe -Destination (Join-Path $taskBackup 'Mitch.exe')
  Copy-Item -LiteralPath (Join-Path $taskInstall 'resources') -Destination (Join-Path $taskBackup 'resources') -Recurse
  $taskProcesses = @(Get-Process -Name Mitch -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $taskExe })
  foreach ($taskProcess in $taskProcesses) { Stop-Process -Id $taskProcess.Id -Force -ErrorAction SilentlyContinue }
  foreach ($taskProcess in $taskProcesses) { Wait-Process -Id $taskProcess.Id -Timeout 10 -ErrorAction SilentlyContinue }
  Copy-Item -LiteralPath (Join-Path $taskSource 'Mitch.exe') -Destination $taskExe -Force
  foreach ($taskFile in Get-ChildItem -LiteralPath (Join-Path $taskSource 'resources') -File -Recurse) {
    $taskRelative = $taskFile.FullName.Substring((Join-Path $taskSource 'resources').Length + 1)
    $taskDestination = [IO.Path]::GetFullPath((Join-Path (Join-Path $taskInstall 'resources') $taskRelative))
    if (!$taskDestination.StartsWith($taskInstall + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Resource path left the installation.' }
    New-Item -ItemType Directory -Force -Path (Split-Path $taskDestination -Parent) | Out-Null
    Copy-Item -LiteralPath $taskFile.FullName -Destination $taskDestination -Force
  }
  foreach ($taskRelative in @('Mitch.exe','resources\app.asar')) {
    if ((Get-FileHash (Join-Path $taskSource $taskRelative)).Hash -ne (Get-FileHash (Join-Path $taskInstall $taskRelative)).Hash) { throw 'Installed artifact differs from tested build.' }
  }
  $taskLaunched = Start-Process -FilePath $taskExe -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru
  $taskRecord.status='installed';$taskRecord.pid=$taskLaunched.Id
} catch {
  $taskRecord.status='failed';$taskRecord.error=$_.Exception.Message
  throw
} finally {
  $taskRecord | ConvertTo-Json | Set-Content -LiteralPath $taskReport
}
