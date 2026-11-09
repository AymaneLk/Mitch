const {test}=require('node:test'),assert=require('node:assert/strict');
const {AI}=require('../ai');
const settings=()=>({chatProvider:'deepseek',allowDesktop:true,allowScreen:false});
const frame={status:'inspected',snapshot:'fresh',focus_verified:true,window:{pid:1,window_id:2,title:'Calculator'},controls:[{control_id:'1',name:'One',type:'Button',enabled:true}],degraded:false,truncated:false};
const say=text=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]});
test('an exact app-open task verifies locally without credentials or a model request',async()=>{
  const calls=[];const ai=new AI(settings,()=>assert.fail('No key'),async(name)=>{calls.push(name);return name==='list_apps'?{status:'ok',apps:[{name:'Calculator',app_id:'calc'}]}:{status:'opened',observation:frame};},()=>assert.fail('No network'));
  assert.equal(await ai.chat('Open Calculator.'),'Calculator is open.');assert.deepEqual(calls,['list_apps','open_app']);
  assert.equal(ai.lastTaskTiming.modelRequests,0);assert.equal(ai.lastTaskTiming.route,'local');assert.equal(ai.history.length,2);
});
test('partial local execution hands observations to the model and never reopens by itself',async()=>{
  let opens=0,body;const ai=new AI(settings,()=>{},async(name)=>name==='list_apps'?{status:'ok',apps:[{name:'Calculator',app_id:'calc'}]}:(opens++,{status:'launch_requested',app:'Calculator'}));
  ai.request=async(_endpoint,input)=>{body=input;return say('I could not inspect Calculator.');};
  ai.reviewDesktop=async()=>({decision:'blocked',answer:'I could not inspect Calculator.',reason:'No window'});
  // The independent observation gate stays active when launch was not verified.
  await ai.chat('Open Calculator.');assert.equal(opens,1);assert.equal(ai.lastTaskTiming.route,'hybrid');
  assert.ok(body.input.some(item=>item.type==='function_call_output'&&JSON.parse(item.output).status==='launch_requested'));
});
test('Stop during discovery prevents the local app launch',async()=>{
  let entered,release;const begun=new Promise(r=>entered=r),catalog=new Promise(r=>release=r);let opens=0;
  const ai=new AI(settings,()=>{},async(name)=>{if(name==='list_apps'){entered();return catalog;}opens++;});
  const pending=ai.chat('Open Calculator.');await begun;ai.cancel();release({status:'ok',apps:[{name:'Calculator',app_id:'calc'}]});
  await assert.rejects(pending,/stopped/);assert.equal(opens,0);assert.equal(ai.history.length,0);
});
test('invalid desktop arguments are bounded by the failure limit without dispatching',async()=>{
  let requests=0;const ai=new AI(settings,()=>{},()=>assert.fail('Invalid arguments must not execute'));
  ai.request=async()=>{requests++;return {output:[{type:'function_call',call_id:String(requests),name:'computer_action',arguments:'{broken'}]};};
  assert.match(await ai.chat('Click the selected control'),/three unsuccessful/);assert.equal(requests,3);
});
