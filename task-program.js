'use strict';
const Ajv=require('ajv');
const {PROGRAM_SCHEMA,INTERNAL_PROGRAM_SCHEMA}=require('./task-program-schema');
const {validatePlan,matchControls,testCondition,typedTarget}=require('./action-plan');
const schemaCheck=new Ajv({strict:false,allErrors:false}).compile(INTERNAL_PROGRAM_SCHEMA);
const MAX_DURATION=30000,MAX_NODES=48,MAX_INPUTS=32,MAX_DEPTH=3;
const invalid=(message,code='invalid_program')=>Object.assign(Error(message),{code,refused:true});
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const badNames=new Set(['constructor','prototype','__proto__']);
const nameOkay=name=>typeof name==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(name)&&!badNames.has(name);
const isRef=value=>plain(value)&&Object.keys(value).length===1&&Object.hasOwn(value,'ref');
function resolveValue(value,variables){
  if(!isRef(value))return value;
  if(!variables.has(value.ref))throw invalid('A required workflow variable is unavailable.','missing_variable');
  return variables.get(value.ref);
}
function resolveSelector(target,variables){return {...target,name:resolveValue(target.name,variables)};}
function resolvePredicate(predicate,variables){return {...predicate,target:resolveSelector(predicate.target,variables),...(predicate.value===undefined?{}:{value:resolveValue(predicate.value,variables)})};}
function resolvePrimitive(step,variables){return {...step,target:resolveSelector(step.target,variables),...(step.text===undefined?{}:{text:resolveValue(step.text,variables)}),...(step.value===undefined?{}:{value:resolveValue(step.value,variables)})};}
function validateBinding(target){
  if(target.kind==='browser'){
    if(target.hostname!==target.hostname.toLowerCase()||target.hostname.length>253||!target.hostname.includes('.')||!target.hostname.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))throw invalid('Choose an exact browser hostname.');
    if(target.url!==undefined){let url;try{url=new URL(target.url);}catch{throw invalid('Invalid browser binding URL.');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hostname!==target.hostname||target.open_if_missing!==true)throw invalid('Opening a missing tab requires an explicit same-host HTTP(S) URL.');}
    if(target.open_if_missing===true&&!target.url)throw invalid('A new tab needs an explicit same-host URL.');
  }
}
function normalizeTaskProgram(program){
  if(!plain(program))throw invalid('The workflow must be a bounded object.');
  if(program.version===2)program=require('./compact-task').compileCompactTask(program);
  if(Object.hasOwn(program,'completion'))return program;
  const terminal=Array.isArray(program.steps)?program.steps.at(-1):null;
  if(terminal?.op!=='act'||!Array.isArray(terminal.completion)||terminal.completion.length<1||terminal.completion.length>4)throw invalid('Omitting final completion requires a final unconditional action phase with nonempty completion assertions.');
  // Clone only the inherited assertions: they remain independent from the
  // phase array and are validated along with every branch before any input.
  let completion;try{completion=structuredClone(terminal.completion);}catch{throw invalid('The final phase assertions are invalid.');}
  return {...program,completion};
}
function validateTaskProgram(program,bindings={}){
  program=normalizeTaskProgram(program);
  if(!schemaCheck(program))throw invalid('The workflow does not match the bounded task-program schema.');
  if(!plain(bindings)||Object.keys(bindings).length>16||Object.entries(bindings).some(([key,value])=>!nameOkay(key)||typeof value!=='string'||value.length>8000))throw invalid('Invalid workflow parameters.');
  let nodes=0,inputs=0,binds=0;
  const valueCheck=(value,known)=>{if(isRef(value)&&(!nameOkay(value.ref)||!known.has(value.ref)))throw invalid('A variable must be defined on every branch before it is used.');};
  const predicateCheck=(condition,known)=>{
    valueCheck(condition.target.name,known);valueCheck(condition.value,known);
    if(condition.condition==='value'&&condition.value===undefined)throw invalid('A value condition requires a value.');
    if(['exists','absent'].includes(condition.condition)&&condition.value!==undefined)throw invalid('An existence condition cannot have a value.');
    if(['checked','selected'].includes(condition.condition)&&condition.value!==undefined&&!isRef(condition.value)&&!['true','false'].includes(condition.value))throw invalid('A Boolean condition requires true or false.');
  };
  const visit=(steps,depth,defined,hasScope)=>{
    if(depth>MAX_DEPTH)throw invalid('Workflow branches are too deeply nested.');
    let known=new Set(defined),scoped=hasScope;
    for(const step of steps){
      if(++nodes>MAX_NODES)throw invalid('The workflow contains too many nodes.');
      if(step.op==='bind'){validateBinding(step.target);binds++;inputs++;scoped=true;}
      else{
        if(!scoped)throw invalid('Bind an observed application or page before using controls.');
        if(step.op==='transition'){binds++;inputs++;}
        if(step.op==='if'){
          predicateCheck(step.condition,known);
          const yes=visit(step.then,depth+1,known,scoped),no=visit(step.else||[],depth+1,known,scoped);
          known=new Set([...yes.known].filter(key=>no.known.has(key)));scoped=yes.scoped&&no.scoped;
        }else if(step.op==='read'){
          valueCheck(step.target.name,known);if(!nameOkay(step.as))throw invalid('Invalid read variable.');known.add(step.as);
        }else if(step.op==='act'){
          for(const action of step.steps){nodes++;valueCheck(action.target.name,known);valueCheck(action.text,known);valueCheck(action.value,known);if(!['wait','assert'].includes(action.op))inputs++;}
          for(const assertion of step.completion)predicateCheck(assertion,known);
          // Validate action semantics now, including unreachable branches.
          // Dummy variables only check shape; runtime resolves exact real data.
          const dummy=new Map([...known].map(key=>[key,'true']));
          try{validatePlan({steps:step.steps.map(s=>resolvePrimitive(s,dummy)),completion:step.completion.map(c=>resolvePredicate(c,dummy))});}catch{throw invalid('Invalid action phase in the workflow.');}
        }else if(step.op==='follow_link'){
          valueCheck(step.target.name,known);for(const assertion of step.completion)predicateCheck(assertion,known);inputs++;
        }else if(['wait','assert'].includes(step.op))predicateCheck(step.condition,known);
        else if(step.op==='await_any'){
          for(const condition of step.conditions)predicateCheck(condition,known);
          if(step.as!==undefined){if(!nameOkay(step.as))throw invalid('Invalid wait variable.');known.add(step.as);}
        }
      }
      if(nodes>MAX_NODES||inputs>MAX_INPUTS||binds>8)throw invalid('The workflow exceeds its bounded execution limits.');
    }
    return {known,scoped};
  };
  const final=visit(program.steps,0,new Set(Object.keys(bindings)),false);
  for(const assertion of program.completion)predicateCheck(assertion,final.known);
  return program;
}
function requireFrame(frame){
  if(!plain(frame)||frame.complete!==true||!Array.isArray(frame.controls)||frame.degraded||frame.truncated||frame.scope_error||frame.scopeError)throw invalid('The current interface is incomplete or changed scope.','incomplete_observation');
  return frame;
}
const frameOf=result=>result?.observation||result;
const badOutcome=result=>!result||result.outcome_unknown||result.stop_task||result.input_suppressed||result.recovery_required||['error','refused','failed','interrupted','cancelled','unknown','observation_failed'].includes(result.status);
/** Execute a validated task program with fresh host-bound scopes. Semantic
 * completion of the user's whole request remains a caller responsibility. */
