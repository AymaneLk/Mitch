'use strict';
const fault=event=>event?.output&&(event.output.outcome_unknown||event.output.requires_review||event.output.recovery_required||event.output.input_suppressed||['error','refused','cancelled','interrupted','observation_failed','unverified'].includes(event.output.status));
const nativeObservation=event=>{
  if(!event||fault(event)||!/^computer_|^open_app$/.test(event.name))return null;
  const state=event.output?.observation||event.output;
  return state?.snapshot&&state.controls?.length&&!state.degraded&&!state.truncated&&!state.accessibility_partial?state:null;
};

function desktopTools(tools,events=[]){
  const latest=events.at(-1),page=latest?.output?.observation||latest?.output;
  if((!fault(latest)||(latest?.output?.recovery_required&&!latest.output.outcome_unknown))&&page?.source==='browser_dom'&&page.snapshot&&Array.isArray(page.controls)){
    const inactive=new Set(['inspect_app','click_app_control','type_in_app','computer_action','computer_action_sequence','computer_execute_plan']);
    return tools.filter(tool=>!inactive.has(tool.name));
  }
  // Avoid offering the second, incompatible control-ID namespace when the
  // current complete observation already comes from the native driver.
  if(!nativeObservation(events.at(-1)))return tools;
  const legacy=new Set(['inspect_app','click_app_control','type_in_app','browser_execute_plan']);
  // A valid native frame exposes the plan as the primary input interface.
  // Any refusal/degraded result restores single-action and visual recovery.
  if(tools.some(tool=>tool.name==='computer_execute_plan')){legacy.add('computer_action');legacy.add('computer_action_sequence');}
  return tools.filter(tool=>!legacy.has(tool.name));
}
function desktopModeInstructions(events=[]){
  const latest=events.at(-1),state=latest?.output?.observation||latest?.output;
  if(fault(latest)&&!(latest?.output?.recovery_required&&!latest.output.outcome_unknown&&state?.source==='browser_dom'))return '';
  if(state?.source==='browser_dom'&&state.snapshot)return 'Current input route: browser_execute_plan. Use named DOM controls, not native or visual clicks while these controls are usable. Bundle consecutive actions and set final:false until the entire request should be finished.';
  if(nativeObservation(latest))return 'Current input route: computer_execute_plan. Use this tool for supported input; computer_action and computer_action_sequence are not offered in this mode. Bundle consecutive actions. Set final:false for intermediate navigation phases. Completion assertions describe the resulting screen: do not assert a field value after navigating away from that field. Use an observed destination control, or absence of a uniquely named control expected to disappear. A value can be checked with an assert step before navigation. Use visual/native recovery tools only if the plan cannot use the controls.';
  return '';
}
module.exports={desktopTools,desktopModeInstructions};
