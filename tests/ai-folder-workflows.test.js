'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {AI}=require('../ai');
const {validateTool}=require('../core');
const targetPath=String.raw`C:\Users\aymane\Desktop\Operator`;
const found=(rest={})=>({status:'ok',complete:true,snapshot:'folder-snapshot',matches:[{folder_id:'operator-directory',name:'Operator',path:targetPath,open_windows:[]}],...rest});
const opened=(rest={})=>({status:'opened',verified:true,path:targetPath,foreground_verified:true,...rest});
function fixture({discovery=found(),result=opened(),settings={}}={}){
  const calls=[],config={chatProvider:'chatgpt',allowDesktop:true,allowScreen:false,workflowEngine:true,speculativePlanning:true,reuseWorkflows:true,...settings};
  const ai=new AI(()=>config,()=>assert.fail('Folder workflow must not read cloud credentials'),async(name,args,context)=>{
    calls.push({name,args,context});validateTool(name,args);
    assert.ok(['folders_find','folders_open'].includes(name),'No app lookup, screenshots, clicks, or Cua tools are allowed');
    if(name==='folders_find')return discovery;
    return typeof result==='function'?result(args,context):result;
  },()=>assert.fail('Folder workflow must not access the network'),()=>assert.fail('Folder workflow must not read DeepSeek credentials'));
  ai.request=()=>assert.fail('Folder workflow must not request an AI decision');
  ai.reviewDesktop=()=>assert.fail('An exact native folder proof needs no semantic model review');
  ai.prepareContext=()=>assert.fail('Direct folder opening must precede generic desktop preparation');
  return {ai,calls};
}
test('Operator folder uses one find/open pair and zero AI requests in the actual conversation loop',async()=>{
  const {ai,calls}=fixture();let timing;ai.onTaskTiming=value=>timing=value;
  assert.equal(await ai.chat('open operator folder'),`Opened ${targetPath}.`);
  assert.deepEqual(calls.map(({name,args})=>({name,args})),[{name:'folders_find',args:{query:'operator'}},{name:'folders_open',args:{snapshot:'folder-snapshot',folder_id:'operator-directory'}}]);
  assert.equal(timing.route,'folder');assert.equal(timing.modelRequests,0);assert.equal(timing.toolCalls,2);assert.equal(ai.history.length,2);assert.equal(ai.busy,false);
});
test('quoted local path and a confirmed already-open folder stay on the direct route',async()=>{
  const {ai,calls}=fixture({result:opened({status:'focused_existing'})});
  assert.equal(await ai.chat(`open folder "${targetPath}"`),`Opened ${targetPath}.`);
  assert.equal(calls[0].args.query,targetPath);assert.equal(ai.lastTaskTiming.route,'folder');assert.equal(ai.lastTaskTiming.modelRequests,0);
});
test('ambiguous folders and bounded not-found results never invoke AI or choose a path',async()=>{
  for(const [discovery,expected]of [[found({matches:[{folder_id:'one',path:targetPath},{folder_id:'two',path:String.raw`D:\Projects\Operator`}]}),/Which full path/],[found({matches:[]}),/in the searched locations/]]){
    const {ai,calls}=fixture({discovery});assert.match(await ai.chat('Open the Operator folder.'),expected);assert.deepEqual(calls.map(call=>call.name),['folders_find']);assert.equal(ai.lastTaskTiming.route,'folder');assert.equal(ai.lastTaskTiming.modelRequests,0);
  }
});
test('wrong, unsafe, or incomplete discovered paths cannot reach folders_open',async()=>{
  const cases=[found({matches:[{folder_id:'wrong-name',path:String.raw`C:\Operator Backups`}]}),found({matches:[{folder_id:'unc',path:String.raw`\\server\share\Operator`}]}),found({complete:false}),found({truncated:true}),found({snapshot:'x'.repeat(81)})];
  for(const discovery of cases){const {ai,calls}=fixture({discovery});assert.match(await ai.chat('open operator folder'),/could not safely identify/);assert.equal(calls.length,1);assert.equal(ai.lastTaskTiming.modelRequests,0);}
  const {ai,calls}=fixture();assert.match(await ai.chat(String.raw`open folder C:\Different\Operator`),/could not safely identify/);assert.equal(calls.length,1);
});
test('refused and unverified opens stop after one attempt with no visual/model fallback',async()=>{
  for(const result of [opened({status:'refused',refused:true,action_attempted:false,verified:false}),opened({foreground_verified:false}),opened({verified:false}),opened({path:String.raw`D:\Operator`})]){
    const {ai,calls}=fixture({result}),answer=await ai.chat('open operator folder');
    assert.doesNotMatch(answer,/^Opened /);assert.match(answer,/did not repeat/i);assert.deepEqual(calls.map(call=>call.name),['folders_find','folders_open']);assert.equal(ai.lastTaskTiming.modelRequests,0);
  }
});
test('uncertain folder delivery stops the task without native clicking or replay',async()=>{
  const {ai,calls}=fixture({result:{status:'unverified',verified:false,action_attempted:true,outcome_unknown:true}});
  assert.match(await ai.chat('open operator folder'),/stopped without repeating/i);assert.deepEqual(calls.map(call=>call.name),['folders_find','folders_open']);assert.equal(ai.lastTaskTiming.modelRequests,0);assert.equal(ai.lastTaskTiming.toolCalls,2);assert.equal(ai.lastTaskTiming.route,'folder');
});

