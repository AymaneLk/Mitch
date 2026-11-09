'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {AI:CurrentAI}=require('../ai');
const {executePlan,normalizeRole}=require('../action-plan');
const {validateTool}=require('../core');
const PROMPT='Find Alpha in the customer workspace, open its result, change Name to Alpha revised, save it';
const TASK_LIMIT=12,TOTAL_LIMIT=72,REPEATS=3;
const rounded=value=>value===null?null:Math.round(value*100)/100;
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length?(sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2):null;};
const failure=(code,message)=>Object.assign(Error(message||code),{code});

// Stateful fixture only. Actions must use fresh observations, exact names and
// current controls. No real desktop, scripts, web pages or files are operated.
function fixture(){
  const window={pid:7311,window_id:7312,title:'Customer workspace',app:'CustomerWorkspace.exe',minimized:false,on_screen:true};
  const app={name:'Customer workspace',app_id:'owned-customer-workspace'};
  const calls=[],inputs=[],trace=[];let stage='search',search='Fixture seed',draft='Alpha',saved='',selected='',sequence=0,latest,invalid=0;
  const fixtureLabels=new Set(['Search','Alpha','No matching customers','Edit first result','Customer Alpha','Name','Save','Saved Alpha revised']);
  const tracedTarget=target=>target&&({role:typeof target.role==='string'?normalizeRole(target.role).slice(0,40):undefined,name:typeof target.name==='string'?(fixtureLabels.has(target.name)?target.name:'[unmatched fixture selector]'):undefined,match:target.match==='contains'?'contains':'exact'});
  const tracedAssertion=item=>({target:tracedTarget(item?.target),condition:['exists','absent','value','checked','selected'].includes(item?.condition)?item.condition:'exists',...(item?.value!==undefined?{value:['Alpha','Alpha revised','true','false'].includes(item.value)?item.value:'[other fixture value]'}:{})});
  const row=(id,name,type,rest={})=>({control_id:id,name,type,enabled:true,editable:false,protected:false,...rest});
  const controls=()=>stage==='search'?[row('search-field','Search','Edit',{editable:true,value:search}),row('search-button','Search','Button')]:stage==='results'?[row('result-heading',search.toLowerCase()==='alpha'?'Alpha':'No matching customers','Header'),...(search.toLowerCase()==='alpha'?[row('edit-result','Edit first result','Button')]:[])]:stage==='edit'?[row('record-heading','Customer Alpha','Header'),row('name-field','Name','Edit',{editable:true,value:draft}),row('save','Save','Button')]:[row('saved','Saved '+saved,'Button')];
  function observation(legacy=false){
    const snapshot=(legacy?'legacy':'native')+'-'+(++sequence);latest={snapshot,legacy};
    return {status:'inspected',snapshot,complete:true,window:{...window},focus_verified:true,degraded:false,truncated:false,controls:controls().map(control=>legacy?{...control,id:'legacy-'+control.control_id}:control)};
  }
  function normalized(){const state=observation();return {...state,controls:state.controls.map(control=>({...control,id:control.control_id,role:normalizeRole(control.type)}))};}
  function requireSnapshot(args,legacy=false){if(!latest||args.snapshot!==latest.snapshot||latest.legacy!==legacy)throw failure('fixture_stale_snapshot','Inspect this fixture again; its snapshot or control namespace changed.');}
  function input(args,legacy=false){
    requireSnapshot(args,legacy);const id=legacy?String(args.control_id).replace(/^legacy-/,''):args.control_id,control=controls().find(item=>item.control_id===id);
    if(!control||args.expected_name!==undefined&&args.expected_name!==control.name)throw failure('fixture_wrong_target','Select one exact current control.');
    if(args.kind==='type'){
      if(!control.editable||typeof args.text!=='string')throw failure('fixture_not_editable','This control is not an editable text field.');
      if(control.control_id==='search-field')search=args.text;else if(control.control_id==='name-field')draft=args.text;else throw failure('fixture_wrong_field');
    }else if(args.kind==='click'){
      if(control.control_id==='search-button')stage='results';
      else if(control.control_id==='edit-result'){selected='Alpha';stage='edit';}
      else if(control.control_id==='save'){saved=draft;stage='saved';}
      else throw failure('fixture_wrong_action','Only the observed Search, result and Save buttons perform fixture actions.');
    }else throw failure('fixture_unsupported_input','Use the observed fixture buttons and text fields.');
    inputs.push({kind:args.kind,target:control.control_id});
    return {status:'verified',verified:true,effect:'confirmed',observation:observation(legacy)};
  }
  const adapter={
    snapshot:async()=>normalized(),
    act:async(step,matched)=>{
      if(!latest||latest.legacy)throw failure('fixture_stale_snapshot');
      const output=input({snapshot:latest.snapshot,control_id:matched.id,expected_name:matched.name,kind:step.op==='fill'?'type':step.op==='click'?'click':'unsupported',...(step.op==='fill'?{text:step.text}:{})});
      return {...output,observation:{...output.observation,controls:output.observation.controls.map(control=>({...control,id:control.control_id,role:normalizeRole(control.type)}))}};
    }
  };
  async function perform(name,args,context={}){
    calls.push(name);context.signal?.throwIfAborted();validateTool(name,args);
    if(calls.length>30)throw failure('fixture_tool_limit','Synthetic tool limit reached.');
    try{
      if(name==='list_apps')return {status:'ok',apps:!args.query||app.name.toLowerCase().includes(args.query.toLowerCase())?[app]:[]};
      if(name==='open_app'){if(args.app_id!==app.app_id)throw failure('fixture_wrong_app');return {status:'focused_existing',app:app.name,observation:observation()};}
      if(name==='computer_list_windows')return {status:'ok',windows:!args.query||(window.title+' '+window.app).toLowerCase().includes(args.query.toLowerCase())?[{...window}]:[],degraded:false,truncated:false};
      if(name==='computer_find_window')return (window.title+' '+window.app).toLowerCase().includes(args.query.toLowerCase())?observation():{status:'not_found',windows:[],degraded:false,truncated:false};
      if(['computer_inspect_window','computer_focus_window','computer_restore_window'].includes(name)){if(args.pid!==window.pid||args.window_id!==window.window_id)throw failure('fixture_wrong_window');return observation();}
      if(name==='inspect_app'){if(!args.query)return {status:'windows',windows:[{...window}]};if(!(window.title+' '+window.app).toLowerCase().includes(args.query.toLowerCase()))throw failure('fixture_wrong_window');return observation(true);}
      if(name==='computer_action')return input(args);
      if(name==='click_app_control')return input({...args,kind:'click'},true);
      if(name==='type_in_app')return input({...args,kind:'type'},true);
      if(name==='computer_action_sequence'){
        requireSnapshot(args);const known=controls(),steps=args.actions.map(step=>{if(!known.some(control=>control.control_id===step.control_id&&control.name===step.expected_name))throw failure('fixture_future_sequence_target','A legacy sequence may use only controls present in its starting observation.');return {...step};});
        const results=[];let output;
        for(const step of steps){output=input({...step,snapshot:latest.snapshot});results.push({status:output.status,verified:output.verified});}
        return {status:'completed',verified:true,completed:results.length,attempted:results.length,total:results.length,results,observation:output.observation};
      }
      if(name==='computer_execute_plan'){requireSnapshot(args);return executePlan({steps:args.steps,completion:args.completion,adapter,context});}
      throw failure('fixture_unsupported_tool','This synthetic customer workspace exposes accessibility controls only. No real browser, screenshot or desktop is connected.');
    }catch(error){context.signal?.throwIfAborted();invalid++;return {status:'error',refused:true,message:error.message};}
  }
  async function dispatch(name,args,context={}){
    const record={tool:name,stageBefore:stage};trace.push(record);
    if(name==='computer_execute_plan')Object.assign(record,{final:args.final,stepCount:args.steps?.length,steps:(args.steps||[]).map(step=>({op:step.op,target:tracedTarget(step.target),...(step.text!==undefined?{text:['Alpha','Alpha revised'].includes(step.text)?step.text:'[other fixture text]'}:{}),...(['assert','wait'].includes(step.op)?{condition:step.condition||'exists'}:{})})),completion:(args.completion||[]).map(tracedAssertion)});
    else if(name==='computer_action_sequence')Object.assign(record,{stepCount:args.actions?.length,steps:(args.actions||[]).map(step=>({op:step.kind,target:tracedTarget({name:step.expected_name})}))});
    else if(['computer_action','click_app_control','type_in_app'].includes(name))record.target=tracedTarget({name:args.expected_name});
    try{
      const output=await perform(name,args,context);Object.assign(record,{status:output?.status,verified:output?.verified,completed:output?.completed,attempted:output?.attempted,stageAfter:stage});
      if(typeof output?.reason==='string'&&/^[a-z_0-9]+$/.test(output.reason))record.reason=output.reason;
      return output;
    }catch(error){record.status='error';record.stageAfter=stage;throw error;}
  }
  function readback(){return {verified:stage==='saved'&&selected==='Alpha'&&saved==='Alpha revised',inputCount:inputs.length,invalidToolCalls:invalid,searchInputs:inputs.filter(item=>item.target==='search-field').length,resultOpens:inputs.filter(item=>item.target==='edit-result').length,nameWrites:inputs.filter(item=>item.target==='name-field').length,saves:inputs.filter(item=>item.target==='save').length};}
  return {dispatch,calls,trace,readback};
}

