const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseDesktopWorkflow,runDesktopWorkflow,verifyDesktopCompletion}=require('../desktop-workflows');
const window={pid:10,window_id:20,title:'Calculator'};
const state=(controls,overrides={})=>({status:'inspected',snapshot:'initial',window:{...window},controls,degraded:false,truncated:false,focus_verified:true,...overrides});
const control=(name,index,type='Button',rest={})=>({control_id:String(index),name,type,enabled:true,protected:false,editable:false,...rest});
const buttonNames=['Clear','Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Decimal separator','Plus','Minus','Multiply by','Divide by','Equals'];
function calculator(display='0',language='en'){
  const names=language==='fr'?['Effacer','Zéro','Un','Deux','Trois','Quatre','Cinq','Six','Sept','Huit','Neuf','Séparateur décimal','Plus','Moins','Multiplier par','Diviser par','Est égal à']:buttonNames;
  return state([...names.map((name,i)=>control(name,i)),control((language==='fr'?'L’affichage est ':'Display is ')+display,99,'Text')],{window:{...window,title:language==='fr'?'Calculatrice':'Calculator'}});
}
function fixture({initial=calculator(),answer=calculator('282'),catalog=[{name:'Calculator',app_id:'Microsoft.WindowsCalculator_fixture!App'}],openStatus='opened',action={}}={}){
  const calls=[];const dispatch=async(name,args)=>{
    calls.push({name,args});
    if(name==='list_apps')return {status:'ok',apps:catalog};
    if(name==='open_app')return {status:openStatus,observation:initial};
    if(name==='computer_action_sequence')return {status:'unverified',completed:args.actions.length,observation:{...answer,snapshot:'final'},...action};
    if(name==='computer_action')return {status:'verified',verified:true,observation:{...answer,snapshot:'final'},...action};
    assert.fail('Unexpected tool '+name);
  };return {dispatch,calls};
}
const calculation='open calculator and do this calculation 1.5 x 188 and give me the result';
test('whole-request parsing never silently drops an extra task',()=>{
  assert.equal(parseDesktopWorkflow(calculation).expected,'282');
  assert.equal(parseDesktopWorkflow('Please open the Calculator and calculate 0.1 plus 0.2.').expected,'0.3');
  assert.equal(parseDesktopWorkflow('open calculator and calculate 5 / 8').expected,'0.625');
  assert.equal(parseDesktopWorkflow('open calculator and calculate 1 / 3'),null);
  assert.equal(parseDesktopWorkflow('open calculator and calculate 1 / 0'),null);
  for(const text of ['open Instagram and call Omar','open calculator and calculate 1+2 and send the result','open Notepad and write "hello" and save it','open Notepad and write a poem','open Instagram and go to messages and delete a message'])assert.equal(parseDesktopWorkflow(text),null,text);
});
test('calculator executes one grounded sequence with exact decimal and fresh display verification',async()=>{
  const f=fixture(),result=await runDesktopWorkflow({text:calculation,dispatch:f.dispatch});
  assert.equal(result.handled,true);assert.equal(result.answer,'1.5 × 188 = 282.');
  assert.deepEqual(f.calls.map(c=>c.name),['list_apps','open_app','computer_action_sequence']);
  assert.deepEqual(f.calls[2].args.actions.map(a=>a.expected_name),['Clear','One','Decimal separator','Five','Multiply by','One','Eight','Eight','Equals']);
  assert.equal(result.events.length,3);
});
test('localized Calculator catalog and measured French buttons are supported',async()=>{
  const f=fixture({catalog:[{name:'Calculatrice',app_id:'Microsoft.WindowsCalculator_fixture!App'}],initial:calculator('0','fr'),answer:calculator('0,3','fr')});
  const result=await runDesktopWorkflow({text:'open calculator and calculate 0.1 + 0.2',dispatch:f.dispatch});assert.equal(result.handled,true);assert.equal(result.answer,'0.1 + 0.2 = 0.3.');
});
test('no guessed app IDs or ambiguous app launches',async()=>{
  for(const catalog of [[],[{name:'Calculator Pro',app_id:'unrelated'}],[{name:'Calculator',app_id:'one'},{name:'Calculator',app_id:'two'}]]){
    const f=fixture({catalog}),result=await runDesktopWorkflow({text:calculation,dispatch:f.dispatch});assert.equal(result.handled,false);assert.equal(f.calls.some(c=>c.name==='open_app'),false);
  }
});
test('an unconfirmed launch or inaccessible/unfocused app cannot run input or claim success',async()=>{
  for(const overrides of [{openStatus:'launch_requested'},{initial:calculator('0'),openStatus:'error'},{initial:{...calculator(),focus_verified:false}},{initial:{...calculator(),controls:[]}},{initial:{...calculator(),degraded:true}}]){
    const f=fixture(overrides),result=await runDesktopWorkflow({text:calculation,dispatch:f.dispatch});assert.equal(result.handled,false);assert.equal(f.calls.length,2);
  }
});
test('missing or duplicate keypad controls fall back before any input',async()=>{
  for(const initial of [state(calculator().controls.filter(c=>c.name!=='Equals')),state([...calculator().controls,control('Eight',101)])]){
    const f=fixture({initial}),result=await runDesktopWorkflow({text:calculation,dispatch:f.dispatch});assert.equal(result.handled,false);assert.equal(f.calls.length,2);
  }
});
test('wrong result, uncertain delivery, incomplete sequence or changed window cannot claim success or replay',async()=>{
  for(const overrides of [{answer:calculator('283')},{action:{outcome_unknown:true}},{action:{completed:2}},{answer:{...calculator('282'),window:{...window,window_id:999}}},{answer:{...calculator('282'),truncated:true}},{action:{status:'interrupted'}}]){
    const f=fixture(overrides),result=await runDesktopWorkflow({text:calculation,dispatch:f.dispatch});assert.equal(result.handled,false);assert.equal(f.calls.length,3);assert.equal(result.events.length,3);
  }
});
test('verified local calculation still requires the exact requested keypad sequence',async()=>{
  const f=fixture(),result=await runDesktopWorkflow({text:calculation,dispatch:f.dispatch});
  result.events.at(-1).args.actions=[result.events.at(-1).args.actions.at(-1)];result.events.at(-1).output.completed=1;
  assert.equal(verifyDesktopCompletion(calculation,result.events),null);
});
test('a read after the action can verify completion but cannot hide a later failed action',async()=>{
  const f=fixture(),result=await runDesktopWorkflow({text:calculation,dispatch:f.dispatch});
  result.events.push({name:'computer_inspect_window',args:{pid:10,window_id:20},output:{...calculator('282'),snapshot:'reread'}});
  assert.equal(verifyDesktopCompletion(calculation,result.events).decision,'complete');
  result.events.splice(-1,0,{name:'computer_action',args:{kind:'click'},output:{status:'error',outcome_unknown:true}});
  assert.equal(verifyDesktopCompletion(calculation,result.events),null);
});
test('exact open request completes from focused observed app, not launch delivery',async()=>{
  const f=fixture(),result=await runDesktopWorkflow({text:'open the calculator',dispatch:f.dispatch});assert.equal(result.handled,true);assert.equal(result.answer,'calculator is open.');assert.equal(f.calls.length,2);
});
test('completion requires one observed catalog match for the exact opened app ID',()=>{
  const observed={name:'list_apps',args:{query:'calculator'},output:{status:'ok',apps:[{name:'Calculator',app_id:'calc'}]}};
  const opened={name:'open_app',args:{app_id:'calc'},output:{status:'opened',observation:calculator()}};
  assert.equal(verifyDesktopCompletion('open Calculator',[observed,opened]).decision,'complete');
  for(const [label,events] of [
    ['missing catalog',[opened]],
    ['unrelated opened ID despite matching window title',[observed,{...opened,args:{app_id:'unrelated-app'},output:{...opened.output,app:'Unrelated App'}}]],
    ['unrelated catalog name',[{...observed,output:{status:'ok',apps:[{name:'Unrelated App',app_id:'calc'}]}},opened]],
    ['ambiguous exact names',[{...observed,output:{status:'ok',apps:[{name:'Calculator',app_id:'calc'},{name:'Calculator',app_id:'other-calc'}]}},opened]],
    ['catalog observed after launch',[opened,observed,{name:'computer_inspect_window',args:{},output:calculator()}]],
  ])assert.equal(verifyDesktopCompletion('open Calculator',events),null,label);
});
test('a failed, partial or more recent conflicting catalog cannot prove app identity',()=>{
  const observed={name:'list_apps',args:{query:'calculator'},output:{status:'ok',apps:[{name:'Calculator',app_id:'calc'}]}};
  const opened={name:'open_app',args:{app_id:'calc'},output:{status:'opened',observation:calculator()}};
  for(const overrides of [{status:'error'},{status:'unverified'},{truncated:true},{degraded:true},{requires_review:true},{apps:Array.from({length:60},(_,i)=>({name:i?'Other '+i:'Calculator',app_id:i?'other-'+i:'calc'}))},{apps:[]}]){
    const latest={...observed,output:{...observed.output,...overrides}};
    assert.equal(verifyDesktopCompletion('open Calculator',[observed,latest,opened]),null,JSON.stringify(overrides));
  }
});
test('even the exact calculation readback requires matching catalog provenance',async()=>{
  const f=fixture(),result=await runDesktopWorkflow({text:calculation,dispatch:f.dispatch});
  assert.equal(verifyDesktopCompletion(calculation,result.events.slice(1)),null);
  result.events[1].args.app_id='unrelated-app';
  assert.equal(verifyDesktopCompletion(calculation,result.events),null);
});
function notepad(value=''){return state([control('Text Editor',5,'Document',{editable:true,value})],{window:{...window,title:'Untitled - Notepad'}});}
test('quoted text uses one exact document control and verifies literal readback',async()=>{
  const text='<img src=x> & hello';const f=fixture({catalog:[{name:'Notepad',app_id:'notepad'}],initial:notepad(),answer:notepad(text)});
  const result=await runDesktopWorkflow({text:`open Notepad and write "${text}"`,dispatch:f.dispatch});assert.equal(result.handled,true);assert.equal(result.answer,'The text is in Notepad.');
  assert.equal(f.calls[2].args.text,text);assert.equal(f.calls[2].args.kind,'type');assert.equal(f.calls.some(c=>c.args.key==='Return'),false);
});
test('browser document URL is not a second text editor or a writable user document',async()=>{
  const root=control('Notepad',99,'Document',{editable:true,value:'file:///test/fixture.html'});
  const initial=notepad(),answer=notepad('new');initial.controls.unshift(root);answer.controls.unshift(root);
  const f=fixture({catalog:[{name:'Notepad',app_id:'notepad'}],initial,answer});
  assert.equal((await runDesktopWorkflow({text:'open Notepad and write "new"',dispatch:f.dispatch})).handled,true);
  assert.notEqual(f.calls[2].args.control_id,'99');
  const onlyRoot=fixture({catalog:[{name:'Notepad',app_id:'notepad'}],initial:{...initial,controls:[root]}});
  assert.equal((await runDesktopWorkflow({text:'open Notepad and write "new"',dispatch:onlyRoot.dispatch})).handled,false);
  assert.equal(onlyRoot.calls.length,2);
});
test('writing does not overwrite existing text without explicit replacement',async()=>{
  const f=fixture({catalog:[{name:'Notepad',app_id:'notepad'}],initial:notepad('existing text'),answer:notepad('new')});
  let result=await runDesktopWorkflow({text:'open Notepad and write "new"',dispatch:f.dispatch});assert.equal(result.handled,false);assert.equal(f.calls.length,2);
  result=await runDesktopWorkflow({text:'open Notepad and replace its text with "new"',dispatch:f.dispatch});assert.equal(result.handled,true);
});
test('Notepad search fields, protected fields or wrong readback never satisfy document writing',async()=>{
  const catalog=[{name:'Notepad',app_id:'notepad'}];
  for(const initial of [state([control('Search',3,'Edit',{editable:true,value:''})],{window:{...window,title:'Notepad'}}),state([control('Text Editor',3,'Document',{editable:true,protected:true,value:''})],{window:{...window,title:'Notepad'}})]){
    const f=fixture({catalog,initial,answer:notepad('new')}),result=await runDesktopWorkflow({text:'open Notepad and write "new"',dispatch:f.dispatch});assert.equal(result.handled,false);assert.equal(f.calls.length,2);
  }
  const f=fixture({catalog,initial:notepad(),answer:notepad('wrong')}),result=await runDesktopWorkflow({text:'open Notepad and write "new"',dispatch:f.dispatch});assert.equal(result.handled,false);assert.equal(f.calls.length,3);
});
function instagram(controls){return state(controls,{window:{...window,title:'Instagram'}});}
test('Instagram navigation requires new destination content, not a sidebar label or accepted click',async()=>{
  const initial=instagram([control('Messages',1,'Link')]),catalog=[{name:'Instagram',app_id:'instagram'}];
  const f=fixture({catalog,initial,answer:instagram([control('Messages',1,'Link'),control('Your messages',8,'Heading')])});
  assert.equal((await runDesktopWorkflow({text:'open Instagram and go to my messages',dispatch:f.dispatch})).handled,true);
  const unchanged=fixture({catalog,initial,answer:initial});assert.equal((await runDesktopWorkflow({text:'open Instagram and go to my messages',dispatch:unchanged.dispatch})).handled,false);assert.equal(unchanged.calls.length,3);
});
test('cancellation after discovery prevents opening and propagates to the caller',async()=>{
  const controller=new AbortController();let calls=0;
  const dispatch=async()=>{calls++;controller.abort(new Error('Stopped'));return {status:'ok',apps:[{name:'Calculator',app_id:'calc'}]};};
  await assert.rejects(runDesktopWorkflow({text:calculation,dispatch,context:{signal:controller.signal}}),/Stopped/);assert.equal(calls,1);
});
test('a thrown mutation failure is recorded as uncertain and never retried',async()=>{
  const f=fixture();let inputs=0;
  const dispatch=async(name,args,context)=>{if(name==='computer_action_sequence'){inputs++;throw Error('Connection lost after input');}return f.dispatch(name,args,context);};
  const result=await runDesktopWorkflow({text:calculation,dispatch});assert.equal(result.handled,false);assert.equal(inputs,1);assert.equal(result.events.at(-1).output.outcome_unknown,true);
});
test('unsupported requests perform no actions and preserve general agent fallback',async()=>{
  let calls=0;const result=await runDesktopWorkflow({text:'organize my files and email the summary',dispatch:async()=>calls++});assert.equal(result.handled,false);assert.equal(calls,0);assert.deepEqual(result.events,[]);
});

