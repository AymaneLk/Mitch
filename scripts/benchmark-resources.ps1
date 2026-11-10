param([int]$RootPid,[string]$ControlFile)
$ErrorActionPreference='Stop'
$taskSamplePid=$PID
while ($true) {
  $taskControl=Get-Content -LiteralPath $ControlFile -Raw | ConvertFrom-Json
  if ($taskControl.stop) { break }
  $taskRows=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId)
  $taskIds=[Collections.Generic.HashSet[int]]::new();$null=$taskIds.Add($RootPid)
  do {
    $taskAdded=$false
    foreach ($taskRow in $taskRows) {
      if ($taskRow.ProcessId -ne $taskSamplePid -and $taskIds.Contains([int]$taskRow.ParentProcessId) -and $taskIds.Add([int]$taskRow.ProcessId)) { $taskAdded=$true }
    }
  } while ($taskAdded)
  $taskProcesses=@(Get-Process -Id @($taskIds) -ErrorAction SilentlyContinue | ForEach-Object {
    try { @{pid=$_.Id;cpu=$_.TotalProcessorTime.TotalSeconds;rss=$_.WorkingSet64} } finally { $_.Dispose() }
  })
  @{at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();processes=$taskProcesses} | ConvertTo-Json -Compress -Depth 4
  Start-Sleep -Milliseconds 400
}
