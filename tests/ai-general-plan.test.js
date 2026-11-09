'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {AI}=require('../ai');
const {validateTool}=require('../core');
const {executePlan}=require('../action-plan');
const selector=(role,name)=>({role,name,match:'exact'});
const call=(id,name,args)=>({type:'function_call',call_id:id,name,arguments:JSON.stringify(args)});
const response=output=>({status:'completed',output});
const message=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
const settings=()=>({chatProvider:'deepseek',chatModel:'gpt-6-luna',allowDesktop:true,allowScreen:false});
const renamePlan={steps:[
  {op:'fill',target:selector('textbox','Search'),text:'Alpha'},
  {op:'click',target:selector('button','Search')},
  {op:'wait',target:selector('button','Edit first result'),condition:'exists',timeout_ms:500},
  {op:'click',target:selector('button','Edit first result')},
  {op:'fill',target:selector('textbox','Name'),text:'Alpha revised'},
  {op:'click',target:selector('button','Save')}
],completion:[{target:selector('button','Saved Alpha revised'),condition:'exists'}]};

// This fixture is an adapter, not a natural-language workflow. The AI/tool loop
// receives scripted model output; the real shared executor resolves each live
// control after previous actions replace the entire available-control set.
function fixture(){
  let controls=[],revision=0,stage='search';const actions=[];
  const control=(role,name,extras={})=>({id:String(++revision),role,name,enabled:true,editable:role==='textbox',protected:false,...extras});
  controls=[control('textbox','Search',{value:'Seed'}),control('button','Search')];
  const snapshot=async()=>({status:'observed',snapshot:`fixture-${revision}`,complete:true,revision,window:{pid:731,window_id:44,title:'Owned Records'},controls:structuredClone(controls)});
  const adapter={snapshot,async act(step,matched){
    assert.ok(controls.some(item=>item.id===matched.id),'Only current live control IDs may receive input.');actions.push({op:step.op,name:matched.name});
    if(step.op==='fill'){controls=controls.map(item=>item.id===matched.id?{...item,value:step.text}:item);revision++;}
    else if(matched.name==='Search'){stage='results';controls=[control('button','Edit first result')];}
    else if(matched.name==='Edit first result'){stage='edit';controls=[control('textbox','Name',{value:'Original'}),control('button','Save')];}
    else if(matched.name==='Save'){assert.equal(controls.find(item=>item.name==='Name').value,'Alpha revised');stage='saved';controls=[control('button','Saved Alpha revised'),control('button','Export record')];}
    else if(matched.name==='Export record'){stage='exported';controls=[control('button','Saved Alpha revised'),control('button','Exported Alpha revised')];}
    else assert.fail('Unexpected fixture action');
    return {status:'delivered',verified:true,observation:await snapshot()};
  }};
  return {adapter,actions,snapshot,get stage(){return stage;}};
}
function harness(dispatch,decide,review){
  const requests=[],calls=[];
  const ai=new AI(settings,()=>assert.fail('No credentials in unit tests'),async(name,args,context)=>{validateTool(name,args);calls.push({name,args});assert.equal(context.fromModel,true);return dispatch(name,args,context);},()=>assert.fail('No network in unit tests'));
  let decisions=0,reviews=0;
  ai.request=async(endpoint,body)=>{
    assert.equal(endpoint,'responses');requests.push(structuredClone(body));
    if(body.response_format?.json_schema?.name==='desktop_completion')return response([message(JSON.stringify(await review(++reviews,body)))]);
    return response(await decide(++decisions,body));
  };
  return {ai,requests,calls,get decisions(){return decisions;},get reviews(){return reviews;}};
}

