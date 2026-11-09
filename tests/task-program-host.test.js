'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTaskProgramHost,prepareTaskContext,normalizeFrame,validateTarget}=require('../task-program-host');
const window={pid:100,window_id:10,title:'Records',app:'Records.exe',minimized:false};
const windows=(rows=[window])=>({status:'ok',degraded:false,truncated:false,windows:rows});
const native=(extra={})=>({status:'inspected',snapshot:'native-frame',window:{...window},degraded:false,truncated:false,controls:[{control_id:'0',name:'Name',type:'Edit',editable:true,enabled:true,value:'Alpha'},{control_id:'1',name:'Save',type:'Button',enabled:true}],...extra});
const tab={tab_id:7,window_id:9,title:'Records - example.test',url:'https://example.test/records',pinned:false,active:true};
const tabs=(rows=[tab],extra={})=>({status:'ok',snapshot:'tab-inventory',complete:true,browser:'opera',session_id:'profile-session',tabs:rows,...extra});
const page=(extra={})=>({status:'observed',source:'browser_dom',snapshot:'page-frame',complete:true,browser:'opera',session_id:'profile-session',tab_id:7,url:'https://example.test/records',document_id:'doc-1',controls:[{id:'1',role:'button',name:'Save',enabled:true}],...extra});
const steps=[{op:'fill',target:{name:'Name',role:'textbox'},text:'Beta'}];
const completion=[{target:{name:'Name',role:'textbox'},condition:'value',value:'Beta'}];

test('native binding and phases use existing guarded dispatch with fresh symbolic controls',async()=>{
  const calls=[];let now=0;
  const host=createTaskProgramHost({now:()=>now,context:{activityScope:'owned'},dispatch:async(name,args,context)=>{
    calls.push({name,args});assert.equal(context.activityScope,'owned');assert.equal(context.fromModel,true);
    if(name==='computer_list_windows')return windows();
    if(name==='computer_inspect_window')return native();
    assert.equal(name,'computer_execute_plan');assert.equal(args.snapshot,'native-frame');assert.equal(args.final,false);
    return {status:'completed',verified:true,observation:native({snapshot:'after',controls:[{control_id:'4',name:'Name',type:'Edit',value:'Beta',editable:true}]})};
  }});
  const bound=await host.bind({kind:'native',app:'Records'});assert.equal(bound.complete,true);assert.equal(bound.controls[0].role,'textbox');
  const result=await host.perform(steps,completion);assert.equal(result.observation.snapshot,'after');
  assert.equal((await host.observe()).snapshot,'after');assert.equal(calls.length,3,'Fresh returned observations do not cause a redundant read');
  now=800;await host.observe();assert.equal(calls.at(-1).name,'computer_inspect_window');
});
test('native value reads focus the exact bound window then inspect its fresh foreground controls',async()=>{
  const calls=[];let foreground=false;
  const host=createTaskProgramHost({dispatch:async(name,args)=>{calls.push(name);if(name==='computer_list_windows')return windows();assert.deepEqual(args,{pid:100,window_id:10});if(name==='computer_focus_window'){foreground=true;return native({focus_verified:true});}return native({controls:[{name:'Name',type:'Edit',value:foreground?'Fresh value':'Stale background value'}]});}});
  await host.bind({kind:'native',app:'Records'});assert.equal((await host.observe()).controls[0].value,'Stale background value');
  assert.equal((await host.observe({refresh:true,forRead:true})).controls[0].value,'Fresh value');assert.deepEqual(calls,['computer_list_windows','computer_inspect_window','computer_focus_window','computer_inspect_window']);
});
test('failed or cancelled native read focus cannot continue inspecting or sending input',async()=>{
  for(const mode of ['wrong-window','cancel']){
    const controller=new AbortController(),calls=[];
    const host=createTaskProgramHost({context:{signal:controller.signal},dispatch:async name=>{calls.push(name);if(name==='computer_list_windows')return windows();if(name==='computer_inspect_window')return native();if(mode==='cancel'){controller.abort();return native({focus_verified:true});}return native({focus_verified:true,window:{...window,window_id:11}});}});
    await host.bind({kind:'native',app:'Records'});await assert.rejects(host.observe({refresh:true,forRead:true}));assert.equal(host.blocked,true);assert.equal(calls.filter(name=>name==='computer_inspect_window').length,1);await assert.rejects(host.perform(steps,completion));assert.ok(!calls.includes('computer_execute_plan'));
  }
});

test('native binding refuses ambiguous or incomplete inventories before input',async()=>{
  for(const listed of [windows([window,{...window,window_id:11}]),{...windows(),truncated:true}]){
    let calls=0;const host=createTaskProgramHost({dispatch:async name=>{calls++;assert.equal(name,'computer_list_windows');return listed;}});
    await assert.rejects(host.bind({kind:'native',app:'Records'}),/More than one|incomplete/);assert.equal(calls,1);
  }
});

