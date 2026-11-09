'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {nativeErrorDetails,definitelyRefused,errorResult}=require('../native-failure');
const {ComputerUse}=require('../computer-use');
const {ComputerVisual}=require('../computer-visual');

test('native errors preserve bounded refusal strings and object diagnostics without invented codes',()=>{
  for(const refusal of ['Window cannot be activated',{message:'Window cannot be activated'},{hint:'Window cannot be activated'},{reason:'Window cannot be activated'}]){
    const detail=nativeErrorDetails({}, {refusal}, 'Fallback');assert.equal(detail.message,'Window cannot be activated');assert.equal(detail.code,undefined);assert.equal(detail.refused,false);
  }
  const coded=nativeErrorDetails({}, {refusal:{code:'permission_denied',reason:'Desktop access denied'}}, 'Fallback');
  assert.equal(coded.message,'Desktop access denied');assert.equal(coded.code,'permission_denied');assert.equal(coded.refused,true);
  const bounded=nativeErrorDetails({}, {refusal:{message:'x'.repeat(2000),code:'x'.repeat(1000)}}, 'Fallback');
  assert.equal(bounded.message.length,500);assert.equal(bounded.code,undefined);
  assert.equal(nativeErrorDetails({}, {refusal:{unexpected:'private payload'}}, 'Fallback').message,'Fallback');
});

test('only empty structured errors consult bounded text fallback; arbitrary JSON is not exposed',()=>{
  const result={isError:true,structuredContent:{},content:[{type:'image',data:'private pixels'},{type:'text',text:JSON.stringify({refusal:{code:'stale_capture',message:'Read the target again'}})}]};
  assert.deepEqual(nativeErrorDetails(result,{},'Fallback'),{message:'Read the target again',code:'stale_capture',refused:true});
  assert.equal(nativeErrorDetails({content:[{type:'text',text:'Plain failure'}]}, {}, 'Fallback').message,'Plain failure');
  assert.equal(nativeErrorDetails(result,{message:'Primary error'},'Fallback').message,'Primary error');
  assert.equal(nativeErrorDetails({content:[{type:'text',text:'{"secret":"do-not-echo"}'}]}, {}, 'Fallback').message,'Fallback');
  assert.equal(nativeErrorDetails({content:[{type:'text',text:'{"secret":"truncated'}]}, {}, 'Fallback').message,'Fallback');
  assert.equal(nativeErrorDetails({content:[{type:'text',text:'m'.repeat(2000)}]}, {}, 'Fallback').message.length,500);
});

test('generic invocation failures remain uncertain even with refusal flags or zero delivery claims',()=>{
  for(const data of [
    {code:'tool_invocation_failed',effect:'refused'},
    {refusal:{code:'tool_invocation_failed',message:'Native call failed'},effect:'refused'},
    {error:{code:'tool_invocation_failed'},delivery:{delivered_count:0}},
  ]){
    const detail=nativeErrorDetails({},data,'Fallback');assert.equal(detail.code,'tool_invocation_failed');assert.equal(detail.refused,false);assert.equal(definitelyRefused(data),false);
    const result=errorResult(Object.assign(Error(detail.message),detail,{action_attempted:true}));assert.equal(result.outcome_unknown,true);assert.equal(result.refused,undefined);
  }
  assert.equal(definitelyRefused({delivery:{delivered_count:0}}),true);
  assert.equal(definitelyRefused({effect:'refused'}),true);
  assert.equal(definitelyRefused({status:'error'}),false);
});

test('native inspection and visual activation expose actual refusal details without any input',async()=>{
  const calls=[];
  const client={call:async name=>{calls.push(name);if(name==='start_session')return {structuredContent:{active:true}};if(name==='list_windows')return {structuredContent:{windows:[{pid:42,window_id:123,title:'Fixture'}]}};return {isError:true,structuredContent:{refusal:{message:'That window cannot be inspected',code:'permission_denied'}}};},stop:async()=>{}};
  const computer=new ComputerUse({client,getSettings:()=>({allowDesktop:true,allowScreen:true}),confirm:async()=>assert.fail('No input should be requested')});
  await computer.listWindows();await assert.rejects(computer.inspect({pid:42,window_id:123}),error=>error.message==='That window cannot be inspected'&&error.code==='permission_denied'&&error.refused===true);
  client.call=async name=>{calls.push(name);return {isError:true,structuredContent:{},content:[{type:'text',text:JSON.stringify({refusal:{reason:'Cannot activate this window',code:'tool_invocation_failed'},effect:'refused'})}]};};
  const visual=new ComputerVisual({computer});await assert.rejects(visual.observe({scope:'window',pid:42,window_id:123}),error=>error.message==='Cannot activate this window'&&error.code==='tool_invocation_failed'&&error.refused===false);
  assert.deepEqual(calls,['start_session','list_windows','get_window_state','bring_to_front']);
});
