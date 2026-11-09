const {test}=require('node:test'),assert=require('node:assert/strict');
const {launchAndInspect}=require('../app-launch');
const window=(id)=>({pid:10,window_id:id,title:'Calculator',minimized:false,on_screen:true});
function fixture(lists){let reads=0,launches=0;const inspected=[];return {get launches(){return launches;},inspected,options:{app:{name:'Calculator'},launch:async()=>{launches++;},delay:async()=>{},computer:{listWindows:async()=>({windows:lists[Math.min(reads++,lists.length-1)]}),inspect:async row=>{inspected.push(row.window_id);return {status:'inspected',window:row,snapshot:'new',controls:[{name:'One'}]};}}}};}
test('one already-open app is focused and reused without launching it again',async()=>{
  const f=fixture([[{...window(1),on_screen:false}]]);let focused=0;
  f.options.computer.focus=async w=>{focused++;return{status:'inspected',snapshot:'existing',window:w,controls:[]};};
  const result=await launchAndInspect(f.options);
  assert.equal(result.status,'focused_existing');assert.equal(result.observation.window.window_id,1);assert.equal(focused,1);assert.equal(f.launches,0);
});
test('a newly launched unique window is raised before handing it to the model',async()=>{
  const f=fixture([[],[window(2)]]);let focused=0;
  f.options.computer.focus=async w=>{focused++;return{status:'inspected',snapshot:'new',window:w,controls:[{name:'Ready'}]};};
  const result=await launchAndInspect(f.options);assert.equal(result.status,'opened');assert.equal(f.launches,1);assert.equal(focused,1);
});
test('launch hands the model the new window even when many older instances match',async()=>{
  const f=fixture([[window(1),window(2)],[window(1),window(3),window(2)]]);
  const result=await launchAndInspect(f.options);assert.equal(result.status,'opened');assert.equal(result.observation.window.window_id,3);assert.deepEqual(f.inspected,[3]);assert.equal(f.launches,1);
});
test('launch waits for delayed window creation without opening the app again',async()=>{
  const f=fixture([[window(1)],[window(1)],[window(1),window(2)]]);const result=await launchAndInspect(f.options);assert.equal(result.observation.window.window_id,2);assert.equal(f.launches,1);
});
test('launch never guesses among multiple new or unchanged matching windows',async()=>{
  for(const lists of [[[window(1)],[window(1),window(2),window(3)]],[[window(1)],[window(1)]]]){const f=fixture(lists);const result=await launchAndInspect(f.options);assert.equal(result.status,'launch_requested');assert.equal(result.observation,undefined);assert.deepEqual(f.inspected,[]);}
});
test('incomplete window lists cannot justify choosing a new target',async()=>{
  const f=fixture([[]]);f.options.computer.listWindows=async()=>({windows:[window(1)],truncated:true});const result=await launchAndInspect(f.options);assert.equal(result.observation,undefined);assert.equal(f.launches,1);
});
test('cancelled launch does not open or inspect another app',async()=>{
  const f=fixture([[]]),controller=new AbortController();controller.abort(new Error('Stopped'));f.options.signal=controller.signal;await assert.rejects(launchAndInspect(f.options),/Stopped/);assert.equal(f.launches,0);
});