test('a thrown uncertain folder operation stops compound model requests before another input',async()=>{
  const calls=[];let requests=0;
  const ai=new AI(()=>({chatProvider:'chatgpt',allowDesktop:true,allowScreen:false}),()=>assert.fail('No key'),async name=>{
    calls.push(name);assert.equal(name,'folders_open','No later native input may run after an uncertain folder open');
    throw Object.assign(Error('Windows folder operation timed out'),{code:'folder_outcome_unknown',action_attempted:true,outcome_unknown:true,refused:false});
  },()=>assert.fail('No network'));
  ai.request=async()=>{requests++;return {output:[
    {type:'function_call',call_id:'open-folder',name:'folders_open',arguments:'{"snapshot":"observed-folder","folder_id":"operator"}'},
    {type:'function_call',call_id:'later-input',name:'computer_input',arguments:'{}'}
  ]};};
  const answer=await ai.chat('Find Operator, open its folder, then select a file');
  assert.match(answer,/stopped without repeating/i);assert.deepEqual(calls,['folders_open']);assert.equal(requests,1);
  assert.equal(ai.lastTaskTiming.toolCalls,1);assert.equal(ai.busy,false);
});
test('Stop while folder discovery is pending prevents the open and keeps no completion claim',async()=>{
  let started,finish;const pending=new Promise(resolve=>finish=resolve),entered=new Promise(resolve=>started=resolve),calls=[];
  const ai=new AI(()=>({chatProvider:'chatgpt',allowDesktop:true,allowScreen:false}),()=>assert.fail('No key'),async name=>{calls.push(name);assert.equal(name,'folders_find');started();return pending;},()=>assert.fail('No network'));
  const request=ai.chat('open operator folder');await entered;ai.cancel();finish(found());
  await assert.rejects(request,/stopped/i);assert.deepEqual(calls,['folders_find']);assert.equal(ai.history.length,0);assert.equal(ai.busy,false);
});
test('speech preparation skips all generic reads and model drafts for a local folder request',async()=>{
  const {ai,calls}=fixture();let reads=0;
  ai.prepareContext=async(text,context)=>{assert.equal(text,'open operator folder');assert.equal(context.readOnly,true);reads++;return {preparedAt:Date.now(),scopes:[{observation:{complete:true}}]};};
  const prepared=await ai.prepareTask('open operator folder');assert.equal(reads,0);assert.equal(prepared,null);assert.equal(calls.length,0);
});
test('ordinary installed-app requests retain their existing verified fast path',async()=>{
  const calls=[],frame={status:'inspected',snapshot:'app-observation',focus_verified:true,window:{pid:10,window_id:20,title:'Calculator'},controls:[{control_id:'1',name:'One',type:'Button',enabled:true}],degraded:false,truncated:false};
  const ai=new AI(()=>({chatProvider:'chatgpt',allowDesktop:true,allowScreen:false}),()=>assert.fail('No key'),async name=>{calls.push(name);if(name==='list_apps')return {status:'ok',apps:[{name:'Calculator',app_id:'calc'}]};assert.equal(name,'open_app');return {status:'opened',observation:frame};},()=>assert.fail('No network'));
  assert.equal(await ai.chat('Open Calculator.'),'Calculator is open.');assert.deepEqual(calls,['list_apps','open_app']);assert.equal(ai.lastTaskTiming.route,'local');assert.equal(ai.lastTaskTiming.modelRequests,0);
});
test('three failed reads stop honestly without claiming repeated clicking occurred',async()=>{
  let requests=0;const calls=[];
  const ai=new AI(()=>({chatProvider:'chatgpt',allowDesktop:true,allowScreen:false}),()=>assert.fail('No key'),async name=>{calls.push(name);assert.equal(name,'computer_list_windows');return {status:'error',message:'Window inventory unavailable'};},()=>assert.fail('No network'));
  ai.request=async()=>({output:[{type:'function_call',call_id:'read-'+(++requests),name:'computer_list_windows',arguments:'{"query":""}'}]});
  const answer=await ai.chat('Inspect the desktop');assert.match(answer,/three unsuccessful desktop operations/);assert.doesNotMatch(answer,/clicking|clicked/i);assert.equal(requests,3);assert.equal(calls.length,3);
});
