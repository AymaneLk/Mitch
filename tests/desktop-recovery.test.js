'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {DesktopRecovery}=require('../desktop-recovery');
const {createDispatcher}=require('../core');
const {definitelyRefused}=require('../native-failure');
const {AI}=require('../ai');
const parent={pid:42,window_id:1,title:'App',on_screen:true},popup={pid:42,window_id:2,title:'Call window',on_screen:false};
function fixture(lists){
  let reads=0;const focused=[],delays=[];
  const state={window:parent,controls:[{name:'Call',type:'Button'}]};
  let inspections=0;
  const computer={snapshots:new Map([['a',state]]),listWindows:async()=>({windows:lists[Math.min(reads++,lists.length-1)]}),inspect:async w=>{const snapshot='fresh-'+(++inspections),fresh={...computer.nextState||state,window:w};computer.snapshots.set(snapshot,fresh);return{status:'inspected',snapshot,...fresh};},focus:async w=>{focused.push(w.window_id);return{status:'inspected',snapshot:'popup',window:w,controls:[{name:'Connecting',type:'Text'}]};}};
  const visual={clear(){},compareImages:()=>({meaningful:false})};
  const recovery=new DesktopRecovery({computer,visual,delay:async ms=>{delays.push(ms);}}),context={fromModel:true,activityScope:Symbol('task'),assertActive(){}};
  return {computer,recovery,context,focused,delays,reads:()=>reads,run:fn=>recovery.run('computer_action',{snapshot:'a',kind:'click',control_id:'0',expected_name:'Call'},context,fn)};
}

test('verified in-place controls use one immediate recovery read without delayed polls',async()=>{
  for(const control of [{control_id:'0',name:'Bold',type:'Button'},{control_id:'0',name:'Show grid',type:'CheckBox'}]){
    const f=fixture([[parent]]),before={window:parent,controls:[control],snapshot:'a'};
    f.computer.snapshots.set('a',before);
    const output=await f.recovery.run('computer_action',{snapshot:'a',kind:'click',control_id:'0',expected_name:control.name},f.context,async()=>({status:'verified',verified:true,observation:{...before,snapshot:'b'}}));
    assert.equal(output.verified,true);assert.equal(f.reads(),2);assert.deepEqual(f.delays,[]);
  }
});

test('Calculator sequence skips delayed polling only after fresh complete visible progress',async()=>{
  const window={...parent,title:'Calculatrice'},controls=['Six','Multiplier par','Sept','Est égal à'].map((name,index)=>({control_id:String(index),name,type:'Button'}));
  const f=fixture([[window]]);f.computer.snapshots.set('a',{window,controls:[...controls,{name:'Display',type:'Text',value:'0'}]});
  await f.recovery.run('computer_action_sequence',{snapshot:'a',actions:controls.map(control=>({kind:'click',control_id:control.control_id,expected_name:control.name}))},f.context,async()=>({status:'unverified',verified:false,observation:{snapshot:'b',window,controls:[...controls,{name:'Display',type:'Text',value:'42'}]}}));
  assert.equal(f.reads(),2);assert.deepEqual(f.delays,[]);
});

test('navigation, submissions and unknown buttons retain delayed popup detection even after confirmed progress',async()=>{
  for(const name of ['Call','Send','Messages','Profile','New','Save','Contact name']){
    const f=fixture([[parent],[parent],[parent],[parent,popup]]),control={control_id:'0',name,type:'Button'};
    f.computer.snapshots.set('a',{window:parent,controls:[control]});
    const output=await f.recovery.run('computer_action',{snapshot:'a',kind:'click',control_id:'0',expected_name:name},f.context,async()=>({status:'verified',verified:true,observation:{snapshot:'b',window:parent,controls:[control,{name:'Changed page',type:'Text'}]}}));
    assert.equal(output.recovered_window,true,name);assert.deepEqual(f.delays,[150,150],name);assert.equal(f.reads(),4,name);
  }
});

test('uncertain, degraded, stale or absent observations cannot take the short recovery path',async()=>{
  for(const variation of [{outcome_unknown:true},{requires_review:true},{observation:null},{observation:{snapshot:'a'}},{observation:{degraded:true}},{observation:{truncated:true}},{observation:{window:{pid:7,window_id:9}}}]){
    const f=fixture([[parent]]),control={control_id:'0',name:'Bold',type:'Button'};
    f.computer.snapshots.set('a',{window:parent,controls:[control]});
    const output={status:'verified',verified:true,...variation,observation:variation.observation===null?null:{snapshot:'b',window:parent,controls:[control],...variation.observation}};
    await f.recovery.run('computer_action',{snapshot:'a',kind:'click',control_id:'0',expected_name:'Bold'},f.context,async()=>output);
    assert.deepEqual(f.delays,[150,150]);
  }
});

