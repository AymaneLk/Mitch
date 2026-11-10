'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseTaskGoal,verifyTaskGoal}=require('../task-goals');
const {AI}=require('../ai');
const text='In "Example", set "Search" to "Alpha"';
const output=()=>({status:'completed',verified:true,observation:{snapshot:'fresh',source:'native-accessibility',window:{pid:1,window_id:2,title:'Example'},complete:true,controls:[{name:'Search',role:'textbox',value:'Alpha',editable:true,enabled:true}]}});
test('goal contracts consume the entire request and reject extra steps or protected fields',()=>{
  assert.equal(parseTaskGoal(text).value,'Alpha');
  for(const request of [text+' and save',text+' then send it',text+' and tell me the result','In "Example", set "Password" to "x"'])assert.equal(parseTaskGoal(request),null);
});
test('local completion checks actual final state instead of trusting model assertions',()=>{
  const event={name:'computer_run_workflow',output:output()};assert.equal(verifyTaskGoal(text,[event]).decision,'complete');
  for(const mutate of [o=>o.outcome_unknown=true,o=>o.evidence_truncated=true,o=>o.status='interrupted',o=>o.observation.complete=false,o=>o.observation.window.title='Other',o=>o.observation.controls[0].value='wrong',o=>o.observation.controls[0].protected=true,o=>o.observation.controls.push({...o.observation.controls[0]})]){
    const changed=output();mutate(changed);assert.equal(verifyTaskGoal(text,[{...event,output:changed}]),null);
  }
});
test('a navigation link is not proof of being at its destination',()=>{
  const event={name:'browser_execute_plan',output:output()};Object.assign(event.output.observation,{source:'browser_dom',url:'https://example.test/'});
  event.output.observation.controls=[{name:'Settings',role:'link'}];const request='Open "example.test" and go to "Settings"';assert.equal(verifyTaskGoal(request,[event]),null);
  event.output.observation.controls[0].role='heading';assert.equal(verifyTaskGoal(request,[event]).decision,'complete');
});
test('the production AI loop finishes a recognized verified task after one model call',async()=>{
  let calls=0;
  const ai=new AI(()=>({chatProvider:'chatgpt',allowDesktop:true,allowScreen:false,workflowEngine:true}),()=>'',async()=>output());
  ai.request=async()=>{assert.equal(++calls,1,'No second model review is needed');return {output:[{type:'function_call',call_id:'c',name:'computer_run_workflow',arguments:JSON.stringify({version:1,steps:[{op:'bind',target:{kind:'native',app:'Example'}},{op:'act',steps:[{op:'fill',target:{name:'Search'},text:'Alpha'}],completion:[{target:{name:'Search'},condition:'value',value:'Alpha'}]}]})}]};};
  assert.equal(await ai.chat(text),'Set Search to the requested text.');assert.equal(calls,1);assert.equal(ai.lastTaskTiming.localCompletion,true);
});
