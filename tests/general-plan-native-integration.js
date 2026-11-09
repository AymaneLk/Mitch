'use strict';
// Opt-in Electron hook. All real input is bounded to this process's exact
// disposable fixture window; no user apps, model requests or credentials.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {executePlan,normalizeRole}=require('../action-plan');
const {NativePlanAdapter}=require('../native-plan-adapter');
const rounded=value=>Math.round(value*100)/100;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const target=(role,name)=>({role,name,match:'exact'});
const plan={steps:[
  {op:'fill',target:target('textbox','Search'),text:'Alpha'},
  {op:'click',target:target('button','Search')},
  {op:'wait',target:target('button','Edit first result'),condition:'exists',timeout_ms:2500},
  {op:'click',target:target('button','Edit first result')},
  {op:'fill',target:target('textbox','Name'),text:'Alpha revised'},
  {op:'click',target:target('button','Save')},
  {op:'assert',target:target('button','Saved Alpha revised'),condition:'exists'}
],completion:[{target:target('button','Saved Alpha revised'),condition:'exists'}]};

module.exports=async function({BrowserWindow,computer,dispatch,desktopActivity,directory,version}){
  const report={status:'running',version,at:new Date().toISOString(),scope:'Real native Cua input restricted to one owned Electron fixture. Generic plans resolve newly created controls after complete DOM rerenders. Scripted legacy decisions use the production single-action path; no real model latency or end-to-end model accuracy is measured.',rows:[],checks:[],realModelRequests:0};
  const file=path.join(directory,'general-plan-native-integration.json'),raw=[],original=computer.client.call.bind(computer.client);
  let window,owned,scope;
  const save=()=>{fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2));};
  const checkOwned=value=>assert.ok(owned&&value?.pid===owned.pid&&value?.window_id===owned.window_id,'Native input must target only the exact owned fixture.');
  const context=()=>({activityScope:scope,assertActive:()=>desktopActivity.assertScope(scope)});
  const state=()=>window.webContents.executeJavaScript('JSON.parse(JSON.stringify(window.fixtureState))');
  const reset=async mode=>{await window.webContents.executeJavaScript(`window.resetFixture(${JSON.stringify(mode)})`);window.show();window.focus();await computer.focus(owned,context());};
  const compact=result=>({status:result.status,verified:result.verified,completed:result.completed,attempted:result.attempted,reason:result.reason,stats:result.stats,steps:result.steps,completion:result.completion});
  const measure=async(route,trial,run)=>{
    const offset=raw.length,started=performance.now();const result=await run();
    const row={route,trial,totalMs:rounded(performance.now()-started),...result,nativeCalls:raw.slice(offset)};
    row.inputs=row.nativeCalls.filter(call=>['click','set_value'].includes(call.name)).length;
    report.rows.push(row);save();return row;
  };
  try{
    window=new BrowserWindow({title:'Mitch General Plan Fixture',width:680,height:600,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
    await window.loadFile(path.join(__dirname,'general-plan-fixture.html'));window.show();window.focus();await window.webContents.executeJavaScript('document.fonts.ready');
    scope=desktopActivity.beginScope();
    const listed=await dispatch('computer_list_windows',{query:'Mitch General Plan Fixture'},context());
    const matches=listed.windows.filter(item=>item.pid===process.pid&&item.title==='Mitch General Plan Fixture');
    assert.equal(matches.length,1,'Expected one exact fixture window.');owned=matches[0];
    computer.client.call=async(name,args)=>{
      if(name==='bring_to_front')checkOwned(args);
      if(['click','set_value','press_key','scroll','double_click','right_click','type_text','drag'].includes(name)){
        checkOwned(args.target||args);assert.ok(['click','set_value'].includes(name),'Only observed fixture clicks and value replacement are permitted.');
      }
      const started=performance.now();try{return await original(name,args);}finally{raw.push({name,ms:rounded(performance.now()-started)});}
    };
    // Alternate ordering to reduce a consistent cold-start advantage. Both
    // paths reuse returned observations; legacy does not add artificial waits.
    for(let trial=1;trial<=3;trial++)for(const route of trial%2?['legacy-single-actions','general-plan']:['general-plan','legacy-single-actions']){
      await reset('normal');
      const row=await measure(route,trial,async()=>{
        if(route==='general-plan'){
          const result=await executePlan({...plan,adapter:new NativePlanAdapter({computer,target:owned,context:context()}),context:context()});
          assert.equal(result.status,'completed',JSON.stringify(compact(result)));assert.equal(result.verified,true);
          return {scriptedDecisionBatches:1,result:compact(result)};
        }
        let observation=await computer.inspect(owned),decisions=0;
        for(const step of plan.steps.filter(item=>['fill','click'].includes(item.op))){
          const matches=control=>control.name===step.target.name&&normalizeRole(control.role||control.type)===step.target.role&&(step.op!=='fill'||control.editable);
          let controls=observation.controls.filter(matches);
          // A single-action planner must observe a newly mounted result. This
          // local bounded read loop models no additional network request.
          const deadline=Date.now()+2500;
          while(!controls.length&&Date.now()<deadline){await delay(30);observation=await computer.inspect(owned);controls=observation.controls.filter(matches);}
          assert.equal(controls.length,1,`Legacy target must be unique: ${step.target.name}`);decisions++;
          const control=controls[0],result=await dispatch('computer_action',{snapshot:observation.snapshot,kind:step.op==='fill'?'type':'click',control_id:control.control_id,expected_name:control.name,...(step.op==='fill'?{text:step.text}:{})},context());
          assert.ok(result.observation,'Legacy action must return fresh evidence.');assert.ok(!result.requires_review);observation=result.observation;
        }
        assert.ok(observation.controls.some(control=>control.name==='Saved Alpha revised'));
        return {scriptedDecisionBatches:decisions,result:{status:'completed',verified:true}};
      });
      const actual=await state();assert.equal(actual.savedName,'Alpha revised');assert.equal(actual.query,'Alpha');assert.deepEqual(actual.actions,['search','edit','save']);assert.equal(row.inputs,5);row.independentFixtureReadback=true;save();
    }
    await reset('ambiguous');let before=raw.length;
    const ambiguous=await executePlan({steps:[{op:'click',target:target('button','Search')}],completion:[{target:target('button','Search'),condition:'absent'}],adapter:new NativePlanAdapter({computer,target:owned}),context:context()});
    assert.equal(ambiguous.status,'interrupted');assert.deepEqual((await state()).actions,[]);assert.equal(raw.slice(before).filter(call=>['click','set_value'].includes(call.name)).length,0);report.checks.push({name:'ambiguous duplicate target receives no input',result:compact(ambiguous)});
    await reset('normal');before=raw.length;const abort=new AbortController();abort.abort();
    const cancelled=await executePlan({...plan,adapter:new NativePlanAdapter({computer,target:owned}),context:{...context(),signal:abort.signal}});
    assert.equal(cancelled.status,'interrupted');assert.deepEqual((await state()).actions,[]);assert.equal(raw.slice(before).filter(call=>['click','set_value'].includes(call.name)).length,0);report.checks.push({name:'pre-cancelled plan receives no input',result:compact(cancelled)});
    const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
    report.summary={trialsPerRoute:3,genericMedianLocalMs:median(report.rows.filter(row=>row.route==='general-plan').map(row=>row.totalMs)),legacyMedianLocalMs:median(report.rows.filter(row=>row.route==='legacy-single-actions').map(row=>row.totalMs)),scriptedDecisionBatches:{generalPlan:1,legacySingleActions:5},actualModelRequests:0,scope:'Local controller/driver timing only. Five scripted per-action decision boundaries become one generic-plan boundary; live model latency and overall task accuracy are not measured.'};report.status='passed';
  }catch(error){report.status='failed';report.error=error.message;throw error;}
  finally{computer.client.call=original;if(scope)desktopActivity.endScope(scope);if(window&&!window.isDestroyed())window.destroy();save();}
};
