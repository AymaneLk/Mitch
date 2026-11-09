'use strict';

// Browser operations use observed tab IDs and exact URL hosts, never titles,
// pixels, substring matches, or instructions obtained from page content.
const LIMIT=20;
const aliases={
  gmail:{site:'Gmail',hosts:['mail.google.com','gmail.com','www.gmail.com']},
  youtube:{site:'YouTube',hosts:['youtube.com','www.youtube.com']},
  chatgpt:{site:'ChatGPT',hosts:['chatgpt.com','www.chatgpt.com','chat.openai.com']},
  github:{site:'GitHub',hosts:['github.com','www.github.com']},
};
const browserAliases={'opera gx':'opera',opera:'opera','google chrome':'chrome',chrome:'chrome','microsoft edge':'edge',edge:'edge'};
const browserLabels={opera:'Opera',chrome:'Chrome',edge:'Edge'};
const words={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
const amount='(?:(both|all|(?:the )?(?:one|two|three|four|five|six|seven|eight|nine|ten|[1-9][0-9]{0,2}))(?: the)? |(?:the|my) )?';
const beforeTabs=new RegExp('^close '+amount+'([a-z0-9.-]+) (tabs?)$','i');
const afterTabs=new RegExp('^close '+amount+'(tabs?) (?:of|for|from) ([a-z0-9.-]+)$','i');
const unsafe=output=>!output||output.outcome_unknown||output.requires_review||output.recovery_required||output.input_suppressed||output.refused||output.cancelled||output.canceled||output.degraded||output.truncated||['error','refused','cancelled','canceled','interrupted','observation_failed','partial','ambiguous','disconnected'].includes(output.status);
const validId=id=>Number.isSafeInteger(id)&&id>=0;
const canonicalBrowser=value=>typeof value==='string'&&Object.hasOwn(browserAliases,value.trim().toLowerCase())?browserAliases[value.trim().toLowerCase()]:'';

function siteInfo(value){
  const site=value.toLowerCase();
  if(Object.hasOwn(aliases,site))return {...aliases[site],hosts:[...aliases[site].hosts]};
  // A literal hostname means exactly that hostname. In particular, requesting
  // example.com never authorizes sub.example.com or example.com.attacker.test.
  if(site.length>253||!site.includes('.')||!site.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))||!/[a-z]/.test(site.split('.').at(-1)))return null;
  return {site,hosts:[site]};
}
function parseBrowserWorkflow(text){
  if(typeof text!=='string'||text.length>500||/[\r\n]/.test(text))return null;
  let source=text.trim().replace(/\s+/g,' ').replace(/^(?:(?:please|can you|could you) )+/i,'').replace(/[.!?]+$/,'').trim();
  let browser;
  source=source.replace(/ (?:in|on) (?:the )?(opera gx|opera|google chrome|chrome|microsoft edge|edge)(?: browser)?$/i,(_whole,value)=>{browser=browserAliases[value.toLowerCase()];return '';});
  const activating=source.match(/^(?:switch to|go to|activate|focus) (?:the |my )?([a-z0-9.-]+) tab$/i);
  if(activating){const site=siteInfo(activating[1]);return site?{kind:'activate_tab',...site,expectedCount:1,...(browser?{browser}:{})}:null;}
  const direct=beforeTabs.exec(source),inverted=direct?null:afterTabs.exec(source),matched=direct||inverted;
  if(!matched)return null;
  const amountText=String(matched[1]||'').toLowerCase().replace(/^the /,''),site=siteInfo(matched[direct?2:3]),plural=matched[direct?3:2].toLowerCase()==='tabs';
  if(!site)return null;
  const expectedCount=amountText==='both'?2:words[amountText]||(/^[1-9][0-9]*$/.test(amountText)?Number(amountText):plural?null:1);
  if(!plural&&(expectedCount!==1||amountText==='all'||amountText==='both'))return null;
  return {kind:'close_tabs',...site,expectedCount,...(browser?{browser}:{})};
}
function completeList(output){
  if(unsafe(output)||output.status!=='ok'||output.complete!==true||typeof output.snapshot!=='string'||!output.snapshot||!canonicalBrowser(output.browser)||!Array.isArray(output.tabs)||output.tabs.length>10000)return false;
  const ids=new Set();
  return output.tabs.every(tab=>{
    if(!tab||!validId(tab.tab_id)||!validId(tab.window_id)||typeof tab.url!=='string'||typeof tab.pinned!=='boolean'||ids.has(tab.tab_id))return false;
    ids.add(tab.tab_id);return true;
  });
}
function sameBrowser(a,b){
  if(canonicalBrowser(a?.browser)!==canonicalBrowser(b?.browser))return false;
  // Opaque snapshots are enforced by the bridge. When it also exposes a
  // connection/session identity, do not accept reconnects as the old session.
  for(const key of ['session_id','connection_id','browser_session'])if(a?.[key]!==undefined||b?.[key]!==undefined){if(typeof a?.[key]!=='string'||!a[key]||a[key]!==b?.[key])return false;}
  return true;
}
function selectedTabs(plan,list){
  return list.tabs.filter(tab=>{
    try{const url=new URL(tab.url);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&plan.hosts.includes(url.hostname.toLowerCase());}catch{return false;}
  });
}
const sameIds=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&new Set(a).size===a.length&&a.every(validId)&&a.every(id=>b.includes(id));
const answerFor=(plan,count)=>`Closed ${count} ${plan.site} ${count===1?'tab':'tabs'}.`;
function verifyTabActivation(plan,events){
  const action=events.at(-1),listed=events.at(-2),output=action?.output;
  if(action?.name!=='browser_activate_tab'||listed?.name!=='browser_list_tabs'||unsafe(output)||output.status!=='activated'||output.verified!==true)return null;
  const before=listed.output,after=output.observation;
  if(!completeList(before)||!completeList(after)||action.args?.snapshot!==before.snapshot||after.snapshot===before.snapshot||!sameBrowser(before,after))return null;
  if(plan.browser&&canonicalBrowser(before.browser)!==plan.browser||listed.args?.browser&&canonicalBrowser(listed.args.browser)!==canonicalBrowser(before.browser))return null;
  const matches=selectedTabs(plan,before);
  if(matches.length!==1||matches[0].pinned||action.args.tab_id!==matches[0].tab_id||output.active_id!==matches[0].tab_id)return null;
  const current=after.tabs.find(tab=>tab.tab_id===matches[0].tab_id);
  if(!current||current.active!==true||current.window_id!==matches[0].window_id||current.url!==matches[0].url||!sameIds(before.tabs.map(tab=>tab.tab_id),after.tabs.map(tab=>tab.tab_id)))return null;
  return {decision:'complete',answer:`Your ${plan.site} tab is in front.`,reason:'The browser verified the exact observed tab is active and its window is focused.'};
}

