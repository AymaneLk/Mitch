'use strict';
const mutations=new Set(['folders_open','open_app','open_website','search_web','control_media','search_spotify','click_app_control','type_in_app','computer_focus_window','computer_restore_window','computer_action','computer_action_sequence','computer_input','computer_execute_plan','browser_close_tabs','browser_activate_tab','browser_execute_plan','browser_follow_link','browser_open_tab','computer_run_workflow']);
const nativeInputs=new Set(['computer_action','computer_action_sequence','computer_input','computer_execute_plan','computer_run_workflow','click_app_control','type_in_app']);
class PlanTaskGuard {
  constructor(){this.blocked=new Set();this.browserPartials=new Map();this.defaultScope=Symbol('unscoped-plan');}
  block(scope){this.blocked.add(scope);if(this.blocked.size>128)this.blocked.delete(this.blocked.values().next().value);}
  async run(name,context,execute,args={}){
    const scope=context.activityScope??this.defaultScope;
    if(this.blocked.has(scope)&&mutations.has(name))return {status:'refused',input_suppressed:true,stop_task:true,message:'A previous plan sent input with an unknown result. I stopped further input in this task to avoid repeating it. Please check the app.'};
    if(this.browserPartials.has(scope)&&nativeInputs.has(name))return {status:'refused',input_suppressed:true,recovery_required:true,code:'cross_route_replay_blocked',message:'A browser plan already delivered some steps. Continue using its fresh webpage controls; switching input methods could repeat those steps.',observation:this.browserPartials.get(scope)};
    let result;
    try{result=await execute();}catch(error){
      // The folder helper can disappear after Windows receives the open/focus
      // request. Keep the task blocked even when no result object is returned.
      if(name==='folders_open'&&(error?.outcome_unknown===true||error?.action_attempted===true&&error?.refused!==true))this.block(scope);
      throw error;
    }
    if(['folders_open','computer_execute_plan','browser_execute_plan','computer_run_workflow','browser_follow_link','browser_open_tab'].includes(name)&&result?.outcome_unknown)this.block(scope);
    if(['browser_execute_plan','browser_follow_link','browser_open_tab'].includes(name)&&result?.recovery_required&&!result.outcome_unknown&&result.delivered_steps?.length&&result.observation?.source==='browser_dom'){this.browserPartials.set(scope,result.observation);if(this.browserPartials.size>128)this.browserPartials.delete(this.browserPartials.keys().next().value);}
    return result;
  }
}
module.exports={PlanTaskGuard};