function summarize(rows){return Object.fromEntries(['baseline','general'].map(version=>{const selected=rows.filter(row=>row.version===version),ok=selected.filter(row=>row.status==='ok'),verified=ok.filter(row=>row.verified);return [version,{tasks:selected.length,completed:ok.length,verified:verified.length,medianMs:rounded(median(ok.map(row=>row.durationMs))),verifiedMedianMs:rounded(median(verified.map(row=>row.durationMs))),modelRequests:selected.reduce((sum,row)=>sum+row.modelRequests,0),toolCalls:selected.reduce((sum,row)=>sum+row.toolCalls,0),planCalls:selected.reduce((sum,row)=>sum+(row.toolCounts.computer_execute_plan||0),0)}];}));}
async function runBenchmark({key,settings,directory,fetcher=fetch,onProgress=()=>{},mock=false,onlyCurrent=false}){
  if(typeof key!=='string'||!key)throw failure('missing_key','A DeepSeek API key is required.');
  if(settings?.chatProvider!=='deepseek'||(settings.deepseekChatModel||'deepseek-flash')!=='deepseek-flash')throw failure('saved_provider_mismatch','The saved provider must be DeepSeek Flash.');
  // Lazy load permits syntax/fixture checks before the baseline is extracted.
  const {AI:BaselineAI}=require('../outputs/general-baseline/ai');
  const configuration={...settings,allowDesktop:true,allowScreen:false};
  const report={status:'running',startedAt:new Date().toISOString(),method:{baseline:'Extracted installed v17 AI and tool definitions',current:'Current generic-plan AI and shared local executor',model:'deepseek-flash',thinking:'enabled',effort:'high',tasks:onlyCurrent?3:6,repeats:REPEATS,order:onlyCurrent?'Three current-version validation tasks':'Three sequential pairs with alternating version order',scope:'Actual provider/model plus controller latency against a dynamic in-memory customer fixture. Both routes have zero deliberate UI delay. This excludes real app launch, native input, accessibility, browser DOM, speech and GPU work; it is not arbitrary-task accuracy.',requestsPerTaskLimit:TASK_LIMIT,totalRequestLimit:TOTAL_LIMIT,realUI:false,mockProvider:mock,rawPromptsStored:false,rawResponsesStored:false},rows:[]};
  const file=path.join(directory,mock?'general-model-mock.json':onlyCurrent?'general-model-current.json':'general-model-benchmark.json');fs.mkdirSync(directory,{recursive:true});let totalRequests=0,fatal;
  const save=()=>{report.totalModelRequests=totalRequests;report.summary=summarize(report.rows);fs.writeFileSync(file,JSON.stringify(report,null,2));};save();
  for(let trial=1;trial<=REPEATS&&!fatal;trial++)for(const version of onlyCurrent?['general']:trial%2?['baseline','general']:['general','baseline']){
    if(fatal)break;const desktop=fixture(),row={version,trial,status:'running',modelRequests:0,toolCalls:0,toolCounts:{},usage:{promptTokens:0,completionTokens:0,cachedPromptTokens:0},requestMs:[]};
    const boundedFetch=async(url,options)=>{
      if(url!=='https://api.deepseek.com/chat/completions'||options.method!=='POST'||options.redirect!=='error')throw failure('unexpected_endpoint','Only the fixed DeepSeek inference endpoint is allowed.');
      if(row.modelRequests>=TASK_LIMIT)throw failure('task_request_limit','Task request limit reached.');
      if(totalRequests>=TOTAL_LIMIT){fatal='global_request_limit';throw failure(fatal);}
      const body=JSON.parse(options.body);
      if(body.model!=='deepseek-flash'||body.thinking?.type!=='enabled'||body.reasoning_effort!=='high')throw failure('model_configuration_mismatch','Both variants must preserve Flash High.');
      if(row.modelRequests===0){const offered=body.tools?.some(tool=>tool.function?.name==='computer_execute_plan')===true;row.generalPlanOffered=offered;if(offered!==(version==='general'))throw failure('baseline_tool_mismatch','The baseline must not expose the new plan tool.');}
      row.modelRequests++;totalRequests++;const started=performance.now();
      try{
        const response=await fetcher(url,{...options,signal:AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(45000)])});
        const data=await response.json();row.usage.promptTokens+=data.usage?.prompt_tokens||0;row.usage.completionTokens+=data.usage?.completion_tokens||0;row.usage.cachedPromptTokens+=data.usage?.prompt_tokens_details?.cached_tokens||0;
        if([401,402,429].includes(response.status))fatal='http_'+response.status;
        return {ok:response.ok,status:response.status,json:async()=>data};
      }finally{row.requestMs.push(rounded(performance.now()-started));onProgress({phase:'request',completedTasks:report.rows.length,totalTasks:report.method.tasks,version,trial,modelRequests:row.modelRequests,requestMs:row.requestMs.at(-1)});}
    };
    const tracedDispatch=async(name,args,context)=>{const index=desktop.trace.length;try{return await desktop.dispatch(name,args,context);}finally{if(desktop.trace[index])desktop.trace[index].afterModelRequest=row.modelRequests;}};
    const AI=version==='baseline'?BaselineAI:CurrentAI,ai=new AI(()=>configuration,()=>{throw failure('unexpected_credential_provider');},tracedDispatch,boundedFetch,async()=>key),started=performance.now();
    const timeout=setTimeout(()=>ai.cancel(),180000);
    try{const answer=await ai.chat(PROMPT,undefined,Symbol('synthetic-customer-task'));row.replyReceived=typeof answer==='string'&&answer.trim().length>0;row.status='ok';}
    catch(error){row.status='error';row.errorCode=typeof error.code==='string'&&/^[a-z_0-9]+$/.test(error.code)?error.code:['AbortError','TimeoutError'].includes(error.name)?error.name:'model_task_error';}
    finally{clearTimeout(timeout);ai.cancel();ai.closeVoice();row.durationMs=rounded(performance.now()-started);row.toolCalls=desktop.calls.length;for(const name of desktop.calls)row.toolCounts[name]=(row.toolCounts[name]||0)+1;row.toolTrace=desktop.trace;Object.assign(row,desktop.readback());row.modelMs=rounded(row.requestMs.reduce((sum,value)=>sum+value,0));report.rows.push(row);save();onProgress({phase:'task',completedTasks:report.rows.length,totalTasks:report.method.tasks,version,trial,status:row.status,durationMs:row.durationMs,modelRequests:row.modelRequests,toolCalls:row.toolCalls,verified:row.verified});}
  }
  report.status=fatal?'stopped':report.rows.some(row=>row.status==='error')?'completed_with_errors':'completed';if(fatal)report.stopCode=fatal;report.finishedAt=new Date().toISOString();save();return report;
}

