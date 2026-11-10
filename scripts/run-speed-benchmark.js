'use strict';
// Opt-in paid model/real UIA benchmark. Every input is restricted to one owned
// disposable HWND. No browser pages, user files, screenshots or microphone.
const {connect,app}=require('./chatgpt-benchmark-host'),{BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {CuaClient}=require('../cua-client'),{NativeStateSignals}=require('../native-state-signals');
const candidatesOnly=process.argv.includes('--candidates-only');
const root=path.resolve(__dirname,'..'),baseline=path.join(root,'outputs/v23-speed-baseline'),out=path.join(root,'test-output',candidatesOnly?'speed-model-final.json':'speed-benchmark.json');
app.commandLine.appendSwitch('force-renderer-accessibility');
const title='Mitch Speed Fixture',target={kind:'native',app:title},round=x=>Math.round(x),median=a=>{const b=a.slice().sort((a,b)=>a-b);return b.length?round((b[Math.floor((b.length-1)/2)]+b[Math.floor(b.length/2)])/2):null;};
const prompts={field:`In "${title}", set "Name" to "Alpha"`,navigation:`Open "${title}" and go to "Settings"`,complex:`In ${title}, open Settings, if Continue editing appears click it, set Name to Alpha, click Apply, and verify Saved.`};
const report={status:'running',version:require('../package.json').version,at:new Date().toISOString(),method:'Real selected-account models and native UIA, one process-owned Electron fixture. Cold field/navigation/conditional tasks; alternating v23/current at the original model; one-screen model trials then top candidate validation; warm verified procedure after an unrelated DOM addition. No speech, real app launch, network-loaded website or general accuracy claim. Request cap 64, four requests per task, 45s per request, 90s per task.',rows:[],totalRequests:0};
const finalCheck=process.argv.includes('--final-check');
if(finalCheck)report.method='Final source check after fixing scope-first preparation. Two alternating v23/current trials each for field/navigation, one each for a conditional task, then learned procedure with three unrelated-layout replays. Same owned native fixture and original model; 28-request cap. Includes fresh discovery, native input, verification and final text; excludes speech and real app launch. General accuracy is not inferred.';
if(candidatesOnly)report.method='Final validation of the two fastest preliminary field candidates using the corrected native fixture and final preparation code. All three tasks must pass, then another three-task confirmation must beat the original-model median by at least 15% to change Fast. Smart is preserved. 20-request cap. Warm replays add an unrelated visible button. Small targeted sample, not general model accuracy.';
let host,window,originalPrefs,originalMode,originalTransport,originalModel,currentRow,winner,client,computer,ai,owned,passed=false,offeredNames=[];
const save=()=>{fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));};
function bundle(version){const dir=version==='v23'?baseline:root;return {AI:require(path.join(dir,'ai')).AI,ComputerUse:require(path.join(dir,'computer-use')).ComputerUse,NativePlanAdapter:require(path.join(dir,'native-plan-adapter')).NativePlanAdapter,executePlan:require(path.join(dir,'action-plan')).executePlan,createDispatcher:require(path.join(dir,'core')).createDispatcher,run:require(path.join(dir,'task-program-runner')).runGuardedTaskProgram,prepare:require(path.join(dir,'task-program-host')).prepareTaskContext};}
const own=row=>assert.ok(row?.pid===owned.pid&&row?.window_id===owned.window_id,'Input left the owned benchmark window');
async function setup(version,model,reuse=false){
  await computer?.stop();await host.auth.select({mode:'fast',model,transport:'http'});
  const api=bundle(version),settings={...host.settings,chatProvider:'chatgpt',chatModel:model,allowDesktop:true,allowScreen:false,workflowEngine:true,reuseWorkflows:reuse,speculativePlanning:false,localGrounding:false};
  client=new CuaClient();computer=new api.ComputerUse({client,getSettings:()=>settings,confirm:async()=>true,...(version==='current'?{signals:new NativeStateSignals({helper:path.join(root,'native-state-signals.ps1')})}:{})});
  const list=computer.listWindows.bind(computer);computer.listWindows=async args=>{const result=await list(args);return {...result,windows:result.windows.filter(w=>w.pid===owned.pid&&w.window_id===owned.window_id)};};
  const call=client.call.bind(client);client.call=async(name,args)=>{if(['bring_to_front','click','set_value','press_key','scroll','double_click','right_click','type_text','drag'].includes(name)){own(args.target||args);assert.ok(['bring_to_front','click','set_value'].includes(name),'Unexpected benchmark input');}const start=performance.now();try{return await call(name,args);}finally{currentRow?.nativeCalls.push({name,ms:round(performance.now()-start)});}};
  let dispatch;const handlers={
    browser_list_tabs:async()=>({status:'ok',complete:true,snapshot:'owned-empty-tabs',browser:'opera',session_id:'owned-empty-tabs',tabs:[]}),
    computer_list_windows:async args=>{const result=await computer.listWindows(args);return {...result,windows:result.windows.filter(w=>w.pid===owned.pid&&w.window_id===owned.window_id)};},
    computer_inspect_window:args=>{own(args);return computer.inspect(args);},
    computer_find_window:(args,ctx)=>computer.findWindow(args,ctx),
    list_apps:async()=>({status:'ok',apps:[{name:title,app_id:'owned-speed-fixture'}]}),
    open_app:(args,ctx)=>{assert.equal(args.app_id,'owned-speed-fixture');return computer.focus(owned,ctx);},
    computer_focus_window:(args,ctx)=>{own(args);return computer.focus(args,ctx);},
    computer_execute_plan:async(args,ctx)=>{const initial=computer.getSnapshot(args.snapshot,computer.generation);own(initial.window);const result=await api.executePlan({steps:args.steps,completion:args.completion,adapter:new api.NativePlanAdapter({computer,target:initial.window,context:ctx,initialSnapshot:initial}),context:ctx});if(currentRow)(currentRow.plans||=[]).push({args,result});return result;},
    computer_run_workflow:async(args,ctx)=>{const result=await api.run({program:args,bindings:ctx.workflowBindings||{},dispatch:ctx.dispatchChild,context:ctx,replay:ctx.workflowReplay});if(currentRow)(currentRow.workflows||=[]).push({args,result});return result;},
    computer_action:(args,ctx)=>{own(computer.getSnapshot(args.snapshot,computer.generation).window);return computer.action(args,ctx);}
  };dispatch=api.createDispatcher(handlers);offeredNames=Object.keys(handlers);
  ai=new api.AI(()=>settings,()=>{throw Error('Unexpected credential lookup');},dispatch,fetch,host.provider);
  ai.prepareContext=(text,context)=>api.prepare({text,dispatch,context});
  ai.onTaskTiming=timing=>{if(currentRow)currentRow.timing=timing;};
  return ai;
}
async function trial({version='current',model,task,phase,repeat=1,reuse=false,keep=false,extra=false}){
  if(!keep)await setup(version,model,reuse);
  await window.webContents.executeJavaScript(`window.resetFixture(${JSON.stringify(task)},${extra})`);window.show();window.focus();
  const listed=await computer.listWindows({query:title});own(listed.windows.find(w=>w.pid===owned.pid&&w.window_id===owned.window_id));await computer.focus(owned);await computer.inspect(owned);
  const row={phase,version,model,task,repeat,requests:0,requestMs:[],nativeCalls:[],verified:false,status:'running'};currentRow=row;report.rows.push(row);save();
  const timer=setTimeout(()=>ai.controller?.abort(),90000),start=performance.now();
  try{const response=await ai.chat(prompts[task]);row.reply=typeof response==='string'?response.slice(0,350):JSON.stringify(response).slice(0,350);row.status='completed';}
  catch(error){row.status='failed';row.error=error.code||String(error.message).slice(0,200);}
  finally{clearTimeout(timer);row.totalMs=round(performance.now()-start);currentRow=null;}
  row.actual=await window.webContents.executeJavaScript('({...window.fixtureState,heading:document.getElementById("heading").textContent,value:document.querySelector("input")?.value})');
  row.verified=task==='field'?row.actual.value==='Alpha'&&row.actual.clicks.length===0:task==='navigation'?row.actual.heading==='Settings'&&JSON.stringify(row.actual.clicks)==='["Settings"]':row.actual.saved==='Alpha'&&JSON.stringify(row.actual.clicks)==='["Settings","Continue editing","Apply"]';
  row.inputs=row.nativeCalls.filter(c=>['click','set_value'].includes(c.name)).length;row.success=row.verified&&row.status==='completed'&&!row.timing?.steps.some(s=>s.outcome_unknown||s.status==='interrupted'||s.refused)&&!/^I stopped|^An action was sent|^I couldn't|^I could not/.test(row.reply||'');save();console.log(JSON.stringify({phase,version,model,task,verified:row.verified,confirmed:row.success,ms:row.totalMs,requests:row.requests,error:row.error}));
  if(['subscription_sharing_usage_limit_exceeded','insufficient_quota','session_expired'].some(c=>row.error?.includes(c)))throw Error(row.error);
  return row;
}
connect().then(async value=>{
  host=value;const state=host.auth.publicState();originalPrefs={...state.preferences};originalMode=state.mode;originalTransport=state.transport;originalModel=host.auth.model();report.originalModel=originalModel;
  const request=host.provider.request.bind(host.provider);host.provider.request=async(body,options={})=>{assert.ok(currentRow);if(report.totalRequests>=(candidatesOnly?20:finalCheck?28:64)||currentRow.requests>=4)throw Error('Benchmark request cap reached');currentRow.requests++;report.totalRequests++;const row=currentRow,start=performance.now();try{return await request({...body,...(body.tools?{tools:body.tools.filter(t=>offeredNames.includes(t.name))}:{})},{...options,signal:AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(45000)])});}finally{row.requestMs.push(round(performance.now()-start));save();}};
  window=new BrowserWindow({width:600,height:520,show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});window.webContents.setWindowOpenHandler(()=>({action:'deny'}));await window.loadFile(path.join(root,'tests/speed-fixture.html'));window.show();if(!window.isVisible())window.show();window.focus();
  const handle=window.getNativeWindowHandle();owned={pid:process.pid,window_id:Number(handle.readBigUInt64LE(0))};
  report.models=state.models.map(m=>m.id);report.method+=' The offered tool set is restricted equally to implemented owned-fixture capabilities; find-window/app discovery/focus are supported. The result indicator is an accessible control. Confirmed success requires independent state plus no uncertain/interrupted outcome.';save();
  if(!finalCheck)for(const model of report.models.filter(model=>!candidatesOnly||['gpt-6.1-terra','gpt-5.6-luna'].includes(model)))await trial({model,task:'field',phase:'screen'});
  const candidates=report.rows.filter(r=>r.phase==='screen'&&r.success).sort((a,b)=>a.totalMs-b.totalMs).slice(0,2).map(r=>r.model);
  for(const model of candidates)for(const task of ['navigation','complex'])await trial({model,task,phase:'model-validation'});
  const eligible=candidates.filter(model=>report.rows.filter(r=>r.model===model&&['screen','model-validation'].includes(r.phase)).filter(r=>r.success).length===3);
  eligible.sort((a,b)=>median(report.rows.filter(r=>r.model===a).map(r=>r.totalMs))-median(report.rows.filter(r=>r.model===b).map(r=>r.totalMs)));
  const candidate=eligible[0];report.fastCandidate=candidate||null;
  if(!candidatesOnly)for(let repeat=1;repeat<=2;repeat++)for(const task of finalCheck&&repeat===2?['field','navigation']:['field','navigation','complex'])for(const version of repeat%2?['v23','current']:['current','v23'])await trial({version,model:originalModel,task,phase:'comparison',repeat});
  if(candidate&&candidate!==originalModel){
    // Confirm the screen winner against the current original model on the same
    // complete three-task suite before changing the user's fast preference.
    for(const task of ['field','navigation','complex'])await trial({model:candidate,task,phase:'candidate-confirmation'});
    const fresh=report.rows.filter(r=>r.phase==='candidate-confirmation'),control=(candidatesOnly?JSON.parse(fs.readFileSync(path.join(root,'test-output/speed-benchmark.json'),'utf8')).rows:report.rows).filter(r=>r.phase==='comparison'&&r.version==='current');
    if(fresh.every(r=>r.success)&&control.every(r=>r.success)&&median(fresh.map(r=>r.totalMs))<median(control.map(r=>r.totalMs))*.85)winner=candidate;
  }
  await trial({model:winner||originalModel,task:'field',phase:'replay-learn',reuse:true});
  for(let repeat=1;repeat<=3;repeat++)await trial({model:winner||originalModel,task:'field',phase:'replay',repeat,keep:true,extra:true});
  report.summary=Object.fromEntries(['v23','current'].map(version=>{const rows=report.rows.filter(r=>r.phase==='comparison'&&r.version===version);return [version,{tasks:rows.length,passed:rows.filter(r=>r.success).length,medianMs:median(rows.map(r=>r.totalMs)),modelRequests:rows.reduce((n,r)=>n+r.requests,0)}];}));
  report.winner=winner||originalModel;report.preferenceChanged=!!winner;report.status='completed';passed=true;
}).catch(error=>{report.status='failed';report.error=error.code||String(error.message);console.error(error.stack);}).finally(async()=>{
  try{await computer?.stop();if(host&&originalPrefs){for(const mode of ['fast','smart'])await host.auth.select({mode,model:mode==='fast'&&winner?winner:originalPrefs[mode],transport:originalTransport});await host.auth.select({mode:originalMode,transport:originalTransport});}}catch(error){report.cleanupError=error.code||'cleanup_failed';passed=false;}
  if(window&&!window.isDestroyed())window.destroy();host?.close();save();console.log(JSON.stringify({status:report.status,summary:report.summary,winner:report.winner,totalRequests:report.totalRequests,error:report.error}));app.exit(passed?0:1);
});
