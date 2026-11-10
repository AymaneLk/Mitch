'use strict';

const {createHash}=require('node:crypto');
const {normalizeRole,validatePlan}=require('./action-plan');
const BROWSERS=new Set(['opera','chrome','edge']);
const aliases={calculator:['calculator','calculatrice','windows calculator'],notepad:['notepad','bloc-notes','bloc notes','windows notepad'],instagram:['instagram'],excel:['excel','microsoft excel'],word:['word','microsoft word'],opera:['opera','opera gx'],chrome:['chrome','google chrome'],edge:['edge','microsoft edge']};
const sites={gmail:['mail.google.com','gmail.com','www.gmail.com'],github:['github.com','www.github.com'],youtube:['youtube.com','www.youtube.com'],chatgpt:['chatgpt.com','www.chatgpt.com'],instagram:['instagram.com','www.instagram.com']};
const normalize=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const canonical=value=>Object.keys(aliases).find(key=>aliases[key].includes(normalize(value)))||normalize(value);
const identity=value=>value&&`${value.pid}:${value.window_id}`;
const validWindow=value=>Number.isSafeInteger(value?.pid)&&value.pid>0&&Number.isSafeInteger(value.window_id)&&value.window_id>0;
const validTab=value=>Number.isSafeInteger(value?.tab_id)&&value.tab_id>=0&&Number.isSafeInteger(value.window_id)&&value.window_id>=0;
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const flags=['outcome_unknown','stop_task','input_suppressed','refused','cancelled','canceled'];
const badStatus=new Set(['error','refused','cancelled','canceled','interrupted','observation_failed','partial','unverified']);
const unsuccessful=result=>!result||flags.some(key=>result[key])||badStatus.has(result.status);
function failure(code,message,output){return Object.assign(Error(message),{code,refused:!output?.outcome_unknown,...(output?{output,...(output.outcome_unknown?{outcome_unknown:true,action_attempted:true}:{})}:{})});}
function hostname(value){
  if(typeof value!=='string'||value.length>253||value!==value.toLowerCase()||!value.includes('.')||!value.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))throw failure('invalid_scope','Use an exact ordinary hostname.');
  return value;
}
function ordinaryURL(value){
  let url;try{url=new URL(value);}catch{throw failure('invalid_scope','The target URL is invalid.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw failure('invalid_scope','Use an ordinary HTTP(S) target without credentials.');
  return url;
}
function validateTarget(target){
  if(!plain(target)||!['native','browser'].includes(target.kind))throw failure('invalid_scope','Choose a native app or browser scope.');
  const allowed=target.kind==='native'?['kind','app','open_if_missing']:['kind','hostname','browser','title','open_if_missing','url','frame_id'];
  if(Object.keys(target).some(key=>!allowed.includes(key)))throw failure('invalid_scope','The program scope contains unsupported fields.');
  if(target.open_if_missing!==undefined&&typeof target.open_if_missing!=='boolean')throw failure('invalid_scope','open_if_missing must be a boolean.');
  if(target.kind==='native'){
    if(typeof target.app!=='string'||!target.app.trim()||target.app.length>120||/[\r\n]/.test(target.app))throw failure('invalid_scope','Choose a bounded exact app name.');
  }else{
    hostname(target.hostname);
    if(target.frame_id!==undefined&&(!Number.isSafeInteger(target.frame_id)||target.frame_id<0))throw failure('invalid_scope','Use an observed frame identifier.');
    if(target.browser!==undefined&&!BROWSERS.has(target.browser))throw failure('invalid_scope','Unsupported browser.');
    if(target.title!==undefined&&(typeof target.title!=='string'||!target.title.trim()||target.title.length>300))throw failure('invalid_scope','Invalid exact tab title.');
    if(target.url!==undefined&&ordinaryURL(target.url).hostname!==target.hostname)throw failure('invalid_scope','The supplied URL must belong to the exact requested hostname.');
  }
  return {...target};
}
function windowMatches(app,window){
  const names=aliases[canonical(app)]||[normalize(app)],title=normalize(window.title),processName=normalize(window.app).replace(/\.exe$/,'');
  return names.some(name=>title===name||title.startsWith(name+' - ')||title.endsWith(' - '+name)||title.startsWith(name+' — ')||title.endsWith(' — '+name)||processName===name);
}
function checkedWindowList(result){
  if(unsuccessful(result)||result.status!=='ok'||result.degraded||result.truncated||!Array.isArray(result.windows)||result.windows.length>100||result.windows.some(window=>!validWindow(window)||typeof window.title!=='string'))throw failure('incomplete_inventory','The window inventory is incomplete. No target was chosen.',result);
  if(new Set(result.windows.map(identity)).size!==result.windows.length)throw failure('incomplete_inventory','The window inventory contains duplicate identities.');
  return result;
}
function checkedTabList(result){
  if(unsuccessful(result)||result.status!=='ok'||result.complete!==true||typeof result.snapshot!=='string'||!BROWSERS.has(result.browser)||typeof result.session_id!=='string'||!result.session_id||!Array.isArray(result.tabs)||result.tabs.length>5000||result.tabs.some(tab=>!validTab(tab)||typeof tab.url!=='string'||typeof tab.title!=='string'||typeof tab.pinned!=='boolean'))throw failure('incomplete_inventory','The browser inventory is incomplete. No tab was chosen.',result);
  if(new Set(result.tabs.map(tab=>tab.tab_id)).size!==result.tabs.length)throw failure('incomplete_inventory','The browser inventory contains duplicate tab identities.');
  return result;
}
function normalizeFrame(output){
  const frame=output?.observation||output;
  if(!frame||typeof frame.snapshot!=='string'||!Array.isArray(frame.controls))throw failure('invalid_observation','The target has no usable structured observation.',output);
  const browser=frame.source==='browser_dom';
  if(browser?!Number.isSafeInteger(frame.tab_id):!validWindow(frame.window))throw failure('invalid_observation','The observation has no exact target identity.',output);
  const controls=frame.controls.map(control=>{
    const row={id:String(control.id??control.control_id??''),name:String(control.name??'').slice(0,1000),role:normalizeRole(control.role||control.type),enabled:control.enabled!==false,editable:control.editable===true,protected:control.protected===true};
    if(control.ancestors?.length)row.ancestors=control.ancestors.slice(0,8).map(a=>({name:String(a.name??'').slice(0,300),role:normalizeRole(a.role)}));
    for(const key of ['checked','selected','focused'])if(typeof control[key]==='boolean')row[key]=control[key];
    if(!row.protected&&control.value!==undefined)row.value=String(control.value).slice(0,12000);
    if(Array.isArray(control.options)&&!row.protected)row.options=control.options.slice(0,100);
    return row;
  });
  const complete=!unsuccessful(output)&&!frame.degraded&&!frame.truncated&&!frame.accessibility_partial&&!frame.snapshot_superseded&&(browser?frame.complete===true:frame.complete!==false);
  return {...frame,controls,complete,source:browser?'browser_dom':'native-accessibility',revision:frame.revision??createHash('sha256').update(JSON.stringify(controls)).digest('hex').slice(0,24)};
}

/** All input stays in the existing dispatcher and its task-wide guards. */
function createTaskProgramHost({dispatch,context={},onEvent,initialContext,now=Date.now}={}){
  if(typeof dispatch!=='function')throw TypeError('A task-program host requires the guarded dispatcher.');
  let scope=null,frame=null,observedAt=0,blocked=false;
  const events=[];
  function check(ctx={}){context.signal?.throwIfAborted();context.assertActive?.();if(ctx.signal!==context.signal)ctx.signal?.throwIfAborted();}
  function mutationCheck(ctx){check(ctx);if(blocked)throw failure('outcome_unknown','A prior operation has an unknown result. Further input is blocked.',{outcome_unknown:true,stop_task:true});}
  async function run(name,args,ctx={},mutation=false){
    (mutation?mutationCheck:check)(ctx);
    const signals=[context.signal,ctx.signal].filter(Boolean),activeContext={...context,...ctx,activityScope:context.activityScope??ctx.activityScope,fromModel:true,...(signals.length?{signal:signals.length===1?signals[0]:AbortSignal.any(signals)}:{})};
    // Preserve the host's activity check; an engine may provide its own bound
    // deadline callback, which is checked separately and never stored here.
    activeContext.assertActive=()=>{check(ctx);ctx.assertActive?.();};
    const started=performance.now();let output;
    try{output=await dispatch(name,args,activeContext);}
    catch(error){
      if(mutation&&error.refused!==true)blocked=true;
      const event={name,args,output:{status:'error',code:error.code||'tool_exception',...(mutation?{action_attempted:true,outcome_unknown:blocked}:{})},ms:Math.round(performance.now()-started)};events.push(event);await onEvent?.(event);
      check(ctx);if(blocked)throw failure('outcome_unknown','An operation may have been delivered. Further input is blocked.',event.output);throw error;
    }
    if(output?.outcome_unknown||output?.stop_task)blocked=true;
    const event={name,args,output,ms:Math.round(performance.now()-started)};events.push(event);await onEvent?.(event);
    try{check(ctx);}catch(error){if(mutation){blocked=true;throw failure('outcome_unknown','The task stopped after input was dispatched. Further input is blocked.',{...output,outcome_unknown:true,action_attempted:true});}throw error;}
    return output;
  }
  function install(output,{allowDocumentChange=false}={}){
    const next=normalizeFrame(output);
    if(scope?.kind==='native'&&identity(next.window)!==identity(scope.window))throw failure('scope_changed','The native observation belongs to a different window.');
    if(scope?.kind==='browser'){
      if(next.source!=='browser_dom'||next.tab_id!==scope.tab.tab_id||next.browser!==scope.browser||next.session_id!==scope.session||ordinaryURL(next.url).origin!==scope.origin)throw failure('scope_changed','The browser observation changed tab, profile or origin.');
      if(!allowDocumentChange&&scope.documentId&&next.document_id!==scope.documentId)throw failure('document_changed','The document changed. Use an explicit same-tab transition before more input.');
      if((next.frame_id||0)!==(scope.target.frame_id||0))throw failure('scope_changed','The observation belongs to a different embedded frame.');
      scope.documentId=next.document_id;
    }
    frame=next;observedAt=now();return frame;
  }
  function installAfterInput(output,options){
    try{return install(output,options);}catch(error){
      blocked=true;
      throw failure('outcome_unknown','Input was dispatched, but its returned target state could not be trusted. Further input is blocked.',{status:'interrupted',outcome_unknown:true,action_attempted:true,reason:error.code||'invalid_observation'});
    }
  }
  async function inspectBrowserScope(list,tab,ctx){
    let output=await run('browser_read_page',{snapshot:list.snapshot,tab_id:tab.tab_id},ctx);
    if(scope.target.frame_id){output=await run('browser_read_page',{snapshot:output.snapshot,tab_id:tab.tab_id,frame_id:scope.target.frame_id},ctx);}
    return output;
  }
  async function readBrowser(ctx={},allowDocumentChange=false){
    const list=checkedTabList(await run('browser_list_tabs',{browser:scope.browser},ctx));
    if(list.session_id!==scope.session||list.browser!==scope.browser)throw failure('scope_changed','The browser profile reconnected; this task cannot reuse its tab identity.');
    const tab=list.tabs.find(tab=>tab.tab_id===scope.tab.tab_id);
    if(!tab||tab.window_id!==scope.tab.window_id||tab.pinned||tab.navigating||ordinaryURL(tab.url).origin!==scope.origin)throw failure('scope_changed','The bound tab moved, closed, became protected or changed origin.');
    scope.tab={...tab};
    const output=await inspectBrowserScope(list,tab,ctx);
    return install(output,{allowDocumentChange});
  }
  async function bind(target,ctx={}){
    check(ctx);target=validateTarget(target);
    if(target.kind==='native'){
      const list=checkedWindowList(await run('computer_list_windows',{query:''},ctx));
      const matches=list.windows.filter(window=>windowMatches(target.app,window));
      if(matches.length>1)throw failure('ambiguous_scope','More than one window matches the requested app.');
      if(!matches.length){
        if(!target.open_if_missing)throw failure('scope_not_found','The requested app is not open.');
        const catalog=await run('list_apps',{query:target.app},ctx);
        if(unsuccessful(catalog)||catalog.status!=='ok'||catalog.degraded||catalog.truncated||!Array.isArray(catalog.apps))throw failure('incomplete_inventory','The app catalog is incomplete.',catalog);
        const candidates=catalog.apps.filter(app=>typeof app.app_id==='string'&&canonical(app.name)===canonical(target.app));
        if(candidates.length!==1)throw failure(candidates.length?'ambiguous_scope':'scope_not_found','No unique installed app matches the requested name.');
        const launched=await run('open_app',{app_id:candidates[0].app_id},ctx,true);
        if(unsuccessful(launched)||!['opened','focused_existing'].includes(launched.status)||!validWindow(launched.observation?.window)||launched.observation.focus_verified!==true){blocked=true;throw failure('outcome_unknown','The launch was attempted but its exact window was not confirmed.',{...launched,outcome_unknown:true});}
        scope={kind:'native',target,window:{...launched.observation.window},rootWindow:{...launched.observation.window}};
        return installAfterInput(launched);
      }
      scope={kind:'native',target,window:{...matches[0]},rootWindow:{...matches[0]}};
      const output=await run(matches[0].minimized?'computer_restore_window':'computer_inspect_window',{pid:matches[0].pid,window_id:matches[0].window_id},ctx,matches[0].minimized===true);
      return matches[0].minimized?installAfterInput(output):install(output);
    }
    const list=checkedTabList(await run('browser_list_tabs',target.browser?{browser:target.browser}:{},ctx));
    if(target.browser&&list.browser!==target.browser)throw failure('scope_changed','The inventory belongs to a different browser than the requested scope.');
    const matches=list.tabs.filter(tab=>{try{return !tab.pinned&&!tab.navigating&&ordinaryURL(tab.url).hostname===target.hostname&&(target.title===undefined||tab.title===target.title);}catch{return false;}});
    if(!matches.length&&target.open_if_missing){
      if(!target.url||ordinaryURL(target.url).hostname!==target.hostname)throw failure('invalid_scope','Opening a missing page requires an explicit same-host URL.');
      const opened=await run('browser_open_tab',{snapshot:list.snapshot,url:target.url},ctx,true),next=opened?.observation;
      let destinationMatches=false;try{destinationMatches=ordinaryURL(next?.url).origin===ordinaryURL(target.url).origin;}catch{}
      if(unsuccessful(opened)||opened.status!=='opened'||opened.verified!==true||next?.source!=='browser_dom'||next.browser!==list.browser||next.session_id!==list.session_id||!Number.isSafeInteger(next.tab_id)||!Number.isSafeInteger(next.window_id)||!destinationMatches){blocked=true;throw failure('outcome_unknown','The new tab was requested but its exact browser and destination were not confirmed.',{...opened,outcome_unknown:true,action_attempted:true});}
      scope={kind:'browser',target,tab:{tab_id:next.tab_id,window_id:next.window_id,url:next.url,title:next.title||'',pinned:false},browser:list.browser,session:list.session_id,origin:ordinaryURL(target.url).origin,documentId:null};
      return installAfterInput(next,{allowDocumentChange:true});
    }
    if(matches.length!==1)throw failure(matches.length?'ambiguous_scope':'scope_not_found',matches.length?'More than one tab matches. Use an exact observed title.':'No existing eligible tab matches the requested hostname.');
    const tab=matches[0];scope={kind:'browser',target,tab:{...tab},browser:list.browser,session:list.session_id,origin:ordinaryURL(tab.url).origin,documentId:null};
    return install(await inspectBrowserScope(list,tab,ctx),{allowDocumentChange:true});
  }
  async function observe({refresh=false,forRead=false}={},ctx={}){
    check(ctx);if(!scope)throw failure('scope_not_bound','Bind an app or page before observing.');
    if(forRead&&scope.kind==='native'){
      mutationCheck(ctx);
      const focused=await run('computer_focus_window',{pid:scope.window.pid,window_id:scope.window.window_id},ctx,true);
      if(unsuccessful(focused)||focused.focus_verified!==true||identity((focused.observation||focused).window)!==identity(scope.window)){
        blocked=true;throw failure('outcome_unknown','The window could not be confirmed in the foreground before reading its value.',{...focused,outcome_unknown:true,action_attempted:true});
      }
      installAfterInput(focused);
      // The focus helper captures before raising the window. Inspect once
      // more after verified focus so background Electron values cannot be read
      // from a stale accessibility tree. Ordinary discovery stays read-only.
      return install(await run('computer_inspect_window',{pid:scope.window.pid,window_id:scope.window.window_id},ctx));
    }
    if(!refresh&&frame&&now()-observedAt>=0&&now()-observedAt<=750)return frame;
    if(scope.kind==='browser')return readBrowser(ctx);
    return install(await run('computer_inspect_window',{pid:scope.window.pid,window_id:scope.window.window_id},ctx));
  }
  async function perform(steps,completion,ctx={}){
    mutationCheck(ctx);validatePlan({steps,completion});
    const current=await observe({},ctx);
    if(!current.complete)throw failure('incomplete_observation','The structured view is incomplete. Use the visual fallback rather than guessing controls.');
    const output=await run(scope.kind==='browser'?'browser_execute_plan':'computer_execute_plan',{snapshot:current.snapshot,steps,completion,final:false},ctx,true);
    let observation;
    if(output?.observation)observation=installAfterInput(output.observation);
    // Leave the original status and unknown-delivery flags intact. The engine
    // must stop rather than convert an interrupted phase into a success.
    return {...output,...(observation?{observation}:{})};
  }
  async function transition(target,ctx={}){
    check(ctx);if(!plain(target)||!scope)throw failure('invalid_transition','Bind a target before transitioning.');
    if(target.kind==='same_tab'){
      if(Object.keys(target).some(key=>key!=='kind')||scope.kind!=='browser')throw failure('invalid_transition','same_tab is only valid inside the current browser scope.');
      return readBrowser(ctx,true);
    }
    if(target.kind!=='related_window'||scope.kind!=='native'||typeof target.title!=='string'||!target.title.trim()||target.title.length>300||Object.keys(target).some(key=>!['kind','title'].includes(key)))throw failure('invalid_transition','Choose an exact related native window title.');
    const list=checkedWindowList(await run('computer_list_windows',{query:''},ctx)),parent=scope.window;
    const matches=list.windows.filter(window=>window.title===target.title&&identity(window)!==identity(parent)&&(window.pid===parent.pid||window.owner_window_id===parent.window_id));
    if(matches.length!==1)throw failure(matches.length?'ambiguous_scope':'scope_not_found','No unique same-process or owned popup matches the exact title.');
    mutationCheck(ctx);
    const output=await run('computer_focus_window',{pid:matches[0].pid,window_id:matches[0].window_id},ctx,true);
    if(unsuccessful(output)||output.focus_verified!==true||identity((output.observation||output).window)!==identity(matches[0]))throw failure('focus_unconfirmed','The related window was not confirmed in the foreground.',output);
    scope={...scope,window:{...matches[0]}};return installAfterInput(output);
  }
  async function followLink(target,completion,ctx={}){
    mutationCheck(ctx);if(scope?.kind!=='browser')throw failure('invalid_transition','Link navigation requires a bound browser page.');
    const current=await observe({},ctx);if(!current.complete)throw failure('incomplete_observation','The page view is incomplete.');
    const output=await run('browser_follow_link',{snapshot:current.snapshot,target,completion},ctx,true);
    let observation;if(output?.observation)observation=installAfterInput(output.observation,{allowDocumentChange:true});
    return {...output,...(observation?{observation}:{})};
  }
  return {bind,observe,perform,transition,followLink,check,get events(){return events;},get scope(){return scope?{...scope}:null;},get blocked(){return blocked;},initialContext};
}

const escaped=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function mentions(text,value){const needle=normalize(value);return needle.length>=3&&new RegExp('(?:^|[^a-z0-9])'+escaped(needle)+'(?:$|[^a-z0-9])','i').test(normalize(text));}
function compactFrame(frame,text=''){
  const words=new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g)||[]);
  const score=c=>(c.editable?12:0)+(['checked','selected'].some(k=>typeof c[k]==='boolean')?8:0)+(c.value!==undefined?6:0)+String(c.name+' '+(c.ancestors||[]).map(a=>a.name).join(' ')).toLowerCase().split(/[^a-z0-9]+/).filter(w=>words.has(w)).length*10;
  const selected=frame.controls.length>80?frame.controls.map((c,i)=>({c,i,score:score(c)})).sort((a,b)=>b.score-a.score||a.i-b.i).slice(0,80).sort((a,b)=>a.i-b.i).map(x=>x.c):frame.controls;
  const controls=selected.map(control=>({...control,name:control.name.slice(0,180),...(typeof control.value==='string'?{value:control.value.slice(0,500)}:{})}));
  return {...frame,controls,...(frame.controls.length>80?{complete:false,context_truncated:true,source_complete:frame.complete===true}:{})};
}
/** Read-only preparation. No focus, launch, typing or screenshot is permitted. */
async function prepareTaskContext({text,dispatch,context={},targets,now=Date.now}={}){
  if(typeof text!=='string'||!text.trim()||typeof dispatch!=='function')return {preparedAt:now(),scopes:[],windows:[],tabs:[],errors:[]};
  const check=()=>{context.signal?.throwIfAborted();context.assertActive?.();};check();
  const errors=[];
  const read=async(name,args)=>{check();try{const result=await dispatch(name,args,context);check();return result;}catch{check();errors.push(name==='browser_list_tabs'?'browser_inventory_unavailable':name==='computer_list_windows'?'native_inventory_unavailable':'scope_observation_unavailable');return null;}};
  const [windowsResult,tabsResult]=await Promise.all([read('computer_list_windows',{query:''}),read('browser_list_tabs',{})]);check();
  let windows=[],tabs=[],browser;
  try{if(windowsResult)windows=checkedWindowList(windowsResult).windows;}catch{errors.push('native_inventory_incomplete');}
  try{if(tabsResult){tabs=checkedTabList(tabsResult).tabs;browser=tabsResult.browser;}}catch{errors.push('browser_inventory_incomplete');}
  const explicitScope=/^\s*(?:(?:please|can you|could you|would you)\s+)?(?:in|on|open|launch|focus|restore)\s+"([^"\r\n]{1,120})"/i.exec(text)?.[1];
  const quotedScopes=[...text.matchAll(/\b(?:from|in|on|into)\s+"([^"\r\n]{1,120})"/gi)].map(m=>m[1]);
  const source=text.replace(/"[^"\r\n]*"|'[^'\r\n]*'|“[^”\r\n]*”/g,' '),selected=[];
  if(Array.isArray(targets))for(const target of targets.slice(0,4))selected.push(validateTarget(target));
  else{
    for(const tab of tabs){
      if(tab.pinned||tab.navigating)continue;let host;try{host=ordinaryURL(tab.url).hostname;}catch{continue;}
      if(mentions(source,host)||normalize(explicitScope)===host||Object.entries(sites).some(([name,hosts])=>hosts.includes(host)&&(mentions(source,name)||normalize(explicitScope)===name)))selected.push({kind:'browser',hostname:host,browser});
    }
    for(const window of windows){
      const app=canonical(String(window.app||'').replace(/\.exe$/,''));
      const quoted=quotedScopes.find(name=>windowMatches(name,window));
      const explicit=explicitScope&&windowMatches(explicitScope,window)?explicitScope:quoted||(mentions(source,window.title)?window.title:mentions(source,app)?app:Object.keys(aliases).find(key=>(aliases[key].some(name=>mentions(source,name)))&&windowMatches(key,window)));
      if(explicit&&!selected.some(target=>target.kind==='browser'&&canonical(explicit)===browser))selected.push({kind:'native',app:explicit});
    }
  }
  const unique=[...new Map(selected.map(target=>[JSON.stringify(target),target])).values()].slice(0,4);
  const observations=await Promise.all(unique.map(async target=>{
    check();let output;
    if(target.kind==='native'){
      const matches=windows.filter(window=>windowMatches(target.app,window));if(matches.length!==1||matches[0].minimized)return null;
      output=await read('computer_inspect_window',{pid:matches[0].pid,window_id:matches[0].window_id});
    }else{
      if(target.browser&&target.browser!==browser)return null;
      const matches=tabs.filter(tab=>{try{return !tab.pinned&&!tab.navigating&&ordinaryURL(tab.url).hostname===target.hostname&&(target.title===undefined||target.title===tab.title);}catch{return false;}});
      if(matches.length!==1)return null;
      output=await read('browser_read_page',{snapshot:tabsResult.snapshot,tab_id:matches[0].tab_id});
    }
    if(!output)return null;try{return {target,observation:compactFrame(normalizeFrame(output),text)};}catch{errors.push('scope_observation_unavailable');return null;}
  }));check();
  return {preparedAt:now(),scopes:observations.filter(Boolean),windows:windows.slice(0,40).map(window=>({pid:window.pid,window_id:window.window_id,title:window.title.slice(0,180),app:String(window.app||'').slice(0,100),minimized:window.minimized===true})),tabs:tabs.slice(0,80).flatMap(tab=>{try{return [{tab_id:tab.tab_id,window_id:tab.window_id,hostname:ordinaryURL(tab.url).hostname,title:tab.title.slice(0,180),browser,pinned:tab.pinned}];}catch{return [];} }),errors:[...new Set(errors)]};
}
module.exports={createTaskProgramHost,prepareTaskContext,normalizeFrame,validateTarget,windowMatches};
