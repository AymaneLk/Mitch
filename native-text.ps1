$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type -ReferencedAssemblies UIAutomationClient,UIAutomationTypes -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Windows.Automation;
public static class MitchNativeText {
 public static bool Attempted;
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent,IntPtr child);
 [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr hwnd);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,StringBuilder text,int length);
 [DllImport("user32.dll",EntryPoint="GetWindowLongW")] static extern int GetStyle(IntPtr hwnd,int index);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SendMessageTimeoutW")] static extern IntPtr ReadMessage(IntPtr hwnd,uint msg,IntPtr wParam,StringBuilder text,uint flags,uint timeout,out IntPtr result);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SendMessageTimeoutW")] static extern IntPtr WriteMessage(IntPtr hwnd,uint msg,IntPtr wParam,string text,uint flags,uint timeout,out IntPtr result);
 static string Read(IntPtr hwnd) {
  var text=new StringBuilder(12002);IntPtr count;
  if(ReadMessage(hwnd,13,new IntPtr(text.Capacity),text,3,1000,out count)==IntPtr.Zero)throw new Exception("Text read timed out.");
  if(count.ToInt64()>12000)throw new Exception("Text exceeds the bounded read.");return text.ToString();
 }
 static void Check(IntPtr top,IntPtr field,int pid) {
  uint p;GetWindowThreadProcessId(top,out p);if(p!=pid)throw new Exception("Top window identity changed.");
  GetWindowThreadProcessId(field,out p);if(p!=pid||(!IsChild(top,field)&&top!=field))throw new Exception("Text control left the exact window.");
  var cls=new StringBuilder(256);GetClassName(field,cls,cls.Capacity);
  if(!String.Equals(cls.ToString(),"Edit",StringComparison.OrdinalIgnoreCase))throw new Exception("No supported native Edit capability.");
  if(!IsWindowEnabled(field)||(GetStyle(field,-16)&(0x20|0x800))!=0)throw new Exception("Protected, disabled or readonly text control.");
 }
 public static void Replace(int pid,long window,string name,string before,string text) {
  Attempted=false;if(pid<=0||window<=0||String.IsNullOrEmpty(name)||before==null||text==null||name.Length>1000||before.Length>12000||text.Length>12000||text.IndexOf('\0')>=0)throw new Exception("Invalid bounded native text request.");
  var top=new IntPtr(window);uint p;GetWindowThreadProcessId(top,out p);if(p!=pid)throw new Exception("Window identity changed.");
  var root=AutomationElement.FromHandle(top);
  var condition=new PropertyCondition(AutomationElement.NameProperty,name);
  var matches=root.FindAll(TreeScope.Descendants,condition);
  if(matches.Count!=1)throw new Exception("Native text target is missing or ambiguous.");
  var item=matches[0];if(item.Current.IsPassword||!item.Current.IsEnabled)throw new Exception("Protected text target.");
  var field=new IntPtr(item.Current.NativeWindowHandle);Check(top,field,pid);
  if(Read(field)!=before)throw new Exception("Text changed since observation.");
  Check(top,field,pid);if(item.Current.Name!=name)throw new Exception("Text target changed.");
  IntPtr result;Attempted=true;
  if(WriteMessage(field,12,IntPtr.Zero,text,3,1000,out result)==IntPtr.Zero||result==IntPtr.Zero)throw new Exception("Native write was not confirmed.");
  Check(top,field,pid);if(Read(field)!=text)throw new Exception("Native text readback differs.");
 }
}
'@
while ($null -ne ($taskLine=[Console]::ReadLine())) {
 $taskRequest=$null
 [MitchNativeText]::Attempted=$false
 try {
  $taskRequest=$taskLine|ConvertFrom-Json
  [MitchNativeText]::Replace([int]$taskRequest.pid,[long]$taskRequest.window_id,[string]$taskRequest.name,[string]$taskRequest.before,[string]$taskRequest.text)
  $taskReply=@{id=$taskRequest.id;effect='confirmed';route='system_api';verified=$true;action_attempted=$true}
 } catch {
  $taskAttempted=[MitchNativeText]::Attempted
  $taskReply=@{id=$taskRequest.id;effect=$(if($taskAttempted){'unverifiable'}else{'refused'});route='system_api';verified=$false;action_attempted=$taskAttempted;outcome_unknown=$taskAttempted;refused=(!$taskAttempted);code='native_text_unavailable';detail=[string]$_.Exception.InnerException.Message;message='The bound native text operation could not be confirmed.'}
 }
 [Console]::WriteLine(($taskReply|ConvertTo-Json -Compress -Depth 4))
}
