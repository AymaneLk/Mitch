'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {AI:CurrentAI}=require('../ai');
const {validateTool}=require('../core');
const {executePlan,normalizeRole}=require('../action-plan');
const {runGuardedTaskProgram,compactEvidence}=require('../task-program-runner');
const {prepareTaskContext}=require('../task-program-host');
const {WORKFLOW_TOOL,workflowPlannerInstructions}=require('../workflow-assistant');
const ROOT=path.resolve(__dirname,'..'),BASELINE=path.join(ROOT,'outputs/playback-fix-build/Mitch-win32-x64/resources/app.asar');
const EXPECTED_BASELINE='447522053aa07dfbdce84f7072f3f7300e48c3b816ef835f0e54998967074dfb';
const TASK_LIMIT=12,TOTAL_LIMIT=96,REPEATS=3;
const prompts={conditional:'Find Alpha in Customer workspace, open its result, if an editing prompt appears choose Continue editing, change Name to Alpha revised, and save it.',cross_scope:'Copy the value of Reference from Source workspace into Destination workspace\'s Reference field, then click Save there.',search_only:'Find Alpha in Customer workspace.'};
const fail=(code,message=code)=>Object.assign(Error(message),{code,refused:true});
const rounded=n=>Math.round(n*100)/100;
const median=rows=>{const a=rows.slice().sort((a,b)=>a-b);return a.length?rounded(a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2):null;};
function loadBaseline(){
  const asar=require('@electron/asar'),previousNoAsar=process.noAsar;let digest,metadata;
  const destination=path.join(ROOT,'outputs/workflow-model-baseline-v20');
  const pinned=path.join(destination,'source-app.asar');
  try{
    // @electron/asar needs physical archive bytes, not Electron's virtual
    // directory interpretation. This synchronous archive-access window closes
    // before loading either controller or issuing any model request.
    process.noAsar=true;
    // The installed archive changes with each release. Keep the historical
    // comparison tied to its actual bytes, including when a cached extraction
    // and its metadata already exist.
    const backups=path.join(ROOT,'outputs/backups');
    function* candidates(){
      yield pinned;yield BASELINE;
      yield path.join(backups,'before-workflow-20261109-082914/resources/app.asar');
      if(fs.existsSync(backups))for(const entry of fs.readdirSync(backups,{withFileTypes:true}).filter(entry=>entry.isDirectory()).sort((a,b)=>b.name.localeCompare(a.name)).slice(0,64))yield path.join(backups,entry.name,'resources/app.asar');
    }
    let source,archive;const checked=new Set();
    for(const candidate of candidates()){
      if(checked.has(candidate)||!fs.existsSync(candidate))continue;checked.add(candidate);
      const bytes=fs.readFileSync(candidate),candidateDigest=crypto.createHash('sha256').update(bytes).digest('hex');
      if(candidateDigest===EXPECTED_BASELINE){source=candidate;archive=bytes;digest=candidateDigest;break;}
    }
    if(!source)throw fail('baseline_digest_mismatch');
    metadata=JSON.parse(asar.extractFile(source,'package.json').toString());if(metadata.version!=='0.6.0-local.20')throw fail('baseline_version_mismatch');
    if(!fs.existsSync(destination)){fs.mkdirSync(destination,{recursive:true});asar.extractAll(source,destination);fs.writeFileSync(path.join(destination,'benchmark-source.json'),JSON.stringify({sha256:digest,version:metadata.version}));}
    if(JSON.parse(fs.readFileSync(path.join(destination,'benchmark-source.json'),'utf8')).sha256!==digest)throw fail('baseline_extraction_mismatch');
    // Pin only after extraction, so creating the archive's parent directory
    // cannot masquerade as a completed extraction. Never extract over a source
    // archive stored inside that directory.
    if(source!==pinned)fs.writeFileSync(pinned,archive);
  }finally{process.noAsar=previousNoAsar;}
  // Only the AI modules are loaded. The extracted Electron main process is
  // never executed; every desktop operation goes to the owned fixture below.
  return {AI:require(path.join(destination,'ai')).AI,version:metadata.version,sha256:digest};
}
function fixture(kind,{trial=1,validator=validateTool}={}){
  if(!prompts[kind])throw fail('fixture_kind');
  const mode=kind==='search_only'?'conditional':kind;
  const windows=mode==='conditional'?[{pid:7311,window_id:7312,title:'Customer workspace',app:'CustomerWorkspace.exe'}]:[{pid:7411,window_id:7412,title:'Source workspace',app:'SourceWorkspace.exe'},{pid:7511,window_id:7512,title:'Destination workspace',app:'DestinationWorkspace.exe'}];
  for(const window of windows)Object.assign(window,{minimized:false,on_screen:true});
  const calls=[],trace=[],inputs=[],snapshots=new Map();let stage='search',search='',draft='Alpha',saved='',selected='',acknowledged=false,sequence=0,revision=0,invalid=0;
  const needsPrompt=trial%2===1,reference='REF-Q7-'+trial;
  const row=(id,name,type,extra={})=>({control_id:id,name,type,enabled:true,editable:false,protected:false,...extra});
  const controls=window=>{
    if(mode==='cross_scope')return window.window_id===7412?[row('source-reference','Reference','Edit',{value:reference})]:[row('destination-reference','Reference','Edit',{editable:stage!=='saved',value:stage==='saved'?saved:search}),...(stage==='saved'?[row('saved','Saved','Header')]:[row('save','Save','Button')])];
    if(stage==='search')return [row('search-field','Search','Edit',{editable:true,value:search}),row('search-button','Search','Button')];
    if(stage==='results')return search.toLowerCase()==='alpha'?[row('alpha','Alpha','Button')]:[row('missing','No matching customers','Header')];
    if(stage==='prompt')return [row('prompt','Editing prompt','Header'),row('continue','Continue editing','Button')];
    if(stage==='edit')return [row('customer','Customer Alpha','Header'),row('name','Name','Edit',{editable:true,value:draft}),row('save','Save','Button')];
    return [row('saved','Saved','Header'),row('name','Name','Edit',{value:saved}),row('customer','Customer Alpha','Header')];
  };
  function observe(window,legacy=false){const snapshot='fixture-'+(++sequence);snapshots.set(snapshot,{window,legacy,revision});return {status:'inspected',snapshot,complete:true,window:{...window},focus_verified:true,degraded:false,truncated:false,controls:controls(window).map(c=>legacy?{...c,id:'legacy-'+c.control_id}:c)};}
  function locate(args){const matches=windows.filter(w=>(args.pid===undefined||args.pid===w.pid)&&(args.window_id===undefined||args.window_id===w.window_id)&&(!args.query||(w.title+' '+w.app).toLowerCase().includes(args.query.toLowerCase())));if(matches.length!==1)throw fail('fixture_window_ambiguous','Select one exact observed fixture window.');return matches[0];}
  function bound(args,legacy=false){const snapshot=snapshots.get(args.snapshot);if(!snapshot||snapshot.legacy!==legacy||snapshot.revision!==revision)throw fail('fixture_stale_snapshot','Read the fixture again before input.');return snapshot.window;}
  function input(args,legacy=false){
    const window=bound(args,legacy),id=legacy?String(args.control_id).replace(/^legacy-/,''):args.control_id,current=controls(window).find(c=>c.control_id===id);
    if(!current||args.expected_name!==undefined&&args.expected_name!==current.name)throw fail('fixture_target_missing');
    if(args.kind==='type'){
      if(!current.editable||typeof args.text!=='string')throw fail('fixture_field_not_editable');
      if(id==='search-field'||id==='destination-reference')search=args.text;else if(id==='name')draft=args.text;else throw fail('fixture_wrong_field');
    }else if(args.kind==='click'){
      if(id==='search-button')stage='results';else if(id==='alpha'){selected='Alpha';stage=needsPrompt?'prompt':'edit';}else if(id==='continue'){acknowledged=true;stage='edit';}else if(id==='save'){saved=mode==='conditional'?draft:search;stage='saved';}else throw fail('fixture_wrong_action');
    }else throw fail('fixture_unsupported_input');
    revision++;inputs.push({kind:args.kind,target:id});return {status:'verified',verified:true,effect:'confirmed',observation:observe(window,legacy)};
  }
  async function perform(name,args,context={}){
    calls.push(name);context.signal?.throwIfAborted();validator(name,args);if(calls.length>100)throw fail('fixture_tool_limit');
    if(name==='browser_list_tabs')return {status:'ok',complete:true,snapshot:'empty-browser',browser:'opera',session_id:'fixture-session',tabs:[]};
    if(name==='computer_list_windows')return {status:'ok',windows:windows.filter(w=>!args.query||(w.title+' '+w.app).toLowerCase().includes(args.query.toLowerCase())),degraded:false,truncated:false};
    if(name==='list_apps')return {status:'ok',apps:windows.map(w=>({name:w.title,app_id:'fixture-'+w.pid})).filter(a=>!args.query||a.name.toLowerCase().includes(args.query.toLowerCase()))};
    if(name==='open_app'){const window=windows.find(w=>'fixture-'+w.pid===args.app_id);if(!window)throw fail('fixture_wrong_app');return {status:'focused_existing',app:window.title,observation:observe(window)};}
    if(name==='computer_find_window'||['computer_inspect_window','computer_focus_window','computer_restore_window'].includes(name))return observe(locate(args));
    if(name==='inspect_app')return args.query?observe(locate(args),true):{status:'windows',windows};
    if(name==='computer_action')return input(args);
    if(name==='click_app_control')return input({...args,kind:'click'},true);
    if(name==='type_in_app')return input({...args,kind:'type'},true);
    if(name==='computer_action_sequence'){
      const window=bound(args),known=controls(window),steps=args.actions.map(step=>{if(!known.some(c=>c.control_id===step.control_id&&c.name===step.expected_name))throw fail('fixture_future_target');return step;});let result;
      for(const step of steps)result=input({...step,snapshot:observe(window).snapshot});return {status:'completed',verified:true,completed:steps.length,attempted:steps.length,total:steps.length,results:steps.map(()=>({status:'verified',verified:true})),observation:result.observation};
    }
    if(name==='computer_execute_plan'){
      const window=bound(args),normalized=()=>{const frame=observe(window);return {...frame,controls:frame.controls.map(c=>({...c,id:c.control_id,role:normalizeRole(c.type)}))};};
      let latest;return executePlan({steps:args.steps,completion:args.completion,context,adapter:{snapshot:async()=>latest=normalized(),act:async(step,control)=>input({snapshot:latest.snapshot,control_id:control.id,expected_name:control.name,kind:step.op==='fill'?'type':step.op==='click'?'click':'unsupported',...(step.op==='fill'?{text:step.text}:{})})}});
    }
    if(name==='computer_run_workflow')return runGuardedTaskProgram({program:args,bindings:context.workflowBindings||{},dispatch,context,replay:context.workflowReplay});
    throw fail('fixture_unsupported_tool','This test exposes only named accessibility controls. There is no real desktop, file system, screenshot or browser connected.');
  }
  async function dispatch(name,args,context={}){
    const record={tool:name,stageBefore:stage};trace.push(record);
    if(name==='computer_run_workflow')record.program=compactEvidence({program:args},[]).program;
    try{const output=await perform(name,args,context);Object.assign(record,{status:output.status,verified:output.verified,stageAfter:stage});if(typeof output.reason==='string')record.reason=output.reason.slice(0,80);if(name==='computer_run_workflow'){record.nodes=args.steps?.length;record.branches=(output.steps||[]).filter(s=>s.op==='if').map(s=>s.branch);record.references=(output.steps||[]).filter(s=>s.op==='read').length;}return output;}
    catch(error){context.signal?.throwIfAborted();invalid++;record.status='refused';record.reason=error.code||'fixture_refused';record.validationMessage=String(error.message||'').slice(0,200);return {status:'refused',verified:false,refused:true,action_attempted:false,code:error.code||'fixture_refused',message:error.message};}
  }
  function readback(){return {verified:kind==='search_only'?stage==='results'&&search==='Alpha':mode==='conditional'?stage==='saved'&&selected==='Alpha'&&saved==='Alpha revised'&&(!needsPrompt||acknowledged):stage==='saved'&&saved===reference,inputCount:inputs.length,invalidToolCalls:invalid,promptRequired:kind==='conditional'?needsPrompt:undefined,promptAcknowledged:kind==='conditional'?acknowledged:undefined,saves:inputs.filter(i=>i.target==='save').length};}
  function reset(){stage='search';search='';draft='Alpha';saved='';selected='';acknowledged=false;revision++;snapshots.clear();}
  return {dispatch,calls,trace,readback,reset,prompt:prompts[kind],prepare:(text,context)=>prepareTaskContext({text,dispatch,context})};
}
function summarize(rows){return Object.fromEntries(['baseline','workflow'].map(version=>{const chosen=rows.filter(row=>row.version===version),verified=chosen.filter(row=>row.verified),completed=verified.filter(row=>row.status==='ok'&&row.replyReceived);return [version,{tasks:chosen.length,verified:verified.length,completedAndVerified:completed.length,completionRate:chosen.length?rounded(completed.length/chosen.length):null,medianMs:median(chosen.map(r=>r.durationMs)),verifiedMedianMs:median(verified.map(r=>r.durationMs)),completedMedianMs:median(completed.map(r=>r.durationMs)),medianModelRequests:median(chosen.map(r=>r.modelRequests)),modelRequests:chosen.reduce((n,r)=>n+r.modelRequests,0),falseCompletionReviews:chosen.reduce((n,r)=>n+r.reviews.filter(v=>v.decision==='complete'&&!v.fixtureComplete).length,0),missedCompletionReviews:chosen.reduce((n,r)=>n+r.reviews.filter(v=>v.decision!=='complete'&&v.fixtureComplete).length,0)}];}));}
function installNonThinkingPlannerProbe(ai,row){
  const original=ai.request.bind(ai);
  ai.request=(endpoint,body,form,signal)=>{
    const preferred=endpoint==='responses'&&!body.response_format&&typeof body.instructions==='string'&&body.instructions.startsWith(workflowPlannerInstructions)&&Array.isArray(body.tools)&&body.tools.some(tool=>tool.name===WORKFLOW_TOOL);
    const current=typeof row==='function'?row():row;current.currentRequestKind=preferred?'planner_non_thinking':body.response_format?'verification_high':'fallback_high';
    return original(endpoint,preferred?{...body,localThinking:false}:body,form,signal);
  };
}
async function runBenchmark({settings,directory,modelRequest,fetcher=fetch,onProgress=()=>{},mock=false,repeats=REPEATS,trialStart=1,versions=['baseline','workflow'],reportName,tasks=['conditional','cross_scope'],nonThinkingPlanner=false,taskLimit=TASK_LIMIT}){
  if(!modelRequest&&!mock)throw fail('authorized_provider_required');
  modelRequest||=((body,signal)=>require('../local-ai').localResponse(fetcher,{localChatModel:'fixture',allowScreen:false},body,signal));
  if(!Number.isInteger(repeats)||repeats<1||repeats>3||!Number.isInteger(trialStart)||trialStart<1||trialStart+repeats>4||!Array.isArray(versions)||!versions.length||versions.some(v=>!['baseline','workflow'].includes(v))||tasks.some(task=>!prompts[task])||reportName&&!/^[a-z0-9-]+\.json$/.test(reportName)||!Number.isInteger(taskLimit)||taskLimit<1||taskLimit>TASK_LIMIT)throw fail('benchmark_limits');
  const baseline=loadBaseline(),report={status:'running',startedAt:new Date().toISOString(),method:{baselineVersion:baseline.version,baselineSha256:baseline.sha256,current:'Current source with workflow engine, cold planning, independent final semantic review',model:'account-selected',tasks:tasks.length*repeats*2,repeats,order:'Alternating version order for each trial; identical fixture state within each pair',scope:'Real provider/model and controller latency; zero-delay owned in-memory accessibility fixture. Excludes real launch, UIA, DOM, screen, speech and GPU latency. Results are task-set success, not general computer-use accuracy.',realUI:false,mockProvider:mock,reuseWorkflows:false,speculativePlanning:false,taskRequestLimit:TASK_LIMIT,totalRequestLimit:TOTAL_LIMIT,rawPromptsStored:false,rawResponsesStored:false},rows:[]};
  report.method.tasks=tasks.length*repeats*versions.length;report.method.trialStart=trialStart;report.method.versions=versions;report.method.sanitizedFixtureProgramsStored=true;report.method.currentSourceHashes=Object.fromEntries(['ai.js','workflow-assistant.js','task-program.js','task-program-host.js'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,name))).digest('hex')]));
  report.method.taskRequestLimit=taskLimit;
  if(nonThinkingPlanner)Object.assign(report.method,{variant:'Experimental nonthinking preferred workflow planner only; independent whole-task reviewer and fallback retain the selected model. This changes a model setting and is not a pure architecture comparison.',thinking:'disabled for preferred workflow planner; enabled for reviewer and fallback',effort:'high for reviewer and fallback',appDefaultChanged:false});
  const file=path.join(directory,reportName||(mock?'workflow-model-mock.json':'workflow-model-benchmark.json')),stopFile=path.join(directory,'workflow-model.stop');fs.mkdirSync(directory,{recursive:true});let total=0,fatal;
  const save=()=>{report.totalModelRequests=total;report.summary=summarize(report.rows);fs.writeFileSync(file,JSON.stringify(report,null,2));};save();
  for(let trial=trialStart;trial<trialStart+repeats&&!fatal;trial++)for(const task of tasks)for(const version of (trial%2?['baseline','workflow']:['workflow','baseline']).filter(v=>versions.includes(v))){
    if(fs.existsSync(stopFile))fatal='operator_stopped';if(fatal)break;const desktop=fixture(task,{trial}),row={version,task,trial,status:'running',modelRequests:0,requestMs:[],requestKinds:[],reviews:[],toolCounts:{},usage:{promptTokens:0,completionTokens:0,cachedPromptTokens:0}};
    const configuration={...settings,allowDesktop:true,allowScreen:false,localGrounding:false,workflowEngine:version==='workflow',fastWorkflowPlanning:nonThinkingPlanner&&version==='workflow',reuseWorkflows:false,speculativePlanning:false};
    const AI=version==='baseline'?baseline.AI:CurrentAI,ai=new AI(()=>configuration,()=>{throw fail('unexpected_credential_provider');},desktop.dispatch);
    ai.request=async(endpoint,body,form,signal)=>{
      if(endpoint!=='responses'||form)throw fail('unexpected_endpoint');if(row.modelRequests>=taskLimit)throw fail('task_request_limit');if(total>=TOTAL_LIMIT){fatal='global_request_limit';throw fail(fatal);}
      if(!row.modelRequests){row.workflowOffered=body.tools?.some(t=>t.name==='computer_run_workflow')===true;if(row.workflowOffered!==(version==='workflow'))throw fail('baseline_tool_mismatch');}
      row.modelRequests++;total++;row.requestKinds.push(body.response_format?'verification':'decision');const begin=performance.now();
      try{return await modelRequest(body,AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(45000)]));}
      finally{row.requestMs.push(rounded(performance.now()-begin));onProgress({phase:'request',version,task,trial,modelRequests:row.modelRequests,requestMs:row.requestMs.at(-1)});}
    };
    if(version==='workflow')ai.prepareContext=desktop.prepare;
    if(nonThinkingPlanner&&version==='workflow')installNonThinkingPlannerProbe(ai,row);
    const review=ai.reviewDesktop.bind(ai);ai.reviewDesktop=async(...args)=>{const fixtureComplete=desktop.readback().verified,result=await review(...args);row.reviews.push({decision:result.decision,fixtureComplete});return result;};
    const started=performance.now(),timeout=setTimeout(()=>ai.cancel(),150000);
    try{const answer=await ai.chat(desktop.prompt,undefined,Symbol('owned-'+task));row.replyReceived=typeof answer==='string'&&!!answer.trim();row.status='ok';}
    catch(error){row.status='error';row.errorCode=typeof error.code==='string'&&/^[a-z_0-9]+$/.test(error.code)?error.code:['AbortError','TimeoutError'].includes(error.name)?error.name:'model_task_error';}
    finally{clearTimeout(timeout);ai.cancel();ai.closeVoice();row.durationMs=rounded(performance.now()-started);row.modelMs=rounded(row.requestMs.reduce((a,b)=>a+b,0));row.toolCalls=desktop.calls.length;for(const name of desktop.calls)row.toolCounts[name]=(row.toolCounts[name]||0)+1;row.trace=desktop.trace;row.route=ai.lastTaskTiming?.route;Object.assign(row,desktop.readback());report.rows.push(row);save();onProgress({phase:'task',version,task,trial,status:row.status,verified:row.verified,durationMs:row.durationMs,modelRequests:row.modelRequests});}
  }
  report.status=fatal?'stopped':report.rows.some(row=>row.status==='error')?'completed_with_errors':'completed';if(fatal)report.stopCode=fatal;report.finishedAt=new Date().toISOString();save();return report;
}
async function runCacheBenchmark({settings,directory,modelRequest,fetcher=fetch,onProgress=()=>{},mock=false,nonThinkingPlanner=false,taskLimit=6,reportName}){
  if(!modelRequest&&!mock)throw fail('authorized_provider_required');
  modelRequest||=((body,signal)=>require('../local-ai').localResponse(fetcher,{localChatModel:'fixture',allowScreen:false},body,signal));
  const desktop=fixture('search_only'),configuration={...settings,allowDesktop:true,allowScreen:false,workflowEngine:true,fastWorkflowPlanning:nonThinkingPlanner,reuseWorkflows:true,speculativePlanning:false,localGrounding:false};
  if(!Number.isInteger(taskLimit)||taskLimit<1||taskLimit>6||reportName&&!/^[a-z0-9-]+\.json$/.test(reportName))throw fail('benchmark_limits');
  const report={status:'running',startedAt:new Date().toISOString(),method:{scope:'Real authorized model and controller against a zero-delay owned search fixture; reset to identical initial UI before repeating in the same AI instance. Cache is learned only through actual cold model execution and independent completion review.',realUI:false,mockProvider:mock,model:'account-selected',taskRequestLimit:taskLimit,sanitizedFixtureProgramsStored:true,rawResponsesStored:false,appDefaultChanged:false},rows:[]},file=path.join(directory,reportName||(mock?'workflow-cache-model-mock.json':'workflow-cache-model.json'));let row,total=0;
  const save=()=>{report.totalModelRequests=total;fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2));};save();
  const ai=new CurrentAI(()=>configuration,()=>{throw fail('unexpected_credential_provider');},desktop.dispatch);ai.prepareContext=desktop.prepare;
  ai.request=async(endpoint,body,form,signal)=>{
    if(endpoint!=='responses'||form)throw fail('unexpected_endpoint');if(total>=taskLimit*2||row.modelRequests>=taskLimit)throw fail('cache_request_limit');row.modelRequests++;total++;row.requestKinds.push(body.response_format?'verification':'decision');const begin=performance.now();
    try{return await modelRequest(body,AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(45000)]));}finally{row.requestMs.push(rounded(performance.now()-begin));onProgress({phase:'request',task:'cache_search',mode:row.mode,modelRequests:row.modelRequests,requestMs:row.requestMs.at(-1)});}
  };
  if(nonThinkingPlanner)installNonThinkingPlannerProbe(ai,()=>row);
  const review=ai.reviewDesktop.bind(ai);ai.reviewDesktop=async(...args)=>{const fixtureComplete=desktop.readback().verified,result=await review(...args);row.reviews.push({decision:result.decision,fixtureComplete});return result;};
  for(const mode of ['cold','warm']){
    if(fs.existsSync(path.join(directory,'workflow-model.stop'))){report.status='stopped';break;}if(mode==='warm')desktop.reset();
    const startCalls=desktop.calls.length,startTrace=desktop.trace.length,before=desktop.readback(),started=performance.now();row={mode,modelRequests:0,requestMs:[],requestKinds:[],reviews:[],cachedProceduresBefore:ai.procedures.rows.length};const timeout=setTimeout(()=>ai.cancel(),120000);
    try{const answer=await ai.chat(desktop.prompt,undefined,Symbol('cache-'+mode));row.status='ok';row.replyReceived=typeof answer==='string'&&!!answer.trim();}catch(error){row.status='error';row.errorCode=typeof error.code==='string'?error.code:'cache_task_error';}
    finally{clearTimeout(timeout);ai.cancel();const result=desktop.readback();Object.assign(row,{durationMs:rounded(performance.now()-started),verified:result.verified,inputCount:result.inputCount-before.inputCount,invalidToolCalls:result.invalidToolCalls-before.invalidToolCalls,toolCalls:desktop.calls.length-startCalls,trace:desktop.trace.slice(startTrace),route:ai.lastTaskTiming?.route,cachedProceduresAfter:ai.procedures.rows.length});report.rows.push(row);save();onProgress({phase:'task',task:'cache_search',mode,status:row.status,verified:row.verified,durationMs:row.durationMs,modelRequests:row.modelRequests,route:row.route});}
  }
  ai.closeVoice();report.status=report.status==='stopped'?'stopped':report.rows.some(r=>r.status==='error')?'completed_with_errors':'completed';report.finishedAt=new Date().toISOString();save();return report;
}
module.exports={runBenchmark,runCacheBenchmark,fixture,summarize,loadBaseline,prompts,installNonThinkingPlannerProbe};
