'use strict';
const {controlState}=require('./desktop-state');
const {errorResult}=require('./native-failure');
const key=w=>w&&`${w.pid}:${w.window_id}`;
const mutations=new Set(['computer_action','computer_action_sequence','computer_input','click_app_control','type_in_app']);
// Only controls whose action stays in this window qualify for short recovery.
// Unknown buttons, links, navigation and submissions keep delayed-popup polling.
const transitionLabel=/\b(?:call|send|submit|open|new|save|share|print|connect|messages?|inbox|profile|continue|next|back|login|sign\s*in|pay|purchase|delete|remove|close|appeler|envoyer|ouvrir|enregistrer|imprimer|supprimer|suivant|retour)\b/i;
const localButton=/^(?:bold|italic|underline|zoom in|zoom out|play|pause|mute|unmute|gras|italique|soulign[eé])$/i;
const calculatorButton=/^(?:[0-9]|zero|one|two|three|four|five|six|seven|eight|nine|z[eé]ro|un|deux|trois|quatre|cinq|sept|huit|neuf|decimal separator|decimal|s[eé]parateur d[eé]cimal|point|comma|virgule|add|plus|subtract|minus|moins|multiply(?: by)?|multiplier(?: par)?|fois|divide(?: by)?|diviser(?: par)?|divis[eé] par|equals|is equal to|est [eé]gal [àa]|[eé]gal(?:s)?|clear|clear entry|effacer|effacer l'entr[eé]e|backspace|percent|percentage|pourcentage|[+−\-×*/÷=.,%])$/i;
const unsafeProgressFlags=['degraded','truncated','accessibility_partial','snapshot_superseded','outcome_unknown','requires_review','recovery_required','input_suppressed','stop_task','refused','cancelled','canceled','interrupted','aborted'];
const unsafeProgressStatuses=new Set(['partial','error','refused','cancelled','canceled','interrupted','observation_failed','stale','stopped']);
const cleanProgress=state=>!!state&&!unsafeProgressStatuses.has(state.status)&&!unsafeProgressFlags.some(flag=>state[flag]);
const completeNative=state=>cleanProgress(state)&&!!state.window&&Array.isArray(state.controls)&&state.controls.length>0;
function inPlaceAction(name,args,source){
  if(name==='computer_action_sequence')return Array.isArray(args.actions)&&args.actions.length>0&&args.actions.every(step=>inPlaceAction('computer_action',step,source));
  const kind=args.kind||({type_in_app:'type',click_app_control:'click'}[name]);
  if(kind==='type')return true; // Text readback must still be verified below.
  if(kind!=='click')return false;
  const matches=source.controls?.filter(control=>String(control.control_id??control.id)===String(args.control_id)&&control.name===args.expected_name);
  if(matches?.length!==1||matches[0].enabled===false||matches[0].protected)return false;
  const control=matches[0],label=control.name.trim();
  if(transitionLabel.test(label))return false;
  if(/^(?:ControlType\.)?(?:CheckBox|RadioButton|Switch|Slider|SpinButton)$/i.test(control.type))return true;
  if(!/^(?:ControlType\.)?(?:Button|ToggleButton)$/i.test(control.type))return false;
  return localButton.test(label)||(/calculat(?:or|rice)/i.test(source.window?.title||'')&&calculatorButton.test(label));
}
function content(state){
  if(state?.controls?.length&&!state.degraded&&!state.truncated)return controlState(state);
  return state?.image||null;
}
function intent(name,args,source){
  const kind=args.kind||({click_app_control:'click',type_in_app:'type'}[name])||name;
  const action=kind==='double_click'?'click':kind;
  const label=String(args.expected_name||args.target_label||args.control_id||args.target_id||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
  return JSON.stringify([key(source.window),action,label,args.text??'',args.key??'',args.keys??[],args.actions?.map(a=>[a.kind,a.expected_name,a.text])??[]]);
}
class DesktopRecovery{
  constructor({computer,visual,legacySnapshot,scopeActive=()=>true,delay=ms=>new Promise(r=>setTimeout(r,ms))}){Object.assign(this,{computer,visual,legacySnapshot,scopeActive,delay});this.tasks=new Map();}
  source(args){
    const native=this.computer.snapshots.get(args.snapshot),state=native|| (this.visual.current?.id===args.snapshot?this.visual.current:null)||this.legacySnapshot?.(args.snapshot);
    const window=state?.window||(state?.target?.kind==='window'?state.target:null);
    return {snapshot:args.snapshot,window:window?{...window,window_id:window.window_id??window.handle}:undefined,controls:state?.controls,content:content(state),completeNative:completeNative(native)};
  }
  sameContent(a,b){if(!a||!b)return true;if(a===b)return true;const ai=a.startsWith('data:image'),bi=b.startsWith('data:image');if(ai!==bi)return true;if(ai)return this.visual.compareImages?.(a,b)?.meaningful!==true;return false;}
  async refresh(source,context){
    const result={};
    const check=()=>{context.signal?.throwIfAborted();context.assertActive?.();};check();
    try{const listed=await this.computer.listWindows({query:''});result.window_changes={open_windows:listed.windows,degraded:listed.degraded,truncated:listed.truncated};}catch(error){result.recovery_error=error.message;}check();
    if(source.window&&typeof this.computer.inspect==='function'){
      try{this.visual.clear();result.observation=await this.computer.inspect(source.window);}catch(error){result.recovery_error=error.message;}check();
    }
    return result;
  }
  async run(name,args,context,execute){
    if(!mutations.has(name)||['move','scroll'].includes(args.kind))return execute();
    for(const scope of this.tasks.keys())if(!this.scopeActive(scope))this.tasks.delete(scope);
    const scope=context.activityScope;let task=this.tasks.get(scope);
    if(!task){task={blocked:new Map()};this.tasks.set(scope,task);}
    const source=this.source(args),signature=intent(name,args,source),routeSignature=name+signature;
    // Match individual steps too: wrapping a blocked click in a sequence is
    // still a replay. Other controls in the same window remain usable.
    const signatures=[signature,routeSignature,...(args.actions||[]).flatMap(step=>{const id=intent('computer_action',step,source);return [id,'computer_action'+id];})];
    let blocked;
    for(const id of signatures){
      const prior=task.blocked.get(id);if(!prior)continue;
      if(prior.reason!=='uncertain'&&!this.sameContent(prior.content,source.content)){task.blocked.delete(id);continue;}
      blocked=prior;break;
    }
    if(blocked){
      const fresh=await this.refresh(source,context),stop=++blocked.suppressions>=3;
      return {...fresh,status:'refused',input_suppressed:true,...(stop?{stop_task:true}:{}),recovery_required:true,blocked_action:blocked.label,reason:blocked.reason,message:stop?`I could not verify the action on "${blocked.label}". Repeated attempts were blocked without sending more input.`:`No input was sent: "${blocked.label}" was already attempted${blocked.reason==='uncertain'?' and its outcome is unknown':' with no confirmed progress'}. Review the fresh observation and open windows, then continue with a different observed control or report the specific blocker. Do not repeat this action.`};
    }
    const check=()=>{context.signal?.throwIfAborted();context.assertActive?.();};check();
    let before;try{before=await this.computer.listWindows({query:''});}catch{}check();
    let output;try{output=await execute();}catch(error){output=errorResult(error);}check();
    const uncertain=output.outcome_unknown===true;
    const block=(id,reason,label=args.expected_name||args.target_label||args.kind||name)=>{const prior=task.blocked.get(id);if(prior?.reason==='uncertain')return;task.blocked.set(id,{reason,content:source.content,label:String(label).slice(0,200),suppressions:0});};
    if(uncertain){
      block(signature,'uncertain');
      // Sequence results identify the attempted prefix; untouched later steps
      // must not become blocked because an earlier step failed.
      for(const step of (args.actions||[]).slice(0,output.attempted??args.actions?.length))block(intent('computer_action',step,source),'uncertain',step.expected_name||step.kind);
    }
    const failed=['error','refused','interrupted','observation_failed'].includes(output.status);
    if(failed&&!uncertain&&output.action_attempted&&!['stale_capture','stale_element','stale_element_token'].includes(output.code))block(routeSignature,'refused_route');
    if(output.visual_change?.meaningful===false)block(signature,'unchanged');
    const observedContent=content(output.observation||output);
    if(!failed&&!output.verified&&args.kind==='click'&&source.content&&observedContent===source.content)block(signature,'unchanged');
    const fresh=output.observation;
    const localProgress=source.completeNative&&cleanProgress(output)&&
      fresh?.snapshot&&fresh.snapshot!==source.snapshot&&key(fresh.window)===key(source.window)&&
      completeNative(fresh)&&inPlaceAction(name,args,source)&&
      (output.verified===true||(args.kind!=='type'&&observedContent&&source.content&&!this.sameContent(source.content,observedContent)));
    // No replay. Read the window inventory after the one attempted operation.
    // New windows may appear asynchronously; only the reads are polled.
    let after,opened=[],changed=[];
    for(let attempt=0;attempt<3;attempt++){
      if(attempt)await this.delay(150);check();
      try{after=await this.computer.listWindows({query:''});}catch{break;}check();
      if(!before||before.degraded||before.truncated||after.degraded||after.truncated)break;
      const prior=new Map(before.windows.map(w=>[key(w),w]));
      opened=after.windows.filter(w=>!prior.has(key(w)));
      changed=after.windows.filter(w=>{const old=prior.get(key(w));return old&&(old.title!==w.title||old.minimized!==w.minimized||old.on_screen!==w.on_screen);});
      if(opened.length||changed.length||(!uncertain&&output.refused===true)||localProgress)break;
    }
    if(after)output={...output,window_changes:{opened,changed,...(uncertain||failed?{open_windows:after.windows}:{}),message:'These are existing window identities, including windows behind others. Focus or inspect the relevant window; do not replay the action. A new browser tab can appear inside an existing window: inspect its tab controls.'}};
    const related=[...opened,...changed].filter(w=>source.window&&key(w)!==key(source.window)&&(w.pid===source.window.pid||w.owner_window_id===source.window.window_id));
    if(related.length===1){
      try{
        check();this.visual.clear();
        const observation=await this.computer.focus(related[0],context);check();
        const {_images,...prior}=output;
        output={...prior,observation,recovered_window:true,message:'A related window opened or changed after the action. I brought that exact window forward and inspected it. Continue from this observation; do not click the original control again.'};
      }catch(error){check();output={...output,recovery_error:error.message};}
    }
    // A driver error can follow successful navigation. Inspect the source
    // window when the failed operation did not return usable fresh state.
    // This is a read, never an automatic retry of the input.
    const observed=output.observation||output;
    if(uncertain&&!output.recovered_window&&!observed.snapshot&&source.window){
      try{this.visual.clear();output={...output,observation:await this.computer.inspect(source.window)};check();}
      catch(error){check();output={...output,recovery_error:error.message};}
    }
    if(uncertain&&((output.observation||output).snapshot)){
      const state=output.observation||output;
      output={...output,recovery_required:true,recovery:{observed:true,state_changed:output.recovered_window===true||!this.sameContent(source.content,content(state)||this.source({snapshot:state.snapshot}).content)},message:(output.message?output.message+' ':'')+'Fresh state is available. Check whether navigation completed and continue with the next distinct observed control. The uncertain action itself remains blocked; do not replay it.'};
    }
    return output;
  }
}
module.exports={DesktopRecovery};
