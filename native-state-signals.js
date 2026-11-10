'use strict';
const {spawn}=require('node:child_process'),path=require('node:path');
// WinEvent metadata invalidates short-lived native observation reuse. It never
// grants execution authority, carries text, or replaces driver target checks.
class NativeStateSignals{
  constructor({helper,spawnImpl=spawn,now=Date.now}={}){this.helper=helper;this.spawn=spawnImpl;this.now=now;this.retryAt=0;this.epoch=0;this.windows=new Map();this.ready=false;}
  start(){
    if(this.child||!this.helper||this.now()<this.retryAt)return;
    this.retryAt=this.now()+30000;
    const child=this.spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',this.helper],{windowsHide:true,stdio:['ignore','pipe','pipe']});this.child=child;let buffer='';
    child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{buffer+=part;if(buffer.length>65536){this.stop();return;}let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{this.accept(JSON.parse(line));}catch{this.invalidate();}}});
    child.stderr.resume();const lost=()=>{if(this.child===child){this.child=null;this.ready=false;this.retryAt=this.now()+30000;this.invalidate();}};child.on('error',lost);child.on('exit',lost);
  }
  accept(event){
    if(event.ready===true){this.ready=true;this.invalidate();return;}
    if(!Number.isSafeInteger(event.window)||event.window<=0||!['focus','changed'].includes(event.kind))return;
    if(event.kind==='focus')this.invalidate();
    else{this.windows.set(event.window,(this.windows.get(event.window)||0)+1);if(this.windows.size>256)this.invalidate();}
  }
  invalidate(){this.epoch++;this.windows.clear();}
  stamp(window){return this.ready?`${this.epoch}:${this.windows.get(window.window_id)||0}`:null;}
  current(window,stamp){return stamp!==null&&stamp!==undefined&&stamp===this.stamp(window);}
  stop(){const child=this.child;this.child=null;this.ready=false;this.invalidate();child?.kill();}
}
module.exports={NativeStateSignals};