function verifyBrowserCompletion(text,events){
  const plan=typeof text==='string'?parseBrowserWorkflow(text):text;
  if(!plan||!Array.isArray(events)||!events.length)return null;
  if(plan.kind==='activate_tab')return verifyTabActivation(plan,events);
  const actionIndex=events.findLastIndex(event=>event.name==='browser_close_tabs');
  if(actionIndex<0)return null;
  const action=events[actionIndex],output=action.output;
  if(unsafe(output)||output.status!=='closed'||output.verified!==true)return null;
  const prior=events.slice(0,actionIndex),listedIndex=prior.findLastIndex(event=>event.name==='browser_list_tabs');
  if(listedIndex<0||listedIndex!==prior.length-1)return null;
  const listed=prior[listedIndex],before=listed.output,after=output.observation;
  if(!completeList(before)||!completeList(after)||before.snapshot!==action.args?.snapshot||after.snapshot===before.snapshot||!sameBrowser(before,after))return null;
  if(plan.browser&&canonicalBrowser(before.browser)!==plan.browser)return null;
  if(listed.args?.browser&&canonicalBrowser(listed.args.browser)!==canonicalBrowser(before.browser))return null;
  const matches=selectedTabs(plan,before),ids=matches.map(tab=>tab.tab_id);
  if(!ids.length||ids.length>LIMIT||matches.some(tab=>tab.pinned)||plan.expectedCount!==null&&ids.length!==plan.expectedCount||!sameIds(action.args?.tab_ids,ids)||!sameIds(output.closed_ids,ids))return null;
  const later=events.slice(actionIndex+1);
  let latest=after;
  for(const event of later){
    if(event.name!=='browser_list_tabs'||!completeList(event.output)||!sameBrowser(before,event.output)||event.output.snapshot===before.snapshot)return null;
    if(event.args?.browser&&canonicalBrowser(event.args.browser)!==canonicalBrowser(before.browser))return null;
    latest=event.output;
  }
  // Confirm disappearance from both the operation's fresh state and any later
  // read. Losing unrelated tabs is not accepted as a successful narrow action.
  for(const state of [after,latest]){
    const remaining=new Set(state.tabs.map(tab=>tab.tab_id));
    if(ids.some(id=>remaining.has(id))||before.tabs.some(tab=>!ids.includes(tab.tab_id)&&!remaining.has(tab.tab_id)))return null;
  }
  return {decision:'complete',answer:answerFor(plan,ids.length),reason:'The exact requested tab IDs are absent from a fresh complete observation of the same browser.'};
}

