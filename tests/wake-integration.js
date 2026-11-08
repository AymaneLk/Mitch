'use strict';
const {spawn}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {WakeListener}=require('../wake-listener');
module.exports=async function({helper,main,directory,version}){
  const run=flag=>new Promise((resolve,reject)=>{
    const child=spawn(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,flag],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',error='';
    const timer=setTimeout(()=>{child.kill();reject(new Error('Native wake check timed out.'));},15000);
    child.stdout.on('data',b=>output+=b.toString());child.stderr.on('data',b=>error+=b.toString());child.on('error',reject);
    child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new Error(output||error));try{resolve(output.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)));}catch(e){reject(e);}});
  });
  const recognition=await run('-SelfTest');assert.ok(recognition.some(item=>item.event==='self-test-passed'));assert.equal(recognition.filter(item=>item.phrase).length,10);assert.ok(recognition.filter(item=>item.phrase).every(item=>item.expected===item.accepted));
  const microphone=await run('-Probe');assert.ok(microphone.some(item=>item.event==='ready'));
  const listener=new WakeListener({helper});
  try{
    listener.start();const deadline=Date.now()+10000;
    while(listener.state.status==='starting'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(listener.state.status,'listening',JSON.stringify(listener.state));
    await new Promise(resolve=>setTimeout(resolve,750));
    assert.ok(listener.child,'The wake helper must stay alive in standby.');assert.equal(listener.state.status,'listening',JSON.stringify(listener.state));
  }finally{await listener.stop();}
  const lease=await main.webContents.executeJavaScript('window.companion.claimMicrophone("voice")');assert.equal(typeof lease,'string');await main.webContents.executeJavaScript(`window.companion.releaseMicrophone(${JSON.stringify(lease)})`);
  await main.webContents.executeJavaScript('window.playWakeChime()');
  const markup=await main.webContents.executeJavaScript('document.getElementById("wakeEnabled").outerHTML');assert.match(markup,/checkbox/);
  await main.webContents.executeJavaScript('document.getElementById("wakeStatus").scrollIntoView({block:"center"})');
  fs.writeFileSync(path.join(directory,'wake-settings.png'),(await main.webContents.capturePage()).toPNG());
  const report={status:'passed',version,at:new Date().toISOString(),recognition,microphoneReady:true,standbyStable:true,readyChimeCompleted:true,scope:'Native local synthetic speech, active microphone recognition/cancellation, stable standby, trusted microphone lease IPC and real Web Audio playback. No cloud/model calls; user accent not tested.'};
  fs.writeFileSync(path.join(directory,'wake-integration.json'),JSON.stringify(report,null,2));
};
