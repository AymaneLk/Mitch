'use strict';
// Real input targets only this process's disposable window. Neither the native
// driver's acknowledgement nor the resulting accessibility tree is simulated.
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const runtime=process.env.MITCH_RECOVERY_APP||path.join(__dirname,'..');
const {CuaClient}=require(path.join(runtime,'cua-client')),{ComputerUse}=require(path.join(runtime,'computer-use'));
const {NativePlanAdapter}=require(path.join(runtime,'native-plan-adapter')),{NativePlanRecovery}=require(path.join(runtime,'native-plan-recovery')),{PlanTaskGuard}=require(path.join(runtime,'plan-task-guard')),{executePlan}=require(path.join(runtime,'action-plan'));
app.commandLine.appendSwitch('force-renderer-accessibility');
app.setPath('userData',path.join(__dirname,'../test-output/native-recovery-profile'));
const report={status:'running',version:require(path.join(runtime,'package.json')).version,packaged:runtime.endsWith('.asar'),scope:'Real native input and unmodified driver responses in an owned fixture. No user apps, credentials, model calls or screenshots.',cases:[],driverEffects:[]};
if(report.packaged)report.runtimeSha256=require('node:crypto').createHash('sha256').update(require('original-fs').readFileSync(runtime)).digest('hex');
const file=path.join(__dirname,'../test-output/native-plan-recovery-live.json');
const button=name=>({role:'button',name,match:'exact'}),click=name=>({op:'click',target:button(name)}),exists=name=>({target:button(name),condition:'exists'});
const plan={steps:[click('Open records'),{op:'click',target:{role:'button',name:'Edit',match:'contains'}}],completion:[exists('Finished')]};
app.whenReady().then(async()=>{
 const client=new CuaClient({executable:path.join(runtime.endsWith('.asar')?runtime+'.unpacked':runtime,'vendor/cua-driver/cua-driver.exe')}),computer=new ComputerUse({client,getSettings:()=>({allowDesktop:true}),confirm:async()=>true});let window;
 try{
  window=new BrowserWindow({width:680,height:500,show:false,webPreferences:{sandbox:true,contextIsolation:true}});
  await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<!doctype html><title>Mitch recovery fixture</title><body style="padding:30px;font:20px Segoe UI"><main></main><script>const root=document.querySelector('main');function add(name,fn){const b=document.createElement('button');b.textContent=name;b.onclick=fn;root.append(b)}function reset(){window.clicks=[];root.replaceChildren();add('Open records',()=>{clicks.push('Open records');root.replaceChildren();add('Open records',()=>clicks.push('REPLAY'));add('Edit Alpha',()=>{clicks.push('Edit Alpha');root.replaceChildren();add('Finished',()=>{})});add('Edit Beta',()=>clicks.push('WRONG'))})}reset()</script>`));
  window.show();if(!window.isVisible())window.show();window.focus();const owned={pid:process.pid,window_id:Number(window.getNativeWindowHandle().readBigUInt64LE(0))};
  report.fixture={...owned,visible:window.isVisible(),title:window.getTitle()};
  const original=client.call.bind(client);
  client.call=async(name,args)=>{
   if(['click','set_value','press_key','scroll','bring_to_front'].includes(name)){const t=args.target||args;assert.equal(t.pid,owned.pid);assert.equal(t.window_id,owned.window_id);}
   const r=await original(name,args);if(name==='click')report.driverEffects.push((r.structuredContent||r).effect||'unspecified');return r;
  };
  // Windows can publish a newly shown top-level window after Electron's show()
  // returns. Wait for the exact owned identity to enter discovery before focus.
  let discovered=false;
  for(let i=0;i<40;i++){
    const inventory=await computer.listWindows({query:'Mitch recovery fixture'});
    report.fixture.discovered=inventory.windows.filter(w=>w.pid===owned.pid);
    try{await computer.focus(owned);discovered=true;break;}
    catch(error){if(!/List windows first/.test(error.message))throw error;await new Promise(resolve=>setTimeout(resolve,100));}
  }
  assert.ok(discovered,'The owned recovery fixture did not become discoverable.');
  const initial=await computer.inspect(owned);
  const baseline=await executePlan({...plan,adapter:new NativePlanAdapter({computer,target:owned,initialSnapshot:initial.snapshot})});
  assert.equal(baseline.reason,'ambiguous_target');assert.equal(baseline.outcome_unknown,true);report.cases.push({name:'v26 failure reproduced',reason:baseline.reason,outcome_unknown:baseline.outcome_unknown});
  await window.webContents.executeJavaScript('reset();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await computer.focus(owned);
  const runner=new NativePlanRecovery(computer),guard=new PlanTaskGuard(),context={activityScope:Symbol('owned-live')};
  const run=args=>guard.run('computer_execute_plan',context,()=>runner.run(args,context));
  let before;
  for(let i=0;i<20;i++){before=await computer.inspect(owned);if(!before.controls.some(c=>c.name==='Edit Alpha'))break;await new Promise(r=>setTimeout(r,50));}
  assert.ok(!before.controls.some(c=>c.name==='Edit Alpha'),'The native view must acknowledge fixture reset before testing another input.');
  const started=performance.now(),partial=await run({snapshot:before.snapshot,...plan});
  assert.equal(partial.distinct_action_recovery,true,JSON.stringify(partial));assert.equal(partial.outcome_unknown,true);
  const replay=await run({snapshot:partial.observation.snapshot,steps:[click('Open records')],completion:[exists('Open records')]});assert.equal(replay.reason,'replay_blocked');
  const cross=await guard.run('computer_input',context,()=>assert.fail('cross-route replay'));assert.equal(cross.input_suppressed,true);
  const done=await run({snapshot:replay.observation.snapshot,steps:[click('Edit Alpha')],completion:[exists('Finished')]});assert.equal(done.status,'completed');
  const actual=await window.webContents.executeJavaScript('clicks.slice()');assert.deepEqual(actual,['Open records','Edit Alpha']);
  report.cases.push({name:'recovered and completed',verified:done.verified,realClicks:actual.length,replayedClicks:0,crossRouteBlocked:true,ms:Math.round(performance.now()-started)});
  report.status='passed';
 }catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
 finally{await computer.stop();if(window&&!window.isDestroyed())window.destroy();fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2));app.exit(report.status==='passed'?0:1);}
});
