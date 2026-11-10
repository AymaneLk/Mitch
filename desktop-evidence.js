'use strict';

const mutations=new Set(['folders_open','open_app','open_website','search_web','search_spotify','control_media','click_app_control','type_in_app','computer_restore_window','computer_action','computer_action_sequence','computer_input','browser_close_tabs','browser_activate_tab','browser_execute_plan','computer_execute_plan','computer_run_workflow','browser_follow_link','browser_open_tab','browser_site_task']);
const observations=new Set(['folders_find','inspect_app','look_at_screen','computer_find_window','computer_focus_window','computer_inspect_window','computer_observe','browser_list_tabs','browser_read_page']);
const playbackInputs=new Set(['computer_execute_plan','browser_execute_plan','computer_run_workflow','browser_follow_link','browser_open_tab','browser_site_task','computer_action','computer_action_sequence','computer_input','click_app_control','type_in_app','control_media']);
const verificationTools=new Set([...observations,'computer_list_windows','list_apps']);
const unverifiedReply="I couldn't verify that the desktop task finished. Please check the app before trying again.";
const cleanRequest=text=>text.trim().replace(/[.!?]+$/,'').replace(/^(?:(?:can|could|would) you\s+)?(?:please\s+)?/i,'');
// Named-song requests have additional identity requirements; do not declare
// them complete merely because a different song is already playing.
const mediaIntent=text=>/^(play|resume|pause)(?:\s+(?:(?:the|my|current|this)\s+)?(?:song|music|track|playback|spotify))?(?:\s+(?:on|in)\s+spotify)?$/i.exec(cleanRequest(text))?.[1]?.toLowerCase();

// The small local model repeatedly reversed transport semantics and mistook a
// navigation link for an opened playlist. These known cases use explicit UI
// evidence, not another probabilistic opinion about the same labels.
function spotifyCompletion(text,state){
  const spotify=/spotify/i.test([state?.window?.title,state?.window?.app].join(' '));
  const liked=/^(?:(?:open|launch) spotify (?:and )?)?(?:go to|open|show|take me to) (?:(?:my|the) )?(?:liked songs|titres lik[eé]s)(?: (?:on|in) spotify)?$/i.test(cleanRequest(text)),intent=mediaIntent(text);
  if((!spotify&&!/spotify/i.test(text))||(!liked&&!intent))return null;
  const pending=reason=>({decision:'continue',answer:unverifiedReply,reason});
  if(!spotify||!Array.isArray(state?.controls)||!state.controls.length)return pending('Fresh Spotify accessibility controls are required to verify the playlist/playback state. Do not claim success from an unverified screenshot description.');
  const controls=state.controls;
  if(liked){
    const heading=controls.some(c=>/heading|header/i.test(c.type||c.role||'')&&/^(liked songs|titres lik[eé]s)$/i.test(c.name));
    const home=controls.some(c=>/heading|header/i.test(c.type||c.role||'')&&/^(home|accueil)$/i.test(c.name));
    const tracks=controls.some(c=>/row|table|grid|list/i.test(c.type||c.role||'')&&!/^(liked songs|titres lik[eé]s)$/i.test(c.name));
    if(!heading||home||!tracks)return pending('The Liked Songs main heading and track list are not verified. A Liked Songs navigation link or tile on Home does not count. Navigate to the playlist, then inspect its main content.');
  }
  if(intent){
    if(state.degraded||state.truncated||state.accessibility_partial)return pending('Spotify controls are incomplete; playback state is not established. Obtain a complete fresh inspection before claiming playback.');
    const buttons=controls.filter(c=>/button/i.test(c.type||c.role||''));
    const pause=buttons.filter(c=>/^(pause|mettre en pause)$/i.test(c.name));
    const play=buttons.filter(c=>/^(play|lire)$/i.test(c.name));
    const playing=pause.length===1,paused=pause.length===0&&play.length===1;
    if((intent==='pause'&&!paused)||(intent!=='pause'&&!playing))return pending(`The requested ${intent==='pause'?'paused':'playing'} state is not established by an unambiguous transport control. Inspect the current player and use its observed ${intent==='pause'?'Pause':'Play/Lire'} control only if needed.`);
  }
  return {decision:'complete',answer:[liked?'Your Liked Songs playlist is open.':'',intent?`Spotify is ${intent==='pause'?'paused':'playing'}.`:''].filter(Boolean).join(' '),reason:'Verified from the current Spotify heading/track list and/or transport control.'};
}

