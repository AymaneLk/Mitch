$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$taskAttempted = $false

function Local-FolderPath([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value) -or $value.Length -gt 2048 -or $value -notmatch '^[A-Za-z]:[\\/]' -or $value -match '[\x00-\x1f<>"|?*]' -or $value.Substring(2).Contains(':')) { throw 'Use an ordinary absolute local folder path.' }
  $resolved = [IO.Path]::GetFullPath($value)
  if ($resolved.Length -gt 3) { $resolved = $resolved.TrimEnd('\') }
  foreach ($segment in $resolved.Split('\')) { if ($segment -and $segment -match '[. ]$') { throw 'Trailing dots or spaces are not supported.' } }
  return $resolved
}
function Same-Path([string]$left,[string]$right) { return [string]::Equals($left,$right,[StringComparison]::OrdinalIgnoreCase) }
function Folder-Name([string]$value) { $name=[IO.Path]::GetFileName($value.TrimEnd('\'));if (!$name) {return $value};return $name }
function Explorer-Inventory($shell) {
  $result = [Collections.Generic.List[object]]::new()
  $complete=$true
  try { $windows=$shell.Windows();if($null -eq $windows){return @{rows=@();complete=$false}} } catch { return @{rows=@();complete=$false} }
  try {
    foreach ($window in $windows) {
      if ($result.Count -ge 512) { $complete=$false;break }
      $windowId=$null
      try {
        $application=[IO.Path]::GetFileName([string]$window.FullName)
        if (!$application) { throw 'Missing application identity.' }
        if ($application -ine 'explorer.exe') { continue }
        $windowId=[long]$window.HWND
        if ($windowId -le 0 -or $windowId -gt 9007199254740991) { $windowId=$null;throw 'Invalid Explorer window handle.' }
        $self=$window.Document.Folder.Self
        if ($null -eq $self -or $null -eq $self.IsFileSystem -or $null -eq $self.IsFolder) { throw 'Missing Explorer folder identity.' }
        # Home, This PC and other namespace tabs still occupy this HWND. Keep
        # them so a second filesystem tab cannot falsely prove the active tab.
        if (!$self.IsFileSystem -or !$self.IsFolder) { $result.Add(@{path=$null;window_id=$windowId;kind='namespace'});continue }
        $folderPath=Local-FolderPath ([string]$self.Path)
        if (![IO.Directory]::Exists($folderPath)) { throw 'Explorer folder is no longer available.' }
        $result.Add(@{path=$folderPath;window_id=$windowId;kind='filesystem'})
      } catch {
        $complete=$false
        if ($null -eq $windowId) { try { $value=[long]$window.HWND;if($value -gt 0 -and $value -le 9007199254740991){$windowId=$value} } catch {} }
        $result.Add(@{path=$null;window_id=$windowId;kind='unknown'})
      }
    }
  } catch { $complete=$false }
  return @{rows=@($result.ToArray());complete=$complete}
}
function Unambiguous-FolderWindows($inventory,[string]$destination) {
  # Some Explorer versions expose several tab COM objects for one HWND. A
  # foreground HWND alone cannot prove which differing folder tab is active.
  # An incomplete inventory cannot prove either uniqueness or absence.
  if ($inventory.complete -ne $true) { return @() }
  $rows=@($inventory.rows)
  return @($rows | Where-Object {
    $candidate=$_
    $candidate.kind -eq 'filesystem' -and (Same-Path $candidate.path $destination) -and @($rows | Where-Object { $_.window_id -eq $candidate.window_id -and ($_.kind -ne 'filesystem' -or !(Same-Path $_.path $destination)) }).Count -eq 0
  })
}
function Folder-OpenPlan($inventory,[string]$destination) {
  if (!$inventory.complete) { return @{status='refused';verified=$false;action_attempted=$false;code='folder_inventory_incomplete';message='Windows could not inspect every Explorer window. No folder was opened or focused.'} }
  $candidates=@(Unambiguous-FolderWindows $inventory $destination)
  if (!$candidates.Count -and @($inventory.rows | Where-Object { $_.kind -eq 'filesystem' -and (Same-Path $_.path $destination) }).Count) { return @{status='refused';verified=$false;action_attempted=$false;code='folder_tab_ambiguous';message='This folder shares an Explorer window with other observed folder tabs. Select its tab before trying again; no input was sent.'} }
  return @{status='ready';candidates=$candidates;reused=($candidates.Count -gt 0)}
}
function Reply($value) { $value | ConvertTo-Json -Depth 10 -Compress;exit }

try {
  $request=[Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.action -notin @('discover','open')) { throw 'Unsupported folder operation.' }
  $shell=New-Object -ComObject Shell.Application
  if ($request.action -eq 'discover') {
    if ($request.query -isnot [string] -or [string]::IsNullOrWhiteSpace($request.query) -or $request.query.Length -gt 2048 -or $request.query -match '[\x00-\x1f<>"|?*]') { throw 'Use one folder name or an absolute local folder path.' }
    $query=[string]$request.query
    $inventory=Explorer-Inventory $shell
    $open=@($inventory.rows | Where-Object { $_.kind -eq 'filesystem' })
    $taskMatches=@{}
    if ($query -match '^[A-Za-z]:[\\/]') {
      $exact=Local-FolderPath $query
      if ([IO.Directory]::Exists($exact)) { $taskMatches[$exact.ToLowerInvariant()]=@{path=$exact;name=(Folder-Name $exact);open_windows=@($open | Where-Object { Same-Path $_.path $exact } | ForEach-Object { $_.window_id })} }
      Reply @{status='ok';complete=$true;matches=@($taskMatches.Values);search_scope='The explicitly requested local folder path.'}
    }
    if ($query -match '[\\/:]' -or $query -match '[. ]$' -or $query -in @('.','..')) { throw 'Use a folder name or an absolute local path.' }
    foreach ($row in $open) {
      if ((Folder-Name $row.path) -ine $query) { continue }
      $key=$row.path.ToLowerInvariant()
      if (!$taskMatches.ContainsKey($key)) { $taskMatches[$key]=@{path=$row.path;name=(Folder-Name $row.path);open_windows=@()} }
      $taskMatches[$key].open_windows+=@($row.window_id)
    }
    if ($taskMatches.Count -or !$inventory.complete) { Reply @{status='ok';complete=[bool]$inventory.complete;truncated=(!$inventory.complete);matches=@($taskMatches.Values | Sort-Object path);search_scope='Exact folder names currently open in File Explorer.';message=$(if($inventory.complete){'The observed Explorer inventory is complete.'}else{'Windows could not inspect every Explorer window. No folder was selected or opened.'})} }

    $roots=[Collections.Generic.List[object]]::new()
    foreach ($entry in @(@{path=[Environment]::GetFolderPath('DesktopDirectory');depth=3},@{path=[Environment]::GetFolderPath('MyDocuments');depth=3},@{path=[Environment]::GetFolderPath('UserProfile');depth=1})) {
      if ($entry.path -and [IO.Directory]::Exists($entry.path)) { $roots.Add($entry) }
    }
    try {
      $downloadValue=(Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders').'{374DE290-123F-4565-9164-39C4925E467B}'
      $downloads=[Environment]::ExpandEnvironmentVariables([string]$downloadValue)
      if ($downloads -and [IO.Directory]::Exists($downloads)) { $roots.Add(@{path=$downloads;depth=3}) }
    } catch {}
    # The normal user request is usually a folder immediately under a known
    # location. Search that declared tier completely before deeper traversal.
    # A hit here does not imply that every drive was searched.
    $directComplete=$true;$directSeen=@{};$directScanned=0;$directClock=[Diagnostics.Stopwatch]::StartNew()
    foreach ($entry in $roots) {
      if ($directScanned -ge 2500 -or $directClock.ElapsedMilliseconds -ge 1800) { $directComplete=$false;break }
      try {
        $parent=[IO.DirectoryInfo]::new((Local-FolderPath $entry.path))
        if ($directSeen.ContainsKey($parent.FullName.ToLowerInvariant())) { continue }
        $directSeen[$parent.FullName.ToLowerInvariant()]=$true
        if ($parent.Name -ieq $query) { $taskMatches[$parent.FullName.ToLowerInvariant()]=@{path=$parent.FullName;name=$parent.Name;open_windows=@()} }
        foreach ($child in $parent.EnumerateDirectories()) {
          $directScanned++
          if ($child.Name -ieq $query) { $taskMatches[$child.FullName.ToLowerInvariant()]=@{path=$child.FullName;name=$child.Name;open_windows=@()} }
          if ($taskMatches.Count -ge 24 -or $directScanned -ge 2500 -or $directClock.ElapsedMilliseconds -ge 1800) { $directComplete=$false;break }
        }
      } catch { $directComplete=$false }
    }
    if ($taskMatches.Count -or !$directComplete) { Reply @{status='ok';complete=$directComplete;truncated=(!$directComplete);matches=@($taskMatches.Values | Sort-Object path);search_scope='Exact folder names directly inside Desktop, Documents, Downloads and the user home folder.';message=$(if($directComplete){'This search covers the declared known-location tier, not all drives.'}else{'The direct-folder search was incomplete. Supply the full folder path instead of guessing.'})} }
    $queue=[Collections.Generic.Queue[object]]::new();$seen=@{};$complete=$true;$scanned=0;$clock=[Diagnostics.Stopwatch]::StartNew()
    foreach ($entry in $roots) { $queue.Enqueue(@{path=(Local-FolderPath $entry.path);depth=0;limit=$entry.depth}) }
    while ($queue.Count) {
      if ($clock.ElapsedMilliseconds -ge 1800 -or $scanned -ge 2500 -or $taskMatches.Count -ge 24) { $complete=$false;break }
      $item=$queue.Dequeue();$key=$item.path.ToLowerInvariant()
      if ($seen.ContainsKey($key) -and $seen[$key] -ge ($item.limit-$item.depth)) { continue }
      $seen[$key]=$item.limit-$item.depth;$scanned++
      try {
        $info=[IO.DirectoryInfo]::new($item.path)
        if (!$info.Exists) { continue }
        if ($info.Name -ieq $query) { $taskMatches[$key]=@{path=$info.FullName;name=$info.Name;open_windows=@()} }
        if ($item.depth -ge $item.limit -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint)) { continue }
        foreach ($child in $info.EnumerateDirectories()) {
          if ($child.Name -in @('node_modules','.git','.codex','.agents','AppData','$RECYCLE.BIN','System Volume Information')) { continue }
          if ($child.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
          $queue.Enqueue(@{path=$child.FullName;depth=($item.depth+1);limit=$item.limit})
          if ($queue.Count -ge 5000 -or $clock.ElapsedMilliseconds -ge 1800) { $complete=$false;break }
        }
        if (!$complete) { break }
      } catch { $complete=$false }
    }
    Reply @{status='ok';complete=$complete;truncated=(!$complete);matches=@($taskMatches.Values | Sort-Object path);search_scope='Exact names in Desktop, Documents and Downloads through three folder levels, plus direct home folders; no links or system directories traversed.';scanned=$scanned;message=$(if($complete){'This bounded search does not cover every drive. Supply a full path for a folder elsewhere.'}else{'The bounded search could not finish. Supply the full folder path instead of guessing.'})}
  }

  if ($request.path -isnot [string]) { throw 'Choose an observed folder path.' }
  $destination=Local-FolderPath $request.path
  if (![IO.Directory]::Exists($destination)) { Reply @{status='refused';verified=$false;action_attempted=$false;code='folder_missing';message='The observed folder no longer exists.'} }
  Add-Type @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
public static class MitchFolderFocus {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
 [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
 [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window,int command);
 [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
 [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint from,uint to,bool attach);
 public static bool Focus(long id) {
   var window=new IntPtr(id);uint pid;var targetThread=GetWindowThreadProcessId(window,out pid);
   if(!IsWindow(window)||targetThread==0||!String.Equals(Process.GetProcessById((int)pid).ProcessName,"explorer",StringComparison.OrdinalIgnoreCase)) return false;
   if(IsIconic(window)) ShowWindowAsync(window,9);
   SetForegroundWindow(window);
   if(GetForegroundWindow()==window) return true;
   uint foregroundPid;var foregroundThread=GetWindowThreadProcessId(GetForegroundWindow(),out foregroundPid);var ownThread=GetCurrentThreadId();bool attached=false;
   try { if(foregroundThread!=0&&foregroundThread!=ownThread) attached=AttachThreadInput(ownThread,foregroundThread,true);SetForegroundWindow(window); }
   finally { if(attached) AttachThreadInput(ownThread,foregroundThread,false); }
   for(int i=0;i<10;i++){if(GetForegroundWindow()==window)return true;Thread.Sleep(25);}return false;
 }
}
'@
  $allBefore=Explorer-Inventory $shell
  $openPlan=Folder-OpenPlan $allBefore $destination
  if ($openPlan.status -eq 'refused') { Reply $openPlan }
  $reused=$openPlan.reused
  if (!$reused) { $taskAttempted=$true;$shell.Open($destination) }
  $clock=[Diagnostics.Stopwatch]::StartNew();$selected=$null
  do {
    $current=@(Unambiguous-FolderWindows (Explorer-Inventory $shell) $destination)
    if ($current.Count) { $foreground=[MitchFolderFocus]::GetForegroundWindow().ToInt64();$selected=@($current | Sort-Object @{Expression={if($_.window_id -eq $foreground){0}else{1}}},window_id)[0];break }
    Start-Sleep -Milliseconds 80
  } while ($clock.ElapsedMilliseconds -lt 3500)
  if (!$selected) { Reply @{status='unverified';verified=$false;action_attempted=$taskAttempted;outcome_unknown=$taskAttempted;path=$destination;foreground_verified=$false;code='folder_open_unconfirmed'} }
  $taskAttempted=$true;$focused=[MitchFolderFocus]::Focus([long]$selected.window_id)
  $after=@(Unambiguous-FolderWindows (Explorer-Inventory $shell) $destination | Where-Object { $_.window_id -eq $selected.window_id })
  $verified=$focused -and $after.Count -gt 0 -and [MitchFolderFocus]::GetForegroundWindow().ToInt64() -eq $selected.window_id
  Reply @{status=$(if($verified){if($reused){'focused_existing'}else{'opened'}}else{'unverified'});verified=[bool]$verified;action_attempted=$true;path=$destination;window_id=[long]$selected.window_id;foreground_verified=[bool]$verified;outcome_unknown=$false;code=$(if($verified){'folder_verified'}else{'folder_focus_unconfirmed'})}
} catch {
  @{status=$(if($taskAttempted){'unverified'}else{'refused'});verified=$false;action_attempted=$taskAttempted;outcome_unknown=$taskAttempted;code=$(if($taskAttempted){'folder_outcome_unknown'}else{'folder_refused'});message=$(if($taskAttempted){'Windows did not confirm the exact folder operation. No retry was sent.'}else{$_.Exception.Message})} | ConvertTo-Json -Depth 5 -Compress
  exit 1
}