async function executeTaskProgram({program,host,context={},bindings={},timeoutMs=MAX_DURATION,now=Date.now}){
  const started=now(),duration=Math.max(1,Math.min(MAX_DURATION,Number.isFinite(timeoutMs)?Math.floor(timeoutMs):MAX_DURATION));
  const result={status:'interrupted',verified:false,program_assertions_verified:false,steps:[],delivered_steps:[],completion:[],observation:null,variables:{},stats:{nodes:0,phases:0,observations:0,waits:0,duration_ms:0}};
  const controller=new AbortController(),variables=new Map(),deadline=started+duration;
  let timer,onAbort,currentRecord,inMutation=false,hadMutation=false;
  const cancelled=()=>controller.signal.reason instanceof Error?controller.signal.reason:invalid('The workflow was cancelled.','cancelled');
  const check=()=>{
    context.signal?.throwIfAborted();controller.signal.throwIfAborted();context.assertActive?.();host?.check?.();
    if(context.isCancelled?.())throw invalid('The workflow was cancelled.','cancelled');
    if(now()>=deadline)throw invalid('The workflow reached its deadline.','deadline_exceeded');
  };
  const runContext={...context,signal:controller.signal,deadline,assertActive:check};
  const bounded=async operation=>{
    check();let abort;
    try{
      const cancellation=new Promise((_,reject)=>{abort=()=>reject(cancelled());controller.signal.addEventListener('abort',abort,{once:true});});
      const value=await Promise.race([Promise.resolve().then(()=>{check();return operation();}),cancellation]);check();return value;
    }finally{controller.signal.removeEventListener('abort',abort);}
  };
  const observe=async(refresh=false,target,forRead=false)=>{
    const frame=await bounded(()=>host.observe({refresh,selector:target,...(forRead?{forRead:true}:{})},runContext));result.stats.observations++;result.observation=frame;return requireFrame(frame);
  };
  const propagate=resultValue=>{
    if(resultValue?.observation)result.observation=resultValue.observation;
    if(resultValue?.outcome_unknown){
      if(typeof resultValue.reason==='string')result.source_reason=resultValue.reason;
      if(resultValue.read_only_recovery===true)result.read_only_recovery=true;
      if(resultValue.distinct_action_recovery===true){result.distinct_action_recovery=true;result.recovery=resultValue.recovery;}
      if(Array.isArray(resultValue.attempted_steps))result.attempted_steps=resultValue.attempted_steps;
    }
    if(Array.isArray(resultValue?.delivered_steps))result.delivered_steps.push(...resultValue.delivered_steps.slice(0,32).map(step=>({...step,program_index:currentRecord?.index})));
    if(resultValue?.attempted>0||resultValue?.action_attempted||resultValue?.delivered_steps?.length)hadMutation=true;
    if(resultValue?.outcome_unknown)throw Object.assign(invalid('A workflow action has an unknown outcome.','outcome_unknown'),{outcome_unknown:true});
    if(badOutcome(resultValue))throw Object.assign(invalid('A workflow phase stopped; continue only from its fresh observation.',resultValue?.reason||resultValue?.code||'phase_interrupted'),{recovery_required:!!resultValue?.recovery_required});
  };
  const pause=ms=>new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(id);reject(cancelled());};const id=setTimeout(()=>{controller.signal.removeEventListener('abort',abort);resolve();},ms);controller.signal.addEventListener('abort',abort,{once:true});});
  const waitAny=async(conditions,timeout)=>{
    const until=Math.min(deadline,now()+timeout);
    while(true){
      const frame=await observe(true);
      const passed=conditions.map(condition=>testCondition(frame,condition));
      if(passed.filter(Boolean).length>1)throw invalid('Several alternate outcomes match; the workflow cannot choose one.','ambiguous_outcome');
      const index=passed.indexOf(true);if(index>=0)return index;
      if(now()>=until)throw invalid('The expected interface state did not appear.','condition_unmet');
      const wait=Math.max(1,Math.min(100,until-now()));result.stats.waits++;
      if(typeof host.waitForChange==='function')await bounded(()=>host.waitForChange({timeout_ms:wait,revision:frame.revision},runContext));
      else await bounded(()=>pause(wait));
    }
  };
  const run=async(steps,path='')=>{
    for(let index=0;index<steps.length;index++){
      check();const step=steps[index],record={index:path+index,op:step.op,status:'pending'};currentRecord=record;result.steps.push(record);result.stats.nodes++;
      if(step.op==='bind'||step.op==='transition'){
        inMutation=true;const bound=await bounded(()=>host[step.op](step.target,runContext));inMutation=false;propagate(bound);result.observation=requireFrame(frameOf(bound));record.scope=step.target.kind;
      }else if(step.op==='if'){
        const condition=resolvePredicate(step.condition,variables);const frame=await observe(false,condition.target),yes=testCondition(frame,condition);record.branch=yes?'then':'else';
        await run(yes?step.then:(step.else||[]),record.index+'.'+(yes?'then':'else')+'.');
      }else if(step.op==='read'){
        const target=resolveSelector(step.target,variables);
        // Native value reads may focus the bound window to refresh cached
        // accessibility values. Cancellation during focus is uncertain input.
        inMutation=true;const frame=await observe(true,target,true);inMutation=false;
        const matches=matchControls(frame.controls,typedTarget(frame.controls,target,step.attribute));
        if(matches.length!==1)throw invalid('A read requires one uniquely observed control.','ambiguous_target');
        if(matches[0].protected)throw invalid('A protected control cannot be read.','protected_target');
        const value=matches[0][step.attribute];if(typeof value!=='string'||value.length>8000)throw invalid('The requested control value is unavailable or too large.','unavailable_value');
        variables.set(step.as,value);record.variable=step.as;
      }else if(step.op==='act'){
        const actions=step.steps.map(action=>resolvePrimitive(action,variables)),completion=step.completion.map(condition=>resolvePredicate(condition,variables));
        // Dynamic substitution must satisfy the same bounded action schema.
        validatePlan({steps:actions,completion});check();inMutation=true;result.stats.phases++;
        const performed=await bounded(()=>host.perform(actions,completion,runContext));inMutation=false;propagate(performed);
        if(performed.status!=='completed'||performed.verified!==true)throw invalid('The action phase was not verified.','phase_unverified');
        result.observation=requireFrame(frameOf(performed));hadMutation=hadMutation||actions.some(action=>!['wait','assert'].includes(action.op));
        record.completed=Number.isSafeInteger(performed.completed)?performed.completed:actions.length;
      }else if(step.op==='follow_link'){
        if(typeof host.followLink!=='function')throw invalid('The host cannot navigate observed links.','unsupported_operation');
        const target=resolveSelector(step.target,variables),completion=step.completion.map(condition=>resolvePredicate(condition,variables));
        check();inMutation=true;result.stats.phases++;
        const followed=await bounded(()=>host.followLink(target,completion,runContext));inMutation=false;propagate(followed);
        if(followed.status!=='completed'||followed.verified!==true)throw invalid('Link navigation did not verify its destination.','phase_unverified');
        result.observation=requireFrame(frameOf(followed));hadMutation=true;
      }else if(['wait','assert'].includes(step.op)){
        const condition=resolvePredicate(step.condition,variables);await waitAny([condition],step.timeout_ms??(step.op==='wait'?2000:0));
      }else if(step.op==='await_any'){
        const conditions=step.conditions.map(condition=>resolvePredicate(condition,variables)),index=await waitAny(conditions,step.timeout_ms??2000);record.matched=index;if(step.as!==undefined)variables.set(step.as,String(index));
      }
      record.status='completed';currentRecord=record;
    }
  };
  try{
    program=validateTaskProgram(program,bindings);
    if(!host||['bind','observe','perform','transition'].some(method=>typeof host[method]!=='function'))throw invalid('The workflow needs a scoped host adapter.','invalid_host');
    for(const [key,value]of Object.entries(bindings))variables.set(key,value);
    check();onAbort=()=>controller.abort(context.signal.reason||invalid('The workflow was cancelled.','cancelled'));context.signal?.addEventListener('abort',onAbort,{once:true});
    timer=setTimeout(()=>controller.abort(invalid('The workflow reached its deadline.','deadline_exceeded')),duration);
    await run(program.steps);
    // One final complete frame proves all final predicates consistently. Do not
    // issue a full native accessibility read for each individual assertion.
    const finalFrame=await observe(true);
    for(const raw of program.completion){
      const condition=resolvePredicate(raw,variables),frame=finalFrame,passed=testCondition(frame,condition);
      result.completion.push({...condition,passed,observation:{...frame,controls:matchControls(frame.controls,condition.target),selector:condition.target}});
      if(!passed)throw invalid('A final program assertion did not pass.','completion_unmet');
    }
    result.status='completed';result.verified=true;result.program_assertions_verified=true;
  }catch(error){
    result.reason=error.code||((context.signal?.aborted||controller.signal.aborted)?'cancelled':'program_interrupted');result.message=String(error.message||error).slice(0,400);
    if(currentRecord?.status==='pending')currentRecord.status='interrupted';
    if(error.outcome_unknown||(inMutation&&(!error.refused||context.signal?.aborted||controller.signal.aborted||result.reason==='deadline_exceeded'))||(hadMutation&&(context.signal?.aborted||controller.signal.aborted||result.reason==='deadline_exceeded')))result.outcome_unknown=true;
    else if(error.recovery_required||result.delivered_steps.length||hadMutation)result.recovery_required=true;
    if(context.signal?.aborted||controller.signal.aborted||['cancelled','deadline_exceeded'].includes(result.reason)){delete result.read_only_recovery;delete result.distinct_action_recovery;delete result.recovery;}
  }finally{
    clearTimeout(timer);if(onAbort)context.signal?.removeEventListener('abort',onAbort);controller.abort(invalid('The workflow has ended.','program_finished'));result.stats.duration_ms=Math.max(0,now()-started);
    // Values are transient execution evidence; callers must not persist them
    // as reusable procedure templates or include them in timing diagnostics.
    result.variables=Object.fromEntries(variables);
  }
  return result;
}
module.exports={PROGRAM_SCHEMA,normalizeTaskProgram,validateTaskProgram,executeTaskProgram,resolvePredicate,requireFrame};
