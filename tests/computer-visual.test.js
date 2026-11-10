'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {ComputerVisual} = require('../computer-visual');
const {ComputerUse} = require('../computer-use');

const TARGET={pid:42,window_id:123};
const WINDOW={scope:'window',...TARGET};
// Small edge boxes preserve the existing pixel targets in lifecycle tests.
const clickBox=(x,y)=>({target_box:{left:Math.max(0,x-.001),top:Math.max(0,y-.001),right:Math.min(1,x+.001),bottom:Math.min(1,y+.001)}});
const mutationNames=new Set(['click','type_text','press_key','hotkey','scroll','drag','move_cursor']);
const packet=data=>({structuredContent:data});
function setup() {
  let time=1000,revision=0;
  const calls=[],settings={allowDesktop:true,allowScreen:true};
  const config={bounds:{x:10,y:20,width:200,height:100},title:'Fixture',screen:{width:800,height:400,scale_factor:1},elements:[],action:{effect:'unverifiable',summary:'Input delivered.'}};
  const computer={generation:0,session:'test-session',windows:new Map([['42:123',TARGET]]),snapshots:new Map(),getSettings:()=>settings,paused:false,ensureSession:async()=>{},assertReady(generation){if(this.paused||generation!==this.generation)throw new Error('Computer use stopped');if(!settings.allowDesktop)throw new Error('Desktop disabled');}};
  computer.client={connectionId:1,call:async(name,args)=>{
    calls.push({name,args});
    if(config.before)await config.before(name,args);
    if(name==='list_windows')return packet({windows:config.closed?[]:[{...TARGET,bounds:{...config.bounds},title:config.title,minimized:config.minimized||false,is_on_screen:!config.hidden}]});
    if(name==='bring_to_front')return packet({success:true});
    if(name==='get_screen_size')return packet({...config.screen});
    if(name==='get_window_state'||name==='get_desktop_state'){
      const data={screenshot_width:200,screenshot_height:100,capture_id:`capture-${++revision}`,...(name==='get_window_state'?{...TARGET,window_title:config.title,window_bounds:{...config.bounds},elements:config.elements}:{display:'primary',screen_width:800,screen_height:400,scale_factor:1}),...config.capture};
      return {structuredContent:data,content:config.noImage?[]:[{type:'image',mimeType:'image/png',data:'aGVsbG8='}]};
    }
    if(mutationNames.has(name)){if(config.actionError)throw config.actionError;return packet(config.action);}
    throw new Error(`Unexpected tool ${name}`);
  }};
  computer.call=ComputerUse.prototype.call;
  computer.invalidateSession=ComputerUse.prototype.invalidateSession;
  computer.sessionRevision=0;
  const visual=new ComputerVisual({computer,now:()=>time});
  return {visual,computer,calls,settings,config,advance:ms=>time+=ms,mutations:()=>calls.filter(call=>mutationNames.has(call.name))};
}
async function observed(f,scope=WINDOW){return f.visual.observe(scope);}

test('generic native visual failure remains uncertain after one dispatch',async()=>{
  const f=setup(),snap=await observed(f);f.config.action={status:'error',code:'tool_invocation_failed',effect:'refused'};
  const result=await f.visual.input({snapshot:snap.snapshot,kind:'click',...clickBox(.5,.5)});
  assert.equal(result.action_attempted,true);assert.equal(result.outcome_unknown,true);assert.equal(result.status,'interrupted');assert.equal(result.code,'tool_invocation_failed');assert.equal(f.mutations().length,1);
});

test('named visual target clicks its measured center and refuses guessed or renamed targets',async()=>{
  const f=setup();f.config.elements=[{role:'Hyperlink',label:'Profile',frame:{x:30,y:40,w:40,h:20}}];
  const snap=await observed(f);assert.equal(snap.targets[0].name,'Profile');
  for(const args of [{target_id:'v0',expected_name:'Other'},{target_id:'stale',expected_name:'Profile'},{target_id:'v0',expected_name:'Profile',target_box:{left:.1,top:.1,right:.2,bottom:.2}}])await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'click',...args}));
  assert.equal(f.mutations().length,0);
  await f.visual.input({snapshot:snap.snapshot,kind:'click',target_id:'v0',expected_name:'Profile'});
  assert.equal(f.mutations()[0].args.x,40);assert.equal(f.mutations()[0].args.y,30);
  assert.equal(f.mutations()[0].args.capture_id,'capture-1');
});

