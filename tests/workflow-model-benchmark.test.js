'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const {fixture,loadBaseline,runBenchmark,runCacheBenchmark,installNonThinkingPlannerProbe}=require('../scripts/benchmark-workflow-model');
const {WORKFLOW_TOOL,workflowPlannerInstructions}=require('../workflow-assistant');
const baselineAvailable=fs.existsSync(path.resolve(__dirname,'../outputs/playback-fix-build/Mitch-win32-x64/resources/app.asar'));
const t=(name,role='button')=>({name,role,match:'exact'}),exists=(name,role)=>({target:t(name,role),condition:'exists'}),value=(name,text)=>({target:t(name,'textbox'),condition:'value',value:text});
const bind=app=>({op:'bind',target:{kind:'native',app}}),phase=(steps,completion)=>({op:'act',steps,completion});
const conditional={version:1,steps:[bind('Customer workspace'),phase([{op:'fill',target:t('Search','textbox'),text:'Alpha'},{op:'click',target:t('Search')},{op:'click',target:t('Alpha')}],[{target:t('Alpha'),condition:'absent'}]),{op:'if',condition:exists('Continue editing'),then:[phase([{op:'click',target:t('Continue editing')}],[exists('Name','textbox')])]},phase([{op:'fill',target:t('Name','textbox'),text:'Alpha revised'},{op:'click',target:t('Save')}],[value('Name','Alpha revised'),exists('Saved','heading')])],completion:[value('Name','Alpha revised'),exists('Saved','heading')]};
const cross={version:1,steps:[bind('Source workspace'),{op:'read',target:t('Reference','textbox'),attribute:'value',as:'reference'},bind('Destination workspace'),phase([{op:'fill',target:t('Reference','textbox'),text:{ref:'reference'}},{op:'click',target:t('Save')}],[value('Reference',{ref:'reference'}),exists('Saved','heading')])],completion:[value('Reference',{ref:'reference'}),exists('Saved','heading')]};
test('owned conditional fixture exercises both real branch states with exact final readback',async()=>{
  for(const trial of [1,2]){const f=fixture('conditional',{trial}),result=await f.dispatch('computer_run_workflow',conditional);assert.equal(result.verified,true);assert.equal(f.readback().verified,true);assert.equal(f.readback().saves,1);assert.equal(f.readback().promptAcknowledged,trial===1);assert.equal(f.readback().invalidToolCalls,0);}
});
test('owned cross-scope fixture copies an observed dynamic value and exposes evidence for review',async()=>{
  const f=fixture('cross_scope',{trial:3}),result=await f.dispatch('computer_run_workflow',cross);assert.equal(result.verified,true);assert.equal(f.readback().verified,true);assert.equal(f.readback().inputCount,2);assert.equal(result.events.some(e=>e.output?.controls?.some(c=>c.value==='REF-Q7-3')),true);assert.equal(result.variables,undefined);
});
test('packaged baseline is the unchanged v20 artifact and does not offer workflow programs',{skip:!baselineAvailable&&'The optional archived v20 benchmark artifact is absent.'},()=>{
  const baseline=loadBaseline();assert.equal(baseline.version,'0.6.0-local.20');assert.equal(baseline.sha256.length,64);const core=require('../outputs/workflow-model-baseline-v20/core');assert.equal(core.tools.some(tool=>tool.name==='computer_run_workflow'),false);assert.equal(core.tools.some(tool=>tool.name==='computer_execute_plan'),true);
});
test('offline model-loop smoke validates both versions and records independent completion reviews',{skip:!baselineAvailable&&'The optional archived v20 benchmark artifact is absent.'},async()=>{
  let id=0;const fetcher=async(_url,options)=>{
    const body=JSON.parse(options.body),workflow=body.tools?.some(tool=>tool.function?.name==='computer_run_workflow'),crossTask=body.messages.some(m=>typeof m.content==='string'&&m.content.includes('Copy the value of Reference'));
    const calls=body.messages.filter(m=>m.role==='assistant').flatMap(m=>m.tool_calls||[]),tool=(name,args)=>({role:'assistant',content:null,tool_calls:[{id:'mock-'+(++id),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
    const last=body.messages.filter(m=>m.role==='tool').at(-1);let state;if(last){const output=JSON.parse(last.content);state=output.observation||output;}
    const controls=state?.controls||[],find=name=>controls.find(c=>c.name===name),target=name=>{const c=find(name);return t(c.name,c.role||({Edit:'textbox',Header:'heading',Button:'button'}[c.type]||c.type));};let message;
    if(body.response_format)message={role:'assistant',content:JSON.stringify({decision:'complete',answer:'Saved the requested fixture value.',reason:'The final fixture observation contains Saved and the requested field value.'})};
    else if(workflow)message=tool('computer_run_workflow',crossTask?cross:conditional);
    else if(!state)message=tool('computer_find_window',{query:crossTask?'Source workspace':'Customer workspace'});
    else if(crossTask&&state.window.title==='Source workspace')message=tool('computer_find_window',{query:'Destination workspace'});
    else if(crossTask)message=tool('computer_execute_plan',{snapshot:state.snapshot,steps:[{op:'fill',target:target('Reference'),text:'REF-Q7-1'},{op:'click',target:target('Save')}],completion:[value('Reference','REF-Q7-1'),exists('Saved','heading')]});
    else if(find('Search'))message=tool('computer_execute_plan',{snapshot:state.snapshot,steps:[{op:'fill',target:t('Search','textbox'),text:'Alpha'},{op:'click',target:t('Search')}],completion:[exists('Alpha')],final:false});
    else if(find('Alpha'))message=tool('computer_execute_plan',{snapshot:state.snapshot,steps:[{op:'click',target:t('Alpha')}],completion:[exists('Continue editing')],final:false});
    else if(find('Continue editing'))message=tool('computer_execute_plan',{snapshot:state.snapshot,steps:[{op:'click',target:t('Continue editing')}],completion:[exists('Name','textbox')],final:false});
    else if(find('Name')&&find('Save'))message=tool('computer_execute_plan',{snapshot:state.snapshot,steps:[{op:'fill',target:target('Name'),text:'Alpha revised'},{op:'click',target:target('Save')}],completion:[value('Name','Alpha revised'),exists('Saved','heading')]});
    else message={role:'assistant',content:'Saved the requested fixture value.'};
    assert.ok(calls.length<15);return {ok:true,status:200,json:async()=>({choices:[{finish_reason:message.tool_calls?'tool_calls':'stop',message}],usage:{prompt_tokens:1,completion_tokens:1}})};
  };
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mitch-workflow-benchmark-test-')),report=await runBenchmark({key:'mock-key',settings:{chatProvider:'deepseek',deepseekChatModel:'deepseek-flash',chatModel:'gpt-6-luna'},directory,fetcher,mock:true,repeats:1});
  assert.equal(report.status,'completed');assert.equal(report.rows.length,4);assert.equal(report.rows.every(row=>row.verified&&row.invalidToolCalls===0),true);assert.equal(report.rows.every(row=>row.reviews.some(r=>r.decision==='complete'&&r.fixtureComplete)),true);assert.equal(report.summary.workflow.modelRequests<report.summary.baseline.modelRequests,true);
});
test('cache benchmark learns through the cold AI loop and verifies its actual warm replay',async()=>{
  let calls=0;const fetcher=async(_url,options)=>{calls++;const body=JSON.parse(options.body);const message=body.response_format?{role:'assistant',content:JSON.stringify({decision:'complete',answer:'Found Alpha.',reason:'Alpha is now the visible search result.'})}:{role:'assistant',content:null,tool_calls:[{id:'cache-test-'+calls,type:'function',function:{name:'computer_run_workflow',arguments:JSON.stringify({version:1,steps:[bind('Customer workspace'),phase([{op:'fill',target:t('Search','textbox'),text:'Alpha'},{op:'click',target:t('Search')}],[exists('Alpha')])],completion:[exists('Alpha')]})}}]};return {ok:true,status:200,json:async()=>({choices:[{finish_reason:message.tool_calls?'tool_calls':'stop',message}]})};};
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mitch-cache-benchmark-test-')),report=await runCacheBenchmark({key:'mock-key',settings:{chatProvider:'deepseek',deepseekChatModel:'deepseek-flash',chatModel:'gpt-6-luna'},directory,fetcher,mock:true});
  assert.equal(report.status,'completed');assert.equal(calls,2);assert.equal(report.rows[0].cachedProceduresAfter,1);assert.equal(report.rows[0].modelRequests,2);assert.equal(report.rows[1].modelRequests,0);assert.equal(report.rows[1].route,'replay');assert.equal(report.rows[1].verified,true);assert.equal(report.rows[1].inputCount,2);
});
test('nonthinking experiment overrides only the preferred planner and preserves reviewer/fallback settings',async()=>{
  const seen=[],ai={request:async(endpoint,body)=>{seen.push(body);return {status:'ok'};}},row={};installNonThinkingPlannerProbe(ai,row);
  const planner={instructions:workflowPlannerInstructions+'\nCurrent time: fixture',tools:[{name:WORKFLOW_TOOL}]};await ai.request('responses',planner,false);assert.equal(seen[0].localThinking,false);assert.equal(planner.localThinking,undefined);assert.equal(row.currentRequestKind,'planner_non_thinking');
  const review={instructions:'Independent whole-task verification',response_format:{type:'json_schema'}};await ai.request('responses',review,false);assert.equal(seen[1],review);assert.equal(row.currentRequestKind,'verification_high');
  const fallback={instructions:'Normal fallback',tools:[{name:WORKFLOW_TOOL}]};await ai.request('responses',fallback,false);assert.equal(seen[2],fallback);assert.equal(row.currentRequestKind,'fallback_high');
});