test('general native plan reaches future controls with one plan decision and immediate independent review',async()=>{
  const form=fixture(),request='In Owned Records, find Alpha, edit its name to Alpha revised, and save the record.';
  let snapshot;
  const h=harness(async(name,args,context)=>{
    if(name==='computer_find_window'){snapshot=await form.snapshot();assert.equal(snapshot.controls.some(item=>item.name==='Edit first result'),false);return snapshot;}
    assert.equal(name,'computer_execute_plan');assert.equal(args.snapshot,snapshot.snapshot);return executePlan({...args,adapter:form.adapter,context});
  },async(n,body)=>{
    assert.ok(body.tools.some(tool=>tool.name==='computer_execute_plan'));
    if(n===1)return [call('discover','computer_find_window',{query:'Owned Records'})];
    assert.equal(n,2,'A verified plan must go straight to review, without an actor draft request.');
    return [call('phase','computer_execute_plan',{snapshot:snapshot.snapshot,...renamePlan})];
  },async(n,body)=>{
    assert.equal(n,1);assert.equal(form.stage,'saved');assert.equal(body.input[0].content,'Original request: '+request);
    assert.match(JSON.stringify(body.input),/Saved Alpha revised/);
    return {decision:'complete',answer:'Renamed Alpha to Alpha revised and saved it.',reason:'The fresh result contains the saved name.'};
  });
  assert.equal(await h.ai.chat(request),'Renamed Alpha to Alpha revised and saved it.');
  assert.deepEqual(h.calls.map(item=>item.name),['computer_find_window','computer_execute_plan']);assert.equal(form.actions.length,5);assert.equal(h.decisions,2);assert.equal(h.reviews,1);assert.equal(h.ai.lastTaskTiming.modelRequests,3);
});

test('passing a phase assertion cannot claim a larger original task is complete',async()=>{
  const form=fixture(),request='Find Alpha in Owned Records, rename it Alpha revised, save it, then export that record.';
  let observed;
  const exportPlan={steps:[{op:'click',target:selector('button','Export record')}],completion:[{target:selector('button','Exported Alpha revised'),condition:'exists'}]};
  const h=harness(async(name,args,context)=>{
    if(name==='computer_find_window')return observed=await form.snapshot();
    assert.equal(name,'computer_execute_plan');const result=await executePlan({...args,adapter:form.adapter,context});observed=result.observation;return result;
  },async n=>{
    if(n===1)return [call('discover','computer_find_window',{query:'Owned Records'})];
    if(n===2)return [call('rename','computer_execute_plan',{snapshot:observed.snapshot,...renamePlan})];
    assert.equal(n,3);assert.equal(form.stage,'saved');return [call('export','computer_execute_plan',{snapshot:observed.snapshot,...exportPlan})];
  },async(n,body)=>{
    assert.equal(body.input[0].content,'Original request: '+request);
    if(n===1){assert.equal(form.stage,'saved');return {decision:'continue',answer:'The record is saved; export remains.',reason:'The original request also requires export, which the current saved-name assertion does not prove.'};}
    assert.equal(n,2);assert.equal(form.stage,'exported');return {decision:'complete',answer:'Renamed, saved and exported Alpha revised.',reason:'The fresh observation proves the requested saved name and export.'};
  });
  assert.equal(await h.ai.chat(request),'Renamed, saved and exported Alpha revised.');assert.equal(h.reviews,2);assert.equal(h.decisions,3);assert.equal(form.actions.length,6);assert.equal(h.ai.lastTaskTiming.modelRequests,5);
});

test('an explicitly intermediate phase proceeds to planning without a premature whole-task review',async()=>{
  const form=fixture();let observed;
  const first={steps:renamePlan.steps.slice(0,3),completion:[{target:selector('button','Edit first result'),condition:'exists'}],final:false};
  const second={steps:renamePlan.steps.slice(3),completion:renamePlan.completion,final:true};
  const h=harness(async(name,args,context)=>{
    if(name==='computer_find_window')return observed=await form.snapshot();
    assert.equal(name,'computer_execute_plan');const result=await executePlan({steps:args.steps,completion:args.completion,adapter:form.adapter,context});observed=result.observation;return result;
  },async n=>{
    if(n===1)return [call('discover','computer_find_window',{query:'Owned Records'})];
    if(n===2)return [call('search','computer_execute_plan',{snapshot:observed.snapshot,...first})];
    assert.equal(n,3);assert.equal(h.reviews,0,'Search result completion is an intermediate phase, so it needs no whole-task review yet.');
    assert.equal(form.stage,'results');return [call('save','computer_execute_plan',{snapshot:observed.snapshot,...second})];
  },async()=>{assert.equal(form.stage,'saved');return {decision:'complete',answer:'Renamed and saved Alpha revised.',reason:'The final saved-name result is observed.'};});
  assert.equal(await h.ai.chat('Find Alpha in Owned Records, rename it Alpha revised and save it.'),'Renamed and saved Alpha revised.');
  assert.equal(h.decisions,3);assert.equal(h.reviews,1);assert.equal(h.ai.lastTaskTiming.modelRequests,4);assert.equal(form.actions.length,5);
});

