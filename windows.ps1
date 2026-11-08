$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.action -eq 'privileges') {
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    @{status='ok';administrator=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)} | ConvertTo-Json -Compress
    exit
  }
  if ($request.action -eq 'apps') {
    $apps = @(Get-StartApps | ForEach-Object { @{name=$_.Name; id=$_.AppID} })
    @{status='ok';apps=$apps} | ConvertTo-Json -Depth 5 -Compress
    exit
  }
  if ($request.action -eq 'restore_window') {
    if (($request.pid -isnot [int] -and $request.pid -isnot [long]) -or $request.pid -le 0 -or $request.pid -gt [uint32]::MaxValue) { throw 'Restore requires an exact numeric process id.' }
    if (($request.window_id -isnot [int] -and $request.window_id -isnot [long]) -or $request.window_id -le 0 -or $request.window_id -gt 9007199254740991) { throw 'Restore requires an exact numeric window id.' }
    if ($request.expected_title -isnot [string] -or [string]::IsNullOrWhiteSpace($request.expected_title) -or $request.expected_title.Length -gt 1000) { throw 'Restore requires the exact observed window title.' }
    Add-Type @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class PixieWindowRestore {
 [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindow(IntPtr hwnd);
 [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsIconic(IntPtr hwnd);
 [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder title, int capacity);
 [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool ShowWindowAsync(IntPtr hwnd, int command);
 private static void Verify(IntPtr hwnd, uint expectedPid, string expectedTitle) {
   uint actualPid;
   if (!IsWindow(hwnd) || GetWindowThreadProcessId(hwnd, out actualPid) == 0 || actualPid != expectedPid)
     throw new InvalidOperationException("The target window changed or closed. Discover it again before restoring.");
   var title = new StringBuilder(1002);
   GetWindowText(hwnd, title, title.Capacity);
   if (!String.Equals(title.ToString(), expectedTitle, StringComparison.Ordinal))
     throw new InvalidOperationException("The target window title changed. Discover it again before restoring.");
 }
 public static bool Restore(long windowId, uint expectedPid, string expectedTitle) {
   var hwnd = new IntPtr(windowId);
   Verify(hwnd, expectedPid, expectedTitle);
   if (!IsIconic(hwnd)) return false;
   Verify(hwnd, expectedPid, expectedTitle);
   if (!ShowWindowAsync(hwnd, 9)) throw new InvalidOperationException("Windows could not request restoration of this window.");
   var elapsed = Stopwatch.StartNew();
   while (true) {
     Verify(hwnd, expectedPid, expectedTitle);
     if (!IsIconic(hwnd)) return true;
     if (elapsed.ElapsedMilliseconds >= 1000) throw new TimeoutException("Window restoration did not finish within one second. Discover it again.");
     Thread.Sleep(50);
   }
 }
}
'@
    $restored = [PixieWindowRestore]::Restore([long]$request.window_id, [uint32]$request.pid, $request.expected_title)
    @{status='ok';restored=$restored;minimized=$false;pid=[long]$request.pid;window_id=[long]$request.window_id} | ConvertTo-Json -Compress
    exit
  }
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WinKeys {
 [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte scan, uint flags, UIntPtr extra);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
 [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
 [DllImport("user32.dll", EntryPoint="GetWindowLongW")] static extern int GetWindowLong(IntPtr hwnd, int index);
 [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode)] static extern IntPtr SendText(IntPtr hwnd,uint msg,IntPtr w,string text,uint flags,uint timeout,out UIntPtr result);
 [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode)] static extern IntPtr ReadText(IntPtr hwnd,uint msg,IntPtr w,StringBuilder text,uint flags,uint timeout,out UIntPtr result);
 [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW")] static extern IntPtr SendNumber(IntPtr hwnd,uint msg,IntPtr w,IntPtr l,uint flags,uint timeout,out UIntPtr result);
 public static string ClassName(IntPtr hwnd) {var value=new StringBuilder(256);GetClassName(hwnd,value,256);return value.ToString();}
 public static bool Password(IntPtr hwnd) {long style=IntPtr.Size==8?GetWindowLongPtr(hwnd,-16).ToInt64():GetWindowLong(hwnd,-16);return (style & 0x20)!=0;}
 public static bool ReadOnly(IntPtr hwnd) {long style=IntPtr.Size==8?GetWindowLongPtr(hwnd,-16).ToInt64():GetWindowLong(hwnd,-16);return (style & 0x0800)!=0;}
 public static void SetText(IntPtr hwnd,string text) {UIntPtr result;if(SendText(hwnd,0x000C,IntPtr.Zero,text,2,3000,out result)==IntPtr.Zero)throw new Exception("Text entry timed out.");}
 public static string Text(IntPtr hwnd) {UIntPtr result;var text=new StringBuilder(16000);if(ReadText(hwnd,0x000D,new IntPtr(text.Capacity),text,2,3000,out result)==IntPtr.Zero)throw new Exception("Text verification timed out.");return text.ToString();}
 public static void Click(IntPtr hwnd) {UIntPtr result;if(SendNumber(hwnd,0x00F5,IntPtr.Zero,IntPtr.Zero,2,3000,out result)==IntPtr.Zero)throw new Exception("Button activation timed out.");}
}
'@
  function Native-Control($element) {
    $handle=[IntPtr]$element.Current.NativeWindowHandle
    $class=if($handle -ne [IntPtr]::Zero){[WinKeys]::ClassName($handle)}else{''}
    $edit=$class -match '(^Edit$|\.EDIT\.)'
    $button=$class -match '(^Button$|\.BUTTON\.)'
    @{handle=$handle;edit=$edit;button=$button;password=($element.Current.IsPassword -or ($edit -and [WinKeys]::Password($handle)))}
  }
  if ($request.action -eq 'media') {
    $keys = @{play_pause=179;next=176;previous=177;stop=178;volume_up=175;volume_down=174;mute=173}
    if (-not $keys.ContainsKey([string]$request.key)) { throw 'Unsupported media key.' }
    [WinKeys]::keybd_event([byte]$keys[$request.key],0,0,[UIntPtr]::Zero)
    [WinKeys]::keybd_event([byte]$keys[$request.key],0,2,[UIntPtr]::Zero)
    @{status='key_sent';action=$request.key} | ConvertTo-Json -Compress
    exit
  }
  $windows = @(Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | ForEach-Object {
    @{pid=$_.Id;process=$_.ProcessName;title=$_.MainWindowTitle;handle=$_.MainWindowHandle.ToInt64().ToString()}
  })
  if ($request.action -eq 'inspect') {
    $query = [string]$request.query
    if ([string]::IsNullOrWhiteSpace($query)) { @{status='windows';windows=$windows}|ConvertTo-Json -Depth 6 -Compress; exit }
    $matches = @($windows | Where-Object {$_.process -ieq $query -or $_.title -ieq $query})
    if ($matches.Count -eq 0) { $matches = @($windows | Where-Object {$_.process.IndexOf($query,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or $_.title.IndexOf($query,[StringComparison]::OrdinalIgnoreCase) -ge 0}) }
    if ($matches.Count -ne 1) { @{status='choose_window';windows=$matches}|ConvertTo-Json -Depth 6 -Compress; exit }
    $window=$matches[0]
    $root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$window.handle)
  } elseif ($request.action -in @('click','type')) {
    $process = Get-Process -Id ([int]$request.pid)
    if ($process.MainWindowHandle.ToInt64().ToString() -ne [string]$request.handle) { throw 'The target window changed. Inspect it again.' }
    $root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$request.handle)
  } else { throw 'Unsupported Windows action.' }
  $walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
  $stack=[System.Collections.Generic.Stack[System.Windows.Automation.AutomationElement]]::new()
  $stack.Push($root)
  $controls=[System.Collections.Generic.List[object]]::new()
  $target=$null; $visited=0
  while ($stack.Count -gt 0 -and $visited -lt 600) {
    $element=$stack.Pop(); $visited++
    try {
      $current=$element.Current
      $native=Native-Control $element
      $id=($element.GetRuntimeId() -join '.')
      if ($request.action -ne 'inspect' -and $id -eq [string]$request.control_id) { $target=$element; break }
      if ($request.action -eq 'inspect' -and -not $current.IsOffscreen) {
        $name=if($native.password){'[password field]'}else{[string]$current.Name}
        if ($name.Length -gt 1000) {$name=$name.Substring(0,1000)}
        $controlType=if($native.edit){'Win32.Edit'}elseif($native.button){'Win32.Button'}else{$current.ControlType.ProgrammaticName}
        $controls.Add(@{id=$id;name=$name;type=$controlType;enabled=$current.IsEnabled;password=$native.password})
      }
      # Do not descend into password controls or expose their values.
      if (-not $native.password) {
        $child=$walker.GetFirstChild($element); $siblings=0
        while ($null -ne $child -and $siblings -lt 200) {$stack.Push($child);$child=$walker.GetNextSibling($child);$siblings++}
      }
    } catch { continue }
  }
  if ($request.action -eq 'inspect') {
    @{status='inspected';window=$window;controls=@($controls.ToArray());truncated=($visited -ge 600)} | ConvertTo-Json -Depth 8 -Compress
  } else {
    if ($null -eq $target) { throw 'Control no longer exists. Inspect the app again.' }
    $native=Native-Control $target
    if ($native.password) { throw 'Password controls are excluded.' }
    if (-not $target.Current.IsEnabled -or $target.Current.IsOffscreen) { throw 'The control is disabled or off-screen.' }
    if ($request.action -eq 'click') {
      if ([string]$target.Current.Name -cne [string]$request.expected_name) { throw 'The control label changed. Inspect it again.' }
      $pattern=$null
      if ($target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) { $pattern.Invoke() }
      elseif ($target.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$pattern)) { $pattern.Select() }
      elseif ($target.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$pattern)) { $pattern.Toggle() }
      elseif ($native.button) { [WinKeys]::Click($native.handle) }
      else { throw 'This app does not expose an accessible click action for the control.' }
      @{status='activated';name=$request.expected_name}|ConvertTo-Json -Compress
    } else {
      $pattern=$null
      if ($target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)) {
        if ($pattern.Current.IsReadOnly) { throw 'This field is read-only.' }
        $pattern.SetValue([string]$request.text)
        if ($pattern.Current.Value -cne [string]$request.text) { throw 'The control did not retain the expected text.' }
      } elseif ($native.edit) {
        if ([WinKeys]::ReadOnly($native.handle)) { throw 'This field is read-only.' }
        [WinKeys]::SetText($native.handle,[string]$request.text)
        if ([WinKeys]::Text($native.handle) -cne [string]$request.text) { throw 'The control did not retain the expected text.' }
      } else { throw 'This app does not expose editable text here. Use dictation Copy, then paste yourself.' }
      @{status='text_set';characters=([string]$request.text).Length}|ConvertTo-Json -Compress
    }
  }
} catch {
  @{status='error';message=$_.Exception.Message}|ConvertTo-Json -Compress
  exit 1
}
