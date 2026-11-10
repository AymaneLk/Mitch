'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {AI}=require('../ai');
const {WORKFLOW_TOOL}=require('../workflow-assistant');
test('scope-first requests prepare and reuse controls just like verb-first commands',()=>{
  const {desktopRequest}=require('../workflow-assistant');
  for(const text of ['In "Example", set "Name" to "Alpha"','In Example, open Settings','On "example.test" fill "Search" with "Alpha"'])assert.equal(desktopRequest(text),true,text);
  for(const text of ['In my opinion, this is a good app','On Monday, what happened?'])assert.equal(desktopRequest(text),false,text);
});
const clone=value=>JSON.parse(JSON.stringify(value));
const target={kind:'browser',hostname:'example.test',browser:'opera'};
const search={name:'Search',role:'textbox',match:'exact'};
const condition=value=>({target:search,condition:'value',value});
const request='Find "Alpha" in Example';
function program(value='Alpha'){
  return {version:1,steps:[{op:'bind',target},{op:'act',steps:[{op:'fill',target:search,text:value},{op:'click',target:{name:'Search',role:'button',match:'exact'}}],completion:[condition(value)]}],completion:[condition(value)]};
}
function context(value='',suffix='initial'){
  return {preparedAt:Date.now(),scopes:[{target,observation:{source:'browser_dom',snapshot:'snapshot-'+suffix,document_id:'document-'+suffix,session_id:'session-'+suffix,tab_id:7,browser:'opera',url:'https://example.test/',complete:true,controls:[{id:'text-'+suffix,name:'Search',role:'textbox',enabled:true,editable:true,value},{id:'button-'+suffix,name:'Search',role:'button',enabled:true}]}}]};
}
function planned(value='Alpha'){
  return {output:[{type:'function_call',call_id:'plan-'+value,name:WORKFLOW_TOOL,arguments:JSON.stringify(program(value))}]};
}
const reviewed=(decision='complete',answer='Found the requested item.',reason='The result is visible.')=>({output:[{role:'assistant',content:[{type:'output_text',text:JSON.stringify({decision,answer,reason})}]}]});
const completed=value=>({status:'completed',verified:true,action_attempted:true,observation:context(value,'finished').scopes[0].observation});
function harness({responses=[planned(),reviewed()],settings={},preparedContext=context(),dispatch}={}){
  const requests=[],actions=[],preparations=[];
  const config={chatProvider:'chatgpt',allowDesktop:true,allowScreen:true,workflowEngine:true,speculativePlanning:true,reuseWorkflows:true,chatModel:'test',...settings};
  const ai=new AI(()=>config,()=>assert.fail('No key retrieval'),async(name,args,execution)=>{
    actions.push({name,args:clone(args),execution});
    const value=args.steps?.find(step=>step.op==='act')?.steps.find(step=>step.op==='fill')?.text;
    return dispatch?dispatch(name,args,execution,actions.length):completed(typeof value==='string'?value:execution.workflowBindings?.[value?.ref]||'Alpha');
  },()=>assert.fail('No network request'));
  ai.prepareContext=async(text,options)=>{preparations.push({text,options});return clone(preparedContext);};
  ai.request=async(endpoint,body,form,signal)=>{
    signal?.throwIfAborted();assert.equal(endpoint,'responses');requests.push(clone(body));
    assert.ok(responses.length,'Unexpected model request');const response=responses.shift();return typeof response==='function'?response(body,signal):clone(response);
  };
  return {ai,config,requests,actions,preparations,responses};
}
function envelope(text,value,{expired=false,aborted=false}={}){
  const controller=new AbortController();if(aborted)controller.abort(Error('Old speech'));
  return {normalizedText:text,startedAt:Date.now()-20,expiresAt:Date.now()+(expired?-1:2900),generation:1,inputId:'input',revision:2,signal:controller.signal,promise:Promise.resolve(value),controller};
}

test('cold workflow is independently reviewed then reused with fresh IDs and quoted bindings',async()=>{
  const h=harness();assert.equal(await h.ai.chat(request),'Found the requested item.');
  assert.equal(h.requests.length,2);assert.equal(h.ai.procedures.size,1);
  assert.ok(h.requests[0].tools.some(tool=>tool.name===WORKFLOW_TOOL));
  assert.equal(h.requests[0].localThinking,undefined,'ChatGPT never receives an invented reasoning setting');
  assert.equal(h.requests[0].tools.some(tool=>tool.name==='browser_execute_plan'),false);
  assert.equal(h.requests[1].tools,undefined);assert.equal(h.requests[1].response_format.json_schema.name,'desktop_completion');
  assert.notEqual(h.requests[1].localThinking,false,'Independent completion review keeps the normal thinking setting');
  h.ai.prepareContext=async()=>context('','replacement');
  assert.equal(await h.ai.chat('Find "Beta" in Example'),'Done. I verified the requested result.');
  assert.equal(h.requests.length,2,'Repeat must need neither a new plan nor another review');
  assert.equal(h.actions.length,2);assert.deepEqual(h.actions[1].execution.workflowBindings,{mitchParam0:'Beta'});
  assert.equal(h.actions[1].execution.workflowReplay.scopeSignatures.length,1);
  assert.equal(h.ai.lastTaskTiming.route,'replay');assert.equal(h.ai.lastTaskTiming.modelRequests,0);
});