test('native open-if-missing resolves exact catalog identity and reuses confirmed launch observation',async()=>{
  const calls=[];
  const host=createTaskProgramHost({dispatch:async(name,args)=>{calls.push(name);if(name==='computer_list_windows')return windows([]);if(name==='list_apps')return {status:'ok',apps:[{name:'Records',app_id:'records!app'},{name:'Other Records',app_id:'other!app'}]};assert.equal(args.app_id,'records!app');return {status:'opened',observation:native({focus_verified:true})};}});
  assert.equal((await host.bind({kind:'native',app:'Records',open_if_missing:true})).snapshot,'native-frame');
  assert.deepEqual(calls,['computer_list_windows','list_apps','open_app']);
});

test('an unconfirmed launch blocks any later input rather than launching or focusing again',async()=>{
  let mutations=0;
  const host=createTaskProgramHost({dispatch:async name=>name==='computer_list_windows'?windows([]):name==='list_apps'?{status:'ok',apps:[{name:'Records',app_id:'records'}]}:(mutations++,{status:'launch_requested'})});
  await assert.rejects(host.bind({kind:'native',app:'Records',open_if_missing:true}),/not confirmed/);
  await assert.rejects(host.perform(steps,completion),/unknown result/);assert.equal(mutations,1);assert.equal(host.blocked,true);
});

test('minimized binding restores exact observed identity, while read-only preparation does not restore',async()=>{
  const calls=[];const dispatch=async(name,args)=>{calls.push(name);if(name==='computer_list_windows')return windows([{...window,minimized:true}]);if(name==='browser_list_tabs')return tabs([]);assert.equal(name,'computer_restore_window');assert.deepEqual(args,{pid:100,window_id:10});return native();};
  const prepared=await prepareTaskContext({text:'Edit Records',dispatch});assert.equal(prepared.scopes.length,0);assert.ok(!calls.includes('computer_restore_window'));
  await createTaskProgramHost({dispatch}).bind({kind:'native',app:'Records'});assert.equal(calls.at(-1),'computer_restore_window');
});

test('browser scopes match exact hostname and preserve tab, profile and origin across transitions',async()=>{
  let current=tabs(),currentPage=page(),calls=[];
  const host=createTaskProgramHost({dispatch:async(name,args)=>{calls.push({name,args});return name==='browser_list_tabs'?current:currentPage;}});
  await host.bind({kind:'browser',hostname:'example.test',browser:'opera'});
  current=tabs([{...tab,url:'https://example.test/repositories'}]);currentPage=page({snapshot:'new-page',document_id:'doc-2',url:'https://example.test/repositories'});
  await assert.rejects(host.observe({refresh:true}),/document changed/);
  assert.equal((await host.transition({kind:'same_tab'})).document_id,'doc-2');
  current=tabs([{...tab,url:'https://attacker.test/'}]);await assert.rejects(host.transition({kind:'same_tab'}),/changed origin/);
  current=tabs([tab],{session_id:'reconnected'});await assert.rejects(host.transition({kind:'same_tab'}),/reconnected/);
  assert.ok(calls.every(call=>['browser_list_tabs','browser_read_page'].includes(call.name)));
});

test('browser binding never chooses subdomains, pinned tabs, duplicates or a guessed default-browser launch',async()=>{
  for(const listed of [tabs([{...tab,url:'https://example.test.attacker.test/'}]),tabs([{...tab,pinned:true}]),tabs([tab,{...tab,tab_id:8}])]){
    const host=createTaskProgramHost({dispatch:async name=>{assert.equal(name,'browser_list_tabs');return listed;}});
    await assert.rejects(host.bind({kind:'browser',hostname:'example.test'}),/No existing|More than one/);
  }
  assert.throws(()=>validateTarget({kind:'browser',hostname:'example.test',url:'https://attacker.test/'}),/hostname/);
});

test('a missing browser page opens only through its exact connected inventory capability',async()=>{
  const calls=[];const host=createTaskProgramHost({dispatch:async(name,args)=>{calls.push({name,args});if(name==='browser_list_tabs')return tabs([]);assert.equal(name,'browser_open_tab');assert.deepEqual(args,{snapshot:'tab-inventory',url:'https://example.test/records'});return {status:'opened',verified:true,observation:page({window_id:9})};}});
  assert.equal((await host.bind({kind:'browser',hostname:'example.test',browser:'opera',url:'https://example.test/records',open_if_missing:true})).tab_id,7);assert.equal(calls.length,2);
  const bad=createTaskProgramHost({dispatch:async name=>name==='browser_list_tabs'?tabs([]):{status:'opened',verified:true,observation:page({window_id:9,url:'not a url'})}});
  await assert.rejects(bad.bind({kind:'browser',hostname:'example.test',url:'https://example.test/',open_if_missing:true}),/not confirmed/);assert.equal(bad.blocked,true);
});

test('unknown browser delivery survives fresh read-only transitions and blocks mutation',async()=>{
  const calls=[];
  const host=createTaskProgramHost({dispatch:async name=>{calls.push(name);if(name==='browser_list_tabs')return tabs();if(name==='browser_read_page')return page();return {status:'interrupted',outcome_unknown:true,observation:page(),completed:1,attempted:1};}});
  await host.bind({kind:'browser',hostname:'example.test'});
  const result=await host.perform([{op:'click',target:{name:'Save'}}],[{target:{name:'Save'},condition:'exists'}]);assert.equal(result.outcome_unknown,true);
  await host.transition({kind:'same_tab'});
  await assert.rejects(host.perform([{op:'click',target:{name:'Save'}}],[{target:{name:'Save'},condition:'exists'}]),/unknown result/);
  assert.equal(calls.filter(name=>name==='browser_execute_plan').length,1);
});