// Offline smoke for the exact two AI loops. It exercises realistic tool-call
// continuation and independent fixture readback without reading credentials.
async function selfTest(){
  let calls=0;
  const fetcher=async(_url,options)=>{
    calls++;const body=JSON.parse(options.body),lastTool=[...body.messages].reverse().find(message=>message.role==='tool');
    let state;if(lastTool){const output=JSON.parse(lastTool.content);state=output.observation||output;}
    if(body.response_format)for(const item of body.messages){
      const parts=typeof item.content==='string'?[item.content]:(item.content||[]).filter(part=>part.type==='text').map(part=>part.text);
      for(const text of parts)try{const output=JSON.parse(text),candidate=output.observation||output;if(candidate?.snapshot&&Array.isArray(candidate.controls))state=candidate;}catch{}
    }
    const controls=state?.controls||[],find=(name,type)=>controls.find(control=>control.name===name&&(!type||normalizeRole(control.type||control.role)===type));
    let message;
    if(body.response_format){assert.ok(find('Saved Alpha revised'));message={role:'assistant',content:JSON.stringify({decision:'complete',answer:'Saved Alpha revised.',reason:'The latest fixture observation confirms the saved name.'})};}
    else{
      const tool=(name,args)=>({role:'assistant',content:null,tool_calls:[{id:'offline-'+calls,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
      const general=body.tools?.some(tool=>tool.function.name==='computer_execute_plan');
      if(!state)message=tool('computer_find_window',{query:'Customer workspace'});
      else if(general&&find('Search','textbox'))message=tool('computer_execute_plan',{snapshot:state.snapshot,steps:[{op:'fill',target:{role:'textbox',name:'Search'},text:'Alpha'},{op:'click',target:{role:'button',name:'Search'}},{op:'click',target:{role:'button',name:'Edit first result'}},{op:'fill',target:{role:'textbox',name:'Name'},text:'Alpha revised'},{op:'click',target:{role:'button',name:'Save'}}],completion:[{target:{role:'button',name:'Saved Alpha revised'},condition:'exists'}]});
      else if(find('Search','textbox')){const field=find('Search','textbox'),button=find('Search','button');message=tool('computer_action_sequence',{snapshot:state.snapshot,actions:[{kind:'type',control_id:field.control_id,expected_name:field.name,text:'Alpha'},{kind:'click',control_id:button.control_id,expected_name:button.name}]});}
      else if(find('Edit first result')){const button=find('Edit first result');message=tool('computer_action',{snapshot:state.snapshot,kind:'click',control_id:button.control_id,expected_name:button.name});}
      else if(find('Name')){const field=find('Name'),button=find('Save');message=tool('computer_action_sequence',{snapshot:state.snapshot,actions:[{kind:'type',control_id:field.control_id,expected_name:field.name,text:'Alpha revised'},{kind:'click',control_id:button.control_id,expected_name:button.name}]});}
      else {assert.ok(find('Saved Alpha revised'));message={role:'assistant',content:'Saved Alpha revised.'};}
    }
    return {ok:true,status:200,json:async()=>({choices:[{finish_reason:message.tool_calls?'tool_calls':'stop',message}],usage:{prompt_tokens:1,completion_tokens:1}})};
  };
  const directory=path.join(__dirname,'../test-output'),report=await runBenchmark({key:'offline-fixture-key',settings:{chatProvider:'deepseek',deepseekChatModel:'deepseek-flash',chatModel:'gpt-6-luna'},directory,fetcher,mock:true});
  assert.equal(report.status,'completed');assert.equal(report.rows.length,6);assert.ok(report.rows.every(row=>row.verified&&row.inputCount===5&&row.invalidToolCalls===0));assert.equal(report.totalModelRequests,calls);assert.ok(report.summary.general.modelRequests<report.summary.baseline.modelRequests);assert.equal(report.summary.general.planCalls,3);assert.equal(report.summary.baseline.planCalls,0);console.log(JSON.stringify({status:'offline_passed',tasks:6,verified:6,modelRequests:calls}));return report;
}
if(require.main===module){if(process.argv.includes('--self-test'))selfTest().catch(error=>{console.error(JSON.stringify({status:'offline_failed',errorCode:error.code||error.name}));process.exitCode=1;});else{console.error('Use the Electron run-general-model.js runner for an authorized live comparison.');process.exitCode=1;}}
module.exports={runBenchmark,fixture,summarize,selfTest};