test('a changed initial value requires a new plan rather than replaying old steps',async()=>{
  const h=harness({responses:[planned(),reviewed(),planned('Beta'),reviewed()]});
  await h.ai.chat(request);h.ai.prepareContext=async()=>context('an existing query','changed');
  await h.ai.chat('Find "Beta" in Example');
  assert.equal(h.requests.length,4);assert.equal(h.actions[1].execution.workflowReplay,undefined);
});

test('partial whole-request review cannot cache a later fragment as the complete task',async()=>{
  const details={name:'Details',role:'button',match:'exact'},visible={target:{name:'Item details',role:'heading',match:'exact'},condition:'exists'};
  const remainder={version:1,steps:[{op:'bind',target},{op:'act',steps:[{op:'click',target:details}],completion:[visible]}],completion:[visible]};
  const next={output:[{type:'function_call',call_id:'remaining',name:WORKFLOW_TOOL,arguments:JSON.stringify(remainder)}]};
  const individual={output:[{type:'function_call',call_id:'individual',name:'browser_execute_plan',arguments:JSON.stringify({snapshot:'fresh',steps:[{op:'click',target:details}],completion:[visible],final:true})}]};
  const h=harness({responses:[planned(),reviewed('continue','The item is found.','The details panel is still closed.'),next,individual,reviewed()]});
  assert.equal(await h.ai.chat(request+' and show its details'),'Found the requested item.');
  assert.deepEqual(h.actions.map(action=>action.name),[WORKFLOW_TOOL,'browser_execute_plan']);assert.equal(h.requests.length,5);
  assert.equal(h.requests[2].tools.some(tool=>tool.name===WORKFLOW_TOOL),false,'A completed workflow must not be offered again');
  assert.equal(h.ai.procedures.size,0,'Neither fragment represents all outcomes from the original starting screen');
});

test('verified workflow with truncated evidence is reviewed but never saved for reuse',async()=>{
  const h=harness({dispatch:()=>({...completed('Alpha'),evidence_truncated:true})});
  assert.equal(await h.ai.chat(request),'Found the requested item.');
  assert.equal(h.requests.length,2);assert.equal(h.ai.procedures.size,0);
});

test('expired, changed and cancelled voice drafts are discarded before action',async()=>{
  for(const options of [{expired:true},{aborted:true},{mismatched:true}]){
    const h=harness(),text=options.mismatched?'Find "Old" in Example':request;
    const prepared=envelope(text,{text,context:context(),decision:planned('Old'),modelRequests:1},options);
    assert.equal(await h.ai.chat(request,undefined,undefined,{spoken:true,prepared}),'Found the requested item.');
    assert.equal(h.preparations.length,1);assert.equal(h.requests.length,2);
    assert.equal(h.actions[0].args.steps[1].steps[0].text,'Alpha');
  }
});

test('matching voice draft saves the decision request but execution has an independent cancellation signal',async()=>{
  const prepared=envelope(request,{text:request,context:context(),decision:planned(),modelRequests:1,modelMs:42});
  const h=harness({responses:[reviewed()],dispatch:(_name,_args,execution)=>{
    prepared.controller.abort(Error('Preparation expired'));
    assert.equal(execution.signal.aborted,false,'Draft cancellation must not cancel final execution');return completed('Alpha');
  }});
  assert.equal(await h.ai.chat(request,undefined,undefined,{spoken:true,prepared}),'Found the requested item.');
  assert.equal(h.preparations.length,0);assert.equal(h.requests.length,1);assert.equal(h.requests[0].tools,undefined);
  assert.equal(h.actions.length,1);assert.equal(h.ai.lastTaskTiming.preparationRequests,1);
});

test('speech preparation only reads state and makes at most one planning request',async()=>{
  const h=harness({responses:[planned()]});
  const value=await h.ai.prepareTask(request,{generation:3,inputId:'speech',revision:2,readOnly:true});
  assert.equal(h.actions.length,0);assert.equal(h.preparations.length,1);assert.equal(h.preparations[0].options.readOnly,true);
  assert.equal(h.requests.length,1);assert.deepEqual(h.requests[0].tools.map(tool=>tool.name),[WORKFLOW_TOOL]);
  assert.equal(value.modelRequests,1);assert.ok(value.decision);
  h.config.speculativePlanning=false;const stateOnly=await h.ai.prepareTask(request);
  assert.equal(stateOnly.modelRequests,0);assert.equal(h.requests.length,1);assert.equal(h.actions.length,0);
});

test('cancelled in-flight preparation cannot yield an executable draft even if the provider ignores abort',async()=>{
  let release,entered;const started=new Promise(resolve=>{entered=resolve;});
  const h=harness({responses:[()=>{entered();return new Promise(resolve=>{release=resolve;});}]});
  const controller=new AbortController(),pending=h.ai.prepareTask(request,{signal:controller.signal});
  await started;controller.abort(Error('Changed transcript'));release(planned());
  await assert.rejects(pending,/Changed transcript/);assert.equal(h.actions.length,0);
  assert.equal(h.ai.preparationControllers.size,0);
});

