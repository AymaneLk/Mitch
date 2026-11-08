const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');

function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(overrides={}) {
  const events={states:[],errors:[],resets:[],sent:[],tools:[],connections:[],mediaRequests:0,tracksStopped:0,offers:0,claims:[],releases:[]};
  const track={enabled:true,stop:()=>events.tracksStopped++},stream={getTracks:()=>[track]};
  class Connection {
    constructor(){events.connections.push(this);this.iceGatheringState='complete';this.connectionState='new';this.remoteDescriptions=[];this.listeners={};this.closed=false;}
    addTrack(){}
    addEventListener(name,callback){this.listeners[name]=callback;}
    removeEventListener(name){delete this.listeners[name];}
    createDataChannel(){this.channel={readyState:'open',send:text=>events.sent.push(JSON.parse(text)),close(){this.readyState='closed';}};return this.channel;}
    async createOffer(){return{type:'offer',sdp:'v=0\r\n'};}
    async setLocalDescription(description){this.localDescription=description;}
    async setRemoteDescription(description){this.remoteDescriptions.push(description);if(overrides.remote)await overrides.remote();}
    close(){this.closed=true;}
  }
  const companion={
    claimMicrophone:async(kind,id)=>{events.claims.push({kind,id});return overrides.claim?overrides.claim():`lease-${events.claims.length}`;},
    releaseMicrophone:async id=>{events.releases.push(id);},
    state:overrides.state||(async()=>({hasKey:true})),
    voiceOffer:async sdp=>{events.offers++;return overrides.offer?overrides.offer(sdp):{transport:{sdp:'v=0\r\nanswer'}};},
    voiceReset:async active=>{events.resets.push(active);if(overrides.reset)await overrides.reset(active);},
    voiceTool:async call=>{events.tools.push(call);return overrides.tool?overrides.tool(call):{status:'ok'};}
  };
  const context={window:{companion},navigator:{mediaDevices:{getUserMedia:async()=>{events.mediaRequests++;return overrides.media?overrides.media(stream):stream;}}},RTCPeerConnection:Connection,crypto,AbortController,setTimeout,clearTimeout,console};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../ui/voice.js'),'utf8'),context);
  const live=new context.window.LiveVoice({status:state=>events.states.push(state),caption:()=>{},error:error=>events.errors.push(error),readySound:overrides.readySound});
  return{live,events,track,stream};
}

test('cleanup while settings are pending prevents microphone startup',async()=>{
  const state=deferred(),{live,events}=harness({state:()=>state.promise});
  const starting=live.start();live.cleanup();state.resolve({hasKey:true});await starting;await live.backendQueue;
  assert.equal(live.state,'idle');assert.equal(events.mediaRequests,0);assert.equal(events.connections.length,0);assert.deepEqual(events.errors,[]);assert.deepEqual(events.resets,[false]);
});

test('a microphone stream arriving after Stop is released and never connected',async()=>{
  const media=deferred(),{live,events,stream}=harness({media:()=>media.promise});
  const starting=live.start();await tick();assert.equal(events.mediaRequests,1);live.cleanup();media.resolve(stream);await starting;
  assert.equal(events.tracksStopped,1);assert.equal(events.connections.length,0);assert.equal(live.stream,null);assert.equal(live.state,'idle');
});

test('a delayed server answer and stale channel event cannot restart a stopped session',async t=>{
  const answer=deferred(),{live,events}=harness({offer:()=>answer.promise});t.after(()=>live.cleanup());
  const starting=live.start();await tick();assert.equal(events.offers,1);
  const connection=events.connections[0],staleMessage=connection.channel.onmessage;live.cleanup();
  answer.resolve({transport:{sdp:'v=0\r\nlate'}});await starting;staleMessage({data:JSON.stringify({type:'session.started'})});await tick();
  assert.equal(connection.closed,true);assert.equal(connection.remoteDescriptions.length,0);assert.equal(live.state,'idle');assert.equal(live.pc,null);assert.ok(!events.resets.includes(true));assert.ok(!events.states.includes('active'));
});

test('cleanup while remote description is pending cannot install a late startup timer',async t=>{
  const remote=deferred(),{live,events}=harness({remote:()=>remote.promise});t.after(()=>live.cleanup());
  const starting=live.start();await tick();assert.equal(events.connections[0].remoteDescriptions.length,1);
  live.cleanup();remote.resolve();await starting;
  assert.equal(live.state,'idle');assert.equal(live.startTimeout,undefined);assert.equal(events.tracksStopped,1);
});

