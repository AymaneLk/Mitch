'use strict';

const {createTaskProgramHost}=require('./task-program-host');
const {executeTaskProgram,validateTaskProgram}=require('./task-program');
const {scopeSignature}=require('./procedure-memory');
const {optimizeWorkflow}=require('./workflow-optimize');
const MAX_EVIDENCE_BYTES=120000;
const READ_ONLY=new Set(['computer_list_windows','computer_inspect_window','browser_list_tabs','browser_read_page','list_apps']);
const INPUT=new Set(['open_app','computer_restore_window','computer_focus_window','computer_execute_plan','browser_execute_plan','browser_follow_link','browser_open_tab']);
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const refused=(code,message)=>Object.assign(Error(message),{code,refused:true,action_attempted:false});
const bytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
function bindsIn(program){const rows=[];const visit=steps=>{for(const node of steps){if(node.op==='bind')rows.push(node.target);if(node.op==='if'){visit(node.then);visit(node.else||[]);}}};visit(program.steps);return rows;}
function sameTarget(a,b){return !!a&&!!b&&Object.keys(a).sort().join('|')===Object.keys(b).sort().join('|')&&Object.keys(a).every(key=>a[key]===b[key]);}

// Evidence is for a semantic reviewer, never an executable snapshot cache.
// Protected values and binary images cannot leave this boundary. Large views
// retain explicit counts so a reviewer cannot mistake a partial proof for all
// controls or all operations.
function evidenceSanitizer(){
  const state={truncated:false,redacted:0};
  const visit=(value,key='',depth=0)=>{
    if(value===undefined||typeof value==='function')return undefined;
    if(value===null||typeof value==='boolean'||typeof value==='number')return value;
    if(typeof value==='string'){
      if(/^data:(?:image|audio|video)\//i.test(value)){state.redacted++;return '[binary omitted]';}
      let text=value;
      if(/^(?:url|href)$/i.test(key)){try{const url=new URL(value);if(['http:','https:'].includes(url.protocol)){url.username='';url.password='';url.search='';url.hash='';text=url.href;}}catch{}}
      const limit=['text','value'].includes(key)?2000:600;if(text.length>limit){state.truncated=true;return text.slice(0,limit)+' [truncated]';}return text;
    }
    if(depth>10){state.truncated=true;return {evidence_omitted:true};}
    if(Array.isArray(value)){
      const limit=key==='controls'?80:120;
      if(value.length>limit)state.truncated=true;
      return value.slice(0,limit).map(row=>visit(row,'',depth+1));
    }
    if(!plain(value))return undefined;
    const result={},protectedControl=value.protected===true||value.is_password===true||value.password===true||value.isPassword===true||/password|secure.?text/i.test(value.role||value.type||'')||/password|passcode|api.?key|access.?token|secret/i.test(value.name||value.target?.name||'');
    for(const [field,item]of Object.entries(value)){
      if(['_images','image','images','screenshot','data_url','image_url','audio_url','session_id','cookies','headers','authorization','apiKey','api_key','access_token','refresh_token','secret','password','variables'].includes(field)||(protectedControl&&['value','text','options'].includes(field))){state.redacted++;continue;}
      result[field]=visit(item,field,depth+1);
      if(Array.isArray(item)&&item.length>(field==='controls'?80:120)){result[field+'_total']=item.length;result[field+'_truncated']=true;}
    }
    if(result.controls_truncated){result.complete=false;result.context_truncated=true;}
    if(protectedControl)result.protected=true;
    return result;
  };
  return {visit,state};
}
function compactEvidence(result,events){
  const sanitizer=evidenceSanitizer(),output=sanitizer.visit(result);
  output.events=events.map((event,index)=>({index,...sanitizer.visit(event)}));
  output.evidence_truncated=sanitizer.state.truncated;output.evidence_redactions=sanitizer.state.redacted;
  output.event_count=events.length;output.event_placeholders=0;
  let outputBytes=bytes(output);
  if(outputBytes>MAX_EVIDENCE_BYTES){
    const ranked=output.events.map((event,index)=>({index,size:bytes(event)})).sort((a,b)=>b.size-a.size);
    for(const {index,size}of ranked){
      const event=output.events[index],source=event.output||{};
      output.events[index]={index,name:event.name,ms:event.ms,evidence_omitted:true,status:source.status,verified:source.verified,reason:source.reason||source.code,action_attempted:source.action_attempted,outcome_unknown:source.outcome_unknown,delivered_steps_count:source.delivered_steps?.length||source.delivered_steps_total||0};
      output.event_placeholders++;output.evidence_truncated=true;
      outputBytes-=size-bytes(output.events[index]);
      if(outputBytes<=MAX_EVIDENCE_BYTES-500)break;
    }
  }
  // Final assertions and delivery ledgers take priority over repetitive wait
  // observations. If even placeholders exceed the bound, retain their count.
  if(bytes(output)>MAX_EVIDENCE_BYTES&&output.events.length>40){
    const omitted=output.events.length-40;output.events=[...output.events.slice(0,20),{evidence_omitted:true,event_count:omitted,index_from:20,index_to:events.length-21},...output.events.slice(-20)];output.event_placeholders=events.length;output.evidence_truncated=true;
  }
  for(const key of ['observation','completion','steps','delivered_steps']){
    if(bytes(output)<=MAX_EVIDENCE_BYTES)break;
    if(key==='observation'&&output.observation?.controls){output.observation={...output.observation,controls:[],controls_total:output.observation.controls_total||output.observation.controls.length,controls_truncated:true,complete:false,context_truncated:true};}
    else if(Array.isArray(output[key]))output[key]=output[key].map((entry,index)=>({index,op:entry.op,status:entry.status,passed:entry.passed,evidence_omitted:true}));
    output.evidence_truncated=true;
  }
  // Defensive last bound for unforeseen provider metadata. Never silently
  // claim complete evidence when the provider returns an oversized envelope.
  if(bytes(output)>MAX_EVIDENCE_BYTES)return {status:output.status,verified:false,program_assertions_verified:false,reason:output.reason||'evidence_limit',outcome_unknown:output.outcome_unknown,recovery_required:output.recovery_required,action_attempted:output.action_attempted,evidence_truncated:true,event_count:events.length,event_placeholders:events.length,delivered_steps_count:result.delivered_steps?.length||0,timing:output.timing};
  return output;
}

/** Run one program through existing authoritative tools. Replay accepts only
 * one initial scope; its layout is checked from a NEW bind before ANY input,
 * including restore/launch/focus. Prefetched context is never replay authority.
 */
async function runGuardedTaskProgram({program,bindings={},dispatch,context={},initialContext,replay}={}){
  const started=performance.now(),events=[],calls=[];let allowed=!replay,replayBound=false,result,host,mergedPhases=0;
  const check=()=>{context.signal?.throwIfAborted();context.assertActive?.();if(context.isCancelled?.())throw refused('cancelled','The task was cancelled.');};
  const call=async(name,args,ctx)=>{
    check();if(replay&&!allowed&&!READ_ONLY.has(name))throw refused('replay_context_mismatch','The cached scope must be verified before any input.');
    const row={name,ms:0,input:INPUT.has(name),attempted:INPUT.has(name),pending:true};calls.push(row);const begin=performance.now();
    try{
      const output=await dispatch(name,args,ctx);row.attempted=row.input&&!(output?.action_attempted===false||output?.refused===true&&!output?.attempted&&!output?.delivered_steps?.length);return output;
    }catch(error){row.attempted=row.input&&error.refused!==true;throw error;}
    finally{row.ms=Math.round((performance.now()-begin)*100)/100;row.pending=false;}
  };
  try{
    check();program=validateTaskProgram(program,bindings);if(typeof dispatch!=='function')throw refused('invalid_host','A guarded dispatcher is required.');
    // Repaired procedures compare the original receipts, so record optimization
    // explicitly and keep replay programs unchanged.
    if(!replay){const optimized=optimizeWorkflow(program,bindings);program=optimized.program;mergedPhases=optimized.mergedPhases;}
    let expected;
    if(replay){
      const targets=bindsIn(program),signatures=replay.scopeSignatures;
      if(targets.length!==1||targets[0].open_if_missing||targets[0].url||!Array.isArray(signatures)||signatures.length!==1||!sameTarget(signatures[0].target,targets[0])||!/^[a-f0-9]{64}$/.test(signatures[0].signature||''))throw refused('replay_context_mismatch','This cached program needs cold planning in the current context.');
      expected=signatures[0];
    }
    host=createTaskProgramHost({dispatch:call,context,initialContext,onEvent:event=>{events.push(event);}});
    if(replay){
      const bind=host.bind;
      host.bind=async(target,ctx)=>{
        allowed=false;const frame=await bind(target,ctx);check();
        if(!sameTarget(target,expected.target)||scopeSignature(expected.target,frame)!==expected.signature)throw refused('replay_context_mismatch','The current interface differs from the verified cached procedure.');
        allowed=true;replayBound=true;return frame;
      };
    }
    result=await executeTaskProgram({program,bindings,host,context});
  }catch(error){result={status:'interrupted',verified:false,program_assertions_verified:false,reason:context.signal?.aborted?'cancelled':typeof error.code==='string'?error.code:'program_interrupted',message:String(error.message||error).slice(0,400),delivered_steps:[],steps:[],completion:[]};}
  const delivered=events.flatMap((event,event_index)=>Array.isArray(event.output?.delivered_steps)?event.output.delivered_steps.map(step=>({...step,event_index})):[]);
  const attempted=calls.some(call=>call.attempted);
  result={...result,action_attempted:attempted,...(delivered.length?{delivered_steps:delivered}:{}),replay_requested:!!replay,replay_context_verified:replayBound,timing:{total_ms:Math.round((performance.now()-started)*100)/100,tool_ms:Math.round(calls.reduce((total,row)=>total+row.ms,0)*100)/100,tool_calls:calls.length,input_calls:calls.filter(row=>row.attempted).length,pending_tool_calls:calls.filter(row=>row.pending).length,nested:calls.map(({name,ms,input,attempted,pending})=>({name,ms,input,attempted,pending}))}};
  if(context.signal?.aborted&&typeof result.reason!=='string')result.reason='cancelled';
  if(replay&&!attempted&&!replayBound&&!['cancelled','invalid_program'].includes(result.reason))result.reason='replay_context_mismatch';
  if(!attempted&&result.reason==='replay_context_mismatch'){delete result.outcome_unknown;delete result.recovery_required;result.cold_plan_required=true;}
  if(attempted&&result.status!=='completed'&&!result.outcome_unknown)result.recovery_required=true;
  return compactEvidence({...result,merged_phases:mergedPhases},events);
}
module.exports={runGuardedTaskProgram,compactEvidence,MAX_EVIDENCE_BYTES};