test('final false cannot bypass independent review when the actor later claims task completion',async()=>{
  const form=fixture();let observed;
  const h=harness(async(name,args,context)=>{
    if(name==='computer_find_window')return observed=await form.snapshot();
    const result=await executePlan({steps:args.steps,completion:args.completion,adapter:form.adapter,context});observed=result.observation;return result;
  },async n=>{
    if(n===1)return [call('discover','computer_find_window',{query:'Owned Records'})];
    if(n===2)return [call('rename','computer_execute_plan',{snapshot:observed.snapshot,...renamePlan,final:false})];
    assert.equal(n,3);return [message('Renamed and exported the record.')];
  },async()=>({decision:'blocked',answer:'The name was saved, but export was not verified.',reason:'The original request requires export; the observed saved-name result does not prove it.'}));
  assert.equal(await h.ai.chat('Rename Alpha to Alpha revised in Owned Records, save it and export the record.'),'The name was saved, but export was not verified.');
  assert.equal(h.reviews,1);assert.equal(form.stage,'saved');assert.equal(h.ai.lastTaskTiming.modelRequests,4);
});

test('browser page plans follow observed tab and page snapshots and receive independent review',async()=>{
  const form=fixture();let observed;
  const h=harness(async(name,args,context)=>{
    if(name==='browser_list_tabs')return {status:'ok',snapshot:'tabs',session_id:'owned-session',browser:'opera',complete:true,tabs:[{tab_id:41,window_id:7,url:'http://mitch-plan.test/fixture',title:'Owned Records',pinned:false,active:true}]};
    if(name==='browser_read_page'){assert.deepEqual(args,{snapshot:'tabs',tab_id:41});return observed=await form.snapshot();}
    assert.equal(name,'browser_execute_plan');assert.equal(args.snapshot,observed.snapshot);return executePlan({...args,adapter:form.adapter,context});
  },async n=>{
    if(n===1)return [call('tabs','browser_list_tabs',{browser:'opera'})];
    if(n===2)return [call('page','browser_read_page',{snapshot:'tabs',tab_id:41})];
    assert.equal(n,3,'No per-click actor calls or actor draft request are needed.');return [call('phase','browser_execute_plan',{snapshot:observed.snapshot,...renamePlan})];
  },async()=>({decision:'complete',answer:'Saved Alpha revised in the browser.',reason:'The final page contains the saved-name result.'}));
  assert.equal(await h.ai.chat('Use the Owned Records page in Opera to search for Alpha, edit its name to Alpha revised and save it.'),'Saved Alpha revised in the browser.');
  assert.deepEqual(h.calls.map(item=>item.name),['browser_list_tabs','browser_read_page','browser_execute_plan']);assert.equal(h.decisions,3);assert.equal(h.reviews,1);assert.equal(form.actions.length,5);
});

test('general plan schemas forbid executable code, blind coordinates and oversized plans',()=>{
  for(const tool of ['computer_execute_plan','browser_execute_plan']){
    assert.doesNotThrow(()=>validateTool(tool,{snapshot:'fresh',...renamePlan}));
    assert.doesNotThrow(()=>validateTool(tool,{snapshot:'fresh',...renamePlan,final:false}));
    assert.throws(()=>validateTool(tool,{snapshot:'fresh',...renamePlan,final:'false'}));
    for(const changes of [
      {script:'document.querySelector("button").click()'},
      {steps:[{op:'click',x:0.5,y:0.5}]},
      {steps:[{op:'javascript',text:'alert(1)'}]},
      {steps:Array.from({length:13},()=>({op:'click',target:selector('button','Search')}))},
      {completion:[]}
    ])assert.throws(()=>validateTool(tool,{snapshot:'fresh',...renamePlan,...changes}));
  }
});
