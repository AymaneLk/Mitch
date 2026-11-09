'use strict';

// A deliberately small set of locally executable tasks. Everything else returns
// to the general agent with the observations/actions already performed attached.
// Names, text and control IDs are data; no screen content becomes an instruction.
const normalize=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const identity=window=>window&&`${window.pid}:${window.window_id}`;
const appAliases={calculator:['calculator','calculatrice','windows calculator'],notepad:['notepad','bloc-notes','bloc notes','windows notepad'],instagram:['instagram']};
const canonicalApp=name=>Object.entries(appAliases).find(([,aliases])=>aliases.includes(normalize(name)))?.[0]||normalize(name);
const completeState=state=>!!(state?.snapshot&&state.window&&Array.isArray(state.controls)&&state.controls.length&&!state.degraded&&!state.truncated&&!state.accessibility_partial&&!state.snapshot_superseded);
const usable=control=>control.enabled!==false&&!control.protected;
const isButton=control=>/(?:^|[.:])button$/i.test(control.type||'');
const isLink=control=>/(?:^|[.:])(?:button|link|hyperlink)$/i.test(control.type||'');
const appWindow=(app,window)=>{
  const title=normalize(window?.title);
  return (appAliases[canonicalApp(app)]||[normalize(app)]).some(name=>title===name||title.endsWith(' - '+name)||title.startsWith(name+' - ')||title.endsWith(' — '+name));
};
function decimal(value){
  if(!/^[-+]?\d+(?:\.\d+)?$/.test(value))return null;
  const [whole,fraction='']=value.split('.');return {n:BigInt(whole+fraction),d:10n**BigInt(fraction.length)};
}
function exactAnswer(left,operator,right){
  const a=decimal(left),b=decimal(right);if(!a||!b)return null;
  let n,d;
  if(operator==='+'){n=a.n*b.d+b.n*a.d;d=a.d*b.d;}
  else if(operator==='-'){n=a.n*b.d-b.n*a.d;d=a.d*b.d;}
  else if(operator==='*'){n=a.n*b.n;d=a.d*b.d;}
  else {if(b.n===0n)return null;n=a.n*b.d;d=a.d*b.n;}
  const sign=n<0n?'-':'';n=n<0n?-n:n;
  const whole=n/d;let remainder=n%d,fraction='';
  while(remainder&&fraction.length<12){remainder*=10n;fraction+=String(remainder/d);remainder%=d;}
  if(remainder)return null;
  const text=sign+whole+(fraction?'.'+fraction:'');
  return text.replace(/[-.]/g,'').length<=15?text:null;
}
function cleanApp(text){
  const app=text.trim().replace(/^(?:the\s+)?(?:app(?:lication)?\s+)?/i,'').replace(/\s+app(?:lication)?$/i,'').trim();
  if(!app||app.length>80||/[\r\n"“”':;?!]/.test(app)||/\b(?:and|then|with|because|please)\b/i.test(app))return null;
  return app;
}
function parseDesktopWorkflow(text){
  if(typeof text!=='string'||text.length>16000)return null;
  let source=text.trim().replace(/^(?:(?:please|can you|could you)\s+)+/i,'').replace(/[.!?]+$/,'').trim();
  const focus=source.match(/^(?:switch to|focus|restore)\s+(.+)$/i)||source.match(/^bring\s+(.+?)\s+to\s+(?:the\s+)?(?:front|foreground)$/i);
  if(focus){
    const app=cleanApp(focus[1].replace(/\s+window$/i,''));
    // Browser tabs have their own exact-host workflow. Do not turn an unknown
    // tab or an additional requested operation into a native app focus.
    return app&&!/\b(?:tab|tabs|window|windows|all|both|them|it|to|from|in|on|for|except)\b/i.test(app)?{kind:'focus',app}:null;
  }
  const calculate=source.match(/^open\s+(?:the\s+)?(?:app\s+)?(?:calculator|calculatrice)(?:\s+app)?\s+and\s+(?:calculate\s+|(?:do|perform)\s+(?:this|the)\s+calculation\s+)(\d{1,9}(?:\.\d{1,9})?)\s*(\+|-|\*|x|×|\/|÷|plus|minus|times|multiplied by|divided by)\s*(\d{1,9}(?:\.\d{1,9})?)(?:\s+and\s+(?:give|tell|show)\s+me\s+(?:the\s+)?(?:result|answer))?$/i);
  if(calculate){
    const operator=({x:'*','×':'*',times:'*','multiplied by':'*','÷':'/',plus:'+',minus:'-','divided by':'/'})[calculate[2].toLowerCase()]||calculate[2];
    const [left,right]=[calculate[1],calculate[3]].map(n=>n.replace(/^0+(?=\d)/,''));
    const expected=exactAnswer(left,operator,right);
    if(expected===null||left.length+right.length+3>20)return null;
    return {kind:'calculate',app:'Calculator',left,operator,right,expected};
  }
  const typing=source.match(/^open\s+(?:the\s+)?(?:app\s+)?(notepad|bloc-notes|bloc notes)(?:\s+app)?\s+and\s+(write|type|replace (?:its|the) text with)\s+(?:"([^"]*)"|“([^”]*)”|'([^']*)')$/i);
  if(typing){const content=typing[3]??typing[4]??typing[5];return content.length&&content.length<=12000?{kind:'type',app:'Notepad',text:content,replace:typing[2].toLowerCase().startsWith('replace')}:null;}
  const navigation=source.match(/^open\s+(?:the\s+)?(?:app\s+)?instagram(?:\s+app)?\s+and\s+(?:go to|open)\s+(?:my\s+)?(messages|inbox|profile)$/i);
  if(navigation)return {kind:'navigate',app:'Instagram',destination:navigation[1].toLowerCase()==='profile'?'profile':'messages'};
  const opening=source.match(/^open\s+(.+)$/i),app=opening&&cleanApp(opening[1]);
  return app?{kind:'open',app}:null;
}
function catalogMatches(plan,apps){
  const canonical=canonicalApp(plan.app);
  return apps.filter(app=>typeof app.app_id==='string'&&(canonicalApp(app.name)===canonical||canonical==='calculator'&&/^Microsoft\.WindowsCalculator_[^!]+!/i.test(app.app_id)||canonical==='notepad'&&(/(?:^|[\\/])notepad\.exe$/i.test(app.app_id)||/^Microsoft\.WindowsNotepad_[^!]+!/i.test(app.app_id))));
}
function calculatorDisplay(state){
  const displays=state.controls.filter(control=>!control.editable&&/^(?:Display is |L.affichage est )/i.test(control.name));
  if(displays.length!==1)return null;
  const display=displays[0],french=/^L.affichage est /i.test(display.name);
  let number=display.name.replace(/^(?:Display is |L.affichage est )/i,'').replace(/[\s\u200e\u200f]/g,'').replace(/−/g,'-');
  number=french?number.replace(',','.'):number.replace(/,/g,'');
  const value=decimal(number);return value?{...value,text:number}:null;
}
function calculatorMatches(plan,state){
  const actual=calculatorDisplay(state),expected=decimal(plan.expected);
  return !!actual&&actual.n*expected.d===expected.n*actual.d;
}
function calculatorActions(plan,state){
  const aliases={
    clear:['clear','effacer'],'.':['decimal separator','decimal point','separateur decimal'],
    '+':['plus','add','ajouter'],'-':['minus','subtract','moins'],'*':['multiply by','multiply','multiplier par'],'/':['divide by','divide','diviser par'],
    '=':['equals','equal','est egal a'],
  };
  const english=['zero','one','two','three','four','five','six','seven','eight','nine'],french=['zero','un','deux','trois','quatre','cinq','six','sept','huit','neuf'];
  for(let i=0;i<10;i++)aliases[String(i)]=[String(i),english[i],french[i]];
  const keys=['clear',...plan.left,plan.operator,...plan.right,'='];
  const actions=[];
  for(const key of keys){
    const matches=state.controls.filter(control=>usable(control)&&isButton(control)&&aliases[key]?.includes(normalize(control.name)));
    if(matches.length!==1)return null;
    actions.push({kind:'click',control_id:matches[0].control_id,expected_name:matches[0].name});
  }
  return actions;
}
function editorControls(state){return state.controls.filter(control=>{
  if(!usable(control)||!control.editable)return false;
  if(/^(?:text editor|text area|editeur de texte|zone de texte)$/i.test(normalize(control.name)))return true;
  // Some web accessibility providers label the page root editable but expose
  // its URL as the value. It is not the user's document editor.
  return /(?:^|[.:])document$/i.test(control.type||'')&&!/^[a-z][a-z0-9+.-]*:\/\//i.test(String(control.value||''));
});}
function destinationReached(plan,state){
  if(plan.destination==='messages')return state.controls.some(control=>/(?:^|[.:])heading$/i.test(control.type||'')&&['messages','your messages','vos messages','inbox','boite de reception'].includes(normalize(control.name)));
  const edit=state.controls.some(control=>usable(control)&&isLink(control)&&['edit profile','modifier le profil'].includes(normalize(control.name)));
  const following=state.controls.some(control=>/^(?:[\d.,\s]+\s*)?(?:following|abonnements)(?:\s+[\d.,]+)?$/i.test(normalize(control.name)));
  const followers=state.controls.some(control=>/^(?:[\d.,\s]+\s*)?(?:followers|abonnes)(?:\s+[\d.,]+)?$/i.test(normalize(control.name)));
  return edit&&following&&followers;
}
const failure=output=>!output||output.outcome_unknown||output.requires_review||output.recovery_required||output.input_suppressed||['error','refused','cancelled','interrupted','observation_failed'].includes(output.status);
const completeCatalog=catalog=>!failure(catalog)&&catalog.status==='ok'&&Array.isArray(catalog.apps)&&catalog.apps.length<60&&!catalog.truncated&&!catalog.degraded;
const validWindow=window=>Number.isSafeInteger(window?.pid)&&window.pid>0&&Number.isSafeInteger(window.window_id)&&window.window_id>0&&typeof window.title==='string';
function completeWindows(list){
  if(failure(list)||list.status!=='ok'||list.degraded||list.truncated||!Array.isArray(list.windows))return false;
  const ids=new Set();
  return list.windows.every(window=>{if(!validWindow(window)||ids.has(identity(window)))return false;ids.add(identity(window));return true;});
}
const selectedWindows=(plan,list)=>list.windows.filter(window=>appWindow(plan.app,window)||canonicalApp(String(window.app||'').replace(/\.exe$/i,''))===canonicalApp(plan.app));
function verifyWindowFocus(plan,events){
  const focus=events.at(-1),listed=events.at(-2),state=focus?.output?.observation||focus?.output;
  if(focus?.name!=='computer_focus_window'||listed?.name!=='computer_list_windows'||listed.args?.query!==''||!completeWindows(listed.output)||failure(focus.output))return null;
  const matches=selectedWindows(plan,listed.output);
  if(matches.length!==1||identity(matches[0])!==identity(focus.args)||!validWindow(state?.window)||identity(state.window)!==identity(matches[0])||state.focus_verified!==true||state.focused!==true||state.snapshot_superseded)return null;
  // Foreground identity is sufficient for a focus-only request. An app with
  // no accessible controls can still be correctly brought to the foreground.
  return {decision:'complete',answer:`${plan.app} is in front.`,reason:'Windows confirmed the exact uniquely observed window is in the foreground.'};
}
function verifyDesktopCompletion(text,events){
  const plan=typeof text==='string'?parseDesktopWorkflow(text):text;
  if(!plan||!Array.isArray(events)||!events.length)return null;
  if(plan.kind==='focus')return verifyWindowFocus(plan,events);
  const latest=events.at(-1),state=latest.output?.observation||latest.output;
  if(failure(latest.output)||!completeState(state)||!appWindow(plan.app,state.window))return null;
  // A final read may follow the action. It can confirm the result, but must not
  // conceal a later mutation, failed/uncertain operation or a different window.
  const mutationNames=new Set(['open_app','computer_action','computer_action_sequence','computer_input','type_in_app','click_app_control','open_website','control_media']);
  const lastAction=[...events].reverse().find(event=>mutationNames.has(event.name));
  if(!lastAction||failure(lastAction.output))return null;
  const later=events.slice(events.indexOf(lastAction)+1);
  if(later.some(event=>!['computer_inspect_window','computer_find_window','computer_focus_window','computer_observe'].includes(event.name)||failure(event.output)||identity((event.output?.observation||event.output)?.window)!==identity(state.window)))return null;
  const opened=events.find(event=>event.name==='open_app'&&['opened','focused_existing'].includes(event.output?.status)&&identity(event.output?.observation?.window)===identity(state.window));
  if(!opened)return null;
  // A matching window title alone does not identify the app we launched. Tie
  // the exact opened ID to the last complete catalog observed before launch.
  const catalog=[...events.slice(0,events.indexOf(opened))].reverse().find(event=>event.name==='list_apps')?.output;
  if(!completeCatalog(catalog))return null;
  const matches=catalogMatches(plan,catalog.apps);
  if(matches.length!==1||matches[0].app_id!==opened.args?.app_id)return null;
  // The launch controller must also confirm a focused, accessible app window.
  const opening=opened.output.observation;
  if(!completeState(opening)||opening.focus_verified!==true)return null;
  let answer;
  if(plan.kind==='open'&&lastAction===opened)answer=`${plan.app} is open.`;
  else if(plan.kind==='calculate'&&lastAction.name==='computer_action_sequence'&&lastAction.output.completed===lastAction.args.actions?.length&&lastAction.args.snapshot===opening.snapshot&&JSON.stringify(lastAction.args.actions)===JSON.stringify(calculatorActions(plan,opening))&&calculatorMatches(plan,state))answer=`${plan.left} ${plan.operator==='*'?'×':plan.operator==='/'?'÷':plan.operator} ${plan.right} = ${plan.expected}.`;
  else if(plan.kind==='type'){
    const controls=editorControls(state),before=editorControls(opening);
    const typed=lastAction.name==='computer_action'&&lastAction.args.kind==='type'&&lastAction.args.text===plan.text&&lastAction.args.snapshot===opening.snapshot&&lastAction.args.control_id===before[0]?.control_id&&lastAction.args.expected_name===before[0]?.name&&lastAction.output.verified===true;
    const already=lastAction===opened&&before.length===1&&before[0].value===plan.text;
    if(controls.length===1&&before.length===1&&controls[0].name===before[0].name&&controls[0].type===before[0].type&&controls[0].value===plan.text&&(typed||already))answer='The text is in Notepad.';
  }else if(plan.kind==='navigate'&&destinationReached(plan,state))answer=plan.destination==='messages'?'Your Instagram messages are open.':'Your Instagram profile is open.';
  return answer?{decision:'complete',answer,reason:'Exact local observation confirms the requested outcome.'}:null;
}

async function runDesktopWorkflow({text,dispatch,context={}}){
  const plan=parseDesktopWorkflow(text),events=[];
  if(!plan)return {handled:false,events,reason:'No exact local workflow matches the complete request.'};
  const check=()=>{context.signal?.throwIfAborted();context.assertActive?.();};
  const run=async(name,args)=>{
    check();let output;
    try{output=await dispatch(name,args,context);}catch(error){
      check();const attempted=error.action_attempted||['open_app','computer_action','computer_action_sequence','computer_focus_window'].includes(name);
      output={status:'error',message:error.message,...(error.code?{code:error.code}:{}),...(attempted?{action_attempted:true,outcome_unknown:error.refused!==true}:{})};
    }
    check();events.push({name,args,output});return output;
  };
  const fallback=reason=>({handled:false,events,reason,plan});
  const finish=()=>{const result=verifyDesktopCompletion(plan,events);return result?{handled:true,events,answer:result.answer,plan}:fallback('The latest observation does not prove completion. Continue from these existing results; do not replay attempted input.');};
  if(plan.kind==='focus'){
    // One inventory supports localized aliases, minimized/covered windows and
    // exact app names without a speculative launch or an extra inspection.
    const listed=await run('computer_list_windows',{query:''});
    if(!completeWindows(listed))return fallback('The open-window inventory is incomplete. Do not guess a window to focus.');
    const matches=selectedWindows(plan,listed);
    if(matches.length!==1)return {handled:true,events,plan,answer:matches.length?`More than one ${plan.app} window is open. Specify which window to bring forward.`:`I could not find an open ${plan.app} window.`};
    const {pid,window_id}=matches[0];
    await run('computer_focus_window',{pid,window_id});
    const result=finish();
    // A focus timeout may happen after Windows already raised the window.
    // Complete this narrow request with an honest failure rather than letting
    // a planner send the same focus again through a different control path.
    return result.handled?result:{handled:true,events,plan,answer:`I tried to bring ${plan.app} forward, but Windows did not confirm the result. I did not repeat the action.`};
  }
  const catalog=await run('list_apps',{query:canonicalApp(plan.app)});
  if(!completeCatalog(catalog))return fallback('The app catalog could not be read completely.');
  const matches=catalogMatches(plan,catalog.apps);
  if(matches.length!==1)return fallback('No unique exact app matches; choose from the observed catalog or clarify the intended app.');
  const opened=await run('open_app',{app_id:matches[0].app_id}),state=opened?.observation;
  if(failure(opened)||!['opened','focused_existing'].includes(opened.status)||!completeState(state)||!appWindow(plan.app,state.window)||state.focus_verified!==true)return fallback('The requested app was not confirmed as one focused, accessible window. Do not open it again without checking these results.');
  if(plan.kind==='open')return finish();
  if(plan.kind==='calculate'){
    const actions=calculatorActions(plan,state);if(!actions)return fallback('Calculator does not expose one exact observed button for every required input.');
    await run('computer_action_sequence',{snapshot:state.snapshot,actions});return finish();
  }
  if(plan.kind==='type'){
    const editors=editorControls(state);if(editors.length!==1||editors[0].value===undefined)return fallback('Notepad does not expose one exact readable writable document.');
    const editor=editors[0];
    if(editor.value===plan.text)return finish();
    if(editor.value&&!plan.replace)return fallback('The document already contains text. The local workflow will not replace existing content without an explicit replacement request.');
    await run('computer_action',{snapshot:state.snapshot,kind:'type',control_id:editor.control_id,expected_name:editor.name,text:plan.text});return finish();
  }
  if(destinationReached(plan,state))return finish();
  const names=plan.destination==='messages'?['messages','direct messaging','inbox','messagerie']:['profile','profil'];
  const targets=state.controls.filter(control=>usable(control)&&isLink(control)&&names.includes(normalize(control.name)));
  if(targets.length!==1)return fallback('The requested navigation control is missing or ambiguous.');
  await run('computer_action',{snapshot:state.snapshot,kind:'click',control_id:targets[0].control_id,expected_name:targets[0].name});return finish();
}
module.exports={parseDesktopWorkflow,runDesktopWorkflow,verifyDesktopCompletion};
