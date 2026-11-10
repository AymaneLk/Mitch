'use strict';
// Exercise the actual driver lifecycle and input against one disposable window.
// No account inference, user documents or playback changes are involved.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const runtime=process.env.MITCH_SESSION_APP||path.join(__dirname,'..');
const {CuaClient}=require(path.join(runtime,'cua-client'));
const {ComputerUse}=require(path.join(runtime,'computer-use'));
const {ComputerVisual}=require(path.join(runtime,'computer-visual'));
const reportFile=path.join(__dirname,'../test-output/desktop-session-live.json');
const report={status:'starting',version:require(path.join(runtime,'package.json')).version,packaged:runtime.endsWith('.asar'),checks:[],scope:'Owned native window only; real driver session expiry and button readback; no model calls.'};
if(report.packaged)report.runtimeSha256=require('node:crypto').createHash('sha256').update(require('original-fs').readFileSync(runtime)).digest('hex');
const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.commandLine.appendSwitch('force-renderer-accessibility');
app.setPath('userData',path.join(__dirname,'../test-output/desktop-session-profile'));
// Keep the timer alive independently of fixture visibility. Do not leave a
// disposable foreground window in the user's way for the idle interval.
app.on('window-all-closed',()=>{});
process.on('exit',()=>{if(!['passed','failed'].includes(report.status)){report.status='failed';report.error='The test process exited before completing its lifecycle checks.';save();}});
app.whenReady().then(async()=>{
 const client=new CuaClient({executable:path.join(runtime.endsWith('.asar')?runtime+'.unpacked':runtime,'vendor/cua-driver/cua-driver.exe')});
 const computer=new ComputerUse({client,getSettings:()=>({allowDesktop:true,allowScreen:true}),confirm:async()=>true});
 const visual=new ComputerVisual({computer});let window;
 try{
  if(process.env.MITCH_SESSION_IDLE==='1'){
   await computer.listWindows();
   const lease=await client.call('get_session',{session:computer.session});
   report.leaseSeconds=lease.structuredContent.expires_in_seconds;
   const waitMs=(report.leaseSeconds+12)*1000;assert.ok(waitMs>0&&waitMs<330000);
   report.status='waiting-for-real-idle-expiry';report.waitMs=waitMs;report.waitStarted=new Date().toISOString();save();
   await delay(waitMs);
   const expired=await client.call('get_session',{session:computer.session});
   report.idleDriverState=expired.structuredContent;
   if(expired.isError)assert.equal(expired.structuredContent?.refusal?.code,'session_ended','Idle status must be active or an explicit ended-session refusal.');
   else assert.equal(expired.structuredContent?.state,'active');
   await computer.listWindows();
   report.checks.push('Discovery after five minutes of real idle time');save();
  }
  window=new BrowserWindow({width:600,height:400,show:false,webPreferences:{sandbox:true,contextIsolation:true}});
  await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><title>Mitch session fixture</title><body style="padding:50px;font:20px Segoe UI"><button style="padding:20px" onclick="document.querySelector(\'output\').textContent=++window.clicks">Count test</button><output>0</output><script>window.clicks=0</script>'));
  window.show();if(!window.isVisible())window.show();window.focus();
  const owned={pid:process.pid,window_id:Number(window.getNativeWindowHandle().readBigUInt64LE(0))};
  let visible=false;
  for(let i=0;i<40;i++){const list=await computer.listWindows({query:'Mitch session fixture'});if(list.windows.some(w=>w.pid===owned.pid&&w.window_id===owned.window_id)){visible=true;break;}await delay(100);}
  assert.ok(visible,'Owned fixture must be discoverable.');
  const raw=client.call.bind(client);let clicksSent=0,reads=0;
  client.call=async(name,args)=>{
   if(['list_windows','get_window_state','click','bring_to_front','get_screen_size','get_desktop_state'].includes(name))assert.equal(args.session,computer.session,'Every desktop call must use the explicit session.');
   if(['click','bring_to_front','get_window_state'].includes(name)){const t=args.target||args;assert.equal(t.pid,owned.pid);assert.equal(t.window_id,owned.window_id);}
   if(name==='click')clicksSent++;if(name==='list_windows')reads++;
   return raw(name,args);
  };
  const actual=()=>window.webContents.executeJavaScript('window.clicks');
  const click=async()=>{const o=await computer.inspect(owned),b=o.controls.find(c=>c.name==='Count test');assert.ok(b);return computer.action({snapshot:o.snapshot,kind:'click',control_id:b.control_id,expected_name:b.name});};
  await click();assert.equal(await actual(),1);report.checks.push('Real native click and independent renderer count');
  await raw('end_session',{session:computer.session});const ended=await raw('get_session',{session:computer.session});
  assert.equal(ended.structuredContent.refusal.code,'session_ended');
  const beforeReads=reads;await computer.listWindows({query:'Mitch session fixture'});assert.equal(reads-beforeReads,2);
  await click();assert.equal(await actual(),2);report.checks.push('Unexpected ended read automatically revived once, then real click');
  let old=await computer.inspect(owned),b=old.controls.find(c=>c.name==='Count test');
  await raw('end_session',{session:computer.session});const beforeInput=clicksSent;
  await assert.rejects(computer.action({snapshot:old.snapshot,kind:'click',control_id:b.control_id,expected_name:b.name}),e=>e.code==='session_ended'&&e.refused===true);
  assert.equal(clicksSent-beforeInput,1);assert.equal(await actual(),2);
  await click();assert.equal(await actual(),3);report.checks.push('Ended input refused once, never replayed; fresh target succeeds');
  await computer.focus(owned);
  const frame=await visual.observe({scope:'window',...owned});
  assert.ok(frame.snapshot);await raw('end_session',{session:computer.session});
  // Geometry discovery revives the lease, but the prior pixel target is rejected.
  const visualResult=await visual.input({snapshot:frame.snapshot,kind:'click',target_box:{left:.1,top:.1,right:.2,bottom:.2},target_label:'owned fixture test'});
  assert.equal(visualResult.status,'refused');assert.equal(await actual(),3);
  report.checks.push('Visual recovery discards old screenshots without clicking');
  if(process.env.MITCH_SESSION_IDLE==='1'){
   await click();assert.equal(await actual(),4);
   report.checks.push('Real click still works after idle and forced-expiry recovery');
  }
  await computer.stop();await assert.rejects(computer.listWindows(),/stopped/);
  report.checks.push('Stop still prevents revival');report.realClicks=await actual();report.status='passed';
 }catch(error){report.status='failed';report.error=error.stack;}
 finally{await computer.stop();if(window&&!window.isDestroyed())window.destroy();save();app.exit(report.status==='passed'?0:1);}
});
