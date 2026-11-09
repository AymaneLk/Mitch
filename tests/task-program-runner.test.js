'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {runGuardedTaskProgram,compactEvidence,MAX_EVIDENCE_BYTES}=require('../task-program-runner');
const {normalizeFrame}=require('../task-program-host');
const {scopeSignature}=require('../procedure-memory');
const target={kind:'native',app:'Records'},selector={name:'Name',role:'textbox',match:'exact'};
const condition=value=>({target:selector,condition:'value',value});
const window={pid:100,window_id:10,title:'Records',app:'Records.exe',minimized:false};
const frame=(value='Alpha',extra={})=>({status:'inspected',snapshot:'native-'+value,window:{...window},controls:[{control_id:'1',type:'Edit',name:'Name',value,editable:true}],...extra});
const program={version:1,steps:[{op:'bind',target},{op:'act',steps:[{op:'fill',target:selector,text:'Beta'}],completion:[condition('Beta')]}],completion:[condition('Beta')]};
const replay=()=>({scopeSignatures:[{target,signature:scopeSignature(target,normalizeFrame(frame()))}]});
function fixture({initial='Alpha',minimized=false,mutate,abortAfter}={}){
  const calls=[];let value=initial;
  return {calls,dispatch:async(name,args)=>{
    calls.push(name);
    if(name==='computer_list_windows')return {status:'ok',windows:[{...window,minimized}]};
    if(name==='computer_inspect_window')return frame(value);
    assert.equal(name,'computer_execute_plan');
    if(mutate)return mutate(args);
    value='Beta';const result={status:'completed',verified:true,attempted:1,completed:1,delivered_steps:[{op:'fill',target:selector,status:'delivered'}],observation:frame(value)};
    abortAfter?.();return result;
  }};
}
test('runner returns verified assertions, complete delivery ledger and nested dispatch timing',async()=>{
  const f=fixture(),result=await runGuardedTaskProgram({program,dispatch:f.dispatch});
  assert.equal(result.status,'completed');assert.equal(result.program_assertions_verified,true);assert.equal(result.action_attempted,true);assert.equal(result.delivered_steps.length,1);assert.equal(result.events.length,f.calls.length);assert.equal(result.event_count,f.calls.length);assert.equal(result.timing.input_calls,1);assert.ok(result.timing.total_ms>=result.timing.tool_ms);assert.equal(result.evidence_truncated,false);
});
test('replay compares a newly bound layout, never stale prefetch, before any input',async()=>{
  const f=fixture({initial:'Changed after prefetch'}),result=await runGuardedTaskProgram({program,dispatch:f.dispatch,initialContext:{scopes:[{target,observation:normalizeFrame(frame())}]},replay:replay()});
  assert.equal(result.reason,'replay_context_mismatch');assert.equal(result.action_attempted,false);assert.equal(result.cold_plan_required,true);assert.equal(result.outcome_unknown,undefined);assert.deepEqual(f.calls,['computer_list_windows','computer_inspect_window']);assert.equal(result.events.at(-1).output.controls[0].value,'Changed after prefetch');
});
test('matching replay permits actions only after fresh binding',async()=>{
  const f=fixture(),result=await runGuardedTaskProgram({program,dispatch:f.dispatch,replay:replay()});
  assert.equal(result.status,'completed');assert.equal(result.replay_context_verified,true);assert.equal(result.action_attempted,true);
});
test('replay cannot restore minimized scopes, launch missing apps or use multiple bindings before validation',async()=>{
  const f=fixture({minimized:true}),result=await runGuardedTaskProgram({program,dispatch:f.dispatch,replay:replay()});
  assert.deepEqual(f.calls,['computer_list_windows']);assert.equal(result.reason,'replay_context_mismatch');assert.equal(result.action_attempted,false);assert.equal(result.outcome_unknown,undefined);
  for(const changed of [{...program,steps:[{op:'bind',target:{...target,open_if_missing:true}},...program.steps.slice(1)]},{...program,steps:[program.steps[0],...program.steps]}]){
    let calls=0;const stopped=await runGuardedTaskProgram({program:changed,replay:replay(),dispatch:async()=>{calls++;}});assert.equal(calls,0);assert.equal(stopped.action_attempted,false);assert.equal(stopped.reason,'replay_context_mismatch');
  }
});
test('cancelled preparation sends no input and cancellation after delivery retains the ledger',async()=>{
  const controller=new AbortController();controller.abort();const f=fixture(),result=await runGuardedTaskProgram({program,dispatch:f.dispatch,context:{signal:controller.signal}});assert.equal(result.reason,'cancelled');assert.equal(result.action_attempted,false);assert.deepEqual(f.calls,[]);
  const active=new AbortController(),second=fixture({abortAfter:()=>active.abort()});const stopped=await runGuardedTaskProgram({program,dispatch:second.dispatch,context:{signal:active.signal}});assert.equal(stopped.outcome_unknown,true);assert.equal(stopped.delivered_steps.length,1);assert.equal(stopped.action_attempted,true);assert.equal(second.calls.filter(name=>name==='computer_execute_plan').length,1);
});
test('unknown outcomes and invalid post-input snapshots stop and preserve delivered actions',async()=>{
  for(const observation of [frame(),{controls:[]}]){
    const f=fixture({mutate:()=>({status:'interrupted',outcome_unknown:true,attempted:1,delivered_steps:[{op:'fill',status:'delivered'}],observation})});
    const result=await runGuardedTaskProgram({program:{...program,steps:[...program.steps,program.steps[1]]},dispatch:f.dispatch});assert.equal(result.outcome_unknown,true);assert.equal(result.delivered_steps.length,1);assert.equal(result.action_attempted,true);assert.equal(f.calls.filter(name=>name==='computer_execute_plan').length,1);
  }
});
test('cancellation while a dispatched action is pending preserves attempted/unknown status',async()=>{
  const controller=new AbortController();let release;
  const f=fixture({mutate:()=>new Promise(resolve=>{release=resolve;queueMicrotask(()=>controller.abort());})});
  const result=await runGuardedTaskProgram({program,dispatch:f.dispatch,context:{signal:controller.signal}});
  assert.equal(result.outcome_unknown,true);assert.equal(result.action_attempted,true);assert.equal(result.timing.pending_tool_calls,1);assert.equal(f.calls.filter(name=>name==='computer_execute_plan').length,1);
  release({status:'interrupted',outcome_unknown:true,attempted:1});
});
test('evidence omits images and passwords, bounds each view and signals every size reduction',()=>{
  const controls=Array.from({length:90},(_,i)=>({name:'Control '+i,role:'textbox',value:'あ'.repeat(2000)}));controls.push({name:'Password',role:'textbox',protected:true,value:'private-password-value'});
  const event={name:'computer_inspect_window',args:{},ms:1,output:{controls,complete:true,_images:[{data_url:'data:image/png;base64,secret-image'}],url:'https://example.test/path?token=secret-token#private',session_id:'private-session'}};
  const result=compactEvidence({status:'completed',verified:true,observation:event.output},Array.from({length:200},()=>event)),encoded=JSON.stringify(result);
  assert.ok(Buffer.byteLength(encoded)<=MAX_EVIDENCE_BYTES);assert.equal(result.evidence_truncated,true);assert.equal(result.event_count,200);assert.ok(result.event_placeholders>0);assert.ok(!encoded.includes('secret-image'));assert.ok(!encoded.includes('private-password-value'));assert.ok(!encoded.includes('secret-token'));assert.ok(!encoded.includes('private-session'));
  const protectedResult=compactEvidence({status:'interrupted'},[{name:'computer_execute_plan',args:{steps:[{op:'fill',target:{name:'Password',role:'textbox'},text:'private-password-value'}]},output:{controls:[{name:'Password',role:'textbox',value:'private-password-value'}]}}]);assert.ok(!JSON.stringify(protectedResult).includes('private-password-value'));
});