test('all visual clicks compute the target rectangle center, not its bottom edge',async()=>{
  for(const kind of ['click','double_click','right_click']){
    const f=setup(),snap=await observed(f);
    await f.visual.input({snapshot:snap.snapshot,kind,target_box:{left:.2,top:.1,right:.6,bottom:.5}});
    const sent=f.mutations()[0].args;
    assert.equal(sent.x,80);assert.equal(sent.y,30);
    assert.equal(sent.capture_id,'capture-1');assert.equal(sent.target.window_id,TARGET.window_id);
    assert.equal(sent.count,kind==='double_click'?2:1);assert.equal(sent.button,kind==='right_click'?'right':'left');
  }
});

test('center stays in screenshot pixels for a downscaled high DPI capture',async()=>{
  for(const scope of [WINDOW,{scope:'desktop'}]){
    const f=setup();
    f.config.bounds={x:-1800,y:200,width:2400,height:1200};
    f.config.screen={width:3840,height:2160,scale_factor:2};
    f.config.capture={screenshot_width:800,screenshot_height:400,screen_width:3840,screen_height:2160,scale_factor:2};
    const snap=await observed(f,scope);
    await f.visual.input({snapshot:snap.snapshot,kind:'click',target_box:{left:.6,top:.2,right:.9,bottom:.6}});
    const sent=f.mutations()[0].args;
    assert.equal(sent.x,599);assert.equal(sent.y,160);
    assert.equal(sent.capture_id,'capture-1');
  }
});

test('missing, malformed and contradictory click boxes send no input and preserve the screenshot',async()=>{
  const f=setup(),snap=await observed(f),valid={left:.2,top:.2,right:.4,bottom:.4};
  const boxes=[undefined,null,[],{}, {...valid,left:-.1},{...valid,right:1.1},{...valid,bottom:NaN},{...valid,top:Infinity},{...valid,right:.2},{...valid,bottom:.1},{...valid,x:.3}];
  for(const target_box of boxes)await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'click',target_box}),/target_box/);
  for(const extra of [{x:.3,y:.3},{x2:.3},{y2:.3}])await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'click',target_box:valid,...extra}),/target_box/);
  await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'click',x:.3,y:.3}),/target_box/);
  await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'type',text:'hello',target_box:valid}),/only for click/);
  assert.equal(f.mutations().length,0);assert.equal(f.visual.current.id,snap.snapshot);
});

test('Calculator with real accessible buttons redirects pixel guesses before sending input',async()=>{
  const f=setup();f.config.title='Calculatrice';
  f.config.elements=['Zéro','Un','Deux','Trois','Quatre','Cinq','Six','Sept','Huit','Neuf','Est égal à'].map(label=>({role:'Button',label}));
  const snap=await observed(f);
  await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'click',...clickBox(0.3,0.7)}),/No pixel input was sent.*computer_inspect_window/);
  assert.equal(f.mutations().length,0);
});

test('Calculator visual fallback remains available when accessible digit buttons are absent',async()=>{
  const f=setup();f.config.title='Calculator';f.config.elements=[{role:'Button',label:'Close'}];
  const snap=await observed(f);await f.visual.input({snapshot:snap.snapshot,kind:'click',...clickBox(0.3,0.7)});assert.equal(f.mutations().length,1);
});

