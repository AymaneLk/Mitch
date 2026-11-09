'use strict';

// Procedures contain symbolic selectors and bounded task-program data only.
// The caller owns encrypted persistence and must independently approve the
// whole user request before remembering a successfully verified program.
const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {validatePlan,normalizeRole,matchControls,testCondition}=require('./action-plan');
const {validateTaskProgram}=require('./task-program');
const TTL=30*24*60*60*1000,MAX_ENTRIES=32,MAX_BYTES=120000;
const hash=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const normalize=value=>String(value??'').normalize('NFKC').trim().toLowerCase();
const sensitive=/\b(?:send|sent|call|dial|delete|remove|erase|trash|empty|pay|payment|purchase|buy|order|checkout|publish|post|install|uninstall|submit|password|passcode|credential|token|secret|security|permission|share|invite|transfer|bank|card|credit|debit|account|logout|save|saved|upload|download|export|import|unsubscribe|subscribe|confirm|approve|accept|reset|cancel|execute|run|terminal|command|powershell|script|registry|vpn|antivirus|defender|supprimer|envoyer|appeler|payer|acheter|publier|installer|securite)\b|\b(?:log out|sign out|mot de passe)\b/i;
const unsafeText=text=>typeof text!=='string'||text.length>16000||sensitive.test(text.normalize('NFKD').replace(/[\u0300-\u036f]/g,''));
// Replays currently return only a verified UI-outcome acknowledgement. They
// cannot reproduce fresh factual answers, calculations, summaries or readback.
const readback=/\?|\b(?:tell|explain|summari[sz]e|describe|report|answer|read|extract|calculate|count|compare|result|results|information|info|what|why|say)\b|\b(?:give me|let me know|how many|how much)\b/i;
const safeRequest=text=>typeof text==='string'&&text.trim().length>0&&!unsafeText(text)&&!readback.test(text);
const parameterName=index=>'mitchParam'+index;
const clone=value=>JSON.parse(JSON.stringify(value));
function boundedClone(value){const encoded=JSON.stringify(value);if(!encoded||encoded.length>MAX_BYTES)throw Error('Procedure data exceeds its bound.');return JSON.parse(encoded);}
function scopeKey(target){
  if(target?.kind==='native'&&typeof target.app==='string')return {kind:'native',app:normalize(target.app)};
  if(target?.kind==='browser'&&typeof target.hostname==='string')return {kind:'browser',hostname:target.hostname,...(target.browser?{browser:target.browser}:{}),...(target.title?{title:target.title}:{})};
  return null;
}
function bindTargets(program){
  const result=[];
  const visit=steps=>{for(const step of steps){if(step.op==='bind'){if(!result.some(target=>same(target,step.target)))result.push(step.target);}if(step.op==='if'){visit(step.then);visit(step.else||[]);}}};
  visit(program.steps);return result;
}
function bindCount(program){let count=0;const visit=steps=>{for(const step of steps){if(step.op==='bind')count++;if(step.op==='if'){visit(step.then);visit(step.else||[]);}}};visit(program.steps);return count;}
function matchingScope(wanted,scope){
  const expected=scopeKey(wanted),actual=scopeKey(scope?.target);
  if(!expected||!actual||expected.kind!==actual.kind)return false;
  if(expected.kind==='native')return expected.app===actual.app;
  return expected.hostname===actual.hostname&&(!expected.browser||expected.browser===(actual.browser||scope.observation?.browser))&&(!expected.title||expected.title===(actual.title||scope.observation?.title));
}
function scopeSignature(target,frame){
    if(!scopeKey(target))return null;
    if(!plain(frame)||frame.complete!==true||frame.degraded||frame.truncated||frame.accessibility_partial||frame.context_truncated||!Array.isArray(frame.controls)||!frame.controls.length||frame.controls.length>300)return null;
    const controls=[];
    for(const control of frame.controls){
      if(!plain(control)||typeof control.name!=='string'||control.name.length>1000||typeof (control.role||control.type)!=='string'||control.protected||control.is_password||control.password||control.isPassword||/password|secure.?text/i.test(control.role||control.type))return null;
      if(control.value!==undefined&&(typeof control.value!=='string'||control.value.length>12000))return null;
      if(['enabled','editable','checked','selected'].some(key=>control[key]!==undefined&&typeof control[key]!=='boolean')||control.href!==undefined&&(typeof control.href!=='string'||control.href.length>8000))return null;
      controls.push([control.name,normalize(control.role||control.type),control.enabled!==false,control.editable===true,control.checked??null,control.selected??null,control.value===undefined?null:hash(control.value),control.href===undefined?null:hash(String(control.href))]);
    }
    let page;
    if(target.kind==='browser'){
      if(target.browser&&frame.browser!==target.browser)return null;
      try{const url=new URL(frame.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hostname!==target.hostname)return null;page={browser:frame.browser||target.browser||'',urlHash:hash(url.href)};}catch{return null;}
    }
    return hash(JSON.stringify({scope:scopeKey(target),...(page?{page}:{windowTitle:hash(String(frame.window?.title||''))}),controls}));
}
function scopeSignatures(context,program){
  if(!plain(context)||!Array.isArray(context.scopes)||!context.scopes.length||context.scopes.length>8)return null;
  const result=[];
  for(const target of bindTargets(program)){
    const matches=context.scopes.filter(scope=>matchingScope(target,scope));
    if(matches.length!==1)return null;
    const signature=scopeSignature(target,matches[0].observation);if(!signature)return null;
    result.push({target:clone(target),signature});
  }
  return result.length?result:null;
}
const initialSignature=(context,program)=>{const scopes=scopeSignatures(context,program);return scopes?hash(JSON.stringify(scopes)):null;};
function parametersIn(text){
  if(typeof text!=='string'||/[\r\n]/.test(text))return null;
  const expressions=[...text.matchAll(/"([^"\\\r\n]{1,300})"/g)];
  if(!expressions.length||expressions.length>4||expressions.length*2!==(text.match(/"/g)||[]).length)return null;
  if(new Set(expressions.map(match=>match[1])).size!==expressions.length)return null;
  const parts=[],values=[];let offset=0;
  for(const match of expressions){parts.push(text.slice(offset,match.index+1));values.push(match[1]);offset=match.index+match[0].length-1;}
  parts.push(text.slice(offset));return {parts,values};
}
function walkProgram(program,visit){
  const walk=(value,path=[])=>{
    if(Array.isArray(value))return value.map((item,index)=>walk(item,[...path,index]));
    if(plain(value))return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,walk(item,[...path,key])]));
    return visit(value,path);
  };
  return walk(program);
}
function parameterizablePath(path){
  const field=path.at(-1);
  // bind/transition targets are explicitly excluded by their field names;
  // only ordinary selector names and primitive/predicate values can vary.
  return field==='text'||field==='value'||field==='name'&&path.at(-2)==='target';
}
function parameterize(text,program,context){
  const quoted=parametersIn(text);if(!quoted)return null;
  // One successful run cannot prove that a word shared by the argument and a
  // fixed UI control is a parameter. Keep such coincidences exact-only.
  const dynamicRoles=new Set(['option','row','link','listitem','treeitem','menuitem','tab','tabitem']);
  const fixedNames=new Set(context.scopes.flatMap(scope=>scope.observation?.controls||[]).filter(control=>!dynamicRoles.has(normalize(control.role||control.type))).map(control=>normalize(control.name)));
  if(quoted.values.some(value=>['true','false'].includes(normalize(value))||fixedNames.has(normalize(value))))return null;
  const seen=new Set();let invalid=false;
  const parameterized=walkProgram(program,(value,path)=>{
    if(typeof value!=='string')return value;
    for(let index=0;index<quoted.values.length;index++){
      const parameter=quoted.values[index];
      if(value===parameter){
        if(!parameterizablePath(path)){invalid=true;return value;}
        seen.add(index);return {ref:parameterName(index)};
      }
      // Never leave a quoted argument embedded in a stale literal selector,
      // text or app name while replacing the other occurrences.
      if(normalize(value).includes(normalize(parameter)))invalid=true;
    }
    return value;
  });
  if(invalid||seen.size!==quoted.values.length)return null;
  const definitions=[];
  walkProgram(program,(value,path)=>{if(path.at(-1)==='as')definitions.push(value);return value;});
  if(definitions.some(value=>/^mitchParam[0-9]+$/.test(value)))return null;
  return {program:parameterized,matcher:{kind:'quoted',parts:quoted.parts},bindings:Object.fromEntries(quoted.values.map((value,index)=>[parameterName(index),value]))};
}
function cacheable(program,bindings={}){
  try{program=validateTaskProgram(program,bindings);}catch{return false;}
  let safe=true;const referenced=new Set();
  const fieldValue=value=>plain(value)&&Object.hasOwn(value,'ref')?bindings[value.ref]:value;
  walkProgram(program,(value,path)=>{
    if(path.at(-1)==='ref')referenced.add(value);
    if(path.at(-1)==='as'&&Object.hasOwn(bindings,value))safe=false;
    if(typeof value==='string'&&!['ref','as','op','kind','condition','match','attribute'].includes(path.at(-1))&&unsafeText(value))safe=false;
    return value;
  });
  if(Object.keys(bindings).some(key=>!referenced.has(key)))safe=false;
  const visit=steps=>{
    for(const step of steps){
      if(step.op==='bind'&&(step.target.open_if_missing||step.target.url))safe=false;
      if(step.op==='if'){visit(step.then);visit(step.else||[]);}
      if(step.op==='act')for(const action of step.steps){
        const name=fieldValue(action.target.name),role=normalize(action.target.role||'');
        if(typeof name!=='string'||unsafeText(name)||(action.target.match&&action.target.match!=='exact')){safe=false;continue;}
        if(action.op==='press'&&action.key==='Enter')safe=false;
        if(action.op==='click'&&!['link','tab','tabitem','menuitem','option','listitem','treeitem','row','checkbox','radiobutton'].includes(role)&&!/^(?:search|find|next|previous|back|home|profile|messages|inbox|settings|repositories|your repositories|notifications|open|view|details|edit|show|filter|sort|refresh)(?:\s|$)/i.test(name))safe=false;
      }
      if(step.op==='follow_link'){
        const name=fieldValue(step.target.name);if(typeof name!=='string'||unsafeText(name)||step.target.match&&step.target.match!=='exact')safe=false;
      }
    }
  };
  visit(program.steps);return safe;
}
// Only a whole-request semantic review can authorize this repair. It changes
// stale completion predictions, never actions, branches, bindings or delivery
// evidence. All future reuse still passes the ordinary memory/replay gates.
function repairVerifiedProcedure(program,output,{approved=false}={}){
  try{
    if(approved!==true||!plain(output)||output.status!=='interrupted'||output.reason!=='completion_unmet'||output.verified!==false||output.outcome_unknown||output.uncertain||output.cancelled||output.canceled||output.stop_task||output.evidence_truncated||output.event_placeholders)return null;
    const copy=boundedClone(validateTaskProgram(program));
    if(!cacheable(copy)||copy.steps.length<2||copy.steps[0].op!=='bind'||copy.steps.slice(1).some(step=>step.op!=='act'))return null;
    const scope=copy.steps[0].target,frame=output.observation,phases=copy.steps.slice(1),records=output.steps;
    if(!plain(frame)||typeof frame.snapshot!=='string'||!frame.snapshot||frame.snapshot_superseded||frame.selector||frame.controls_truncated||frame.controls?.length>8||!scopeSignature(scope,frame))return null;
    if(!Array.isArray(records)||records.length!==copy.steps.length||records.some((record,index)=>record.index!==String(index)||record.op!==copy.steps[index].op||(index<records.length-1?record.status!=='completed':!['completed','interrupted'].includes(record.status))))return null;
    const sameScope=other=>{
      if(!plain(other)||other.snapshot_superseded||other.selector||!scopeSignature(scope,other))return false;
      if(scope.kind==='native')return Number.isSafeInteger(frame.window?.pid)&&frame.window.pid>0&&Number.isSafeInteger(frame.window?.window_id)&&frame.window.window_id>0&&other.window?.pid===frame.window.pid&&other.window?.window_id===frame.window.window_id;
      return frame.source==='browser_dom'&&other.source==='browser_dom'&&Number.isSafeInteger(frame.tab_id)&&frame.tab_id===other.tab_id&&Number.isSafeInteger(frame.window_id)&&frame.window_id===other.window_id&&typeof frame.document_id==='string'&&frame.document_id===other.document_id&&frame.url===other.url&&frame.browser===other.browser;
    };
    if(!sameScope(frame)||!Array.isArray(output.events)||!output.events.length||output.events.length>100||output.event_count!==undefined&&output.event_count!==output.events.length)return null;
    const tool=scope.kind==='native'?'computer_execute_plan':'browser_execute_plan';
    const allowed=new Set(scope.kind==='native'?['computer_list_windows','computer_inspect_window',tool]:['browser_list_tabs','browser_read_page',tool]);
    const actions=[];
    for(const event of output.events){
      const result=event.output;
      if(!allowed.has(event.name)||event.evidence_omitted||!plain(result)||result.outcome_unknown||result.uncertain||result.cancelled||result.canceled||result.stop_task||result.evidence_truncated||result.input_suppressed||result.refused||['error','refused','cancelled','canceled','observation_failed'].includes(result.status))return null;
      const observed=result.observation||(result.snapshot?result:null);if(observed&&!sameScope(observed))return null;
      if(event.name===tool)actions.push(event);
    }
    if(actions.length!==phases.length)return null;
    for(let index=0;index<phases.length;index++){
      const phase=phases[index],event=actions[index],result=event.output,final=index===phases.length-1;
      const expected=validatePlan({steps:phase.steps,completion:phase.completion}),actual=validatePlan({steps:event.args?.steps,completion:event.args?.completion});
      if(!isDeepStrictEqual(expected,actual)||result.completed!==expected.steps.length||!Array.isArray(result.steps)||result.steps.length!==expected.steps.length)return null;
      if(final){
        if(result.status==='interrupted'){
          if(result.reason!=='completion_unmet'||result.verified!==false||records.at(-1).status!=='interrupted'||!Array.isArray(result.completion)||!result.completion.some(proof=>proof.passed===false))return null;
        }else if(result.status!=='completed'||result.verified!==true||records.at(-1).status!=='completed'||!output.completion?.some(proof=>proof.passed===false))return null;
      }else if(result.status!=='completed'||result.verified!==true)return null;
      for(let actionIndex=0;actionIndex<expected.steps.length;actionIndex++){
        const action=expected.steps[actionIndex],receipt=result.steps[actionIndex];
        if(receipt.index!==actionIndex||receipt.op!==action.op||!isDeepStrictEqual(validatePlan({steps:[{op:'assert',target:receipt.target}],completion:[{target:receipt.target,condition:'exists'}]}).steps[0].target,action.target))return null;
        if(['wait','assert'].includes(action.op)){if(receipt.status!=='passed'||receipt.verified!==true)return null;}
        else if(!['delivered','completed'].includes(receipt.status)||receipt.verified!==true&&receipt.known_delivery!==true)return null;
      }
    }
    const last=actions.at(-1).output.observation;
    if(!sameScope(last)||scopeSignature(scope,last)!==scopeSignature(scope,frame))return null;
    const completion=[];
    for(const control of frame.controls){
      const role=normalizeRole(control.role||control.type),name=control.name;
      if(typeof name!=='string'||!name.trim()||name.length>300||!role||role.length>60||control.visible===false||control.offscreen===true)return null;
      const target={name,role,match:'exact'};
      if(matchControls(frame.controls,target).length!==1)return null;
      completion.push({target,condition:'exists'});
      if(control.value!==undefined)completion.push({target,condition:'value',value:control.value});
      for(const key of ['checked','selected'])if(typeof control[key]==='boolean')completion.push({target,condition:key,value:String(control[key])});
    }
    if(!completion.length||completion.length>8||completion.some(condition=>!testCondition(frame,condition)))return null;
    // Individual action phases accept four checks; the final program gate
    // independently verifies ALL observed controls/state (up to eight checks).
    copy.steps.at(-1).completion=clone(completion.slice(0,4));copy.completion=clone(completion);
    return cacheable(copy)?boundedClone(validateTaskProgram(copy)):null;
  }catch{return null;}
}
function matcherBindings(matcher,text){
  if(matcher.kind==='exact')return matcher.hash===hash(text)?{}:null;
  const quoted=parametersIn(text);
  return quoted&&same(quoted.parts,matcher.parts)?Object.fromEntries(quoted.values.map((value,index)=>[parameterName(index),value])):null;
}
function matcherValid(matcher){
  if(!plain(matcher))return false;
  if(matcher.kind==='exact')return Object.keys(matcher).sort().join(',')==='hash,kind'&&/^[a-f0-9]{64}$/.test(matcher.hash);
  return matcher.kind==='quoted'&&Object.keys(matcher).sort().join(',')==='kind,parts'&&Array.isArray(matcher.parts)&&matcher.parts.length>=2&&matcher.parts.length<=5&&matcher.parts.every(part=>typeof part==='string'&&part.length<=16000&&!unsafeText(part))&&matcher.parts.reduce((sum,part)=>sum+part.length,0)<=16000;
}
class ProcedureMemory {
  constructor({now=Date.now,onChange=()=>{}}={}){this.now=now;this.onChange=onChange;this.rows=[];}
  changed(){try{Promise.resolve(this.onChange(clone(this.rows))).catch(()=>{});}catch{}}
  prune(){const now=this.now(),before=this.rows.length;this.rows=this.rows.filter(row=>row.createdAt<=now&&now-row.createdAt<TTL).slice(-MAX_ENTRIES);if(before!==this.rows.length)this.changed();}
  get(text,preparedContext){
    if(!safeRequest(text))return null;this.prune();const request=text.trim();
    for(let index=this.rows.length-1;index>=0;index--){
      const row=this.rows[index],bindings=matcherBindings(row.matcher,request);if(!bindings)continue;
      const signatures=scopeSignatures(preparedContext,row.program);
      if(Object.values(bindings).some(unsafeText)||!cacheable(row.program,bindings)||!signatures||signatures.length!==1||bindCount(row.program)!==1||hash(JSON.stringify(signatures))!==row.signature)continue;
      // LRU is in-memory; do not force disk encryption onto every hot path.
      this.rows.splice(index,1);this.rows.push(row);
      return {program:clone(row.program),bindings:clone(bindings),scopeSignatures:signatures};
    }
    return null;
  }
  remember(text,preparedContext,program,{approved=false}={}){
    if(approved!==true||!safeRequest(text)||!cacheable(program))return false;
    let copy;try{copy=boundedClone(validateTaskProgram(program));}catch{return false;}
    const signature=initialSignature(preparedContext,copy);if(!signature)return false;
    const request=text.trim(),generalized=parameterize(request,copy,preparedContext);
    const selected=generalized&&cacheable(generalized.program,generalized.bindings)?generalized:{program:copy,matcher:{kind:'exact',hash:hash(request)}};
    try{boundedClone(selected);}catch{return false;}
    this.prune();this.rows=this.rows.filter(row=>row.signature!==signature||!same(row.matcher,selected.matcher));
    this.rows.push({version:1,createdAt:this.now(),signature,matcher:selected.matcher,program:selected.program});
    if(this.rows.length>MAX_ENTRIES)this.rows.shift();this.changed();return true;
  }
  export(){this.prune();return clone(this.rows);}
  import(rows){
    const now=this.now(),accepted=[];
    if(!Array.isArray(rows)||rows.length>MAX_ENTRIES){this.rows=[];return 0;}
    for(const candidate of rows){
      try{
        const row=boundedClone(candidate);
        if(!plain(row)||Object.keys(row).sort().join(',')!=='createdAt,matcher,program,signature,version'||row.version!==1||!Number.isFinite(row.createdAt)||row.createdAt>now||now-row.createdAt>=TTL||!/^[a-f0-9]{64}$/.test(row.signature)||!matcherValid(row.matcher))continue;
        const bindings=row.matcher.kind==='quoted'?Object.fromEntries(row.matcher.parts.slice(1).map((_part,index)=>[parameterName(index),'memory parameter'])):{};
        row.program=validateTaskProgram(row.program,bindings);
        if(!cacheable(row.program,bindings))continue;
        if(accepted.some(existing=>existing.signature===row.signature&&same(existing.matcher,row.matcher)))continue;
        accepted.push(row);
      }catch{}
    }
    this.rows=accepted;return accepted.length;
  }
  clear(){if(this.rows.length){this.rows=[];this.changed();}}
  get size(){this.prune();return this.rows.length;}
}
module.exports={ProcedureMemory,scopeSignature,repairVerifiedProcedure};
