'use strict';
const {app,BrowserWindow}=require('electron'),{NativeStateSignals}=require('../native-state-signals');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
app.setPath('userData',path.resolve(__dirname,'../test-output/native-state-profile'));app.commandLine.appendSwitch('force-renderer-accessibility');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));let window,signals;const report={status:'running',checks:[]};
app.whenReady().then(async()=>{
  signals=new NativeStateSignals({helper:path.resolve(__dirname,'../native-state-signals.ps1')});signals.start();
  for(let i=0;i<100&&!signals.ready;i++)await delay(50);assert.equal(signals.ready,true);
  window=new BrowserWindow({show:false,width:480,height:320,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await window.loadFile(path.resolve(__dirname,'../tests/speed-fixture.html'));window.show();if(!window.isVisible())window.show();window.focus();await delay(200);
  const target={window_id:Number(window.getNativeWindowHandle().readBigUInt64LE(0))},stamp=signals.stamp(target);
  await window.webContents.executeJavaScript('document.getElementById("heading").textContent="Native state changed";document.querySelector("input").focus();true');
  for(let i=0;i<100&&signals.current(target,stamp);i++)await delay(50);
  assert.equal(signals.current(target,stamp),false,'An actual accessibility/focus event must invalidate the owned window');
  report.checks.push('real helper startup','owned Windows control/focus change invalidates observation');
  await window.webContents.executeJavaScript(fs.readFileSync(path.resolve(__dirname,'../action-plan.js'),'utf8'));
  await window.webContents.executeJavaScript(fs.readFileSync(path.resolve(__dirname,'../browser-extension/page-agent.js'),'utf8'));
  report.browser=await window.webContents.executeJavaScript(`(async()=>{
    const agent=MitchPageAgent.createPageAgent({window,document,plan:MitchPlan}),start=performance.now();
    for(let i=0;i<100;i++)await agent.adapter.snapshot();const repeated=agent.diagnostics();
    document.querySelector('input').value='Live value';const valueFrame=await agent.adapter.snapshot();
    const b=document.createElement('button');b.textContent='Unrelated control';document.body.prepend(b);
    const changed=await agent.adapter.snapshot(),rebuilt=agent.diagnostics();b.style.display='none';const hidden=await agent.adapter.snapshot();
    const result={observations:100,scans:repeated.candidateScans,liveValue:valueFrame.controls.some(c=>c.name==='Name'&&c.value==='Live value'),addedControl:changed.controls.some(c=>c.name==='Unrelated control'),scansAfterMutation:rebuilt.candidateScans,hiddenAbsent:!hidden.controls.some(c=>c.name==='Unrelated control'),ms:Math.round(performance.now()-start)};agent.disconnect();return result;
  })()`);
  assert.equal(report.browser.scans,1);assert.equal(report.browser.scansAfterMutation,2);assert.equal(report.browser.liveValue,true);assert.equal(report.browser.addedControl,true);assert.equal(report.browser.hiddenAbsent,true);
  report.checks.push('real Chromium control index reuse and mutation/value/visibility refresh');report.status='passed';
}).catch(error=>{report.status='failed';report.error=error.message;}).finally(()=>{signals?.stop();window?.destroy();fs.writeFileSync(path.resolve(__dirname,'../test-output/native-state-live.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(report.status==='passed'?0:1);});
