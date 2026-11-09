'use strict';

// Task diagnostics persist only fixed vocabulary and bounded scalars. A
// provider/page can put secrets into even a snake_case code, so a regex is not
// a sufficient privacy boundary here. Unknown labels become "other".
const statuses=new Set(['ok','completed','interrupted','refused','error','cancelled','canceled','unverified','verified','observed','inspected','not_needed','not_found','opened','focused_existing','focused','activated','closed','partial','unsupported','unknown','delivered','issued','stopped','not_configured','success','other']);
const codes=new Set([
  'folder_missing','folder_tab_ambiguous','folder_inventory_incomplete','folder_open_unconfirmed','folder_refused','folder_verification_failed','folder_focus_unconfirmed','folder_outcome_unknown','folder_invalid_path','folder_invalid_query','folder_invalid_result','folder_stale_snapshot','folder_incomplete_discovery','folder_replay_blocked',
  'invalid_plan','invalid_adapter','invalid_target','invalid_observation','incomplete_observation','scope_changed','condition_unmet','ambiguous_target','unavailable_target','not_editable','unchanged_repeat','outcome_unknown','action_interrupted','completion_unmet','cancelled','deadline_exceeded','plan_interrupted','non_interactive_target','protected_target','plan_finished',
  'page_outcome_unknown','navigation_changed','stale_target','stale_snapshot','page_busy','page_error','page_operation_failed','unsupported_method','invalid_args','invalid_request','page_permission_required','unsupported_page','unsupported_window','invalid_reply','ledger_full','duplicate_request','page_adapter_unavailable','page_adapter_update_required','recovery_timeout','recovery_scope_changed','recovery_observation_failed','page_recovery_failed','stale_browser_snapshot','stale_page_snapshot','stale_browser_session','page_scope_changed','invalid_page_result','invalid_page_target',
  'ambiguous_browser','browser_busy','browser_cancelled','browser_disconnected','browser_outcome_unknown','browser_stopped','browser_timeout','browser_unavailable','invalid_browser_result','invalid_browser_targets','invalid_browser','browser_refused','invalid_result',
  'disabled_control','occluded_control','offscreen_control','protected_control','stale_control','focus_unconfirmed','target_changed','unknown_window','unsupported_key','unsupported_operation','unsupported_selection','unsupported_click','unsupported_fill','unsupported_select','focus_failed','option_missing','ambiguous_option',
  'replay_context_mismatch','invalid_program','invalid_scope','incomplete_inventory','ambiguous_scope','evidence_limit','tool_invocation_failed','background_unavailable','stale_capture','stale_element','stale_element_token','target_not_found','permission_denied','invalid_tool_arguments','invalid_tool_json','tool_exception','delivered_step_replay','cross_route_replay_blocked','other',
]);
const label=(value,allowed)=>typeof value==='string'?(allowed.has(value)?value:'other'):undefined;
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=100?value:undefined;

function toolDiagnostics(output,error){
  const result={};
  const status=label(output?.status,statuses);if(status!==undefined)result.status=status;
  for(const key of ['reason','code','source_reason']){const value=label(output?.[key],codes);if(value!==undefined)result[key]=value;}
  if(result.code===undefined){
    if(error instanceof SyntaxError)result.code='invalid_tool_json';
    else if(typeof error?.code==='string')result.code=label(error.code,codes);
    else if(error?.name==='AbortError')result.code='cancelled';
    else if(/^Invalid action arguments:/.test(String(output?.message||error?.message||'')))result.code='invalid_tool_arguments';
    else if(error)result.code='tool_exception';
  }
  for(const key of ['attempted','completed']){const value=count(output?.[key]);if(value!==undefined)result[key]=value;}
  for(const key of ['verified','outcome_unknown','action_attempted','refused','input_suppressed','recovery_required','read_only_recovery'])if(typeof output?.[key]==='boolean')result[key]=output[key];
  return result;
}

const boundedNumber=value=>Number.isFinite(value)&&value>=0?Math.min(86400000,Math.round(value)):0;
function taskTimingSummary(timing,allowedTools){
  const allowed=allowedTools instanceof Set?allowedTools:new Set(allowedTools||[]);
  const summary={at:new Date().toISOString(),route:['model','hybrid','local','browser','workflow','replay','folder'].includes(timing?.route)?timing.route:'other'};
  for(const key of ['totalMs','modelRequests','modelMs','toolCalls','toolMs'])summary[key]=boundedNumber(timing?.[key]);
  for(const key of ['localGroundingAttempts','localGroundingMs','preparationRequests','preparationMs'])if(timing?.[key]!==undefined)summary[key]=boundedNumber(timing[key]);
  summary.steps=(Array.isArray(timing?.steps)?timing.steps:[]).slice(0,256).map(step=>({
    kind:['tool','decision','verification','grounding','local_grounding'].includes(step?.kind)?step.kind:'other',
    ...(allowed.has(step?.name)?{name:step.name}:{}),ms:boundedNumber(step?.ms),
    ...(step?.kind==='tool'?toolDiagnostics(step):{}),
  }));
  return summary;
}

module.exports={toolDiagnostics,taskTimingSummary};
