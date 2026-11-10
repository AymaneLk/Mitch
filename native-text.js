'use strict';
const {spawn}=require('node:child_process'),path=require('node:path'),{randomUUID}=require('node:crypto');
class NativeText {
 constructor({helper=path.join(__dirname.replace(/app\.asar$/,'app.asar.unpacked'),'native-text.ps1'),spawnImpl=spawn}={}){this.helper=helper;this.spawn=spawnImpl;this.pending=null;}
 start(){
  if(this.child)return;
  const child=this.spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',this.helper],{windowsHide:true,stdio:['pipe','pipe','pipe']});this.child=child;let buffer='';
  child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{buffer+=part;if(buffer.length>65536)return this.stop();let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const value=JSON.parse(line);if(value.id===this.pending?.id)this.pending.resolve(value);}catch{this.stop();}}});
  child.stderr.resume();child.stdin.on('error',()=>{if(this.child===child)this.stop();});child.on('error',()=>{if(this.child===child)this.stop();});child.on('exit',()=>{if(this.child===child){this.child=null;this.pending?.reject(Error('Native text helper exited.'));}});
 }
 async replace(args,context={}){
  context.signal?.throwIfAborted();context.assertActive?.();if(this.pending)throw Error('Native text helper is busy.');this.start();
  const id=randomUUID();let timer,onAbort;
  try{return await new Promise((resolve,reject)=>{this.pending={id,resolve,reject};onAbort=()=>this.stop();context.signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>this.stop(),6000);this.child.stdin.write(JSON.stringify({...args,id})+'\n');});}
  catch(error){error.action_attempted=true;error.outcome_unknown=true;throw error;}
  finally{clearTimeout(timer);context.signal?.removeEventListener('abort',onAbort);this.pending=null;}
 }
 stop(){const child=this.child;this.child=null;this.pending?.reject(Error('Native text operation stopped.'));child?.kill();}
}
module.exports={NativeText};
