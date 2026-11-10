$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class MitchStateSignals {
  delegate void WinEvent(IntPtr hook, uint kind, IntPtr window, int objectId, int childId, uint thread, uint time);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint first,uint last,IntPtr module,WinEvent callback,uint process,uint thread,uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
  static WinEvent callback=Changed;
  static void Changed(IntPtr hook,uint kind,IntPtr window,int objectId,int childId,uint thread,uint time) {
    if(window==IntPtr.Zero)return;
    var root=GetAncestor(window,2);if(root==IntPtr.Zero)root=window;
    Console.WriteLine("{\"window\":"+root.ToInt64()+",\"kind\":\""+(kind==3?"focus":"changed")+"\"}");
  }
  public static void Run() {
    var focus=SetWinEventHook(3,3,IntPtr.Zero,callback,0,0,2);
    var changes=SetWinEventHook(0x8000,0x800e,IntPtr.Zero,callback,0,0,2);
    if(focus==IntPtr.Zero||changes==IntPtr.Zero)throw new InvalidOperationException("State hooks unavailable");
    Console.WriteLine("{\"ready\":true}");
    try{Application.Run();}finally{UnhookWinEvent(focus);UnhookWinEvent(changes);}
  }
}
'@
[MitchStateSignals]::Run()