async function runBrowserWorkflow({text,dispatch,context={}}){
  const plan=parseBrowserWorkflow(text),events=[];
  if(!plan)return {handled:false,events,reason:'No complete explicit browser workflow matches the request.'};
  const check=()=>{context.signal?.throwIfAborted();context.assertActive?.();};
  const run=async(name,args)=>{
    check();let output;
    try{output=await dispatch(name,args,context);}catch(error){
      check();output={status:'error',message:String(error.message||error),...(error.code?{code:error.code}:{}),...(['browser_close_tabs','browser_activate_tab'].includes(name)?{action_attempted:true,outcome_unknown:error.refused!==true}:{})};
    }
    check();events.push({name,args,output});return output;
  };
  const fallback=reason=>({handled:false,events,plan,reason});
  const stop=answer=>({handled:true,events,plan,answer});
  if(plan.kind==='activate_tab'){
    const listed=await run('browser_list_tabs',plan.browser?{browser:plan.browser}:{});
    if(listed?.code==='ambiguous_browser'||listed?.status==='ambiguous')return stop('More than one browser profile matches. Specify which connected browser to use. No tab was switched.');
    if(['disconnected','unavailable','not_connected','error'].includes(listed?.status))return fallback('The browser connection is unavailable. No tab was switched by this workflow.');
    if(!completeList(listed))return stop('I could not read a complete browser tab list. No tab was switched.');
    if(plan.browser&&canonicalBrowser(listed.browser)!==plan.browser)return stop('The connected browser does not match your request. No tab was switched.');
    const matches=selectedTabs(plan,listed);
    if(matches.length!==1)return stop(matches.length?`More than one ${plan.site} tab is open. Specify which tab to bring forward.`:`No ${plan.site} tab is open in ${browserLabels[canonicalBrowser(listed.browser)]||'the connected browser'}.`);
    if(matches[0].pinned)return stop(`The ${plan.site} tab is pinned. The current bridge cannot switch pinned tabs; unpin it first or select it yourself.`);
    await run('browser_activate_tab',{snapshot:listed.snapshot,tab_id:matches[0].tab_id});
    const result=verifyBrowserCompletion(plan,events);
    return result?{handled:true,events,plan,answer:result.answer}:fallback('The tab switch was attempted once but its result is not verified. Inspect the browser state; never replay the switch from this attempt.');
  }
  if(plan.expectedCount>LIMIT)return stop(`I can close up to ${LIMIT} matching tabs in one batch. No tabs were closed.`);
  const listed=await run('browser_list_tabs',plan.browser?{browser:plan.browser}:{});
  if(listed?.code==='ambiguous_browser')return stop('More than one browser profile is connected. Keep the Mitch extension connected in one intended profile, or name a browser with one connected profile. No tabs were closed.');
  if(['disconnected','unavailable','not_connected','error'].includes(listed?.status))return fallback('The browser connection is unavailable. No tabs were closed by this workflow; continue from the recorded result.');
  if(listed?.status==='ambiguous')return stop('More than one browser connection matches. Specify which browser or profile to use; no tabs were closed.');
  if(!completeList(listed))return stop('I could not read a complete browser tab list, so no tabs were closed.');
  if(plan.browser&&canonicalBrowser(listed.browser)!==plan.browser)return stop('The connected browser does not match your request, so no tabs were closed.');
  const matches=selectedTabs(plan,listed),browser=browserLabels[canonicalBrowser(listed.browser)]||'the connected browser';
  if(plan.expectedCount!==null&&matches.length!==plan.expectedCount)return stop(`I found ${matches.length} ${plan.site} ${matches.length===1?'tab':'tabs'} in ${browser}, but you asked for ${plan.expectedCount}. No tabs were closed.`);
  if(!matches.length)return stop(`No ${plan.site} tabs are open in ${browser}.`);
  if(matches.length>LIMIT)return stop(`I found ${matches.length} ${plan.site} tabs. I can close up to ${LIMIT} in one batch, so no tabs were closed.`);
  if(matches.some(tab=>tab.pinned))return stop(`The matching ${plan.site} tabs include pinned tabs. No tabs were closed; unpin them first or choose the specific unpinned tabs.`);
  await run('browser_close_tabs',{snapshot:listed.snapshot,tab_ids:matches.map(tab=>tab.tab_id)});
  const result=verifyBrowserCompletion(plan,events);
  return result?{handled:true,events,plan,answer:result.answer}:fallback('The tab-close batch was attempted once, but its result is not fully verified. Preserve the recorded IDs and any partial result. Inspect the browser state; never replay the batch or close additional tabs based on this attempt.');
}
module.exports={parseBrowserWorkflow,runBrowserWorkflow,verifyBrowserCompletion};
