'use strict';
// Explicit smoke hook: UIA input is bounded to two exact HWNDs owned by this
// Electron process. No cloud model, browser account, file change or screenshot.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createTaskProgramHost,prepareTaskContext}=require('../task-program-host');
const {runGuardedTaskProgram}=require('../task-program-runner');
const {scopeSignature,ProcedureMemory}=require('../procedure-memory');
const rounded=value=>Math.round(value*100)/100;
const identity=value=>value&&`${value.pid}:${value.window_id}`;
const selector=(role,name)=>({role,name,match:'exact'});
const exists=target=>({target,condition:'exists'});
const sourceTitle='Mitch Workflow Source Fixture',destinationTitle='Mitch Workflow Destination Fixture';
const sourceTarget={kind:'native',app:sourceTitle},destinationTarget={kind:'native',app:destinationTitle};
const show=selector('button','Show record'),source=selector('textbox','Source value'),destination=selector('textbox','Destination value');
const sourcePhase={steps:[{op:'click',target:show}],completion:[exists(source)]};
const destinationPhase=value=>({steps:[{op:'fill',target:destination,text:value},{op:'click',target:selector('button','Apply locally')}],completion:[exists(selector('button','Applied Fixture data 478'))]});
const program={version:1,steps:[{op:'bind',target:sourceTarget},{op:'if',condition:exists(show),then:[{op:'act',...sourcePhase}]},{op:'read',target:source,attribute:'value',as:'recordValue'},{op:'bind',target:destinationTarget},{op:'act',...destinationPhase({ref:'recordValue'})}],completion:[exists(selector('button','Applied Fixture data 478'))]};
const replayProgram={version:1,steps:[{op:'bind',target:sourceTarget},{op:'act',...sourcePhase}],completion:[exists(source)]};