test('cleanup during backend activation leaves backend disabled and UI idle',async t=>{
  const activation=deferred(),{live,events}=harness({reset:active=>active?activation.promise:undefined});t.after(()=>live.cleanup());
  await live.start();const activating=live.receive({type:'session.started'});await tick();assert.deepEqual(events.resets,[true]);
  live.cleanup();activation.resolve();await activating;await live.backendQueue;
  assert.equal(live.state,'idle');assert.deepEqual(events.resets,[true,false]);assert.ok(!events.states.includes('active'));
  await live.receive({type:'session.started'});assert.deepEqual(events.resets,[true,false]);
});

test('Stop during connecting closes resources immediately',async()=>{
  const answer=deferred(),{live,events}=harness({offer:()=>answer.promise});
  const starting=live.start();await tick();await live.stop();
  assert.equal(live.state,'idle');assert.equal(events.connections[0].closed,true);assert.equal(events.tracksStopped,1);
  answer.resolve({transport:{sdp:'late'}});await starting;assert.equal(live.state,'idle');
});

test('ending an active conversation disables backend actions before final usage arrives',async t=>{
  const {live,events}=harness();t.after(()=>live.cleanup());await live.start();await live.receive({type:'session.started'});assert.equal(live.state,'active');
  await live.stop();await live.backendQueue;
  assert.equal(live.state,'closing');assert.deepEqual(events.resets,[true,false]);assert.equal(events.sent.at(-1).type,'session.close');
  await live.receive({type:'response.event',event:{type:'response.output_item.done',item:{type:'function_call',call_id:'late',name:'computer_action',arguments:'{}'}}});
  assert.equal(events.tools.length,0);await live.receive({type:'session.started'});assert.equal(live.state,'closing');
});

test('completed work from an old session cannot be sent to a new active channel',async t=>{
  const tool=deferred(),{live,events}=harness({tool:()=>tool.promise});t.after(()=>live.cleanup());
  await live.start();await live.receive({type:'session.started'});
  const item={type:'function_call',call_id:'old',name:'computer_list_windows',arguments:'{"query":""}'};
  await live.receive({type:'response.event',event:{type:'response.completed',response:{id:'old-response',output:[item]}}});const oldQueue=live.queue;
  live.cleanup();await live.start();await live.receive({type:'session.started'});assert.equal(live.state,'active');
  tool.resolve({status:'ok'});await oldQueue;assert.equal(events.sent.length,0);assert.equal(events.tools.length,1);
});

test('a stale cancelled startup cannot clean up a replacement session',async t=>{
  const oldState=deferred();let reads=0;const {live,events}=harness({state:()=>++reads===1?oldState.promise:Promise.resolve({hasKey:true})});t.after(()=>live.cleanup());
  const oldStart=live.start();live.cleanup();await live.start();const replacement=live.pc;
  oldState.resolve({hasKey:false});await oldStart;
  assert.equal(live.pc,replacement);assert.equal(replacement.closed,false);assert.equal(live.state,'connecting');assert.equal(events.mediaRequests,1);assert.deepEqual(events.errors,[]);
});

test('wake activation keeps microphone muted until the ready chime finishes, once only',async t=>{
  const chime=deferred();let sounds=0;const {live,events,track}=harness({readySound:()=>{sounds++;return chime.promise;}});t.after(()=>live.cleanup());
  await live.start({wakeId:'wake-1'});assert.equal(track.enabled,false);assert.equal(events.claims[0].id,'wake-1');assert.equal(sounds,0);
  const ready=live.receive({type:'session.started'});await tick();assert.equal(sounds,1);assert.equal(track.enabled,false);assert.equal(live.state,'connecting');
  await live.receive({type:'session.started'});assert.equal(sounds,1);chime.resolve();await ready;assert.equal(track.enabled,true);assert.equal(live.state,'active');
});
test('Stop during a wake chime cannot enable the microphone or revive a conversation',async()=>{
  const chime=deferred();let signal;const {live,events,track}=harness({readySound:options=>{signal=options.signal;return chime.promise;}});
  await live.start({wakeId:'wake-1'});const ready=live.receive({type:'session.started'});await tick();live.cleanup();assert.equal(signal.aborted,true);
  chime.resolve();await ready;assert.equal(live.state,'idle');assert.equal(track.enabled,false);assert.deepEqual(events.releases,['lease-1']);assert.equal(events.tracksStopped,1);
});
test('a microphone lease arriving after cancellation is released before any capture',async()=>{
  const claim=deferred(),{live,events}=harness({claim:()=>claim.promise});const start=live.start({wakeId:'old'});await tick();live.cleanup();claim.resolve('late-lease');await start;
  assert.equal(events.mediaRequests,0);assert.deepEqual(events.releases,['late-lease']);
});
test('manual voice start does not play the wake chime',async t=>{
  let sounds=0;const {live}=harness({readySound:async()=>{sounds++;}});t.after(()=>live.cleanup());await live.start();await live.receive({type:'session.started'});assert.equal(sounds,0);
});
