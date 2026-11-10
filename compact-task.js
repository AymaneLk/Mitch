'use strict';
// This is a data compiler, not an evaluator. Every result is subsequently
// validated by the existing task-program and action-plan schemas before input.
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
const invalid=message=>Object.assign(Error(message),{code:'invalid_program',refused:true});
const keys=(x,allowed)=>{if(!plain(x)||Object.keys(x).some(k=>!allowed.includes(k)))throw invalid('Unknown compact workflow field.');};
function target(value){if(typeof value==='string')return {name:value};if(plain(value))return structuredClone(value);throw invalid('A control needs an observed name or symbolic selector.');}
function tuple(value,min,max=min){if(!Array.isArray(value)||value.length<min||value.length>max)throw invalid('Invalid compact workflow tuple.');return value;}
function predicate(value){
 const [condition,control,expected]=tuple(value,2,3);
 if(!['exists','absent','value','checked','selected'].includes(condition))throw invalid('Unknown condition.');
 return {target:target(control),condition,...(expected!==undefined?{value:typeof expected==='boolean'?String(expected):expected}:{})};
}
function predicates(values){if(!Array.isArray(values)||values.length<1||values.length>4)throw invalid('A phase requires one to four observable checks.');return values.map(predicate);}
function primitive(value){
 const [op,control,argument]=tuple(value,2,3),result={op,target:target(control)};
 if(op==='fill'){if(value.length!==3)throw invalid('Fill requires literal text or a read variable.');result.text=argument;}
 else if(op==='press'){if(value.length!==3)throw invalid('Press requires a supported navigation key.');result.key=argument;}
 else if(op==='select'){if(value.length===3)result.value=argument;}
 else if(op!=='click'||value.length!==2)throw invalid('Unsupported compact action.');
 return result;
}
function binding(value){
 if(typeof value==='string')return {kind:'native',app:value};
 keys(value,['app','host','browser','title','open_if_missing','url','frame_id']);
 if(value.app!==undefined){keys(value,['app','open_if_missing']);return {kind:'native',app:value.app,...(value.open_if_missing!==undefined?{open_if_missing:value.open_if_missing}:{})};}
 const {host,...rest}=value;return {kind:'browser',hostname:host,...rest};
}
function materializeCompactScopes(program,context){
 if(program?.version!==2)return program;
 const copy=structuredClone(program);
 const visit=(steps,depth=0)=>{if(!Array.isArray(steps)||depth>3)throw invalid('Invalid compact scope structure.');for(const step of steps){
  if(typeof step?.in==='number'){
   const scope=Number.isSafeInteger(step.in)&&step.in>=0?context?.scopes?.[step.in]:null;
   if(!scope?.target)throw invalid('Choose an existing prepared scope index.');
   const {kind,hostname,...target}=scope.target;
   if(kind==='native')step.in={app:target.app};else if(kind==='browser')step.in={host:hostname,...target};else throw invalid('Unsupported prepared scope.');
  }
  if(step?.then!==undefined)visit(step.then,depth+1);if(step?.else!==undefined)visit(step.else,depth+1);
 }};visit(copy.steps);return copy;
}
function compileCompactTask(program){
 keys(program,['version','steps','completion']);if(program.version!==2)throw invalid('Unsupported compact workflow version.');let nodes=0;
 const visit=(steps,depth=0)=>{
  if(!Array.isArray(steps)||(!steps.length&&depth===0)||steps.length>32||depth>3)throw invalid('Compact workflow exceeds its structural limits.');
  return steps.flatMap(step=>{
   if(++nodes>48)throw invalid('Too many compact workflow nodes.');
   if(!plain(step))throw invalid('Each compact step must be an object.');
   if(Object.hasOwn(step,'in')){keys(step,['in']);return [{op:'bind',target:binding(step.in)}];}
   if(Object.hasOwn(step,'do')){keys(step,['do','expect']);if(!Array.isArray(step.do)||!step.do.length||step.do.length>12)throw invalid('A phase needs one to twelve actions.');return [{op:'act',steps:step.do.map(primitive),completion:predicates(step.expect)}];}
   if(Object.hasOwn(step,'read')){keys(step,['read']);const [control,as,attribute='value']=tuple(step.read,2,3);return [{op:'read',target:target(control),as,attribute}];}
   if(Object.hasOwn(step,'ensure')){
    keys(step,['ensure']);const [condition,control,value]=tuple(step.ensure,3);
    if(!['checked','selected'].includes(condition)||typeof value!=='boolean')throw invalid('Ensure requires an explicit checked/selected Boolean state.');
    const desired=predicate([condition,control,value]);
    // Unknown state is not equivalent to false. Only a proved opposite state
    // authorizes one click; otherwise assert the desired state without input.
    return [{op:'if',condition:predicate([condition,control,!value]),then:[{op:'act',steps:[{op:'click',target:target(control)}],completion:[desired]}],else:[{op:'assert',condition:desired}]}];
   }
   if(Object.hasOwn(step,'when')){keys(step,['when','then','else']);return [{op:'if',condition:predicate(step.when),then:visit(step.then,depth+1),...(step.else!==undefined?{else:visit(step.else,depth+1)}:{})}];}
   if(Object.hasOwn(step,'expect')){keys(step,['expect']);return predicates(step.expect).map(condition=>({op:'assert',condition}));}
   if(Object.hasOwn(step,'wait')){keys(step,['wait','timeout_ms']);return [{op:'wait',condition:predicate(step.wait),...(step.timeout_ms!==undefined?{timeout_ms:step.timeout_ms}:{})}];}
   if(Object.hasOwn(step,'switch')){keys(step,['switch']);return [{op:'transition',target:step.switch}];}
   if(Object.hasOwn(step,'follow')){keys(step,['follow','expect']);return [{op:'follow_link',target:target(step.follow),completion:predicates(step.expect)}];}
   throw invalid('Unsupported compact workflow step.');
  });
 };
 const steps=visit(program.steps);let completion;
 if(program.completion!==undefined)completion=predicates(program.completion);
 else if(steps.at(-1)?.op==='act'||steps.at(-1)?.op==='follow_link')completion=structuredClone(steps.at(-1).completion);
 else if(steps.at(-1)?.op==='assert'){
  const trailing=[];for(let i=steps.length-1;i>=0&&steps[i].op==='assert';i--)trailing.unshift(steps[i].condition);completion=trailing;
 }else if(program.steps.at(-1)?.ensure)completion=[predicate(program.steps.at(-1).ensure)];
 else throw invalid('Finish with an action phase or explicit checks proving the final outcome.');
 return {version:1,steps,completion};
}
const compactDescription=`Run a bounded local task program. Prefer version 2 tuples to reduce planning latency. No executable code. Use {"in":0} to bind prepared scope index 0 (or another supplied index), avoiding copying long window titles. Steps:
{"in":"exact native app/window name"} or {"in":{"host":"example.com","browser":"opera"}} binds fresh controls; frame_id selects an observed embedded frame (0 for outer page); open_if_missing and an explicit same-host url are optional for browser bindings.
{"do":[["fill",target,text],["click",target],["select",target,optionValue],["press",target,key]],"expect":[["value",target,text],["exists",target]]} runs 1–12 actions and 1–4 checks. A target is an observed name string or {name,role,match,within:{name,role}}; use role or an observed named ancestor to disambiguate repeated controls. select without optionValue selects an observed native option/tab. Keys: Enter, Tab, Escape, ArrowDown/Up/Left/Right.
{"ensure":["checked",target,true]} or selected sets a known Boolean state without toggling it twice. {"read":[target,"variable","value"]} reads current data; substitute {ref:"variable"} later. {"when":["exists",target],"then":[steps],"else":[steps]} branches locally. {"expect":[checks]} verifies without input; {"wait":["exists",target],"timeout_ms":2000} waits on state. Check kinds: exists, absent, value, checked, selected. Boolean checks use true/false. {"follow":target,"expect":[checks]} follows an observed same-origin browser link. {"switch":{"kind":"same_tab"}} or {"switch":{"kind":"related_window","title":"exact observed title"}} refreshes a predictable transition. Final completion is inherited from the last phase/checks; optional root completion is an array of checks. Prove the user's requested result, not merely input delivery. Never replay uncertain input.`;
const COMPACT_SCHEMA={type:'object',properties:{version:{type:'integer',enum:[2]},steps:{type:'array',minItems:1,maxItems:32,items:{type:'object',additionalProperties:true}},completion:{type:'array',minItems:1,maxItems:4,items:{type:'array',minItems:2,maxItems:3}}},required:['version','steps'],additionalProperties:false};
function compactWorkflowTools(tools){return tools.map(t=>t.name==='computer_run_workflow'?{...t,description:compactDescription,parameters:COMPACT_SCHEMA}:t);}
module.exports={compileCompactTask,materializeCompactScopes,compactWorkflowTools,COMPACT_SCHEMA};
