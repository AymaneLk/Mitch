'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseBrowserWorkflow,runBrowserWorkflow,verifyBrowserCompletion}=require('../browser-workflows');
const tab=(tab_id,url='https://mail.google.com/mail/u/0/#inbox',rest={})=>({tab_id,window_id:1,url,title:'Untrusted tab title',active:false,pinned:false,...rest});
const list=(tabs,rest={})=>({status:'ok',complete:true,snapshot:'before',browser:'opera',session_id:'session-one',tabs,...rest});
function fixture({initial=list([tab(1),tab(2),tab(3,'https://example.com')]),close={}}={}){
  const calls=[];
  const dispatch=async(name,args)=>{
    calls.push({name,args});
    if(name==='browser_list_tabs')return initial;
    assert.equal(name,'browser_close_tabs');
    return {status:'closed',verified:true,closed_ids:args.tab_ids,observation:{...initial,snapshot:'after',tabs:initial.tabs.filter(tab=>!args.tab_ids.includes(tab.tab_id))},...close};
  };
  return {dispatch,calls};
}
const request='close the two Gmail tabs in Opera GX';

test('parses complete explicit close requests and exact literal hostnames',()=>{
  for(const text of [request,'close the two tabs of gmail on opera gx','Please close both Gmail tabs in Opera.','close 2 gmail tabs on Opera GX','CLOSE TWO GMAIL TABS IN OPERA GX']){
    const plan=parseBrowserWorkflow(text);assert.equal(plan.browser,'opera');assert.equal(plan.expectedCount,2);assert.ok(plan.hosts.includes('mail.google.com'));
  }
  assert.equal(parseBrowserWorkflow('close Gmail tabs').expectedCount,null);
  assert.equal(parseBrowserWorkflow('close the Gmail tab').expectedCount,1);
  assert.deepEqual(parseBrowserWorkflow('close all example.com tabs in Chrome').hosts,['example.com']);
  assert.equal(parseBrowserWorkflow('close all the YouTube tabs on Microsoft Edge').browser,'edge');
  assert.ok(parseBrowserWorkflow('Close ChatGPT tabs!').hosts.includes('chatgpt.com'));
});
test('does not guess pronouns, unsupported names, malformed hosts or compound tasks',async()=>{
  for(const text of ['close them','close both tabs','close Gmail','close Gmail tabs and open YouTube','close Gmail tabs then close Opera','close Gmail tabs in Firefox','close Gmail tabs\nopen bank','close mail.google.com@attacker.test tabs','close https://mail.google.com tabs','close *.google.com tabs','close unknownsite tabs','close constructor tabs','close 0 gmail tabs','close two gmail tab','close all gmail tab','close -host.com tabs']){
    assert.equal(parseBrowserWorkflow(text),null,text);
    const result=await runBrowserWorkflow({text,dispatch:()=>assert.fail('No action for unsupported request')});assert.equal(result.handled,false);
  }
});
test('closes exact observed IDs in one batch and verifies locally without any model or screenshot',async()=>{
  const f=fixture(),result=await runBrowserWorkflow({text:request,dispatch:f.dispatch});
  assert.equal(result.handled,true);assert.equal(result.answer,'Closed 2 Gmail tabs.');
  assert.deepEqual(f.calls,[{name:'browser_list_tabs',args:{browser:'opera'}},{name:'browser_close_tabs',args:{snapshot:'before',tab_ids:[1,2]}}]);
  assert.equal(verifyBrowserCompletion(request,result.events).decision,'complete');
});
test('host selection ignores spoofed titles, suffixes, subdomains, userinfo and non-web schemes',async()=>{
  const urls=['https://mail.google.com.attacker.test/mail/','https://evilmail.google.com/mail/','https://mail.google.com@attacker.test/','https://attacker.test/?site=mail.google.com','https://attacker.test/#mail.google.com','https://name:password@mail.google.com/mail/','file://mail.google.com/mail/','not a URL'];
  const f=fixture({initial:list([tab(1),tab(2),...urls.map((url,i)=>tab(i+3,url,{title:'Gmail'}))])});
  const result=await runBrowserWorkflow({text:request,dispatch:f.dispatch});assert.equal(result.handled,true);assert.deepEqual(f.calls[1].args.tab_ids,[1,2]);
});
test('literal domains match exactly while documented aliases support their exact hosts',async()=>{
  const f=fixture({initial:list([tab(1,'https://example.com/a'),tab(2,'https://www.example.com/a'),tab(3,'https://sub.example.com/a')])});
  assert.equal((await runBrowserWorkflow({text:'close example.com tabs',dispatch:f.dispatch})).handled,true);assert.deepEqual(f.calls[1].args.tab_ids,[1]);
  const y=fixture({initial:list([tab(4,'https://youtube.com/watch?v=1'),tab(5,'https://www.youtube.com/watch?v=2'),tab(6,'https://music.youtube.com')])});
  await runBrowserWorkflow({text:'close both YouTube tabs',dispatch:y.dispatch});assert.deepEqual(y.calls[1].args.tab_ids,[4,5]);
});
test('count mismatch, missing tabs, pinned tabs and batch limits never send close input or fall back to guessing',async()=>{
  for(const [text,tabs,pattern] of [[request,[tab(1)],/asked for 2/],[request,[tab(1),tab(2),tab(3)],/asked for 2/],['close Gmail tabs',[],/No Gmail tabs/],[request,[tab(1),tab(2,undefined,{pinned:true})],/pinned/],['close all Gmail tabs',Array.from({length:21},(_,i)=>tab(i)),/up to 20/]]){
    const f=fixture({initial:list(tabs)}),result=await runBrowserWorkflow({text,dispatch:f.dispatch});assert.equal(result.handled,true);assert.match(result.answer,pattern);assert.equal(f.calls.length,1);
  }
  const f=fixture(),result=await runBrowserWorkflow({text:'close 21 Gmail tabs',dispatch:f.dispatch});assert.equal(result.handled,true);assert.equal(f.calls.length,0);
});
test('ambiguous, incomplete, wrong-browser or malformed inventories stop without closing',async()=>{
  for(const initial of [list([],{status:'ambiguous'}),list([],{complete:false}),list([],{degraded:true}),list([],{truncated:true}),list([],{browser:'chrome'}),list([tab(1),tab(1)]),list([tab(1,undefined,{pinned:undefined})])]){
    const f=fixture({initial}),result=await runBrowserWorkflow({text:request,dispatch:f.dispatch});assert.equal(result.handled,true);assert.equal(f.calls.length,1);assert.match(result.answer,/no tabs were closed/i);
  }
});
test('unavailable bridge falls back with actual evidence and no mutation',async()=>{
  for(const status of ['disconnected','unavailable','not_connected','error']){
    const f=fixture({initial:{status,message:'Not connected'}}),result=await runBrowserWorkflow({text:request,dispatch:f.dispatch});assert.equal(result.handled,false);assert.equal(result.events[0].output.status,status);assert.equal(f.calls.length,1);
  }
});
test('uncertain, partial or mismatched closure never claims success and never replays',async()=>{
  for(const close of [{status:'error',outcome_unknown:true},{status:'partial',closed_ids:[1]},{verified:false},{closed_ids:[1]},{closed_ids:[1,2,3]},{requires_review:true},{observation:list([tab(2),tab(3,'https://example.com')],{snapshot:'after'})},{observation:list([],{snapshot:'after'})}]){
    const f=fixture({close}),result=await runBrowserWorkflow({text:request,dispatch:f.dispatch});assert.equal(result.handled,false);assert.equal(f.calls.length,2);assert.match(result.reason,/never replay/);assert.equal(result.events.length,2);
  }
});
test('verification rejects stale, different-browser or reconnected-session observations',async()=>{
  const good=await runBrowserWorkflow({text:request,dispatch:fixture().dispatch});
  for(const override of [{snapshot:'before'},{snapshot:''},{browser:'chrome'},{session_id:'another-session'},{session_id:undefined},{complete:false},{status:'error'},{outcome_unknown:true}]){
    const events=structuredClone(good.events);Object.assign(events[1].output.observation,override);assert.equal(verifyBrowserCompletion(request,events),null,JSON.stringify(override));
  }
  for(const override of [{snapshot:'not-listed'},{tab_ids:[1]},{tab_ids:[1,1]},{tab_ids:[1,2,3]}]){
    const events=structuredClone(good.events);Object.assign(events[1].args,override);assert.equal(verifyBrowserCompletion(request,events),null,JSON.stringify(override));
  }
  assert.equal(verifyBrowserCompletion(request,good.events.slice(1)),null);
});
test('a final read may confirm closure but cannot conceal an error or changed browser context',async()=>{
  const good=await runBrowserWorkflow({text:request,dispatch:fixture().dispatch});
  const read={name:'browser_list_tabs',args:{browser:'opera'},output:{...good.events[1].output.observation,snapshot:'later'}};
  assert.equal(verifyBrowserCompletion(request,[...good.events,read]).decision,'complete');
  for(const event of [{...read,output:{status:'error'}},{...read,args:{browser:'chrome'}},{name:'computer_input',args:{kind:'hotkey'},output:{status:'verified'}},{...read,output:{...read.output,tabs:[tab(1),tab(3,'https://example.com')]}}])assert.equal(verifyBrowserCompletion(request,[...good.events,event]),null);
});
test('cancellation before and during discovery prevents the close batch',async()=>{
  const first=new AbortController();first.abort();await assert.rejects(runBrowserWorkflow({text:request,context:{signal:first.signal},dispatch:()=>assert.fail('No discovery after Stop')}),/abort/i);
  const controller=new AbortController();let calls=0;
  await assert.rejects(runBrowserWorkflow({text:request,context:{signal:controller.signal},dispatch:async()=>{calls++;controller.abort();return list([tab(1),tab(2)]);}}),/abort/i);assert.equal(calls,1);
});
test('dispatch failure preserves uncertain attempted IDs without repeating the batch',async()=>{
  let calls=0;const result=await runBrowserWorkflow({text:request,dispatch:async(name)=>{calls++;if(name==='browser_list_tabs')return list([tab(1),tab(2)]);throw Error('Connection lost after delivery');}});
  assert.equal(result.handled,false);assert.equal(calls,2);assert.equal(result.events[1].output.outcome_unknown,true);assert.deepEqual(result.events[1].args.tab_ids,[1,2]);
});

