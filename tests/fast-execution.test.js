'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {AI}=require('../ai'),{validateTool}=require('../core');
const {replyTools,takeReply}=require('../execution-reply');
const {preparedDecision}=require('../workflow-assistant');
const condition={target:{name:'Reference',role:'textbox'},condition:'value',value:'Harbor'};
const program={version:1,steps:[{op:'bind',target:{kind:'native',app:'Owned workspace'}},{op:'act',steps:[{op:'fill',target:condition.target,text:'Harbor'}],completion:[condition]}],completion:[condition]};
const observation={source:'native-accessibility',complete:true,snapshot:'fresh',window:{pid:1,window_id:2},controls:[{control_id:'1',name:'Reference',type:'Edit',editable:true,enabled:true,value:'Harbor'}]};
const complete={status:'completed',verified:true,action_attempted:true,observation};
const resultText='The reference now says Harbor.';
const call=(name='computer_run_workflow',args={...program,final:true,result_text:resultText})=>({output:[{type:'function_call',call_id:'call-'+Math.random(),name,arguments:JSON.stringify(args)}]});
const answer=text=>({output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]});
function setup({responses=[call()],dispatch=async()=>complete,settings={}}={}){
 const requests=[],actions=[],config={chatProvider:'chatgpt',chatModel:'test',allowDesktop:true,allowScreen:false,workflowEngine:true,fastExecution:true,parallelGoalVerification:true,reuseWorkflows:false,...settings};
 const ai=new AI(()=>config,()=>assert.fail('No key'),async(name,args,context)=>{validateTool(name,args);actions.push({name,args});return dispatch(name,args,context);},()=>assert.fail('No network'));
 ai.prepareContext=async()=>({scopes:[{target:{kind:'native',app:'Owned workspace'},observation}],windows:[]});
 ai.reviewDesktop=()=>assert.fail('Fast execution must never invoke the independent reviewer');
 ai.request=async(_endpoint,body)=>{requests.push(body);assert.equal(body.response_format,undefined,'No parallel goal compiler or final reviewer');assert.ok(responses.length,'Unexpected additional model call');return responses.shift();};
 return {ai,requests,actions,config};
}
const request='In Owned workspace, update the Reference field to Harbor.';
test('verified general workflow needs one model call, strips reply metadata and releases its natural reply only after execution',async()=>{
 let release,entered;const running=new Promise(resolve=>entered=resolve);
 const h=setup({dispatch:()=>{entered();return new Promise(resolve=>release=resolve);}});
 const pending=h.ai.chat(request);await running;
 assert.equal(h.ai.history.length,0);assert.equal(h.requests.length,1);assert.equal(h.actions[0].args.result_text,undefined);assert.equal(h.actions[0].args.final,undefined);
 assert.ok(h.requests[0].tools.find(t=>t.name==='computer_run_workflow').parameters.properties.result_text);
 release(complete);assert.equal(await pending,resultText);assert.equal(h.ai.lastTaskTiming.modelRequests,1);assert.equal(h.ai.lastTaskTiming.localCompletion,true);
});
test('an intermediate verified batch continues with the actor and never releases its proposed final reply',async()=>{
 const h=setup({responses:[call('computer_run_workflow',{...program,final:false,result_text:'Premature answer'}),answer('The live reference is Harbor.')]});
 assert.equal(await h.ai.chat(request),'The live reference is Harbor.');assert.equal(h.requests.length,2);assert.equal(h.actions.length,1);
});
test('failed local assertions and truncated readbacks cannot release a proposed success',async()=>{
 for(const output of [{...complete,status:'interrupted',verified:false,reason:'completion_unmet'},{...complete,evidence_truncated:true}]){
  const h=setup({dispatch:async()=>output,responses:[call(),answer('The requested result could not be confirmed.')]});
  assert.equal(await h.ai.chat(request),'The requested result could not be confirmed.');assert.equal(h.requests.length,2);assert.equal(h.actions.length,1);
 }
});
test('delivery uncertainty with a read-only recovery stops without reviewer, replay or success text',async()=>{
 const h=setup({dispatch:async()=>({...complete,status:'interrupted',verified:false,outcome_unknown:true,read_only_recovery:true})});
 assert.match(await h.ai.chat(request),/could not confirm/);assert.equal(h.requests.length,1);assert.equal(h.actions.length,1);
});
test('native and browser final plans finish locally without an extra final decision',async()=>{
 for(const name of ['computer_execute_plan','browser_execute_plan']){
  const h=setup({settings:{workflowEngine:false},responses:[call(name,{snapshot:'fresh',steps:program.steps[1].steps,completion:[condition],final:true,result_text:resultText})]});
  assert.equal(await h.ai.chat(request),resultText);assert.equal(h.requests.length,1);assert.equal(h.actions[0].args.result_text,undefined);
 }
});
test('Stop during execution cannot publish the planned success',async()=>{
 let release,entered;const running=new Promise(resolve=>entered=resolve);
 const h=setup({dispatch:()=>{entered();return new Promise(resolve=>release=resolve);}}),pending=h.ai.chat(request);await running;
 h.ai.cancel();release(complete);await assert.rejects(pending,/stopped/i);assert.equal(h.ai.history.length,0);
});
test('reply metadata is bounded before input and speculative validation preserves it without executing',()=>{
 for(const result_text of ['',{},'x'.repeat(401)])assert.throws(()=>takeReply('computer_run_workflow',{...program,result_text}));
 assert.throws(()=>takeReply('computer_run_workflow',{...program,final:'yes'}));
 const draft=preparedDecision(call(),{});assert.equal(JSON.parse(draft.output[0].arguments).result_text,resultText);
 assert.equal(replyTools([{name:'other',parameters:{}}])[0].parameters.properties,undefined);
});