test('partial, superseded or recovery-marked observations cannot bypass delayed popup reads',async()=>{
  const variations=[
    {accessibility_partial:true},{snapshot_superseded:true},{recovery_required:true},{input_suppressed:true},{stop_task:true},
    {cancelled:true},{canceled:true},{aborted:true},{interrupted:true},{refused:true},
    {status:'cancelled'},{status:'refused'},{status:'partial'},
  ];
  for(const layer of ['source','observation','output'])for(const variation of variations){
    const f=fixture([[parent]]),control={control_id:'0',name:'Bold',type:'Button'};
    f.computer.snapshots.set('a',{window:parent,controls:[control],...(layer==='source'?variation:{})});
    const output={status:'verified',verified:true,...(layer==='output'?variation:{}),observation:{snapshot:'b',window:parent,controls:[control],...(layer==='observation'?variation:{})}};
    await f.recovery.run('computer_action',{snapshot:'a',kind:'click',control_id:'0',expected_name:'Bold'},f.context,async()=>output);
    // Explicit native refusal already has an independent immediate return;
    // it must not be confused with successful local progress.
    if(layer==='output'&&variation.refused===true)assert.deepEqual(f.delays,[]);
    else assert.deepEqual(f.delays,[150,150],`${layer}: ${JSON.stringify(variation)}`);
  }
});

test('degraded source and non-native snapshots cannot take the native progress shortcut',async()=>{
  for(const source of [{degraded:true},{truncated:true},'visual','legacy']){
    const f=fixture([[parent]]),control={control_id:'0',name:'Bold',type:'Button'},state={id:'a',window:parent,controls:[control]};
    f.computer.snapshots.delete('a');
    if(source==='visual')f.recovery.visual.current=state;
    else if(source==='legacy')f.recovery.legacySnapshot=()=>state;
    else f.computer.snapshots.set('a',{...state,...source});
    await f.recovery.run('computer_action',{snapshot:'a',kind:'click',control_id:'0',expected_name:'Bold'},f.context,async()=>({status:'verified',verified:true,observation:{snapshot:'b',window:parent,controls:[control]}}));
    assert.deepEqual(f.delays,[150,150],JSON.stringify(source));
  }
});

