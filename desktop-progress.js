'use strict';
const {controlState}=require('./desktop-state');
const inputs=new Set(['folders_open','open_app','open_website','search_web','search_spotify','control_media','click_app_control','type_in_app','computer_restore_window','computer_action','computer_action_sequence','computer_input','browser_close_tabs','browser_activate_tab','browser_execute_plan','computer_execute_plan','computer_run_workflow','browser_follow_link','browser_open_tab']);
const reads=new Set(['folders_find','inspect_app','look_at_screen','computer_find_window','computer_focus_window','computer_inspect_window','computer_observe','computer_list_windows','list_apps','browser_list_tabs','browser_read_page']);
const failed=new Set(['error','refused','interrupted','observation_failed']);
class DesktopProgress {
  constructor(){this.frames=new Map();this.failures=0;this.unchanged=0;}
  record(name,args,output){
    if(output?.stop_task)return output.message;
    if(output?.input_suppressed)return; // Recovery may return fresh controls without sending input.
    const input=inputs.has(name);if(!input&&!reads.has(name))return;
    const state=output?.observation||output;
    let previous,fingerprint,key;
    if(state?.window?.pid&&state.window.window_id&&state.controls?.length&&!state.degraded&&!state.truncated){
      key=`${state.window.pid}:${state.window.window_id}`;
      fingerprint=controlState(state);
      previous=this.frames.get(key);this.frames.set(key,fingerprint);
    }
    if(output?.recovery?.state_changed===true){
      // Navigation can succeed even when its driver acknowledgement fails.
      // A changed, freshly inspected state permits continuing, not claiming success.
      this.failures=0;this.unchanged=0;
    }else if(failed.has(output?.status)||output?.outcome_unknown){
      this.failures++;
    }else if(input){
      this.failures=0;
      if(name==='computer_input'&&['click','double_click','right_click'].includes(args?.kind)&&state.visual_change?.meaningful===false)this.unchanged++;
      else if(name==='computer_input'&&state.visual_change?.meaningful===true)this.unchanged=0;
      else if(previous&&fingerprint===previous&&!['move','scroll'].includes(args?.kind))this.unchanged++;
      else if(fingerprint&&fingerprint!==previous)this.unchanged=0;
    }else if(previous&&fingerprint!==previous){this.unchanged=0;this.failures=0;}
    if(this.failures>=3)return "I stopped after three unsuccessful desktop operations. I couldn't verify the requested result, so I stopped instead of repeating those operations. Last problem: "+String(output?.message||'The operation failed.').slice(0,300);
    if(this.unchanged>=3)return "I stopped because three inputs produced no observable change in the app. I couldn't verify the requested result, so I won't keep clicking.";
  }
}
module.exports={DesktopProgress};
