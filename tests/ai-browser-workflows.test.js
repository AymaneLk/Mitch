const {test}=require('node:test'),assert=require('node:assert/strict');
const {AI}=require('../ai');
const {DesktopEvidence}=require('../desktop-evidence');
const {validateTool}=require('../core');
const settings=()=>({chatProvider:'deepseek',allowDesktop:true,allowScreen:false});
const before=()=>({status:'ok',snapshot:'tabs-before',session_id:'session',browser:'opera',complete:true,tabs:[
  {tab_id:1,window_id:1,url:'https://mail.google.com/mail/u/0/',title:'Gmail',pinned:false,active:true},
  {tab_id:2,window_id:1,url:'https://mail.google.com/mail/u/1/',title:'Gmail',pinned:false,active:false},
  {tab_id:3,window_id:1,url:'https://example.com/',title:'Other tab',pinned:false,active:false},
]});
test('two Gmail tabs close in one browser batch without models, images, keys or review',async()=>{
  const calls=[];let timing;
  const ai=new AI(settings,()=>assert.fail('No key'),async(name,args)=>{
    calls.push({name,args});validateTool(name,args);
    if(name==='browser_list_tabs')return before();
    assert.equal(name,'browser_close_tabs');assert.deepEqual(args,{snapshot:'tabs-before',tab_ids:[1,2]});
    return {status:'closed',verified:true,closed_ids:[1,2],observation:{...before(),snapshot:'tabs-after',tabs:before().tabs.slice(2)}};
  },()=>assert.fail('No network'));
  ai.onTaskTiming=result=>timing=result;ai.reviewDesktop=()=>assert.fail('No review needed');
  assert.equal(await ai.chat('Close the two Gmail tabs in Opera GX.'),'Closed 2 Gmail tabs.');
  assert.deepEqual(calls.map(call=>call.name),['browser_list_tabs','browser_close_tabs']);
  assert.equal(timing.route,'browser');assert.equal(timing.modelRequests,0);assert.equal(timing.toolCalls,2);
});
test('unknown close result stops without model fallback, native clicks or replay',async()=>{
  const calls=[];
  const ai=new AI(settings,()=>assert.fail(),async name=>{calls.push(name);return name==='browser_list_tabs'?before():{status:'unverified',outcome_unknown:true,verified:false};},()=>assert.fail('No fallback'));
  assert.match(await ai.chat('Close both Gmail tabs in Opera.'),/stopped without repeating/);
  assert.deepEqual(calls,['browser_list_tabs','browser_close_tabs']);
});
test('an explicit count mismatch never closes an arbitrary subset',async()=>{
  let count=0;const ai=new AI(settings,()=>{},async name=>{count++;assert.equal(name,'browser_list_tabs');return before();},()=>assert.fail('No model to override count'));
  assert.match(await ai.chat('Close three Gmail tabs'),/found 2.*asked for 3/);assert.equal(count,1);
});
test('browser inventory verifies observation even when all tabs were closed',()=>{
  const evidence=new DesktopEvidence();
  evidence.record('browser_close_tabs',{status:'closed',verified:true,closed_ids:[1,2],observation:{...before(),snapshot:'tabs-after',tabs:[]}});
  assert.equal(evidence.touched,true);assert.equal(evidence.needsObservation,false);
  evidence.record('browser_close_tabs',{status:'unverified',outcome_unknown:true,observation:{...before(),snapshot:'uncertain',tabs:[]}});
  assert.equal(evidence.needsObservation,true);
});
test('browser tool schemas reject duplicate IDs and arbitrary commands',()=>{
  for(const args of [{snapshot:'s',tab_ids:[1,1]},{snapshot:'s',tab_ids:[]},{snapshot:'s',tab_ids:[1],script:'close()'}])assert.throws(()=>validateTool('browser_close_tabs',args));
  assert.throws(()=>validateTool('browser_list_tabs',{browser:'all'}));
});