test('the immediate inventory still recovers a popup after an otherwise in-place action',async()=>{
  const f=fixture([[parent],[parent,popup]]),control={control_id:'0',name:'Bold',type:'Button'};
  f.computer.snapshots.set('a',{window:parent,controls:[control]});
  const output=await f.recovery.run('computer_action',{snapshot:'a',kind:'click',control_id:'0',expected_name:'Bold'},f.context,async()=>({status:'verified',verified:true,observation:{snapshot:'b',window:parent,controls:[control]}}));
  assert.equal(output.recovered_window,true);assert.deepEqual(f.focused,[2]);assert.deepEqual(f.delays,[]);
});
test('generic invocation failure retains possible delivery through the dispatcher',async()=>{
  assert.equal(definitelyRefused({code:'tool_invocation_failed',effect:'refused'}),false);
  assert.equal(definitelyRefused({code:'background_unavailable'}),true);
  const dispatch=createDispatcher({computer_action:()=>{throw Object.assign(new Error('tool_invocation_failed'),{code:'tool_invocation_failed',action_attempted:true,refused:false});}});
  const result=await dispatch('computer_action',{snapshot:'a',kind:'click',control_id:'0',expected_name:'Call'});
  assert.equal(result.code,'tool_invocation_failed');assert.equal(result.outcome_unknown,true);assert.equal(result.action_attempted,true);
});
test('a delayed popup is discovered and focused after one input even if its response failed',async()=>{
  const f=fixture([[parent],[parent],[parent,popup]]);let inputs=0;
  const output=await f.run(async()=>{inputs++;return {status:'error',code:'tool_invocation_failed',action_attempted:true,outcome_unknown:true,_images:[{data_url:'old frame'}]};});
  assert.equal(inputs,1);assert.equal(output.recovered_window,true);assert.equal(output.observation.window.window_id,2);assert.deepEqual(f.focused,[2]);assert.equal(output._images,undefined);
  f.computer.snapshots.set('a',{window:parent,controls:[{name:'Call',type:'Button'}]});
  const suppressed=await f.run(async()=>{inputs++;});
  assert.equal(suppressed.input_suppressed,true);assert.equal(suppressed.stop_task,undefined);assert.ok(suppressed.observation.snapshot);assert.equal(inputs,1);
});
test('unrelated and ambiguous new windows are listed without guessing which to focus',async()=>{
  for(const opened of [[{...popup,pid:99}],[popup,{...popup,window_id:3}]]){
    const f=fixture([[parent],[parent,...opened]]),result=await f.run(async()=>({status:'unverified'}));
    assert.deepEqual(f.focused,[]);assert.equal(result.window_changes.opened.length,opened.length);
  }
});
test('an existing background window with a newly changed title is also found and focused',async()=>{
  const f=fixture([[parent,{...popup,title:'Waiting'}],[parent,popup]]);
  const result=await f.run(async()=>({status:'unverified'}));
  assert.equal(result.window_changes.opened.length,0);assert.equal(result.window_changes.changed.length,1);assert.equal(result.recovered_window,true);assert.deepEqual(f.focused,[2]);
});
test('unchanged visual clicks are not replayed, but a new user task can act',async()=>{
  const f=fixture([[parent]]);let inputs=0;
  await f.run(async()=>{inputs++;return {status:'unverified',visual_change:{meaningful:false}};});
  assert.equal((await f.run(async()=>{inputs++;})).input_suppressed,true);
  f.context.activityScope=Symbol('new task');await f.run(async()=>{inputs++;return{status:'verified',verified:true};});assert.equal(inputs,2);
});
test('a native refusal can change input route, while uncertain delivery cannot',async()=>{
  const f=fixture([[parent]]);
  await f.run(async()=>({status:'error',action_attempted:true,refused:true,code:'background_unavailable'}));
  let inputs=0;
  await f.recovery.run('computer_input',{snapshot:'a',kind:'click',expected_name:'Call',target_id:'v0'},f.context,async()=>{inputs++;return {status:'verified',verified:true};});
  assert.equal(inputs,1);
});
test('cancelled recovery never focuses a window or sends another action',async()=>{
  const f=fixture([[parent],[parent,popup]]),controller=new AbortController();f.context.signal=controller.signal;
  await assert.rejects(f.run(async()=>{controller.abort();return{status:'unverified'};}),/abort/i);assert.deepEqual(f.focused,[]);
});

test('uncertain Messages navigation refreshes state and allows the contact in the same window',async()=>{
  const f=fixture([[parent]]),inputs=[];
  f.computer.snapshots.set('a',{window:parent,controls:[{name:'Messages',type:'Link'}]});
  f.computer.nextState={controls:[{name:'Messages',type:'Link'},{name:'Omar Lammari',type:'Button'}]};
  const result=await f.recovery.run('computer_action',{snapshot:'a',kind:'click',expected_name:'Messages'},f.context,async()=>{inputs.push('Messages');return{status:'error',code:'tool_invocation_failed',action_attempted:true,outcome_unknown:true};});
  assert.equal(result.recovery.state_changed,true);assert.ok(result.observation.snapshot);
  const next=await f.recovery.run('computer_action',{snapshot:result.observation.snapshot,kind:'click',expected_name:'Omar Lammari'},f.context,async()=>{inputs.push('Omar Lammari');return{status:'verified',verified:true};});
  assert.equal(next.status,'verified');assert.deepEqual(inputs,['Messages','Omar Lammari']);
});

test('a different observed control is not frozen just because the refreshed window looks unchanged',async()=>{
  const f=fixture([[parent]]);let nextInputs=0;
  const first=await f.run(async()=>({status:'error',action_attempted:true,outcome_unknown:true}));
  await f.recovery.run('computer_action',{snapshot:first.observation.snapshot,kind:'click',expected_name:'Back'},f.context,async()=>{nextInputs++;return{status:'verified',verified:true};});
  assert.equal(nextInputs,1);
});

