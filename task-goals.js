'use strict';
// These contracts are parsed from the ENTIRE user request, independently of
// model-supplied completion assertions. Unknown wording keeps semantic review.
const {matchControls,normalizeRole}=require('./action-plan');
const {windowMatches}=require('./task-program-host');
const blocked=value=>!value||value.outcome_unknown||value.stop_task||value.recovery_required||value.input_suppressed||value.evidence_truncated||value.event_placeholders||value.refused||value.cancelled||value.canceled;
const protectedName=/password|passcode|secret|token|credential|credit.?card/i;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
function parseTaskGoal(text){
  if(typeof text!=='string'||text.length>2000||/[\r\n]/.test(text))return null;
  const source=text.trim().replace(/^(?:please |can you |could you )/i,'').replace(/[.!]$/,'');
  // Scope and selector text are quoted to avoid treating a trailing instruction
  // as part of an app name. No "and save/send/call" suffix is accepted.
  const match=/^(?:in|on) "([^"\r\n]{1,120})",? (?:set|fill|replace) "([^"\r\n]{1,160})" (?:to|with) "([^"\r\n]{0,1000})"$/i.exec(source);
  if(match&&!protectedName.test(match[2]))return {kind:'field',app:match[1],name:match[2],value:match[3]};
  const nav=/^(?:open "([^"\r\n]{1,120})" and |(?:in|on) "([^"\r\n]{1,120})",? )(?:go to|open|show) "([^"\r\n]{1,160})"$/i.exec(source);
  if(nav&&!protectedName.test(nav[3]))return {kind:'navigation',app:nav[1]||nav[2],name:nav[3]};
  const ordinary=/^open ([a-z0-9 ._-]{1,120}) and (?:go to|open|show) (?:the )?(settings|messages|inbox|notifications|downloads|home)$/i.exec(source);
  if(ordinary&&!/\b(?:and|then)\b/i.test(ordinary[1]))return {kind:'navigation',app:ordinary[1],name:ordinary[2]};
  const field=/^(?:in|on) ([a-z0-9 ._-]{1,120}), (?:set|fill|replace) "([^"\r\n]{1,160})" (?:to|with) "([^"\r\n]{0,1000})"$/i.exec(source);
  if(field&&!protectedName.test(field[2])&&!/\b(?:and|then)\b/i.test(field[1]))return {kind:'field',app:field[1],name:field[2],value:field[3]};
  return null;
}
function scopeMatches(goal,frame){
  if(frame.source==='browser_dom'){
    try{const url=new URL(frame.url);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&url.hostname===goal.app.toLowerCase();}catch{return false;}
  }
  return windowMatches(goal.app,frame.window||{});
}
function verifyTaskGoal(text,events){
  const goal=parseTaskGoal(text);if(!goal||!Array.isArray(events)||!events.length)return null;
  const event=events.at(-1),output=event.output;
  if(!['computer_run_workflow','computer_execute_plan','browser_execute_plan'].includes(event.name)||blocked(output)||output.status!=='completed'||output.verified!==true)return null;
  const frame=output.observation;
  if(!plain(frame)||typeof frame.snapshot!=='string'||frame.complete!==true||frame.degraded||frame.truncated||frame.context_truncated||frame.snapshot_superseded||!Array.isArray(frame.controls)||!scopeMatches(goal,frame))return null;
  const matches=matchControls(frame.controls,{name:goal.name,match:'exact'});
  if(matches.length!==1||matches[0].protected||matches[0].enabled===false)return null;
  const control=matches[0],role=normalizeRole(control.role||control.type);
  const passed=goal.kind==='field'?control.editable===true&&typeof control.value==='string'&&control.value===goal.value:role==='heading'||['tab','option','treeitem'].includes(role)&&control.selected===true;
  if(!passed)return null;
  return {decision:'complete',reason:'Every outcome in the recognized request is proven by the fresh scoped state.',answer:goal.kind==='field'?`Set ${goal.name} to the requested text.`:`Opened ${goal.name}.`,contract:goal.kind};
}
function goalHint(text){const goal=parseTaskGoal(text);return goal?'\nA trusted whole-request contract is available: '+JSON.stringify(goal)+'. Execute only this goal. Return fresh complete final controls; local readback may finish without another model turn.':'';}
module.exports={parseTaskGoal,verifyTaskGoal,goalHint};