test('visual observation returns a grounded private image and invalidates only target AX snapshots',async()=>{
  const f=setup();f.computer.snapshots.set('old',{key:'42:123'});f.computer.snapshots.set('other',{key:'43:124'});
  const result=await observed(f);
  assert.equal(result.status,'observed');assert.equal(result.width,200);assert.equal(result.height,100);
  assert.equal(result.coordinate_system,'normalized_0_1');assert.equal(result._images[0].detail,'high');
  const {_images,...publicResult}=result;assert.doesNotMatch(JSON.stringify(publicResult),/base64|aGVsbG8/);
  assert.equal(f.computer.snapshots.has('old'),false);assert.equal(f.computer.snapshots.has('other'),true);
  assert.deepEqual(f.calls.map(call=>call.name),['bring_to_front','get_window_state']);
  assert.equal(f.calls.at(-1).args.max_image_dimension,1600);
});
test('window observations require exact previously listed identity and both permissions',async()=>{
  for(const args of [{scope:'window',pid:42},{scope:'window',pid:43,window_id:123},{scope:'desktop',pid:42},{scope:'global'}]){
    const f=setup();await assert.rejects(f.visual.observe(args));assert.equal(f.calls.length,0);
  }
  for(const key of ['allowDesktop','allowScreen']){
    const f=setup();f.settings[key]=false;await assert.rejects(observed(f));assert.equal(f.calls.length,0);
  }
});
test('click consumes native capture and uses screenshot coordinates, with fresh flat image output',async()=>{
  const f=setup(),first=await observed(f);
  const result=await f.visual.input({snapshot:first.snapshot,kind:'click',...clickBox(1,0.5)});
  assert.deepEqual(f.mutations()[0],{name:'click',args:{target:{kind:'window',...TARGET},session:'test-session',delivery_mode:'foreground',x:199,y:50,capture_id:'capture-1',count:1,button:'left'}});
  assert.notEqual(result.snapshot,first.snapshot);assert.equal(result.width,200);assert.equal(result.status,'unverified');assert.equal(result.verified,false);
  assert.ok(result._images[0].data_url);assert.equal(result.observation,undefined);
  assert.equal(f.calls.filter(call=>call.name==='bring_to_front').length,1,'post-action observation preserves focus state');
  await assert.rejects(f.visual.input({snapshot:first.snapshot,kind:'click',...clickBox(0,0)}),/consumed|replaced/);
  assert.equal(f.mutations().length,1);
});
test('capture uses native frame metadata without repeating window enumeration',async()=>{
  const f=setup(),snap=await observed(f);
  f.config.before=async name=>{if(name==='click'){f.config.bounds.x=25;f.config.title='Updated fixture';}};
  const result=await f.visual.input({snapshot:snap.snapshot,kind:'click',...clickBox(0,0)});
  assert.equal(f.calls.filter(call=>call.name==='list_windows').length,1,'Input retains one independent preflight, capture avoids the duplicate enumeration.');
  assert.equal(result.window.title,'Updated fixture');assert.equal(f.visual.current.live.bounds.x,25);
  await f.visual.input({snapshot:result.snapshot,kind:'type',text:'new frame'});
  assert.equal(f.mutations().length,2,'The following input checks geometry against the returned frame, not a cached pre-input rectangle.');
});
test('window image cannot ground input without valid native frame geometry',async()=>{
  for(const capture of [{window_bounds:undefined},{window_bounds:{x:0,y:0,width:0,height:100}},{window_id:99},{minimized:true},{is_on_screen:false}]){
    const f=setup();f.config.capture=capture;
    await assert.rejects(observed(f));assert.equal(f.visual.current,null);assert.equal(f.mutations().length,0);
  }
});
test('double and right click share capture-bound native click',async()=>{
  for(const [kind,count,button]of [['double_click',2,'left'],['right_click',1,'right']]){
    const f=setup(),first=await observed(f);await f.visual.input({snapshot:first.snapshot,kind,...clickBox(0,1)});
    const action=f.mutations()[0];assert.equal(action.name,'click');assert.equal(action.args.count,count);assert.equal(action.args.button,button);assert.equal(action.args.capture_id,'capture-1');assert.equal(action.args.y,99);
  }
});
test('Unicode typing has no artificial delay and keyboard inputs have strict key validation',async()=>{
  const f=setup();let snap=await observed(f);
  snap=await f.visual.input({snapshot:snap.snapshot,kind:'type',text:'مرحبا Pixie 😀',x:0.25,y:0.5});
  assert.equal(f.mutations()[0].name,'type_text');assert.equal(f.mutations()[0].args.text,'مرحبا Pixie 😀');assert.equal(f.mutations()[0].args.delay_ms,0);assert.equal(f.mutations()[0].args.capture_id,undefined);
  snap=await f.visual.input({snapshot:snap.snapshot,kind:'key',key:'Enter'});assert.equal(f.mutations().at(-1).args.key,'return');
  snap=await f.visual.input({snapshot:snap.snapshot,kind:'hotkey',keys:['Control','Shift','s']});assert.deepEqual(f.mutations().at(-1).args.keys,['ctrl','shift','s']);
  for(const keys of [['a','b'],['ctrl','ctrl','s'],['ctrl'],['ctrl','unknown'],['ctrl','alt']])await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'hotkey',keys}));
  assert.equal(f.mutations().length,3);
});
test('replace focuses once, selects and types with a single final fresh observation',async()=>{
  const f=setup(),snap=await observed(f);
  const result=await f.visual.input({snapshot:snap.snapshot,kind:'type',replace:true,text:'Replacement — سلام',x:0.25,y:0.5});
  const actions=f.mutations();assert.deepEqual(actions.map(action=>action.name),['hotkey','type_text']);
  assert.deepEqual(actions[0].args.keys,['ctrl','a']);assert.equal(actions[0].args.x,50);assert.equal(actions[0].args.y,50);
  assert.equal(actions[1].args.x,undefined);assert.equal(actions[1].args.y,undefined);assert.equal(actions[1].args.text,'Replacement — سلام');assert.equal(actions[1].args.delay_ms,0);
  assert.equal(f.calls.filter(call=>call.name==='get_window_state').length,2,'Only initial and final image; no model/image roundtrip between selection and text.');
  assert.equal(result.steps_attempted,2);assert.equal(result.steps_completed,2);assert.equal(result.verified,false);assert.equal(result.status,'unverified');assert.notEqual(result.snapshot,snap.snapshot);
  await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'type',replace:true,text:'do not repeat'}),/consumed|replaced/);assert.equal(f.mutations().length,2);
});
test('replace at current focus never invents a click and replace false keeps ordinary typing',async()=>{
  const f=setup();let snap=await observed(f);
  snap=await f.visual.input({snapshot:snap.snapshot,kind:'type',replace:true,text:'Focused text'});
  assert.ok(f.mutations().every(action=>action.args.x===undefined&&action.args.y===undefined));
  await f.visual.input({snapshot:snap.snapshot,kind:'type',replace:false,text:'append',x:0.5,y:0.5});
  assert.equal(f.mutations().length,3);assert.equal(f.mutations()[2].name,'type_text');assert.equal(f.mutations()[2].args.x,100);
});
test('invalid replace options cannot select or modify a field',async()=>{
  const f=setup(),snap=await observed(f);
  for(const args of [{kind:'type',text:'x',replace:'true'},{kind:'type',text:'x',replace:1},{kind:'click',...clickBox(0,0),replace:true},{kind:'hotkey',keys:['ctrl','a'],replace:false}]){
    await assert.rejects(f.visual.input({snapshot:snap.snapshot,...args}),/replace/);
  }
  assert.equal(f.mutations().length,0);assert.equal(f.visual.current.id,snap.snapshot);
});
test('replace stops before typing on ineffective, partial, failed or uncertain selection delivery',async()=>{
  for(const action of [{effect:'partial'},{effect:'suspected_noop'},{effect:'unverifiable',error:{code:'delivery_failed',hint:'Selection failed'}},{effect:'unverifiable',escalation:{target:'foreground',reason:'effect_unconfirmed'}},{effect:'unverifiable',delivery:{mode:'unknown'}},{effect:'unverifiable',delivery:{mode:'foreground',delivered_count:0}},{}]){
    const f=setup(),snap=await observed(f);f.config.action=action;
    const result=await f.visual.input({snapshot:snap.snapshot,kind:'type',replace:true,text:'must not be typed'});
    assert.deepEqual(f.mutations().map(action=>action.name),['hotkey']);assert.equal(result.status,'interrupted');assert.equal(result.steps_attempted,1);assert.equal(result.steps_completed,0);assert.match(result.continuation,/never replay/);assert.ok(result.snapshot);
  }
});
test('replace preserves the completed selection when text delivery fails and never retries it',async()=>{
  const f=setup(),snap=await observed(f);f.config.before=async name=>{if(name==='type_text')f.config.actionError=new Error('Text delivery timed out');};
  const result=await f.visual.input({snapshot:snap.snapshot,kind:'type',replace:true,text:'hello'});
  assert.equal(result.status,'interrupted');assert.equal(result.steps_attempted,2);assert.equal(result.steps_completed,1);assert.equal(result.outcome_unknown,true);assert.match(result.continuation,/never replay/);assert.equal(f.mutations().length,2);
});
test('Stop between selection and text prevents the remaining compound operation',async()=>{
  for(const stop of [f=>f.visual.clear(),f=>f.computer.generation++,f=>f.settings.allowScreen=false]){
    const f=setup(),snap=await observed(f);f.config.before=async name=>{if(name==='hotkey')stop(f);};
    await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'type',replace:true,text:'must not be typed'}));
    assert.deepEqual(f.mutations().map(action=>action.name),['hotkey']);assert.equal(f.calls.filter(call=>call.name==='get_window_state').length,1);
  }
});
test('compound input rechecks target, connection and TTL before typing into the selection',async()=>{
  for(const change of [f=>f.config.bounds.x++,f=>f.config.title='Different document',f=>f.computer.client.connectionId++,f=>f.advance(20001)]){
    const f=setup(),snap=await observed(f);f.config.before=async name=>{if(name==='hotkey')change(f);};
    const result=await f.visual.input({snapshot:snap.snapshot,kind:'type',replace:true,text:'must not be typed'});
    assert.equal(result.status,'interrupted');assert.equal(result.steps_completed,1);assert.deepEqual(f.mutations().map(action=>action.name),['hotkey']);assert.ok(result.snapshot);
  }
});
test('compound input does not claim verified replacement when selection was only delivered',async()=>{
  const f=setup(),snap=await observed(f);f.config.before=async name=>{if(name==='type_text')f.config.action={effect:'confirmed'};};
  const result=await f.visual.input({snapshot:snap.snapshot,kind:'type',replace:true,text:'hello'});
  assert.equal(result.status,'unverified');assert.equal(result.effect,'unverifiable');assert.equal(result.verified,false);assert.equal(result.steps_completed,2);
});
test('scroll and drag retain native PNG coordinates with bounded arguments',async()=>{
  const f=setup();let snap=await observed(f);
  snap=await f.visual.input({snapshot:snap.snapshot,kind:'scroll',direction:'down',amount:50,x:0,y:0});
  assert.deepEqual(f.mutations()[0].args,{target:{kind:'window',...TARGET},session:'test-session',delivery_mode:'foreground',x:0,y:0,direction:'down',amount:50,by:'line'});
  await f.visual.input({snapshot:snap.snapshot,kind:'drag',x:0,y:0,x2:1,y2:1});
  assert.deepEqual(f.mutations()[1].args,{target:{kind:'window',...TARGET},session:'test-session',delivery_mode:'foreground',from_x:0,from_y:0,to_x:199,to_y:99,duration_ms:180,steps:12,button:'left'});
});
test('real pointer move requires desktop observation and retains scaled image pixels',async()=>{
  const f=setup();let snap=await observed(f);
  await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'move',x:0.5,y:0.5}),/desktop observation/);assert.equal(f.mutations().length,0);
  snap=await observed(f,{scope:'desktop'});assert.equal(snap.screen_width,800);
  await f.visual.input({snapshot:snap.snapshot,kind:'move',x:1,y:1});
  assert.deepEqual(f.mutations()[0],{name:'move_cursor',args:{target:{kind:'desktop',display_id:'primary'},session:'test-session',x:199,y:99}});
});
test('invalid coordinates and action arguments never consume or dispatch the snapshot',async()=>{
  const f=setup(),snap=await observed(f);
  const invalid=[{kind:'click',x:-1,y:0},{kind:'click',x:2,y:0},{kind:'click',x:NaN,y:0},{kind:'click',x:0},{kind:'drag',x:0,y:0,x2:1},{kind:'type',text:''},{kind:'scroll',direction:'diagonal'},{kind:'scroll',direction:'down',amount:51},{kind:'key',key:'RunScript'},{kind:'unknown'}];
  for(const action of invalid)await assert.rejects(f.visual.input({snapshot:snap.snapshot,...action}));
  assert.equal(f.mutations().length,0);assert.equal(f.visual.current.id,snap.snapshot);
});
test('window movement, resize, title change, hiding and closure reject stale input',async()=>{
  for(const change of [f=>f.config.bounds.x++,f=>f.config.bounds.width++,f=>f.config.title='New title',f=>f.config.hidden=true,f=>f.config.minimized=true,f=>f.config.closed=true]){
    const f=setup(),snap=await observed(f);change(f);
    await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'click',...clickBox(0.5,0.5)}));assert.equal(f.mutations().length,0);
  }
});
test('desktop resolution or scale changes reject input without coordinate guessing',async()=>{
  for(const key of ['width','height','scale_factor']){
    const f=setup(),snap=await observed(f,{scope:'desktop'});f.config.screen[key]++;
    await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'key',key:'escape'}),/geometry changed/);assert.equal(f.mutations().length,0);
  }
});
test('expiry, clear, native reconnection, AX inspection and Stop invalidate screenshots',async()=>{
  for(const invalidate of [f=>f.advance(20001),f=>f.visual.clear(),f=>f.computer.client.connectionId++,f=>f.computer.snapshots.set('new',{key:'42:123'}),f=>f.computer.generation++,f=>f.computer.paused=true]){
    const f=setup(),snap=await observed(f);invalidate(f);
    await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'type',text:'hello'}));assert.equal(f.mutations().length,0);
  }
});
test('native reconnection during preflight cannot dispatch input with the old capture',async()=>{
  const f=setup(),snap=await observed(f);f.config.before=async name=>{if(name==='list_windows')f.computer.client.connectionId++;};
  await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'type',text:'hello'}),/connection changed/);assert.equal(f.mutations().length,0);
});
test('expiry during an asynchronous preflight is rechecked before native input',async()=>{
  const f=setup(),snap=await observed(f);f.config.before=async name=>{if(name==='list_windows')f.advance(20001);};
  await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'type',text:'hello'}),/expired/);assert.equal(f.mutations().length,0);
});
test('expiry while ensuring the native session prevents input dispatch',async()=>{
  const f=setup(),snap=await observed(f);let prepared=0;
  f.computer.ensureSession=async()=>{if(++prepared===2)f.advance(20001);};
  const result=await f.visual.input({snapshot:snap.snapshot,kind:'type',text:'hello'});
  assert.equal(result.status,'refused');assert.equal(result.outcome_unknown,false);assert.match(result.message,/expired/);assert.equal(f.mutations().length,0);
});