test('related popup transition requires exact title and same process or explicit owner',async()=>{
  const popup={pid:101,window_id:20,title:'Call dialog',app:'Other.exe',owner_window_id:10};let listed=windows(),calls=[];
  const host=createTaskProgramHost({dispatch:async(name,args)=>{calls.push(name);if(name==='computer_list_windows')return listed;if(name==='computer_inspect_window')return native();assert.equal(name,'computer_focus_window');assert.deepEqual(args,{pid:101,window_id:20});return native({window:popup,focus_verified:true,focused:true});}});
  await host.bind({kind:'native',app:'Records'});
  listed=windows([window,{...popup,owner_window_id:999}]);await assert.rejects(host.transition({kind:'related_window',title:'Call dialog'}),/No unique/);assert.ok(!calls.includes('computer_focus_window'));
  listed=windows([window,popup]);assert.equal((await host.transition({kind:'related_window',title:'Call dialog'})).window.window_id,20);
});

test('explicit link navigation uses the new guarded tool and validates returned scope',async()=>{
  let result=page({url:'https://example.test/next',document_id:'doc-2'});
  const host=createTaskProgramHost({dispatch:async(name,args)=>{
    if(name==='browser_list_tabs')return tabs();if(name==='browser_read_page')return page();
    assert.equal(name,'browser_follow_link');assert.equal(args.snapshot,'page-frame');assert.deepEqual(args.target,{name:'Next'});assert.equal(args.completion.length,1);
    return {status:'completed',verified:true,observation:result};
  }});
  await host.bind({kind:'browser',hostname:'example.test'});
  const proof=[{target:{name:'Next page'},condition:'exists'}];assert.equal((await host.followLink({name:'Next'},proof)).observation.document_id,'doc-2');
  result=page({url:'https://attacker.test/'});await assert.rejects(host.followLink({name:'Next'},proof),/could not be trusted/);assert.equal(host.blocked,true);
});

test('preparation runs independent inventories in parallel and reads only relevant scope controls',async()=>{
  const pending=[],calls=[];let released=false;
  const preparedPromise=prepareTaskContext({text:'In Records, set the Name to "GitHub"',dispatch:async(name,args)=>{
    calls.push(name);
    if(['computer_list_windows','browser_list_tabs'].includes(name)){await new Promise(resolve=>pending.push(resolve));return name==='computer_list_windows'?windows():tabs([{...tab,url:'https://github.com/user',title:'GitHub'}]);}
    assert.equal(name,'computer_inspect_window');assert.equal(released,true);return native({controls:[{control_id:'0',name:'Password',type:'Edit',protected:true,value:'secret'}]});
  }});
  await Promise.resolve();assert.equal(pending.length,2);released=true;pending.forEach(resolve=>resolve());
  const prepared=await preparedPromise;assert.equal(prepared.scopes.length,1);assert.equal(prepared.scopes[0].target.kind,'native');assert.ok(!calls.includes('browser_read_page'));assert.ok(!JSON.stringify(prepared).includes('secret'));
  assert.ok(prepared.tabs.every(tab=>tab.url===undefined));
});

test('cancelled preparation or binding sends no subsequent reads or input',async()=>{
  const abort=new AbortController();let calls=0;
  const host=createTaskProgramHost({context:{signal:abort.signal},dispatch:async()=>{calls++;abort.abort(Error('Stopped'));return windows();}});
  await assert.rejects(host.bind({kind:'native',app:'Records'}),/Stopped/);assert.equal(calls,1);
  await assert.rejects(prepareTaskContext({text:'Records',dispatch:()=>assert.fail('No calls'),context:{signal:abort.signal}}),/Stopped/);
});

test('incomplete structured views cannot be promoted to actionable complete observations',async()=>{
  assert.equal(normalizeFrame(native({truncated:true})).complete,false);
  const host=createTaskProgramHost({dispatch:async name=>name==='computer_list_windows'?windows():native({degraded:true})});
  await host.bind({kind:'native',app:'Records'});await assert.rejects(host.perform(steps,completion),/incomplete/);
});

test('a mismatched post-input observation blocks the task even if a provider labels it completed',async()=>{
  let mutations=0;
  const host=createTaskProgramHost({dispatch:async name=>name==='computer_list_windows'?windows():name==='computer_inspect_window'?native():(mutations++,{status:'completed',verified:true,observation:native({window:{...window,window_id:99}})})});
  await host.bind({kind:'native',app:'Records'});
  await assert.rejects(host.perform(steps,completion),error=>error.outcome_unknown===true&&error.action_attempted===true);
  await assert.rejects(host.perform(steps,completion),/unknown result/);assert.equal(mutations,1);
});
