const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ComputerUse}=require('../computer-use');
const {validateTool}=require('../core');

const identity={pid:42,window_id:123};
const windowRow={...identity,title:'Calculatrice',app_name:'ApplicationFrameHost.exe',minimized:true,is_on_screen:false};
const result=value=>({structuredContent:value});
const readyState={window_title:'Calculatrice',elements:[{element_token:'s1:six',role:'Button',label:'Six'}],elements_complete:true};
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}

function fixture(options={}){
  const calls=[],restores=[];let reads=0;
  const client={async call(name,args){
    calls.push({name,args});
    if(name==='start_session')return result({active:true});
    if(name==='list_windows')return result({windows:options.windows||[windowRow]});
    if(name==='get_window_state'){
      reads++;
      return result(await options.read?.(reads,args)??readyState);
    }
    throw new Error('Unexpected native input: '+name);
  },async stop(){calls.push({name:'stop'});}};
  const restoreWindow=async args=>{restores.push(args);return options.restore?options.restore(args):{status:'restored'};};
  const service=new ComputerUse({client,getSettings:()=>({allowDesktop:true}),confirm:async()=>{throw new Error('Restore must never click or type.');},...(options.unavailable?{}:{restoreWindow})});
  return {service,calls,restores,reads:()=>reads,discover:()=>service.listWindows({query:'calc'})};
}

test('window discovery includes visible and minimized windows but omits fully hidden windows',async()=>{
  const visible={...windowRow,pid:43,window_id:124,minimized:false,is_on_screen:true};
  const hidden={...windowRow,pid:44,window_id:125,minimized:false,is_on_screen:false};
  const f=fixture({windows:[windowRow,visible,hidden]});
  const list=await f.discover();
  assert.deepEqual(list.windows.map(row=>({pid:row.pid,minimized:row.minimized,on_screen:row.on_screen})),[
    {pid:42,minimized:true,on_screen:false},{pid:43,minimized:false,on_screen:true},
  ]);
  assert.deepEqual(f.calls.find(call=>call.name==='list_windows').args,{on_screen_only:false});
  assert.equal(f.service.windows.has('44:125'),false);
});

test('findWindow gives restore guidance for minimized apps and never guesses between host and ghost',async()=>{
  const f=fixture(),found=await f.service.findWindow({query:'calc'});
  assert.equal(found.status,'minimized');assert.match(found.message,/computer_restore_window/);
  assert.equal(found.windows[0].window_id,123);assert.equal(f.reads(),0);assert.equal(f.restores.length,0);
  const ghost={...windowRow,pid:43,window_id:124,minimized:false,is_on_screen:true,app_name:'CalculatorApp.exe'};
  const ambiguous=fixture({windows:[windowRow,ghost]});
  const choice=await ambiguous.service.findWindow({query:'calc'});
  assert.equal(choice.status,'ambiguous');assert.equal(choice.windows.length,2);
  assert.match(choice.message,/minimized main window/);
  assert.equal(ambiguous.reads(),0);assert.equal(ambiguous.restores.length,0);
});

test('restore accepts only an observed exact identity and binds its last observed title',async()=>{
  const f=fixture();
  await assert.rejects(f.service.restore(identity),/List windows first/);
  await f.discover();
  for(const invalid of [{pid:42,window_id:124},{pid:43,window_id:123},{pid:42,window_id:'123'}])await assert.rejects(f.service.restore(invalid),/exact|observed/);
  assert.equal(f.restores.length,0);assert.equal(f.reads(),0);
  const observed=await f.service.restore(identity);
  assert.deepEqual(f.restores,[{...identity,expected_title:'Calculatrice'}]);
  assert.equal(observed.controls[0].name,'Six');assert.equal(observed.status,'inspected');
  assert.equal(f.reads(),1);
  assert.deepEqual(f.calls.map(call=>call.name),['start_session','list_windows','get_window_state']);
});

test('restore waits only through incomplete reads until the UI settles without retrying the native restore',async()=>{
  const f=fixture({read:attempt=>attempt===1?{...readyState,degraded:true}:attempt===2?{...readyState,elements:[]}:readyState});
  await f.discover();
  const observed=await f.service.restore(identity);
  assert.equal(observed.status,'inspected');assert.equal(observed.controls.length,1);
  assert.equal(f.reads(),3);assert.equal(f.restores.length,1);
  assert.ok(f.calls.every(call=>['start_session','list_windows','get_window_state'].includes(call.name)));
});

test('an empty or persistently partial restored tree is limited to four reads',async()=>{
  for(const state of [{...readyState,elements:[]},{...readyState,truncated:true}]){
    const f=fixture({read:()=>state});await f.discover();
    const observed=await f.service.restore(identity);
    assert.equal(f.reads(),4);assert.equal(f.restores.length,1);
    assert.match(observed.message,/controls are still unavailable/);
    assert.equal(observed.controls.length,state.elements.length);
  }
});

test('cancellation before restoration cannot reach the native helper or inspection',async()=>{
  const f=fixture();await f.discover();const controller=new AbortController();controller.abort(new Error('Cancelled before restore'));
  await assert.rejects(f.service.restore(identity,{signal:controller.signal}),/Cancelled before restore/);
  await assert.rejects(f.service.restore(identity,{assertActive:()=>{throw new Error('Dispatcher cancelled');}}),/Dispatcher cancelled/);
  assert.equal(f.restores.length,0);assert.equal(f.reads(),0);
});

test('cancellation or Stop while restoration is in flight prevents later inspection',async()=>{
  for(const mode of ['signal','stop']){
    const entered=deferred(),finish=deferred(),controller=new AbortController();
    const f=fixture({restore:async()=>{entered.resolve();return finish.promise;}});await f.discover();
    const pending=f.service.restore(identity,{signal:controller.signal});
    const rejected=assert.rejects(pending,/Cancelled|stopped/);
    await entered.promise;
    if(mode==='signal')controller.abort(new Error('Cancelled after native restore'));else await f.service.stop();
    finish.resolve({status:'restored'});await rejected;
    assert.equal(f.restores.length,1);assert.equal(f.reads(),0);
  }
});

test('cancellation during a settling read prevents another read or action',async()=>{
  const controller=new AbortController();
  const f=fixture({read:()=>{controller.abort(new Error('Cancelled during inspection'));return {...readyState,elements:[]};}});await f.discover();
  await assert.rejects(f.service.restore(identity,{signal:controller.signal}),/Cancelled during inspection/);
  assert.equal(f.reads(),1);assert.equal(f.restores.length,1);
});

test('native helper failure or absent restoration capability propagates without inspection or retry',async()=>{
  const f=fixture({restore:async()=>{throw new Error('Window title changed');}});await f.discover();
  await assert.rejects(f.service.restore(identity),/Window title changed/);
  assert.equal(f.restores.length,1);assert.equal(f.reads(),0);
  const unavailable=fixture({unavailable:true});await unavailable.discover();
  await assert.rejects(unavailable.service.restore(identity),/restoration is unavailable/);
  assert.equal(unavailable.reads(),0);
});

test('restore schema permits only positive exact native identity fields',()=>{
  assert.doesNotThrow(()=>validateTool('computer_restore_window',identity));
  for(const invalid of [{pid:0,window_id:123},{pid:42,window_id:-1},{pid:42,window_id:'123'},{...identity,query:'Calculator'},{...identity,expected_title:'Injected title'}])assert.throws(()=>validateTool('computer_restore_window',invalid),/Invalid action arguments/);
});
