'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {AI}=require('../ai');
const {validateTool}=require('../core');
const original='In the owned browser page, open my repositories.';
const settings=()=>({chatProvider:'deepseek',chatModel:'test',allowDesktop:false,allowScreen:false});
const plan={snapshot:'owned-source',steps:[{op:'click',target:{role:'link',name:'Your repositories'}}],completion:[{target:{role:'heading',name:'Your repositories'},condition:'exists'}],final:true};
const message=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
const page={status:'observed',source:'browser_dom',snapshot:'owned-recovered',browser:'opera',session_id:'owned',tab_id:3,url:'https://owned.test/repositories',document_id:'new-document',complete:true,controls:[{id:'heading',name:'Your repositories',role:'heading',enabled:true,protected:false}],untrusted_page_data:true};
function setup({decision='complete',observation=page,recovery=true}={}){
  const requests=[],dispatched=[];
  const ai=new AI(settings,()=>assert.fail('No credentials'),async(name,args)=>{
    validateTool(name,args);dispatched.push(name);assert.equal(name,'browser_execute_plan');
    assert.equal(dispatched.length,1,'An unknown navigation may never be replayed.');
    return {status:'interrupted',verified:false,action_attempted:true,outcome_unknown:true,reason:'page_outcome_unknown',source_reason:'page_operation_failed',...(recovery?{recovery_required:true,read_only_recovery:true}:{}),...(observation?{observation}:{})};
  },()=>assert.fail('No network'));
  ai.request=async(endpoint,body)=>{
    assert.equal(endpoint,'responses');requests.push(body);
    if(requests.length===1)return {status:'completed',output:[{type:'function_call',call_id:'navigate-once',name:'browser_execute_plan',arguments:JSON.stringify(plan)}]};
    assert.equal(requests.length,2,'Read-only review must end the task rather than return to the actor.');
    assert.equal(body.response_format?.json_schema?.name,'desktop_completion');
    assert.equal(body.input[0].content,'Original request: '+original);
    assert.ok(!body.tools?.length,'Recovery audit must not be able to issue input.');
    assert.ok(JSON.stringify(body.input).includes('owned-recovered'));
    return {status:'completed',output:[message(JSON.stringify({decision,answer:decision==='complete'?'Your repositories are open.':'The requested destination is not verified.',reason:decision==='complete'?'The newly recovered document contains the repository heading.':'The recovered page does not establish the full requested result.'}))]};
  };
  return {ai,requests,dispatched};
}

test('unknown browser input with fresh read-only recovery can finish through one independent audit',async()=>{
  const h=setup();
  assert.equal(await h.ai.chat(original),'Your repositories are open.');
  assert.equal(h.requests.length,2);assert.deepEqual(h.dispatched,['browser_execute_plan']);
});

test('incomplete recovery review cannot resume actor input or repeat the navigation',async()=>{
  for(const decision of ['continue','blocked']){
    const h=setup({decision});
    const answer=await h.ai.chat(original);
    assert.ok(typeof answer==='string'&&answer.length>0);assert.notEqual(answer,'Your repositories are open.');
    assert.equal(h.requests.length,2);assert.deepEqual(h.dispatched,['browser_execute_plan']);
  }
});

test('unknown input without explicit fresh read-only recovery stops without another model request',async()=>{
  for(const options of [{recovery:false},{observation:null}]){
    const h=setup(options),answer=await h.ai.chat(original);
    assert.match(answer,/stopped|couldn.t verify/i);
    assert.equal(h.requests.length,1);assert.deepEqual(h.dispatched,['browser_execute_plan']);
  }
});

test('known partial menu delivery resumes from actual controls without reinspection or prefix replay',async()=>{
  const requests=[],dispatched=[];
  const delivered={index:0,op:'click',target:{role:'button',name:'Open user navigation menu',match:'exact'}};
  const menu={...page,snapshot:'owned-menu',url:'https://owned.test/dashboard',document_id:'original-document',controls:[
    {id:'profile',role:'button',name:'Open user navigation menu',enabled:true,protected:false},
    {id:'repositories',role:'link',name:'Your repositories',enabled:true,protected:false},
  ]};
  const predicted={snapshot:'owned-source',steps:[{op:delivered.op,target:delivered.target},{op:'click',target:{role:'link',name:'Repositories'}}],completion:[{target:{role:'heading',name:'Your repositories'},condition:'exists'}],final:false};
  const resume={...plan,snapshot:menu.snapshot};
  const ai=new AI(settings,()=>assert.fail('No credentials'),async(name,args)=>{
    validateTool(name,args);assert.equal(name,'browser_execute_plan','Recovery must use its returned state without another inspection.');dispatched.push(args);
    if(dispatched.length===1){
      assert.deepEqual(args,predicted);
      return {status:'interrupted',verified:false,reason:'condition_unmet',attempted:1,completed:1,recovery_required:true,delivered_steps:[delivered],observation:menu};
    }
    assert.equal(dispatched.length,2);assert.deepEqual(args,resume);
    assert.ok(args.steps.every(step=>step.target.name!=='Open user navigation menu'),'Delivered prefix must not be repeated.');
    return {status:'completed',verified:true,attempted:1,completed:1,observation:page,completion:[{...plan.completion[0],passed:true,observation:page}]};
  },()=>assert.fail('No network'));
  ai.request=async(endpoint,body)=>{
    assert.equal(endpoint,'responses');requests.push(body);
    if(requests.length===1)return {status:'completed',output:[{type:'function_call',call_id:'open-menu',name:'browser_execute_plan',arguments:JSON.stringify(predicted)}]};
    if(requests.length===2){
      assert.equal(body.response_format,undefined,'An intermediate partial result goes directly back to planning.');
      const returned=JSON.parse(body.input.find(item=>item.type==='function_call_output'&&item.call_id==='open-menu').output);
      assert.equal(returned.recovery_required,true);assert.notEqual(returned.outcome_unknown,true);assert.notEqual(returned.stop_task,true);
      assert.ok(returned.observation.controls.some(control=>control.role==='link'&&control.name==='Your repositories'));
      assert.deepEqual(returned.delivered_steps,[delivered]);
      return {status:'completed',output:[{type:'function_call',call_id:'finish-navigation',name:'browser_execute_plan',arguments:JSON.stringify(resume)}]};
    }
    assert.equal(requests.length,3);assert.equal(body.response_format?.json_schema?.name,'desktop_completion');
    assert.equal(body.input[0].content,'Original request: '+original);
    return {status:'completed',output:[message(JSON.stringify({decision:'complete',answer:'Your repositories are open.',reason:'The fresh page contains the repository heading.'}))]};
  };
  assert.equal(await ai.chat(original),'Your repositories are open.');assert.equal(requests.length,3);assert.equal(dispatched.length,2);
});
