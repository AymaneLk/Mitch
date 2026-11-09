'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDispatcher}=require('../core');
const {runGuardedTaskProgram}=require('../task-program-runner');
const target={name:'Ready',role:'button'},program={version:1,steps:[{op:'bind',target:{kind:'native',app:'Fixture'}}],completion:[{target,condition:'exists'}]};
test('workflow children run within the admitted serial transaction without deadlock and retain trusted context',async()=>{
  const events=[],scope=Symbol('scope'),bindings={name:'value'},replay={scopeSignatures:[]};
  const dispatch=createDispatcher({computer_run_workflow:async(args,context)=>{
    assert.equal(context.workflowBindings,bindings);assert.equal(context.workflowReplay,replay);events.push('parent');
    const output=await context.dispatchChild('computer_list_windows',{query:''},{activityScope:Symbol('spoof'),fromModel:false});events.push('parent-done');return output;
  },computer_list_windows:async(args,context)=>{assert.equal(context.activityScope,scope);assert.equal(context.fromModel,true);assert.equal(context.dispatchChild,undefined);events.push('child');return {status:'ok',windows:[]};},read_notes:()=>{events.push('external');return {status:'ok'};}});
  const result=await Promise.all([dispatch('computer_run_workflow',program,{activityScope:scope,fromModel:true,workflowBindings:bindings,workflowReplay:replay}),dispatch('read_notes',{query:''})]);
  assert.equal(result[0].status,'ok');assert.deepEqual(events,['parent','child','parent-done','external']);
});
test('child dispatch validates schemas, forbids nested workflows and expires at parent completion',async()=>{
  let child,calls=0;const dispatch=createDispatcher({computer_run_workflow:async(args,context)=>{child=context.dispatchChild;assert.equal((await child('computer_run_workflow',program)).refused,true);assert.equal((await child('computer_list_windows',{query:'',unexpected:true})).status,'error');return {status:'ok'};},computer_list_windows:()=>{calls++;return {status:'ok'};}});
  await dispatch('computer_run_workflow',program);assert.equal((await child('computer_list_windows',{query:''})).refused,true);assert.equal(calls,0);
});
test('cancellation blocks child admission and children cannot replace the parent signal',async()=>{
  const controller=new AbortController();let calls=0,dispatch;
  dispatch=createDispatcher({computer_run_workflow:async(args,context)=>{controller.abort();return context.dispatchChild('computer_list_windows',{query:''},{signal:new AbortController().signal});},computer_list_windows:()=>{calls++;return {status:'ok'};}});
  const output=await dispatch('computer_run_workflow',program,{signal:controller.signal});assert.equal(output.refused,true);assert.equal(calls,0);
  const generation=createDispatcher({computer_run_workflow:async(args,context)=>{generation.cancel();return context.dispatchChild('computer_list_windows',{query:''});},computer_list_windows:()=>{calls++;}});assert.equal((await generation('computer_run_workflow',program)).refused,true);assert.equal(calls,0);
});
test('read-only preparation runs independent reads in parallel while mutation queue is occupied',async()=>{
  let release,started=0,firstReadResolve;const firstRead=new Promise(resolve=>{firstReadResolve=resolve;});
  const dispatch=createDispatcher({create_note:()=>new Promise(resolve=>{release=()=>resolve({status:'saved'});}),computer_list_windows:async()=>{started++;if(started===2)firstReadResolve();await firstRead;return {status:'ok',windows:[]};},browser_list_tabs:async()=>{started++;if(started===2)firstReadResolve();await firstRead;return {status:'ok',tabs:[]};}});
  const pending=dispatch('create_note',{title:'owned',text:'fixture'});await Promise.resolve();
  const results=await Promise.all([dispatch.readOnly('computer_list_windows',{query:''}),dispatch.readOnly('browser_list_tabs',{})]);assert.equal(started,2);assert.equal(results[0].status,'ok');assert.equal(results[1].status,'ok');release();await pending;
});
test('read-only entry rejects mutations and malformed reads, and reports cancelled late reads',async()=>{
  let calls=0;const controller=new AbortController();const dispatch=createDispatcher({create_note:()=>{calls++;},computer_list_windows:()=>{calls++;controller.abort();return {status:'ok',windows:[]};}});
  assert.equal((await dispatch.readOnly('create_note',{title:'x',text:'y'})).refused,true);assert.equal((await dispatch.readOnly('computer_list_windows',{query:'',extra:true})).status,'error');assert.equal(calls,0);
  assert.equal((await dispatch.readOnly('computer_list_windows',{query:''},{signal:controller.signal})).refused,true);assert.equal(calls,1);
});
test('unawaited children are drained before the next transaction and queued late children cannot escape',async()=>{
  let release,enter;const entered=new Promise(resolve=>{enter=resolve;});let held,child,events=[];
  const dispatch=createDispatcher({computer_run_workflow:async(args,context)=>{child=context.dispatchChild;held=child('computer_list_windows',{query:''});await entered;return {status:'ok'};},computer_list_windows:async(args,context)=>{enter();await new Promise(resolve=>{release=resolve;});assert.throws(context.assertActive,/parent operation has ended/);events.push('child-settled');return {status:'ok'};},read_notes:()=>{events.push('next');return {status:'ok'};}});
  const parent=dispatch('computer_run_workflow',program);await entered;await Promise.resolve();await Promise.resolve();const next=dispatch('read_notes',{query:''});release();await Promise.all([parent,next,held]);assert.deepEqual(events,['child-settled','next']);assert.equal((await child('computer_list_windows',{query:''})).refused,true);
});
test('the real runner can execute through child dispatch and its nested activity checks',async()=>{
  const window={pid:10,window_id:20,title:'Fixture',app:'Fixture.exe'},frame={snapshot:'owned-frame',window,controls:[{name:'Ready',type:'Button',control_id:'1'}]};let checks=0;
  const dispatch=createDispatcher({computer_run_workflow:(args,context)=>runGuardedTaskProgram({program:args,dispatch:context.dispatchChild,context}),computer_list_windows:()=>({status:'ok',windows:[window]}),computer_inspect_window:()=>frame});
  const output=await dispatch('computer_run_workflow',program,{fromModel:true,assertActive:()=>{checks++;}});assert.equal(output.status,'completed');assert.equal(output.action_attempted,false);assert.ok(checks>5);assert.equal(output.timing.tool_calls,3);
});