function focusFixture({windows=[{pid:42,window_id:123,title:'Untitled - Notepad',app:'Notepad.exe',minimized:true}],inventory={},focused={}}={}){
  const calls=[];
  const dispatch=async(name,args)=>{
    calls.push({name,args});
    if(name==='computer_list_windows')return {status:'ok',windows,degraded:false,truncated:false,...inventory};
    assert.equal(name,'computer_focus_window');
    return {status:'inspected',snapshot:'focused',window:{pid:args.pid,window_id:args.window_id,title:windows[0].title},controls:[],focused:true,focus_verified:true,...focused};
  };
  return {calls,dispatch};
}
test('focus router accepts complete existing-window commands and rejects extra tasks or tab requests',()=>{
  for(const text of ['switch to Notepad','Please focus the Notepad app.','restore Notepad','bring the Notepad window to the front','bring Notepad to foreground'])assert.deepEqual(parseDesktopWorkflow(text),{kind:'focus',app:'Notepad'},text);
  for(const text of ['switch to the Gmail tab','focus Notepad and save it','restore all Calculator windows','bring Notepad to the front then type hello','switch to Notepad\nclose it'])assert.equal(parseDesktopWorkflow(text),null,text);
});
test('focus workflow brings one exact existing window forward without launching, clicking or requiring accessible controls',async()=>{
  const f=focusFixture(),result=await runDesktopWorkflow({text:'switch to Notepad',dispatch:f.dispatch});
  assert.equal(result.handled,true);assert.equal(result.answer,'Notepad is in front.');
  assert.deepEqual(f.calls,[{name:'computer_list_windows',args:{query:''}},{name:'computer_focus_window',args:{pid:42,window_id:123}}]);
  assert.equal(verifyDesktopCompletion('switch to Notepad',result.events).decision,'complete');
});
test('native focus uses localized aliases and exact app identity, never substring title matches',async()=>{
  const f=focusFixture({windows:[{pid:42,window_id:123,title:'Calculatrice',app:'ApplicationFrameHost.exe',minimized:true},{pid:50,window_id:100,title:'Calculator Pro',app:'Other.exe'}]});
  assert.equal((await runDesktopWorkflow({text:'restore Calculator',dispatch:f.dispatch})).handled,true);assert.equal(f.calls[1].args.window_id,123);
  const named=focusFixture({windows:[{pid:42,window_id:123,title:'Notes',app:'Notepad.exe'}]});
  assert.equal((await runDesktopWorkflow({text:'focus Notepad',dispatch:named.dispatch})).handled,true);
});
test('missing, ambiguous, malformed or partial window inventory never focuses a guessed window',async()=>{
  for(const options of [{windows:[]},{windows:[{pid:1,window_id:2,title:'Notepad'},{pid:3,window_id:4,title:'Other - Notepad'}]},{windows:[{pid:1,window_id:2,title:'Notepad Pro'}]},{inventory:{truncated:true}},{inventory:{status:'partial'}},{windows:[{pid:1,window_id:'2',title:'Notepad'}]},{windows:[{pid:1,window_id:2,title:'Notepad'},{pid:1,window_id:2,title:'Notepad'}]}]){
    const f=focusFixture(options),result=await runDesktopWorkflow({text:'focus Notepad',dispatch:f.dispatch});
    assert.equal(f.calls.length,1);assert.notEqual(result.answer,'Notepad is in front.');
  }
});
test('native focus completion requires foreground confirmation tied to the exact observed identity and fresh event',async()=>{
  for(const focused of [{focus_verified:false},{focused:false},{window:{pid:42,window_id:999,title:'Notepad'}},{status:'error'},{outcome_unknown:true},{snapshot_superseded:true}]){
    const f=focusFixture({focused}),result=await runDesktopWorkflow({text:'focus Notepad',dispatch:f.dispatch});assert.equal(result.handled,true);assert.match(result.answer,/did not confirm/);assert.equal(verifyDesktopCompletion('focus Notepad',result.events),null);assert.equal(f.calls.length,2);
  }
  const result=await runDesktopWorkflow({text:'focus Notepad',dispatch:focusFixture().dispatch});
  assert.equal(verifyDesktopCompletion('focus Notepad',result.events.slice(1)),null);
  result.events.push({name:'computer_list_windows',args:{query:''},output:{status:'ok',windows:[]}});
  assert.equal(verifyDesktopCompletion('focus Notepad',result.events),null);
});
test('cancelled focus discovery never raises a window and thrown focus is never retried',async()=>{
  const controller=new AbortController(),f=focusFixture();
  await assert.rejects(runDesktopWorkflow({text:'focus Notepad',context:{signal:controller.signal},dispatch:async(name,args)=>{const result=await f.dispatch(name,args);controller.abort();return result;}}),/abort/i);assert.equal(f.calls.length,1);
  let calls=0;const result=await runDesktopWorkflow({text:'focus Notepad',dispatch:async(name,args)=>{calls++;if(name==='computer_focus_window')throw Error('Lost result');return focusFixture().dispatch(name,args);}});
  assert.equal(calls,2);assert.equal(result.handled,true);assert.match(result.answer,/did not repeat/);assert.equal(result.events.at(-1).output.outcome_unknown,true);
});
test('existing-app focus runs through the real AI router with zero model requests, including an unverified outcome',async()=>{
  const {AI}=require('../ai'),{validateTool}=require('../core');
  for(const focused of [{},{focus_verified:false}]){
    const f=focusFixture({focused});
    const ai=new AI(()=>({chatProvider:'chatgpt',allowDesktop:true,allowScreen:false}),()=>assert.fail('No credentials needed'),async(name,args)=>{validateTool(name,args);return f.dispatch(name,args);},()=>assert.fail('No network call'));
    ai.reviewDesktop=()=>assert.fail('No AI review for an exact focus-only request');
    const answer=await ai.chat('switch to Notepad');
    assert.match(answer,focused.focus_verified===false?/did not confirm/:/is in front/);assert.equal(ai.lastTaskTiming.modelRequests,0);assert.equal(ai.lastTaskTiming.toolCalls,2);
  }
});