test('an uncertain call stays blocked across fresh states, input routes, and sequence wrapping',async()=>{
  const f=fixture([[parent]]);let inputs=0;
  await f.run(async()=>{inputs++;return{status:'error',action_attempted:true,outcome_unknown:true};});
  f.computer.snapshots.set('b',{window:parent,controls:[{name:'Call',type:'Button'},{name:'Connecting',type:'Text'}]});
  const click={snapshot:'b',kind:'click',expected_name:'Call'};
  for(const [name,args] of [['computer_input',click],['computer_action_sequence',{snapshot:'b',actions:[{kind:'click',expected_name:'Call'}]}],['computer_input',{...click,kind:'double_click',expected_name:' CALL '}]] ){
    const result=await f.recovery.run(name,args,f.context,async()=>{inputs++;return{status:'verified'};});
    assert.equal(result.input_suppressed,true);
  }
  assert.equal(inputs,1);
});

test('a no-progress block expires when comparable window content actually changes',async()=>{
  const f=fixture([[parent]]);let inputs=0;
  const run=snapshot=>f.recovery.run('computer_action',{snapshot,kind:'click',expected_name:'Messages'},f.context,async()=>{inputs++;return{status:'unverified',observation:{window:parent,controls:[{name:'Call',type:'Button'}]}};});
  await run('a');assert.equal((await run('a')).input_suppressed,true);
  f.computer.snapshots.set('b',{window:parent,controls:[{name:'Another page',type:'Heading'},{name:'Messages',type:'Link'}]});
  assert.notEqual((await run('b')).input_suppressed,true);assert.equal(inputs,2);
});

test('incomparable image and accessibility snapshots cannot clear a no-progress block',async()=>{
  const f=fixture([[parent]]);await f.run(async()=>({status:'unverified',visual_change:{meaningful:false}}));
  f.computer.snapshots.set('b',{window:parent,image:'data:image/png;base64,AA=='});
  const result=await f.recovery.run('computer_input',{snapshot:'b',kind:'click',expected_name:'Call'},f.context,async()=>assert.fail('Replay'));
  assert.equal(result.input_suppressed,true);
});

test('a blocked retry returns fresh state instead of ending the task, with bounded refusal loops',async()=>{
  const f=fixture([[parent]]);await f.run(async()=>({status:'error',action_attempted:true,outcome_unknown:true}));
  for(let i=0;i<3;i++){
    const result=await f.run(async()=>assert.fail('Replay'));
    assert.equal(result.stop_task,i===2?true:undefined);assert.equal(result.recovery_required,true);assert.ok(result.window_changes.open_windows);assert.ok(result.observation.snapshot);
  }
});

test('a failed recovery read reports the actual blocker without delivering another input',async()=>{
  const f=fixture([[parent]]);f.computer.inspect=async()=>{throw new Error('Window closed');};
  const first=await f.run(async()=>({status:'error',action_attempted:true,outcome_unknown:true}));
  assert.equal(first.recovery_error,'Window closed');
  const blocked=await f.run(async()=>assert.fail('Replay'));assert.equal(blocked.input_suppressed,true);assert.equal(blocked.recovery_error,'Window closed');
});

test('the AI tool loop survives a suppressed duplicate and completes the next navigation step',async()=>{
  const f=fixture([[parent]]);let modelCalls=0,inputs=0,last;
  f.computer.nextState={controls:[{name:'Messages',type:'Link'},{name:'Test contact',type:'Button'}]};
  const ai=new AI(()=>({}),async()=>'',async(name,args,context)=>{
    last=await f.recovery.run(name,args,{...f.context,...context},async()=>{
      inputs++;
      return inputs===1?{status:'error',action_attempted:true,outcome_unknown:true}:{status:'verified',verified:true,observation:{snapshot:'done',window:parent,controls:[{name:'Test conversation',type:'Heading'}]}};
    });return last;
  });
  ai.request=async()=>{
    const step=++modelCalls;
    if(step===4)return{output:[{type:'message',content:[{type:'output_text',text:'The test conversation is open.'}]}]};
    if(step===3){assert.equal(last.input_suppressed,true);assert.equal(last.stop_task,undefined);}
    const args={snapshot:step===1?'a':last.observation.snapshot,kind:'click',expected_name:step===3?'Test contact':'Messages'};
    return{output:[{type:'function_call',call_id:String(step),name:'computer_action',arguments:JSON.stringify(args)}]};
  };
  assert.equal(await ai.chat('Open Messages and the test contact',undefined,f.context.activityScope),'The test conversation is open.');
  assert.equal(modelCalls,4);assert.equal(inputs,2);
});