test('visual discovery shares the named session and renewed sessions reject old screenshots',async()=>{
  const f=setup(),snap=await observed(f);
  f.config.before=async name=>{if(name==='list_windows')f.computer.sessionRevision++;};
  const result=await f.visual.input({snapshot:snap.snapshot,kind:'click',...clickBox(.5,.5)});
  assert.equal(result.status,'refused');assert.equal(result.outcome_unknown,false);
  assert.match(result.message,/session changed/);assert.equal(f.mutations().length,0);
  for(const call of f.calls)assert.equal(call.args.session,f.computer.session,call.name);
});
test('Stop or permission revocation during async preflight prevents the action',async()=>{
  for(const stop of [f=>f.visual.clear(),f=>f.computer.generation++,f=>f.settings.allowScreen=false]){
    const f=setup(),snap=await observed(f);f.config.before=async name=>{if(name==='list_windows')stop(f);};
    await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'type',text:'hello'}));assert.equal(f.mutations().length,0);
  }
});
test('aborted task context prevents observation or input',async()=>{
  const f=setup(),controller=new AbortController();controller.abort(new Error('Task cancelled'));
  await assert.rejects(f.visual.observe(WINDOW,{signal:controller.signal}),/Task cancelled/);assert.equal(f.calls.length,0);
  const snap=await observed(f);await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'click',...clickBox(0,0)},{assertActive(){throw new Error('Task cancelled');}}),/Task cancelled/);assert.equal(f.mutations().length,0);
});
test('uncertain mutation is never retried and gets a fresh screenshot',async()=>{
  const f=setup(),snap=await observed(f);f.config.actionError=new Error('Native response timed out');
  const result=await f.visual.input({snapshot:snap.snapshot,kind:'click',...clickBox(0.5,0.5)});
  assert.equal(result.status,'interrupted');assert.equal(result.outcome_unknown,true);assert.equal(result.verified,false);assert.notEqual(result.snapshot,snap.snapshot);assert.equal(f.mutations().length,1);
  await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'click',...clickBox(0.5,0.5)}));assert.equal(f.mutations().length,1);
});
test('native refusal remains a refusal, and only confirmed native effects are verified',async()=>{
  const f=setup();let snap=await observed(f);f.config.action={effect:'refused',error:{code:'stale_capture',hint:'Capture stale'}};
  snap=await f.visual.input({snapshot:snap.snapshot,kind:'click',...clickBox(0,0)});assert.equal(snap.status,'refused');assert.equal(snap.outcome_unknown,false);assert.equal(snap.code,'stale_capture');
  f.config.action={effect:'confirmed',summary:'Observed field change'};snap=await f.visual.input({snapshot:snap.snapshot,kind:'type',text:'hello'});assert.equal(snap.status,'verified');assert.equal(snap.verified,true);
});
test('failed post-action screenshot does not invent completion or make old capture reusable',async()=>{
  const f=setup(),snap=await observed(f);f.config.noImage=true;
  const result=await f.visual.input({snapshot:snap.snapshot,kind:'click',...clickBox(0,0)});
  assert.equal(result.status,'observation_failed');assert.equal(result.verified,false);assert.equal(result.snapshot,undefined);assert.equal(result._images,undefined);assert.ok(result.observation_error);assert.equal(f.visual.current,null);assert.equal(f.mutations().length,1);
});
test('missing image, capture identity, bad dimensions or frame mismatch cannot authorize input',async()=>{
  for(const change of [f=>f.config.noImage=true,f=>f.config.capture={capture_id:''},f=>f.config.capture={screenshot_width:0},f=>f.config.capture={screenshot_frame_valid:false},f=>f.config.capture={pid:99}]){
    const f=setup();change(f);await assert.rejects(observed(f));assert.equal(f.visual.current,null);assert.equal(f.mutations().length,0);
  }
  const f=setup();f.config.capture={degraded:true,truncated:true};assert.equal((await observed(f)).accessibility_partial,true,'a usable screenshot remains valid with a partial accessibility tree');
});
test('known protected focus and screenshot locations refuse input',async()=>{
  const f=setup();f.config.elements=[{is_password:true,focused:true,frame:{x:90,y:60,w:40,h:20}}];let snap=await observed(f);
  await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'type',text:'secret'}),/protected/);
  await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'click',...clickBox(0.5,0.5)}),/protected/);assert.equal(f.mutations().length,0);
  snap=await f.visual.input({snapshot:snap.snapshot,kind:'click',...clickBox(0,0)});assert.equal(f.mutations().length,1);
});
test('concurrent Stop during action suppresses subsequent observation and stale success',async()=>{
  const f=setup(),snap=await observed(f);f.config.before=async name=>{if(name==='click')f.visual.clear();};
  await assert.rejects(f.visual.input({snapshot:snap.snapshot,kind:'click',...clickBox(0,0)}),/stopped|replaced/);
  assert.equal(f.mutations().length,1);assert.equal(f.calls.filter(call=>call.name==='get_window_state').length,1);assert.equal(f.visual.current,null);
});