// Input delivery alone never satisfies the observation requirement. This gate
// is deterministic; interpreting the observed outcome is a separate model check.
class DesktopEvidence {
  constructor(now=Date.now){this.touched=false;this.needsObservation=false;this.frames=new Map();this.now=now;this.mediaAttempted=false;this.latest=null;}
  availableTools(tools){return this.mediaAttempted?tools.filter(tool=>verificationTools.has(tool.name)):tools;}
  admit(text,name,args){
    // Reserve BEFORE dispatch. A timeout can follow a successful physical input;
    // neither a new snapshot nor a different tool grants another attempt.
    if(mediaIntent(text)&&playbackInputs.has(name)&&!['move','scroll'].includes(args.kind))this.mediaAttempted=true;
  }
  completedPlayback(text){
    if(!mediaIntent(text)||this.needsObservation||!this.latest||this.now()-this.latest.created>90000)return null;
    const completion=spotifyCompletion(text,this.latest.state);
    return completion?.decision==='complete'?completion:null;
  }
  guard(text,name,args){
    const intent=mediaIntent(text);
    if(!intent)return null;
    const blocked=message=>({status:'error',input_suppressed:true,message});
    if(this.mediaAttempted&&!verificationTools.has(name))return blocked('Playback input was already attempted for this request. Verification is read-only: inspect its result, but do not click, press a key, switch input tools, or replay an uncertain action.');
    if(['computer_execute_plan','browser_execute_plan','computer_run_workflow','browser_follow_link','browser_open_tab','browser_site_task'].includes(name))return blocked('Use one observed playback input, then verify its result. A multi-step plan is unnecessary for this simple playback request.');
    if(name==='control_media')return blocked('Use the intended player\'s observed Play or Pause button. A global media key does not express the requested playback state and can toggle the wrong way.');
    if(name==='computer_action_sequence'&&(args.actions?.length!==1||args.actions[0].kind!=='click'))return blocked('Use one observed playback click. A sequence of inputs can reverse playback more than once.');
    if(name==='type_in_app'||(['computer_input','computer_action'].includes(name)&&['type','double_click','right_click','drag'].includes(args.kind)))return blocked('This simple playback request permits one click or keyboard input, not text entry, a drag or multiple clicks.');
    const cached=this.frames.get(args.snapshot),frame=cached?.state;
    if(!frame||this.now()-cached.created>90000||!/spotify/i.test(frame.window?.title||''))return null;
    const clicks=name==='computer_action_sequence'?args.actions:name==='computer_action'?[args]:name==='click_app_control'?[{...args,kind:'click'}]:[];
    for(const click of clicks||[]){
      const control=frame.controls.find(c=>(c.control_id??c.id)===click.control_id&&c.name===click.expected_name);
      if(click.kind!=='click'||!control||!/button/i.test(control.type||control.role||''))continue;
      const opposite=intent==='pause'?/^(play|lire)$/i:/^(pause|mettre en pause)$/i;
      if(opposite.test(control.name))return {status:'not_needed',message:`No input was sent. The observed ${control.name} button offers the opposite of the requested action. Playback is already ${intent==='pause'?'paused':'playing'}.`,observation:frame};
    }
    return null;
  }
  record(name,output){
    if(!mutations.has(name)&&!observations.has(name))return;
    this.touched=true;
    if(output?.status==='not_needed'||output?.input_suppressed)return;
    if(mutations.has(name)){this.needsObservation=true;this.frames.clear();this.latest=null;}
    const state=output?.observation??output;
    if(name==='browser_site_task'&&require('./public-site-task').verify(output?.goal,output)){this.latest={state:output,created:this.now()};this.needsObservation=false;return;}
    if(name==='folders_open'&&output?.verified===true&&output.foreground_verified===true&&/^[A-Za-z]:[\\/]/.test(output.path||'')&&!output.outcome_unknown){this.latest={state:output,created:this.now()};this.needsObservation=false;return;}
    if(output?.status==='error'||!state?.snapshot)return;
    this.latest={state,created:this.now()};
    if(state.controls?.length){this.frames.clear();this.frames.set(state.snapshot,{state,created:this.now()});}
    const browserObservation=name.startsWith('browser_')&&state.status==='ok'&&state.complete===true&&Array.isArray(state.tabs)&&typeof state.session_id==='string'&&!output.outcome_unknown;
    const completeControls=Array.isArray(state.controls)&&state.complete===true&&!state.degraded&&!state.truncated&&!state.accessibility_partial&&!output.outcome_unknown;
    if(browserObservation||completeControls||state.controls?.length||state._images?.length||output?._images?.length||(name==='look_at_screen'&&state.findings))this.needsObservation=false;
  }
}

const reviewFormat={type:'json_schema',json_schema:{name:'desktop_completion',strict:true,schema:{type:'object',properties:{decision:{type:'string',enum:['complete','continue','blocked']},answer:{type:'string'},reason:{type:'string'}},required:['decision','answer','reason'],additionalProperties:false}}};
function readReview(text){
  try{
    const result=JSON.parse(text);
    if(['complete','continue','blocked'].includes(result.decision)&&typeof result.answer==='string'&&result.answer.trim()&&typeof result.reason==='string')return result;
  }catch{}
  return {decision:'blocked',answer:unverifiedReply,reason:'The completion check did not return a usable result.'};
}

module.exports={DesktopEvidence,reviewFormat,readReview,unverifiedReply,spotifyCompletion};