function activationFixture({initial=list([tab(1),tab(2,'https://example.com')]),activated={}}={}){
  const calls=[];
  const dispatch=async(name,args)=>{
    calls.push({name,args});if(name==='browser_list_tabs')return initial;
    assert.equal(name,'browser_activate_tab');
    return {status:'activated',verified:true,active_id:args.tab_id,observation:{...initial,snapshot:'activated',tabs:initial.tabs.map(tab=>({...tab,active:tab.tab_id===args.tab_id}))},...activated};
  };
  return {calls,dispatch};
}
test('exact tab-switch requests activate a unique observed site with no model, navigation or screenshot',async()=>{
  for(const text of ['switch to the Gmail tab in Opera GX','focus my Gmail tab on Opera','activate Gmail tab','go to the Gmail tab']){
    const plan=parseBrowserWorkflow(text);assert.equal(plan.kind,'activate_tab');assert.equal(plan.expectedCount,1);
    const f=activationFixture(),result=await runBrowserWorkflow({text,dispatch:f.dispatch});
    assert.equal(result.handled,true);assert.equal(result.answer,'Your Gmail tab is in front.');
    assert.deepEqual(f.calls[1],{name:'browser_activate_tab',args:{snapshot:'before',tab_id:1}});assert.equal(f.calls.length,2);
    assert.equal(verifyBrowserCompletion(text,result.events).decision,'complete');
  }
});
test('activation parsing keeps full request scope and exact-host matching',async()=>{
  for(const text of ['switch to Gmail','switch to the Gmail tab and send a message','switch to the Gmail tab then close it','focus two Gmail tabs','go to the Gmail tab in Firefox','focus https://mail.google.com tab'])assert.equal(parseBrowserWorkflow(text),null,text);
  const f=activationFixture({initial:list([tab(1,'https://mail.google.com.attacker.test',{title:'Gmail'}),tab(2)])});
  assert.equal((await runBrowserWorkflow({text:'switch to Gmail tab',dispatch:f.dispatch})).handled,true);assert.equal(f.calls[1].args.tab_id,2);
});
test('ambiguous, missing, pinned and incomplete browser targets never switch arbitrarily',async()=>{
  for(const initial of [list([]),list([tab(1),tab(2)]),list([tab(1,undefined,{pinned:true})]),list([tab(1)],{complete:false}),list([tab(1)],{status:'ambiguous'}),list([tab(1)],{browser:'chrome'}),list([tab(1)],{session_id:'s',truncated:true})]){
    const f=activationFixture({initial}),result=await runBrowserWorkflow({text:'switch to the Gmail tab in Opera',dispatch:f.dispatch});
    assert.equal(result.handled,true);assert.equal(f.calls.length,1);assert.notEqual(result.answer,'Your Gmail tab is in front.');
  }
});
test('activation verifies active identity, URL, browser session and fresh inventory before claiming success',async()=>{
  const good=await runBrowserWorkflow({text:'switch to Gmail tab',dispatch:activationFixture().dispatch});
  for(const activated of [{verified:false},{status:'unverified'},{outcome_unknown:true},{active_id:2}]){
    const f=activationFixture({activated}),result=await runBrowserWorkflow({text:'switch to Gmail tab',dispatch:f.dispatch});assert.equal(result.handled,false);assert.equal(f.calls.length,2);
  }
  for(const override of [{snapshot:'before'},{session_id:'new-session'},{browser:'chrome'},{complete:false},{tabs:[tab(1,undefined,{active:false}),tab(2,'https://example.com')]},{tabs:[tab(1,'https://attacker.test',{active:true}),tab(2,'https://example.com')]},{tabs:[tab(1,undefined,{active:true,window_id:99}),tab(2,'https://example.com')]},{tabs:[tab(1,undefined,{active:true})]}]){
    const events=structuredClone(good.events);Object.assign(events.at(-1).output.observation,override);assert.equal(verifyBrowserCompletion('switch to Gmail tab',events),null,JSON.stringify(override));
  }
  assert.equal(verifyBrowserCompletion('switch to Gmail tab',good.events.slice(1)),null);
});
test('tab activation honors cancellation and never retries a lost dispatch result',async()=>{
  const controller=new AbortController(),f=activationFixture();
  await assert.rejects(runBrowserWorkflow({text:'switch to Gmail tab',context:{signal:controller.signal},dispatch:async(name,args)=>{const result=await f.dispatch(name,args);controller.abort();return result;}}),/abort/i);assert.equal(f.calls.length,1);
  let calls=0;const result=await runBrowserWorkflow({text:'switch to Gmail tab',dispatch:async(name,args)=>{calls++;if(name==='browser_activate_tab')throw Error('Lost reply');return activationFixture().dispatch(name,args);}});
  assert.equal(calls,2);assert.equal(result.handled,false);assert.equal(result.events.at(-1).output.outcome_unknown,true);
});
test('tab activation runs through the real AI router without keys, model calls or a review round trip',async()=>{
  const {AI}=require('../ai'),{validateTool}=require('../core'),f=activationFixture();
  const ai=new AI(()=>({chatProvider:'deepseek',allowDesktop:true,allowScreen:false}),()=>assert.fail('No credentials'),async(name,args)=>{validateTool(name,args);return f.dispatch(name,args);},()=>assert.fail('No network'));
  ai.reviewDesktop=()=>assert.fail('No review for verified tab activation');
  assert.equal(await ai.chat('switch to the Gmail tab in Opera'),'Your Gmail tab is in front.');assert.equal(ai.lastTaskTiming.route,'browser');assert.equal(ai.lastTaskTiming.modelRequests,0);assert.equal(ai.lastTaskTiming.toolCalls,2);
});