module.exports=async function({BrowserWindow,computer,dispatch,desktopActivity,directory,version}){
  const report={status:'running',version,at:new Date().toISOString(),scope:'Real UIA two-window conditional workflow and one-scope known-procedure replay; owned disposable fixtures only. Compares scripted separate planner phases with one task program, not actual model latency or general-task accuracy. Replay uses scripted fixture approval, not model learning.',rows:[],replayRows:[],checks:[],actualModelRequests:0};
  const file=path.join(directory,'task-program-native-integration.json'),owned=new Map(),windows=[],raw=[],original=computer.client.call.bind(computer.client);let scope,sourceWindow,destinationWindow;
  const save=()=>{fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2));};
  const context=()=>({activityScope:scope,assertActive:()=>desktopActivity.assertScope(scope)});
  const checkOwned=value=>assert.ok(owned.has(identity(value)),'Input must stay in an exact process-owned fixture.');
  const state=window=>window.webContents.executeJavaScript('JSON.parse(JSON.stringify(window.fixtureState))');
  const reset=async already=>{
    const listed=await computer.listWindows({query:''});
    for(const [window,title,role]of [[destinationWindow,destinationTitle,'destination'],[sourceWindow,sourceTitle,'source']]){
      const matches=listed.windows.filter(row=>owned.has(identity(row))&&row.title===title);assert.equal(matches.length,1,'Reset must freshly discover its exact owned window.');window.show();window.focus();await computer.focus(matches[0],context());
      await window.webContents.executeJavaScript(`window.resetFixture('${role}',${role==='source'&&already?'true':'false'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`);
      const observed=await computer.inspect(matches[0]),wanted=role==='destination'?'Destination value':already?'Source value':'Show record';assert.ok(observed.controls.some(control=>control.name===wanted),'Fixture reset must reach its native accessibility tree before timing begins.');
    }
  };
  const compact=result=>({status:result.status,verified:result.verified,reason:result.reason,program_assertions_verified:result.program_assertions_verified,action_attempted:result.action_attempted,outcome_unknown:result.outcome_unknown,recovery_required:result.recovery_required,delivered_steps:result.delivered_steps,stats:result.stats,timing:result.timing,event_count:result.event_count,evidence_truncated:result.evidence_truncated});
  const scopedDispatch=async(name,args,ctx)=>{
    assert.ok(['computer_list_windows','computer_inspect_window','computer_focus_window','computer_execute_plan','computer_run_workflow'].includes(name),'Unexpected fixture tool '+name);
    if(name==='computer_list_windows'){
      const result=await dispatch(name,args,ctx);assert.equal(result.status,'ok');assert.equal(result.truncated,false);assert.equal(result.degraded,false);
      return {...result,windows:result.windows.filter(window=>owned.has(identity(window)))};
    }
    if(['computer_inspect_window','computer_focus_window'].includes(name))checkOwned(args);
    return dispatch(name,args,ctx);
  };
  const create=async role=>{
    const window=new BrowserWindow({width:550,height:430,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});windows.push(window);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    await window.loadFile(path.join(__dirname,'task-program-fixture.html'));await window.webContents.executeJavaScript(`window.resetFixture('${role}')`);window.webContents.on('will-navigate',event=>event.preventDefault());window.show();
    const handle=window.getNativeWindowHandle(),window_id=handle.length>=8?Number(handle.readBigUInt64LE(0)):handle.readUInt32LE(0);assert.ok(Number.isSafeInteger(window_id)&&window_id>0);
    const row={pid:process.pid,window_id,title:role==='source'?sourceTitle:destinationTitle};owned.set(identity(row),row);return window;
  };
  try{
    sourceWindow=await create('source');destinationWindow=await create('destination');scope=desktopActivity.beginScope();
    computer.client.call=async(name,args)=>{
      if(name==='bring_to_front')checkOwned(args);
      if(['click','set_value','press_key','scroll','double_click','right_click','type_text','drag'].includes(name)){checkOwned(args.target||args);assert.ok(['click','set_value'].includes(name),'Only observed fixture clicks/value changes are allowed.');}
      const started=performance.now();try{return await original(name,args);}finally{raw.push({name,ms:rounded(performance.now()-started)});}
    };
    for(let trial=1;trial<=3;trial++)for(const route of trial%2?['separate-phases','task-program']:['task-program','separate-phases']){
      const already=trial===2;await reset(already);const offset=raw.length,started=performance.now();let result;
      if(route==='task-program')result=await dispatch('computer_run_workflow',program,{...context(),fromModel:true});
      else{
        const host=createTaskProgramHost({dispatch:scopedDispatch,context:context()});let observation=await host.bind(sourceTarget);
        if(observation.controls.some(control=>control.name===show.name&&control.role===show.role)){result=await host.perform(sourcePhase.steps,sourcePhase.completion);assert.equal(result.status,'completed');}
        observation=await host.observe();const values=observation.controls.filter(control=>control.name===source.name&&control.role===source.role);assert.equal(values.length,1);await host.bind(destinationTarget);
        const phase=destinationPhase(values[0].value);result=await host.perform(phase.steps,phase.completion);assert.equal(result.status,'completed');
      }
      const row={route,trial,alreadyShowingRecord:already,totalMs:rounded(performance.now()-started),scriptedPlannerBoundaries:route==='task-program'?1:3,throughProductionDispatcher:route==='task-program',result:compact(result),nativeCalls:raw.slice(offset)};row.inputs=row.nativeCalls.filter(call=>['click','set_value'].includes(call.name)).length;if(result.status!=='completed'){row.fixtureStates=await Promise.all([state(sourceWindow),state(destinationWindow)]);row.failureEvidence=result.events?.map(event=>event.name==='computer_list_windows'?{...event,output:{...event.output,windows:event.output?.windows?.filter(window=>owned.has(identity(window)))}}:event);row.finalObservation=result.observation;}report.rows.push(row);save();
      assert.equal(result.status,'completed',JSON.stringify(compact(result)));assert.equal(result.verified,true);const [actualSource,actualDestination]=await Promise.all([state(sourceWindow),state(destinationWindow)]);assert.deepEqual(actualSource.actions,already?[]:['show']);assert.deepEqual(actualDestination.actions,['apply']);assert.equal(actualDestination.output,actualSource.sourceValue);assert.equal(row.inputs,already?2:3);row.independentFixtureReadback=true;save();
    }
    await reset(true);await computer.focus([...owned.values()].find(row=>row.title===destinationTitle),context());await sourceWindow.webContents.executeJavaScript("document.querySelector('input').value='Fresh background data';window.fixtureState.sourceValue='Fresh background data';true");
    const readHost=createTaskProgramHost({dispatch:scopedDispatch,context:context()});await readHost.bind(sourceTarget);const freshRead=await readHost.observe({refresh:true,forRead:true});assert.equal(freshRead.controls.find(control=>control.name==='Source value'&&control.role==='textbox')?.value,'Fresh background data');report.checks.push({name:'native value reads refresh after verified foreground focus',passed:true});
    const memory=new ProcedureMemory(),replayRequest='Show record in '+sourceTitle;
    const prepareReplay=()=>prepareTaskContext({text:replayRequest,targets:[sourceTarget],context:context(),dispatch:async(name,args,ctx)=>{
      // This native-only fixture has no browser surface. Keep the production
      // preparation path while explicitly supplying an empty test inventory;
      // every native discovery and accessibility read is real and timed.
      if(name==='browser_list_tabs')return {status:'ok',complete:true,snapshot:'owned-no-browser',browser:'opera',session_id:'owned-no-browser',tabs:[]};
      return scopedDispatch(name,args,ctx);
    }});
    await reset(false);const learnedContext=await prepareReplay();assert.equal(learnedContext.scopes.length,1);assert.equal(learnedContext.scopes[0].observation.complete,true);
    const demonstration=await dispatch('computer_run_workflow',replayProgram,{...context(),fromModel:true});assert.equal(demonstration.status,'completed');assert.equal(demonstration.verified,true);assert.deepEqual((await state(sourceWindow)).actions,['show']);assert.equal(demonstration.observation.controls.find(control=>control.name==='Source value'&&control.role==='textbox')?.value,(await state(sourceWindow)).sourceValue);
    assert.equal(memory.remember(replayRequest,learnedContext,replayProgram,{approved:true}),true,'Only the independently checked scripted fixture procedure may be remembered.');
    report.replayMethod={source:'Scripted known procedure with explicit independent fixture-semantic approval; not learned from a model.',timed:'Fresh native preparation + memory lookup + production dispatcher workflow replay including another fresh bind/signature check, input and final UIA verification.',excluded:'Fixture setup/reset, initial scripted approval, independent test DOM readback, speech and model/network calls. Browser inventory is an empty test surface; native calls are real.',actualModelRequests:0};save();
    for(let trial=1;trial<=3;trial++){
      await reset(false);const offset=raw.length,started=performance.now(),prepared=await prepareReplay(),preparedAt=performance.now(),cached=memory.get(replayRequest,prepared),lookedUpAt=performance.now();assert.ok(cached,'Identical freshly observed fixture state must match its approved procedure.');
      const result=await dispatch('computer_run_workflow',cached.program,{...context(),fromModel:true,workflowBindings:cached.bindings,workflowReplay:cached}),ended=performance.now();
      const row={trial,totalMs:rounded(ended-started),preparationMs:rounded(preparedAt-started),lookupMs:rounded(lookedUpAt-preparedAt),executionMs:rounded(ended-lookedUpAt),actualModelRequests:0,throughProductionDispatcher:true,result:compact(result),replayContextVerified:result.replay_context_verified===true,nativeCalls:raw.slice(offset)};row.inputs=row.nativeCalls.filter(call=>['click','set_value'].includes(call.name)).length;report.replayRows.push(row);save();
      assert.equal(result.status,'completed',JSON.stringify(compact(result)));assert.equal(result.verified,true);assert.equal(result.replay_context_verified,true);assert.equal(result.evidence_truncated,false);assert.equal(row.inputs,1);const actual=await state(sourceWindow);assert.deepEqual(actual.actions,['show']);assert.equal(result.observation.controls.find(control=>control.name==='Source value'&&control.role==='textbox')?.value,actual.sourceValue);row.independentFixtureReadback=true;save();
    }
    await reset(false);const beforeHost=createTaskProgramHost({dispatch:scopedDispatch,context:context()}),beforeFrame=await beforeHost.bind(sourceTarget),signature=scopeSignature(sourceTarget,beforeFrame);assert.ok(signature);
    await sourceWindow.webContents.executeJavaScript("window.resetFixture('source',true)");let offset=raw.length;
    const mismatch=await runGuardedTaskProgram({program:replayProgram,replay:{scopeSignatures:[{target:sourceTarget,signature}]},dispatch:scopedDispatch,context:context()});assert.equal(mismatch.reason,'replay_context_mismatch');assert.equal(mismatch.action_attempted,false);assert.equal(raw.slice(offset).filter(row=>['click','set_value'].includes(row.name)).length,0);report.checks.push({name:'fresh replay mismatch receives no input',result:compact(mismatch)});
    await reset(false);offset=raw.length;let injected=false;
    const unknown=await runGuardedTaskProgram({program,context:context(),dispatch:async(name,args,ctx)=>{const result=await scopedDispatch(name,args,ctx);if(name==='computer_execute_plan'&&!injected){injected=true;return {...result,status:'interrupted',verified:false,outcome_unknown:true};}return result;}});
    assert.equal(unknown.outcome_unknown,true);assert.equal(raw.slice(offset).filter(row=>['click','set_value'].includes(row.name)).length,1);assert.deepEqual((await state(destinationWindow)).actions,[]);report.checks.push({name:'unknown delivered first phase never advances to second app',result:compact(unknown)});
    const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];report.summary={trialsPerRoute:3,taskProgramMedianLocalMs:median(report.rows.filter(row=>row.route==='task-program').map(row=>row.totalMs)),separatePhasesMedianLocalMs:median(report.rows.filter(row=>row.route==='separate-phases').map(row=>row.totalMs)),scriptedPlannerBoundaries:{taskProgram:1,separatePhases:3},actualModelRequests:0,passedOwnedWorkflowTrials:report.rows.length,replay:{trials:report.replayRows.length,medianTotalMs:median(report.replayRows.map(row=>row.totalMs)),medianPreparationMs:median(report.replayRows.map(row=>row.preparationMs)),medianLookupMs:median(report.replayRows.map(row=>row.lookupMs)),medianExecutionMs:median(report.replayRows.map(row=>row.executionMs)),minTotalMs:Math.min(...report.replayRows.map(row=>row.totalMs)),maxTotalMs:Math.max(...report.replayRows.map(row=>row.totalMs)),actualModelRequests:0,allIndependentReadbacks:report.replayRows.every(row=>row.independentFixtureReadback),source:'script-approved known procedure; not model-learned'}};report.status='passed';
  }catch(error){report.status='failed';report.error=String(error.message||error);throw error;}
  finally{computer.client.call=original;if(scope)desktopActivity.endScope(scope);for(const window of windows)if(!window.isDestroyed())window.destroy();save();}
};