test('fresh replay mismatch with no input falls back to planning and independent review',async()=>{
  const h=harness({dispatch:(_name,_args,execution)=>execution.workflowReplay?{status:'interrupted',reason:'replay_context_mismatch',cold_plan_required:true,action_attempted:false}:completed('Alpha')});
  assert.equal(h.ai.procedures.remember(request,context(),program(),{approved:true}),true);
  assert.equal(await h.ai.chat(request),'Found the requested item.');
  assert.equal(h.actions.length,2);assert.ok(h.actions[0].execution.workflowReplay);assert.equal(h.actions[1].execution.workflowReplay,undefined);
  assert.equal(h.requests.length,2);assert.equal(h.ai.lastTaskTiming.route,'workflow');
});

test('independent goal compilation overlaps planning and skips serial review only after full proof',async()=>{
 const ctx=context();ctx.scopes[0].observation.window_id=4;
 const h=harness({preparedContext:ctx,settings:{parallelGoalVerification:true},dispatch:()=>{const o=completed('Alpha');Object.assign(o.observation,{session_id:'session-initial',window_id:4});return o;}});
 let compilerStarted=false,plannerStarted=false,release;
 h.ai.request=async(_endpoint,body)=>{
  h.requests.push(body);
  if(body.response_format?.json_schema?.name==='independent_task_goal'){
   compilerStarted=true;await new Promise(r=>{release=r;});assert.ok(plannerStarted);return {output:[{content:[{type:'output_text',text:JSON.stringify({verifiable:true,requirements:[{scope:0,name:'Search',role:'textbox',condition:'value',value:'Alpha',source_scope:-1,source_name:'',source_attribute:'none'}]})}]}]};
  }
  plannerStarted=true;assert.ok(compilerStarted);assert.equal(JSON.stringify(body).includes('independent_task_goal'),false);release();return planned();
 };
 assert.equal(await h.ai.chat(request),'Done. I verified all the requested changes.');assert.equal(h.requests.length,2);assert.equal(h.actions.length,1);assert.equal(h.ai.lastTaskTiming.parallelGoalVerified,true);
});

test('declined independent contracts retain semantic review and cancellation cannot hang',async()=>{
 for(const cancel of [false,true]){
  const ctx=context();ctx.scopes[0].observation.window_id=4;
  const h=harness({preparedContext:ctx,settings:{parallelGoalVerification:true}});let calls=0;
  h.ai.request=async(_e,body)=>{
   if(body.response_format?.json_schema?.name==='independent_task_goal')return cancel?new Promise(()=>{}):{output:[{content:[{type:'output_text',text:'{"verifiable":false,"requirements":[]}'}]}]};
   if(cancel){h.ai.controller.abort(Error('Stop'));throw Error('Stop');}
   return calls++===0?planned():reviewed();
  };
  if(cancel)await assert.rejects(h.ai.chat(request),/Stop/);else {assert.equal(await h.ai.chat(request),'Found the requested item.');assert.equal(calls,2);}
  assert.equal(h.ai.busy,false);assert.notEqual(h.ai.lastTaskTiming.parallelGoalVerified,true);
 }
});

test('a known navigation assertion miss refreshes the bound tab before reviewing, without actor rediscovery',async()=>{
 const f={...context().scopes[0].observation,window_id:4},fresh={...f,snapshot:'new-state',document_id:'new-document',url:'https://example.test/received'};
 const h=harness({dispatch:name=>{
  if(name===WORKFLOW_TOOL)return {status:'interrupted',verified:false,reason:'completion_unmet',recovery_required:true,observation:f};
  if(name==='browser_list_tabs')return {status:'ok',complete:true,snapshot:'inventory',browser:'opera',session_id:f.session_id,tabs:[{tab_id:7,window_id:4,url:fresh.url,pinned:false}]};
  assert.equal(name,'browser_read_page');return fresh;
 }});
 assert.equal(await h.ai.chat(request),'Found the requested item.');assert.equal(h.requests.length,2);
 assert.deepEqual(h.actions.map(a=>a.name),[WORKFLOW_TOOL,'browser_list_tabs','browser_read_page']);
 assert.ok(JSON.stringify(h.requests[1].input).includes('new-document'));
});

test('a compiler refusal may be repaired once, but delivered or uncertain workflows cannot restart',async()=>{
 for(const mode of ['validation','delivered']){
  let calls=0;const f=harness({responses:[planned(),planned(),reviewed()],dispatch:async()=>{calls++;return calls===1?mode==='validation'?{status:'error',validation_failed:true,refused:true,action_attempted:false,message:'Invalid program'}:{status:'interrupted',action_attempted:true,outcome_unknown:true}:completed('Alpha');}});
  await f.ai.chat(request);assert.equal(calls,mode==='validation'?2:1);
 }
});
